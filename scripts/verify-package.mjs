import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const temp = await mkdtemp(join(tmpdir(), "ride-package-"));
try {
  const packed = JSON.parse(
    execFileSync("npm", ["pack", "--json", "--pack-destination", temp], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    }),
  )[0];
  for (const f of packed.files) {
    assert(
      !/(\.test\.|fixtures\.|dist\/index\.|(^|\/)\.env$|\.pem$|session\.json|output\/|\.playwright)/.test(
        f.path,
      ),
      `Unwanted package file: ${f.path}`,
    );
    assert(
      /^(dist\/|public\/((agent|confirm|fund)\.html|privy-auth\.js)|skills\/|docs\/|README\.md|LICENSE|package\.json|\.env\.example)/.test(
        f.path,
      ),
      `Unexpected file: ${f.path}`,
    );
  }
  assert(
    packed.files.some((f) => f.path === "public/privy-auth.js"),
    "Shared browser auth runtime must be packaged",
  );
  execFileSync(
    "npm",
    [
      "install",
      "--prefix",
      temp,
      "--no-audit",
      "--no-fund",
      join(temp, packed.filename),
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  for (const bin of ["ride"]) {
    const help = execFileSync(
      join(temp, "node_modules/.bin", bin),
      ["--help"],
      { encoding: "utf8" },
    );
    assert(help.includes("Ride CLI"));
  }
  const root = join(temp, "node_modules", packed.name);
  const { version } = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  );
  const { setup } = await import(
    pathToFileURL(join(root, "dist/cli/setup.js"))
  );
  const { runCli } = await import(
    pathToFileURL(join(root, "dist/cli/commands.js"))
  );
  const { onboard } = await import(
    pathToFileURL(join(root, "dist/cli/onboarding.js"))
  );
  const { detectClients, selectClient } = await import(
    pathToFileURL(join(root, "dist/cli/clients.js"))
  );
  for (const client of ["codex", "claude-code", "cursor"]) {
    const home = join(temp, client);
    const result = await setup(client, "https://ride.test/mcp", home);
    const text = await readFile(result.config, "utf8");
    assert(
      text.includes(
        client === "codex"
          ? 'url = "https://ride.test/mcp"'
          : `${packed.name}@latest`,
      ),
    );
    const autoHome = join(temp, "auto", client);
    await mkdir(
      join(autoHome, client === "claude-code" ? ".claude" : `.${client}`),
      { recursive: true },
    );
    const log = console.log;
    let authenticated = false;
    try {
      console.log = () => {};
      await runCli([], {
        selectClient: (requested) =>
          selectClient(requested, {
            detect: () =>
              detectClients({ home: autoHome, path: "", platform: "linux" }),
            interactive: false,
          }),
        onboard: (selected, server, options) =>
          onboard(selected, server, options, {
            home: autoHome,
            codex: async (args) => {
              assert.equal(args.at(-1), "ride:read,ride:trade");
              authenticated = true;
            },
            cliLogin: async (server, trade) => {
              assert.equal(trade, true);
              authenticated = true;
            },
          }),
      });
    } finally {
      console.log = log;
    }
    assert(authenticated);
    assert(
      (await readFile(join(result.skill, "SKILL.md"), "utf8")).includes(
        "name: ride",
      ),
    );
  }
  console.log(
    JSON.stringify({
      files: packed.files.length,
      tarball_bytes: packed.size,
      bins: 1,
      client_setups: 3,
      bare_command_setups: 3,
      private_history: false,
    }),
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
