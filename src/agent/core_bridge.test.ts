import { it } from "node:test";
import assert from "node:assert/strict";
import { CoreBridge } from "./core_bridge.js";
import { candidate } from "./fixtures.js";
import { now } from "./domain.js";

it("reads the real scheduler tradeMetrics timestamp and keeps missing or future activity unavailable", async () => {
  const bridge = new CoreBridge(
    "https://core.test",
    "fixture",
    "postgresql://localhost/unused",
    "s".repeat(32),
    "testnet",
  );
  const c = candidate(1),
    at = now() - 8 * 86400_000;
  const row: any = {
    score: c.score,
    score_version: c.score_version,
    computed_at: now(),
    expires_at: now() + 86400_000,
    eligibility: "PASS",
    tags: [],
    roi_ratio: 0.1,
    drawdown_ratio: 0.02,
    raw: "",
  };
  const stub = bridge as any;
  stub.resolve = async () => row;
  stub.source = async () => ({ positions: [] });
  stub.info = async () => [];
  try {
    for (const [timestamp, expected] of [
      [at, at],
      [null, null],
      [now() + 60000, null],
    ] as const) {
      row.raw = JSON.stringify({
        copyScoreV2_5: { components: c.components },
        dailyRescore: { computedAt: now() },
        tradeMetrics: { status: "available", newestFillTime: timestamp },
      });
      assert.equal((await bridge.profile(c.id)).last_trade_at, expected);
    }
    row.raw = JSON.stringify({
      tradeMetrics: { status: "unavailable", newestFillTime: at },
    });
    assert.equal((await bridge.profile(c.id)).last_trade_at, null);
  } finally {
    await bridge.close();
  }
});
