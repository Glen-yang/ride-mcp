import assert from "node:assert/strict";
import { it } from "node:test";
import {
  accountCopiesInput,
  invokeAccountRead,
  readAccountCopies,
} from "./account_reads.js";
import { publicResult, result } from "./agent/contracts.js";

const address = "0x" + "a".repeat(40);
function fixtureFetch(failEmbedded = false): typeof fetch {
  return (async (_url, init) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer fixture-session");
    const body = JSON.parse(String(init?.body));
    assert(!body.query.includes("mutation"));
    assert(!("user_id" in body.variables));
    if (body.query.includes("RideAppCopies"))
      return Response.json({
        data: {
          me: { id: "account-alice", username: "Alice" },
          myCopyTradeConfigs: [
            {
              id: "prediction-config",
              traderAddress: address,
              isEnabled: true,
            },
          ],
          copyTradeSummary: {
            totalConfigs: 1,
            enabledConfigs: 1,
            totalOpenPositions: 1,
          },
          positions0: { positions: [], hasNextPage: false },
          positions1: {
            positions: [
              {
                id: "prediction-position",
                status: "OPEN",
                traderAddress: address,
              },
            ],
            hasNextPage: false,
          },
          positions2: { positions: [], hasNextPage: false },
          positions3: { positions: [], hasNextPage: false },
        },
      });
    const embedded = headers.get("x-hyperliquid-wallet-mode") === "embedded-v1";
    if (embedded && failEmbedded)
      return Response.json(
        { errors: [{ message: "Unavailable" }] },
        { status: 503 },
      );
    return Response.json({
      data: {
        myPerpsAutoRideConfigs: [
          {
            id: embedded ? "embedded-config" : "legacy-config",
            traderAddress: address,
          },
        ],
        myPerpsAutoRidePositions: [
          {
            id: "retained-position",
            traderAddress: address,
            status: "open",
            coin: "BTC",
            size: "0.1",
          },
          {
            id: "closed-position",
            traderAddress: address,
            status: "closed",
            coin: "ETH",
            size: "0",
          },
        ],
      },
    });
  }) as typeof fetch;
}

it("reads both App wallet generations, deduplicates retained positions and confirms account identity", async () => {
  const value = publicResult(
    await readAccountCopies(
      "https://core.test/graphql",
      "fixture-session",
      {},
      fixtureFetch(),
    ),
  );
  assert.equal(value.status, "ok");
  assert.deepEqual(value.data.account, {
    authenticated: true,
    user_id: "account-alice",
    display_name: "Alice",
  });
  const perps = value.data.perps as any;
  assert.equal(perps.configs.length, 2);
  assert.equal(perps.positions.length, 1);
  assert.equal(perps.positions[0].coin, "BTC");
  assert(!JSON.stringify(value).includes(address));
  assert.equal(value.data.coverage_complete, true);
});

it("reports unavailable wallet reads as partial coverage instead of an empty account", async () => {
  const value = await readAccountCopies(
    "https://core.test/graphql",
    "fixture-session",
    {},
    fixtureFetch(true),
  );
  assert.equal(value.status, "stale");
  assert.equal(value.data.coverage_complete, false);
  assert.equal((value.data.account as any).authenticated, true);
  assert.equal((value.data.perps as any).configs.length, 1);
});

it("never accepts a caller-supplied account identity or turns an account failure into logged-out state", async () => {
  assert.throws(() => accountCopiesInput.parse({ user_id: "other-account" }));
  const failed = (async () =>
    Response.json({ errors: [{}] }, { status: 503 })) as typeof fetch;
  await assert.rejects(
    readAccountCopies(
      "https://core.test/graphql",
      "fixture-session",
      {},
      failed,
    ),
    /could not be verified/,
  );
  const value = await invokeAccountRead(
    "get_portfolio",
    {},
    "fixture-session",
    "https://core.test/graphql",
    async () => result({ portfolio: null }, "empty"),
    failed,
  );
  assert.equal(value.status, "stale");
  assert.deepEqual(value.data.account, { authenticated: true });
  assert.equal(value.data.agent_portfolio_status, "empty");
});

it("shows existing App holdings even when the Agent has only an empty portfolio", async () => {
  const value = await invokeAccountRead(
    "get_portfolio",
    {},
    "fixture-session",
    "https://core.test/graphql",
    async () => result({ portfolio: null }, "empty"),
    fixtureFetch(),
  );
  assert.equal(value.status, "stale"); // Copy inventory is complete; balance APIs are absent from this fixture.
  assert.equal(value.data.portfolio, null);
  assert.equal(value.data.agent_portfolio_status, "empty");
  assert.equal((value.data.account as any).authenticated, true);
  assert.equal((value.data.app_copies as any).perps.positions.length, 1);
});

it("keeps authoritative execution states even when account balance coverage is partial", async () => {
  for (const status of [
    "uncertain",
    "partially_filled",
    "executing",
    "settling",
  ] as const) {
    const value = await invokeAccountRead(
      "get_portfolio",
      {},
      "fixture-session",
      "https://core.test/graphql",
      async () => result({ portfolio: { id: "owned" } }, status),
      fixtureFetch(),
    );
    assert.equal(value.status, status);
    assert.equal(value.data.agent_portfolio_status, status);
    assert.equal(value.data.account_coverage_status, "partial");
    assert.equal(
      (value.data.account_balances as any).summary.account_value_usd,
      null,
    );
  }
});
