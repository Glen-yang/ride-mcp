const root = document.getElementById("content");
let requestId = 0;
const pending = new Map();
const history = [];
let current = window.openai?.toolOutput ?? null;
function showError(message) {
  root.querySelector(".host-error")?.remove();
  root.prepend(el("p", message, "warning error host-error"));
}
function accept(value) {
  if (value?.error) {
    showError(value.error.message);
    return;
  }
  if (value) {
    if (current) history.push(current);
    current = value;
    draw();
  }
}
function draw() {
  render(root, current, openLink, callTool);
  if (history.length) {
    const back = el("button", "Back", "secondary");
    back.addEventListener("click", () => {
      current = history.pop();
      draw();
    });
    root.prepend(back);
  }
}
function request(method, params) {
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(
        new Error(
          "The host did not respond. Use the equivalent Ride tool or CLI command in the conversation.",
        ),
      );
    }, 30000);
    pending.set(id, { resolve, reject, timer });
    window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
  });
}
let busy = false;
async function callTool(name, args) {
  if (busy) return;
  busy = true;
  const buttons = [...root.querySelectorAll("button,input,select")].map(
    (button) => ({ button, disabled: button.disabled }),
  );
  buttons.forEach(({ button }) => {
    button.disabled = true;
  });
  try {
    const reply = window.openai?.callTool
      ? await window.openai.callTool(name, args)
      : await request("tools/call", { name, arguments: args });
    const value = reply?.structuredContent ?? (reply?.version ? reply : null);
    if (value) accept(value);
    else {
      const text = reply?.content?.find((x) => x.type === "text")?.text;
      if (text) accept(JSON.parse(text));
      else
        throw new Error(
          "The host returned no Ride result. Use the tool in the conversation.",
        );
    }
  } catch (e) {
    showError(e.message ?? "Ride request failed.");
  } finally {
    busy = false;
    buttons.forEach(({ button, disabled }) => {
      button.disabled = disabled;
    });
  }
}
async function openLink(url) {
  try {
    const target = new URL(url);
    if (target.protocol !== "https:" && target.hostname !== "127.0.0.1")
      throw new Error("Ride requires a secure confirmation URL.");
    const response = window.openai?.openExternal
      ? await window.openai.openExternal({ href: url })
      : await request("ui/open-link", { url });
    if (response?.isError)
      throw new Error(
        `The host could not open the link. Open Ride confirmation manually: ${url}`,
      );
  } catch (e) {
    showError(e.message);
  }
}
draw();
window.addEventListener("openai:set_globals", (event) =>
  accept(event.detail?.globals?.toolOutput),
);
window.addEventListener("message", (event) => {
  if (event.source !== window.parent) return;
  const msg = event.data;
  const entry = pending.get(msg?.id);
  if (entry) {
    clearTimeout(entry.timer);
    pending.delete(msg.id);
    if (msg.error) entry.reject(new Error(msg.error.message));
    else entry.resolve(msg.result);
  }
  if (msg?.method === "ui/notifications/tool-result")
    accept(msg.params?.structuredContent);
});
if (!window.openai?.callTool)
  request("ui/initialize", {
    appInfo: { name: "Ride Agent", version: "0.3.0" },
    appCapabilities: {},
    protocolVersion: "2026-01-26",
  })
    .then(() =>
      window.parent.postMessage(
        { jsonrpc: "2.0", method: "ui/notifications/initialized" },
        "*",
      ),
    )
    .catch((e) => showError(e.message));
