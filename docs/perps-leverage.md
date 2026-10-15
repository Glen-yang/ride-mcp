# Perps source leverage and optional user cap

New Agent Perps allocations use `leverage_mode: "follow_source"` and
`leverage_cap: null`: there is no extra user cap by default. Numeric settings
use `custom_cap`, editable from 1–40x like App Auto-Ride. Explicit `null` clears
the cap; omitted fields preserve it. Prediction remains at 1x.

Actual leverage is the minimum of verified source leverage, the optional user
cap and fresh per-asset exchange metadata. Missing source/venue evidence blocks
increases. Changed venue rules invalidate sizing even without a source trade;
the bridge rejects an increase if its frozen leverage no longer fits fresh
rules. Budget, gross margin, loss triggers, entry deviation and opening-order
minimum checks remain in place. Under-minimum orders are skipped without
increasing quantity or leverage.

Old approved allocations with no `leverage_mode` retain their numeric caps and
old validation. Changing or clearing a running cap creates a new frozen human
confirmation proposal. A delegation with a numeric cap never silently approves
a no-cap plan.

## Isolated rollout

Deploy only the independent Agent Core gRPC, Core execution, bridge, backend
and MCP gateway services, in that order. Keep old App API/worker/gRPC services
on their current deployments. Publish the backend's nullable input support
before exposing the new gateway tool schemas. No real plan activation or order
is needed for acceptance.

The opt-in Core bootstrap preserves old policy records, the current-policy
view's columns, values and access grants, and the SQLx migration registry. It
widens execution percentage precision to represent the existing Core 1–100
leverage wire range; that range is not substituted for a default user cap.
Legacy bindings retain their 100% exposure checks. Exchange limits and the
approved policy are still checked on execution.

Acceptance uses a disposable PostgreSQL database and simulated exchanges:
20-USDC plans, 10-USDC sleeves, optional 20x/40x caps, clearing caps, verified
source/venue limits above 40x, legacy 3x preservation and minimum-order skips.
