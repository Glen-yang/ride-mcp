import assert from "node:assert/strict";
import { it } from "node:test";
import { createPrivyExchange } from "./privy_exchange.js";

it("Apple reuses the original verified Privy ID and returns the Core Ride identity, without matching relay email", async () => {
  let sent: any;
  const exchange = createPrivyExchange("https://core.test/graphql", (async (
    _url,
    options,
  ) => {
    sent = JSON.parse(options!.body as string).variables.input;
    return Response.json({
      data: {
        syncPrivyUser: {
          accessToken: "original-core-jwt",
          user: { id: "original-ride-user", username: "Existing Apple user" },
        },
      },
    });
  }) as typeof fetch);
  const out = await exchange({
    privyId: "did:privy:original-app-user",
    privyAccessToken: "verified-by-core",
    authProvider: "APPLE",
    email: "relay@privaterelay.appleid.com",
    accessCode: "not-for-apple",
    walletAddress: "0xoriginal",
    privyWalletId: "original-wallet",
  });
  assert.equal(sent.privyId, "did:privy:original-app-user");
  assert.equal(sent.authProvider, "APPLE");
  assert.equal(sent.privyAccessToken, "verified-by-core");
  assert.equal(sent.walletAddress, "0xoriginal");
  assert.equal(sent.privyWalletId, "original-wallet");
  assert.equal(sent.email, undefined);
  assert.equal(sent.accessCode, undefined);
  assert.equal(out.identity.subject, "original-ride-user");
  assert.equal(out.rideAuthToken, "original-core-jwt");
});
it("preserves Google registration inputs and never accepts invalid Core identity responses", async () => {
  for (const authProvider of [undefined, "GOOGLE"]) {
    const exchange = createPrivyExchange("https://core.test/graphql", (async (
      _url,
      options,
    ) => {
      const input = JSON.parse(options!.body as string).variables.input;
      assert.equal(input.authProvider, "GOOGLE");
      assert.equal(input.accessCode, "invite");
      assert.equal(input.email, "google@example.test");
      return Response.json({ errors: [{ message: "invalid token" }] });
    }) as typeof fetch);
    await assert.rejects(
      exchange({
        privyId: "did:privy:x",
        privyAccessToken: "bad",
        authProvider,
        email: "google@example.test",
        accessCode: "invite",
      }),
      /Ride sign-in failed/,
    );
  }
  const exchange = createPrivyExchange(
    "https://core.test/graphql",
    (async () => {
      throw Error("must not call Core");
    }) as typeof fetch,
  );
  await assert.rejects(
    exchange({ privyId: "x", privyAccessToken: "x", authProvider: "TWITTER" }),
    /Unsupported Ride login provider/,
  );
});
