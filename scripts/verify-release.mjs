import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const pkg = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url)),
);
const lock = JSON.parse(
  await readFile(new URL("../package-lock.json", import.meta.url)),
);
assert.equal(pkg.name, "@onride/agent");
assert.equal(lock.name, pkg.name);
assert.equal(lock.packages[""].name, pkg.name);
assert.equal(lock.version, pkg.version);
assert.equal(lock.packages[""].version, pkg.version);
assert.equal(pkg.bin.ride, "dist/cli.js");
assert.equal(pkg.publishConfig.access, "public");
const repository = new URL(pkg.repository.url.replace(/^git\+/, ""));
assert.equal(repository.hostname, "github.com");
const repo = repository.pathname.slice(1).replace(/\.git$/, "");
assert(
  !/^Glen-yang\//i.test(repo),
  "Repository must belong to the confirmed company organization",
);
assert.equal(pkg.homepage, `https://github.com/${repo}#readme`);
assert.equal(pkg.bugs.url, `https://github.com/${repo}/issues`);
if (process.env.GITHUB_REPOSITORY)
  assert.equal(process.env.GITHUB_REPOSITORY, repo);
if (process.env.GITHUB_REF)
  assert.equal(process.env.GITHUB_REF, `refs/tags/v${pkg.version}`);
if (process.argv.includes("--online")) {
  const response = await fetch(`https://api.github.com/repos/${repo}`);
  assert.equal(
    response.status,
    200,
    `Company repository not accessible: ${repo}`,
  );
  const remote = await response.json();
  assert.equal(
    remote.full_name.toLowerCase(),
    repo.toLowerCase(),
    "Repository redirects to an unexpected owner",
  );
  assert.equal(remote.owner.type, "Organization");
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const refs = execFileSync(
    "git",
    [
      "ls-remote",
      pkg.repository.url.replace(/^git\+/, ""),
      `refs/tags/v${pkg.version}`,
      `refs/tags/v${pkg.version}^{}`,
    ],
    { encoding: "utf8" },
  );
  assert(
    refs.split("\n").some((line) => line.startsWith(`${head}\t`)),
    "Release tag must point to this exact commit",
  );
  const registry = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/${pkg.version}`,
  );
  assert.equal(
    registry.status,
    404,
    "Package version already exists or registry check failed",
  );
}
console.log(
  JSON.stringify({
    package: pkg.name,
    version: pkg.version,
    repository: repo,
    online: process.argv.includes("--online"),
  }),
);
