import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(
  new URL("../public/privy-auth.js", import.meta.url),
  "utf8",
).replaceAll("export ", "");
function browser(path: string) {
  const storage = new Map<string, string>();
  let href = `https://ride.test${path}`;
  const calls: unknown[][] = [];
  const existingUser = {
    id: "did:privy:original-user",
    linked_accounts: [
      { type: "apple_oauth", email: "hidden@privaterelay.appleid.com" },
      {
        type: "wallet",
        chain_type: "ethereum",
        wallet_client_type: "privy",
        address: "0xoriginal",
        id: "original-wallet",
      },
    ],
  };
  const client = {
    auth: {
      oauth: {
        generateURL: async (...args: unknown[]) => {
          calls.push(["generate", ...args]);
          return { url: "https://appleid.apple.com/auth/authorize" };
        },
        loginWithCode: async (...args: unknown[]) => {
          calls.push(["login", ...args]);
          return { user: existingUser };
        },
      },
    },
  };
  const location = {
    get href() {
      return href;
    },
    get origin() {
      return new URL(href).origin;
    },
    assign: (url: string) => {
      href = url;
    },
    replace: (url: string) => {
      href = url;
    },
  };
  const api: any = runInNewContext(
    source +
      "\n({startPrivyOAuth,completePrivyOAuth,relayPrivyOAuthCallback,authProviderForUser,loginInput,embeddedEthereumWallet})",
    {
      URL,
      Date,
      window: {
        location,
        history: {
          replaceState: (_a: unknown, _b: unknown, url: string) => {
            href = url;
          },
        },
      },
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    },
  );
  return { api, client, calls, storage, existingUser, location };
}
for (const path of [
  "/authorize?client_id=client&state=ai-state",
  `/agent/fund/deposit_${"a".repeat(32)}`,
  "/agent/confirm/proposal_original123",
]) {
  for (const provider of ["apple", "google"])
    it(`${provider} roundtrip preserves provider, original identity and return page for ${path}`, async () => {
      const b = browser(path);
      await b.api.startPrivyOAuth(b.client, provider);
      assert.deepEqual(b.calls[0], [
        "generate",
        provider,
        "https://ride.test/auth/privy/oauth/callback",
      ]);
      b.location.replace(
        "https://ride.test/auth/privy/oauth/callback?privy_oauth_code=code&privy_oauth_state=sdk-state",
      );
      b.api.relayPrivyOAuthCallback();
      assert.equal(
        new URL(b.location.href).pathname,
        new URL(path, "https://ride.test").pathname,
      );
      const out = await b.api.completePrivyOAuth(b.client);
      assert.equal(out.session.user.id, "did:privy:original-user");
      assert.equal(out.provider, provider);
      assert.deepEqual(
        b.calls[1],
        provider === "apple"
          ? ["login", "code", "sdk-state", "apple", undefined, "no-signup"]
          : ["login", "code", "sdk-state", "google"],
      );
      assert.equal(b.location.href, `https://ride.test${path}`);
      assert.equal(
        b.api.authProviderForUser(out.session.user),
        provider.toUpperCase(),
      );
      const input = b.api.loginInput(
        out.session.user,
        "privy-token",
        provider,
        "invite",
      );
      assert.equal(input.privyId, "did:privy:original-user");
      assert.equal(input.walletAddress, "0xoriginal");
      assert.equal(input.authProvider, provider.toUpperCase());
      assert.equal(input.email, undefined);
      assert.equal(
        input.accessCode,
        provider === "google" ? "invite" : undefined,
      );
      assert.equal(b.storage.has("ride:mcp:oauth_flow"), false);
    });
}
it("rejects expired, foreign, unsupported and mismatched return flows before any identity exchange", async () => {
  for (const flow of [
    {
      provider: "apple",
      returnUrl: "https://evil.test/authorize",
      startedAt: Date.now(),
    },
    {
      provider: "apple",
      returnUrl: "https://ride.test/agent/human/confirm",
      startedAt: Date.now(),
    },
    {
      provider: "apple",
      returnUrl: "https://ride.test/authorize",
      startedAt: Date.now() - 16 * 60_000,
    },
    {
      provider: "twitter",
      returnUrl: "https://ride.test/authorize",
      startedAt: Date.now(),
    },
    {
      provider: "apple",
      returnUrl: "https://ride.test/authorize?client_id=other",
      startedAt: Date.now(),
    },
  ]) {
    const b = browser(
      "/authorize?privy_oauth_code=code&privy_oauth_state=state",
    );
    b.storage.set("ride:mcp:oauth_flow", JSON.stringify(flow));
    await assert.rejects(b.api.completePrivyOAuth(b.client));
    assert.equal(b.calls.length, 0);
  }
});
it("decline and incomplete callbacks are retryable, clean URL credentials and never log in", async () => {
  for (const query of [
    "error=access_denied&error_description=private",
    "privy_oauth_code=code",
    "privy_oauth_state=state",
  ]) {
    const b = browser("/authorize");
    await b.api.startPrivyOAuth(b.client, "apple");
    b.location.replace(`https://ride.test/authorize?${query}`);
    await assert.rejects(
      b.api.completePrivyOAuth(b.client),
      /declined|incomplete/,
    );
    assert.equal(b.calls.length, 1);
    assert.equal(b.location.href, "https://ride.test/authorize");
  }
});
it("retains safe pre-rollout Google callback compatibility and rejects a foreign legacy redirect", async () => {
  const b = browser("/authorize?privy_oauth_code=code&privy_oauth_state=state");
  b.storage.set("ride:mcp:oauth_authorize_url", "https://ride.test/authorize");
  assert.equal((await b.api.completePrivyOAuth(b.client)).provider, "google");
  const bad = browser("/auth/privy/oauth/callback?privy_oauth_code=code");
  bad.storage.set(
    "ride:mcp:oauth_authorize_url",
    "https://evil.test/authorize",
  );
  assert.throws(
    () => bad.api.relayPrivyOAuthCallback(),
    /Invalid Ride login return/,
  );
});
it("restored Apple session and both SDK field styles retain the original wallet; unrelated providers do not default to Google", () => {
  const b = browser("/authorize");
  assert.equal(b.api.authProviderForUser(b.existingUser), "APPLE");
  const user = {
    id: "same-user",
    linkedAccounts: [
      { type: "apple_oauth" },
      {
        type: "wallet",
        chainType: "ethereum",
        walletClientType: "privy",
        address: "0xsecond",
        walletIndex: 1,
      },
      {
        type: "wallet",
        chainType: "ethereum",
        walletClientType: "privy",
        address: "0xfirst",
        walletIndex: 0,
      },
    ],
  };
  assert.equal(b.api.loginInput(user, "token").walletAddress, "0xfirst");
  assert.equal(b.api.loginInput(user, "token").authProvider, "APPLE");
  assert.throws(
    () => b.api.authProviderForUser({ id: "other", linkedAccounts: [] }),
    /Choose Apple or Google/,
  );
});
it("Google registration keeps its email without mistaking a wallet address for email", () => {
  const b = browser("/authorize");
  const user = {
    ...b.existingUser,
    linked_accounts: [
      ...b.existingUser.linked_accounts,
      { type: "google_oauth", email: "google@example.test" },
    ],
  };
  assert.equal(
    b.api.loginInput(user, "token", "google").email,
    "google@example.test",
  );
  assert.equal(b.api.loginInput(user, "token", "apple").email, undefined);
  assert.equal(
    b.api.loginInput(b.existingUser, "token", "google").email,
    undefined,
  );
});
