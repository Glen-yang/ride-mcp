import { it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { id as eventId } from "ethers";
import { DepositReads, type Deposit } from "./deposits.js";
import { now, uid } from "./domain.js";
it("separates wallet receipt, account activation, contract receipt and verified trading credit", async () => {
  const owner = "0x" + "5".repeat(40),
    bridge = "0x2df1c51e09aecf9cacb7bc98cb1742757f163df7",
    tx = "0x" + "a".repeat(64);
  let receipt: any = null,
    active = false,
    trading = "0",
    incomplete = false;
  const app = express();
  app.use(express.json());
  app.post("/", (req, res) => {
    const answer = (m: any) => ({
      jsonrpc: "2.0",
      id: m.id,
      result:
        m.method === "eth_chainId"
          ? "0xa4b1"
          : m.method === "eth_getTransactionReceipt"
            ? receipt
            : "0x" + 10000000n.toString(16).padStart(64, "0"),
    });
    res.json(Array.isArray(req.body) ? req.body.map(answer) : answer(req.body));
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  const before = process.env.RIDE_AGENT_ARBITRUM_RPC_URL;
  process.env.RIDE_AGENT_ARBITRUM_RPC_URL = url;
  const request: typeof fetch = async (input, init) =>
    String(input).includes("hyperliquid.xyz")
      ? new Response(
          JSON.stringify(
            incomplete
              ? {}
              : {
                  withdrawable: trading,
                  marginSummary: { accountValue: trading },
                  assetPositions: [],
                },
          ),
          { status: 200 },
        )
      : fetch(input, init);
  const reads = new DepositReads(
    async () => ({
      master: owner,
      status: active ? "active" : "approval_required",
    }),
    "mainnet",
    request,
  );
  const d: Deposit = {
    id: uid("deposit"),
    market: "perps",
    asset: "USDC",
    network: "Arbitrum",
    address: owner,
    provider: "wallet",
    created_at: now(),
    baseline_wallet_usdc: "0",
    funding: {
      id: uid("funding"),
      amount_usdc: "10",
      created_at: now(),
      expires_at: now() + 300000,
      preview_hash: "b".repeat(64),
      status: "submitted",
      transaction_hash: tx,
      quote: { baseline_trading_available_usdc: "0" },
    },
  };
  try {
    const wallet = await reads.status(d, "alice");
    assert.equal(wallet.status, "wallet_balance_increased");
    assert.equal(wallet.available_to_copy, false);
    assert.equal(wallet.funding_credit_verified, false);
    trading = "10";
    const activation = await reads.status(d, "alice");
    assert.equal(activation.status, "activation_required");
    assert.equal(activation.available_to_copy, false);
    active = true;
    const pending = await reads.status(d, "alice");
    assert.equal(pending.available_to_copy, true);
    assert.equal(pending.funding_credit_verified, false);
    receipt = { transactionHash: tx, to: bridge, status: "0x1", logs: [] };
    assert.equal(
      (await reads.status(d, "alice")).funding_credit_verified,
      false,
    );
    receipt.logs = [
      {
        address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
        topics: [
          eventId("Transfer(address,address,uint256)"),
          "0x" + owner.slice(2).padStart(64, "0"),
          "0x" + bridge.slice(2).padStart(64, "0"),
        ],
        data: "0x" + 10000000n.toString(16).padStart(64, "0"),
      },
    ];
    const credit = await reads.status(d, "alice");
    assert.equal(credit.funding_receipt, "confirmed");
    assert.equal(credit.funding_credit_verified, true);
    assert.equal(credit.trading_balance_usdc, "10.000000");
    incomplete = true;
    await assert.rejects(reads.status(d, "alice"), /incomplete/);
  } finally {
    if (before == null) delete process.env.RIDE_AGENT_ARBITRUM_RPC_URL;
    else process.env.RIDE_AGENT_ARBITRUM_RPC_URL = before;
    await new Promise<void>((r) => server.close(() => r()));
  }
});
