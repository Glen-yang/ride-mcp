#!/usr/bin/env node
import { runCli } from "./cli/commands.js";
import { failure } from "./agent/contracts.js";
// Bin-only module: npm launches a symlink, so import.meta.url must not be
// compared to process.argv[1]. Keep imported/testable code in commands.ts.
runCli(process.argv.slice(2)).catch((error) => {
  const result = failure(error);
  if (!result.error || result.error.code === "INTERNAL_ERROR")
    result.error = {
      code: "CLI_ERROR",
      message: error instanceof Error ? error.message : "CLI request failed",
      retryable: false,
    };
  console.error(JSON.stringify(result));
  process.exitCode = 1;
});
