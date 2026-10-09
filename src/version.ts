import { readFileSync } from "node:fs";

export const VERSION: string = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;

export function distributionPackage(distribution: "github" | "npm"): string {
  return distribution === "npm"
    ? `@glen-yang/ride-cli@${VERSION}`
    : `github:Glen-yang/ride-mcp#v${VERSION}`;
}
