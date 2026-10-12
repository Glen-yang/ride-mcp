import { it } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { backendApp } from "./backend.js";
import { AgentService } from "./service.js";
import { MemoryRepository, Cursor } from "./repository.js";
import { FakeAdapter } from "./fixtures.js";
import { AgentError } from "./contracts.js";

it("report reads require Core authentication, preserve frozen data and hide another account's reports", async () => {
  const repository = new MemoryRepository();
  const event = {
    id: "update_report_test",
    at: 1,
    kind: "daily_digest",
    portfolio_id: null,
    message: "TEST report",
    data: { performance: { coverage: "incomplete", net_profit_usdc: null } },
    notification: "pending" as const,
    notification_attempts: 3,
    notification_error: "private provider diagnostic",
    next_notification_at: 2000,
  };
  await repository.transact("alice", async (s) => {
    s.updates.push(event);
  });
  const service = new AgentService(
    repository,
    new FakeAdapter(),
    "https://ride.test",
    new Cursor("x".repeat(32)),
  );
  const listener = backendApp(
    service,
    async (token) => {
      if (!["core-alice", "core-bob"].includes(token))
        throw new AgentError("AUTH_REQUIRED", "invalid", false, 401);
      return token.slice(5);
    },
    "127.0.0.1",
    true,
  ).listen(0, "127.0.0.1");
  await once(listener, "listening");
  const address = listener.address();
  assert(address && typeof address !== "string");
  try {
    const read = async (token: string, event_id: string, extra = {}) =>
      fetch(`http://127.0.0.1:${address.port}/agent/human/update`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ event_id, ...extra }),
      });
    assert.equal((await read("opaque-mcp", event.id)).status, 401);
    for (const id of [event.id, "update_missing"]) {
      const response = await read("core-bob", id);
      assert.equal(response.status, 404);
      assert.equal((await response.json()).error.code, "NOT_FOUND");
    }
    assert.equal((await read("core-alice", "../secrets")).status, 400);
    assert.equal(
      (await read("core-alice", event.id, { user_id: "bob" })).status,
      400,
    );
    const response = await read("core-alice", event.id);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.data.update.data, event.data);
    for (const key of [
      "notification",
      "notification_error",
      "notification_attempts",
      "next_notification_at",
    ])
      assert(!Object.hasOwn(body.data.update, key));
    await repository.transact("alice", async (s) =>
      assert.deepEqual(s.updates, [event]),
    );
  } finally {
    listener.close();
  }
});
