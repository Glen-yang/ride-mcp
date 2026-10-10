# Conversational V17 implementation · 0.3.0

The supplied HTML is a simulated reference. Production uses the same exploration, preview, funding and review sequence inside the MCP card resource. The host owns the conversation sidebar/composer; Ride owns tool data and cards. The original reference file is preserved.

## Behavior

| Reference requirement | Implementation |
| --- | --- |
| Trader exploration before deposit | Primary “View traders first”; recommendations do not require balance |
| Resume after funding | Saved plans remain account scoped; `get_portfolio` returns the last preview when no portfolio exists; `recalculate_plan` refreshes into a new plan |
| Alternatives and repeated editing | Selection controls call server validation directly; a single active editor uses its own element references; old cards cannot contribute duplicate amounts |
| Basket/risk rules | 3–6 unique traders, exact USDC decimals, capital weight ≤55%, Perps recommended caps 3–8× bounded by risk/venue, prediction 1×; live gross concentration ≤60% |
| Loss rules | Default sleeve trigger 30%; exits await reconciliation; no additional 70% rule or guaranteed maximum loss |
| Execution | Frozen proposals and human Ride confirmation; distinct configuration/submission/partial/uncertain/settlement states |
| Replacement | Close/wind down and reconcile old lots, verify available funds, then confirm replacement; one per rolling seven days, old copy preserved |
| Historical reports | Immutable hourly/event accounting marks, deposits/withdrawals excluded; displayed daily UTC series; gaps return null period profit |
| Diagnosis | Same-window source fills, attributed follower fills, decisions, historical parameters, funding and execution status; no invented pairing/counterfactual profit |
| Notifications | Opt-in daily Ride App digest, local time/IANA timezone, durable per-day deduplication and retry, digest backlog cancelled on opt-out |
| Other hosts | Same fifteen tools, Skill and CLI; MCP App buttons use the standard `tools/call` method |

The MCP App protocol follows the [official extension overview](https://apps.extensions.modelcontextprotocol.io/api/documents/Overview.html). Cards communicate through the host; no client signing secrets or direct venue requests are embedded.

## Coverage and limits

Recording starts when the new monitor observes an owned account. Earlier periods and missing event-time configurations cannot be backfilled from current trader selection. Old receipts are not reconstructed using current settings. Prediction source fill history remains explicitly unavailable; verified follower accounting remains usable. Source/follower fills are displayed as separate evidence unless causal linkage is recorded. Diagnostics do not prove hypothetical missed returns.

Daily UTC display marks are capped at the latest 366 days, with `series_truncated` and `full_snapshot_count` disclosed. Underlying snapshots remain stored. Push readiness requires Firebase configuration and a registered Ride App device. “Delivered” in the outbox means the provider accepted the request, not that the user viewed it.

This release adds JSON state fields and tool/API routes in the separate Agent services. It changes no legacy App GraphQL schema, Rust migrations, signing workers or existing App endpoints. Full native App regression and funded exchange/push acceptance require the corresponding live accounts/devices.

## Acceptance

Run `npm run check`, `npm test` with an isolated `RIDE_AGENT_TEST_DATABASE_URL`, `npm run test:functional` with `RIDE_AGENT_FUNCTIONAL_DATABASE_URL`, and `npm run verify:package`.

The functional harness exercises real HTTP, MCP, OAuth PKCE, CLI and PostgreSQL with simulated Core identities and venue fills. It covers zero-balance preview, expired-plan refresh, repeated edits, owner isolation, fresh confirmation, execution and accounting boundaries, histories, diagnostics and notification persistence. It does not place exchange orders.

For browser acceptance in a cloned repository, run `npm run preview:cards` and open `http://127.0.0.1:17830/preview`. The local host explicitly labels its simulated venue and exposes fixture-only funding/confirmation controls. It is bound to loopback and excluded from the distributed package. The production card HTML and actual Agent HTTP handlers are used unchanged.

Deploy the bridge and Agent backend before the MCP gateway. Keep the existing production execution flags and Core version. Rollback to the previous source revision retains added JSON fields; the previous code preserves unknown fields when persisting state. Earlier releases do not schedule the new daily digest.
