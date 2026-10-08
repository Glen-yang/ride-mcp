#!/usr/bin/env node
import { runCli } from "./cli/commands.js";
import { failure } from "./agent/contracts.js";
runCli(["mcp", ...process.argv.slice(2)]).catch((error) => {
  console.error(JSON.stringify(failure(error)));
  process.exitCode = 1;
});
