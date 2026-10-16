import { it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import TOML from "@iarna/toml";
import { setup, type ClientName } from "./setup.js";
import { onboard } from "./onboarding.js";
import { runCli } from "./commands.js";
import {
  distributionPackage,
  mcpLaunchArgs,
  VERSION,
  GITHUB_REPOSITORY,
} from "../version.js";

const server = "https://custom.ride.test/mcp";
const legacySkill = JSON.parse(
  await fs.readFile(
    new URL("./fixtures/skill-v050.json", import.meta.url),
    "utf8",
  ),
) as Record<string, string>;
async function fixture(client: ClientName, args: string[]) {
  const home = await fs.mkdtemp(join(tmpdir(), "ride-brand-"));
  const root = join(home, client === "claude-code" ? ".claude" : `.${client}`);
  const skill = join(root, "skills/ride");
  const config =
    client === "codex"
      ? join(root, "config.toml")
      : client === "cursor"
        ? join(root, "mcp.json")
        : join(home, ".claude.json");
  const original =
    client === "codex"
      ? `# preserved\nmodel = "keep"\n[mcp_servers.other]\ncommand = "other"\n[mcp_servers.ride]\ncommand = "npx"\nargs = ${JSON.stringify(args)}\n`
      : JSON.stringify({
          setting: 42,
          mcpServers: {
            other: { command: "other" },
            ride: { command: "npx", args },
          },
        });
  for (const [name, text] of Object.entries(legacySkill)) {
    await fs.mkdir(join(skill, name, ".."), { recursive: true });
    await fs.writeFile(join(skill, name), text);
  }
  await fs.mkdir(join(home, ".ride"));
  const session = join(home, ".ride/session.json");
  await fs.writeFile(session, '{"preserve":"existing-login"}', { mode: 0o600 });
  await fs.writeFile(config, original);
  return { home, root, skill, config, original, session };
}

it("migrates the actual npm 0.5.0 Skill and legacy fixed/latest/GitHub launchers on all clients, preserving custom servers and login", async () => {
  for (const client of ["codex", "claude-code", "cursor"] as const) {
    for (const prefix of [
      ["-y", "@glenyang/ride-cli@0.5.0"],
      ["-y", "--prefer-online", "@glenyang/ride-cli@latest"],
      ["-y", "github:Glen-yang/ride-mcp#v0.5.0"],
    ]) {
      const f = await fixture(client, [...prefix, "mcp", "--server", server]);
      try {
        const result = await onboard(
          client,
          undefined,
          { skipLogin: true },
          {
            home: f.home,
            codex: async () => assert.fail("must not reauthorize"),
            cliLogin: async () => assert.fail("must not reauthorize"),
          },
        );
        assert.equal(result.server, server);
        const text = await fs.readFile(f.config, "utf8");
        const parsed =
          client === "codex" ? (TOML.parse(text) as any) : JSON.parse(text);
        const entries =
          client === "codex" ? parsed.mcp_servers : parsed.mcpServers;
        assert.deepEqual(Object.keys(entries).sort(), ["other", "ride"]);
        assert.deepEqual(entries.other, { command: "other" });
        assert.deepEqual(
          entries.ride,
          client === "codex"
            ? { url: server }
            : { command: "npx", args: mcpLaunchArgs("npm", server) },
        );
        assert.equal(
          client === "codex" ? parsed.model : parsed.setting,
          client === "codex" ? "keep" : 42,
        );
        assert.equal(
          await fs.readFile(f.session, "utf8"),
          '{"preserve":"existing-login"}',
        );
        assert.equal((await fs.stat(f.session)).mode & 0o777, 0o600);
        const installedSkill = await fs.readFile(
          join(f.skill, "SKILL.md"),
          "utf8",
        );
        assert(installedSkill.includes("@onride/agent@latest"));
        await setup(client, undefined, f.home);
        assert.equal(await fs.readFile(f.config, "utf8"), text);
        assert.equal(
          await fs.readFile(join(f.skill, "SKILL.md"), "utf8"),
          installedSkill,
        );
        assert.deepEqual(await fs.readdir(join(f.root, "skills")), ["ride"]);
      } finally {
        await fs.rm(f.home, { recursive: true, force: true });
      }
    }
  }
});

it("the public CLI upgrade command inherits a configured custom server without requesting new scopes", async (t) => {
  t.mock.method(console, "log", () => {});
  const f = await fixture("cursor", [
    "-y",
    "@glenyang/ride-cli@0.5.0",
    "mcp",
    "--server",
    server,
  ]);
  try {
    await runCli(["setup", "--client", "cursor", "--skip-login"], {
      onboard: (client, url, options) =>
        onboard(client, url, options, {
          home: f.home,
          cliLogin: async () => assert.fail("must not log in"),
        }),
    });
    assert.deepEqual(
      JSON.parse(await fs.readFile(f.config, "utf8")).mcpServers.ride.args,
      mcpLaunchArgs("npm", server),
    );
  } finally {
    await fs.rm(f.home, { recursive: true, force: true });
  }
});

it("refuses custom launch arguments, environment, unknown versions and customized Skills without changing original files", async () => {
  for (const kind of ["args", "env", "unknown", "skill"] as const) {
    const f = await fixture("cursor", [
      "-y",
      "@glenyang/ride-cli@0.5.0",
      "mcp",
      "--server",
      server,
    ]);
    try {
      const config = JSON.parse(f.original);
      if (kind === "env") config.mcpServers.ride.env = { RIDE_CUSTOM: "keep" };
      if (kind === "args") config.mcpServers.ride.args.push("--custom", "keep");
      if (kind === "unknown")
        config.mcpServers.ride.args[1] = "@glenyang/ride-cli@99.0.0";
      if (kind === "skill")
        await fs.writeFile(join(f.skill, "custom.md"), "keep my notes");
      const original = JSON.stringify(config);
      await fs.writeFile(f.config, original);
      await assert.rejects(
        setup("cursor", undefined, f.home),
        /differs.*no files changed/s,
      );
      assert.equal(await fs.readFile(f.config, "utf8"), original);
      for (const [name, text] of Object.entries(legacySkill))
        assert.equal(await fs.readFile(join(f.skill, name), "utf8"), text);
      assert.equal(
        await fs.readFile(f.session, "utf8"),
        '{"preserve":"existing-login"}',
      );
    } finally {
      await fs.rm(f.home, { recursive: true, force: true });
    }
  }
});

it("restores the released Skill and leaves config and login untouched if the atomic configuration commit fails, then allows retry", async (t) => {
  const f = await fixture("cursor", [
    "-y",
    "@glenyang/ride-cli@0.5.0",
    "mcp",
    "--server",
    server,
  ]);
  const rename = fs.rename;
  const mock = t.mock.method(
    fs,
    "rename",
    async (
      from: Parameters<typeof fs.rename>[0],
      to: Parameters<typeof fs.rename>[1],
    ) => {
      if (to === f.config)
        throw Object.assign(new Error("simulated config commit failure"), {
          code: "EACCES",
        });
      return rename(from, to);
    },
  );
  try {
    await assert.rejects(
      setup("cursor", undefined, f.home),
      /config commit failure/,
    );
    assert.equal(await fs.readFile(f.config, "utf8"), f.original);
    for (const [name, text] of Object.entries(legacySkill))
      assert.equal(await fs.readFile(join(f.skill, name), "utf8"), text);
    assert.deepEqual((await fs.readdir(f.root)).sort(), ["mcp.json", "skills"]);
    assert.deepEqual(await fs.readdir(join(f.root, "skills")), ["ride"]);
    assert.equal(
      await fs.readFile(f.session, "utf8"),
      '{"preserve":"existing-login"}',
    );
    mock.mock.restore();
    await setup("cursor", undefined, f.home);
    assert.deepEqual(
      JSON.parse(await fs.readFile(f.config, "utf8")).mcpServers.ride.args,
      mcpLaunchArgs("npm", server),
    );
  } finally {
    mock.mock.restore();
    await fs.rm(f.home, { recursive: true, force: true });
  }
});

it("keeps npm fixed versions, restart updates and the metadata-derived GitHub source distinct", () => {
  assert.equal(distributionPackage("npm"), `@onride/agent@${VERSION}`);
  assert.equal(
    distributionPackage("github"),
    `github:${GITHUB_REPOSITORY}#v${VERSION}`,
  );
  assert.equal(mcpLaunchArgs("npm", server)[2], "@onride/agent@latest");
});
