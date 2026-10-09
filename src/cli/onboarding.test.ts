import { it } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  cp,
  symlink,
  readdir,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import TOML from "@iarna/toml";
import { setup } from "./setup.js";
import { onboard, runCodex } from "./onboarding.js";
import { distributionPackage } from "../version.js";
import { parseCommand } from "./commands.js";

const server = "https://mcp.onride.me/mcp";
const legacy = fileURLToPath(
  new URL("./fixtures/legacy-skill/", import.meta.url),
);
const packaged = fileURLToPath(new URL("../../skills/ride/", import.meta.url));
async function temporary(work: (home: string) => Promise<void>) {
  const home = await mkdtemp(join(tmpdir(), "ride-onboarding-"));
  try {
    await work(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

it("one command installs native HTTP MCP and Skill before requesting Codex read/trade OAuth", () =>
  temporary(async (home) => {
    const result = await onboard(
      "codex",
      server,
      { trade: true },
      {
        home,
        codex: async (args) => {
          const config = TOML.parse(
            await readFile(join(home, ".codex/config.toml"), "utf8"),
          ) as any;
          assert.deepEqual(config.mcp_servers.ride, { url: server });
          assert.equal(
            await readFile(join(home, ".codex/skills/ride/SKILL.md"), "utf8"),
            await readFile(join(packaged, "SKILL.md"), "utf8"),
          );
          assert.deepEqual(args, [
            "mcp",
            "login",
            "ride",
            "--scopes",
            "ride:read,ride:trade",
          ]);
        },
        cliLogin: async () => {
          assert.fail("Native Codex must use its own OAuth store");
        },
      },
    );
    assert.equal(result.status, "connected");
    assert.equal(result.login_required, false);
    assert.equal(result.restart_required, true);
    assert.deepEqual(result.scopes, ["ride:read", "ride:trade"]);
  }));

it("cancelled native login retains installation and the same command can retry", () =>
  temporary(async (home) => {
    await assert.rejects(
      onboard(
        "codex",
        server,
        {},
        {
          home,
          codex: async () => {
            throw new Error("browser authorization cancelled");
          },
        },
      ),
      /installed, but login is incomplete.*Rerun.*cancelled/,
    );
    const path = join(home, ".codex/config.toml");
    const installed = await readFile(path, "utf8");
    const result = await onboard(
      "codex",
      server,
      {},
      {
        home,
        codex: async (args) => {
          assert.equal(args.at(-1), "ride:read");
        },
      },
    );
    assert.equal(result.login_required, false);
    assert.equal(await readFile(path, "utf8"), installed);
  }));

it("unattended setup never starts login or claims authentication succeeded", () =>
  temporary(async (home) => {
    const parsed = parseCommand(["setup", "--client", "codex", "--skip-login"]);
    assert.equal(parsed.flags["skip-login"], true);
    const result = await onboard(
      "codex",
      server,
      { skipLogin: true },
      {
        home,
        codex: async () => {
          assert.fail("must not launch login");
        },
      },
    );
    assert.equal(result.status, "configured");
    assert.equal(result.login_required, true);
  }));

it("Claude and Cursor automatically authenticate the CLI session used by their pinned stdio MCP", async () => {
  for (const client of ["claude-code", "cursor"] as const)
    await temporary(async (home) => {
      let loggedIn = false;
      const result = await onboard(
        client,
        server,
        { trade: true },
        {
          home,
          codex: async () => {
            assert.fail("stdio clients must use Ride OAuth");
          },
          cliLogin: async (url, trade) => {
            loggedIn = true;
            assert.equal(url, server);
            assert.equal(trade, true);
            const path =
              client === "cursor" ? ".cursor/mcp.json" : ".claude.json";
            const entry = JSON.parse(await readFile(join(home, path), "utf8"))
              .mcpServers.ride;
            assert.deepEqual(entry, {
              command: "npx",
              args: [
                "-y",
                distributionPackage("github"),
                "mcp",
                "--server",
                server,
              ],
            });
          },
        },
      );
      assert(loggedIn);
      assert.equal(result.transport, "stdio");
      assert.equal(result.login_required, false);
    });
});

it("upgrades a released Codex stdio registration and full Skill tree, preserving surrounding TOML", () =>
  temporary(async (home) => {
    const root = join(home, ".codex");
    await mkdir(root);
    const prefix =
      '# preserve comment\nmodel = "test"\n[mcp_servers.first]\ncommand = "first"\n\n';
    const suffix =
      '\n# preserve next comment\n[mcp_servers.last]\ncommand = "last"\n';
    const args = [
      "-y",
      "github:Glen-yang/ride-mcp#v0.2.1",
      "mcp",
      "--server",
      server,
    ];
    const config = join(root, "config.toml");
    await writeFile(
      config,
      prefix +
        `[mcp_servers.ride]\ncommand = "npx"\nargs = ${JSON.stringify(args)}\n` +
        suffix,
    );
    await cp(legacy, join(root, "skills/ride"), { recursive: true });
    const result = await setup("codex", server, home);
    const current = await readFile(config, "utf8");
    assert(current.startsWith(prefix));
    assert(current.endsWith(suffix));
    assert.deepEqual((TOML.parse(current) as any).mcp_servers.ride, {
      url: server,
    });
    for (const name of ["SKILL.md", "references/commands.md"])
      assert.equal(
        await readFile(join(result.skill, name), "utf8"),
        await readFile(join(packaged, name), "utf8"),
      );
    assert.deepEqual((await readdir(root)).sort(), ["config.toml", "skills"]);
  }));

it("upgrades released JSON stdio configurations to this distribution version", () =>
  temporary(async (home) => {
    const path = join(home, ".claude.json");
    await writeFile(
      path,
      JSON.stringify({
        setting: 42,
        mcpServers: {
          other: { command: "other" },
          ride: {
            command: "npx",
            args: [
              "-y",
              "@glen-yang/ride-cli@0.2.2",
              "mcp",
              "--server",
              server,
            ],
          },
        },
      }),
    );
    await setup("claude-code", server, home);
    const current = JSON.parse(await readFile(path, "utf8"));
    assert.equal(current.setting, 42);
    assert.equal(current.mcpServers.other.command, "other");
    assert.equal(
      current.mcpServers.ride.args[1],
      distributionPackage("github"),
    );
  }));

it("refuses customized Skill references without altering client configuration", () =>
  temporary(async (home) => {
    const root = join(home, ".codex");
    await mkdir(root);
    const config = join(root, "config.toml"),
      original = 'model = "keep"\n';
    await writeFile(config, original);
    const skill = join(root, "skills/ride");
    await cp(legacy, skill, { recursive: true });
    const reference = join(skill, "references/commands.md");
    await writeFile(reference, "custom instructions");
    await assert.rejects(setup("codex", server, home), /Skill differs/);
    assert.equal(await readFile(reference, "utf8"), "custom instructions");
    assert.equal(await readFile(config, "utf8"), original);
  }));

it("refuses disabled native MCP and symlinked Skill resources before starting OAuth", async () => {
  await temporary(async (home) => {
    await mkdir(join(home, ".codex"));
    const config = join(home, ".codex/config.toml");
    const original = `[mcp_servers.ride]\nurl = "${server}"\nenabled = false\n`;
    await writeFile(config, original);
    await assert.rejects(
      onboard(
        "codex",
        server,
        {},
        {
          home,
          codex: async () =>
            assert.fail("must not authenticate disabled registration"),
        },
      ),
      /registration differs/,
    );
    assert.equal(await readFile(config, "utf8"), original);
  });
  await temporary(async (home) => {
    const installed = await setup("codex", server, home);
    const reference = join(installed.skill, "references/commands.md");
    await rm(reference);
    await symlink(join(packaged, "references/commands.md"), reference);
    await assert.rejects(setup("codex", server, home), /Unsafe/);
  });
});

it("bootstraps the official Codex CLI only when the installed executable is missing", async () => {
  const calls: [string, string[]][] = [];
  const args = ["mcp", "login", "ride", "--scopes", "ride:read,ride:trade"];
  await runCodex(args, async (command, values) => {
    calls.push([command, values]);
    if (command === "codex")
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
  });
  assert.deepEqual(calls, [
    ["codex", args],
    ["npx", ["-y", "@openai/codex@0.162.0", ...args]],
  ]);
  let attempts = 0;
  await assert.rejects(
    runCodex(args, async () => {
      attempts++;
      throw new Error("authorization denied");
    }),
    /denied/,
  );
  assert.equal(attempts, 1);
});
