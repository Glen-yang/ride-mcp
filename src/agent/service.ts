import {
  inputs,
  preferences,
  AgentError,
  result,
  type Preferences,
  type ToolName,
  type Result,
} from "./contracts.js";
import {
  D,
  cash,
  uid,
  fingerprint,
  now,
  fresh,
  recommend,
  aggregate,
  risk,
  pnl,
  type Portfolio,
  type Sleeve,
  type Plan,
} from "./domain.js";
import {
  Cursor,
  type Repository,
  type State,
  type Proposal,
  type Delegation,
} from "./repository.js";
import type { VenueAdapter } from "./adapter.js";

export class AgentService {
  constructor(
    readonly repository: Repository,
    readonly adapter: VenueAdapter,
    readonly confirmationBase: string,
    readonly cursor: Cursor,
  ) {}
  async tool(user: string, name: ToolName, input: unknown): Promise<Result> {
    const args = inputs[name].parse(input) as Record<string, unknown>;
    if (name === "get_trader_profile") {
      const c = await this.adapter.profile(args.trader_id as string);
      if (args.market && c.market !== args.market)
        throw new AgentError(
          "NOT_FOUND",
          "Trader does not belong to this market.",
          false,
          404,
        );
      return result({ trader: c });
    }
    if (name === "recommend_traders") {
      const pool = await this.adapter.candidates();
      return this.repository.transact(user, async (s) => {
        const pref = args.preferences
          ? preferences.parse(args.preferences)
          : s.preferences;
        if (!pref)
          throw new AgentError(
            "PREFERENCES_REQUIRED",
            "Set budget, loss trigger and market preference first.",
            false,
            400,
          );
        const plan = recommend(pref, pool);
        s.plans = s.plans.filter((x) => x.expires_at > now());
        s.plans.push(plan);
        return result({
          plan,
          portfolio_historical_drawdown_pct: null,
          reasons: plan.allocations.map((x) => ({
            trader_id: x.trader.id,
            reason: `Fresh ${x.trader.score_version} score; ${x.trader.style}; ${x.trader.direction}; budget-adjusted allocation.`,
          })),
        });
      });
    }
    return this.repository.transact(user, async (s) => {
      if (name === "set_preferences") {
        s.preferences = preferences.parse(args);
        return result({
          preferences: s.preferences,
          existing_portfolios_unchanged: true,
        });
      }
      if (name === "get_updates") {
        const c = args.cursor
          ? this.cursor.decode(user, args.cursor as string)
          : { at: 0, id: "" };
        const events = s.updates
          .filter((x) => x.at > c.at || (x.at === c.at && x.id > c.id))
          .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
        const page = events.slice(0, args.limit as number);
        const last = page.at(-1);
        return result(
          {
            updates: page.map(({ notification, ...event }) => event),
            next_cursor: last
              ? this.cursor.encode(user, last.at, last.id)
              : (args.cursor ?? null),
            has_more: events.length > page.length,
          },
          page.length ? "ok" : "empty",
        );
      }
      if (name === "get_portfolio") {
        const p = findPortfolio(s, args.portfolio_id as string | undefined);
        if (!p) return result({ portfolio: null }, "empty");
        try {
          p.snapshot = await this.adapter.account(user, p);
        } catch {
          /* Return explicitly stale stored snapshot; runner owns settlement. */
        }
        return portfolioView(p);
      }
      if (name === "review_portfolio") {
        const p = findPortfolio(s, args.portfolio_id as string | undefined);
        if (!p)
          return result(
            { portfolio: null, observations: [], suggestions: [] },
            "empty",
          );
        return result({
          portfolio_id: p.id,
          observations: review(p),
          suggestions: review(p).map((x) => ({
            observation: x,
            requires_confirmation: true,
          })),
          as_of: p.snapshot?.observed_at ?? null,
        });
      }
      return this.propose(user, s, name, args);
    });
  }
  private async propose(
    user: string,
    s: State,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Result> {
    let p: Portfolio,
      actionAmount = "0";
    if (name === "start_copy") {
      const plan = s.plans.find((x) => x.id === args.plan_id);
      if (!plan)
        throw new AgentError(
          "NOT_FOUND",
          "Plan not found for this account.",
          false,
          404,
        );
      if (plan.expires_at <= now())
        throw new AgentError("PLAN_EXPIRED", "Refresh trader recommendations.");
      if (s.portfolios.some((x) => x.state !== "closed"))
        throw new AgentError(
          "OWNERSHIP_CONFLICT",
          "An existing Agent portfolio must finish closing before starting another.",
        );
      p = fromPlan(plan);
      actionAmount = cash(plan.preferences.budget_usdc);
    } else {
      const owned = findByOwnership(s, args);
      if (!owned)
        throw new AgentError(
          "NOT_FOUND",
          "Owned copy or position not found.",
          false,
          404,
        );
      p = structuredClone(owned);
      if (args.replacement_trader_id) {
        args = {
          ...args,
          replacement_copy_id: uid("copy"),
          replacement_at: now(),
        };
      }
      await this.mutatePreview(p, args, name);
      const copy = owned.sleeves.find((x) => x.copy_id === args.copy_id);
      actionAmount =
        name === "update_copy"
          ? cash(
              D((args.amount_usdc as string) ?? copy?.amount_usdc ?? 0)
                .minus(copy?.amount_usdc ?? 0)
                .abs(),
            )
          : "0.000000";
    }
    const snapshot = await this.adapter.preflight(user, p);
    if (
      !fresh(snapshot.observed_at) ||
      !snapshot.eligible ||
      !snapshot.dedicated
    )
      throw new AgentError(
        "ACCOUNT_NOT_READY",
        "A fresh, eligible dedicated trading account is required.",
      );
    if (D(actionAmount).gt(snapshot.available_usdc))
      throw new AgentError(
        "INSUFFICIENT_FUNDS",
        "Verified available funds do not cover this change.",
      );
    for (const market of ["perps", "prediction"] as const) {
      const allocation = p.sleeves
        .filter((s) => s.trader.market === market && s.state !== "closed")
        .reduce((n, s) => n.plus(s.amount_usdc), D(0));
      if (
        snapshot.available_by_market?.[market] != null &&
        name === "start_copy" &&
        allocation.gt(snapshot.available_by_market[market]!)
      )
        throw new AgentError(
          "INSUFFICIENT_FUNDS",
          "Each market requires its own verified available funds.",
        );
    }
    p.snapshot = snapshot;
    const proposedTargets =
      name === "start_copy" ? [] : risk(p, snapshot.prices, true);
    if (name !== "start_copy") {
      const actual = aggregate(p, snapshot.prices, "actual");
      const additional = proposedTargets.reduce(
        (n, a) =>
          n.plus(
            D.max(
              0,
              D(a.net_notional_usdc)
                .abs()
                .minus(
                  D(
                    actual.find((x) => x.key === a.key)?.net_notional_usdc ?? 0,
                  ).abs(),
                ),
            ).div(
              Math.min(
                ...p.sleeves
                  .filter((s) => s.intents[a.key])
                  .map((s) =>
                    Math.min(s.leverage_cap, s.intents[a.key].source_leverage),
                  ),
                8,
              ),
            ),
          ),
        D(0),
      );
      actionAmount = cash(D.max(actionAmount, additional.times("1.003")));
      if (D(actionAmount).gt(snapshot.available_usdc))
        throw new AgentError(
          "INSUFFICIENT_FUNDS",
          "Removing this hedge requires additional verified margin.",
        );
    }
    const preview = {
      portfolio: portfolioView(p).data,
      proposed_positions: proposedTargets,
      action: name,
      parameters: args,
      loss_trigger_amount_usdc: cash(
        D(p.preferences.budget_usdc)
          .times(p.preferences.loss_trigger_pct)
          .div(100),
      ),
      existing_entry_max_deviation_pct: 0.2,
      fees: { estimate_usdc: null, exact_fee_at_settlement: true },
      execution_state: "not_submitted",
    };
    const existing = s.proposals.find(
      (x) =>
        x.status === "requires_confirmation" &&
        x.expires_at > now() &&
        x.action === name &&
        fingerprint(publicArguments(x.arguments)) ===
          fingerprint(publicArguments(args)) &&
        x.expected_revision === p.revision,
    );
    const proposal: Proposal = existing ?? {
      id: uid("proposal"),
      action: name,
      arguments: args,
      portfolio_id: p.id,
      expected_revision: p.revision,
      created_at: now(),
      expires_at: now() + 5 * 60_000,
      status: "requires_confirmation",
      snapshot_hash: fingerprint({
        account_id: snapshot.account_id,
        positions: snapshot.positions,
      }),
      amount_usdc: actionAmount,
      warnings: [
        "Loss thresholds trigger best-effort exits; losses can exceed the threshold.",
        "Activation is not proof of a fill.",
      ],
      preview,
    };
    if (!existing) s.proposals.push(proposal);
    const d = s.delegation;
    if (d && this.delegationAllows(d, p, proposal)) {
      await this.commit(user, s, proposal);
      return this.proposalView(proposal, s);
    }
    return this.proposalView(proposal, s);
  }
  async proposal(user: string, id: string): Promise<Result> {
    return this.repository.transact(user, async (s) => {
      const p = s.proposals.find((x) => x.id === id);
      if (!p)
        throw new AgentError("NOT_FOUND", "Proposal not found.", false, 404);
      return this.proposalView(p, s);
    });
  }
  async confirm(user: string, id: string, hash: string): Promise<Result> {
    return this.repository.transact(user, async (s) => {
      const p = s.proposals.find((x) => x.id === id);
      if (!p)
        throw new AgentError("NOT_FOUND", "Proposal not found.", false, 404);
      if (hash !== fingerprint(p.preview))
        throw new AgentError(
          "PROPOSAL_CHANGED",
          "The displayed proposal does not match the frozen confirmation.",
        );
      await this.commit(user, s, p);
      return this.proposalView(p, s);
    });
  }
  async reject(user: string, id: string): Promise<Result> {
    return this.repository.transact(user, async (s) => {
      const p = s.proposals.find((x) => x.id === id);
      if (!p)
        throw new AgentError("NOT_FOUND", "Proposal not found.", false, 404);
      if (p.status === "requires_confirmation") p.status = "rejected";
      return this.proposalView(p, s);
    });
  }
  async authorize(
    user: string,
    input: Omit<
      Delegation,
      "id" | "used_usdc" | "daily_used_usdc" | "day" | "revoked"
    >,
  ): Promise<Result> {
    return this.repository.transact(user, async (s) => {
      const p = findPortfolio(s, input.portfolio_id);
      if (!p)
        throw new AgentError("NOT_FOUND", "Portfolio not found.", false, 404);
      if (
        input.expires_at <= now() ||
        input.expires_at > now() + 30 * 86400_000 ||
        D(input.per_action_usdc).gt(input.daily_usdc) ||
        D(input.daily_usdc).gt(input.total_usdc) ||
        D(input.total_usdc).gt(p.preferences.budget_usdc) ||
        input.leverage_cap < 1 ||
        input.leverage_cap > 8
      )
        throw new AgentError(
          "INVALID_AUTHORITY",
          "Authorization limits exceed the portfolio or expiry constraints.",
          false,
          400,
        );
      s.delegation = {
        ...input,
        id: uid("grant"),
        used_usdc: "0",
        daily_used_usdc: "0",
        day: new Date().toISOString().slice(0, 10),
        revoked: false,
      };
      return result({ authorization: s.delegation });
    });
  }
  async revoke(user: string): Promise<Result> {
    return this.repository.transact(user, async (s) => {
      if (s.delegation) s.delegation.revoked = true;
      return result({ revoked: true });
    });
  }
  private delegationAllows(d: Delegation, p: Portfolio, q: Proposal): boolean {
    const day = new Date().toISOString().slice(0, 10);
    if (d.day !== day) {
      d.day = day;
      d.daily_used_usdc = "0";
    }
    return (
      !d.revoked &&
      d.expires_at > now() &&
      d.portfolio_id === p.id &&
      p.sleeves
        .filter((s) => s.state !== "closed")
        .every(
          (s) =>
            d.markets.includes(s.trader.market) &&
            s.leverage_cap <= d.leverage_cap &&
            s.trader.assets.every((a) => d.assets.includes(a)),
        ) &&
      D(q.amount_usdc).lte(d.per_action_usdc) &&
      D(d.used_usdc).plus(q.amount_usdc).lte(d.total_usdc) &&
      D(d.daily_used_usdc).plus(q.amount_usdc).lte(d.daily_usdc)
    );
  }
  private async commit(user: string, s: State, q: Proposal): Promise<void> {
    if (q.status === "queued" || q.status === "completed") return;
    if (q.status !== "requires_confirmation" || q.expires_at <= now())
      throw new AgentError("PROPOSAL_EXPIRED", "Create a fresh proposal.");
    let p = s.portfolios.find((x) => x.id === q.portfolio_id);
    if (q.action === "start_copy") {
      const plan = s.plans.find((x) => x.id === q.arguments.plan_id);
      if (
        !plan ||
        plan.expires_at <= now() ||
        s.portfolios.some((x) => x.state !== "closed")
      )
        throw new AgentError(
          "PLAN_CHANGED",
          "Plan expired or account ownership changed.",
        );
      p = fromPlan(plan, q.portfolio_id);
    }
    if (!p || p.revision !== q.expected_revision)
      throw new AgentError(
        "REVISION_CHANGED",
        "Portfolio changed; create a new proposal.",
      );
    const snapshot = await this.adapter.preflight(user, p);
    if (
      !fresh(snapshot.observed_at) ||
      !snapshot.eligible ||
      !snapshot.dedicated ||
      q.snapshot_hash !==
        fingerprint({
          account_id: snapshot.account_id,
          positions: snapshot.positions,
        })
    )
      throw new AgentError(
        "ACCOUNT_CHANGED",
        "Account state changed; review a fresh proposal.",
      );
    if (q.action === "start_copy")
      for (const market of ["perps", "prediction"] as const) {
        const allocation = p.sleeves
          .filter((s) => s.trader.market === market)
          .reduce((n, s) => n.plus(s.amount_usdc), D(0));
        if (
          snapshot.available_by_market?.[market] != null &&
          allocation.gt(snapshot.available_by_market[market]!)
        )
          throw new AgentError(
            "INSUFFICIENT_FUNDS",
            "Market available funds changed; review a fresh proposal.",
          );
      }
    const pending = p.executions
      .filter((e) => !["completed", "failed", "superseded"].includes(e.status))
      .reduce((n, e) => n.plus(e.reserve_usdc), D(0));
    if (D(q.amount_usdc).plus(pending).gt(snapshot.available_usdc))
      throw new AgentError(
        "INSUFFICIENT_FUNDS",
        "Available funds changed or are reserved by pending execution.",
      );
    if (q.action !== "start_copy")
      await this.mutatePreview(p, q.arguments, q.action as ToolName);
    p.snapshot = snapshot;
    p.revision++;
    p.control_id = q.id;
    q.committed_revision = p.revision;
    // Before changing target policy, reconcile Core's old tasks. The adapter
    // fences old revision work; no stale increasing order may survive a stop.
    if (p.account_id) await this.adapter.fence(user, p);
    if (!s.portfolios.some((x) => x.id === p!.id)) s.portfolios.push(p);
    q.status = "queued";
    if (s.delegation && this.delegationAllows(s.delegation, p, q)) {
      s.delegation.used_usdc = cash(
        D(s.delegation.used_usdc).plus(q.amount_usdc),
      );
      s.delegation.daily_used_usdc = cash(
        D(s.delegation.daily_used_usdc).plus(q.amount_usdc),
      );
    }
    event(
      s,
      "proposal_confirmed",
      p.id,
      "Confirmed parameters queued for execution.",
      { proposal_id: q.id },
    );
  }
  private async mutatePreview(
    p: Portfolio,
    args: Record<string, unknown>,
    name: ToolName,
  ): Promise<void> {
    let s = p.sleeves.find((x) => x.copy_id === args.copy_id);
    if (name === "close_position") {
      const positions = aggregate(p, p.snapshot?.prices ?? {}, "actual");
      const a = positions.find((x) => x.position_id === args.position_id);
      if (!a)
        throw new AgentError(
          "NOT_FOUND",
          "Owned aggregate position not found.",
          false,
          404,
        );
      for (const sleeve of p.sleeves) {
        if (sleeve.intents[a.key]) sleeve.intents[a.key].quantity = "0";
        if (!sleeve.suppressed.includes(a.key)) sleeve.suppressed.push(a.key);
      }
      risk(p, p.snapshot!.prices, true);
      return;
    }
    if (!s) throw new AgentError("NOT_FOUND", "Copy not found.", false, 404);
    if (name === "stop_copy") {
      s.state = args.mode === "close_now" ? "closing" : "wind_down";
      if (args.mode === "close_now")
        for (const x of Object.values(s.intents)) x.quantity = "0";
    }
    if (name === "update_copy") {
      if (args.replacement_trader_id) {
        if (
          s.state !== "closed" ||
          Object.values(s.lots).some((x) => !D(x.quantity).isZero()) ||
          p.reconciliation !== "complete" ||
          p.executions.some(
            (e) => !["completed", "failed", "superseded"].includes(e.status),
          )
        )
          throw new AgentError(
            "FUNDS_NOT_RELEASED",
            "Wind down and reconcile the old copy before replacing its allocation.",
          );
        if (
          p.sleeves.some(
            (x) =>
              x.replaced_at != null && now() - x.replaced_at < 7 * 86400_000,
          )
        )
          throw new AgentError(
            "REPLACEMENT_LIMIT",
            "One replacement is allowed per seven days.",
          );
        const trader = await this.adapter.profile(
          args.replacement_trader_id as string,
        );
        if (
          trader.eligibility !== "PASS" ||
          trader.expires_at <= now() ||
          (p.preferences.market !== "both" &&
            trader.market !== p.preferences.market) ||
          (trader.market === "perps" &&
            !trader.assets.every(
              (a) =>
                p.preferences.assets.includes(a) ||
                p.preferences.allow_altcoins,
            ))
        )
          throw new AgentError(
            "TRADER_INELIGIBLE",
            "Replacement is not eligible for this portfolio.",
          );
        const replacement: Sleeve = {
          ...s,
          copy_id: String(args.replacement_copy_id ?? uid("copy")),
          trader,
          state: "active",
          lots: {},
          intents: {},
          initialized: false,
          suppressed: [],
          source_revision: null,
          replaced_at: Number(args.replacement_at ?? now()),
        };
        p.sleeves.push(replacement);
        s.replaced_at = replacement.replaced_at;
        s = replacement;
      }
      if (args.amount_usdc !== undefined) {
        const next = D(args.amount_usdc as string),
          ratio = next.div(s.amount_usdc);
        const total = p.sleeves
          .filter((x) => x.state !== "closed")
          .reduce(
            (n, x) => n.plus(x.copy_id === s!.copy_id ? next : x.amount_usdc),
            D(0),
          );
        if (total.gt(p.preferences.budget_usdc))
          throw new AgentError(
            "BUDGET_EXCEEDED",
            "Sleeve allocations exceed the approved budget.",
          );
        for (const x of Object.values(s.intents))
          x.quantity = D(x.quantity).times(ratio).toString();
        s.amount_usdc = cash(next);
      }
      if (args.leverage_cap !== undefined) {
        if (s.trader.market === "prediction" && args.leverage_cap !== 1)
          throw new AgentError(
            "INVALID_LEVERAGE",
            "Prediction positions require leverage 1.",
          );
        s.leverage_cap = args.leverage_cap as number;
      }
      if (args.stop_loss_pct !== undefined)
        s.stop_loss_pct = args.stop_loss_pct as number;
    }
    if (p.snapshot) risk(p, p.snapshot.prices, true);
  }
  private proposalView(p: Proposal, state: State): Result {
    const portfolio = state.portfolios.find((x) => x.id === p.portfolio_id);
    const tasks =
      portfolio?.executions
        .filter(
          (e) =>
            e.revision === (p.committed_revision ?? p.expected_revision + 1),
        )
        .map(({ allocations, fingerprint, ...e }) => e) ?? [];
    return result(
      {
        proposal: {
          ...p,
          preview_hash: fingerprint(p.preview),
          confirmation_url: new URL(
            `/agent/confirm/${p.id}`,
            this.confirmationBase,
          ).href,
          execution_tasks: tasks,
          portfolio_state: portfolio?.state ?? null,
        },
      },
      p.status === "requires_confirmation"
        ? "requires_confirmation"
        : p.status === "queued"
          ? "queued"
          : p.status === "completed"
            ? "completed"
            : "failed",
      p.warnings,
    );
  }
}
export function fromPlan(plan: Plan, id = uid("portfolio")): Portfolio {
  return {
    id,
    account_id: null,
    revision: 0,
    state: "activating",
    preferences: plan.preferences,
    sleeves: plan.allocations.map((a) => ({
      ...a,
      state: "active",
      lots: {},
      intents: {},
      initialized: false,
      suppressed: [],
      source_revision: null,
      last_source_at: null,
      replaced_at: null,
    })),
    executions: [],
    snapshot: null,
    initial_equity: null,
    created_at: now(),
    ledger_started_at: null,
    seen_fills: [],
    seen_funding: [],
    seen_flows: [],
    flow_total: "0",
    reconciliation: "pending",
    loss_latched: false,
  };
}
function findPortfolio(s: State, id?: string): Portfolio | undefined {
  return id
    ? s.portfolios.find((x) => x.id === id)
    : ([...s.portfolios].reverse().find((x) => x.state !== "closed") ??
        s.portfolios.at(-1));
}
function findByOwnership(
  s: State,
  args: Record<string, unknown>,
): Portfolio | undefined {
  return s.portfolios.find((p) =>
    args.copy_id
      ? p.sleeves.some((x) => x.copy_id === args.copy_id)
      : aggregate(p, p.snapshot?.prices ?? {}, "actual").some(
          (x) => x.position_id === args.position_id,
        ),
  );
}
export function portfolioView(p: Portfolio): Result {
  const snap = p.snapshot,
    stats = pnl(p),
    stale = !snap || !fresh(snap.observed_at);
  let positions: ReturnType<typeof aggregate> = [];
  try {
    positions = aggregate(p, snap?.prices ?? {}, "actual");
  } catch {
    /* unavailable */
  }
  const pending = p.executions.filter(
    (e) => !["completed", "failed", "superseded"].includes(e.status),
  );
  return result(
    {
      portfolio: {
        id: p.id,
        revision: p.revision,
        state: p.state,
        preferences: p.preferences,
        account_value_usdc: snap?.account_value_usdc ?? null,
        available_usdc: stale ? null : (snap?.available_usdc ?? null),
        reserved_usdc: cash(
          pending.reduce((n, e) => n.plus(e.reserve_usdc), D(0)),
        ),
        allocated_usdc: cash(
          p.sleeves
            .filter((s) => s.state !== "closed")
            .reduce((n, s) => n.plus(s.amount_usdc), D(0)),
        ),
        net_profit_usdc: stats.net_usdc,
        external_flows_usdc: stats.external_flows_usdc,
        reconciliation: p.reconciliation,
        sleeves: p.sleeves.map((s) => ({
          copy_id: s.copy_id,
          trader: s.trader,
          amount_usdc: s.amount_usdc,
          leverage_cap: s.leverage_cap,
          stop_loss_pct: s.stop_loss_pct,
          state: s.state,
          net_profit_usdc:
            stats.sleeves.find((x) => x.copy_id === s.copy_id)?.net_usdc ??
            null,
        })),
        positions,
        executions: p.executions.map(({ allocations, fingerprint, ...e }) => e),
        as_of: snap?.observed_at ?? null,
        loss_trigger_amount_usdc: cash(
          D(p.preferences.budget_usdc)
            .times(p.preferences.loss_trigger_pct)
            .div(100),
        ),
      },
    },
    stale
      ? "stale"
      : p.executions.some((e) => e.status === "uncertain")
        ? "uncertain"
        : pending.some((e) => e.status === "partially_filled")
          ? "partially_filled"
          : pending.length
            ? "executing"
            : "ok",
  );
}
export function review(p: Portfolio): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const s of p.sleeves) {
    if (s.last_source_at == null || !fresh(s.last_source_at, 60_000))
      out.push({ kind: "source_stale", copy_id: s.copy_id });
    const inactive =
      s.trader.last_trade_at == null ? null : now() - s.trader.last_trade_at;
    const normal = Math.max(
      7 * 86400_000,
      (s.trader.median_hold_hours ?? 168) * 3600_000 * 2,
    );
    if (inactive != null && inactive > normal)
      out.push({
        kind: "inactivity",
        copy_id: s.copy_id,
        inactive_days: Math.floor(inactive / 86400_000),
        normal_hold_hours: s.trader.median_hold_hours,
      });
    if (s.trader.expires_at <= now())
      out.push({ kind: "score_stale", copy_id: s.copy_id });
  }
  if (p.reconciliation !== "complete")
    out.push({ kind: "accounting_incomplete" });
  if (p.loss_latched)
    out.push({
      kind: "loss_triggered",
      remaining_positions: aggregate(p, p.snapshot?.prices ?? {}, "actual"),
    });
  return out;
}
export function event(
  s: State,
  kind: string,
  portfolioId: string | null,
  message: string,
  data: Record<string, unknown> = {},
): void {
  s.updates.push({
    id: uid("update"),
    at: now(),
    kind,
    portfolio_id: portfolioId,
    message,
    data,
    notification: "pending",
  });
}

function publicArguments(args: Record<string, unknown>) {
  const { replacement_copy_id, replacement_at, ...publicArgs } = args;
  return publicArgs;
}
