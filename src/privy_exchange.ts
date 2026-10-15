import { AgentError } from "./agent/contracts.js";
import type { PrivyAuthorizationInput } from "./oauth.js";

// Core verifies the Privy JWT and resolves the existing Ride user by Privy ID.
// In particular, Apple relay emails must never be used to find or merge users.
export function createPrivyExchange(graphql: string, request = fetch) {
  return async (input: PrivyAuthorizationInput) => {
    const authProvider = input.authProvider ?? "GOOGLE";
    if (!["GOOGLE", "APPLE"].includes(authProvider))
      throw new AgentError(
        "AUTH_REQUIRED",
        "Unsupported Ride login provider.",
        false,
        401,
      );
    const response = await request(graphql, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query:
          "mutation AgentLogin($input:SyncPrivyUserInput!){syncPrivyUser(input:$input){accessToken user{id username}}}",
        variables: {
          input: {
            privyId: input.privyId,
            privyAccessToken: input.privyAccessToken,
            walletAddress: input.walletAddress,
            privyWalletId: input.privyWalletId,
            ...(authProvider === "GOOGLE"
              ? { email: input.email, accessCode: input.accessCode }
              : {}),
            authProvider,
            appVersion: "1.0.0",
            platform: "WEB",
            deviceName: "Ride Agent",
          },
        },
      }),
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
    const data = (await response.json()) as any;
    const login = data.data?.syncPrivyUser;
    if (
      !response.ok ||
      data.errors?.length ||
      !login?.accessToken ||
      !login.user?.id
    )
      throw new AgentError("AUTH_REQUIRED", "Ride sign-in failed.", false, 401);
    return {
      rideAuthToken: login.accessToken as string,
      identity: {
        subject: login.user.id as string,
        displayName: login.user.username ?? "Ride user",
      },
    };
  };
}
