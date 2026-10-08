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
const abi = new Interface([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
  "event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value)",
]);
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
