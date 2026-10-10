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
it("uses mainnet source fills even for testnet followers and strips upstream identities", async () => {
  const bridge = new CoreBridge(
      "https://core.test",
      "fixture",
      "postgresql://localhost/unused",
      "s".repeat(32),
      "testnet",
    ),
    stub = bridge as any;
  const at = now() - 1000,
    address = "0x" + "a".repeat(40);
  let sourceNetwork = false;
  stub.resolve = async () => ({ address });
  stub.info = async (_payload: any, source: boolean) => {
    sourceNetwork = source;
    return [
      {
        tid: 1,
        oid: 2,
        time: at,
        coin: "BTC",
        sz: "1",
        side: "B",
        px: "100",
        fee: "0.1",
        feeToken: "USDC",
        closedPnl: "2",
        wallet: address,
      },
    ];
  };
  try {
    const result = (await bridge.operation("source_fills", {
      trader_id: candidate(1).id,
      market: "perps",
      start_at: at - 1,
      end_at: at + 1,
    })) as any;
    assert.equal(sourceNetwork, true);
    assert.equal(result.complete, true);
    assert.equal(result.fills[0].realized_usdc, "2");
    assert(!JSON.stringify(result).includes(address));
    const prediction = (await bridge.operation("source_fills", {
      trader_id: "prediction_test",
      market: "prediction",
      start_at: at - 1,
      end_at: at + 1,
    })) as any;
    assert.equal(prediction.complete, false);
    stub.core = async () => [];
    await assert.rejects(
      bridge.notify("alice", {
        id: "update_test",
        kind: "daily_digest",
        message: "test",
        portfolio_id: null,
      }),
      /No Ride App device/,
    );
  } finally {
    await bridge.close();
  }
});
