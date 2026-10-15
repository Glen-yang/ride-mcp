import assert from "node:assert/strict";
import { it } from "node:test";
import { AgentService } from "./service.js";
import { MemoryRepository, Cursor } from "./repository.js";
import { candidate, FakeAdapter } from "./fixtures.js";
import {
  assetAllowed,
  eligibleCandidates,
  recommend,
  recommendationDiagnostics,
  fingerprint,
} from "./domain.js";
import type { Preferences } from "./contracts.js";
const pref: Preferences = {
  budget_usdc: "200",
  market: "both",
  asset_category: "any",
  assets: [],
  allow_altcoins: true,
  portfolio_kind: "basket",
  basket_size: 4,
  risk_tolerance: "medium",
  loss_trigger_pct: 10,
};
function env() {
  const repo = new MemoryRepository(),
    adapter = new FakeAdapter();
  adapter.pool = Array.from({ length: 11 }, (_, i) => ({
    ...candidate(i + 1),
    assets: [i % 2 ? "SOL" : "BTC"],
    asset_category: i % 3 === 0 ? ("rwa" as const) : ("crypto" as const),
  }));
  return {
    repo,
    adapter,
    api: new AgentService(
      repo,
      adapter,
      "https://ride.test",
      new Cursor("w".repeat(32)),
    ),
  };
}
it("fresh preferences default to all assets; saved, reopened and recommended values agree without altering existing portfolios", async () => {
  const { api, repo, adapter } = env();
  await api.tool("alice", "set_preferences", {
    budget_usdc: "200",
    loss_trigger_pct: 10,
    market: "both",
  });
  const saved: any = (await api.tool("alice", "get_preferences", {})).data
    .preference_collection;
  assert.equal(saved.answers.asset_category, "any");
  assert.deepEqual(saved.answers.assets, []);
  assert.equal(saved.answers.allow_altcoins, true);
  const out = await api.tool("alice", "recommend_traders", {
    preferences: { portfolio_kind: "basket", basket_size: 4 },
  });
  assert.equal((out.data.candidates as any[]).length, 11);
  assert.equal((out.data.plan as any).allocations.length, 4);
  assert.deepEqual(
    (out.data.plan as any).preferences.assets,
    saved.answers.assets,
  );
  assert.equal(
    (await api.tool("bob", "get_preferences", {})).status,
    "requires_preferences",
  );
  await repo.transact("alice", async (s) =>
    assert.equal(s.portfolios.length, 0),
  );
  assert.equal(adapter.submitCount, 0);
});
for (const count of [1, 2, 3, 4])
  it(`generates an exact ${count}-trader plan from eleven Perps candidates with both markets allowed`, async () => {
    const { api, adapter } = env();
    const out = await api.tool("alice", "recommend_traders", {
      preferences: {
        ...pref,
        portfolio_kind: count === 1 ? "single" : "basket",
        basket_size: count,
      },
    });
    assert.equal(out.error, undefined);
    const plan: any = out.data.plan;
    assert.equal(plan.allocations.length, count);
    assert.equal(
      plan.allocations.reduce(
        (n: number, a: any) => n + Math.round(Number(a.amount_usdc) * 1e6),
        0,
      ),
      200e6,
    );
    assert.deepEqual((out.data.market_coverage as any).selected, ["perps"]);
    assert.equal(plan.preferences.risk_tolerance, "medium");
    assert.equal(plan.preferences.loss_trigger_pct, 10);
    assert.equal(adapter.submitCount, 0);
  });
it("filters candidates for the target allocation before choosing, so an expensive first trader cannot block a feasible four-person basket", () => {
  const rows = Array.from({ length: 11 }, (_, i) => ({
    ...candidate(i + 1),
    min_notional_usdc: i === 0 ? "150" : "10",
  }));
  const plan = recommend(pref, rows);
  assert.equal(plan.allocations.length, 4);
  assert(!plan.allocations.some((a) => a.trader.id === rows[0].id));
});
it("keeps two candidates visible and offers exact feasible counts instead of silently shrinking a four-person request", async () => {
  const { api, adapter } = env();
  adapter.pool = adapter.pool.slice(0, 2);
  const out = await api.tool("alice", "recommend_traders", {
    preferences: pref,
  });
  assert.equal(out.data.plan, null);
  assert.equal((out.data.candidates as any[]).length, 2);
  const d: any = out.data.recommendation_diagnostics;
  assert.equal(d.requested_basket_size, 4);
  assert.equal(d.blocker, "eligible_trader_supply");
  assert.deepEqual(d.feasible_basket_sizes, [1, 2]);
  assert.match(out.error!.message, /4-trader/);
  assert(!out.error!.message.includes("three-trader"));
  for (const a of d.adjustments) {
    assert.equal(a.preferences.budget_usdc, "200");
    assert.equal(a.preferences.risk_tolerance, "medium");
    assert.equal(a.preferences.loss_trigger_pct, 10);
  }
});
it("uses one sequential asset/risk/budget pipeline and reports concrete exclusions without recommending more risk", () => {
  const rows = [
    ...Array.from({ length: 11 }, (_, i) => ({
      ...candidate(i + 1),
      asset_category: i % 3 === 0 ? ("rwa" as const) : ("crypto" as const),
    })),
    { ...candidate(12), source_drawdown_pct: null },
    { ...candidate(13), execution_supported: false },
    { ...candidate(14), expires_at: 0 },
  ];
  const d = recommendationDiagnostics(pref, rows);
  const counts = [
    d.source_candidates,
    d.market_candidates,
    d.fresh_candidates,
    d.qualified_candidates,
    d.asset_matching_candidates,
    d.eligible_candidates,
    d.budget_eligible_candidates,
  ];
  assert(counts.every((x, i) => i === 0 || x <= counts[i - 1]));
  assert.equal(d.eligible_candidates, 11);
  assert.equal(d.asset_matching_candidates, 13);
  assert(d.rules.some((r) => r.rule === "missing_risk_data"));
  assert(d.rules.some((r) => r.rule === "execution_unsupported"));
  assert(d.rules.some((r) => r.rule === "stale_score"));
  const restricted = { ...pref, asset_category: "crypto" as const };
  assert(
    eligibleCandidates(restricted, rows).every(
      (c) => c.asset_category === "crypto",
    ),
  );
  const symbols = { ...pref, assets: ["BTC"], allow_altcoins: false };
  assert.equal(assetAllowed(symbols, "SOL", "crypto"), false);
  assert.equal(assetAllowed(symbols, "BTC", "crypto"), true);
  assert.equal(assetAllowed(symbols, "SOL", "crypto", 1), true); // Approved legacy any-asset plans keep their semantics.
});
it("keeps new all-asset RWA plans subject to collateral checks at the actual selected DEX", async () => {
  const { api, adapter } = env();
  const rwa = {
    ...candidate(1),
    asset_category: "rwa" as const,
    assets: ["xyz:TSLA"],
    asset_categories: { "xyz:TSLA": "rwa" as const },
  };
  adapter.pool = [rwa];
  const out = await api.tool("alice", "recommend_traders", {
    preferences: { ...pref, portfolio_kind: "single", basket_size: 1 },
  });
  adapter.snap.available_by_scope = { core: "500", xyz: "0" };
  await assert.rejects(
    api.tool("alice", "start_copy", { plan_id: (out.data.plan as any).id }),
    /each selected DEX/,
  );
  assert.equal(adapter.submitCount, 0);
});

it("preserves approved legacy any-asset semantics while a refreshed plan uses canonical unrestricted assets", async () => {
  const { api, repo, adapter } = env();
  adapter.pool = [{ ...candidate(1), assets: ["SOL"] }];
  const legacy = recommend(
    { ...pref, portfolio_kind: "single", basket_size: 1 },
    adapter.pool,
  );
  delete legacy.asset_filter_version;
  legacy.preferences = {
    ...legacy.preferences,
    assets: ["BTC", "ETH"],
    allow_altcoins: false,
  };
  const before = fingerprint(legacy);
  await repo.transact("legacy", async (s) => {
    s.plans.push(legacy);
  });
  const fresh = await api.tool("legacy", "recalculate_plan", {
    plan_id: legacy.id,
  });
  assert.equal((fresh.data.plan as any).asset_filter_version, 2);
  assert.deepEqual((fresh.data.plan as any).preferences.assets, []);
  await repo.transact("legacy", async (s) => {
    assert.equal(fingerprint(s.plans[0]), before);
    assert.equal(s.portfolios.length, 0);
  });
  assert.equal(
    assetAllowed(
      { ...pref, assets: ["XYZ:tsla"], allow_altcoins: false },
      "xyz:TSLA",
      "rwa",
    ),
    true,
  );
});
