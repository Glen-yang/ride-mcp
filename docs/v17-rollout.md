# Ride V17 rollout: 0.4.0

Complete the supplied conversational HTML in the independent Agent services. Keep existing App API/gRPC/worker/scheduler sources, environment flags, GraphQL/RPC contracts, copy tables and mobile release unchanged.

## Reviewed source

- MCP branch `codex/ride-v17-complete`, based on the account/login fixes from PR 3. Its new changes are reviewed separately from those prerequisite fixes.
- Core branch `codex/ride-rwa-worker-v17`, commit `22cc5c0446432b94db88c7b1d48c2dc16b1104fd`, PR 6. It modifies Agent execution handling and adds an internal-only API mode. Qualified markets remain opt-in and require an Agent binding.
- New Core gRPC initialization applies only Agent execution-table guards and leaves SQLx migration history unchanged. Lock/statement timeouts bound initialization. Non-Agent bindings retain their core-only market restrictions.

## Deployment sequence

1. In `generous-quietude/production`, create `ride-agent-core-grpc-v17` and `ride-agent-core-api-v17` from the pinned Core commit. gRPC listens on 50051; API listens on 8001, checks `/ready`, exposes only health/readiness and authenticated `/internal/agent-core/*`, and starts no legacy forwarders or Meme sync. Set `DIRECT_DEPOSIT_INDEXER_ENABLED=false` on the independent API to avoid duplicating the existing indexer.
2. Wait for both deployments and readiness, and check the four Agent market guards. Generate an HTTPS API domain for the bridge in the separate Railway project. Verify GraphQL/public App routes are unavailable on this Agent API and internal operations reject missing/invalid service auth.
3. Point only `ride-agent-execution-prod` at `http://ride-agent-core-grpc-v17.railway.internal:50051`, set its RWA opt-in, and deploy the pinned Core commit. Preserve existing execution/signing/epoch flags and worker mode. Its current baseline is deployment `37f05cc8-c559-4723-85c2-706ed4c97820`.
4. In `ride-mcp/production`, deploy `agent-bridge` and `agent-backend` from the reviewed MCP commit. Point the bridge to the new protected HTTPS API and set `RIDE_AGENT_RWA_ENABLED=true`. Preserve Firebase, signing credentials, identity URLs and current execution activation flags. Keep one backend monitor and its current zero-overlap setting.
5. Once bridge/backend health and authenticated read probes pass, deploy `ride-mcp` from the same MCP commit. Verify release 0.4.0, OAuth metadata, MCP tool discovery, cards, owned account reads, deposit options/address/status, performance and report settings without placing orders.
6. Compare legacy App service deployment IDs/configs against `output/deployment/v17-acceptance/legacy-deployment-baseline.json`, then check App health and representative read paths. Publish npm/GitHub 0.4.0 only after server acceptance; npm requires the publisher's per-release 2FA.

## Current production evidence (2026-10-12)

The independent Core API, gRPC and dedicated execution worker are running pinned revision `22cc5c0`; all three Railway deployments succeeded with one running replica each. The worker connects to the new Agent gRPC in strategy-only mode with the existing Privy signer. Its superseded deployment was retired after the new instance started. Core `/ready` returns 200, missing/invalid service credentials return 401, an authenticated trader-pool read returns 81 rows, and GraphQL returns 404 on the independent API.

The four Agent market guards are installed. The shared SQLx registry remains at 206 entries with the same checksum fingerprint as the pre-deploy baseline. Existing App API, gRPC and worker deployment IDs match the baseline. The App scheduler received a separate deployment during this window; its source branch remains unchanged and it was not included in any Agent patch.

All three MCP services are running safety revision `271081b` and release 0.4.0. Bridge uses `https://ride-agent-core-api-v17-production.up.railway.app` with RWA enabled. Public health, both OAuth metadata endpoints, 21-tool discovery and MCP cards passed; the served card SHA-256 equals the reviewed build. Authenticated App copies and portfolio reads report complete coverage. Funding exposes nine supported routes, the account-owned Arbitrum USDC address and QR are valid, and status correctly reports awaiting deposit without trade-ready funds. Performance returns empty for this account's absent Agent portfolio, daily check-in reports no review, and notification preferences report delivery readiness without claiming a physical push. Live bridge candidate reads returned 30 candidates. Official RWA metadata exposes 207 qualified symbols and verifies USDC collateral for `xyz`; the current strict trader pool contains no RWA-tagged traders, and an RWA recommendation returns empty with `NO_EXECUTABLE_PLAN`.

The final gateway/bridge source patch was applied and both deployments succeeded. During rollout, Railway inherited `Allow low-risk actions` and its approval layer cancelled deployment submission despite the user's authorization. The user explicitly selected a Railway-only `Allow all actions` override; it was set and read back successfully, and submission no longer returns cancellation. Other plugin defaults are unchanged. Registry publication still uses npm's publisher 2FA, which is independent of Railway permission.

A public single-trader Fixed preview returned nine eligible crypto candidates and one allocation, with 20 USDC fixed entry margin and the opt-in pause/70% exit policy. No trading proposal was confirmed and no transfer or order was submitted.

## Validation completed

- TypeScript check and 92 automated tests, including legacy plan limits/stop behavior and new Fixed/proportional, two-stage stop, ownership and preview batch behavior. An additional Fixed regression requires source fills for new assets and direction flips; a complete-history flag with no supporting fills cannot introduce exposure.
- 35 HTTP/MCP/OAuth/CLI/PostgreSQL scenarios with simulated identities/fills.
- Package verification: three client setups, three bare-command setups, legacy upgrades, no private history. Skill validation passed.
- Browser: single Fixed plans and trader replacement; precise edits/recalculation; zero-balance rejection; funding route/address/QR/status and saved-plan resume; frozen confirmation; dirty edits cannot be enabled by toggling the compatibility acknowledgment; portfolio management; chart switching; daily report time/timezone persistence; 390px no horizontal overflow.
- Core evidence from the original continuation: 8 Strategy gRPC tests, 37 execution tests, disposable PostgreSQL trigger coverage, API/gRPC compilation.

Browser screenshots and local acceptance records are deliberately excluded from the public package. These checks do not establish real-money fills, actual wallet transfers, physical-device push delivery or a mobile App release.

## Rollback

Stop accepting new scoped portfolios if scoped-market acceptance fails. Keep the updated worker reconciling owned scoped inventory and unknown submissions; never restore a core-only worker while such inventory remains. Preserve all receipts and the Agent state/guards. The legacy App release and rollback are independent.
