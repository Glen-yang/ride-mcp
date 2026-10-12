# Ride V17 completion and release checklist

Scope: finish the supplied conversational HTML in isolated Ride MCP services. Old App service sources, GraphQL/RPC contracts, copy tables and client notification branches remain unchanged.

Implemented:
- Single trader and explicit 2–8 trader baskets; old plans keep 3–6.
- Independent risk tolerance, Fixed/proportional settings and amount/leverage editing.
- Verified source-fill entry sizing and same-window reductions; gaps block increases.
- New 30% pause / 70% emergency exit, portfolio stop precedence; legacy single-threshold semantics retained.
- Persisted free preview batches, quota enforcement, cross-batch basket editing.
- Overlap warnings, improving alternatives, frozen-plan acknowledgment.
- Supported deposit routes, owned receiving address/QR, owner-isolated status; wallet/bridge receipt and trade-ready collateral are separate.
- Once-per-local-day check-in, daily/weekly/inception reports, profit/value chart and recorded fills.
- Real RWA taxonomy, exact qualified symbols, Standard mode and scoped USDC collateral.
- CLI/Skill parity and upgrade from the released 0.3.4 tree.

Observed validation before deployment: 91 TypeScript tests passed with dedicated PostgreSQL; 35 functional HTTP/MCP/OAuth/CLI/PostgreSQL scenarios passed using simulated identities/fills; Skill validation passed; package verification passed for three clients and bare setup. Core: 8 Strategy gRPC tests, 37 execution tests, and a disposable-schema PostgreSQL trigger test passed.

Browser acceptance after the final edits passed: single Fixed trader selection and replacement, amount/leverage recalculation, zero-balance rejection, funding-route restrictions and QR/status/resume, immutable proposal confirmation, unrecalculated edits staying disabled after overlap acknowledgment, profit/account-value switching, notification settings, and 390px layout without horizontal overflow. Evidence is in the ignored `output/deployment/v17-acceptance/` directory.

Still required:
- Deploy independent Agent Core API/gRPC and Agent worker, then the three MCP services.
- Live metadata/discovery and authenticated account/funding/report probes.
- Verify old App deployment parity and health after release.
- Registry publish requires npm per-release human 2FA.
- Native report PR 20 is prepared but still separate from the MCP release.
- Actual wallet transfer, real funded fills and physical-device push require appropriate account/device acceptance; fixture results do not establish those outcomes.

Railway's first deploy request was cancelled by its approval layer on October 12; no new Core service was made live. Reviewed Core staging contains only the two new Agent services. Production gateway still reports release 0.3.4. See `v17-rollout.md` for the exact sequence and service boundary.
