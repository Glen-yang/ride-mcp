import { it } from "node:test";
import assert from "node:assert/strict";
import { backendApp } from "./backend.js";
import { mountAgentProxy } from "./http.js";
import { AgentService } from "./service.js";
import { Cursor, MemoryRepository } from "./repository.js";
import { FakeAdapter } from "./fixtures.js";
import { AgentError } from "./contracts.js";
import { BridgeAdapter } from "./adapter.js";
import { mountHumanConfirmation } from "./human.js";
import express from "express";
import { once } from "node:events";

it("production read-only gateway retains CLI queries and rejects writes at both HTTP layers", async () => {
  const service = new AgentService(
    new MemoryRepository(),
    new FakeAdapter(),
    "https://example.test",
    new Cursor("x".repeat(32)),
  );
  const backend = backendApp(
    service,
    async () => "alice",
    "127.0.0.1",
    true,
  ).listen(0, "127.0.0.1");
  await once(backend, "listening");
  const b = backend.address();
  assert(b && typeof b !== "string");
  const app = express();
  app.use(express.json());
  mountAgentProxy(
    app,
    (req, _res, next) => {
      req.auth = {
        token: "opaque",
        clientId: "test",
        scopes: ["ride:read", "ride:trade"],
        extra: { rideAuthToken: "core-alice" },
      };
      next();
    },
    `http://127.0.0.1:${b.port}`,
    true,
  );
  const gateway = app.listen(0, "127.0.0.1");
  await once(gateway, "listening");
  const g = gateway.address();
  assert(g && typeof g !== "string");
  const post = (port: number, path: string) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer core-alice",
      },
      body: "{}",
    });
  try {
    for (const port of [g.port, b.port]) {
      assert.equal((await post(port, "/agent/v1/get_portfolio")).status, 200);
      for (const operation of [
        "set_preferences",
        "recalculate_plan",
        "set_notification_preferences",
        "start_copy",
        "update_copy",
        "stop_copy",
        "close_position",
        "proposal",
      ]) {
        const result = await post(port, `/agent/v1/${operation}`);
        assert.equal(result.status, 403, operation);
        assert.equal((await result.json()).error.code, "READ_ONLY");
      }
    }
    for (const operation of ["confirm", "authorize", "revoke", "reject"]) {
      assert.equal(
        (await post(b.port, `/agent/human/${operation}`)).status,
        403,
      );
    }
  } finally {
    gateway.close();
    backend.close();
  }
});

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
  assert.doesNotThrow(
    () => new BridgeAdapter(url, "secret", "agent-bridge.railway.internal"),
  );
  for (const rejected of [
    "http://other.railway.internal:3355",
    "http://agent-bridge.railway.internal.evil.test",
    "http://user:secret@agent-bridge.railway.internal:3355",
  ]) {
    assert.throws(
      () =>
        new BridgeAdapter(rejected, "secret", "agent-bridge.railway.internal"),
    );
  }
});

it("public human gateway accepts native Core JWTs while preserving browser CSRF and rejecting MCP tokens", async () => {
  const service = new AgentService(
    new MemoryRepository(),
    new FakeAdapter(),
    "https://example.test",
    new Cursor("x".repeat(32)),
  );
  const backend = backendApp(service, async (token) => {
    if (token !== "core-alice")
      throw new AgentError("AUTH_REQUIRED", "invalid", false, 401);
    return "alice";
  }).listen(0, "127.0.0.1");
  await once(backend, "listening");
  const b = backend.address();
  assert(b && typeof b !== "string");
  const app = express();
  app.use(express.json());
  mountHumanConfirmation(app, {
    backend: `http://127.0.0.1:${b.port}`,
    base: "https://example.test",
    cookieKey: "k".repeat(32),
    auth: {
      privyAppId: "test",
      privyClientId: "",
      jsSdkUrl: "https://example.test/sdk.js",
      manualTokenAuthEnabled: false,
    },
    exchange: async () => {
      throw Error("unused");
    },
  });
  const gateway = app.listen(0, "127.0.0.1");
  await once(gateway, "listening");
  const g = gateway.address();
  assert(g && typeof g !== "string");
  try {
    for (const [token, status] of [
      ["core-alice", 200],
      ["ride_at_machine", 401],
      [null, 403],
    ] as const) {
      const r: Response = await fetch(
        `http://127.0.0.1:${g.port}/agent/human/revoke`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: "{}",
        },
      );
      assert.equal(r.status, status);
    }
  } finally {
    gateway.close();
    backend.close();
  }
});
