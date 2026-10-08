# Deploying V3

The client installation is independent of server activation. Three Node services communicate with the additive private Ride Core gateway. Provision PostgreSQL and Redis, configure Privy approved origins/redirects, install the Core migrations and deploy the API/worker/scheduler changes, then deploy the public gateway and native App with matching URLs. Existing App behavior remains behind the default-off feature flags.

## Gateway

- `PUBLIC_BASE_URL`: HTTPS OAuth issuer, for example `https://mcp.onride.me`.
- `RIDE_GRAPHQL_URL`: Ride Core GraphQL endpoint for authenticated login and identity.
- `PRIVY_APP_ID`, optional `PRIVY_CLIENT_ID`: approved Privy application.
- `REDIS_URL`: durable hosted OAuth state; required for non-loopback issuers.
- `RIDE_AGENT_BACKEND_URL`: private control service URL.
- `RIDE_AGENT_HUMAN_COOKIE_KEY`: at least 32-byte independent cookie encryption secret.
- `RIDE_PUBLIC_SUBMISSION_MODE=true`: five read tools, no machine write or browser confirmation routes.

The native App sends its existing Core JWT directly to `/agent/human/*`. OAuth machine tokens cannot confirm, authorize or revoke. The browser human surface signs in through Privy and uses encrypted, HttpOnly, SameSite cookies plus origin checks.

## Agent service

- `RIDE_AGENT_DATABASE_URL`: separate Agent PostgreSQL database.
- `RIDE_AGENT_CURSOR_KEY`: at least 32 characters for user-bound update cursors.
- `RIDE_GRAPHQL_URL`: authenticated Core identity validation.
- `RIDE_AGENT_EXECUTOR_URL`, `RIDE_AGENT_EXECUTOR_TOKEN`: private bridge URL and service token.
- `RIDE_AGENT_PRIVATE_HTTP_HOST`: optional exact bridge hostname ending in `.railway.internal` when using Railway's encrypted private network over HTTP. Public executor connections require HTTPS.
- `PUBLIC_BASE_URL`: matching Ride human review base.
- `RIDE_AGENT_ENABLED=true`: explicit service activation.

State and ledger records persist in PostgreSQL; each user transition locks its row and rolls back failed confirmation. The monitor starts with the service and polls independently of MCP clients. Keep a single monitor instance per Agent database until cross-process scheduling leases are added; user transactions serialize changes, but overlapping network observations should be avoided operationally.

## Private execution bridge and Core

- `RIDE_AGENT_CORE_URL`: private Core base URL with `/internal/agent-core/:operation`.
- `RIDE_AGENT_CORE_SERVICE_TOKEN`: Core S2S token, at least 32 characters.
- `RIDE_AGENT_DATABASE_URL`: Agent database for stable outbox and opaque outcome metadata.
- `RIDE_AGENT_TRADER_ID_SALT`: stable, private trader-ID salt; changing it invalidates old public IDs.
- `RIDE_AGENT_EXECUTOR_TOKEN`: separate token used by the Agent service.
- `RIDE_AGENT_NETWORK=testnet|mainnet`: Perps execution network; default testnet.
- `RIDE_AGENT_PREDICTION_ENABLED=true` plus `RIDE_AGENT_POLYGON_RPC_URL`: explicit prediction activation on Polygon. Prediction has no paper-trading mode in this integration.
- `FIREBASE_SERVICE_ACCOUNT_JSON`: server-side push credentials, never shipped to clients.

Core requires `RIDE_AGENT_CORE_ENABLED=true`, the same Core S2S token, and explicit `RIDE_AGENT_PREDICTION_ENABLED=true` for prediction execution. Set `RIDE_AGENT_NETWORK` consistently in Core and bridge; mainnet also requires Core `RIDE_AGENT_MAINNET_ENABLED=true`. The API and gRPC execution gateway must share their existing `STRATEGY_CONTROL_PLANE_SERVICE_TOKEN`; this is separate from the Node-to-Core token. Existing mainnet execution epoch controls continue to apply. Signing remains in existing workers. Apply all three additive migrations from the private implementation: execution mode/quantity, prediction ownership, and archived account reuse. Legacy mode retains its original policy caps.

Perps account preparation and prediction wallet funding occur through Ride. A combined portfolio checks each market's funds independently and performs no implicit bridge/transfer. Core ownership blocks conflicting legacy writers while Agent owns the account. Release requires complete position and pending-order reconciliation.

## Acceptance before activation

Validate OAuth from each supported host, native App proposal hash/owner/revision checks, dedicated account conflicts, unknown-submit restart recovery, partial fill and zero-fill cancellation, real funding/fee reconciliation, hedge removal and gap exits, notification delivery and rollback. Offline test success does not establish venue or deployed App acceptance. Preserve attention states for unresolved prediction redemption, ambiguous receipts and venue dust.
