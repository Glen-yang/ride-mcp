import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  inputs,
  mutationTools,
  type ToolName,
  type Result,
  AgentError,
} from "../agent/contracts.js";
import { invokeAgent, registerAgentTools } from "../agent/mcp.js";
import {
  loadSession,
  login,
  accessToken,
  withSessionLock,
  openBrowser,
  serverUrl,
} from "./session.js";
import { setup, type ClientName } from "./setup.js";

export const HELP = `Ride CLI\n  setup --client codex|claude-code|cursor --server https://YOUR-RIDE-HOST/mcp\n  login --server https://YOUR-RIDE-HOST/mcp [--trade]\n  preferences --json '{"budget_usdc":"500","loss_trigger_pct":20,"market":"perps"}'\n  recommend | trader TRADER_ID | portfolio [PORTFOLIO_ID] | review [PORTFOLIO_ID]\n  copy start PLAN_ID | copy update COPY_ID --json '{"leverage_cap":5}'\n  copy stop COPY_ID [--mode wind_down|close_now]\n  updates [--cursor CURSOR] [--limit 20] | position close POSITION_ID\n  proposal PROPOSAL_ID | confirm PROPOSAL_ID\n  mcp [--server URL]\nJSON output is default. --pretty renders a human-readable view. Confirmation opens Ride.\n`;
export function parseCommand(argv: string[]): {
  command: string;
  name?: ToolName;
  args: Record<string, unknown>;
  flags: Record<string, string | boolean>;
  positionals: string[];
} {
  const flags: Record<string, string | boolean> = {},
    positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x.startsWith("--")) {
      const key = x.slice(2);
      if (["pretty", "trade", "help"].includes(key)) flags[key] = true;
      else {
        const value = argv[++i];
        if (!value || value.startsWith("--"))
          throw new Error(`Missing --${key} value`);
        flags[key] = value;
      }
    } else positionals.push(x);
  }
  const command = positionals[0] ?? "help";
  let name: ToolName | undefined;
  let args: Record<string, unknown> = {};
  if (flags.json) {
    const parsed = JSON.parse(flags.json as string);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("--json requires an object");
    args = parsed;
  }
  if (command === "preferences") name = "set_preferences";
  if (command === "recommend") name = "recommend_traders";
  if (command === "trader") {
    name = "get_trader_profile";
    args.trader_id = positionals[1];
  }
  if (command === "portfolio" || command === "review") {
    name = command === "portfolio" ? "get_portfolio" : "review_portfolio";
    if (positionals[1]) args.portfolio_id = positionals[1];
  }
  if (command === "updates") {
    name = "get_updates";
    if (flags.cursor) args.cursor = flags.cursor;
    if (flags.limit) args.limit = Number(flags.limit);
  }
  if (command === "copy") {
    const action = positionals[1];
    name =
      action === "start"
        ? "start_copy"
        : action === "update"
          ? "update_copy"
          : action === "stop"
            ? "stop_copy"
            : undefined;
    if (!name) throw new Error("Unknown copy command");
    args[action === "start" ? "plan_id" : "copy_id"] = positionals[2];
    if (flags.mode) args.mode = flags.mode;
  }
  if (command === "position" && positionals[1] === "close") {
    name = "close_position";
    args.position_id = positionals[2];
  }
  return { command, name, args, flags, positionals };
}
export async function runCli(argv: string[]): Promise<void> {
  const parsed = parseCommand(argv),
    { command, name, args, flags, positionals } = parsed;
  if (command === "help" || flags.help) {
    process.stdout.write(HELP);
    return;
  }
  if (command === "setup") {
    const server =
      flags.server ?? process.env.RIDE_MCP_URL ?? "https://mcp.onride.me/mcp";
    console.log(
      JSON.stringify(
        await setup(
          flags.client as ClientName,
          server as string,
          undefined,
          flags.distribution === "npm" ? "npm" : "github",
        ),
      ),
    );
    return;
  }
  if (command === "login") {
    const server =
      flags.server ?? process.env.RIDE_MCP_URL ?? "https://mcp.onride.me/mcp";
    await withSessionLock(() => login(server as string, flags.trade === true));
    console.log(
      JSON.stringify({
        status: "connected",
        scopes: flags.trade ? ["ride:read", "ride:trade"] : ["ride:read"],
      }),
    );
    return;
  }
  if (command === "mcp") {
    const server = new McpServer({ name: "ride", version: "0.2.0" });
    registerAgentTools(server, async (tool, input) =>
      withSessionLock(async () => {
        const session = await loadSession();
        if (!session)
          throw new AgentError(
            "AUTH_REQUIRED",
            "Run ride login first.",
            false,
            401,
          );
        if (
          flags.server &&
          serverUrl(flags.server as string) !== session.server
        )
          throw new AgentError(
            "AUTH_REQUIRED",
            "Login issuer does not match this MCP configuration.",
            false,
            401,
          );
        return invokeAgent(
          session.server,
          await accessToken(session),
          tool,
          input,
        );
      }),
    );
    await server.connect(new StdioServerTransport());
    return;
  }
  await withSessionLock(async () => {
    const session = await loadSession();
    if (!session)
      throw new AgentError(
        "AUTH_REQUIRED",
        "Run ride login first.",
        false,
        401,
      );
    const token = await accessToken(session);
    if (command === "proposal" || command === "confirm") {
      const value = await invokeAgent(session.server, token, "proposal", {
        proposal_id: positionals[1],
      });
      if (command === "confirm") {
        const proposal = value.data.proposal as { confirmation_url?: string };
        if (!proposal?.confirmation_url)
          throw new Error("Proposal has no confirmation URL");
        const confirmation = new URL(proposal.confirmation_url);
        if (confirmation.origin !== new URL(session.server).origin)
          throw new Error("Confirmation origin does not match Ride");
        await openBrowser(confirmation.href);
      }
      print(value, !!flags.pretty);
      return;
    }
    if (!name) throw new Error("Unknown command. Run ride --help.");
    const input = inputs[name].parse(args);
    if (
      mutationTools.has(name) &&
      !session.tokens?.scope?.split(" ").includes("ride:trade")
    )
      throw new AgentError(
        "SCOPE_REQUIRED",
        "Run ride login --trade to enable proposals.",
        false,
        403,
      );
    print(
      await invokeAgent(session.server, token, name, input),
      !!flags.pretty,
    );
  });
}
function print(value: Result, pretty: boolean): void {
  if (!pretty) {
    console.log(JSON.stringify(value));
    return;
  }
  console.log(`Ride · ${value.status} · ${value.as_of}`);
  if (value.error) {
    console.log(`${value.error.code}: ${value.error.message}`);
    return;
  }
  const data = value.data as any;
  if (data.plan) {
    console.table(
      data.plan.allocations.map((s: any) => ({
        trader: s.trader.handle,
        market: s.trader.market,
        score: s.trader.score,
        USDC: s.amount_usdc,
        leverage: `≤${s.leverage_cap}x`,
        style: s.trader.style,
      })),
    );
    console.log(`Plan: ${data.plan.id}`);
  } else if (data.portfolio) {
    const p = data.portfolio;
    console.log(
      `Portfolio ${p.id} · ${p.state}\nAccount ${p.account_value_usdc ?? "unavailable"} USDC · Net profit ${p.net_profit_usdc ?? "unavailable"} USDC`,
    );
    console.table(
      p.sleeves.map((s: any) => ({
        trader: s.trader.handle,
        state: s.state,
        USDC: s.amount_usdc,
        net: s.net_profit_usdc ?? "unavailable",
      })),
    );
    console.table(p.positions);
  } else if (data.trader) {
    console.log(
      `${data.trader.handle} · ${data.trader.market} · Copy Score ${data.trader.score}`,
    );
    console.table(data.trader.components);
  } else if (data.proposal) {
    console.log(
      `${data.proposal.action} · ${data.proposal.id}\nConfirm in Ride: ${data.proposal.confirmation_url}`,
    );
  } else console.log(JSON.stringify(data, null, 2));
  for (const warning of value.warnings) console.log(warning);
}
