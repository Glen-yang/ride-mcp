import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  AgentError,
  failure,
  inputs,
  mutationTools,
  publicResult,
  output,
  TOOL_NAMES,
  type Result,
  type ToolName,
} from "./contracts.js";

export const RESOURCE_URI = "ui://ride/agent-v3.html";
export function registerAgentTools(
  server: McpServer,
  invoke: (name: ToolName, args: unknown, extra: any) => Promise<Result>,
  readOnly = false,
): void {
  server.registerResource(
    "ride-agent-cards",
    RESOURCE_URI,
    {
      mimeType: "text/html;profile=mcp-app",
      _meta: { "openai/widgetPrefersBorder": true },
    },
    async () => ({
      contents: [
        {
          uri: RESOURCE_URI,
          mimeType: "text/html;profile=mcp-app",
          text: await readFile(
            fileURLToPath(new URL("../../public/agent.html", import.meta.url)),
            "utf8",
          ),
        },
      ],
    }),
  );
  for (const name of TOOL_NAMES) {
    if (readOnly && (mutationTools.has(name) || name === "set_preferences"))
      continue;
    server.registerTool(
      name,
      {
        title: name.replaceAll("_", " "),
        description: description(name),
        inputSchema: inputs[name],
        outputSchema: output,
        annotations: {
          readOnlyHint: !mutationTools.has(name) && name !== "set_preferences",
          destructiveHint: mutationTools.has(name),
          idempotentHint:
            name !== "set_preferences" &&
            name !== "recommend_traders" &&
            !mutationTools.has(name),
          openWorldHint: true,
        },
        _meta: {
          ui: { resourceUri: RESOURCE_URI },
          "openai/outputTemplate": RESOURCE_URI,
        },
      },
      async (args: unknown, extra: any) => {
        try {
          const value = publicResult(await invoke(name, args, extra));
          return {
            content: [{ type: "text" as const, text: JSON.stringify(value) }],
            structuredContent: value,
            isError: !!value.error,
          };
        } catch (e) {
          const value = failure(e);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(value) }],
            structuredContent: value,
            isError: true,
          };
        }
      },
    );
  }
}
export async function invokeAgent(
  url: string,
  token: string | undefined,
  name: string,
  args: unknown,
): Promise<Result> {
  if (!token)
    throw new AgentError("AUTH_REQUIRED", "Log in to Ride first.", false, 401);
  const response = await fetch(new URL(`/agent/v1/${name}`, url), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(25000),
    redirect: "error",
  });
  const body = await response.json();
  if (!response.ok && !(body as Result).error)
    throw new AgentError(
      "BACKEND_UNAVAILABLE",
      "Ride Agent request failed.",
      response.status >= 500,
      response.status,
    );
  return publicResult(body);
}
function description(name: ToolName): string {
  const descriptions: Record<ToolName, string> = {
    set_preferences:
      "Save budget, loss trigger and market preferences. Existing portfolios are unchanged.",
    recommend_traders:
      "Recommend a frozen diversified plan of 3–6 fresh eligible traders using saved or supplied preferences.",
    get_trader_profile:
      "Read verified source statistics and actual Copy Score components using a public trader ID.",
    start_copy:
      "Create an expiring start proposal. Human confirmation in Ride is required unless bounded Ride authority applies.",
    get_portfolio:
      "Read actual owned positions, gross and net exposure, reservations and reconciled follower net profit. Missing values are null.",
    update_copy:
      "Propose amount, leverage cap, sleeve loss trigger or an explicit eligible replacement. Released funds must be verified.",
    stop_copy:
      "Propose wind_down (default) or close_now. Removing a hedge can increase net exposure and is risk checked.",
    review_portfolio:
      "Read factual portfolio observations and suggested changes. Suggestions do not execute.",
    get_updates:
      "Read persisted monitoring and execution events using an opaque account-bound cursor. This call does not schedule monitoring.",
    close_position:
      "Propose closing one owned aggregate position. All affected sleeves are included.",
  };
  return descriptions[name];
}
