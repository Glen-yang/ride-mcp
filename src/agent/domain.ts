import { Decimal } from "decimal.js";
import { createHash, randomUUID } from "node:crypto";
import { AgentError, type Preferences } from "./contracts.js";

Decimal.set({ precision: 48, rounding: Decimal.ROUND_DOWN });
export const D = Object.assign((v: Decimal.Value) => new Decimal(v), {
  min: Decimal.min.bind(Decimal),
  max: Decimal.max.bind(Decimal),
});
export const cash = (v: Decimal.Value) => D(v).toFixed(6);
export const uid = (kind: string) =>
  `${kind}_${randomUUID().replaceAll("-", "")}`;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export const fingerprint = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
export const now = () => Date.now();
export const fresh = (at: number, ttl = 30_000) =>
  Number.isFinite(at) && at <= now() + 1000 && now() - at <= ttl;
export type Venue = "perps" | "prediction";
export interface Candidate {
  id: string;
  handle: string;
  market: Venue;
  score: number;
  score_version: string;
  components: Record<string, number | null>;
  scored_at: number;
  expires_at: number;
  eligibility: "PASS" | "REJECT";
  assets: string[];
  style: string;
  direction: "long" | "short" | "mixed";
  median_hold_hours: number | null;
  source_roi_pct: number | null;
  source_drawdown_pct: number | null;
  atr_pct: number | null;
  venue_max_leverage: number;
  min_notional_usdc: string;
  last_trade_at: number | null;
}
export interface Allocation {
  copy_id: string;
  trader: Candidate;
  amount_usdc: string;
  leverage_cap: number;
  stop_loss_pct: number;
}
export interface Plan {
  id: string;
  created_at: number;
  expires_at: number;
  preferences: Preferences;
  allocations: Allocation[];
  source_version: string;
}
export interface PositionIntent {
  key: string;
  asset: string;
  market: Venue;
  quantity: string;
  price: string;
  source_entry_price: string | null;
  source_leverage: number;
  observed_at: number;
  source_revision: string;
}
export interface Lot {
  key: string;
  asset: string;
  market: Venue;
  quantity: string;
  cost: string;
  realized: string;
  fees: string;
  funding: string;
}
export interface Sleeve extends Allocation {
  state: "active" | "wind_down" | "closing" | "closed" | "loss_triggered";
  lots: Record<string, Lot>;
  intents: Record<string, PositionIntent>;
  initialized: boolean;
  suppressed: string[];
  source_revision: string | null;
  last_source_at: number | null;
  replaced_at: number | null;
  reviewed_at?: number;
}
export interface Aggregate {
  position_id: string;
  key: string;
  asset: string;
  market: Venue;
  quantity: string;
  gross_notional_usdc: string;
  net_notional_usdc: string;
  margin_usdc: string;
  concentration_pct: string | null;
  sleeve_ids: string[];
}
export interface AccountSnapshot {
  account_id: string;
  observed_at: number;
  account_value_usdc: string;
  available_usdc: string;
  dedicated: boolean;
  eligible: boolean;
  positions: Record<string, string>;
  prices: Record<string, string>;
  quantity_decimals?: Record<string, number>;
  venue_accounts?: Record<string, string>;
  available_by_market?: Partial<Record<Venue, string>>;
  chain_block?: number;
  max_leverages: Record<string, number>;
  min_notionals: Record<string, string>;
  orders: { id: string; key: string; increases_risk: boolean }[];
  fills: Fill[];
  funding: Funding[];
  flows: Flow[];
  coverage_complete: boolean;
}
export interface Fill {
  id: string;
  order_id: string;
  task_id: string;
  key: string;
  quantity: string;
  price: string;
  fee_usdc: string;
  at: number;
}
export interface Funding {
  id: string;
  key: string;
  amount_usdc: string;
  at: number;
}
export interface Flow {
  id: string;
  amount_usdc: string;
  at: number;
}
export interface Execution {
  id: string;
  key: string;
  target_quantity: string;
  allocations: Record<string, string>;
  unfilled_allocations?: Record<string, string>;
  status:
    | "queued"
    | "submitted"
    | "partially_filled"
    | "settling"
    | "completed"
    | "failed"
    | "uncertain"
    | "superseded";
  revision: number;
  fingerprint: string;
  created_at: number;
  expires_at: number;
  task_id: string | null;
  observed_quantity: string | null;
  reserve_usdc: string;
  error: string | null;
}
export interface Portfolio {
  id: string;
  account_id: string | null;
  revision: number;
  state:
    | "activating"
    | "active"
    | "loss_triggered"
    | "closing"
    | "closed"
    | "attention";
  preferences: Preferences;
  sleeves: Sleeve[];
  executions: Execution[];
  snapshot: AccountSnapshot | null;
  initial_equity: string | null;
  created_at: number;
  ledger_started_at: number | null;
  seen_fills: string[];
  seen_funding: string[];
  seen_flows: string[];
  flow_total: string;
  reconciliation: "pending" | "complete" | "incomplete";
  loss_latched: boolean;
  control_id?: string;
  venue_accounts?: Record<string, string>;
  ledger_chain_block?: number;
}

export function allocate(budget: Decimal.Value, count: number): string[] {
  const micros = D(budget).times(1e6);
  if (!micros.isInteger() || count < 1)
    throw new AgentError(
      "INVALID_AMOUNT",
      "USDC requires at most six decimal places.",
    );
  const base = micros.div(count).floor(),
    remainder = micros.minus(base.times(count)).toNumber();
  return Array.from({ length: count }, (_, i) =>
    base
      .plus(i < remainder ? 1 : 0)
      .div(1e6)
      .toFixed(6),
  );
}
function recommendedLeverage(p: Preferences, c: Candidate): number | null {
  const drawdown = c.source_drawdown_pct;
  if (drawdown == null || !Number.isFinite(drawdown) || drawdown < 0)
    return null;
  const riskCap =
    drawdown === 0 ? 8 : Math.floor(p.loss_trigger_pct / drawdown);
  if (c.market === "prediction") return riskCap >= 1 ? 1 : null;
  const atrCap =
    c.atr_pct == null
      ? 3
      : Math.max(3, Math.min(8, Math.floor(12 / Math.max(c.atr_pct, 0.01))));
  const cap = Math.min(c.venue_max_leverage, atrCap, riskCap);
  return cap >= 3 ? cap : null;
}
export function recommend(p: Preferences, candidates: Candidate[]): Plan {
  const allowed = candidates
    .filter(
      (c) =>
        c.eligibility === "PASS" &&
        c.expires_at > now() &&
        fresh(c.scored_at, 36 * 3600_000) &&
        (p.market === "both" || c.market === p.market) &&
        c.assets.length > 0 &&
        recommendedLeverage(p, c) !== null &&
        (c.market === "prediction" ||
          c.assets.every(
            (a) =>
              p.assets.includes(a) ||
              (p.allow_altcoins && !["BTC", "ETH"].includes(a)),
          )),
    )
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const chosen: Candidate[] = [];
  while (chosen.length < 6 && allowed.length) {
    allowed.sort(
      (a, b) =>
        diversity(b, chosen) - diversity(a, chosen) || a.id.localeCompare(b.id),
    );
    const c = allowed.shift()!;
    const count = chosen.length + 1;
    if (D(p.budget_usdc).div(count).lt(c.min_notional_usdc)) continue;
    if (chosen.some((x) => D(p.budget_usdc).div(count).lt(x.min_notional_usdc)))
      continue;
    chosen.push(c);
  }
  if (chosen.length < 3)
    throw new AgentError(
      "NO_EXECUTABLE_PLAN",
      "Fewer than three fresh, eligible traders fit this budget and market preference.",
    );
  if (
    p.market === "both" &&
    !(["perps", "prediction"] as Venue[]).every((m) =>
      chosen.some((c) => c.market === m),
    )
  )
    throw new AgentError(
      "NO_EXECUTABLE_PLAN",
      "Both markets require eligible, executable candidates in each market.",
    );
  const amounts = allocate(p.budget_usdc, chosen.length);
  return {
    id: uid("plan"),
    created_at: now(),
    expires_at: now() + 10 * 60_000,
    preferences: p,
    source_version: [...new Set(chosen.map((c) => c.score_version))].join("+"),
    allocations: chosen.map((c, i) => ({
      copy_id: uid("copy"),
      trader: c,
      amount_usdc: amounts[i],
      leverage_cap: recommendedLeverage(p, c)!,
      stop_loss_pct: 30,
    })),
  };
}
function diversity(c: Candidate, chosen: Candidate[]): number {
  return (
    c.score -
    chosen.reduce(
      (n, x) =>
        n +
        (x.style === c.style ? 8 : 0) +
        (x.direction === c.direction ? 5 : 0) +
        (x.assets.join(",") === c.assets.join(",") ? 6 : 0) +
        (x.market === c.market ? 2 : 0),
      0,
    )
  );
}
export function aggregate(
  p: Portfolio,
  prices: Record<string, string>,
  book: "intent" | "actual" = "intent",
): Aggregate[] {
  const out = new Map<string, Aggregate>();
  for (const s of p.sleeves) {
    const rows =
      book === "intent" ? Object.values(s.intents) : Object.values(s.lots);
    for (const x of rows) {
      if (D(x.quantity).isZero()) continue;
      const price = prices[x.key];
      if (price == null || !D(price).gt(0))
        throw new AgentError(
          "STALE_PRICE",
          "A fresh price is required for every owned position.",
          true,
        );
      const a = out.get(x.key) ?? {
        position_id: `pos_${fingerprint([p.id, x.key]).slice(0, 32)}`,
        key: x.key,
        asset: x.asset,
        market: x.market,
        quantity: "0",
        gross_notional_usdc: "0",
        net_notional_usdc: "0",
        margin_usdc: "0",
        concentration_pct: null,
        sleeve_ids: [],
      };
      const notional = D(x.quantity).abs().times(price);
      const leverage =
        book === "intent"
          ? (x as PositionIntent).source_leverage
          : (s.intents[x.key]?.source_leverage ?? 1);
      a.quantity = D(a.quantity).plus(x.quantity).toString();
      a.gross_notional_usdc = D(a.gross_notional_usdc)
        .plus(notional)
        .toString();
      a.margin_usdc = D(a.margin_usdc)
        .plus(notional.div(Math.max(1, Math.min(s.leverage_cap, leverage))))
        .toString();
      a.sleeve_ids.push(s.copy_id);
      out.set(x.key, a);
    }
  }
  const total = [...out.values()].reduce(
    (n, a) => n.plus(a.gross_notional_usdc),
    D(0),
  );
  const byAsset = new Map<string, Decimal>();
  for (const a of out.values())
    byAsset.set(
      a.asset,
      (byAsset.get(a.asset) ?? D(0)).plus(a.gross_notional_usdc),
    );
  return [...out.values()].map((a) => ({
    ...a,
    gross_notional_usdc: cash(a.gross_notional_usdc),
    net_notional_usdc: cash(D(a.quantity).times(prices[a.key])),
    margin_usdc: cash(a.margin_usdc),
    concentration_pct: total.isZero()
      ? null
      : byAsset.get(a.asset)!.div(total).times(100).toFixed(6),
  }));
}
export function risk(
  p: Portfolio,
  prices: Record<string, string>,
  allowReduction = false,
): Aggregate[] {
  const next = aggregate(p, prices),
    prior = aggregate(p, prices, "actual");
  const gross = next.reduce((n, a) => n.plus(a.gross_notional_usdc), D(0));
  const margin = next.reduce((n, a) => n.plus(a.margin_usdc), D(0));
  const budget = D(p.preferences.budget_usdc);
  // A sleeve reserves its gross margin even when another sleeve offsets it.
  if (gross.gt(budget.times(8)) || margin.gt(budget))
    throw new AgentError(
      "BUDGET_EXCEEDED",
      "Target gross exposure or gross margin exceeds the approved budget.",
    );
  for (const a of next) {
    const old = prior.find((x) => x.key === a.key);
    const reduces =
      allowReduction &&
      D(a.net_notional_usdc)
        .abs()
        .lte(D(old?.net_notional_usdc ?? 0).abs()) &&
      D(a.gross_notional_usdc).lte(old?.gross_notional_usdc ?? 0);
    if (D(a.concentration_pct ?? 0).gt(60) && !reduces)
      throw new AgentError(
        "ASSET_CONCENTRATION",
        "An asset exceeds 60% of total gross sleeve exposure.",
      );
    if (a.market === "prediction" && D(a.quantity).lt(0))
      throw new AgentError(
        "INVALID_OUTCOME_POSITION",
        "Prediction outcome tokens cannot have negative inventory.",
      );
  }
  return next;
}
export function pnl(p: Portfolio): {
  net_usdc: string | null;
  sleeves: { copy_id: string; net_usdc: string | null }[];
  external_flows_usdc: string;
} {
  if (!p.snapshot || p.reconciliation !== "complete")
    return {
      net_usdc: null,
      sleeves: p.sleeves.map((s) => ({ copy_id: s.copy_id, net_usdc: null })),
      external_flows_usdc: cash(p.flow_total),
    };
  const rawSleeves = p.sleeves.map((s) => ({
    copy_id: s.copy_id,
    net_usdc: Object.values(s.lots).reduce(
      (n, l) =>
        n
          .plus(l.realized)
          .minus(l.fees)
          .plus(l.funding)
          .plus(
            D(l.quantity)
              .times(p.snapshot!.prices[l.key] ?? 0)
              .minus(l.cost),
          ),
      D(0),
    ),
  }));
  const total = rawSleeves.reduce((n, s) => n.plus(s.net_usdc), D(0));
  const accountDelta = D(p.snapshot.account_value_usdc)
    .minus(p.initial_equity ?? 0)
    .minus(p.flow_total);
  if (total.minus(accountDelta).abs().gt("0.000001"))
    return {
      net_usdc: null,
      sleeves: rawSleeves.map((s) => ({ copy_id: s.copy_id, net_usdc: null })),
      external_flows_usdc: cash(p.flow_total),
    };
  // Validate unrounded attribution, then conserve the verified account delta
  // when presenting each sleeve at micro-USDC precision.
  const shares = rawSleeves.map((s) => s.net_usdc.toDecimalPlaces(6));
  const remainder = D(cash(accountDelta)).minus(
    shares.reduce((n, share) => n.plus(share), D(0)),
  );
  if (!remainder.isZero() && shares.length) {
    const owner = rawSleeves.reduce(
      (best, s, i) =>
        s.net_usdc.abs().gt(rawSleeves[best].net_usdc.abs()) ? i : best,
      0,
    );
    shares[owner] = shares[owner].plus(remainder);
  }
  const sleeves = rawSleeves.map((s, i) => ({
    copy_id: s.copy_id,
    net_usdc: cash(shares[i].isZero() ? 0 : shares[i]),
  }));
  return {
    net_usdc: cash(accountDelta),
    sleeves,
    external_flows_usdc: cash(p.flow_total),
  };
}
