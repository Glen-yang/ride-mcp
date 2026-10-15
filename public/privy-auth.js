// Shared browser login flow. Privy validates the OAuth state and identity token.
const FLOW_KEY = "ride:mcp:oauth_flow";
const RETURN_KEY = "ride:mcp:oauth_authorize_url";
const PROVIDER_KEY = "ride:mcp:login_provider";
const CALLBACK_KEYS = [
  "privy_oauth_code",
  "privy_oauth_state",
  "error",
  "error_description",
];
const FLOW_TTL = 15 * 60_000;

function cleanURL(value) {
  const url = new URL(value);
  for (const key of CALLBACK_KEYS) url.searchParams.delete(key);
  return url;
}
function returnURL(value) {
  const url = cleanURL(value);
  if (
    url.origin !== window.location.origin ||
    url.username ||
    url.password ||
    !/^(?:\/authorize|\/agent\/fund\/deposit_[a-f0-9]{32}|\/agent\/confirm\/proposal_[a-zA-Z0-9_-]{8,100})$/.test(
      url.pathname,
    )
  )
    throw Error(
      "Invalid Ride login return page. Restart sign-in from your AI client.",
    );
  return url;
}
function providerName(provider) {
  if (provider !== "apple" && provider !== "google")
    throw Error("Unsupported Ride login provider.");
  return provider === "apple" ? "Apple" : "Google";
}
function readFlow() {
  const value = sessionStorage.getItem(FLOW_KEY);
  if (value) {
    let flow;
    try {
      flow = JSON.parse(value);
    } catch {
      throw Error("Invalid Ride login session. Please retry sign-in.");
    }
    providerName(flow.provider);
    if (
      !Number.isFinite(flow.startedAt) ||
      Date.now() - flow.startedAt > FLOW_TTL ||
      flow.startedAt > Date.now() + 60_000
    )
      throw Error("Ride login session expired. Please retry sign-in.");
    return { ...flow, returnUrl: returnURL(flow.returnUrl).href };
  }
  // Google flows begun before the Apple rollout still carry the original return page.
  const legacy = sessionStorage.getItem(RETURN_KEY);
  if (!legacy)
    throw Error(
      "Missing Ride login session. Please restart sign-in from your AI client.",
    );
  return { provider: "google", returnUrl: returnURL(legacy).href };
}
export function hasOAuthCallback() {
  const query = new URL(window.location.href).searchParams;
  return CALLBACK_KEYS.some((key) => query.has(key));
}
export async function startPrivyOAuth(client, provider) {
  const name = providerName(provider);
  const target = returnURL(window.location.href);
  const response = await client.auth.oauth.generateURL(
    provider,
    `${window.location.origin}/auth/privy/oauth/callback`,
  );
  if (!response?.url) throw Error(`${name} login URL was not returned.`);
  sessionStorage.setItem(
    FLOW_KEY,
    JSON.stringify({ provider, returnUrl: target.href, startedAt: Date.now() }),
  );
  sessionStorage.setItem(RETURN_KEY, target.href);
  window.location.assign(response.url);
}
export function relayPrivyOAuthCallback() {
  const flow = readFlow();
  const current = new URL(window.location.href);
  const target = new URL(flow.returnUrl);
  for (const key of CALLBACK_KEYS) {
    const value = current.searchParams.get(key);
    if (value !== null) target.searchParams.set(key, value);
  }
  if (!CALLBACK_KEYS.some((key) => current.searchParams.has(key)))
    throw Error("Ride login returned no OAuth response. Please retry sign-in.");
  window.location.replace(target.href);
}
export async function completePrivyOAuth(client) {
  if (!hasOAuthCallback()) return null;
  const current = new URL(window.location.href);
  try {
    const flow = readFlow();
    if (cleanURL(current.href).href !== flow.returnUrl)
      throw Error(
        "Ride login returned to a different request. Please retry sign-in.",
      );
    const name = providerName(flow.provider);
    if (current.searchParams.has("error"))
      throw Error(
        `${name} login was declined or could not be completed. Please retry sign-in.`,
      );
    const code = current.searchParams.get("privy_oauth_code"),
      state = current.searchParams.get("privy_oauth_state");
    if (!code || !state)
      throw Error(
        `${name} login returned incomplete OAuth credentials. Please retry sign-in.`,
      );
    // Apple must reuse an existing Privy identity from the original Ride App.
    const session =
      flow.provider === "apple"
        ? await client.auth.oauth.loginWithCode(
            code,
            state,
            "apple",
            undefined,
            "no-signup",
          )
        : await client.auth.oauth.loginWithCode(code, state, "google");
    if (!session?.user?.id) throw Error("Privy login did not return a user.");
    sessionStorage.setItem(
      PROVIDER_KEY,
      JSON.stringify({ id: session.user.id, provider: flow.provider }),
    );
    return { session, provider: flow.provider };
  } finally {
    sessionStorage.removeItem(FLOW_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    window.history.replaceState({}, "", cleanURL(current.href).href);
  }
}
export function linkedAccounts(user) {
  const camel = Array.isArray(user?.linkedAccounts) ? user.linkedAccounts : [];
  return camel.length
    ? camel
    : Array.isArray(user?.linked_accounts)
      ? user.linked_accounts
      : [];
}
export function authProviderForUser(user, provider) {
  if (provider) return providerName(provider).toUpperCase();
  try {
    const saved = JSON.parse(sessionStorage.getItem(PROVIDER_KEY) || "null");
    if (saved?.id === user?.id)
      return providerName(saved.provider).toUpperCase();
  } catch {
    /* Resolve the existing identity's linked providers instead. */
  }
  const accounts = linkedAccounts(user);
  if (accounts.some((a) => a.type === "google_oauth")) return "GOOGLE";
  if (accounts.some((a) => a.type === "apple_oauth")) return "APPLE";
  throw Error(
    "Choose Apple or Google to sign in to your existing Ride account.",
  );
}
export function embeddedEthereumWallet(user) {
  return linkedAccounts(user)
    .filter(
      (a) =>
        a.type === "wallet" &&
        (a.chainType ?? a.chain_type) === "ethereum" &&
        a.address &&
        ((a.walletClientType ?? a.wallet_client_type) === "privy" ||
          (a.connectorType ?? a.connector_type) === "embedded"),
    )
    .sort(
      (a, b) =>
        Number(a.walletIndex ?? a.wallet_index ?? 0) -
        Number(b.walletIndex ?? b.wallet_index ?? 0),
    )[0];
}
function googleEmail(user) {
  const account = linkedAccounts(user).find(
    (a) => a.type === "google_oauth" || a.type === "email",
  );
  return (
    account?.email ??
    account?.emailAddress ??
    account?.email_address ??
    (account?.type === "email" ? account.address : undefined)
  );
}
export function loginInput(user, token, provider, accessCode) {
  if (!user?.id || !token)
    throw Error("Ride sign-in did not return a valid identity token.");
  const authProvider = authProviderForUser(user, provider);
  const wallet = embeddedEthereumWallet(user);
  if (!wallet)
    throw Error("Set up your Ride wallet in the App before continuing.");
  return {
    privyId: user.id,
    privyAccessToken: token,
    walletAddress: wallet.address,
    privyWalletId: wallet.id,
    authProvider,
    ...(authProvider === "GOOGLE"
      ? { email: googleEmail(user), ...(accessCode ? { accessCode } : {}) }
      : {}),
  };
}
export function setLoginBusy(busy) {
  for (const id of [
    "google-login",
    "apple-login",
    "sign-in",
    "sign-in-apple",
  ]) {
    const button = document.getElementById(id);
    if (button) button.disabled = busy;
  }
}
export function formatAuthError(error) {
  const message = error?.message || String(error);
  if (message.includes("Redirect URL is not allowed"))
    return `Ride login redirect is not configured: ${window.location.origin}/auth/privy/oauth/callback. Please contact Ride support.`;
  if (
    error?.name === "AbortError" ||
    error?.name === "TimeoutError" ||
    /aborted|timed? ?out/i.test(message)
  )
    return "The connection to Privy timed out. Check your network or proxy, then retry sign-in.";
  if (
    /signup.*(disabled|not.*allowed)|sign.?up.*(disabled|not.*allowed)|user.*not.*(found|exist)/i.test(
      message,
    )
  )
    return "No existing Ride Apple account was found. Use the Apple account you used in the Ride App, or choose your original login method.";
  return message;
}
