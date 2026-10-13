# Live workflow and automatic updates

Call `get_ride_guide` through the connected MCP before Ride tasks. The equivalent unauthenticated read is `ride guide --server https://mcp.onride.me/mcp`. The guide updates on the server without replacing local Skill files. Use the connected deployment's URL and current tool schemas. Reconnect or start a new chat to discover newly added tools.

Codex uses hosted HTTP MCP. npm setup for Claude Code/Cursor launches `npx -y --prefer-online @glenyang/ride-cli@latest mcp --server URL` so each MCP start resolves the published stable package. Existing pinned installations need one migration with `npx -y --prefer-online @glenyang/ride-cli@latest setup --skip-login`, then reconnect. Existing login remains stored; updates do not grant additional authority. Explicit GitHub distribution remains pinned. Globally installed `ride` binaries stay at their installed version; use the latest npx command below for standalone CLI updates.

# CLI equivalence

Default output is JSON. Add `--pretty` for human-readable cards/tables. The CLI bin is `ride`; use `npx -y --prefer-online @glenyang/ride-cli@latest` before each command until installed globally. Codex native HTTP MCP credentials are managed by Codex. For standalone CLI use, authenticate separately with `ride login --server https://mcp.onride.me/mcp --trade`. Claude/Cursor setup creates this CLI session automatically.

| MCP tool                     | CLI                                                                                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| set_preferences              | `ride preferences --json '{"budget_usdc":"500","loss_trigger_pct":20,"market":"perps","assets":["BTC","ETH"]}'`                                     |
| recommend_traders            | `ride recommend`                                                                                                                                    |
| get_trader_profile           | `ride trader TRADER_ID`                                                                                                                             |
| start_copy                   | `ride copy start PLAN_ID`                                                                                                                           |
| get_my_copies                | `ride copies --pretty [--status open] [--limit 100]`                                                                                                |
| get_portfolio                | `ride portfolio [PORTFOLIO_ID]`                                                                                                                     |
| update_copy                  | `ride copy update COPY_ID --json '{"leverage_cap":5}'`                                                                                              |
| stop_copy                    | `ride copy stop COPY_ID --mode wind_down`                                                                                                           |
| review_portfolio             | `ride review [PORTFOLIO_ID]`                                                                                                                        |
| get_updates                  | `ride updates --limit 20 [--cursor CURSOR]`                                                                                                         |
| close_position               | `ride position close POSITION_ID`                                                                                                                   |
| recalculate_plan             | `ride plan recalculate PLAN_ID [--json '{"allocations":[{"trader_id":"TRADER_ID","amount_usdc":"100","leverage_cap":3,"stop_loss_pct":30}, ...]}']` |
| get_performance              | `ride performance [PORTFOLIO_ID] --period daily\|weekly\|inception`                                                                                 |
| diagnose_copy                | `ride diagnose COPY_ID --start-at UTC_MILLISECONDS --end-at UTC_MILLISECONDS`                                                                       |
| get_notification_preferences | `ride notifications`                                                                                                                                |
| set_notification_preferences | `ride notifications --json '{"daily_digest":true,"local_time":"09:00","timezone":"Asia/Shanghai"}'`                                                 |

`ride proposal PROPOSAL_ID` queries status. `ride confirm PROPOSAL_ID` opens the human Ride page; it does not commit through the CLI. Credentials are stored under `~/.ride` with directory 0700 and session file 0600. Never read, echo or copy those files into chat or client configuration.

| Additional tool      | CLI                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------- |
| get_deposit_options  | `ride deposit options`                                                                 |
| get_deposit_address  | `ride deposit address --json '{"market":"perps","asset":"USDC","network":"Arbitrum"}'` |
| check_deposit_status | `ride deposit status DEPOSIT_ID`                                                       |
| get_daily_checkin    | `ride daily --timezone Asia/Shanghai`                                                  |
| update_portfolio     | `ride portfolio update PORTFOLIO_ID --json '{"loss_trigger_pct":40}'`                  |

`ride recommend --json '{"preferences":{"budget_usdc":"500","loss_trigger_pct":40,"market":"perps","assets":["BTC","ETH"],"portfolio_kind":"basket","basket_size":4,"risk_tolerance":"medium","asset_category":"crypto","copy_mode":"ride_recommends","loss_policy":"pause_then_exit","emergency_exit_pct":70},"batch_action":"first"}'` starts the HTML-style preview. Keep the returned preferences with `plan recalculate`. A flagged start uses `ride copy start PLAN_ID --json '{"compatibility_ack":"RETURNED_FINGERPRINT"}'` after the user explicitly acknowledges its warning.

| get_preferences | `ride preferences` |
| prepare_deposit | `ride deposit prepare DEPOSIT_ID --json '{"amount_usdc":"10"}'` |

Partial preference answers are saved; remaining questions are returned without a recommendation. Funding preparation returns a reviewed human confirmation page. Wallet credit, transaction confirmation, account activation and verified trading balance are separate states. Do not resubmit uncertain funding.
