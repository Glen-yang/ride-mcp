# CLI equivalence

Default output is JSON. Add `--pretty` for human-readable cards/tables. The CLI bin is `ride`; use `npx -y github:Glen-yang/ride-mcp#v0.2.0` before each command until installed globally.

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

`ride proposal PROPOSAL_ID` queries status. `ride confirm PROPOSAL_ID` opens the human Ride page; it does not commit through the CLI. Credentials are stored under `~/.ride` with directory 0700 and session file 0600. Never read, echo or copy those files into chat or client configuration.
