import {
  readFile,
  mkdir,
  lstat,
  rename,
  writeFile,
  cp,
  rm,
  readdir,
} from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomBytes, createHash } from "node:crypto";
import TOML from "@iarna/toml";
import { serverUrl } from "./session.js";
import { distributionPackage, VERSION } from "../version.js";

export type ClientName = "codex" | "claude-code" | "cursor";
const legacySkillHashes = new Set([
  // Complete, unmodified Skill trees shipped in v0.2.1 and v0.2.2.
  "dc89f7beb9d8e2cb31f2dabfac80b18e546b2cd24f4318f1b84a5e1f93a65619",
]);
const managedVersions = ["0.2.1", "0.2.2", VERSION];

async function skillHash(root: string): Promise<string | undefined> {
  try {
    const info = await lstat(root);
    if (info.isSymbolicLink() || !info.isDirectory())
      throw new Error("Unsafe existing Ride Skill");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
  const files = new Map<string, Buffer>();
  async function visit(relative: string): Promise<void> {
    for (const item of await readdir(join(root, relative), {
      withFileTypes: true,
    })) {
      const name = relative ? `${relative}/${item.name}` : item.name;
      if (item.isSymbolicLink()) throw new Error("Unsafe existing Ride Skill");
      if (item.isDirectory()) await visit(name);
      else if (item.isFile()) files.set(name, await readFile(join(root, name)));
      else throw new Error("Unsafe existing Ride Skill");
    }
  }
  await visit("");
  const hash = createHash("sha256");
  for (const name of [...files.keys()].sort())
    hash.update(name).update("\0").update(files.get(name)!).update("\0");
  return hash.digest("hex");
}

function managedStdio(
  current: Record<string, unknown>,
  server: string,
): boolean {
  if (
    Object.keys(current).sort().join(",") !== "args,command" ||
    current.command !== "npx"
  )
    return false;
  return managedVersions.some((version) =>
    [
      `github:Glen-yang/ride-mcp#v${version}`,
      `@glen-yang/ride-cli@${version}`,
    ].some(
      (pkg) =>
        JSON.stringify(current.args) ===
        JSON.stringify(["-y", pkg, "mcp", "--server", server]),
    ),
  );
}

export async function setup(
  client: ClientName,
  server: string,
  home?: string,
  distribution: "github" | "npm" = "github",
): Promise<{
  client: ClientName;
  config: string;
  skill: string;
  login_required: true;
  transport: "http" | "stdio";
}> {
  server = serverUrl(server);
  if (!["codex", "claude-code", "cursor"].includes(client))
    throw new Error("Unsupported client");
  const base = home ?? homedir();
  const codex =
    home === undefined && process.env.CODEX_HOME
      ? process.env.CODEX_HOME
      : join(base, ".codex");
  const config =
    client === "codex"
      ? join(codex, "config.toml")
      : client === "claude-code"
        ? join(base, ".claude.json")
        : join(base, ".cursor", "mcp.json");
  const skill = join(
    client === "codex"
      ? codex
      : join(base, client === "claude-code" ? ".claude" : ".cursor"),
    "skills",
    "ride",
  );
  const args = [
    "-y",
    distributionPackage(distribution),
    "mcp",
    "--server",
    server,
  ];
  const entry = client === "codex" ? { url: server } : { command: "npx", args };
  let old: string | undefined;
  try {
    if ((await lstat(config)).isSymbolicLink())
      throw new Error("Configuration is a symlink; refusing to replace it");
    old = await readFile(config, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const conflict = () =>
    new Error(
      "Existing Ride MCP registration differs; preserve it and review configuration manually",
    );
  let next: string;
  if (client === "codex") {
    const parsed = TOML.parse(old ?? "") as any;
    const current = parsed.mcp_servers?.ride;
    if (
      current &&
      current.url === server &&
      !("command" in current) &&
      !("args" in current) &&
      !("bearer_token_env_var" in current) &&
      !("http_headers" in current) &&
      !("env_http_headers" in current) &&
      current.enabled !== false
    ) {
      next = old!;
    } else if (current && managedStdio(current, server)) {
      // Only our generated legacy stanza is replaced; unrelated text stays verbatim.
      const stanza =
        /^\[mcp_servers\.ride\][ \t]*(?:#[^\n]*)?\r?\n([^]*?)(?=^\[|$(?![^]))/m;
      const match = stanza.exec(old!);
      if (
        !match ||
        !/^command[ \t]*=/m.test(match[1]) ||
        !/^args[ \t]*=.*\][ \t]*\r?$/m.test(match[1])
      )
        throw conflict();
      next = old!.replace(stanza, (text) =>
        text
          .replace(
            /^command[ \t]*=.*\r?\n/m,
            `url = ${JSON.stringify(server)}\n`,
          )
          .replace(/^args[ \t]*=.*\][ \t]*\r?\n?/m, ""),
      );
    } else {
      if (current) throw conflict();
      next = `${old ?? ""}\n[mcp_servers.ride]\nurl = ${JSON.stringify(server)}\n`;
    }
    // Verify the edited stanza really resolves to the intended native HTTP server.
    const check = (TOML.parse(next) as any).mcp_servers.ride;
    if (check.url !== server || check.command || check.args) throw conflict();
  } else {
    const parsed = JSON.parse(old ?? "{}");
    const current = parsed.mcpServers?.ride;
    if (current && !managedStdio(current, server)) throw conflict();
    parsed.mcpServers = { ...parsed.mcpServers, ride: entry };
    next = JSON.stringify(parsed, null, 2) + "\n";
  }
  const packaged = fileURLToPath(
    new URL("../../skills/ride/", import.meta.url),
  );
  const present = await skillHash(skill),
    incoming = await skillHash(packaged);
  if (present && present !== incoming && !legacySkillHashes.has(present))
    throw new Error(
      "Existing Ride Skill differs; preserve it and review manually",
    );
  await mkdir(dirname(skill), { recursive: true });
  await mkdir(dirname(config), { recursive: true });
  const suffix = randomBytes(6).toString("hex");
  const tempSkill = `${skill}.${suffix}.tmp`,
    backupSkill = `${skill}.${suffix}.bak`;
  const tempConfig = `${config}.${suffix}.tmp`;
  let committed = false,
    skillChanged = false,
    skillBackedUp = false;
  try {
    if (present !== incoming)
      await cp(packaged, tempSkill, { recursive: true, dereference: false });
    await writeFile(tempConfig, next, { mode: 0o600, flag: "wx" });
    let latest: string | undefined;
    try {
      if ((await lstat(config)).isSymbolicLink())
        throw new Error("Configuration changed during setup");
      latest = await readFile(config, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    if (latest !== old || (await skillHash(skill)) !== present)
      throw new Error(
        "Client configuration or Skill changed during setup; retry",
      );
    if (present !== incoming) {
      if (present !== undefined) {
        await rename(skill, backupSkill);
        skillBackedUp = true;
      }
      await rename(tempSkill, skill);
      skillChanged = true;
    }
    await rename(tempConfig, config);
    committed = true;
    return {
      client,
      config,
      skill,
      login_required: true,
      transport: client === "codex" ? "http" : "stdio",
    };
  } catch (e) {
    if (skillChanged) await rm(skill, { recursive: true, force: true });
    if (skillBackedUp) await rename(backupSkill, skill);
    throw e;
  } finally {
    await rm(tempConfig, { force: true });
    await rm(tempSkill, { force: true, recursive: true });
    if (committed) await rm(backupSkill, { force: true, recursive: true });
  }
}
