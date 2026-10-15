// Loopback-only auth acceptance fixture: real pages, cookies, identity exchange,
// resource ownership and Agent backend; OAuth identities and venue reads are simulated.
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { backendApp } from "../src/agent/backend.js";
import { AgentService } from "../src/agent/service.js";
import { Cursor, MemoryRepository } from "../src/agent/repository.js";
import { FakeAdapter, candidate } from "../src/agent/fixtures.js";
import { mountHumanConfirmation } from "../src/agent/human.js";
import { createPrivyExchange } from "../src/privy_exchange.js";
import {
  createRideOAuthApprovalRouter,
  RideOAuthProvider,
} from "../src/oauth.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { uid, now } from "../src/agent/domain.js";
const port = Number(process.env.RIDE_APPLE_PREVIEW_PORT ?? 17860);
const base = `http://127.0.0.1:${port}`;
const repository = new MemoryRepository(),
  adapter = new FakeAdapter();
adapter.pool = Array.from({ length: 8 }, (_, i) => candidate(i + 1));
adapter.depositOptions = async () => ({
  routes: [
    {
      market: "perps",
      asset: "USDC",
      network: "Arbitrum",
      activation_required: true,
    },
  ],
  notes: ["Simulated funding only"],
});
adapter.depositAddress = async (_user, input) => ({
  id: uid("deposit"),
  market: input.market,
  asset: input.asset,
  network: input.network,
  address: "0x" + "5".repeat(40),
  provider: "wallet",
  created_at: now(),
});
adapter.depositStatus = async (d) => ({
  deposit_id: d.id,
  status: "awaiting_deposit",
  wallet_balance_usdc: "0",
  trading_balance_usdc: "0",
  available_to_copy: false,
  funding_credit_verified: false,
  next_action: "Fixture only; no funds moved.",
});
adapter.fundingOperation = async (_operation, _user, input) => ({
  wallet: { master: "0x" + "5".repeat(40), status: "active" },
  amount_usdc: input.amount_usdc,
  requires_signature: false,
});
const service = new AgentService(
  repository,
  adapter,
  base,
  new Cursor("apple-fixture-cursor-".repeat(3)),
);
await service.tool("original-ride-user", "set_preferences", {
  budget_usdc: "500",
  loss_trigger_pct: 20,
  market: "perps",
  assets: ["BTC", "ETH"],
  allow_altcoins: false,
});
const plan: any = (
  await service.tool("original-ride-user", "recommend_traders", {})
).data.plan;
const proposal: any = (
  await service.tool("original-ride-user", "start_copy", { plan_id: plan.id })
).data.proposal;
const deposit: any = (
  await service.tool("original-ride-user", "get_deposit_address", {
    market: "perps",
    asset: "USDC",
    network: "Arbitrum",
    amount_usdc: "10",
  })
).data.deposit;
await service.tool("original-ride-user", "prepare_deposit", {
  deposit_id: deposit.id,
  amount_usdc: "10",
});
const backend = backendApp(service, async (token) => {
  if (token !== "fixture-original-core")
    throw Error("Invalid fixture identity");
  return "original-ride-user";
}).listen(port + 1, "127.0.0.1");
await once(backend, "listening");
const app = express();
app.use(express.json({ limit: "32kb" }));
const requests: any[] = [];
const exchange = createPrivyExchange(`${base}/fixture/core`, (async (
  _url,
  options,
) => {
  const input = JSON.parse(options!.body as string).variables.input;
  assert.equal(input.privyId, "did:privy:original-app-user");
  assert.equal(input.privyAccessToken, "fixture-privy-token");
  assert.equal(input.walletAddress, "0x" + "5".repeat(40));
  assert(["APPLE", "GOOGLE"].includes(input.authProvider));
  requests.push({
    type: "core-login",
    provider: input.authProvider,
    privy_id: input.privyId,
    ride_id: "original-ride-user",
  });
  return Response.json({
    data: {
      syncPrivyUser: {
        accessToken: "fixture-original-core",
        user: { id: "original-ride-user", username: "Original Ride account" },
      },
    },
  });
}) as typeof fetch);
const auth = {
  privyAppId: "fixture",
  privyClientId: "",
  jsSdkUrl: `${base}/fixture/sdk.js`,
  manualTokenAuthEnabled: false,
};
const provider = new RideOAuthProvider({
  validateRideToken: async () => ({ subject: "original-ride-user" }),
  exchangePrivyToken: exchange,
  authPage: auth,
});
const fixtureClient = {
  client_id: "apple-fixture",
  client_name: "Local auth acceptance",
  redirect_uris: [`${base}/fixture/complete`],
  token_endpoint_auth_method: "none",
  grant_types: ["authorization_code"],
  response_types: ["code"],
};
await provider.clientsStore.registerClient!(fixtureClient);
app.use(
  mcpAuthRouter({
    provider,
    issuerUrl: new URL(base),
    baseUrl: new URL(base),
    scopesSupported: ["ride:read", "ride:trade"],
  }),
);
app.use(createRideOAuthApprovalRouter(provider));
mountHumanConfirmation(app, {
  backend: `http://127.0.0.1:${port + 1}`,
  base,
  cookieKey: "apple-fixture-only-cookie-key-".repeat(2),
  auth,
  exchange,
});
app.get("/fixture/sdk.js", (_req, res) =>
  res.type("application/javascript").send(`
export class LocalStorage {}
const user={id:'did:privy:original-app-user',linked_accounts:[{type:'apple_oauth',email:'private@privaterelay.appleid.com'},{type:'google_oauth',email:'fixture@example.test'},{type:'wallet',chain_type:'ethereum',wallet_client_type:'privy',address:'0x'+'5'.repeat(40),id:'original-wallet'}]};
export default class Privy {
 constructor(){this.user={get:async()=>({user:null})};this.embeddedWallet={getURL:()=>'https://auth.privy.io/',onMessage:()=>{}};this.auth={oauth:{generateURL:async(provider,redirect)=>{sessionStorage.setItem('fixture:state','fixed-state');return {url:'/fixture/provider?provider='+provider+'&redirect='+encodeURIComponent(redirect)};},loginWithCode:async(code,state,provider,raw,mode)=>{if(state!==sessionStorage.getItem('fixture:state')||code!==provider+'-code')throw Error('Invalid OAuth state');if(provider==='apple'&&mode!=='no-signup')throw Error('Apple signup is forbidden');return {user};}}};}
 async initialize(){if(!document.getElementById('fixture-banner')){const b=document.createElement('p');b.id='fixture-banner';b.textContent='Local auth acceptance · simulated identity · no funds move';document.body.prepend(b);}}
 async getAccessToken(){return 'fixture-privy-token';}
}`),
);
app.get("/fixture/provider", (req, res) => {
  const provider = String(req.query.provider),
    redirect = new URL(String(req.query.redirect));
  assert(["apple", "google"].includes(provider));
  assert.equal(redirect.href, `${base}/auth/privy/oauth/callback`);
  const success = new URL(redirect);
  success.searchParams.set("privy_oauth_code", provider + "-code");
  success.searchParams.set("privy_oauth_state", "fixed-state");
  const decline = new URL(redirect);
  decline.searchParams.set("error", "access_denied");
  res
    .type("html")
    .send(
      `<h1>Simulated ${provider} sign-in</h1><p>No real Apple or Google account is used.</p><a href="${success.href}">Return original Ride identity</a><br><a href="${decline.href}">Decline sign-in</a>`,
    );
});
app.get("/fixture/complete", (_req, res) =>
  res
    .type("html")
    .send(
      "<h1>MCP authorization complete</h1><p>Original Ride account reused. Simulated identity only.</p>",
    ),
);
app.get("/fixture/results", (_req, res) => res.json(requests));
const authorize = `${base}/authorize?client_id=apple-fixture&redirect_uri=${encodeURIComponent(base + "/fixture/complete")}&response_type=code&code_challenge=fixture-challenge&code_challenge_method=S256&scope=ride:read&state=ai-client-state`;
app.get("/", (_req, res) =>
  res
    .type("html")
    .send(
      `<h1>Ride Apple auth acceptance</h1><p>Loopback fixture only. No real accounts or money.</p><ul><li><a href="${authorize}">MCP authorization</a></li><li><a href="/agent/fund/${deposit.id}">Funding confirmation</a></li><li><a href="/agent/confirm/${proposal.id}">Copy confirmation</a></li><li><a href="/fixture/results">Identity assertions</a></li></ul>`,
    ),
);
const gateway = app.listen(port, "127.0.0.1");
await once(gateway, "listening");
console.log(
  JSON.stringify({
    base,
    authorize,
    deposit: deposit.id,
    proposal: proposal.id,
  }),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    gateway.close();
    backend.close();
  });
