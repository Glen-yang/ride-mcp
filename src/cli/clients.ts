import { access, constants } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import type { ClientName } from "./setup.js";

const clients: ClientName[] = ["codex", "claude-code", "cursor"];
const labels = {
  codex: "Codex",
  "claude-code": "Claude Code",
  cursor: "Cursor",
};

async function exists(path: string, mode = constants.F_OK): Promise<boolean> {
  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
}

export async function detectClients(
  options: {
    home?: string;
    path?: string;
    platform?: NodeJS.Platform;
    codexHome?: string;
  } = {},
): Promise<ClientName[]> {
  const home = options.home ?? homedir();
  const platform = options.platform ?? process.platform;
  const codexHome =
    options.codexHome ??
    (options.home === undefined ? process.env.CODEX_HOME : undefined) ??
    join(home, ".codex");
  const markers: Record<ClientName, string[]> = {
    codex: [codexHome],
    "claude-code": [join(home, ".claude"), join(home, ".claude.json")],
    cursor: [join(home, ".cursor")],
  };
  if (platform === "darwin") {
    for (const client of ["codex", "cursor"] as const) {
      for (const base of ["/Applications", join(home, "Applications")])
        markers[client].push(join(base, `${labels[client]}.app`));
    }
  }
  const searchPath = (options.path ?? process.env.PATH ?? "")
    .split(platform === "win32" ? ";" : ":")
    .filter(Boolean);
  const detected: ClientName[] = [];
  for (const client of clients) {
    const binary = client === "claude-code" ? "claude" : client;
    const suffixes = platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
    const executables = searchPath.flatMap((base) =>
      suffixes.map((suffix) => join(base, binary + suffix)),
    );
    if (
      (await Promise.all(markers[client].map((path) => exists(path)))).some(
        Boolean,
      ) ||
      (
        await Promise.all(
          executables.map((path) =>
            exists(
              path,
              platform === "win32" ? constants.F_OK : constants.X_OK,
            ),
          ),
        )
      ).some(Boolean)
    )
      detected.push(client);
  }
  return detected;
}

export async function promptClient(detected: ClientName[]): Promise<string> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  const abort = new AbortController();
  readline.once("SIGINT", () => abort.abort());
  readline.once("close", () => abort.abort());
  try {
    process.stderr.write(
      "Choose your AI client:\n" +
        clients
          .map(
            (client, index) =>
              `  ${index + 1}. ${labels[client]}${detected.includes(client) ? " (detected)" : ""}\n`,
          )
          .join(""),
    );
    for (;;) {
      const answer = (
        await readline.question("Client [1-3]: ", { signal: abort.signal })
      )
        .trim()
        .toLowerCase();
      const client =
        clients[Number(answer) - 1] ??
        clients.find((client) => client === answer);
      if (client) return client;
      process.stderr.write("Enter 1, 2 or 3.\n");
    }
  } catch (error) {
    if (abort.signal.aborted)
      throw new Error("Installation cancelled before configuring a client.");
    throw error;
  } finally {
    readline.close();
  }
}

export async function selectClient(
  requested?: string,
  dependencies: {
    detect?: () => Promise<ClientName[]>;
    interactive?: boolean;
    prompt?: (detected: ClientName[]) => Promise<string>;
  } = {},
): Promise<ClientName> {
  if (requested && requested !== "auto") {
    if (!clients.includes(requested as ClientName))
      throw new Error("Unsupported client");
    return requested as ClientName;
  }
  const detected = await (dependencies.detect ?? detectClients)();
  if (detected.length === 1) return detected[0];
  if (!(dependencies.interactive ?? !!process.stdin.isTTY))
    throw new Error(
      "Run this command in an interactive terminal to choose your AI client, or use setup --client codex|claude-code|cursor --trade.",
    );
  const selected = await (dependencies.prompt ?? promptClient)(detected);
  if (!clients.includes(selected as ClientName))
    throw new Error("Unsupported client");
  return selected as ClientName;
}
