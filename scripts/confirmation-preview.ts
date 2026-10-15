// Loopback-only browser acceptance. No venue adapter, production credential,
// account or execution worker is imported or contacted by this fixture.
import { readFile } from "node:fs/promises";
import express from "express";
import { mountHumanConfirmation } from "../src/agent/human.js";
import { createRideHttpApp } from "../src/http_security.js";

const port = Number(process.env.RIDE_CONFIRM_PREVIEW_PORT ?? 17842);
const base = `http://127.0.0.1:${port}`;
const proposalId = "proposal_browser_fixture_00000000";
const counts = {
  login_exchanges: 0,
  proposal_reads: 0,
  mock_confirmations: 0,
  real_orders: 0,
};
const proposal = {
  id: proposalId,
  action: "start_copy",
  status: "requires_confirmation",
  arguments: {
    fixture: true,
    budget_usdc: "20",
    traders: ["fixture-A", "fixture-B"],
  },
  preview: { loss_trigger_amount_usdc: "4.000000" },
  preview_hash: "a".repeat(64),
  expires_at: Date.now() + 60 * 60_000,
  confirmation_url: `${base}/agent/confirm/${proposalId}`,
};
const result = () => ({
  version: "3",
  status: "ok",
  data: { proposal },
  warnings: [],
  as_of: new Date().toISOString(),
});
const backend = express();
backend.use(express.json());
backend.post("/agent/human/:operation", (req, res) => {
  if (req.get("authorization") !== "Bearer local-fixture-core") {
    res
      .status(401)
      .json({
        error: { code: "AUTH_REQUIRED", message: "Fixture identity required" },
      });
    return;
  }
  if (req.body.proposal_id !== proposalId) {
    res.status(404).json({ error: { code: "NOT_FOUND" } });
    return;
  }
  if (req.params.operation === "proposal") counts.proposal_reads++;
  else if (req.params.operation === "confirm") {
    if (req.body.preview_hash !== proposal.preview_hash) {
      res.status(409).json({ error: { code: "CONFLICT" } });
      return;
    }
    counts.mock_confirmations++;
    proposal.status = "queued";
  } else if (req.params.operation === "reject") proposal.status = "rejected";
  else {
    res.status(404).end();
    return;
  }
  res.json(result());
});
const listener = backend.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => listener.once("listening", resolve));
const app = createRideHttpApp("127.0.0.1");
mountHumanConfirmation(app, {
  base,
  backend: `http://127.0.0.1:${(listener.address() as any).port}`,
  cookieKey: "local-confirmation-fixture-only-".repeat(2),
  frameAncestors: ["'self'", `http://localhost:${port}`],
  auth: {
    privyAppId: "local-fixture",
    privyClientId: "",
    jsSdkUrl: `${base}/fixture/privy.js`,
    manualTokenAuthEnabled: false,
  },
  exchange: async (input) => {
    if (input.privyAccessToken !== "local-fixture-privy")
      throw Error("Fixture token required");
    counts.login_exchanges++;
    return { rideAuthToken: "local-fixture-core" };
  },
});
app.get("/fixture/privy.js", (_req, res) =>
  res.type("js").send(`
export class LocalStorage {}
export default class Privy {
  async initialize() {}
  user = { get: async () => ({ user: { id: 'local-fixture-user', linkedAccounts: [
    { type:'wallet', chainType:'ethereum', walletClientType:'privy', address:'0x'+'1'.repeat(40), id:'local-fixture-wallet' }
  ] } }) };
  async getAccessToken() { return 'local-fixture-privy'; }
  auth = { oauth: { generateURL: async () => { throw Error('Unexpected Google redirect in local acceptance'); } } };
}`),
);
app.get("/fixture/status", (_req, res) =>
  res.json({ ...counts, proposal_status: proposal.status }),
);
app.get("/fixture/host", async (req, res) => {
  const demo = req.query.mode !== "proposal";
  const data = demo
    ? {
        version: "3",
        status: "ok",
        data: {
          confirmation_demo: true,
          proposal: {
            ...proposal,
            id: "proposal_card_demo_00000000",
            action: "demo",
            arguments: { amount_usdc: "0", execution: "disabled" },
          },
        },
        warnings: [],
        as_of: new Date().toISOString(),
      }
    : result();
  const html = (await readFile("public/agent.html", "utf8"))
    .replace("/*HOST_CONFIG*/{}", JSON.stringify({ confirmation_origin: base }))
    .replace(
      "<head>",
      `<head><script>window.openai={toolOutput:${JSON.stringify(data).replaceAll("<", "\\u003c")},callTool:async()=>{throw Error('Fixture has no account tools')}};</script>`,
    );
  res.type("html").send(html);
});
app.listen(port, "127.0.0.1", () =>
  console.log(
    JSON.stringify({
      base,
      demo: `${base}/fixture/host`,
      proposal: `${base}/agent/confirm/${proposalId}`,
    }),
  ),
);
