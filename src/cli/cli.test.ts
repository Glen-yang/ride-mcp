import { it } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  stat,
  rm,
  symlink,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setup } from "./setup.js";
import {
  saveSession,
  loadSession,
  serverUrl,
  withSessionLock,
} from "./session.js";
import { parseCommand } from "./commands.js";

it("installs Skill and MCP together without replacing other clients or settings", async () => {
  const home = await mkdtemp(join(tmpdir(), "ride-setup-"));
  try {
    await mkdir(join(home, ".codex"));
    const path = join(home, ".codex", "config.toml");
    await writeFile(
      path,
      '# keep comments\nmodel = "test"\n[mcp_servers.other]\ncommand = "other"\n',
    );
    const a = await setup("codex", "https://example.test/mcp", home);
    const text = await readFile(path, "utf8");
    assert(text.startsWith("# keep comments"));
    assert(text.includes("[mcp_servers.other]"));
    assert(text.includes("[mcp_servers.ride]"));
    assert(
      (await readFile(join(a.skill, "SKILL.md"), "utf8")).includes(
        "name: ride",
      ),
    );
    await setup("codex", "https://example.test/mcp", home);
    assert.equal(await readFile(path, "utf8"), text);
    await assert.rejects(
      setup("codex", "https://other.test/mcp", home),
      /differs/,
    );
    assert.equal(await readFile(path, "utf8"), text);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
it("supports Claude and Cursor JSON config while preserving unrelated values", async () => {
  for (const client of ["claude-code", "cursor"] as const) {
    const home = await mkdtemp(join(tmpdir(), "ride-setup-"));
    try {
      const path =
        client === "cursor"
          ? join(home, ".cursor", "mcp.json")
          : join(home, ".claude.json");
      await mkdir(join(home, ".cursor"), { recursive: true });
      await writeFile(
        path,
        JSON.stringify({
          setting: 42,
          mcpServers: { other: { command: "other" } },
        }),
      );
      await setup(client, "https://example.test/mcp", home);
      const result = JSON.parse(await readFile(path, "utf8"));
      assert.equal(result.setting, 42);
      assert.equal(result.mcpServers.other.command, "other");
      assert.equal(result.mcpServers.ride.command, "npx");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }
});
it("keeps credentials private, rejects symlinks and serializes credential mutations", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ride-session-"));
  try {
    const s = { server: "https://example.test/mcp" };
    await saveSession(s, dir);
    assert.deepEqual(await loadSession(dir), s);
    assert.equal((await stat(dir)).mode & 0o777, 0o700);
    assert.equal((await stat(join(dir, "session.json"))).mode & 0o777, 0o600);
    await withSessionLock(async () => {
      await assert.rejects(
        withSessionLock(async () => {}, dir),
        /updating credentials/,
      );
    }, dir);
    await rm(join(dir, "session.json"));
    const target = join(dir, "outside");
    await writeFile(target, "secret");
    await symlink(target, join(dir, "session.json"));
    await assert.rejects(saveSession(s, dir), /Unsafe/);
    assert.equal(await readFile(target, "utf8"), "secret");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("rejects credential-bearing and insecure remote server URLs", () => {
  assert.throws(() => serverUrl("https://user:secret@example.test/mcp"));
  assert.throws(() => serverUrl("http://example.test/mcp"));
  assert.equal(
    serverUrl("http://127.0.0.1:3456/mcp"),
    "http://127.0.0.1:3456/mcp",
  );
});
it("maps money-sensitive commands to the same strict contracts", () => {
  assert.deepEqual(parseCommand(["copy", "stop", "copy_abcdefgh"]).args, {
    copy_id: "copy_abcdefgh",
  });
  const command = parseCommand([
    "copy",
    "update",
    "copy_abcdefgh",
    "--json",
    '{"leverage_cap":5}',
  ]);
  assert.equal(command.name, "update_copy");
  assert.equal(command.args.leverage_cap, 5);
  assert.throws(() => parseCommand(["portfolio", "--server"]));
});
