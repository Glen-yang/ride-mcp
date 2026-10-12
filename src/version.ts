import { readFileSync } from "node:fs";

const metadata = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
export const VERSION: string = metadata.version;
export const PACKAGE_NAME: string = metadata.name;

export function distributionPackage(distribution: "github" | "npm"): string {
  return distribution === "npm"
    ? `${PACKAGE_NAME}@${VERSION}`
    : `github:Glen-yang/ride-mcp#v${VERSION}`;
}
