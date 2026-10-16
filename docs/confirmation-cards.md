# Human confirmation cards and session reuse

`show_confirmation_card` is a read-only render tool. `mode: demo` returns a
clearly labelled 0-USDC interface demo and never reads an account, creates a
financial proposal or calls the executor. `mode: proposal` reads an owned frozen
proposal; the backend continues to validate its owner. Recommendation and
preference tools keep their conversation-first outputs.

MCP Apps use the versioned `ui://ride/agent-v7-confirmation.html` resource. The
previous v6, v5, v4 and v3 URIs remain registered. Only the configured Ride origin is added to
the resource's frame policy. The card embeds `/agent/card/:proposalId`; its
content and human approval requests run at the Ride origin, separate from the
model and the MCP App sandbox. Existing confirmation, OAuth and funding pages
retain `DENY` / `frame-ancestors 'none'`. Only the dedicated card routes allow the
ChatGPT hosts, Codex's observed `codex-sandbox://*.web-sandbox.oaiusercontent.com`
sandbox ancestor, `https://claude.ai`, and the Claude MCP sandbox derived from
`sha256(<this server's canonical /mcp URL>)[:32] + .claudemcpcontent.com`.
The resource explicitly declares that stable origin in `_meta.ui.domain`.
Other Claude connectors' sandbox origins are not allowlisted. This only permits
framing: human endpoints still require the exact Ride origin, session, ownership
and CSRF checks. A normal confirmation-page link remains available as a fallback.
The 0-USDC demo also returns a public demo URL for hosts without MCP Apps support.
If the trusted frame has not reported readiness after eight seconds, the outer
card hides the unavailable frame and directs the user to that normal Ride page.
A later verified message from the exact Ride frame can restore the embedded UI.
This also handles Claude web's observed nested-frame block without changing CSP,
moving approval controls into the host sandbox or exposing session credentials.

Opening a confirmation page first restores its HttpOnly human cookie through a
same-origin POST. This returns only its CSRF token and original expiry, never a
Core JWT, and does not extend the 15-minute lifetime. If that session has expired,
the page tries the existing Privy session before offering Google sign-in. It
never initiates Google automatically. Funding pages also reuse a valid human
cookie while retaining the separate wallet-signing requirements.

The first embedded connection opens the normal Ride sign-in window. An existing
browser session is reused. That window issues a 60-second, single-use handoff
bound to a random challenge and proposal ID. It sends the ticket only to its
same-origin opener. The trusted child frame checks the popup source and origin,
then exchanges it for a separate HttpOnly, Secure, SameSite=None, Partitioned
cookie. Redis GETDEL consumes tickets atomically across gateway replicas. The
embedded cookie retains the original human-session expiry and is limited to
proposal reads, confirm and reject. It cannot grant autonomous authority or fund
an account. Blocked popups or unavailable partitioned storage fall back to the
normal Ride page; no authentication or approval checks are bypassed.

Only sanitized status/height notifications leave the trusted frame. Tokens,
CSRF values, handoff tickets and signing challenges never enter tool results,
host messages or model context. No confirm/reject/grant tool is added to MCP.
Preview hashes, ownership, expiry, portfolio revision and backend idempotency
remain authoritative. A failed or timed-out confirmation disables repeat
submission and offers a read of the same proposal ID.

All source changes belong to the independent Ride MCP gateway and its UI. Core,
GraphQL, workers, legacy App endpoints/schema, approved portfolio settings and
existing copy configurations are unchanged. Only the gateway needs deployment;
do not redeploy the bridge, backend or legacy App services for this change.

## Acceptance

Client setup must use the canonical `https://mcp.onride.me/mcp` endpoint. A legacy
Claude connector pointing at `https://ride-mcp-production.up.railway.app/mcp` was
observed as Connected with no tools on October 16, 2026. That status does not
prove a functioning MCP connection. Migrate the URL, complete the client's OAuth
flow, then verify a real tool call. Use `ride:read` for this acceptance: no trade
scope, real proposal creation, signing or execution is needed.

Claude and Grok Bot acceptance must distinguish authentication to the AI client,
Ride MCP OAuth, UI rendering, human confirmation session reuse and actual financial
execution. A paid-plan or trial gate is a client-access blocker, not a Ride or
OAuth failure. Do not start a subscription or trial on the user's behalf.
Protocol compatibility and local fixtures do not establish live host support.

The host bridge distinguishes incoming JSON-RPC requests from responses before
matching pending IDs. Host and view request IDs are independent: a host `ping`
using the same ID as `ui/initialize` must receive its own response without
completing initialization. The view answers `ping` and `ui/resource-teardown`,
cleans up detached frame listeners/timers, and reports its content height through
`ui/notifications/size-changed` after initialization and layout changes. A fixed
host height is respected. These protocol fixes require a fresh resource version
and a client tool-list refresh; they do not change human authorization.

`/fixture/protocol-host` in the loopback preview tests the real postMessage
protocol without an OpenAI shim. It deliberately sends a colliding ping before
the initialization response, delivers a zero-USDC demo, resizes its frame, and
provides a teardown check. No account or financial operation is available.

Claude web can also fail before any view code runs: its own
`/v1/toolbox/shttp/mcp/...` proxy was observed returning 405 while all matching
Ride requests succeeded and no Claude GET reached Ride. This matches the open
[Claude proxy issue](https://github.com/anthropics/claude-ai-mcp/issues/636).
Do not label that external failure repaired from protocol tests alone or add an
unauthenticated transport to work around it. Live acceptance must separately
check a new card, repeated page reload/resume, the normal Ride fallback and
session reuse on an already completed proposal, without real submission.

October 16 live acceptance: Claude web renders the outer MCP App at its stable
origin, but its host blocks the nested Ride frame (`chrome-error://chromewebdata/`).
Its official open-link flow successfully opens the public demo. Grok Bot 0.71.2
calls the tools and returns the fallback URL, but does not render MCP Apps in its
chat. Public demo confirmation and cancellation work on the production gateway.
These results do not establish inline financial confirmation in either client.

- Current Codex: the user expanded an existing Ride MCP card; its DOM rendered
  the frozen proposal and clicking the parameter disclosure worked. This proves
  card rendering and basic interaction, not the new nested confirmation flow.
- `npm run build`, `npm run check`, `npm test` validate the package and HTTP/MCP
  contracts. Tests cover cookie reuse, original expiry, tamper/origin/CSRF
  rejection, replay and embedded operation restrictions. No venue is contacted.
- `npx tsx scripts/confirmation-preview.ts` serves a loopback fixture. It imports
  no venue adapter or worker. `/fixture/status` exposes login, read and mock
  confirmation counters plus a fixed `real_orders: 0`. Browser acceptance covers
  demo confirm/cancel, normal-page reload without another exchange, popup handoff,
  repeated card opens without another login and mock proposal confirmation.
- The new gateway build must be deployed and the Ride connection refreshed
  before calling `show_confirmation_card` in Codex. Test `mode: demo` first. A
  successful local fixture does not prove that the current host accepts the new
  nested frame or that real Google OAuth works inside its popup.
