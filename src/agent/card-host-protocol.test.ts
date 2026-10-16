import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import vm from "node:vm";

function fixture() {
  const listeners = new Set<(event: any) => void>();
  const sent: any[] = [];
  const timers = new Map<number, () => void>();
  let timerId = 0;
  let height = 260;
  let resized: (() => void) | undefined;
  const root = { querySelector: () => null, prepend() {} };
  const parent = { postMessage: (message: any) => sent.push(message) };
  vm.runInNewContext(readFileSync("public/agent-host.js", "utf8"), {
    document: {
      getElementById: () => root,
      body: { getBoundingClientRect: () => ({ width: 480, height }) },
    },
    window: {
      parent,
      addEventListener(name: string, listener: any) {
        if (name === "message") listeners.add(listener);
      },
    },
    ResizeObserver: class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe() {}
      disconnect() {
        resized = undefined;
      }
    },
    setTimeout(callback: () => void) {
      timers.set(++timerId, callback);
      return timerId;
    },
    clearTimeout(id: number) {
      timers.delete(id);
    },
    el: () => ({}),
    render() {},
  });
  const receive = (data: any, source: any = parent) => {
    for (const listener of listeners) listener({ source, data });
  };
  return {
    sent,
    timers,
    receive,
    initialize() {
      receive({
        jsonrpc: "2.0",
        id: 1,
        result: {
          protocolVersion: "2026-01-26",
          hostCapabilities: {},
          hostInfo: { name: "test-host", version: "1" },
        },
      });
    },
    resize() {
      height = 440;
      resized?.();
    },
  };
}

it("host ping with the same id cannot resolve the app's pending initialization", async () => {
  const f = fixture();
  f.receive({ jsonrpc: "2.0", id: 1, method: "ping" });
  await Promise.resolve();
  assert.equal(
    f.timers.size,
    1,
    "only a response may clear the initialize request",
  );
  assert(f.sent.some((m) => m.id === 1 && !m.method && m.result));
  assert(!f.sent.some((m) => m.method === "ui/notifications/initialized"));
  f.initialize();
  await Promise.resolve();
  assert(f.sent.some((m) => m.method === "ui/notifications/initialized"));
});

it("health checks and teardown are answered only for the parent, including id zero", async () => {
  const f = fixture();
  f.initialize();
  await Promise.resolve();
  const before = f.sent.length;
  f.receive({ jsonrpc: "2.0", id: 0, method: "ping" }, {});
  assert.equal(f.sent.length, before);
  f.receive({ jsonrpc: "2.0", id: 0, method: "ping" });
  assert(f.sent.some((m) => m.id === 0 && m.result));
  f.receive({ jsonrpc: "2.0", id: "teardown", method: "ui/resource-teardown" });
  assert(f.sent.some((m) => m.id === "teardown" && m.result));
});

it("the host receives the card height after initialization and layout changes", async () => {
  const f = fixture();
  assert(!f.sent.some((m) => m.method === "ui/notifications/size-changed"));
  f.initialize();
  await Promise.resolve();
  assert(
    f.sent.some(
      (m) =>
        m.method === "ui/notifications/size-changed" && m.params.height === 260,
    ),
  );
  f.resize();
  assert(
    f.sent.some(
      (m) =>
        m.method === "ui/notifications/size-changed" && m.params.height === 440,
    ),
  );
});
