import { it } from "node:test";
import assert from "node:assert/strict";
import { Interface } from "ethers";
import { PredictionVenue } from "./prediction.js";
import { fromPlan } from "./service.js";
import { recommend, now, uid } from "./domain.js";
import { candidate } from "./fixtures.js";
const wallet = "0x0000000000000000000000000000000000000001",
  other = "0x0000000000000000000000000000000000000002";
const identity = {
  wallet,
  collateral: "0x0000000000000000000000000000000000000010",
  wrapped_collateral: "0x0000000000000000000000000000000000000011",
  conditional_tokens: "0x0000000000000000000000000000000000000012",
};
it("browses fresh Prediction scores without requiring live positions or collateral RPC", async () => {
  const operations: string[] = [];
  const scoredAt = now() - 3600000;
  const venue = new PredictionVenue(
    {
      query: async () =>
        assert.fail("Discovery must not write outcome metadata"),
    } as any,
    async (operation) => {
      operations.push(operation);
      assert.equal(operation, "prediction_pool");
      return [
        {
          address: wallet,
          handle: "Prediction specialist",
          score: "88.5",
          score_version: "prediction_curated_pool_v1",
          components: { winRate: "90", pnl: "85", trades: null },
          computed_at: scoredAt,
          expires_at: scoredAt + 36 * 3600000,
          assets: ["Sports", "Politics"],
        },
      ];
    },
    "stable-test-salt",
  );
  // The source reader must remain a separate, fail-closed execution check.
  (venue as any).source = async () =>
    assert.fail("Discovery must not read live source inventory");
  (venue as any).history = {
    metrics: async () => ({
      source_roi_pct: null,
      source_drawdown_pct: null,
      metric_unavailable_reason: "history_source_unavailable",
    }),
  };
  const candidates = await venue.candidates();
  assert.equal(candidates.length, 1);
  const profile = candidates[0];
  assert.equal(profile.market, "prediction");
  assert.equal(profile.handle, "Prediction specialist");
  assert.equal(profile.score, 88.5);
  assert.equal(profile.score_version, "prediction_curated_pool_v1");
  assert.equal(profile.scored_at, scoredAt);
  assert.deepEqual(profile.assets, ["SPORTS", "POLITICS"]);
  assert.equal(profile.components.trades, null);
  assert.equal(profile.source_roi_pct, null);
  assert.equal(profile.source_drawdown_pct, null);
  assert.equal(profile.eligibility, "PASS");
  assert(operations.every((op) => op === "prediction_pool"));
  assert.equal(operations.length, 1);
});
it("uses validated Prediction history for a 100 USDC two-trader plan and bounds its freshness", async () => {
  const at = now();
  const venue = new PredictionVenue(
    {} as any,
    async () =>
      [wallet, other].map((address, i) => ({
        address,
        handle: `History ${i}`,
        score: 95 - i,
        score_version: "prediction_curated_pool_v1",
        computed_at: at,
        expires_at: at + 36 * 3600000,
        assets: ["SPORTS"],
      })),
    "salt",
  );
  (venue as any).history = {
    metrics: async (address: string) => ({
      source_roi_pct: 2,
      source_drawdown_pct: address === wallet ? 0.05 : 10.7,
      metric_window: {
        start_at: at - 60 * 24 * 3600000,
        end_at: at - 35 * 3600000,
        basis: "validated_fixture",
      },
    }),
  };
  const candidates = await venue.candidates();
  assert(candidates.every((c) => c.expires_at === at + 3600000));
  const plan = recommend(
    {
      budget_usdc: "100",
      loss_trigger_pct: 20,
      market: "prediction",
      assets: [],
      allow_altcoins: true,
      portfolio_kind: "basket",
      basket_size: 2,
    },
    candidates,
  );
  assert.equal(plan.allocations.length, 2);
  assert(
    plan.allocations.every(
      (a) =>
        a.amount_usdc === "50.000000" &&
        a.leverage_cap === 1 &&
        a.trader.source_drawdown_pct != null,
    ),
  );
});
const abi = new Interface([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
  "event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value)",
]);
it("considers partially shared Prediction topics when recommending a diversified basket", () => {
  const pool = [
    {
      ...candidate(1),
      market: "prediction" as const,
      score: 95.44,
      assets: ["SPORTS", "POLITICS"],
      style: "Sports",
      venue_max_leverage: 1,
    },
    {
      ...candidate(2),
      market: "prediction" as const,
      score: 95.05,
      assets: ["ECONOMICS", "SPORTS"],
      style: "Economics",
      venue_max_leverage: 1,
    },
    {
      ...candidate(3),
      market: "prediction" as const,
      score: 93.46,
      assets: ["CRYPTO"],
      style: "Crypto",
      venue_max_leverage: 1,
    },
  ];
  const plan = recommend(
    {
      budget_usdc: "100",
      loss_trigger_pct: 20,
      market: "prediction",
      assets: [],
      allow_altcoins: true,
      portfolio_kind: "basket",
      basket_size: 2,
    },
    pool,
  );
  assert.deepEqual(
    plan.allocations.map((a) => a.trader.id),
    [pool[0].id, pool[2].id],
  );
  assert(
    plan.allocations.every(
      (a) => a.amount_usdc === "50.000000" && a.leverage_cap === 1,
    ),
  );
});
const p = () =>
  fromPlan(
    recommend(
      {
        budget_usdc: "500",
        loss_trigger_pct: 20,
        market: "perps",
        assets: ["BTC", "ETH"],
        allow_altcoins: false,
      },
      [1, 2, 3, 4].map(candidate),
    ),
  );
function execution(key: string, task: string) {
  return {
    id: uid("execution"),
    key,
    target_quantity: "10",
    allocations: {},
    revision: 1,
    created_at: now(),
    expires_at: now() + 60000,
    fingerprint: "f",
    status: "submitted" as const,
    task_id: task,
    observed_quantity: null,
    reserve_usdc: "5",
    error: null,
  };
}
function log(event: string, args: unknown[], address: string) {
  return { ...abi.encodeEventLog(abi.getEvent(event)!, args), address };
}
async function evidence({
  buy = true,
  fee = 100000n,
  ambiguous = false,
  pending = false,
} = {}) {
  const portfolio = p();
  portfolio.executions = [execution("prediction:one", "task1")];
  if (ambiguous)
    portfolio.executions.push(execution("prediction:one", "task2"));
  const venue = new PredictionVenue(
    {} as any,
    async () => ({
      status: 3,
      side: buy ? 1 : 2,
      order_id: "owned",
      filled_size: "10",
      response: JSON.stringify({
        agent_settlement: {
          complete: true,
          trades: [
            {
              status: "CONFIRMED",
              transaction_hash: "tx",
              quantity: "10",
              price: ".5",
            },
          ],
        },
      }),
    }),
    "salt",
  );
  const v = venue as any;
  v.outcome = async () => ({ token_id: "123" });
  v.provider = () => ({
    getTransactionReceipt: async () => ({
      status: 1,
      blockNumber: pending ? 99 : 95,
      logs: [
        log(
          "Transfer",
          [
            buy ? wallet : other,
            buy ? other : wallet,
            buy ? 5000000n + fee : 5000000n - fee,
          ],
          identity.collateral,
        ),
        log(
          "TransferSingle",
          [other, buy ? other : wallet, buy ? wallet : other, 123n, 10000000n],
          identity.conditional_tokens,
        ),
      ],
    }),
    getBlock: async () => ({ timestamp: 1234 }),
    getLogs: async () => [],
  });
  return v.settlement("user", portfolio, identity, 100);
}
it("attributes prediction buy and sell cash fees using confirmed token transfers", async () => {
  for (const buy of [true, false]) {
    const r = await evidence({ buy });
    assert.equal(r.complete, true);
    assert.equal(r.fills.length, 1);
    assert.equal(r.fills[0].fee_usdc, "0.1");
    assert.equal(r.fills[0].quantity, buy ? "10" : "-10");
    assert.equal(r.flows.length, 0);
  }
});
it("refuses ambiguous multi-order receipts before applying any fill", async () => {
  const r = await evidence({ ambiguous: true });
  assert.equal(r.complete, false);
  assert.equal(r.fills.length, 0);
});
it("keeps unconfirmed transfers and impossible fee attribution unresolved", async () => {
  for (const input of [
    { pending: true },
    { fee: -100000n },
    { fee: 1000000n },
  ]) {
    const r = await evidence(input);
    assert.equal(r.complete, false);
    assert.equal(r.fills.length, 0);
  }
});
