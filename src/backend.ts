#!/usr/bin/env node
import { startBackend } from "./agent/backend.js";
startBackend().catch(() => {
  console.error(
    "Ride Agent startup failed. Verify backend dependency configuration.",
  );
  process.exitCode = 1;
});
