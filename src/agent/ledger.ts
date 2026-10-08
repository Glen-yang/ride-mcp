import { AgentError } from "./contracts.js";
import {
  D,
  cash,
  type Portfolio,
  type Lot,
  type Fill,
  type Funding,
} from "./domain.js";

function trade(l: Lot, q: string, px: string): void {
  const old = D(l.quantity),
    delta = D(q),
    price = D(px);
  if (delta.isZero()) return;
  const closes = !old.isZero() && old.isPositive() !== delta.isPositive();
  const closed = closes ? D.min(old.abs(), delta.abs()) : D(0);
  const avg = old.isZero() ? D(0) : D(l.cost).div(old);
  l.realized = D(l.realized)
    .plus(closed.times(price.minus(avg)).times(old.isPositive() ? 1 : -1))
    .toString();
  const next = old.plus(delta);
  l.cost = (
    closes
      ? next.isZero()
        ? D(0)
        : next.isPositive() === old.isPositive()
          ? next.times(avg)
          : next.times(price)
      : D(l.cost).plus(delta.times(price))
  ).toString();
  l.quantity = next.toString();
}
function lot(p: Portfolio, sleeveId: string, key: string): Lot {
  const s = p.sleeves.find((x) => x.copy_id === sleeveId);
  if (!s) throw new AgentError("LEDGER_OWNER", "Unknown sleeve owner.");
  const intent = s.intents[key],
    existing = s.lots[key];
  if (existing) return existing;
  if (!intent)
    throw new AgentError("LEDGER_OWNER", "An owned intent is required.");
  return (s.lots[key] = {
    key,
    asset: intent.asset,
    market: intent.market,
    quantity: "0",
    cost: "0",
    realized: "0",
    fees: "0",
    funding: "0",
  });
}
// Internal crosses settle virtual sleeve transfers at the same observed mark.
// Their quantities sum to zero, and their combined PnL is conserved.
export function internalCross(
  p: Portfolio,
  key: string,
  price: string,
): Record<string, string> {
  const deltas = p.sleeves.map((s) => ({
    id: s.copy_id,
    q: D(s.intents[key]?.quantity ?? 0).minus(s.lots[key]?.quantity ?? 0),
  }));
  const buys = deltas.filter((x) => x.q.gt(0)),
    sells = deltas.filter((x) => x.q.lt(0));
  for (const buy of buys)
    for (const sell of sells) {
      const q = D.min(buy.q, sell.q.neg());
      if (q.isZero()) continue;
      trade(lot(p, buy.id, key), q.toString(), price);
      trade(lot(p, sell.id, key), q.neg().toString(), price);
      buy.q = buy.q.minus(q);
      sell.q = sell.q.plus(q);
    }
  return Object.fromEntries(
    deltas.filter((x) => !x.q.isZero()).map((x) => [x.id, x.q.toString()]),
  );
}
export function applyFill(p: Portfolio, fill: Fill): void {
  if (p.seen_fills.includes(fill.id)) return;
  const e = p.executions.find(
    (x) => x.task_id === fill.task_id && x.key === fill.key,
  );
  if (!e)
    throw new AgentError(
      "UNOWNED_FILL",
      "Exchange fill has no owned execution.",
    );
  const entries = Object.entries(e.allocations).filter(
      ([, q]) => !D(q).isZero(),
    ),
    total = entries.reduce((n, [, q]) => n.plus(q), D(0));
  const q = D(fill.quantity);
  if (
    total.isZero() ||
    q.isZero() ||
    q.isPositive() !== total.isPositive() ||
    entries.some(
      ([, allocation]) => D(allocation).isPositive() !== q.isPositive(),
    ) ||
    q.abs().gt(total.abs())
  )
    throw new AgentError(
      "FILL_MISMATCH",
      "Fill exceeds the unsettled owned execution.",
    );
  let remaining = q,
    feeRemaining = D(fill.fee_usdc);
  // Keep virtual ownership on the venue's quantity grid. A repeating decimal
  // share otherwise leaves the owned sum unequal to an exact exchange position.
  const decimals = Math.max(
    p.snapshot?.quantity_decimals?.[fill.key] ?? 8,
    q.decimalPlaces(),
    ...entries.map(([, allocation]) => D(allocation).decimalPlaces()),
  );
  for (let i = 0; i < entries.length; i++) {
    const [sid, remainingQ] = entries[i],
      last = i === entries.length - 1;
    const laterCapacity = entries
      .slice(i + 1)
      .reduce((n, [, allocation]) => n.plus(D(allocation).abs()), D(0));
    const proportional = q
      .abs()
      .times(D(remainingQ).abs())
      .div(total.abs())
      .toDecimalPlaces(decimals, 1);
    const minimum = D.max(0, remaining.abs().minus(laterCapacity));
    const part = last
      ? remaining
      : D.min(D(remainingQ).abs(), D.max(proportional, minimum)).times(
          q.isPositive() ? 1 : -1,
        );
    const fee = last ? feeRemaining : D(fill.fee_usdc).times(part.div(q));
    const l = lot(p, sid, fill.key);
    trade(l, part.toString(), fill.price);
    l.fees = D(l.fees).plus(fee).toString();
    e.allocations[sid] = D(remainingQ).minus(part).toString();
    remaining = remaining.minus(part);
    feeRemaining = feeRemaining.minus(fee);
  }
  p.seen_fills.push(fill.id);
}
export function applyFunding(
  p: Portfolio,
  event: Funding,
  holdings: Record<string, string>,
): void {
  if (p.seen_funding.includes(event.id)) return;
  const total = Object.values(holdings).reduce((n, q) => n.plus(q), D(0));
  if (total.isZero() && !D(event.amount_usdc).isZero())
    throw new AgentError(
      "FUNDING_MISMATCH",
      "Funding has no verified historical owned position.",
    );
  const entries = Object.entries(holdings).filter(([, q]) => !D(q).isZero());
  let remaining = D(event.amount_usdc);
  for (let i = 0; i < entries.length; i++) {
    const [sid, q] = entries[i];
    const share =
      i === entries.length - 1
        ? remaining
        : D(event.amount_usdc).times(D(q).div(total));
    const l = lot(p, sid, event.key);
    l.funding = D(l.funding).plus(share).toString();
    remaining = remaining.minus(share);
  }
  p.seen_funding.push(event.id);
}
export function reconcileQuantities(p: Portfolio): boolean {
  if (!p.snapshot?.coverage_complete) return false;
  const keys = new Set([
    ...Object.keys(p.snapshot.positions),
    ...p.sleeves.flatMap((s) => Object.keys(s.lots)),
  ]);
  for (const key of keys) {
    const actual = p.sleeves.reduce(
      (n, s) => n.plus(s.lots[key]?.quantity ?? 0),
      D(0),
    );
    if (!actual.eq(p.snapshot.positions[key] ?? 0)) return false;
  }
  return true;
}
