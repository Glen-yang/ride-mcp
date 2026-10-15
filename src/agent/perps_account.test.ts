import { it } from "node:test";
import assert from "node:assert/strict";
import { perpsAccountMode, unifiedUsdc } from "./perps_account.js";

it("counts unified USDC once and deducts all spot holds", () => {
  assert.deepEqual(
    unifiedUsdc({
      balances: [
        { coin: "USDC", token: 0, total: "36.302807", hold: "6.1" },
        { coin: "HYPE", token: 150, total: "9999", hold: "0" },
      ],
    }),
    { equity: "36.302807", available: "30.202807" },
  );
  assert.equal(
    perpsAccountMode({ response: { abstraction: "unifiedAccount" } }),
    "unified",
  );
  assert.equal(perpsAccountMode("disabled"), "standard");
  assert.equal(perpsAccountMode("portfolioMargin"), "unsupported");
  assert.equal(perpsAccountMode({}), "unsupported");
});

it("refuses missing, duplicate, negative, nonfinite and inconsistent unified balances", () => {
  const row = { coin: "USDC", token: 0, total: "36.302807", hold: "0" };
  for (const balances of [
    undefined,
    [],
    [row, row],
    [{ ...row, token: 1 }],
    [{ ...row, total: "NaN" }],
    [{ ...row, total: "Infinity" }],
    [{ ...row, total: "-1" }],
    [{ ...row, hold: "-1" }],
    [{ ...row, hold: "40" }],
    [{ ...row, hold: undefined }],
  ]) {
    assert.throws(() => unifiedUsdc({ balances }), /could not be verified/);
  }
});
