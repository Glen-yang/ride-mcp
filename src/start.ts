#!/usr/bin/env node
// Keep service roles intact when a platform falls back to npm start.
const entrypoint = process.env.RIDE_SERVICE_ENTRYPOINT ?? "server";
switch (entrypoint) {
  case "server":
    await import("./server.js");
    break;
  case "backend":
    await import("./backend.js");
    break;
  case "bridge":
    await import("./bridge.js");
    break;
  default:
    console.error("RIDE_SERVICE_ENTRYPOINT must be server, backend or bridge.");
    process.exitCode = 1;
}
export {};
