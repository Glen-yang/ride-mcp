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
const sumCash = (amounts) => {
  const n = amounts.reduce((total, v) => {
    const [whole, fraction = ""] = String(v).split(".");
    return total + BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0"));
  }, 0n);
  return `${n / 1000000n}.${String(n % 1000000n).padStart(6, "0")}`;
};
function sleeveCards(sleeves, callTool) {
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
    if (callTool) {
      const b = el("button", "Trader details", "secondary");
      b.addEventListener("click", () =>
        callTool("get_trader_profile", { trader_id: s.trader.id }),
      );
      c.append(b);
    }
    grid.append(c);
  }
  return grid;
}
export function render(root, value, openLink = () => {}, callTool = () => {}) {
  root.replaceChildren();
  if (!value) {
    welcome(root, callTool);
    return;
  }
  root.append(el("div", value.status, "status"));
  if (value.error) {
    root.append(el("p", value.error.message, "warning error"));
    return;
  }
  const d = value.data ?? {};
  if (d.preferences) welcome(root, callTool, d.preferences);
  if (d.plan) {
    const plan = d.plan;
    root.append(
      el("h1", "Your trader basket"),
      el(
        "p",
        `${usdc(plan.preferences.budget_usdc)} · ${plan.preferences.market} · ${plan.allocations.length} traders`,
        "muted",
      ),
      sleeveCards(plan.allocations, callTool),
    );
    const risk = card("Portfolio parameters");
    risk.append(
      row(
        "Selected allocation",
        usdc(sumCash(plan.allocations.map((a) => a.amount_usdc))),
      ),
      row("Unallocated budget", usdc(d.unallocated_usdc ?? "0.000000")),
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
    start.disabled = plan.expires_at <= Date.now();
    start.addEventListener("click", () =>
      callTool("start_copy", { plan_id: plan.id }),
    );
    const refresh = el("button", "Refresh saved plan", "secondary");
    refresh.addEventListener("click", () =>
      callTool("recalculate_plan", { plan_id: plan.id }),
    );
    root.append(
      planEditor(plan, d, callTool, start),
      el(
        "div",
        "Preview works before funding. Fund the trading account in your Ride App, then refresh this saved plan and review a new proposal.",
        "warning",
      ),
    );
    const actions = el("div", null, "actions");
    actions.append(start, refresh);
    root.append(actions);
    root.append(
      el(
        "p",
        "Perps recommendations use 3–8× risk caps; prediction uses 1×. Each sleeve defaults to a 30% loss trigger that initiates exits. RWA is an asset category.",
        "muted",
      ),
    );
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
    root.append(overview, sleeveCards(p.sleeves, callTool));
    const actions = el("div", null, "actions");
    for (const [label, name, args] of [
      ["Refresh portfolio", "get_portfolio", { portfolio_id: p.id }],
      ["Review portfolio", "review_portfolio", { portfolio_id: p.id }],
      [
        "Performance history",
        "get_performance",
        { portfolio_id: p.id, period: "weekly" },
      ],
      ["Daily report settings", "get_notification_preferences", {}],
    ]) {
      const b = el("button", label, "secondary");
      b.addEventListener("click", () => callTool(name, args));
      actions.append(b);
    }
    root.append(actions);
    for (const s of p.sleeves) {
      const controls = card(`${s.trader.handle} · manage copy`);
      const diagnostic = el("button", "Explain copy performance", "secondary");
      diagnostic.addEventListener("click", () => {
        const end = Date.now();
        callTool("diagnose_copy", {
          copy_id: s.copy_id,
          start_at: Math.max(
            p.ledger_started_at ?? p.created_at,
            end - 7 * 86400000,
          ),
          end_at: end,
        });
      });
      controls.append(diagnostic);
      if (s.state === "closed") {
        const replacement = field(
          controls,
          "Replacement public trader ID",
          "text",
          "",
        );
        const b = el("button", "Review replacement proposal", "secondary");
        b.addEventListener("click", () =>
          callTool("update_copy", {
            copy_id: s.copy_id,
            replacement_trader_id: replacement.value.trim(),
          }),
        );
        controls.append(
          b,
          el(
            "p",
            "Requires verified released funds; one replacement per rolling seven days. The previous copy remains in history.",
            "muted",
          ),
        );
      } else if (s.state === "active") {
        const close = el("button", "Review immediate exit", "secondary");
        close.addEventListener("click", () =>
          callTool("stop_copy", { copy_id: s.copy_id, mode: "close_now" }),
        );
        controls.append(close);
      }
      root.append(controls);
    }
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
  if (d.performance) renderPerformance(root, d.performance, callTool);
  if (d.diagnostic) renderDiagnostic(root, d.diagnostic);
  if (d.notification_preferences) renderNotifications(root, d, callTool);
  for (const warning of value.warnings ?? [])
    root.append(el("p", warning, "warning"));
  root.append(
    el(
      "footer",
      `Data as of ${value.as_of ?? "Unavailable"}. Configuration, submission, fill and settlement are separate states.`,
    ),
  );
}
function field(parent, label, type, value) {
  const wrap = el("label", label, "field");
  const input = el("input");
  input.type = type;
  input.value = String(value);
  wrap.append(input);
  parent.append(wrap);
  return input;
}
function select(parent, label, options, value) {
  const wrap = el("label", label, "field"),
    input = el("select");
  for (const [id, text] of options) {
    const option = el("option", text);
    option.value = id;
    input.append(option);
  }
  input.value = value;
  wrap.append(input);
  parent.append(wrap);
  return input;
}
function welcome(root, callTool, pref = {}) {
  root.append(
    el("h1", "Build your trader basket"),
    el(
      "p",
      "Explore traders, review a plan, then fund and confirm inside Ride.",
      "muted",
    ),
  );
  const form = card("Your preferences");
  const budget = field(
    form,
    "Budget · USDC",
    "text",
    pref.budget_usdc ?? "500",
  );
  budget.inputMode = "decimal";
  const loss = field(
    form,
    "Portfolio loss trigger · %",
    "number",
    pref.loss_trigger_pct ?? 40,
  );
  loss.min = "1";
  loss.max = "100";
  const market = select(
    form,
    "Market",
    [
      ["perps", "Perps"],
      ["prediction", "Prediction"],
      ["both", "Both markets"],
    ],
    pref.market ?? "perps",
  );
  const assets = field(
    form,
    "Perps assets · comma separated",
    "text",
    (pref.assets ?? ["BTC", "ETH"]).join(","),
  );
  const alt = select(
    form,
    "Other Perps assets",
    [
      ["false", "Use listed assets only"],
      ["true", "Allow other assets"],
    ],
    String(pref.allow_altcoins ?? false),
  );
  const b = el("button", "View traders first");
  b.addEventListener("click", () =>
    callTool("recommend_traders", {
      preferences: {
        budget_usdc: budget.value.trim(),
        loss_trigger_pct: Number(loss.value),
        market: market.value,
        assets: assets.value
          .split(",")
          .map((v) => v.trim().toUpperCase())
          .filter(Boolean),
        allow_altcoins: alt.value === "true",
      },
    }),
  );
  const resume = el("button", "Resume saved plan", "secondary");
  resume.addEventListener("click", () => callTool("get_portfolio", {}));
  const actions = el("div", null, "actions");
  actions.append(b, resume);
  form.append(
    actions,
    el(
      "p",
      "You can preview without a balance. Loss triggers initiate exits and can be exceeded by slippage.",
      "muted",
    ),
  );
  root.append(form);
}
function planEditor(plan, data, callTool, start) {
  const c = card("Adjust your basket · 3–6 traders"),
    rows = el("div", null, "grid"),
    editors = [];
  const candidates = data.candidates ?? plan.allocations.map((a) => a.trader);
  const limits = new Map(
    (data.candidate_limits ?? []).map((x) => [x.trader_id, x.leverage_cap]),
  );
  const dirty = () => {
    start.disabled = true;
    note.textContent = "Changes need recalculation before you can start.";
  };
  const note = el(
    "p",
    "Current parameters are validated by Ride. Capital weights are not live exposure.",
    "muted",
  );
  function add(a) {
    const r = card("Trader allocation");
    const trader = select(
      r,
      "Trader",
      candidates.map((t) => [
        t.id,
        `${t.handle} · ${t.market} · Score ${t.score}`,
      ]),
      a.trader.id,
    );
    const amount = field(r, "Allocation · USDC", "text", a.amount_usdc);
    amount.inputMode = "decimal";
    const leverage = field(r, "Leverage cap", "number", a.leverage_cap);
    leverage.min = "1";
    leverage.max = "8";
    const loss = field(r, "Sleeve loss trigger · %", "number", a.stop_loss_pct);
    loss.min = "1";
    loss.max = "100";
    const editor = { r, trader, amount, leverage, loss };
    editors.push(editor);
    r.addEventListener("input", dirty);
    trader.addEventListener("change", () => {
      leverage.value = String(
        Math.min(Number(leverage.value), limits.get(trader.value) ?? 1),
      );
      dirty();
    });
    const remove = el("button", "Remove", "secondary");
    remove.addEventListener("click", () => {
      if (editors.length <= 3) {
        note.textContent = "Keep at least three traders.";
        return;
      }
      editors.splice(editors.indexOf(editor), 1);
      r.remove();
      dirty();
    });
    r.append(remove);
    rows.append(r);
  }
  plan.allocations.forEach(add);
  c.append(rows);
  const plus = el("button", "Add another trader", "secondary");
  plus.addEventListener("click", () => {
    if (editors.length >= 6) {
      note.textContent = "The basket supports at most six traders.";
      return;
    }
    const trader = candidates.find(
      (t) => !editors.some((e) => e.trader.value === t.id),
    );
    if (!trader) {
      note.textContent = "No additional eligible trader is available.";
      return;
    }
    add({
      trader,
      amount_usdc: "50",
      leverage_cap: limits.get(trader.id) ?? 1,
      stop_loss_pct: 30,
    });
    dirty();
  });
  const recalc = el("button", "Recalculate and review");
  recalc.addEventListener("click", () =>
    callTool("recalculate_plan", {
      plan_id: plan.id,
      allocations: editors.map((e) => ({
        trader_id: e.trader.value,
        amount_usdc: e.amount.value.trim(),
        leverage_cap: Number(e.leverage.value),
        stop_loss_pct: Number(e.loss.value),
      })),
    }),
  );
  const actions = el("div", null, "actions");
  actions.append(plus, recalc);
  c.append(actions, note);
  const details = el("details");
  details.append(el("summary", "Edit allocations and traders"), c);
  return details;
}
function table(parent, headers, rows) {
  const wrap = el("div", null, "table-wrap"),
    t = el("table"),
    head = el("tr");
  headers.forEach((v) => head.append(el("th", v)));
  t.append(head);
  for (const values of rows) {
    const r = el("tr");
    values.forEach((v) => r.append(el("td", val(v))));
    t.append(r);
  }
  wrap.append(t);
  parent.append(wrap);
}
function renderPerformance(root, p, callTool) {
  root.append(el("h1", "Performance history"));
  const c = card(`${p.period} · ${p.coverage}`);
  c.append(
    row("Observed-period net profit", usdc(p.net_profit_usdc)),
    row("Inception net profit", usdc(p.inception_net_profit_usdc)),
  );
  const windowText = (w) =>
    w
      ? `${new Date(w.start_at).toLocaleString()} — ${new Date(w.end_at).toLocaleString()}`
      : null;
  c.append(
    row("Requested window", windowText(p.requested_window)),
    row("Observed window", windowText(p.observed_window)),
  );
  if (p.series_truncated)
    c.append(
      el(
        "p",
        "Displaying the latest 366 daily marks; older snapshots remain stored.",
        "muted",
      ),
    );
  if (p.missing_reason) c.append(el("p", p.missing_reason, "warning"));
  const actions = el("div", null, "actions");
  for (const period of ["daily", "weekly", "inception"]) {
    const b = el("button", period, "secondary");
    b.addEventListener("click", () =>
      callTool("get_performance", { portfolio_id: p.portfolio_id, period }),
    );
    actions.append(b);
  }
  c.append(actions);
  table(
    c,
    ["Observed at", "Net profit · USDC", "Accounting"],
    p.points.map((x) => [
      new Date(x.at).toLocaleString(),
      x.net_profit_usdc,
      x.reconciliation,
    ]),
  );
  const latest = p.points.at(-1);
  if (latest)
    table(
      c,
      ["Historical copy", "State", "Net contribution · USDC"],
      latest.sleeves.map((s) => [s.handle, s.state, s.net_profit_usdc]),
    );
  c.append(
    el(
      "p",
      "Historical points keep their original trader identities. External deposits and withdrawals are excluded from net profit; unobserved periods stay unavailable.",
      "muted",
    ),
  );
  root.append(c);
}
function renderDiagnostic(root, d) {
  root.append(el("h1", `Copy diagnosis · ${d.trader}`));
  const c = card("Evidence in the same time window");
  c.append(
    row(
      "Window",
      `${new Date(d.window.start_at).toLocaleString()} — ${new Date(d.window.end_at).toLocaleString()}`,
    ),
    row("Source coverage", d.source_coverage),
    row("Follower coverage", d.follower_coverage),
    row("Attributed fees", usdc(d.fees_usdc)),
  );
  c.append(
    row(
      "Follower verified through",
      d.follower_verified_through
        ? new Date(d.follower_verified_through).toLocaleString()
        : null,
    ),
  );
  c.append(el("h2", "Source fills"));
  table(
    c,
    ["Time", "Asset", "Quantity", "Price", "Fee · USDC"],
    d.source_fills.map((f) => [
      new Date(f.at).toLocaleString(),
      f.key,
      f.quantity,
      f.price,
      f.fee_usdc,
    ]),
  );
  c.append(el("h2", "Your attributed fills"));
  table(
    c,
    [
      "Time",
      "Asset",
      "Quantity",
      "Price",
      "Fee · USDC",
      "Leverage cap at fill",
    ],
    d.follower_fills.map((r) => [
      new Date(r.fill.at).toLocaleString(),
      r.fill.key,
      r.quantity,
      r.fill.price,
      r.fee_usdc,
      r.config?.leverage_cap,
    ]),
  );
  c.append(el("h2", "Entry decisions"));
  table(
    c,
    ["Time", "Asset", "Reason", "Target quantity", "Leverage cap"],
    d.decisions.map((x) => [
      new Date(x.at).toLocaleString(),
      x.key,
      x.reason,
      x.target_quantity,
      x.config.leverage_cap,
    ]),
  );
  c.append(el("h2", "Execution and funding evidence"));
  table(
    c,
    ["Asset", "Execution state", "Error"],
    (d.executions ?? []).map((e) => [e.key, e.status, e.error]),
  );
  table(
    c,
    ["Funding time", "Asset", "Amount · USDC"],
    (d.funding ?? []).map((f) => [
      new Date(f.at).toLocaleString(),
      f.key,
      f.amount_usdc,
    ]),
  );
  for (const event of d.events ?? [])
    c.append(el("p", `${event.kind} · ${event.message}`, "muted"));
  c.append(el("p", d.missing_reason, "warning"));
  if (d.source_missing_reason)
    c.append(el("p", d.source_missing_reason, "muted"));
  root.append(c);
}
function renderNotifications(root, d, callTool) {
  root.append(el("h1", "Daily Ride report"));
  const p = d.notification_preferences,
    c = card("Notification settings");
  const enabled = select(
    c,
    "Daily report",
    [
      ["false", "Off"],
      ["true", "On · Ride App push"],
    ],
    String(p.daily_digest),
  );
  const time = field(c, "Local delivery time", "time", p.local_time);
  const zone = field(c, "Timezone", "text", p.timezone);
  c.append(
    row("Push delivery", d.delivery.status),
    row("Device registered", d.delivery.device_registered ? "Yes" : "No"),
  );
  const b = el("button", "Save notification settings");
  b.addEventListener("click", () =>
    callTool("set_notification_preferences", {
      daily_digest: enabled.value === "true",
      local_time: time.value,
      timezone: zone.value.trim(),
    }),
  );
  c.append(
    b,
    el(
      "p",
      "Reports run on the Ride server. Critical risk alerts remain enabled. A registered Ride App device and configured push service are required for delivery.",
      "muted",
    ),
  );
  root.append(c);
}
function renderNestedPortfolio(root, p) {
  root.append(sleeveCards(p.sleeves ?? []));
}
