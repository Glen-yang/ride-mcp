# Apple browser login

MCP authorization (`/authorize`), trading funding review (`/agent/fund/:depositId`) and copy proposal review (`/agent/confirm/:proposalId`) share the same Apple/Google OAuth flow. The callback remains `/auth/privy/oauth/callback` and uses the existing Privy App ID and Core `syncPrivyUser` endpoint. No native App, Core schema, signing permission or old service changes are required.

Apple passes `no-signup` to the pinned Privy SDK, so the browser must authenticate an existing Privy identity. Core verifies its token and resolves the original Ride user by Privy ID. Apple relay email is not sent as an account lookup or profile replacement, and a Google registration access code is not sent for Apple. There is no automatic provider linking in these pages. An existing Privy identity missing a Ride profile remains subject to Core's existing registration policy; browser login does not merge Ride profiles by email. Use the Apple identity already used in the Ride App.

Provider and original return URL are stored in the initiating tab for at most 15 minutes. The shared callback accepts only same-origin Ride authorization/funding/proposal pages. Privy still validates OAuth state; Ride still validates client redirect URI, PKCE, scopes, Core identity, encrypted human cookies, origin, CSRF, resource ownership and displayed confirmation hashes. Signing/funding/trading require the existing explicit confirmations after login.

## Verify without signing in to Apple

Run `npm run check`, `npm test` (optionally set `RIDE_AGENT_TEST_DATABASE_URL` to an isolated disposable PostgreSQL database), `npm run build` and `npm run verify:package`.

For a browser roundtrip with simulated identities, run `npx tsx scripts/apple-auth-preview.ts` and open `http://127.0.0.1:17860/`. Open each of the three links, choose Apple or Google, and select **Return original Ride identity** on the clearly labeled local provider page. The production page controllers, callback, Core exchange mapping, cookie/CSRF enforcement, ownership checks and Agent backend run locally; only the OAuth identity and venue are simulated. `/fixture/results` records the original Privy ID, provider and resolved Ride ID. Also test **Decline sign-in** and retry. Do not use fixture addresses or confirm funding/trading as part of this auth check.

Production preflight checks the public Privy config has Apple enabled, uses the same App ID as the native App, and reaches Apple's official authorization page from each entry. It does not establish a real Apple identity, account matching, wallet signing, funding credit or a fill. A real existing-user Apple login is a separate acceptance step and must not be reported as completed by these tests.

## Deployment scope

Only the public `ride-mcp` gateway serves the browser login change. Pin its reviewed commit for the rollout so that backend/bridge, isolated Core and old App services do not redeploy. Existing installed CLI/Skill clients use these hosted pages, so an npm upgrade is not required for Apple login.
