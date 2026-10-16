import { createHash } from "node:crypto";

// MCP Apps defines this stable origin format for Claude. Use the same origin
// in the resource metadata and in the trusted Ride frame's ancestor policy.
export function claudeCardDomain(base: string): string {
  return `${createHash("sha256")
    .update(new URL("/mcp", base).href)
    .digest("hex")
    .slice(0, 32)}.claudemcpcontent.com`;
}
