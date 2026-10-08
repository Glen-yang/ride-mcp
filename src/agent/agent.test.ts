import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  D,
  allocate,
  aggregate,
  risk,
  recommend,
  pnl,
  now,
  uid,
  type Candidate,
  type AccountSnapshot,
  type Portfolio,
} from "./domain.js";
import { MemoryRepository, Cursor } from "./repository.js";
import { AgentService, fromPlan } from "./service.js";
import { AgentRunner } from "./runner.js";
import {
  internalCross,
  applyFill,
  applyFunding,
  reconcileQuantities,
} from "./ledger.js";
import type { VenueAdapter } from "./adapter.js";
import { inputs, publicResult, result } from "./contracts.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerAgentTools } from "./mcp.js";

import { candidate, snapshot, FakeAdapter } from "./fixtures.js";
function service() {
  const repository = new MemoryRepository(),
    adapter = new FakeAdapter();
  return {
    repository,
    adapter,
    api: new AgentService(
      repository,
      adapter,
      "https://mcp.example",
      new Cursor("c".repeat(32)),
    ),
  };
}
const pref = {
  budget_usdc: "500",
  loss_trigger_pct: 20,
  market: "perps" as const,
  assets: ["BTC", "ETH"],
  allow_altcoins: false,
};
async function proposed() {
  const env = service();
  await env.api.tool("alice", "set_preferences", pref);
  const r = await env.api.tool("alice", "recommend_traders", {});
  const p = await env.api.tool("alice", "start_copy", {
    plan_id: (r.data.plan as any).id,
  });
  return { ...env, proposal: p.data.proposal as any };
}

describe("financial invariants", () => {
  it("conserves every micro-USDC and rejects imprecise inputs", () => {
    const pieces = allocate("999.999999", 6);
    assert.equal(
      pieces.reduce((n, x) => n.plus(x), D(0)).toFixed(6),
      "999.999999",
    );
    assert.throws(() =>
      inputs.set_preferences.parse({ ...pref, budget_usdc: "0.0000001" }),
    );
  });
  it("refuses stale, small and single-market candidates for both markets", () => {
    assert.throws(() =>
      recommend({ ...pref, budget_usdc: "20" }, [1, 2, 3].map(candidate)),
    );
    assert.throws(() =>
      recommend({ ...pref, market: "both" }, [1, 2, 3, 4].map(candidate)),
    );
    assert.throws(() =>
      recommend(
        pref,
        [1, 2, 3, 4].map((i) => ({ ...candidate(i), expires_at: 0 })),
      ),
    );
  });
  it("checks gross concentration even when longs and shorts net to zero", () => {
    const p = fromPlan(recommend(pref, [1, 2, 3, 4].map(candidate)));
    p.sleeves.forEach((s, i) => {
      const key = i < 3 ? "perps:BTC" : "perps:ETH";
      s.intents[key] = {
        key,
        asset: i < 3 ? "BTC" : "ETH",
        market: "perps",
        quantity: i === 1 ? "-1" : "1",
        price: "100",
        source_entry_price: "100",
        source_leverage: 5,
        source_revision: "v1",
        observed_at: now(),
      };
    });
    assert.equal(
      aggregate(p, snapshot().prices)[0].concentration_pct,
      "75.000000",
    );
    assert.throws(() => risk(p, snapshot().prices), /60%/);
  });
  it("does not net distinct prediction outcome tokens", () => {
    const p = fromPlan(recommend(pref, [1, 2, 3, 4].map(candidate)));
    p.sleeves.slice(0, 2).forEach((s, i) => {
      const key = `prediction:outcome_${i}`;
      s.intents[key] = {
        key,
        asset: "EVENT",
        market: "prediction",
        quantity: "10",
        price: "0.5",
        source_entry_price: "0.5",
        source_leverage: 1,
        source_revision: "v1",
        observed_at: now(),
      };
    });
    assert.equal(
      aggregate(p, {
        "prediction:outcome_0": ".5",
        "prediction:outcome_1": ".5",
      }).length,
      2,
    );
  });
  it("conserves internal crosses and attributes partial fills, fees and funding once", () => {
    const p = fromPlan(recommend(pref, [1, 2, 3, 4].map(candidate)));
    const key = "perps:BTC";
    for (const [i, q] of ["5", "-3"].entries()) {
      p.sleeves[i].intents[key] = {
        key,
        asset: "BTC",
        market: "perps",
        quantity: q,
        price: "100",
        source_entry_price: "100",
        source_leverage: 5,
        source_revision: "v1",
        observed_at: now(),
      };
    }
    const allocations = internalCross(p, key, "100");
    assert.equal(
      Object.values(allocations)
        .reduce((n, q) => n.plus(q), D(0))
        .toString(),
      "2",
    );
    p.executions.push({
      id: uid("execution"),
      key,
      target_quantity: "2",
      allocations,
      status: "submitted",
      revision: 0,
      fingerprint: "f",
      created_at: now(),
      expires_at: now() + 1000,
      task_id: "task_test",
      observed_quantity: null,
      reserve_usdc: "40",
      error: null,
    });
    const f = {
      id: "fill_1",
      order_id: "order_1",
      task_id: "task_test",
      key,
      quantity: "1",
      price: "100",
      fee_usdc: ".1",
      at: now(),
    };
    applyFill(p, f);
    applyFill(p, f);
    assert.equal(p.seen_fills.length, 1);
    applyFill(p, { ...f, id: "fill_2" });
    applyFunding(
      p,
      { id: "funding_1", key, amount_usdc: "-.2", at: now() },
      { [p.sleeves[0].copy_id]: "5", [p.sleeves[1].copy_id]: "-3" },
    );
    p.snapshot = {
      ...snapshot(),
      positions: { [key]: "2" },
      account_value_usdc: "499.6",
    };
    p.initial_equity = "500";
    p.reconciliation = "complete";
    assert.equal(reconcileQuantities(p), true);
    assert.equal(pnl(p).net_usdc, "-0.400000");
    assert.equal(
      pnl(p)
        .sleeves.reduce((n, s) => n.plus(s.net_usdc ?? 0), D(0))
        .toFixed(6),
      "-0.400000",
    );
  });
  it("shows incomplete account attribution as unavailable", () => {
    const p = fromPlan(recommend(pref, [1, 2, 3, 4].map(candidate)));
    p.snapshot = snapshot();
    p.initial_equity = "490";
    p.reconciliation = "complete";
    assert.equal(pnl(p).net_usdc, null);
  });
});
describe("approval and ownership", () => {
  it("creates one portfolio under eight concurrent confirmations", async () => {
    const { api, repository, proposal } = await proposed();
    assert.equal(proposal.status, "requires_confirmation");
    await Promise.all(
      Array.from({ length: 8 }, () =>
        api.confirm("alice", proposal.id, proposal.preview_hash),
      ),
    );
    await repository.transact("alice", async (s) => {
      assert.equal(s.portfolios.length, 1);
      assert.equal(s.portfolios[0].revision, 1);
      assert.equal(
        s.updates.filter((x) => x.kind === "proposal_confirmed").length,
        1,
      );
    });
  });
  it("rejects cross-user access, edited previews, expired proposals and changed balances", async () => {
    const { api, repository, adapter, proposal } = await proposed();
    await assert.rejects(api.proposal("bob", proposal.id), /not found/);
    await assert.rejects(
      api.confirm("alice", proposal.id, "f".repeat(64)),
      /displayed/,
    );
    adapter.snap.available_usdc = "499";
    await assert.rejects(
      api.confirm("alice", proposal.id, proposal.preview_hash),
      /Available funds/,
    );
    adapter.snap.available_usdc = "500";
    await repository.transact("alice", async (s) => {
      s.proposals[0].expires_at = 0;
    });
    await assert.rejects(
      api.confirm("alice", proposal.id, proposal.preview_hash),
      /fresh proposal/,
    );
  });
  it("binds cursors to users and rejects leaked addresses", () => {
    const cursor = new Cursor("x".repeat(32));
    const t = cursor.encode("alice", 5, "u");
    assert.deepEqual(cursor.decode("alice", t), { at: 5, id: "u" });
    assert.throws(() => cursor.decode("bob", t));
    assert.throws(() =>
      publicResult(result({ trader: "0x" + "a".repeat(40) })),
    );
  });
  it("never retries an unresolved submission under a new identifier", async () => {
    const { api, repository, adapter, proposal } = await proposed();
    await api.confirm("alice", proposal.id, proposal.preview_hash);
    adapter.unknown = true;
    const runner = new AgentRunner(api);
    await runner.tick("alice");
    await runner.tick("alice");
    assert.equal(adapter.submitCount, 0);
    /* Fully offset basket is settled internally. */ await repository.transact(
      "alice",
      async (s) => {
        for (const sleeve of s.portfolios[0].sleeves) {
          sleeve.trader.direction = "long";
          sleeve.source_revision = null;
        }
      },
    );
    adapter.sourceRevision = "source_v2";
    await runner.tick("alice");
    const count = adapter.submitCount;
    assert(count > 0);
    await runner.tick("alice");
    assert.equal(adapter.submitCount, count);
  });
});
it("exposes exactly ten serializable tools and a read-only directory subset", async () => {
  for (const readOnly of [false, true]) {
    const server = new McpServer({ name: "test", version: "1" });
    registerAgentTools(server, async () => result({}), readOnly);
    const client = new Client({ name: "test", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const tools = await client.listTools();
    assert.equal(tools.tools.length, readOnly ? 5 : 10);
    assert(tools.tools.every((t) => t.inputSchema.type === "object"));
    await client.close();
    await server.close();
  }
});
