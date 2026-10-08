#!/usr/bin/env node
import { startCoreBridge } from "./agent/core_bridge.js";
startCoreBridge().catch(() => {
  console.error("Private Ride execution adapter startup failed.");
  process.exitCode = 1;
});
