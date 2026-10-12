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

Observed validation before deployment: 92 TypeScript tests passed with dedicated PostgreSQL; 35 functional HTTP/MCP/OAuth/CLI/PostgreSQL scenarios passed using simulated identities/fills; Skill validation passed; package verification passed for three clients and bare setup. The final Fixed regression proves that new assets and direction flips require fills even when a source history response reports complete coverage. Core: 8 Strategy gRPC tests, 37 execution tests, and a disposable-schema PostgreSQL trigger test passed.

Browser acceptance after the final edits passed: single Fixed trader selection and replacement, amount/leverage recalculation, zero-balance rejection, funding-route restrictions and QR/status/resume, immutable proposal confirmation, unrecalculated edits staying disabled after overlap acknowledgment, profit/account-value switching, notification settings, and 390px layout without horizontal overflow. Evidence is in the ignored `output/deployment/v17-acceptance/` directory.

Production checks completed: independent Core API/gRPC and dedicated worker are online with one running replica each; service authentication and API route isolation passed; four Agent guards are present and the shared 206-entry migration registry is unchanged. All three MCP services run Fixed safety revision `271081b` and release 0.4.0. Public health/OAuth metadata, 21-tool discovery and reviewed-card hash parity passed. Bridge uses the independent Core with RWA enabled, returned 30 candidates and nine funding routes. Authenticated App copy/portfolio reads have complete coverage; owned deposit address, QR and awaiting-deposit status passed. Empty performance/daily-check-in behavior and notification delivery readiness passed for the signed-in account without an Agent portfolio. Official RWA taxonomy and `xyz` USDC metadata passed; the current strict pool has no RWA-tagged traders and correctly returns no executable RWA plan. Funded fills and physical pushes remain unverified.

Live new-flow acceptance: a 500 USDC single-trader preview returned nine eligible crypto candidates, one Fixed allocation with 20 USDC entry margin, and the opt-in pause/70% emergency-exit policy. No order was submitted.

Account/device acceptance still required:
- Native report PR 20 is prepared but still separate from the MCP release.
- Actual wallet transfer, real funded fills and physical-device push require appropriate account/device acceptance; fixture results do not establish those outcomes.

Distribution gate: publish only after server acceptance, complete npm's per-release publisher 2FA, and verify the publicly downloaded package. The release receipt records registry/GitHub URLs separately from runtime and device acceptance.

The six-service Agent rollout has settled. Existing App API/gRPC/worker deployment IDs match the baseline and App readiness/GraphQL reads returned 200; scheduler had a separate deployment outside this Agent patch. Railway permission was explicitly changed by the user to a plugin-specific `Allow all actions` override to remove repeated deployment confirmation. See `v17-rollout.md` for deployment evidence, sequence and rollback boundary.
