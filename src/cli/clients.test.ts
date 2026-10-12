import { it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { detectClients, selectClient } from "./clients.js";
import { runCli } from "./commands.js";
import { onboard } from "./onboarding.js";
import { setup, type ClientName } from "./setup.js";

async function temporary(work: (home: string) => Promise<void>) {
  const home = await mkdtemp(join(tmpdir(), "ride-client-"));
  try {
    await work(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

it("detects client configuration, executable CLIs and configured Codex home without running programs", () =>
  temporary(async (home) => {
    const bin = join(home, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "claude"), "#!/bin/sh\nexit 99\n", {
      mode: 0o700,
    });
    await writeFile(join(bin, "cursor"), "not executable", { mode: 0o600 });
    assert.deepEqual(
      await detectClients({ home, path: bin, platform: "linux" }),
      ["claude-code"],
    );
    const codexHome = join(home, "custom-codex");
    await mkdir(codexHome);
    await mkdir(join(home, ".cursor"));
    assert.deepEqual(
      await detectClients({ home, codexHome, path: "", platform: "linux" }),
      ["codex", "cursor"],
    );
    await writeFile(join(bin, "claude.cmd"), "@exit /b 99", { mode: 0o600 });
    assert.deepEqual(
      await detectClients({ home, path: bin, platform: "win32" }),
      ["claude-code", "cursor"],
    );
  }));

it("automatically chooses a single detected client and lets interactive users select among multiple or absent clients", async () => {
  const neverPrompt = async () => {
    assert.fail("single client must not prompt");
  };
  assert.equal(
    await selectClient(undefined, {
      detect: async () => ["cursor"],
      interactive: false,
      prompt: neverPrompt,
    }),
    "cursor",
  );
  for (const detected of [[], ["codex", "cursor"]] as ClientName[][]) {
    assert.equal(
      await selectClient("auto", {
        detect: async () => detected,
        interactive: true,
        prompt: async (candidates) => {
          assert.deepEqual(candidates, detected);
          return "claude-code";
        },
      }),
      "claude-code",
    );
  }
  assert.equal(
    await selectClient("codex", {
      detect: async () => {
        assert.fail("explicit choice must not need detection");
      },
    }),
    "codex",
  );
  await assert.rejects(selectClient("unsupported"), /Unsupported client/);
});

it("does not write configuration when noninteractive selection is ambiguous or the menu is cancelled", async (t) => {
  t.mock.method(console, "log", () => {});
  for (const detected of [[], ["codex", "cursor"]] as ClientName[][]) {
    await assert.rejects(
      runCli([], {
        selectClient: (requested) =>
          selectClient(requested, {
            detect: async () => detected,
            interactive: false,
          }),
        onboard: async () => {
          assert.fail("selection failure must not configure a client");
        },
      }),
      /interactive terminal/,
    );
  }
  await assert.rejects(
    runCli([], {
      selectClient: (requested) =>
        selectClient(requested, {
          detect: async () => [],
          interactive: true,
          prompt: async () => {
            throw new Error("cancelled");
          },
        }),
      onboard: async () => {
        assert.fail("cancellation must not configure a client");
      },
    }),
    /cancelled/,
  );
});

it("the bare command configures each supported client before starting its own read and proposal login", async (t) => {
  const messages: string[] = [];
  t.mock.method(console, "log", (message: string) => {
    messages.push(message);
  });
  for (const client of ["codex", "claude-code", "cursor"] as ClientName[])
    await temporary(async (home) => {
      let authenticated = false;
      await runCli([], {
        selectClient: (requested) =>
          selectClient(requested, {
            detect: async () => [client],
            interactive: false,
          }),
        onboard: (selected, server, options) =>
          onboard(selected, server, options, {
            home,
            codex: async (args) => {
              assert.equal(selected, "codex");
              assert.equal(args.at(-1), "ride:read,ride:trade");
              assert(
                (
                  await readFile(join(home, ".codex/config.toml"), "utf8")
                ).includes("https://mcp.onride.me/mcp"),
              );
              authenticated = true;
            },
            cliLogin: async (server, trade) => {
              assert.equal(server, "https://mcp.onride.me/mcp");
              assert.equal(trade, true);
              const path =
                selected === "cursor"
                  ? join(home, ".cursor/mcp.json")
                  : join(home, ".claude.json");
              assert.equal(
                JSON.parse(await readFile(path, "utf8")).mcpServers.ride
                  .args[2],
                "@glenyang/ride-cli@latest",
              );
              authenticated = true;
            },
          }),
      });
      assert.equal(authenticated, true);
      const result = JSON.parse(messages.at(-1)!);
      assert.equal(result.client, client);
      assert.equal(result.status, "connected");
      assert.deepEqual(result.scopes, ["ride:read", "ride:trade"]);
    });
});

it("explicit setup keeps read-only scope and help never starts installation", async (t) => {
  t.mock.method(console, "log", () => {});
  await temporary(async (home) => {
    await runCli(["setup", "--client", "codex"], {
      onboard: (client, server, options) =>
        onboard(client, server, options, {
          home,
          codex: async (args) => {
            assert.equal(args.at(-1), "ride:read");
          },
        }),
    });
  });
  t.mock.method(process.stdout, "write", () => true);
  await runCli(["--help"], {
    selectClient: async () => {
      assert.fail("help must not configure a client");
    },
  });
});

it("upgrades the published v0.3.2 Skill and npm registration while preserving user settings", () =>
  temporary(async (home) => {
    await mkdir(join(home, ".cursor"));
    await cp(
      fileURLToPath(new URL("./fixtures/v032-skill/", import.meta.url)),
      join(home, ".cursor/skills/ride"),
      { recursive: true },
    );
    const path = join(home, ".cursor/mcp.json");
    await writeFile(
      path,
      JSON.stringify({
        setting: 42,
        mcpServers: {
          other: { url: "https://other.test" },
          ride: {
            command: "npx",
            args: [
              "-y",
              "@glenyang/ride-cli@0.3.2",
              "mcp",
              "--server",
              "https://mcp.onride.me/mcp",
            ],
          },
        },
      }),
    );
    await setup("cursor", "https://mcp.onride.me/mcp", home);
    const config = JSON.parse(await readFile(path, "utf8"));
    assert.equal(config.setting, 42);
    assert.deepEqual(config.mcpServers.other, { url: "https://other.test" });
    assert.equal(config.mcpServers.ride.args[2], "@glenyang/ride-cli@latest");
    assert(
      (
        await readFile(join(home, ".cursor/skills/ride/SKILL.md"), "utf8")
      ).includes("get_ride_guide"),
    );
  }));
