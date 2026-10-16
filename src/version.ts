import { readFileSync } from "node:fs";

const metadata = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
export const VERSION: string = metadata.version;
export const PACKAGE_NAME: string = metadata.name;
// Follow the reviewed package metadata after repository transfers and renames.
export const GITHUB_REPOSITORY: string = new URL(
  metadata.repository.url.replace(/^git\+/, ""),
).pathname
  .replace(/^\//, "")
  .replace(/\.git$/, "");

export function distributionPackage(distribution: "github" | "npm"): string {
  return distribution === "npm"
    ? `${PACKAGE_NAME}@${VERSION}`
    : `github:${GITHUB_REPOSITORY}#v${VERSION}`;
}

export function mcpLaunchArgs(
  distribution: "github" | "npm",
  server: string,
): string[] {
  return distribution === "npm"
    ? [
        "-y",
        "--prefer-online",
        `${PACKAGE_NAME}@latest`,
        "mcp",
        "--server",
        server,
      ]
    : ["-y", distributionPackage(distribution), "mcp", "--server", server];
}
