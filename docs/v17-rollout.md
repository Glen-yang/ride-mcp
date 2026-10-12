# Ride V17 rollout: 0.4.0

Complete the supplied conversational HTML in the independent Agent services. Keep existing App API/gRPC/worker/scheduler sources, environment flags, GraphQL/RPC contracts, copy tables and mobile release unchanged.

## Reviewed source

- MCP branch `codex/ride-v17-complete`, based on the account/login fixes from PR 3. Its new changes are reviewed separately from those prerequisite fixes.
- Core branch `codex/ride-rwa-worker-v17`, commit `22cc5c0446432b94db88c7b1d48c2dc16b1104fd`, PR 6. It modifies Agent execution handling and adds an internal-only API mode. Qualified markets remain opt-in and require an Agent binding.
- New Core gRPC initialization applies only Agent execution-table guards and leaves SQLx migration history unchanged. Lock/statement timeouts bound initialization. Non-Agent bindings retain their core-only market restrictions.

## Deployment sequence

1. In `generous-quietude/production`, create `ride-agent-core-grpc-v17` and `ride-agent-core-api-v17` from the pinned Core commit. Config and service-auth references are staged. gRPC listens on 50051; API listens on 8001, checks `/ready`, exposes only health/readiness and authenticated `/internal/agent-core/*`, and starts no legacy forwarders or Meme sync.
2. Wait for both deployments and readiness, and check the four Agent market guards. Generate an HTTPS API domain for the bridge in the separate Railway project. Verify GraphQL/public App routes are unavailable on this Agent API and internal operations reject missing/invalid service auth.
3. Point only `ride-agent-execution-prod` at `http://ride-agent-core-grpc-v17.railway.internal:50051`, set its RWA opt-in, and deploy the pinned Core commit. Preserve existing execution/signing/epoch flags and worker mode. Its current baseline is deployment `37f05cc8-c559-4723-85c2-706ed4c97820`.
4. In `ride-mcp/production`, deploy `agent-bridge` and `agent-backend` from the reviewed MCP commit. Point the bridge to the new protected HTTPS API and set `RIDE_AGENT_RWA_ENABLED=true`. Preserve Firebase, signing credentials, identity URLs and current execution activation flags. Keep one backend monitor and its current zero-overlap setting.
5. Once bridge/backend health and authenticated read probes pass, deploy `ride-mcp` from the same MCP commit. Verify release 0.4.0, OAuth metadata, MCP tool discovery, cards, owned account reads, deposit options/address/status, performance and report settings without placing orders.
6. Compare legacy App service deployment IDs/configs against `output/deployment/v17-acceptance/legacy-deployment-baseline.json`, then check App health and representative read paths. Publish npm/GitHub 0.4.0 only after server acceptance; npm requires the publisher's per-release 2FA.

The connector's approval layer returned “Cancelled — the user did not approve this action. No changes were made.” The user explicitly approved deployment in this chat, and the first Core plus Node staging was subsequently submitted through Railway. The Rust Docker build exposed a missing SQL file: `deploy/` is excluded from the image context. Revision `22cc5c0` moves the guard SQL into gRPC's source tree while keeping the private deployment directory excluded; gRPC compilation and the disposable-schema guard test passed again. The corrected three-service source patch is ready for submission from the reviewed Railway page.

Bridge and backend are running 0.4.0. Until the corrected Core is ready, bridge temporarily retains `https://api.fiammalabs.io` with `RIDE_AGENT_RWA_ENABLED=false`; the public MCP gateway remains 0.3.4. Switch the bridge and enable RWA only after Core readiness and guard/worker acceptance, then update the gateway.

## Validation completed

- TypeScript check and 91 automated tests, including legacy plan limits/stop behavior and new Fixed/proportional, two-stage stop, ownership and preview batch behavior.
- 35 HTTP/MCP/OAuth/CLI/PostgreSQL scenarios with simulated identities/fills.
- Package verification: three client setups, three bare-command setups, legacy upgrades, no private history. Skill validation passed.
- Browser: single Fixed plans and trader replacement; precise edits/recalculation; zero-balance rejection; funding route/address/QR/status and saved-plan resume; frozen confirmation; dirty edits cannot be enabled by toggling the compatibility acknowledgment; portfolio management; chart switching; daily report time/timezone persistence; 390px no horizontal overflow.
- Core evidence from the original continuation: 8 Strategy gRPC tests, 37 execution tests, disposable PostgreSQL trigger coverage, API/gRPC compilation.

Browser screenshots and local acceptance records are deliberately excluded from the public package. These checks do not establish real-money fills, actual wallet transfers, physical-device push delivery or a mobile App release.

## Rollback

Stop accepting new scoped portfolios if scoped-market acceptance fails. Keep the updated worker reconciling owned scoped inventory and unknown submissions; never restore a core-only worker while such inventory remains. Preserve all receipts and the Agent state/guards. The legacy App release and rollback are independent.
