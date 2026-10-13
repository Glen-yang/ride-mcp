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
function sleeveCards(
  sleeves,
  callTool,
  addTrader,
  actionLabel = "Add to basket",
) {
  const grid = el("div", null, "grid");
  for (const s of sleeves) {
    const c = card(s.trader?.handle ?? s.copy_id);
    c.append(
      el("span", `${s.trader?.market ?? ""} · ${s.trader?.style ?? ""}`, "tag"),
      row("Copy Score", s.trader?.score),
      row("Allocation", usdc(s.amount_usdc)),
      row("Leverage cap", s.leverage_cap == null ? null : `${s.leverage_cap}x`),
      row(
        s.loss_policy === "pause_then_exit"
          ? "Pause new exposure"
          : "Sleeve exit trigger",
        s.stop_loss_pct == null ? null : `${s.stop_loss_pct}%`,
      ),
      row("Copy mode", s.copy_mode ?? "Ride recommended"),
      ...(s.copy_mode === "fixed"
        ? [row("Fixed margin per source entry", usdc(s.fixed_margin_usdc))]
        : []),
      ...(s.loss_policy === "pause_then_exit"
        ? [row("Emergency exit", `${s.emergency_exit_pct ?? 70}%`)]
        : []),
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
    if (addTrader && s.amount_usdc == null) {
      const add = el("button", actionLabel, "secondary");
      add.addEventListener("click", () => addTrader(s.trader));
      c.append(add);
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
  const d = value.data ?? {};
  if (d.account?.authenticated) {
    root.append(
      el(
        "p",
        `Signed in${d.account.display_name ? `: ${d.account.display_name}` : ""}`,
        "muted",
      ),
    );
  }
  const appCopies =
    d.app_copies ?? (d.query_scope === "ride_app_copies" ? d : null);
  if (appCopies) {
    const account = card("Your Ride App copies");
    for (const [name, market] of [
      ["Perps", appCopies.perps],
      ["Prediction", appCopies.prediction],
    ]) {
      account.append(
        row(`${name} copy configurations`, market?.configs?.length),
        row(
          `${name} enabled copies`,
          market?.configs?.filter((c) => c.isEnabled).length,
        ),
        row(`${name} current copied positions`, market?.positions?.length),
      );
    }
    account.append(
      el(
        "p",
        appCopies.coverage_complete
          ? "Account read complete. Manage these existing copies in Ride."
          : "Account read incomplete. Missing copies or positions are unavailable.",
        "muted",
      ),
    );
    root.append(account);
  }
  if (value.error) {
    root.append(el("p", value.error.message, "warning error"));
    return;
  }
  if (d.deposit_options)
    renderDepositOptions(root, d.deposit_options, callTool);
  if (d.deposit) renderDeposit(root, d.deposit, callTool);
  if (d.deposit_status) {
    const c = card("Deposit status");
    c.append(
      row("Status", d.deposit_status.status),
      row("Trading available", usdc(d.deposit_status.trading_balance_usdc)),
      row(
        "Saved plan shortfall",
        usdc(d.deposit_status.saved_plan_shortfall_usdc),
      ),
      row("Available to copy", d.deposit_status.available_to_copy),
      el("p", d.deposit_status.next_action, "muted"),
    );
    const check = el("button", "Check again", "secondary");
    check.addEventListener("click", () =>
      callTool("check_deposit_status", {
        deposit_id: d.deposit_status.deposit_id,
      }),
    );
    c.append(check);
    if (d.saved_plan_id) {
      const resume = el("button", "Refresh saved plan and review");
      resume.addEventListener("click", () =>
        callTool("recalculate_plan", { plan_id: d.saved_plan_id }),
      );
      c.append(resume);
    }
    root.append(c);
  }
  if (d.daily_checkin) {
    const c = card(
      d.daily_checkin.offer_review
        ? "Welcome back · daily portfolio review"
        : "Today’s check-in",
    );
    c.append(
      el(
        "p",
        d.daily_checkin.offer_review
          ? "Would you like to review the last 24 hours?"
          : "Your daily check-in has already been offered, or no Agent portfolio is active.",
        "muted",
      ),
    );
    if (d.daily_checkin.offer_review) {
      const b = el("button", "Review performance");
      b.addEventListener("click", () =>
        callTool("get_performance", {
          portfolio_id: d.daily_checkin.portfolio_id,
          period: "daily",
        }),
      );
      c.append(b);
    }
    root.append(c);
  }
  if (d.preference_collection && !d.preference_collection.ready) {
    const collection = d.preference_collection;
    root.append(
      el("p", collection.questions.map((q) => q.question).join(" "), "warning"),
    );
    welcome(root, callTool, collection.answers);
  } else if (d.preferences) welcome(root, callTool, d.preferences);
  if (d.funding) {
    const c = card("Fund your trading account"),
      f = d.funding;
    c.append(
      row("Amount", usdc(f.amount_usdc)),
      row("Status", f.status),
      row("Destination", f.destination),
    );
    const b = el("button", "Review and confirm funding in Ride");
    b.addEventListener("click", () => openLink(f.confirmation_url));
    c.append(
      b,
      el(
        "p",
        "No funds move until you confirm in Ride. Submitted or uncertain requests must be checked before retrying.",
        "muted",
      ),
    );
    root.append(c);
  }
  if (d.plan) {
    const plan = d.plan;
    root.append(
      el(
        "h1",
        d.query_scope === "agent_portfolio_and_ride_app"
          ? "Saved basket preview"
          : "Your trader basket",
      ),
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
      callTool("start_copy", {
        plan_id: plan.id,
        ...(start.dataset.compatibility
          ? { compatibility_ack: start.dataset.compatibility }
          : {}),
      }),
    );
    const refresh = el("button", "Refresh saved plan", "secondary");
    refresh.addEventListener("click", () =>
      callTool("recalculate_plan", {
        plan_id: plan.id,
        preferences: plan.preferences,
      }),
    );
    renderBatches(root, plan, d, callTool);
    renderCompatibility(root, plan, d, callTool, start);
    root.append(planEditor(plan, d, callTool, start));
    if (d.query_scope !== "agent_portfolio_and_ride_app")
      root.append(
        el(
          "div",
          "Preview works before funding. Use the Ride funding confirmation page to fund and activate the trading account, then refresh this saved plan and review a new proposal.",
          "warning",
        ),
      );
    const actions = el("div", null, "actions");
    const deposit = el("button", "Deposit into Ride", "secondary");
    deposit.addEventListener("click", () =>
      callTool("get_deposit_options", {}),
    );
    actions.append(start, refresh, deposit);
    root.append(actions);
    root.append(
      el(
        "p",
        "Leverage follows the selected risk tolerance and verified venue limits. A single-trader plan is concentrated. Review each trader’s pause/exit rules before confirming.",
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
    const portfolioStop = field(
      overview,
      "Portfolio loss trigger · %",
      "number",
      p.preferences.loss_trigger_pct,
    );
    const changeStop = el(
      "button",
      "Review portfolio stop change",
      "secondary",
    );
    changeStop.addEventListener("click", () =>
      callTool("update_portfolio", {
        portfolio_id: p.id,
        loss_trigger_pct: Number(portfolioStop.value),
      }),
    );
    overview.append(changeStop);
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
      const margin = field(
          controls,
          "Allocation · USDC",
          "text",
          s.amount_usdc,
        ),
        leverage = field(controls, "Leverage cap", "number", s.leverage_cap),
        pause = field(
          controls,
          "Trader pause/exit threshold · %",
          "number",
          s.stop_loss_pct,
        );
      const mode = select(
        controls,
        "Copy mode",
        [
          ["ride_recommends", "Ride recommended"],
          ["fixed", "Fixed margin"],
          ["proportional", "Proportional"],
        ],
        s.copy_mode ?? "ride_recommends",
      );
      const fixed = field(
          controls,
          "Fixed margin per source entry · USDC",
          "text",
          s.fixed_margin_usdc ?? "10",
        ),
        multiplier = field(
          controls,
          "Proportional multiplier",
          "number",
          s.proportional_multiplier ?? 1,
        );
      const lossPolicy = select(
          controls,
          "Trader loss policy",
          [
            ["exit", "Exit at threshold"],
            ["pause_then_exit", "Pause, then emergency exit"],
          ],
          s.loss_policy ?? "exit",
        ),
        emergency = field(
          controls,
          "Emergency exit threshold · %",
          "number",
          s.emergency_exit_pct ?? 70,
        );
      const edit = el("button", "Review parameter change", "secondary");
      edit.disabled = s.state === "closed";
      edit.addEventListener("click", () =>
        callTool("update_copy", {
          copy_id: s.copy_id,
          amount_usdc: margin.value.trim(),
          leverage_cap: Number(leverage.value),
          stop_loss_pct: Number(pause.value),
          copy_mode: mode.value,
          ...(mode.value === "fixed"
            ? { fixed_margin_usdc: fixed.value.trim() }
            : { proportional_multiplier: Number(multiplier.value) }),
          loss_policy: lossPolicy.value,
          ...(lossPolicy.value === "pause_then_exit"
            ? { emergency_exit_pct: Number(emergency.value) }
            : {}),
        }),
      );
      controls.append(edit);
      if (s.state === "risk_off") {
        const resume = el("button", "Review resuming new trades", "secondary");
        resume.addEventListener("click", () =>
          callTool("update_copy", {
            copy_id: s.copy_id,
            resume_new_trades: true,
          }),
        );
        controls.append(resume);
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
    const single = el("button", "Copy this trader only", "secondary");
    single.addEventListener("click", () => {
      root.replaceChildren();
      welcome(
        root,
        (name, args) =>
          callTool(
            name,
            name === "recommend_traders"
              ? { ...args, trader_ids: [t.id], batch_action: undefined }
              : args,
          ),
        {
          portfolio_kind: "single",
          basket_size: 1,
          market: t.market,
          assets: t.assets,
          asset_category: t.asset_category === "rwa" ? "rwa" : "crypto",
        },
      );
    });
    profile.append(single);
    if (d.saved_plan && d.saved_plan.preferences.portfolio_kind !== "single") {
      const add = el("button", "Add to saved basket", "secondary");
      add.addEventListener("click", () =>
        addToPlan(d.saved_plan, t, {}, callTool),
      );
      profile.append(add);
    }
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
  const budget = field(form, "Budget · USDC", "text", pref.budget_usdc ?? "");
  budget.inputMode = "decimal";
  const loss = field(
    form,
    "Portfolio loss trigger · %",
    "number",
    pref.loss_trigger_pct ?? "",
  );
  loss.min = "1";
  loss.max = "100";
  const market = select(
    form,
    "Market",
    [
      ["", "Choose a market"],
      ["perps", "Perps"],
      ["prediction", "Prediction"],
      ["both", "Both markets"],
    ],
    pref.market ?? "",
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
  const kind = select(
    form,
    "Portfolio type",
    [
      ["basket", "Auto-Ride basket · 2–8 traders"],
      ["single", "One trader"],
    ],
    pref.portfolio_kind ?? "basket",
  );
  const size = field(form, "Basket size", "number", pref.basket_size ?? 4);
  size.min = "2";
  size.max = "8";
  const tolerance = select(
    form,
    "Risk tolerance",
    [
      ["low", "Low"],
      ["medium", "Medium"],
      ["high", "High"],
    ],
    pref.risk_tolerance ?? "medium",
  );
  const category = select(
    form,
    "Asset category",
    [
      ["crypto", "Crypto"],
      ["rwa", "Stocks and other RWA"],
      ["any", "No strong preference"],
    ],
    pref.asset_category ?? "crypto",
  );
  const mode = select(
    form,
    "Copy mode",
    [
      ["ride_recommends", "Let Ride recommend"],
      ["fixed", "Fixed margin per source entry"],
      ["proportional", "Proportional"],
    ],
    pref.copy_mode ?? "ride_recommends",
  );
  const fixed = field(
    form,
    "Fixed margin · USDC",
    "text",
    pref.fixed_margin_usdc ?? "10",
  );
  const multiplier = field(
    form,
    "Proportional multiplier",
    "number",
    pref.proportional_multiplier ?? 1,
  );
  const policy = select(
    form,
    "Trader loss policy",
    [
      ["pause_then_exit", "Pause at 30%, exit at 70%"],
      ["exit", "Exit at trader threshold"],
    ],
    pref.loss_policy ?? "pause_then_exit",
  );
  const b = el("button", "View traders first");
  const validatePreferences = () => {
    b.disabled =
      !budget.value.trim() ||
      Number(budget.value) <= 0 ||
      Number(loss.value) < 1 ||
      Number(loss.value) > 100 ||
      !market.value;
  };
  for (const input of [budget, loss, market])
    input.addEventListener("input", validatePreferences);
  validatePreferences();
  b.addEventListener("click", () =>
    callTool("recommend_traders", {
      batch_action: "first",
      preferences: {
        budget_usdc: budget.value.trim(),
        loss_trigger_pct: Number(loss.value),
        market: market.value,
        assets: assets.value
          .split(",")
          .map((v) => v.trim().toUpperCase())
          .filter(Boolean),
        allow_altcoins: alt.value === "true",
        portfolio_kind: kind.value,
        basket_size: kind.value === "single" ? 1 : Number(size.value),
        risk_tolerance: tolerance.value,
        asset_category: category.value,
        copy_mode: mode.value,
        ...(mode.value === "fixed"
          ? { fixed_margin_usdc: fixed.value.trim() }
          : { proportional_multiplier: Number(multiplier.value) }),
        loss_policy: policy.value,
        ...(policy.value === "pause_then_exit"
          ? { emergency_exit_pct: 70 }
          : {}),
      },
    }),
  );
  const resume = el("button", "Resume saved plan", "secondary");
  resume.addEventListener("click", () => callTool("get_portfolio", {}));
  const actions = el("div", null, "actions");
  const deposit = el("button", "Deposit into Ride", "secondary");
  deposit.addEventListener("click", () => callTool("get_deposit_options", {}));
  const checkin = el("button", "Daily portfolio check-in", "secondary");
  checkin.addEventListener("click", () =>
    callTool("get_daily_checkin", {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  );
  actions.append(b, resume, deposit, checkin);
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
  const c = card(
      plan.preferences.portfolio_kind === "single"
        ? "Adjust your trader"
        : "Adjust your basket",
    ),
    rows = el("div", null, "grid"),
    editors = [];
  const candidates = data.candidates ?? plan.allocations.map((a) => a.trader);
  const limits = new Map(
    (data.candidate_limits ?? []).map((x) => [x.trader_id, x.leverage_cap]),
  );
  const dirty = () => {
    start.dataset.dirty = "true";
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
    const mode = select(
        r,
        "Copy mode",
        [
          ["ride_recommends", "Ride recommended"],
          ["fixed", "Fixed margin"],
          ["proportional", "Proportional"],
        ],
        a.copy_mode ?? "ride_recommends",
      ),
      fixed = field(
        r,
        "Fixed margin · USDC",
        "text",
        a.fixed_margin_usdc ?? "10",
      ),
      multiplier = field(
        r,
        "Proportional multiplier",
        "number",
        a.proportional_multiplier ?? 1,
      ),
      policy = select(
        r,
        "Loss policy",
        [
          ["exit", "Exit at threshold"],
          ["pause_then_exit", "Pause then emergency exit"],
        ],
        a.loss_policy ?? "exit",
      ),
      emergency = field(
        r,
        "Emergency exit · %",
        "number",
        a.emergency_exit_pct ?? 70,
      );
    const editor = {
      r,
      trader,
      amount,
      leverage,
      loss,
      mode,
      fixed,
      multiplier,
      policy,
      emergency,
    };
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
      if (
        editors.length <=
        (plan.preferences.portfolio_kind === "single"
          ? 1
          : plan.preferences.portfolio_kind === "basket"
            ? 2
            : 3)
      ) {
        note.textContent = "Keep the minimum number of traders for this plan.";
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
    if (
      editors.length >=
      (plan.preferences.portfolio_kind === "single"
        ? 1
        : plan.preferences.portfolio_kind === "basket"
          ? 8
          : 6)
    ) {
      note.textContent = "This plan has reached its trader limit.";
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
      preferences: plan.preferences,
      allocations: editors.map((e) => ({
        trader_id: e.trader.value,
        amount_usdc: e.amount.value.trim(),
        leverage_cap: Number(e.leverage.value),
        stop_loss_pct: Number(e.loss.value),
        copy_mode: e.mode.value,
        ...(e.mode.value === "fixed"
          ? { fixed_margin_usdc: e.fixed.value.trim() }
          : { proportional_multiplier: Number(e.multiplier.value) }),
        loss_policy: e.policy.value,
        ...(e.policy.value === "pause_then_exit"
          ? { emergency_exit_pct: Number(e.emergency.value) }
          : {}),
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
  const chart = el("div", null, "performance-chart");
  const chartActions = el("div", null, "actions");
  for (const [metric, label] of [
    ["net_profit_usdc", "Cumulative net profit"],
    ["account_value_usdc", "Account value"],
  ]) {
    const button = el("button", label, "secondary");
    button.addEventListener("click", () =>
      drawPerformance(chart, p.points, metric, label),
    );
    chartActions.append(button);
  }
  c.append(chartActions, chart);
  drawPerformance(chart, p.points, "net_profit_usdc", "Cumulative net profit");
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
  if (p.recent_fills?.length)
    table(
      c,
      [
        "Time",
        "Trader",
        "Asset",
        "Quantity",
        "Fill price",
        "Realized · USDC",
        "Fee · USDC",
      ],
      p.recent_fills.map((f) => [
        new Date(f.at).toLocaleString(),
        f.trader,
        f.asset,
        f.quantity,
        f.price,
        f.realized_usdc,
        f.fee_usdc,
      ]),
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

function drawPerformance(root, points, metric, label) {
  root.replaceChildren(el("h3", label));
  const valid = points.filter(
    (p) => p[metric] != null && Number.isFinite(Number(p[metric])),
  );
  if (!valid.length) {
    root.append(el("p", "Verified history is unavailable.", "muted"));
    return;
  }
  const ns = "http://www.w3.org/2000/svg",
    svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 640 220");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${label} in USDC`);
  const min = Math.min(...valid.map((p) => Number(p[metric]))),
    max = Math.max(...valid.map((p) => Number(p[metric]))),
    range = Math.max(1, max - min);
  const first = points[0].at,
    last = points.at(-1).at,
    span = Math.max(1, last - first),
    segments = [];
  let segment = [];
  let previous = null;
  for (const p of points) {
    if (p[metric] == null || !Number.isFinite(Number(p[metric]))) {
      if (segment.length) segments.push(segment);
      segment = [];
      previous = null;
      continue;
    }
    if (previous && p.at - previous.at > 2 * 86400000) {
      if (segment.length) segments.push(segment);
      segment = [];
    }
    const x = 62 + ((p.at - first) / span) * 558,
      y = 178 - ((Number(p[metric]) - min) / range) * 140;
    segment.push([x, y]);
    previous = p;
    const dot = document.createElementNS(ns, "circle");
    dot.setAttribute("cx", x);
    dot.setAttribute("cy", y);
    dot.setAttribute("r", "3");
    dot.setAttribute("fill", "#8c740c");
    const title = document.createElementNS(ns, "title");
    title.textContent = `${new Date(p.at).toLocaleDateString()}: ${p[metric]} USDC`;
    dot.append(title);
    svg.append(dot);
  }
  if (segment.length) segments.push(segment);
  for (const values of segments) {
    const path = document.createElementNS(ns, "polyline");
    path.setAttribute("points", values.map((v) => v.join(",")).join(" "));
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "#c3a017");
    path.setAttribute("stroke-width", "2");
    svg.append(path);
  }
  for (const [value, y] of [
    [max, 38],
    [min, 178],
  ]) {
    const text = document.createElementNS(ns, "text");
    text.setAttribute("x", "4");
    text.setAttribute("y", y);
    text.setAttribute("font-size", "11");
    text.textContent = value.toFixed(2);
    svg.append(text);
  }
  root.append(
    svg,
    el(
      "p",
      metric === "account_value_usdc"
        ? "Account value includes external funding. Use net profit to assess trading performance."
        : "Net profit excludes external deposits and withdrawals. Missing periods remain gaps.",
      "muted",
    ),
  );
}

function renderCompatibility(root, plan, data, callTool, start) {
  const report = data.compatibility;
  if (!report) return;
  const c = card("Portfolio compatibility check");
  c.append(
    row("Overlap flags", report.warnings),
    el("p", report.missing_evidence, "muted"),
  );
  table(
    c,
    ["Traders", "Shared assets", "Same direction", "Similar holding period"],
    report.pairs.map((p) => [
      p.traders
        .map(
          (id) =>
            plan.allocations.find((a) => a.trader.id === id)?.trader.handle ??
            id,
        )
        .join(" / "),
      p.shared_assets.join(" / "),
      p.same_direction,
      p.similar_holding_period,
    ]),
  );
  if (report.warnings && plan.preferences.portfolio_kind) {
    const ack = field(
      c,
      "Keep this selection after reviewing its overlap warnings",
      "checkbox",
      "",
    );
    start.disabled = true;
    ack.addEventListener("change", () => {
      start.disabled =
        !ack.checked ||
        start.dataset.dirty === "true" ||
        plan.expires_at <= Date.now();
    });
    start.dataset.compatibility = report.fingerprint;
  }
  for (const suggestion of data.alternatives ?? []) {
    const b = el(
      "button",
      `Replace ${plan.allocations.find((a) => a.trader.id === suggestion.outgoing_trader_id)?.trader.handle} with ${suggestion.incoming_trader.handle} · ${suggestion.fewer_flags} fewer flags`,
      "secondary",
    );
    b.addEventListener("click", () =>
      callTool("recalculate_plan", {
        plan_id: plan.id,
        preferences: plan.preferences,
        allocations: plan.allocations.map((a) => ({
          trader_id:
            a.trader.id === suggestion.outgoing_trader_id
              ? suggestion.incoming_trader.id
              : a.trader.id,
          amount_usdc: a.amount_usdc,
          leverage_cap: a.leverage_cap,
          stop_loss_pct: a.stop_loss_pct,
          ...copyParameters(a),
        })),
      }),
    );
    c.append(b);
  }
  root.append(c);
}
const copyParameters = (a) =>
  Object.fromEntries(
    [
      "copy_mode",
      "fixed_margin_usdc",
      "proportional_multiplier",
      "loss_policy",
      "emergency_exit_pct",
    ]
      .filter((k) => a[k] != null)
      .map((k) => [k, a[k]]),
  );

function renderBatches(root, plan, data, callTool) {
  const batches = data.recommendation_batches;
  if (!batches) return;
  const c = card("Saved recommendation batches"),
    actions = el("div", null, "actions");
  batches.batches.forEach((_, index) => {
    const b = el(
      "button",
      `Batch ${index + 1}${batches.active_index === index ? " · current" : ""}`,
      "secondary",
    );
    b.addEventListener("click", () =>
      callTool("recommend_traders", {
        preferences: plan.preferences,
        batch_action: "saved",
        batch_index: index,
      }),
    );
    actions.append(b);
  });
  const next = el(
    "button",
    batches.preview_quota_applies === false
      ? "View another batch"
      : batches.change_used
        ? "Free batch change used"
        : "Change a batch · one free change",
    "secondary",
  );
  next.disabled =
    batches.change_used && batches.preview_quota_applies !== false;
  next.addEventListener("click", () =>
    callTool("recommend_traders", {
      preferences: plan.preferences,
      batch_action: "next",
    }),
  );
  actions.append(next);
  c.append(
    actions,
    el(
      "p",
      "Your current plan stays saved. Switching a batch does not activate or change copying.",
      "muted",
    ),
  );
  if (batches.displayed_candidates)
    c.append(
      sleeveCards(
        batches.displayed_candidates.map((trader) => ({
          trader,
          amount_usdc: null,
          leverage_cap: null,
          stop_loss_pct: null,
        })),
        callTool,
        (trader) => addToPlan(plan, trader, data, callTool),
        plan.preferences.portfolio_kind === "single"
          ? "Use this trader"
          : "Add to basket",
      ),
    );
  root.append(c);
}

function addToPlan(plan, trader, data, callTool) {
  if (plan.allocations.some((a) => a.trader.id === trader.id)) return;
  if (plan.preferences.portfolio_kind === "single") {
    const allocation = plan.allocations[0];
    const limit =
      data.candidate_limits?.find((x) => x.trader_id === trader.id)
        ?.leverage_cap ?? 1;
    callTool("recalculate_plan", {
      plan_id: plan.id,
      preferences: plan.preferences,
      allocations: [
        {
          trader_id: trader.id,
          amount_usdc: allocation.amount_usdc,
          leverage_cap: Math.min(allocation.leverage_cap, limit),
          stop_loss_pct: allocation.stop_loss_pct,
          ...copyParameters(allocation),
        },
      ],
    });
    return;
  }
  const max =
    plan.preferences.portfolio_kind === "single"
      ? 1
      : plan.preferences.portfolio_kind === "basket"
        ? 8
        : 6;
  if (plan.allocations.length >= max) return;
  const values = [
    ...plan.allocations,
    {
      trader,
      leverage_cap:
        data.candidate_limits?.find((x) => x.trader_id === trader.id)
          ?.leverage_cap ?? (trader.market === "prediction" ? 1 : 3),
      stop_loss_pct: 30,
      ...copyParameters(plan.preferences),
    },
  ];
  const [whole, fraction = ""] = String(plan.preferences.budget_usdc).split(
      ".",
    ),
    total = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0")),
    count = BigInt(values.length),
    base = total / count,
    remainder = total % count;
  callTool("recalculate_plan", {
    plan_id: plan.id,
    preferences: plan.preferences,
    allocations: values.map((a, i) => {
      const amount = base + (BigInt(i) < remainder ? 1n : 0n);
      return {
        trader_id: a.trader.id,
        amount_usdc: `${amount / 1000000n}.${String(amount % 1000000n).padStart(6, "0")}`,
        leverage_cap: a.leverage_cap,
        stop_loss_pct: a.stop_loss_pct,
        ...copyParameters(a),
      };
    }),
  });
}

function renderDepositOptions(root, options, callTool) {
  const c = card("Deposit into your Ride account");
  const market = select(
    c,
    "Destination",
    [
      ["perps", "Trading account"],
      ["prediction", "Prediction account"],
    ],
    "perps",
  );
  const asset = select(
    c,
    "Asset",
    [
      ["USDC", "USDC"],
      ["USDT", "USDT"],
    ],
    "USDC",
  );
  const network = select(c, "Network", [], "");
  const update = () => {
    network.replaceChildren();
    for (const route of options.routes.filter(
      (r) => r.market === market.value && r.asset === asset.value,
    )) {
      const o = el("option", route.network);
      o.value = route.network;
      network.append(o);
    }
    b.disabled = !network.options.length;
    note.textContent = network.options.length
      ? "Only currently supported routes are shown."
      : "No verified route for this account and asset. Choose another option.";
  };
  const amount = field(
    c,
    "Amount · optional, used for minimum checks",
    "text",
    "",
  );
  const b = el("button", "Get my deposit address and QR"),
    note = el("p", null, "muted");
  b.addEventListener("click", () =>
    callTool("get_deposit_address", {
      market: market.value,
      asset: asset.value,
      network: network.value,
      ...(amount.value.trim() ? { amount_usdc: amount.value.trim() } : {}),
    }),
  );
  market.addEventListener("change", update);
  asset.addEventListener("change", update);
  update();
  c.append(note, b);
  for (const n of options.notes ?? []) c.append(el("p", n, "muted"));
  root.append(c);
}
function renderDeposit(root, deposit, callTool) {
  const c = card(`Deposit ${deposit.asset} · ${deposit.network}`);
  c.append(
    row("Destination", deposit.destination),
    row("Network", deposit.network),
    row("Asset", deposit.asset),
  );
  const image = el("img");
  image.alt = `Receiving address QR for ${deposit.asset} on ${deposit.network}`;
  image.width = 240;
  image.height = 240;
  image.src = deposit.qr_data_url;
  image.className = "deposit-qr";
  c.append(
    image,
    el("code", deposit.address, "deposit-address"),
    el("p", deposit.instructions, "warning"),
  );
  const b = el("button", "Check deposit status");
  b.addEventListener("click", () =>
    callTool("check_deposit_status", { deposit_id: deposit.id }),
  );
  c.append(b);
  if (deposit.provider === "wallet") {
    const amount = field(
      c,
      "Amount to move into trading · USDC",
      "text",
      deposit.amount_usdc ?? "",
    );
    amount.inputMode = "decimal";
    const prepare = el("button", "Review trading-account funding", "secondary");
    prepare.addEventListener("click", () =>
      callTool("prepare_deposit", {
        deposit_id: deposit.id,
        amount_usdc: amount.value.trim(),
      }),
    );
    const validate = () => {
      prepare.disabled =
        !/^\d+(\.\d{1,6})?$/.test(amount.value.trim()) ||
        Number(amount.value) < 5;
    };
    amount.addEventListener("input", validate);
    validate();
    c.append(prepare);
  }
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
