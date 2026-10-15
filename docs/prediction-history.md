# Prediction historical risk metrics

Prediction score discovery previously returned null historical ROI and drawdown unconditionally. The Agent bridge now reads a separate, bounded historical data path; it does not require the live position or collateral reader used before execution.

Sources are the official Polymarket [v2 Data API](https://data-api.polymarket.com/v2/docs) and `/v1/accounting/snapshot` (also exposed by the [official Python SDK](https://github.com/Polymarket/py-sdk/blob/main/src/polymarket/_internal/actions/data.py)):

- `/v2/user-pnl?interval=1m&fidelity=1d`: cumulative economic PnL, including unrealized positions and wallet income. The API's funding fields can be null.
- `/v2/activity?start=1&type=DEPOSIT,WITHDRAWAL&exclude_deposits_withdrawals=false`: full funding history. Every cursor page repeats identical filters and must terminate explicitly. Missing, cyclic, malformed, or over-limit pagination makes the metric unavailable.
- `equity.csv` in the accounting snapshot: independent current cash plus marked positions. Historical equity plus subsequent funding must reconcile within 1% of this snapshot. This tolerance accommodates mark changes since the last daily observation; the exact difference is returned. It is a data-quality check, not proof of complete on-chain accounting.

For each daily observation, `E = cumulative deposits - cumulative withdrawals + cumulative economic PnL`. The unit NAV is linked using `NAV[i] / NAV[i-1] = (E[i] + interval withdrawals) / (E[i-1] + interval deposits)`. Drawdown is the largest percentage fall from a prior peak of that NAV; ROI is its cumulative return. Arithmetic uses Decimal. Deposits at the interval start and withdrawals at the interval end are a timing estimate, disclosed in `metric_provenance`.

The result is **one-month, daily sampled, cashflow-adjusted estimated account performance**. It is not all-time or intraday maximum drawdown, a follower return, or a future loss bound. The actual observed window, basis, sampling, estimation flag and reconciliation difference accompany both candidate and portfolio tables. Daily sampling can miss losses within a day.

At least 28 days of observations are required. Every observation needs finite PnL components, increasing timestamps and strictly increasing source blocks; repeated source blocks indicate carried observations and are rejected. Daily gaps, a missing initial deposit, nonpositive equity, conflicting funding totals, wrong wallet identity, marks older than 36 hours and failed reconciliation retain null metrics with a reason. Null is never converted to zero; validated zero drawdown is retained. Failures leave score discovery available but cannot pass the existing missing-risk-data gate.

History reads share a six-second deadline per trader and are cached for ten minutes (failures for one minute), bounded by history freshness. Candidate reads use two batches of ten. The existing 20% user loss trigger, Prediction 1x cap, 50 USDC per-trader minimum, live execution preflight and final human confirmation remain in force.
