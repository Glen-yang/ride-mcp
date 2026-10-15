import {
  startPrivyOAuth,
  completePrivyOAuth,
  hasOAuthCallback,
  loginInput,
  setLoginBusy,
  formatAuthError,
} from "/auth/privy/runtime.js";
let client, csrf, proposal;
const status = document.getElementById("status"),
  content = document.getElementById("content");
const showError = (e) => {
  status.textContent = formatAuthError(e);
  status.className = "warning error";
};
let initialization;
function init() {
  if (initialization) return initialization;
  initialization = initializeClient().catch((error) => {
    client = undefined;
    initialization = undefined;
    throw error;
  });
  return initialization;
}
async function initializeClient() {
  if (client) return client;
  if (!config.privy_app_id) throw Error("Ride sign-in is unavailable.");
  const { default: Privy, LocalStorage } = await import(config.privy_sdk);
  client = new Privy({
    appId: config.privy_app_id,
    ...(config.privy_client_id ? { clientId: config.privy_client_id } : {}),
    storage: new LocalStorage(),
  });
  await client.initialize();
  return client;
}
async function call(operation, body) {
  const response = await fetch(`/agent/human/${operation}`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(csrf ? { "X-Ride-CSRF": csrf } : {}),
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok)
    throw Error(payload.error?.message ?? "Ride request failed");
  return payload;
}
async function finish(session, provider) {
  const c = await init();
  const user = session?.user ?? (await c.user.get()).user;
  if (!user) return;
  const login = await call(
    "login",
    loginInput(
      user,
      await c.getAccessToken(),
      provider,
      sessionStorage.getItem("ride:agent:access-code"),
    ),
  );
  csrf = login.csrf;
  sessionStorage.removeItem("ride:agent:access-code");
  const value = await call("proposal", { proposal_id: config.proposal_id });
  proposal = value.data.proposal;
  render(content, value);
  content.querySelectorAll("button").forEach((b) => b.remove());
  document.getElementById("login").hidden = true;
  document.getElementById("actions").hidden =
    proposal.status !== "requires_confirmation";
  status.textContent = "";
}
for (const [id, provider] of [
  ["sign-in", "google"],
  ["sign-in-apple", "apple"],
]) {
  document.getElementById(id).onclick = async () => {
    try {
      setLoginBusy(true);
      sessionStorage.removeItem("ride:agent:access-code");
      if (provider === "google")
        sessionStorage.setItem(
          "ride:agent:access-code",
          document.getElementById("access-code").value.trim(),
        );
      await startPrivyOAuth(await init(), provider);
    } catch (e) {
      showError(e);
      setLoginBusy(false);
    }
  };
}
for (const [id, operation] of [
  ["approve", "confirm"],
  ["reject", "reject"],
])
  document.getElementById(id).onclick = async () => {
    const actions = document.getElementById("actions");
    actions.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      const value = await call(operation, {
        proposal_id: config.proposal_id,
        ...(operation === "confirm"
          ? { preview_hash: proposal.preview_hash }
          : {}),
      });
      render(content, value);
      actions.hidden = true;
      status.textContent =
        operation === "confirm"
          ? "Confirmed and queued. Fills and settlement are still pending."
          : "Proposal rejected.";
    } catch (e) {
      showError(e);
      actions.querySelectorAll("button").forEach((b) => (b.disabled = false));
    }
  };
setLoginBusy(true);
try {
  if (hasOAuthCallback()) {
    setLoginBusy(true);
    const result = await completePrivyOAuth(await init());
    await finish(result.session, result.provider);
  } else await finish();
} catch (e) {
  showError(e);
} finally {
  setLoginBusy(false);
}
