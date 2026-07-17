# Homle deployment on Hostinger

## Current decision

The public brand and canonical domain are **Homle** and `https://homle.co.uk`. The Homle Node application is now publicly reachable on that domain. A public rollback snapshot was captured before the previous site was replaced:

- `../homle.co.uk-public-rollback-2026-07-16.zip`
- SHA-256 `ACCAE642DF16D00FC38BA0C242846D4220EC383B5BCC3B6B4E9984B661191DD1`
- 10 entries: the public HTML, eight same-origin images and a capture manifest

This snapshot covers the former public files only. It is not a backup of Hostinger email, databases, environment variables or application configuration; use Hostinger's account backup for those resources before any destructive change.

## Verified live state — 16 July 2026

The current Hostinger deployment serves the new Homle homepage and working concierge-pilot routes. Both current apex A-record origins returned the Homle cleaning page during the live audit. `/api/health` reports a healthy writable pilot, but deliberately reports `marketplace.enabled=false`, `authenticationReady=false` and `paymentsReady=false`. `/api/auth/providers` therefore reports Google, Facebook and email/password as unavailable, and the two social start routes correctly return 404 instead of beginning an insecure or incomplete login.

The private `/brief` route correctly allows same-origin camera and microphone access; ordinary pages keep those browser permissions closed. No code-only button change can enable social sign-in. Activation requires the managed PostgreSQL database and migrations, SMTP, private object storage, monitoring adapter, exact production secrets and approved Google/Meta app credentials described below. Until those pass staging, the homepage intentionally keeps visitors on the working guided request rather than exposing broken account buttons.

The corrected read-only verifier passes DNS, trusted TLS, the permanent HTTPS redirect, homepage, health, anonymous Administrator denial, production closure of the local tracking lab and truthful disabled Google/Facebook behavior. The live edge currently returns only `Content-Security-Policy: upgrade-insecure-requests` and no one-year HSTS header, overriding or omitting the stronger application policy. The prepared release adds application HSTS and proves the full application CSP/HSTS response in its production-process test. After redeploy, run the verifier again. If the edge still replaces those headers, configure an equivalent full CSP and one-year HSTS at Hostinger or obtain Hostinger support before enabling accounts.

## Correct Hostinger deployment surface

Do not copy this project into `public_html` with the ordinary File Manager. Homle has a persistent Node server and protected API routes. The existing Hostinger Node app must be updated through its **Deploy Web App** release flow, using a Node.js-capable Business or Cloud plan. Removing and re-adding the live site is unnecessary for a normal application update and risks unrelated resources.

Authoritative Hostinger references:

- [Add a Node.js Web App](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/)
- [Node.js hosting options](https://www.hostinger.com/support/node-js-hosting-options-at-hostinger/)
- [Add environment variables](https://www.hostinger.com/support/how-to-add-environment-variables-during-node-js-application-deployment/)
- [Connect Supabase PostgreSQL](https://www.hostinger.com/support/connecting-a-supabase-database-to-a-hostinger-node-js-application/)

## Prepared release

- `../Homle-Hostinger-Node-release-ea1b9cf2.zip`
- evidence manifest `../Homle-Hostinger-Node-release-ea1b9cf2.manifest.json`
- source commit `ea1b9cf2`
- 238 ZIP entries / 229 files / 9 directories; 664,843 bytes; SHA-256 `99C3873C2C12DF635EC6318C594CBA2E6BF516339F64FF1E4A0D6B29B16A4880`
- no `.env`, customer data, tests, documentation, Git history, local tracking lab or local secrets
- Node type: `Other`
- entry file: `server.mjs`
- supported runtime: Node.js 24
- start command from the package: `node server.mjs`

This release is built by `pnpm run release:hostinger`. The builder follows committed local imports, includes the whole shipped `public/` and `src/` runtime, verifies the ZIP central directory against its exact allowlist, rejects private/internal paths and records a SHA-256 manifest. It also includes every SHA-256-locked database migration, the migration lock, both least-privilege grant scripts, the empty-staging guard, read-only deployment verifier, non-writing managed-service probe and confirmation-bound synthetic staging evidence runner; it re-verifies those assets before packaging and records the migration count. The guard requires a separate login migration owner that is neither superuser nor BYPASSRLS. Inclusion does not apply a migration automatically: use the guarded bootstrap only against an approved empty managed staging database, then run the service probe as `tideway_app`; keep the Node process restricted to that runtime role. The builder caught that the older manual `9f5ce64` archive omitted the server-imported `travel-coverage.mjs` startup dependency; do not upload that or any earlier superseded archive.

## Why it is not uploaded through File Manager

The full marketplace must pass the production preflight before it listens. It still needs:

- the exact Hostinger Node plan and deployment mode;
- an access-restricted persistent private-data location outside the release directory;
- the real immediate reverse-proxy boundary used by Hostinger;
- managed PostgreSQL, SMTP and private object storage for marketplace accounts;
- protected environment variables and a strong Administrator key;
- Google/Facebook and Stripe test credentials only after their separate approval gates.

Uploading only `public/` would make the site look live while registration, bookings, private photos, tracking and payments fail. Uploading the complete ZIP without the environment gate would make the server refuse startup, which is intentional.

## Deployment and update sequence

1. Confirm the existing Hostinger Node app is running and preserve an hPanel backup of its current release and configuration.
2. Open the existing app's redeploy/upload-new-release action and upload the prepared ZIP; do not create a static `public_html` copy.
3. Select Node.js 24, type `Other`, entry `server.mjs`, and no static output directory.
4. Configure the reviewed production environment in hPanel; never upload a local `.env` into the application files.
5. Keep marketplace and payments disabled for the first infrastructure probe.
6. Run `TIDEWAY_PUBLIC_ORIGIN=https://homle.co.uk node tools/domain-readiness.mjs`. Verify `/api/health`, anonymous Administrator denial, closed local tracking lab, the full CSP, one-year HSTS and the `www` 308 to the canonical apex while preserving a test path and query. Do not enable accounts while the security-header check is red.
7. Create a fresh empty managed staging database and run the guarded bootstrap in `docs/DATABASE_SETUP.md`. It applies all locked migrations, both restricted-role grant files and the read-only deployment verifier, and refuses production-like names, non-empty schemas and application identities. Attach the remaining managed staging services and run the non-writing `pnpm run preflight:staging-services` probe. With explicit founder approval, use `docs/STAGING_EVIDENCE_RUNNER.md` to prove the two synthetic emails, private-image round trip/cleanup and monitoring alert. Then complete the two-account, two-phone test before enabling accounts or payments.
8. Run the external domain verifier, then remove every synthetic staging record before real intake.

For account activation, select the first real provider with `TIDEWAY_EXPECT_SOCIAL_PROVIDERS` and run `pnpm run preflight:authentication` against the reviewed Hostinger environment before changing the marketplace flag. Google uses `https://homle.co.uk/api/marketplace/auth/google/callback`; Facebook uses `https://homle.co.uk/api/marketplace/auth/facebook/callback` and the separate Meta data-deletion callback `https://homle.co.uk/api/marketplace/auth/facebook/data-deletion`, with `https://homle.co.uk/facebook-data-deletion` as its public confirmation page. The preflight reports these exact non-secret URLs plus incomplete database, SMTP, storage, monitoring, email fallback or provider configuration without printing any secret. It deliberately cannot replace the subsequent managed-service probes, Meta callback proof and two-account HTTPS test.

The release now includes its deployment-owned monitoring module. Managed staging may set `MARKETPLACE_ADAPTER_MODULE=homle:monitoring-webhook`, `MONITORING_WEBHOOK_URL` to an approved private HTTPS collector with no query/fragment, and `MONITORING_WEBHOOK_TOKEN` to a separate 32-512 character secret in Hostinger's secret store. This does not send a startup event and does nothing while `MARKETPLACE_ENABLED=false`. Before account activation, deliberately exercise one synthetic staging failure, confirm the collector receives only the documented privacy-minimal event and prove an operator alert. See `docs/MONITORING.md`.

## Current control boundary

The initial application upload was completed outside this Codex task. This live audit was read-only: it verified the public pages, health response, provider capability response, social start-route closure, current DNS origins and room-scan permission headers. It did not change hPanel files, environment variables, DNS, email, databases or credentials.
