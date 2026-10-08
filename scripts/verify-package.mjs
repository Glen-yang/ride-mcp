import { execFileSync } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
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
      /^(dist\/|public\/(agent|confirm)\.html|skills\/|docs\/|README\.md|LICENSE|package\.json|\.env\.example)/.test(
        f.path,
      ),
      `Unexpected file: ${f.path}`,
    );
  }
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
  const root = join(temp, "node_modules/@glen-yang/ride-cli");
  const { setup } = await import(
    pathToFileURL(join(root, "dist/cli/setup.js"))
  );
  for (const client of ["codex", "claude-code", "cursor"]) {
    const home = join(temp, client);
    const result = await setup(client, "https://ride.test/mcp", home);
    const text = await readFile(result.config, "utf8");
    assert(text.includes("github:Glen-yang/ride-mcp#v0.2.0"));
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
      private_history: false,
    }),
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
