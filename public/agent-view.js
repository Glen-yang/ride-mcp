export const el = (tag, text, cls) => {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (cls) node.className = cls;
  return node;
};
const val = (v) => (v === null || v === undefined ? "Unavailable" : String(v));
const row = (label, value) => {
  const r = el("div", null, "row");
  r.append(el("span", label, "muted"), el("strong", val(value)));
  return r;
};
const card = (title) => {
  const c = el("section", null, "card");
  c.append(el("h2", title));
  return c;
};
const usdc = (v) => (v == null ? "Unavailable" : `${v} USDC`);
function sleeveCards(sleeves) {
  const grid = el("div", null, "grid");
  for (const s of sleeves) {
    const c = card(s.trader?.handle ?? s.copy_id);
    c.append(
      el("span", `${s.trader?.market ?? ""} · ${s.trader?.style ?? ""}`, "tag"),
      row("Copy Score", s.trader?.score),
      row("Allocation", usdc(s.amount_usdc)),
      row("Leverage cap", `${s.leverage_cap}x`),
      row("Sleeve loss trigger", `${s.stop_loss_pct}%`),
    );
    if (s.state)
      c.append(
        row("State", s.state),
        row("Net contribution", usdc(s.net_profit_usdc)),
      );
    grid.append(c);
  }
  return grid;
}
export function render(root, value, openLink = () => {}, callTool = () => {}) {
  root.replaceChildren();
  if (!value) {
    root.append(
      card("Connect Ride to load your portfolio"),
      el(
        "p",
        "Preferences → recommendations → review → confirm in Ride",
        "muted",
      ),
    );
    return;
  }
  root.append(el("div", value.status, "status"));
  if (value.error) {
    root.append(el("p", value.error.message, "warning error"));
    return;
  }
  const d = value.data ?? {};
  if (d.plan) {
    const plan = d.plan;
    root.append(
      el("h1", "Your trader basket"),
      el(
        "p",
        `${usdc(plan.preferences.budget_usdc)} · ${plan.preferences.market} · ${plan.allocations.length} traders`,
        "muted",
      ),
      sleeveCards(plan.allocations),
    );
    const risk = card("Portfolio parameters");
    risk.append(
      row("Loss trigger", `${plan.preferences.loss_trigger_pct}%`),
      row(
        "Historical portfolio drawdown",
        d.portfolio_historical_drawdown_pct == null
          ? "Unavailable"
          : `${d.portfolio_historical_drawdown_pct}%`,
      ),
      row("Existing entry deviation", "≤ 0.2%"),
      row("Plan expires", new Date(plan.expires_at).toLocaleString()),
    );
    root.append(risk);
    const start = el("button", "Review start proposal");
    start.addEventListener("click", () =>
      callTool("start_copy", { plan_id: plan.id }),
    );
    root.append(start);
  }
  if (d.portfolio) {
    const p = d.portfolio;
    root.append(
      el("h1", "Your portfolio"),
      el("p", `${p.state} · ${p.id}`, "muted"),
    );
    const overview = card("Actual account");
    overview.append(
      row("Account value", usdc(p.account_value_usdc)),
      row("Reconciled net profit", usdc(p.net_profit_usdc)),
      row("Available funds", usdc(p.available_usdc)),
      row("Pending reserve", usdc(p.reserved_usdc)),
      row("Allocated funds", usdc(p.allocated_usdc)),
      row("Accounting", p.reconciliation),
    );
    root.append(overview, sleeveCards(p.sleeves));
    for (const s of p.sleeves.filter((s) => s.state === "active")) {
      const stop = el("button", `Wind down ${s.trader.handle}`, "secondary");
      stop.addEventListener("click", () =>
        callTool("stop_copy", { copy_id: s.copy_id, mode: "wind_down" }),
      );
      root.append(stop);
    }
    const positions = card("Owned positions · gross and net");
    for (const a of p.positions ?? [])
      positions.append(
        row(
          `${a.asset} · ${a.market}`,
          `Gross ${usdc(a.gross_notional_usdc)} / Net ${usdc(a.net_notional_usdc)}`,
        ),
      );
    root.append(positions);
    if (p.executions?.length) {
      const executions = card("Execution status");
      for (const e of p.executions) executions.append(row(e.key, e.status));
      root.append(executions);
    }
  }
  if (d.trader) {
    const t = d.trader;
    root.append(
      el("h1", t.handle),
      el("p", `${t.market} · ${t.style} · ${t.direction}`, "muted"),
    );
    const profile = card(`Copy Score ${t.score}`);
    profile.append(row("Scoring version", t.score_version));
    for (const [key, value] of Object.entries(t.components ?? {}))
      profile.append(row(key, value));
    profile.append(
      row(
        "Source ROI",
        t.source_roi_pct == null ? "Unavailable" : `${t.source_roi_pct}%`,
      ),
      row(
        "Source drawdown",
        t.source_drawdown_pct == null
          ? "Unavailable"
          : `${t.source_drawdown_pct}%`,
      ),
    );
    root.append(
      profile,
      el(
        "p",
        "Source performance describes the trader, not your follower account.",
        "muted",
      ),
    );
  }
  if (d.proposal) {
    const q = d.proposal;
    root.append(
      el("h1", "Review before confirming"),
      el("p", `${q.action} · ${q.status}`, "muted"),
    );
    if (q.preview?.portfolio?.portfolio)
      renderNestedPortfolio(root, q.preview.portfolio.portfolio);
    const params = card("Frozen parameters");
    params.append(
      row("Loss trigger amount", usdc(q.preview?.loss_trigger_amount_usdc)),
      row("Existing entry deviation", "≤ 0.2%"),
      row(
        "Fee estimate",
        q.preview?.fees?.estimate_usdc == null
          ? "Unavailable · exact fee at settlement"
          : usdc(q.preview.fees.estimate_usdc),
      ),
      row("Expires", new Date(q.expires_at).toLocaleString()),
      row(
        "Execution state",
        q.status === "requires_confirmation"
          ? "Not submitted"
          : q.execution_tasks?.map((e) => e.status).join(", ") || q.status,
      ),
    );
    const details = el("details");
    details.append(
      el("summary", "View exact requested changes"),
      el("pre", JSON.stringify(q.arguments, null, 2)),
    );
    params.append(details);
    root.append(params);
    if (q.status === "requires_confirmation" && q.confirmation_url) {
      const b = el("button", "Open Ride confirmation");
      b.addEventListener("click", () => openLink(q.confirmation_url));
      root.append(b);
    }
  }
  if (d.observations) {
    root.append(el("h1", "Portfolio review"));
    for (const o of d.observations)
      root.append(
        el(
          "p",
          Object.entries(o)
            .map(([k, v]) => `${k}: ${val(v)}`)
            .join(" · "),
          "card",
        ),
      );
    if (!d.observations.length)
      root.append(
        el("p", "No actionable observations from current coverage.", "muted"),
      );
  }
  if (d.updates) {
    root.append(el("h1", "Ride updates"));
    for (const u of d.updates) {
      const c = card(u.kind);
      c.append(
        el("p", u.message),
        el("time", new Date(u.at).toLocaleString(), "muted"),
      );
      root.append(c);
    }
    if (!d.updates.length) root.append(el("p", "No new updates.", "muted"));
  }
  for (const warning of value.warnings ?? [])
    root.append(el("p", warning, "warning"));
  root.append(
    el(
      "footer",
      `Data as of ${value.as_of ?? "Unavailable"}. Configuration, submission, fill and settlement are separate states.`,
    ),
  );
}
function renderNestedPortfolio(root, p) {
  root.append(sleeveCards(p.sleeves ?? []));
}
