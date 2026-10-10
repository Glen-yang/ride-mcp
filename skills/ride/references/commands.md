# CLI equivalence

Default output is JSON. Add `--pretty` for human-readable cards/tables. The CLI bin is `ride`; use `npx -y github:Glen-yang/ride-mcp#v0.3.0` before each command until installed globally. Codex native HTTP MCP credentials are managed by Codex. For standalone CLI use, authenticate separately with `ride login --server https://mcp.onride.me/mcp --trade`. Claude/Cursor setup creates this CLI session automatically.

| MCP tool | CLI |
|---|---|
| set_preferences | `ride preferences --json '{"budget_usdc":"500","loss_trigger_pct":20,"market":"perps","assets":["BTC","ETH"]}'` |
| recommend_traders | `ride recommend` |
| get_trader_profile | `ride trader TRADER_ID` |
| start_copy | `ride copy start PLAN_ID` |
| get_portfolio | `ride portfolio [PORTFOLIO_ID]` |
| update_copy | `ride copy update COPY_ID --json '{"leverage_cap":5}'` |
| stop_copy | `ride copy stop COPY_ID --mode wind_down` |
| review_portfolio | `ride review [PORTFOLIO_ID]` |
| get_updates | `ride updates --limit 20 [--cursor CURSOR]` |
| close_position | `ride position close POSITION_ID` |
| recalculate_plan | `ride plan recalculate PLAN_ID [--json '{"allocations":[{"trader_id":"TRADER_ID","amount_usdc":"100","leverage_cap":3,"stop_loss_pct":30}, ...]}']` |
| get_performance | `ride performance [PORTFOLIO_ID] --period daily\|weekly\|inception` |
| diagnose_copy | `ride diagnose COPY_ID --start-at UTC_MILLISECONDS --end-at UTC_MILLISECONDS` |
| get_notification_preferences | `ride notifications` |
| set_notification_preferences | `ride notifications --json '{"daily_digest":true,"local_time":"09:00","timezone":"Asia/Shanghai"}'` |

`ride proposal PROPOSAL_ID` queries status. `ride confirm PROPOSAL_ID` opens the human Ride page; it does not commit through the CLI. Credentials are stored under `~/.ride` with directory 0700 and session file 0600. Never read, echo or copy those files into chat or client configuration.
