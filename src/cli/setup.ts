import {
  readFile,
  mkdir,
  lstat,
  rename,
  writeFile,
  cp,
  rm,
} from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import TOML from "@iarna/toml";
import { serverUrl } from "./session.js";

export type ClientName = "codex" | "claude-code" | "cursor";
export async function setup(
  client: ClientName,
  server: string,
  home = homedir(),
  distribution: "github" | "npm" = "github",
): Promise<{
  client: ClientName;
  config: string;
  skill: string;
  login_required: true;
}> {
  server = serverUrl(server);
  if (!["codex", "claude-code", "cursor"].includes(client))
    throw new Error("Unsupported client");
  const config =
    client === "codex"
      ? join(home, ".codex", "config.toml")
      : client === "claude-code"
        ? join(home, ".claude.json")
        : join(home, ".cursor", "mcp.json");
  const skill = join(
    home,
    client === "codex"
      ? ".codex"
      : client === "claude-code"
        ? ".claude"
        : ".cursor",
    "skills",
    "ride",
  );
  const args = [
    "-y",
    distribution === "npm"
      ? "@glen-yang/ride-cli@0.2.1"
      : "github:Glen-yang/ride-mcp#v0.2.1",
    "mcp",
    "--server",
    server,
  ];
  const entry = { command: "npx", args };
  let old: string | undefined;
  try {
    if ((await lstat(config)).isSymbolicLink())
      throw new Error("Configuration is a symlink; refusing to replace it");
    old = await readFile(config, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  let next: string;
  if (client === "codex") {
    const parsed = TOML.parse(old ?? "") as any;
    const current = parsed.mcp_servers?.ride;
    if (current && JSON.stringify(current) !== JSON.stringify(entry))
      throw new Error(
        "Existing Ride MCP registration differs; preserve it and review configuration manually",
      );
    next = current
      ? old!
      : `${old ?? ""}\n[mcp_servers.ride]\ncommand = "npx"\nargs = ${JSON.stringify(args)}\n`;
  } else {
    const parsed = JSON.parse(old ?? "{}");
    const current = parsed.mcpServers?.ride;
    if (current && JSON.stringify(current) !== JSON.stringify(entry))
      throw new Error(
        "Existing Ride MCP registration differs; preserve it and review configuration manually",
      );
    parsed.mcpServers = { ...parsed.mcpServers, ride: entry };
    next = JSON.stringify(parsed, null, 2) + "\n";
  }
  // Stage both artifacts, validate existing Skill before writing config.
  const packaged = fileURLToPath(
    new URL("../../skills/ride/", import.meta.url),
  );
  await mkdir(dirname(skill), { recursive: true });
  await mkdir(dirname(config), { recursive: true });
  const suffix = randomBytes(6).toString("hex"),
    tempSkill = `${skill}.${suffix}.tmp`,
    tempConfig = `${config}.${suffix}.tmp`;
  try {
    try {
      const info = await lstat(skill);
      if (info.isSymbolicLink() || !info.isDirectory())
        throw new Error("Unsafe existing Ride Skill");
      const present = await readFile(join(skill, "SKILL.md"), "utf8"),
        incoming = await readFile(join(packaged, "SKILL.md"), "utf8");
      if (present !== incoming)
        throw new Error(
          "Existing Ride Skill differs; preserve it and review manually",
        );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      await cp(packaged, tempSkill, { recursive: true, dereference: false });
    }
    await writeFile(tempConfig, next, { mode: 0o600, flag: "wx" });
    let latest: string | undefined;
    try {
      latest = await readFile(config, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    if (latest !== old)
      throw new Error("Client configuration changed during setup; retry");
    try {
      await lstat(tempSkill);
      await rename(tempSkill, skill);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    await rename(tempConfig, config);
    return { client, config, skill, login_required: true };
  } finally {
    await rm(tempConfig, { force: true });
    await rm(tempSkill, { force: true, recursive: true });
  }
}
