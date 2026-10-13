// Loopback acceptance fixture: production cards and HTTP contracts, simulated venues.
import { readFile } from "node:fs/promises";
import express from "express";
import { backendApp } from "../src/agent/backend.js";
import { AgentService } from "../src/agent/service.js";
import { AgentRunner } from "../src/agent/runner.js";
import { Cursor, MemoryRepository } from "../src/agent/repository.js";
import { uid, now } from "../src/agent/domain.js";
import { mountHumanConfirmation } from "../src/agent/human.js";
import { FakeAdapter, candidate } from "../src/agent/fixtures.js";
const repository = new MemoryRepository(),
  adapter = new FakeAdapter();
adapter.pool = Array.from({ length: 24 }, (_, i) => candidate(i + 1));
adapter.depositOptions = async () => ({
  routes: [
    {
      market: "perps",
      asset: "USDC",
      network: "Arbitrum",
      activation_required: true,
    },
    {
      market: "prediction",
      asset: "USDT",
      network: "Base",
      activation_required: false,
    },
  ],
  notes: ["Local fixture only. Do not send money to fixture addresses."],
});
adapter.depositAddress = async (_user, input) => ({
  id: uid("deposit"),
  market: input.market,
  asset: input.asset,
  network: input.network,
  address: "0x" + "5".repeat(40),
  provider: input.market === "prediction" ? "polymarket_bridge" : "wallet",
  created_at: now(),
});
adapter.depositStatus = async (d) => ({
  deposit_id: d.id,
  status:
    Number(adapter.snap.available_usdc) > 0
      ? "trading_ready"
      : "awaiting_deposit",
  wallet_balance_usdc: "500",
  trading_balance_usdc: adapter.snap.available_usdc,
  available_to_copy: Number(adapter.snap.available_usdc) > 0,
  funding_credit_verified: Number(adapter.snap.available_usdc) > 0,
  next_action: "Fixture address only; no funds were sent.",
});
adapter.fundingOperation = async (operation, _user, input) => {
  if (operation === "submit") {
    adapter.snap.available_usdc = input.amount_usdc;
    return {
      submitted: true,
      transaction_hash: "0x" + "a".repeat(64),
      receipt_status: "0x1",
    };
  }
  return {
    wallet: { master: "0x" + "5".repeat(40), status: "active" },
    amount_usdc: input.amount_usdc,
    requires_signature: false,
  };
};
adapter.snap.available_usdc = "0";
const port = Number(process.env.RIDE_PREVIEW_PORT ?? 17830),
  base = `http://127.0.0.1:${port}`;
const service = new AgentService(
  repository,
  adapter,
  base,
  new Cursor("local-preview-only-key-".repeat(2)),
);
const app = express();
app.use(express.json({ limit: "32kb" }));
app.get("/favicon.ico", (_req, res) => res.sendStatus(204));
app.get("/cards", async (_req, res) =>
  res.type("html").send(await readFile("public/agent.html", "utf8")),
);
app.get("/preview", (_req, res) =>
  res.type("html")
    .send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ride V18 functional preview</title>
<style>body{margin:0;background:#fcfbf8;font:14px system-ui}header{padding:10px;background:#f5f3ec;display:flex;flex-wrap:wrap;gap:8px;align-items:center}iframe{width:100%;height:calc(100vh - 70px);border:0}button{padding:6px}small{max-width:100%}</style>
<header><small>Local acceptance · simulated venue, real cards and backend</small><button id="fund">Simulate funding</button><button id="confirm">Simulate Ride human confirmation</button><button id="portfolio">Load portfolio</button><button id="settings">Notification settings</button></header><iframe id="app" src="/cards" title="Ride MCP cards"></iframe>
<script>
const frame=document.querySelector('iframe');let lastProposal=null;window.calls=[];
const send=value=>frame.contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:value}},'*');
const invoke=async(name,args)=>{const r=await fetch('/agent/v1/'+name,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer local-fixture'},body:JSON.stringify(args)});const value=await r.json();window.calls.push({name,args,status:value.status,error:value.error});if(value.data?.proposal)lastProposal=value.data.proposal;return value;};
window.addEventListener('message',async e=>{if(e.source!==frame.contentWindow)return;const m=e.data;if(!m.id)return;let result;
if(m.method==='ui/initialize')result={protocolVersion:'2026-01-26',hostInfo:{name:'Local acceptance host',version:'1'},hostCapabilities:{serverTools:{},openLinks:{}}};
if(m.method==='tools/call')result={structuredContent:await invoke(m.params.name,m.params.arguments)};
if(m.method==='ui/open-link'){window.open(m.params.url,'_blank');result={isError:false};}
if(result)frame.contentWindow.postMessage({jsonrpc:'2.0',id:m.id,result},'*');});
document.getElementById('fund').onclick=()=>fetch('/fixture/fund',{method:'POST',headers:{Authorization:'Bearer local-fixture'}});
document.getElementById('confirm').onclick=async()=>{if(!lastProposal)return;const r=await fetch('/agent/human/confirm',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer local-fixture'},body:JSON.stringify({proposal_id:lastProposal.id,preview_hash:lastProposal.preview_hash})});const value=await r.json();await fetch('/fixture/tick',{method:'POST',headers:{Authorization:'Bearer local-fixture'}});send(value);};
document.getElementById('portfolio').onclick=async()=>send(await invoke('get_portfolio',{}));
document.getElementById('settings').onclick=async()=>send(await invoke('get_notification_preferences',{}));
</script>`),
);
const fixtureIdentity = async (token: string) => {
  if (token !== "local-fixture") throw Error("Fixture token required");
  return "preview-user";
};
const backendListener = backendApp(service, fixtureIdentity).listen(
  port + 1,
  "127.0.0.1",
);
mountHumanConfirmation(app, {
  backend: `http://127.0.0.1:${port + 1}`,
  base,
  cookieKey: "fixture-only-key".repeat(4),
  auth: {
    privyAppId: "fixture",
    privyClientId: "",
    jsSdkUrl: `${base}/fixture/sdk.js`,
  },
  exchange: async () => ({ rideAuthToken: "local-fixture" }),
});
app.get("/fixture/sdk.js", (_req, res) =>
  res.type("application/javascript").send(`
export class LocalStorage {};
export default class Privy {
 constructor(){this.embeddedWallet={getURL:()=>"https://auth.privy.io/",onMessage:()=>{}};this.user={get:async()=>({user:{id:"fixture-user",linked_accounts:[]}})};}
 async initialize(){const p=document.createElement("p");p.textContent="Local acceptance · simulated funding · no funds move";document.body.prepend(p);} async getAccessToken(){return "fixture-only";}
}`),
);
app.use("/fixture", (req, res, next) => {
  if (req.get("authorization") !== "Bearer local-fixture") {
    res.sendStatus(401);
    return;
  }
  next();
});
app.post("/fixture/fund", (_req, res) => {
  adapter.snap.available_usdc = "500";
  res.json({ funded: true });
});
app.post("/fixture/tick", async (_req, res) => {
  await new AgentRunner(service).tick("preview-user");
  res.json({ ticked: true });
});
app.use(
  backendApp(service, async (token) => {
    if (token !== "local-fixture") throw Error("Fixture token required");
    return "preview-user";
  }),
);
const listener = app.listen(port, "127.0.0.1", () =>
  console.log(`${base}/preview`),
);
process.once("SIGTERM", () => {
  listener.close();
  backendListener.close();
});
process.once("SIGINT", () => {
  listener.close();
  backendListener.close();
});
