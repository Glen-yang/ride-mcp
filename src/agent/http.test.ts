import { it } from "node:test";
import assert from "node:assert/strict";
import { backendApp } from "./backend.js";
import { mountAgentProxy } from "./http.js";
import { AgentService } from "./service.js";
import { Cursor, MemoryRepository } from "./repository.js";
import { FakeAdapter } from "./fixtures.js";
import { AgentError } from "./contracts.js";
import { BridgeAdapter } from "./adapter.js";
import express from "express";
import { once } from "node:events";

it("public machine proxy has no approval or grant operation", async () => {
  const app = express();
  app.use(express.json());
  mountAgentProxy(
    app,
    (_req, res, next) => {
      next();
    },
    "http://127.0.0.1:1",
  );
  const listener = app.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const address = listener.address();
  assert(address && typeof address !== "string");
  try {
    for (const name of ["confirm", "authorize", "revoke", "login"]) {
      const r: Response = await fetch(
        `http://127.0.0.1:${address.port}/agent/v1/${name}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      assert.equal(r.status, 404);
    }
  } finally {
    listener.close();
  }
});
it("native human route validates Core identity and cannot accept MCP tokens", async () => {
  const service = new AgentService(
    new MemoryRepository(),
    new FakeAdapter(),
    "https://example.test",
    new Cursor("x".repeat(32)),
  );
  const app = backendApp(service, async (token) => {
    if (token !== "core-alice")
      throw new AgentError("AUTH_REQUIRED", "invalid", false, 401);
    return "alice";
  });
  const listener = app.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const address = listener.address();
  assert(address && typeof address !== "string");
  try {
    for (const token of ["opaque-mcp", "core-alice"]) {
      const r: Response = await fetch(
        `http://127.0.0.1:${address.port}/agent/human/revoke`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: "{}",
        },
      );
      assert.equal(r.status, token === "core-alice" ? 200 : 401);
    }
  } finally {
    listener.close();
  }
});

it("private HTTP execution requires an exact explicitly configured Railway host", () => {
  const url = "http://agent-bridge.railway.internal:3355";
  assert.throws(() => new BridgeAdapter(url, "secret"));
  assert.doesNotThrow(() => new BridgeAdapter(url, "secret", "agent-bridge.railway.internal"));
  for (const rejected of ["http://other.railway.internal:3355", "http://agent-bridge.railway.internal.evil.test", "http://user:secret@agent-bridge.railway.internal:3355"]) {
    assert.throws(() => new BridgeAdapter(rejected, "secret", "agent-bridge.railway.internal"));
  }
});
