import { it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AgentService, fromPlan } from "./service.js";
import { PgRepository, MemoryRepository, Cursor } from "./repository.js";
import { AgentRunner } from "./runner.js";
import { candidate, snapshot, FakeAdapter } from "./fixtures.js";
import { now, recommend, fingerprint, uid } from "./domain.js";
const pref = {
  budget_usdc: "500",
  loss_trigger_pct: 20,
  market: "perps" as const,
  assets: ["BTC", "ETH"],
  allow_altcoins: false,
};
it(
  "serializes real PostgreSQL confirmations and rolls back failed state transitions",
  { skip: !process.env.RIDE_AGENT_TEST_DATABASE_URL },
  async () => {
    const repo = new PgRepository(process.env.RIDE_AGENT_TEST_DATABASE_URL!);
    await repo.migrate();
    const user = randomUUID();
    const adapter = new FakeAdapter(),
      api = new AgentService(
        repo,
        adapter,
        "https://ride.test",
        new Cursor("k".repeat(32)),
      );
    try {
      await api.tool(user, "set_preferences", pref);
      const plan = (await api.tool(user, "recommend_traders", {})).data
        .plan as any;
      const q = (await api.tool(user, "start_copy", { plan_id: plan.id })).data
        .proposal as any;
      await Promise.all(
        Array.from({ length: 8 }, () =>
          api.confirm(user, q.id, q.preview_hash),
        ),
      );
      await repo.transact(user, async (s) => {
        assert.equal(s.portfolios.length, 1);
        assert.equal(s.portfolios[0].revision, 1);
      });
      await assert.rejects(
        repo.transact(user, async (s) => {
          s.portfolios = [];
          throw Error("transaction failed");
        }),
      );
      await repo.transact(user, async (s) =>
        assert.equal(s.portfolios.length, 1),
      );
    } finally {
      await repo.pool.query("DELETE FROM ride_agent_state WHERE user_id=$1", [
        user,
      ]);
      await repo.close();
    }
  },
);
it("persists flat loss targets before a fence failure and retries the fence", async () => {
  const repo = new MemoryRepository();
  class Adapter extends FakeAdapter {
    fail = true;
    override async fence() {
      this.fences++;
      if (this.fail) throw Error("Core offline");
    }
  }
  const adapter = new Adapter(),
    api = new AgentService(
      repo,
      adapter,
      "https://ride.test",
      new Cursor("k".repeat(32)),
    );
  const p = fromPlan(recommend(pref, [1, 2, 3, 4].map(candidate)));
  p.account_id = snapshot().account_id;
  p.initial_equity = "500";
  p.ledger_started_at = now() - 1000;
  p.state = "active";
  const s = p.sleeves[0],
    key = "perps:BTC";
  s.intents[key] = {
    key,
    asset: "BTC",
    market: "perps",
    quantity: "1",
    price: "100",
    source_entry_price: "100",
    source_leverage: 3,
    source_revision: "v",
    observed_at: now(),
  };
  s.lots[key] = {
    key,
    asset: "BTC",
    market: "perps",
    quantity: "0",
    cost: "0",
    realized: "-100",
    fees: "0",
    funding: "0",
  };
  adapter.snap.account_value_usdc = "400";
  await repo.transact("u", async (state) => {
    state.portfolios.push(p);
  });
  const runner = new AgentRunner(api);
  await runner.tick("u");
  await repo.transact("u", async (state) => {
    assert.equal(state.portfolios[0].loss_latched, true);
    assert.equal(state.portfolios[0].sleeves[0].intents[key].quantity, "0");
  });
  adapter.fail = false;
  await runner.tick("u");
  assert(adapter.fences >= 2);
});
it("recovers an uncertain accepted order even after its portfolio revision changes", async () => {
  const repo = new MemoryRepository();
  class Adapter extends FakeAdapter {
    override async execution() {
      return {
        status: "submitted" as const,
        task_id: "accepted_original",
        observed_quantity: null,
        settled: false,
      };
    }
  }
  const adapter = new Adapter(),
    api = new AgentService(
      repo,
      adapter,
      "https://ride.test",
      new Cursor("k".repeat(32)),
    );
  const p = fromPlan(recommend(pref, [1, 2, 3, 4].map(candidate)));
  p.account_id = snapshot().account_id;
  p.initial_equity = "500";
  p.ledger_started_at = now();
  p.state = "attention";
  p.revision = 2;
  const frozen = {
    id: uid("execution"),
    key: "perps:BTC",
    target_quantity: "1",
    allocations: {},
    revision: 1,
    created_at: now() - 1000,
    expires_at: now() - 1,
  };
  p.executions.push({
    ...frozen,
    fingerprint: fingerprint(frozen),
    status: "uncertain",
    task_id: null,
    observed_quantity: null,
    reserve_usdc: "33",
    error: null,
  });
  await repo.transact("u", async (s) => {
    s.portfolios.push(p);
  });
  await new AgentRunner(api).tick("u");
  await repo.transact("u", async (s) => {
    assert.equal(s.portfolios[0].executions[0].task_id, "accepted_original");
    assert.equal(s.portfolios[0].executions[0].status, "submitted");
  });
  assert.equal(adapter.submitCount, 0);
});
it("retries account release and reports closure only after release succeeds", async () => {
  const repo = new MemoryRepository();
  class Adapter extends FakeAdapter {
    fail = true;
    override async release() {
      this.releases++;
      if (this.fail) throw Error("Core unavailable");
    }
  }
  const adapter = new Adapter(),
    api = new AgentService(
      repo,
      adapter,
      "https://ride.test",
      new Cursor("k".repeat(32)),
    );
  const p = fromPlan(recommend(pref, [1, 2, 3, 4].map(candidate)));
  p.account_id = adapter.snap.account_id;
  p.initial_equity = "500";
  p.ledger_started_at = now();
  p.state = "active";
  p.sleeves.forEach((s) => (s.state = "closed"));
  await repo.transact("release", async (s) => {
    s.portfolios.push(p);
  });
  const runner = new AgentRunner(api);
  await runner.tick("release");
  await repo.transact("release", async (s) =>
    assert.notEqual(s.portfolios[0].state, "closed"),
  );
  adapter.fail = false;
  await runner.tick("release");
  await repo.transact("release", async (s) =>
    assert.equal(s.portfolios[0].state, "closed"),
  );
  assert.equal(adapter.releases, 2);
});
