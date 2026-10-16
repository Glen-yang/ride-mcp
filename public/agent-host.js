const root = document.getElementById("content");
const hostConfig = /*HOST_CONFIG*/ {};
let requestId = 0;
const pending = new Map();
const history = [];
let current = window.openai?.toolOutput ?? null;
function showError(message) {
  root.querySelector(".host-error")?.remove();
  root.prepend(el("p", message, "warning error host-error"));
}
function accept(value) {
  if (value) {
    if (current) history.push(current);
    current = value;
    draw();
  }
}
function draw() {
  render(
    root,
    current,
    openLink,
    callTool,
    hostConfig.confirmation_origin ? confirmationCard : undefined,
  );
  if (history.length) {
    const back = el("button", "Back", "secondary");
    back.addEventListener("click", () => {
      current = history.pop();
      draw();
    });
    root.prepend(back);
  }
}
function confirmationCard(container, proposal, demo) {
  try {
    const base = new URL(hostConfig.confirmation_origin);
    const id = proposal.id;
    if (base.protocol !== "https:" && base.hostname !== "127.0.0.1")
      throw Error("Secure Ride origin unavailable.");
    if (
      !demo &&
      (!/^proposal_[a-zA-Z0-9_-]{8,100}$/.test(id) ||
        new URL(proposal.confirmation_url).origin !== base.origin ||
        new URL(proposal.confirmation_url).pathname !== `/agent/confirm/${id}`)
    )
      throw Error(
        "The confirmation address does not match this Ride proposal.",
      );
    const frame = document.createElement("iframe");
    frame.title = demo ? "Ride 模拟确认卡片" : "Ride 操作确认";
    frame.className = "confirmation-frame";
    frame.referrerPolicy = "no-referrer";
    frame.setAttribute(
      "sandbox",
      "allow-scripts allow-same-origin allow-popups allow-forms allow-popups-to-escape-sandbox",
    );
    frame.src = new URL(
      demo ? "/agent/card-demo" : `/agent/card/${id}`,
      base,
    ).href;
    container.append(frame);
    const state = el("p", "正在连接 Ride 确认卡片…", "muted");
    state.setAttribute("aria-live", "polite");
    container.append(state);
    const onMessage = (event) => {
      if (!frame.isConnected) {
        window.removeEventListener("message", onMessage);
        return;
      }
      if (
        event.source !== frame.contentWindow ||
        event.origin !== base.origin ||
        event.data?.type !== "ride:confirmation-state" ||
        (!demo && event.data.proposal_id !== id)
      )
        return;
      const names = {
        demo_ready: "模拟卡片已就绪 · 不会交易",
        demo_confirmed: "模拟确认成功 · 未提交交易",
        demo_rejected: "模拟已取消 · 未提交交易",
        sign_in_required: "请在卡片中连接 Ride",
        requires_confirmation: "请核对方案并确认",
        queued: "已确认，等待处理",
        rejected: "方案已取消",
        confirmed: "已确认",
        expired: "方案已过期",
      };
      state.textContent = names[event.data.status] ?? "Ride 状态已更新";
      if (Number.isFinite(event.data.height))
        frame.style.height = `${Math.min(1400, Math.max(420, event.data.height))}px`;
    };
    window.addEventListener("message", onMessage);
    if (proposal.confirmation_url) {
      const fallback = el("button", "在 Ride 页面中打开", "secondary");
      const fallbackUrl = demo
        ? new URL("/agent/card-demo", base).href
        : proposal.confirmation_url;
      fallback.onclick = () => openLink(fallbackUrl);
      container.append(fallback);
    }
  } catch (error) {
    showError(error.message);
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
    showError(e.message ?? "Ride Agent request failed.");
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
