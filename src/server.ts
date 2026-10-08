#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  mcpAuthRouter,
  getOAuthProtectedResourceMetadataUrl,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import {
  RideOAuthProvider,
  InMemoryOAuthStateStore,
  createRedisOAuthStateStore,
  createRideOAuthApprovalRouter,
  RIDE_OAUTH_SCOPES,
  type PrivyAuthorizationInput,
} from "./oauth.js";
import { createRideHttpApp, requestBodyErrorHandler } from "./http_security.js";
import { registerAgentTools, invokeAgent } from "./agent/mcp.js";
import { mountAgentProxy } from "./agent/http.js";
import { mountHumanConfirmation } from "./agent/human.js";
import { validateCoreIdentity } from "./agent/backend.js";
import { AgentError, mutationTools } from "./agent/contracts.js";

async function main(): Promise<void> {
  const required = (key: string) => {
    const v = process.env[key];
    if (!v) throw new Error(`${key} is required`);
    return v;
  };
  const host = process.env.HOST ?? "127.0.0.1",
    port = Number(process.env.PORT ?? 3333),
    base = new URL(required("PUBLIC_BASE_URL")),
    backend = required("RIDE_AGENT_BACKEND_URL"),
    graphql = required("RIDE_GRAPHQL_URL");
  if (
    base.protocol !== "https:" &&
    !["127.0.0.1", "localhost"].includes(base.hostname)
  )
    throw new Error("Public issuer must use HTTPS");
  if (
    !process.env.REDIS_URL &&
    !["127.0.0.1", "localhost"].includes(base.hostname)
  )
    throw new Error("Hosted OAuth requires Redis");
  const store = process.env.REDIS_URL
    ? await createRedisOAuthStateStore({ url: process.env.REDIS_URL })
    : new InMemoryOAuthStateStore();
  const config = {
    privyAppId: required("PRIVY_APP_ID"),
    privyClientId: process.env.PRIVY_CLIENT_ID ?? "",
    jsSdkUrl:
      process.env.PRIVY_JS_SDK_URL ??
      "https://esm.sh/@privy-io/js-sdk-core@0.67.0",
    manualTokenAuthEnabled: false,
  };
  const exchange = async (input: PrivyAuthorizationInput) => {
    const response = await fetch(graphql, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query:
          "mutation AgentLogin($input:SyncPrivyUserInput!){syncPrivyUser(input:$input){accessToken user{id username}}}",
        variables: {
          input: {
            ...input,
            authProvider: input.authProvider ?? "GOOGLE",
            appVersion: "1.0.0",
            platform: "WEB",
            deviceName: "Ride Agent",
          },
        },
      }),
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
    const data = (await response.json()) as any;
    const login = data.data?.syncPrivyUser;
    if (
      !response.ok ||
      data.errors?.length ||
      !login?.accessToken ||
      !login.user?.id
    )
      throw new AgentError("AUTH_REQUIRED", "Ride sign-in failed.", false, 401);
    return {
      rideAuthToken: login.accessToken as string,
      identity: {
        subject: login.user.id as string,
        displayName: login.user.username ?? "Ride user",
      },
    };
  };
  const provider = new RideOAuthProvider({
    store,
    validateRideToken: async (token) => ({
      subject: await validateCoreIdentity(token, graphql),
    }),
    exchangePrivyToken: exchange,
    authPage: config,
  });
  const app = createRideHttpApp(host),
    resource = new URL("/mcp", base),
    auth = requireBearerAuth({
      verifier: provider,
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resource),
    }),
    readOnly = process.env.RIDE_PUBLIC_SUBMISSION_MODE === "true";
  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: base,
      baseUrl: base,
      resourceServerUrl: resource,
      scopesSupported: [...RIDE_OAUTH_SCOPES],
      resourceName: "Ride",
    }),
  );
  app.use(createRideOAuthApprovalRouter(provider));
  mountAgentProxy(app, auth, backend, readOnly);
  if (!readOnly) {
    mountHumanConfirmation(app, {
      backend,
      base: base.href,
      cookieKey: required("RIDE_AGENT_HUMAN_COOKIE_KEY"),
      auth: config,
      exchange,
    });
  }
  app.get("/health", (_req, res) =>
    res.json({
      service: "ride-agent-mcp",
      version: "3",
      public_submission_mode: readOnly,
    }),
  );
  app.post("/mcp", auth, async (req, res) => {
    const server = new McpServer({ name: "ride", version: "0.2.2" });
    registerAgentTools(
      server,
      async (name, args, extra) => {
        if (
          !extra.authInfo?.scopes?.includes(
            mutationTools.has(name) ? "ride:trade" : "ride:read",
          )
        )
          throw new AgentError(
            "SCOPE_REQUIRED",
            "Ride OAuth scope is missing.",
            false,
            403,
          );
        const token = extra.authInfo?.extra?.rideAuthToken;
        return invokeAgent(
          backend,
          typeof token === "string" ? token : undefined,
          name,
          args,
        );
      },
      readOnly,
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent)
        res.status(500).json({ error: "mcp_request_failed" });
    }
  });
  app.get("/mcp", (_req, res) =>
    res.status(405).json({ error: "method_not_allowed" }),
  );
  app.use(requestBodyErrorHandler);
  app.listen(port, host, () =>
    console.error(`Ride MCP listening on ${base.origin}/mcp`),
  );
}
main().catch(() => {
  console.error(
    "Ride MCP startup failed. Check required OAuth and backend configuration.",
  );
  process.exitCode = 1;
});
