# Production deployment gate

Tideway supports two deliberately separate production modes:

- **Public site:** the reviewed independent website and concierge pilot, with `MARKETPLACE_ENABLED=false` and `PAYMENTS_ENABLED=false`.
- **Marketplace:** authenticated PostgreSQL accounts, private media and live booking workflows, enabled only after every managed staging dependency passes.

The public-site mode no longer requires placeholder database credentials. It remains detached from marketplace authentication and payments, and `/api/auth/providers` must report every provider as unavailable.

## Mandatory preflight

Every public production process must provide:

```text
NODE_ENV=production
HOST=<explicit application binding>
PORT=<platform application port>
LAN_PORT=0
APP_ORIGIN=https://<canonical-public-domain>
DATA_DIR=<absolute private directory outside the deployed source and cloud-sync folders>
ADMIN_REQUIRE_KEY=true
ADMIN_KEY=<secret-manager value of at least 32 characters>
TRUST_PROXY=true
TRUSTED_PROXY_CIDRS=<the selected host's exact immediate proxy addresses or CIDRs>
MARKETPLACE_ENABLED=false
PAYMENTS_ENABLED=false
```

`HOST` may be `127.0.0.1` when a same-host reverse proxy is the only caller, or a reviewed interface binding such as `0.0.0.0` inside an isolated container network. Do not copy example proxy ranges: obtain the current immediate-proxy networks from the selected hosting provider and verify that it replaces incoming forwarding headers with exactly one client address.

Store `ADMIN_KEY` and every future provider credential in the hosting secret manager. Do not place them in `.env`, source control, build logs, screenshots or chat.

Run before starting the deployed process:

```text
pnpm run preflight:production
```

The preflight performs no DNS change, deployment, database connection, email, storage request or provider call. It prints only safe booleans and the selected mode; failures name missing controls without printing their values. The production server repeats the same validation before opening its listening socket, preventing a platform from bypassing the operator command.

## Public-site deployment sequence

1. Select hosting and record its deployment identity, region, persistent-volume behavior, HTTPS proxy behavior and immediate proxy networks.
2. Put private pilot data on an encrypted persistent volume or access-restricted host directory. Never use the source checkout or an ephemeral filesystem for real submissions.
3. Configure the mandatory environment through the platform secret manager and keep both marketplace and payments false.
4. Run the dependency lock, complete tests and production preflight against the exact release commit.
5. Start the process and require `/api/health` to return HTTP 200, `ok: true`, healthy integrity, writes allowed, `marketplace.enabled: false` and `localDemosEnabled: false` with `Cache-Control: no-store`.
6. Verify `/api/auth/providers` reports Google, Facebook, Apple and email/password as false.
7. Verify `/tracking-test`, `/tracking-test.html`, `/tracking-test.js` and `/api/tracking-test/session` all return 404. The real-location simulator is a local development lab, not a public feature.
8. Connect the approved domain only after external `tools/domain-readiness.mjs` passes. Its read-only probes independently require the production health flag, anonymous `/admin` denial and closed local tracking surfaces without redirects, cacheable responses or cookies. This action still requires founder approval; preparation is not authorization to publish.
9. Submit only synthetic records during staging, verify the control desk and remove every synthetic record before real intake.

## Marketplace promotion

Do not change `MARKETPLACE_ENABLED` until managed PostgreSQL, SMTP, private object storage, monitoring adapter, proxy identity, migrations/grants and two-account HTTPS tests pass. Marketplace mode additionally requires its separate database/session/token/encryption credentials, SMTP sender, private-storage settings and an absolute deployment monitoring adapter. Startup connects to and verifies each dependency before it exposes an account route.

Keep `PAYMENTS_ENABLED=false` until the founder approves the legal/payment model and an approved Stripe test platform completes the documented authorization, completion, capture, transfer, cancellation and refund rehearsal. Configuration now rejects payments when the marketplace is detached.

## Rollback boundary

- Disable traffic at the host or return to the last verified application release; do not reverse already-applied PostgreSQL migrations.
- Keep marketplace, worker and payments flags false while diagnosing an uncertain release.
- Preserve private volumes and database evidence. Never replace or delete them as part of an application rollback.
- Require healthy integrity and expected record counts before restoring traffic.
- Re-run the production preflight and external domain verifier after any host, proxy, domain or release change.
