import { unzipSync, strFromU8 } from "fflate";
import { D, now, type Candidate } from "./domain.js";

const DAY = 86_400_000;
const BASIS = "polymarket_economic_nav_1m_daily_cashflow_adjusted_v1";
type Metrics = Pick<
  Candidate,
  | "source_roi_pct"
  | "source_drawdown_pct"
  | "metric_window"
  | "metric_provenance"
  | "metric_unavailable_reason"
>;
type Flow = {
  timestamp: number;
  type: "DEPOSIT" | "WITHDRAWAL";
  usdc_size: number;
  proxy_wallet: string;
};
const validNumber = (x: unknown): x is number =>
  typeof x === "number" && Number.isFinite(x);
function requireData(ok: unknown, reason: string): asserts ok {
  if (!ok) throw new Error(reason);
}
function sameWallet(a: unknown, b: string) {
  return typeof a === "string" && a.toLowerCase() === b.toLowerCase();
}

export function accountingEquity(zip: Uint8Array) {
  const files = unzipSync(zip, {
    filter: (f) => {
      if (f.name !== "equity.csv") return false;
      requireData(
        f.originalSize > 0 && f.originalSize <= 4096,
        "invalid_equity_snapshot",
      );
      return true;
    },
  });
  requireData(files["equity.csv"], "invalid_equity_snapshot");
  const lines = strFromU8(files["equity.csv"]).trim().split(/\r?\n/);
  requireData(
    lines.length === 2 &&
      lines[0] === "cashBalance,positionsValue,equity,valuationTime",
    "invalid_equity_snapshot",
  );
  const fields = lines[1].split(",");
  requireData(
    fields.length === 4 &&
      fields.slice(0, 3).every((x) => /^\d+(\.\d+)?$/.test(x)),
    "invalid_equity_snapshot",
  );
  const [cash, positions, equity] = fields.slice(0, 3).map((x) => D(x));
  const at = Date.parse(fields[3]);
  requireData(
    Number.isFinite(at) &&
      equity.gt(0) &&
      cash.plus(positions).minus(equity).abs().lte("0.000002"),
    "invalid_equity_snapshot",
  );
  return { equity, at };
}

// The PnL endpoint currently leaves cumulative funding null. Its separately
// paginated DEPOSIT/WITHDRAWAL ledger supplies the missing capital, from genesis.
// PnL alone (or PnL / current balance) is never treated as an equity return.
export function predictionMetrics(
  wallet: string,
  series: any,
  flows: Flow[],
  snapshot: ReturnType<typeof accountingEquity>,
  at: number,
): Metrics {
  requireData(
    sameWallet(series?.proxy_wallet, wallet) &&
      series.interval === "1m" &&
      series.fidelity === "1d" &&
      series.source_fidelity === "1d",
    "invalid_history_identity",
  );
  const points: any[] = series.points;
  requireData(
    Array.isArray(points) && points.length >= 29 && points.length <= 33,
    "insufficient_history",
  );
  requireData(
    snapshot.at <= at + 60_000 && at - snapshot.at <= 5 * 60_000,
    "stale_equity_snapshot",
  );
  let priorTime = 0,
    priorBlock = 0;
  for (const p of points) {
    requireData(
      Number.isSafeInteger(p.timestamp) &&
        p.timestamp > priorTime &&
        Number.isSafeInteger(p.source_block) &&
        p.source_block > priorBlock &&
        p.source_block > 0,
      "invalid_or_carried_history_observation",
    );
    requireData(
      !priorTime || (p.timestamp - priorTime) * 1000 <= 26 * 3_600_000,
      "history_gap",
    );
    requireData(validNumber(p.economic_pnl), "missing_economic_pnl");
    // Cross-check the source composition; do not substitute zero for an atom.
    requireData(
      validNumber(p.position_pnl) &&
        validNumber(p.wallet_income) &&
        D(p.position_pnl)
          .plus(p.wallet_income)
          .minus(p.economic_pnl)
          .abs()
          .lte("0.000002"),
      "invalid_pnl_composition",
    );
    priorTime = p.timestamp;
    priorBlock = p.source_block;
  }
  const first = points[0],
    last = points.at(-1)!;
  requireData(
    snapshot.at >= last.timestamp * 1000,
    "equity_snapshot_precedes_history",
  );
  requireData(
    last.timestamp * 1000 <= at + 60_000 &&
      at - last.timestamp * 1000 <= 36 * 3_600_000 &&
      (last.timestamp - first.timestamp) * 1000 >= 28 * DAY &&
      at - first.timestamp * 1000 <= 32 * DAY,
    "stale_or_short_history",
  );
  const ordered = [...flows].sort((a, b) => a.timestamp - b.timestamp);
  requireData(
    ordered.length > 0 &&
      ordered.some(
        (f) =>
          f.type === "DEPOSIT" &&
          f.timestamp <= first.timestamp &&
          f.usdc_size > 0,
      ),
    "missing_initial_capital",
  );
  for (const f of ordered) {
    requireData(
      sameWallet(f.proxy_wallet, wallet) &&
        (f.type === "DEPOSIT" || f.type === "WITHDRAWAL") &&
        Number.isSafeInteger(f.timestamp) &&
        f.timestamp > 0 &&
        f.timestamp * 1000 <= at + 60_000 &&
        validNumber(f.usdc_size) &&
        f.usdc_size >= 0,
      "invalid_funding_ledger",
    );
  }
  let index = 0,
    deposits = D(0),
    withdrawals = D(0),
    nav = D(1),
    peak = D(1),
    drawdown = D(0);
  let previous: {
    equity: ReturnType<typeof D>;
    deposits: ReturnType<typeof D>;
    withdrawals: ReturnType<typeof D>;
  } | null = null;
  for (const p of points) {
    while (index < ordered.length && ordered[index].timestamp <= p.timestamp) {
      const f = ordered[index++];
      if (f.type === "DEPOSIT") deposits = deposits.plus(f.usdc_size);
      else withdrawals = withdrawals.plus(f.usdc_size);
    }
    for (const [field, computed] of [
      ["deposits", deposits],
      ["withdrawals", withdrawals],
      ["cashflow_net", deposits.minus(withdrawals)],
    ] as const) {
      requireData(
        p[field] == null ||
          (validNumber(p[field]) &&
            D(p[field]).minus(computed).abs().lte("0.01")),
        "conflicting_funding_sources",
      );
    }
    const equity = deposits.minus(withdrawals).plus(p.economic_pnl);
    requireData(equity.gt(0), "nonpositive_historical_equity");
    if (previous) {
      // Daily source observations cannot place returns around intraday flows.
      // Gross deposits go at the start and withdrawals at the end of the day;
      // retain this timing estimate explicitly in the metric provenance.
      nav = nav
        .times(equity.plus(withdrawals.minus(previous.withdrawals)))
        .div(previous.equity.plus(deposits.minus(previous.deposits)));
      peak = D.max(peak, nav);
      drawdown = D.max(drawdown, D(1).minus(nav.div(peak)));
    }
    previous = { equity, deposits, withdrawals };
  }
  // Independent current equity catches absent/partial ledgers and unaccounted
  // transfers. Daily marks can move since the last PnL point: allow at most 1%
  // reconciliation difference, disclose it, and reject larger discrepancies.
  let expectedCurrent = previous!.equity;
  for (const f of ordered
    .slice(index)
    .filter((f) => f.timestamp * 1000 <= snapshot.at))
    expectedCurrent = expectedCurrent.plus(
      f.type === "DEPOSIT" ? f.usdc_size : -f.usdc_size,
    );
  const difference = expectedCurrent
    .minus(snapshot.equity)
    .abs()
    .div(snapshot.equity)
    .times(100);
  requireData(difference.lte(1), "equity_reconciliation_failed");
  return {
    source_roi_pct: nav.minus(1).times(100).toNumber(),
    source_drawdown_pct: drawdown.times(100).toNumber(),
    metric_window: {
      start_at: first.timestamp * 1000,
      end_at: last.timestamp * 1000,
      basis: BASIS,
    },
    metric_provenance: {
      source: "polymarket_data_v2_and_accounting_snapshot",
      sampling: "daily",
      estimated: true,
      cashflow_adjusted: true,
      flow_timing: "deposits_at_start_withdrawals_at_end",
      reconciliation_difference_pct: difference.toNumber(),
    },
  };
}

export class PredictionHistory {
  private cache = new Map<string, { until: number; value: Metrics }>();
  private pending = new Map<string, Promise<Metrics>>();
  async metrics(wallet: string): Promise<Metrics> {
    const key = wallet.toLowerCase(),
      cached = this.cache.get(key);
    if (cached && cached.until > now()) return cached.value;
    const existing = this.pending.get(key);
    if (existing) return existing;
    const promise = this.load(key)
      .catch((e): Metrics => ({
        source_roi_pct: null,
        source_drawdown_pct: null,
        metric_unavailable_reason:
          e instanceof Error && /^[a-z_]+$/.test(e.message)
            ? e.message
            : "history_source_unavailable",
      }))
      .then((value) => {
        this.cache.set(key, {
          until: value.metric_window
            ? Math.min(
                now() + 10 * 60_000,
                value.metric_window.end_at + 36 * 3_600_000,
              )
            : now() + 60_000,
          value,
        });
        // This is a bounded display cache, never an execution source snapshot.
        if (this.cache.size > 100)
          this.cache.delete(this.cache.keys().next().value!);
        return value;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }
  private async load(wallet: string): Promise<Metrics> {
    const signal = AbortSignal.timeout(6000);
    const read = async (
      path: string,
      params: Record<string, string>,
      zip = false,
    ) => {
      const url = new URL(path, "https://data-api.polymarket.com");
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      const r = await fetch(url, { signal, redirect: "error" });
      requireData(r.ok && r.body, "history_source_unavailable");
      let size = 0;
      const chunks: Uint8Array[] = [];
      for await (const chunk of r.body as any as AsyncIterable<Uint8Array>) {
        size += chunk.length;
        requireData(size <= 4 * 1024 * 1024, "history_response_too_large");
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      return zip ? accountingEquity(body) : JSON.parse(body.toString("utf8"));
    };
    const [pnl, snapshot] = await Promise.all([
      read("/v2/user-pnl", { user: wallet, interval: "1m", fidelity: "1d" }),
      read("/v1/accounting/snapshot", { user: wallet }, true),
    ]);
    const flows: Flow[] = [],
      seen = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const response = await read("/v2/activity", {
        user: wallet,
        start: "1",
        end: String(Math.ceil(snapshot.at / 1000)),
        type: "DEPOSIT,WITHDRAWAL",
        exclude_deposits_withdrawals: "false",
        limit: "1000",
        sort_direction: "ASC",
        ...(cursor ? { cursor } : {}),
      });
      requireData(
        Array.isArray(response.data) &&
          response.data.length <= 1000 &&
          typeof response.pagination?.has_more === "boolean",
        "incomplete_funding_ledger",
      );
      flows.push(...response.data);
      const next = response.pagination.next_cursor;
      if (!response.pagination.has_more) {
        requireData(next === null, "incomplete_funding_ledger");
        return predictionMetrics(wallet, pnl.data, flows, snapshot, now());
      }
      requireData(
        typeof next === "string" &&
          next.length > 0 &&
          !seen.has(next) &&
          response.data.length > 0,
        "incomplete_funding_ledger",
      );
      seen.add(next);
      cursor = next;
    }
    throw new Error("funding_ledger_page_limit");
  }
}
