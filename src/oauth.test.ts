import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, it } from "node:test";

import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  createRideOAuthApprovalRouter,
  RideOAuthProvider,
} from "./oauth.js";
import {
  createRideHttpApp,
  requestBodyErrorHandler,
} from "./http_security.js";

const client: OAuthClientInformationFull = {
  client_id: "test-client",
  client_name: "Test client",
  redirect_uris: ["https://client.example/callback"],
  token_endpoint_auth_method: "none",
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
};

function createProvider() {
  return new RideOAuthProvider({
    validateRideToken: async (token) => ({ subject: token }),
    exchangePrivyToken: async (input) => ({
      rideAuthToken: input.privyAccessToken,
      identity: { subject: input.privyId },
    }),
    authPage: {
      privyAppId: "public-app-id",
      privyClientId: "public-client-id",
      jsSdkUrl: "https://example.invalid/privy.js",
      manualTokenAuthEnabled: false,
    },
  });
}

describe("Ride OAuth scope enforcement", () => {
  it("rejects unsupported scopes during authorization", async () => {
    const provider = createProvider();
    await provider.clientsStore.registerClient!(client);

    await assert.rejects(
      provider.completeAuthorization({
        clientId: client.client_id,
        redirectUri: client.redirect_uris[0],
        codeChallenge: "challenge",
        scope: "ride:read ride:admin",
        rideAuthToken: "ride-token",
      }),
      { name: "InvalidScopeError" },
    );
  });

  it("defaults to read-only and prevents refresh scope escalation", async () => {
    const provider = createProvider();
    await provider.clientsStore.registerClient!(client);
    const code = await provider.completeAuthorization({
      clientId: client.client_id,
      redirectUri: client.redirect_uris[0],
      codeChallenge: "challenge",
      rideAuthToken: "ride-token",
    });
    const tokens = await provider.exchangeAuthorizationCode(client, code);
    assert.ok(tokens.access_token);
    assert.ok(tokens.refresh_token);

    const authInfo = await provider.verifyAccessToken(tokens.access_token);
    assert.deepEqual(authInfo.scopes, ["ride:read"]);

    await assert.rejects(
      provider.exchangeRefreshToken(client, tokens.refresh_token, [
        "ride:read",
        "ride:trade",
      ]),
      { name: "InvalidScopeError" },
    );

    const refreshed = await provider.exchangeRefreshToken(
      client,
      tokens.refresh_token,
      ["ride:read"],
    );
    const refreshedAuth = await provider.verifyAccessToken(
      refreshed.access_token,
    );
    assert.deepEqual(refreshedAuth.scopes, ["ride:read"]);
  });
});

describe("Ride OAuth approval redirects", () => {
  const servers: Array<
    ReturnType<ReturnType<typeof createRideHttpApp>["listen"]>
  > = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
          }),
      ),
    );
  });

  async function startApprovalServer(provider: RideOAuthProvider) {
    const app = createRideHttpApp("127.0.0.1");
    app.use(createRideOAuthApprovalRouter(provider));
    app.use(requestBodyErrorHandler);
    const server = app.listen(0, "127.0.0.1");
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  async function postChunkedJson(url: string, body: string) {
    return new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = httpRequest(
        url,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "transfer-encoding": "chunked",
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          res.on("end", () => {
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString("utf8"),
            });
          });
        },
      );
      req.on("error", reject);
      const midpoint = Math.floor(body.length / 2);
      req.write(body.slice(0, midpoint));
      req.end(body.slice(midpoint));
    });
  }

  it("does not redirect a denied request to an unregistered URI", async () => {
    const provider = createProvider();
    await provider.clientsStore.registerClient!(client);
    const baseUrl = await startApprovalServer(provider);
    const body = new URLSearchParams({
      action: "deny",
      client_id: client.client_id,
      redirect_uri: "https://attacker.example/callback",
      state: "opaque-state",
    });

    const response = await fetch(`${baseUrl}/auth/approve`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      redirect: "manual",
    });

    assert.equal(response.status, 400);
    assert.equal(response.headers.get("location"), null);
  });

  it("redirects a denied request only to its registered URI", async () => {
    const provider = createProvider();
    await provider.clientsStore.registerClient!(client);
    const baseUrl = await startApprovalServer(provider);
    const body = new URLSearchParams({
      action: "deny",
      client_id: client.client_id,
      redirect_uri: client.redirect_uris[0],
      state: "opaque-state",
    });

    const response = await fetch(`${baseUrl}/auth/approve`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      redirect: "manual",
    });

    assert.equal(response.status, 302);
    const location = new URL(response.headers.get("location")!);
    assert.equal(location.origin + location.pathname, client.redirect_uris[0]);
    assert.equal(location.searchParams.get("error"), "access_denied");
    assert.equal(location.searchParams.get("state"), "opaque-state");
  });

  it("accepts OAuth JSON and form bodies below 32 KiB", async () => {
    const provider = createProvider();
    await provider.clientsStore.registerClient!(client);
    const baseUrl = await startApprovalServer(provider);
    const token = "x".repeat(30 * 1024);

    const jsonResponse = await fetch(`${baseUrl}/auth/privy/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: client.client_id,
        redirect_uri: client.redirect_uris[0],
        code_challenge: "challenge",
        privy_id: "privy-user",
        privy_access_token: token,
      }),
      redirect: "manual",
    });
    assert.equal(jsonResponse.status, 200);
    assert.equal(
      new URL((await jsonResponse.json()).redirectUrl).origin,
      new URL(client.redirect_uris[0]).origin,
    );

    const formResponse = await fetch(`${baseUrl}/auth/approve`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        action: "approve",
        client_id: client.client_id,
        redirect_uri: client.redirect_uris[0],
        code_challenge: "challenge",
        ride_token: token,
      }),
      redirect: "manual",
    });
    assert.equal(formResponse.status, 302);
  });

  it("rejects oversized chunked OAuth JSON before SDK parsing", async () => {
    const provider = createProvider();
    await provider.clientsStore.registerClient!(client);
    const baseUrl = await startApprovalServer(provider);
    const response = await postChunkedJson(
      `${baseUrl}/auth/privy/approve`,
      JSON.stringify({
        client_id: client.client_id,
        redirect_uri: client.redirect_uris[0],
        code_challenge: "challenge",
        privy_id: "privy-user",
        privy_access_token: "x".repeat(33 * 1024),
      }),
    );

    assert.equal(response.status, 413);
    assert.deepEqual(JSON.parse(response.body), {
      error: "payload_too_large",
    });
  });

  it("rejects oversized OAuth approval forms", async () => {
    const provider = createProvider();
    await provider.clientsStore.registerClient!(client);
    const baseUrl = await startApprovalServer(provider);
    const body = new URLSearchParams({
      action: "approve",
      client_id: client.client_id,
      redirect_uri: client.redirect_uris[0],
      code_challenge: "challenge",
      ride_token: "x".repeat(33 * 1024),
    });

    const response = await fetch(`${baseUrl}/auth/approve`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      redirect: "manual",
    });

    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: "payload_too_large" });
  });
});
