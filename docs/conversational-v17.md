# Conversational V17 implementation · 0.4.0

Historical release reference. Budget/risk-first onboarding and candidate browsing now follow [conversation-v050.md](conversation-v050.md); old upfront-field and batch-quota rules below are superseded.

The supplied HTML is a simulated reference. Production uses the same exploration, preview, funding and review sequence inside the MCP card resource. The host owns the conversation sidebar/composer; Ride owns tool data and cards. The original reference file is preserved.

## Behavior

| Reference requirement | Implementation |
| --- | --- |
| Trader exploration before deposit | Primary “View traders first”; recommendations do not require balance |
| Resume after funding | Saved plans remain account scoped; `get_portfolio` returns the last preview when no portfolio exists; `recalculate_plan` refreshes into a new plan |
| Alternatives and repeated editing | Selection controls call server validation directly; a single active editor uses its own element references; old cards cannot contribute duplicate amounts |
| Basket/risk rules | Explicit new single plans use one trader; baskets use 2–8, with 50 USDC per allocation; older plans retain 3–6 unique traders, exact USDC decimals, capital weight ≤55%, Perps recommended caps 3–8× bounded by risk/venue, prediction 1×; live gross concentration ≤60% |
| Loss rules | New `pause_then_exit` plans pause increases at 30% by default and initiate emergency exits at 70%; legacy `exit` plans retain their original threshold. Portfolio stops can exit everyone first. No guaranteed maximum loss. |
| Execution | Frozen proposals and human Ride confirmation; distinct configuration/submission/partial/uncertain/settlement states |
| Replacement | Close/wind down and reconcile old lots, verify available funds, then confirm replacement; one per rolling seven days, old copy preserved |
| Historical reports | Immutable hourly/event accounting marks, deposits/withdrawals excluded; displayed daily UTC series; gaps return null period profit |
| Diagnosis | Same-window source fills, attributed follower fills, decisions, historical parameters, funding and execution status; no invented pairing/counterfactual profit |
| Notifications | Opt-in daily Ride App digest, local time/IANA timezone, durable per-day deduplication and retry, digest backlog cancelled on opt-out |
| Funding | Account/network/asset selection from verified provider routes, owned addresses and QR, persisted request IDs and status. Perps funding wallet receipt is separate from venue deposit; prediction bridge completion still requires available-collateral refresh |
| Copy setup | Separate risk tolerance and fixed/proportional settings; Fixed uses verified source fills and recorded pre-trade positions; gaps block increases |
| Recommendation batches | One free batch change, stored Batch 1/2, quota retained after edits, browsing keeps the edited basket |
| Compatibility | Shared assets/direction/holding/style flags and improving alternatives; explicit acknowledgment binds to the immutable plan; unknown historical loss correlation is unavailable |
| Daily return | Account-scoped local-date check-in key, offer once per day; no unsolicited host message |
| Charts | Persisted net-profit/account-value switch, gaps remain gaps, recorded fills retain original attribution |
| RWA | Official asset taxonomy and historical RWA category, exact qualified symbols, verified USDC collateral and Standard account mode, independent scoped collateral validation |
| Other hosts | Same twenty Agent tools, Skill and CLI; MCP App buttons use the standard `tools/call` method |

The MCP App protocol follows the [official extension overview](https://apps.extensions.modelcontextprotocol.io/api/documents/Overview.html). Cards communicate through the host; no client signing secrets or direct venue requests are embedded.

## Coverage and limits

Recording starts when the new monitor observes an owned account. Earlier periods and missing event-time configurations cannot be backfilled from current trader selection. Old receipts are not reconstructed using current settings. Prediction source fill history remains explicitly unavailable; verified follower accounting remains usable. Source/follower fills are displayed as separate evidence unless causal linkage is recorded. Diagnostics do not prove hypothetical missed returns.

Daily UTC display marks are capped at the latest 366 days, with `series_truncated` and `full_snapshot_count` disclosed. Underlying snapshots remain stored. Push readiness requires Firebase configuration and a registered Ride App device. “Delivered” in the outbox means the provider accepted the request, not that the user viewed it.

This release adds optional JSON fields and tool/API routes in the independent Agent services. New private Agent Core API/gRPC and the independent execution worker opt into scoped markets. The database guard adjusts only Agent execution tables, rejects non-Agent qualified assets and does not add an SQLx migration version, so old App binaries can restart with their existing migration registry. Legacy App GraphQL/RPC contracts, API/gRPC/worker deployments and copy tables are unchanged. Full native App regression and funded exchange/push acceptance require the corresponding live accounts/devices.

## Acceptance

Run `npm run check`, `npm test` with an isolated `RIDE_AGENT_TEST_DATABASE_URL`, `npm run test:functional` with `RIDE_AGENT_FUNCTIONAL_DATABASE_URL`, and `npm run verify:package`.

The functional harness exercises real HTTP, MCP, OAuth PKCE, CLI and PostgreSQL with simulated Core identities and venue fills. It covers zero-balance preview, expired-plan refresh, repeated edits, owner isolation, fresh confirmation, execution and accounting boundaries, histories, diagnostics and notification persistence. It does not place exchange orders.

For browser acceptance in a cloned repository, run `npm run preview:cards` and open `http://127.0.0.1:17830/preview`. The local host explicitly labels its simulated venue and exposes fixture-only funding/confirmation controls. It is bound to loopback and excluded from the distributed package. The production card HTML and actual Agent HTTP handlers are used unchanged.

Prepare the independent Agent gRPC with `RIDE_AGENT_V17_RWA_SCHEMA_ENABLED=true` and `RIDE_AGENT_RWA_ENABLED=true`, then the private Agent API with `RIDE_AGENT_INTERNAL_ONLY=true`. The API exposes only health/readiness and authenticated Agent Core operations and starts no legacy queue forwarders or Meme sync. Point only the independent Agent worker and bridge to these services. Deploy the bridge and Agent backend before the MCP gateway. Keep old App service sources and flags. Rollback to the previous source revision retains added JSON fields; the previous code preserves unknown fields when persisting state. Earlier releases do not schedule the new daily digest.
