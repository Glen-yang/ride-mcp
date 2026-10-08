import { now, type Candidate, type AccountSnapshot } from "./domain.js";
import type { VenueAdapter } from "./adapter.js";
export function candidate(i: number): Candidate {
  return {
    id: `trader_${String(i).padStart(12, "0")}`,
    handle: `Trader ${i}`,
    market: "perps",
    score: 90 - i,
    score_version: "strict_perp_v2_5_daily_live_v1",
    components: {
      stability: 90,
      pathSmoothness: 80,
      drawdownRecovery: 75,
      profitQuality: 70,
      profitConcentration: 70,
      positionLeverageStability: 80,
      copyability: 80,
      trackRecord: 90,
    },
    scored_at: now(),
    expires_at: now() + 86400_000,
    eligibility: "PASS",
    assets: i % 2 ? ["BTC"] : ["ETH"],
    style: i % 2 ? "trend" : "swing",
    direction: i < 3 ? "long" : "short",
    median_hold_hours: 48,
    source_roi_pct: 12,
    source_drawdown_pct: 8,
    atr_pct: 2,
    venue_max_leverage: 8,
    min_notional_usdc: "10",
    last_trade_at: now(),
  };
}
export function snapshot(): AccountSnapshot {
  return {
    account_id: "account_test0000000",
    observed_at: now(),
    account_value_usdc: "500",
    available_usdc: "500",
    dedicated: true,
    eligible: true,
    positions: {},
    prices: { "perps:BTC": "100", "perps:ETH": "100" },
    max_leverages: { "perps:BTC": 8, "perps:ETH": 8 },
    min_notionals: { "perps:BTC": "10", "perps:ETH": "10" },
    orders: [],
    fills: [],
    funding: [],
    flows: [],
    coverage_complete: true,
  };
}
export class FakeAdapter implements VenueAdapter {
  snap = snapshot();
  submitCount = 0;
  notifyCount = 0;
  unknown = false;
  fences = 0;
  sourceRevision = "source_v1";
  pool = [1, 2, 3, 4].map(candidate);
  async candidates() {
    return structuredClone(this.pool);
  }
  async profile(id: string) {
    const c = this.pool.find((c) => c.id === id);
    if (!c) throw Error("not found");
    return structuredClone(c);
  }
  async preflight() {
    return { ...structuredClone(this.snap), observed_at: now() };
  }
  async bind() {
    return this.preflight();
  }
  async account() {
    return this.preflight();
  }
  async source(c: Candidate) {
    const asset = c.assets[0],
      key = `perps:${asset}`;
    return {
      observed_at: now(),
      revision: this.sourceRevision,
      account_value_usdc: "1000",
      complete: true,
      positions: [
        {
          key,
          asset,
          market: "perps" as const,
          quantity: c.direction === "short" ? "-5" : "5",
          price: "100",
          source_entry_price: "100",
          source_leverage: 5,
          observed_at: now(),
          source_revision: this.sourceRevision,
        },
      ],
    };
  }
  async submit() {
    this.submitCount++;
    if (this.unknown) throw Error("response lost");
    return { task_id: `task_${this.submitCount}` };
  }
  async execution(): ReturnType<VenueAdapter["execution"]> {
    return {
      status: "uncertain" as const,
      observed_quantity: null,
      settled: false,
    };
  }
  async fence() {
    this.fences++;
  }
  releases = 0;
  async release() {
    this.releases++;
  }
  async cancelIncreasing() {}
  async notify() {
    this.notifyCount++;
  }
}
