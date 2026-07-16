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

## Correct Hostinger deployment surface

Do not copy this project into `public_html` with the ordinary File Manager. Homle has a persistent Node server and protected API routes. The existing Hostinger Node app must be updated through its **Deploy Web App** release flow, using a Node.js-capable Business or Cloud plan. Removing and re-adding the live site is unnecessary for a normal application update and risks unrelated resources.

Authoritative Hostinger references:

- [Add a Node.js Web App](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/)
- [Node.js hosting options](https://www.hostinger.com/support/node-js-hosting-options-at-hostinger/)
- [Add environment variables](https://www.hostinger.com/support/how-to-add-environment-variables-during-node-js-application-deployment/)
- [Connect Supabase PostgreSQL](https://www.hostinger.com/support/connecting-a-supabase-database-to-a-hostinger-node-js-application/)

## Prepared release

- `../Homle-Hostinger-Node-release-624a6e6.zip`
- source commit `624a6e6`
- SHA-256 `219D944E92F7023F29F89FEE1D17D365D2605469F0FEB79A9487A71114814C9F`
- 176 runtime entries, 530,423 bytes; no `.env`, customer data, tests, documentation, Git history or local secrets
- Node type: `Other`
- entry file: `server.mjs`
- supported runtime: Node.js 24
- start command from the package: `node server.mjs`

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
6. Verify `/api/health`, anonymous Administrator denial, closed local tracking lab, security headers and the `www` 308 to the canonical apex while preserving a test path and query.
7. Attach managed staging services and complete the two-account, two-phone test before enabling accounts or payments.
8. Run the external domain verifier, then remove every synthetic staging record before real intake.

## Current control boundary

The initial application upload was completed outside this Codex task. This live audit was read-only: it verified the public pages, health response, provider capability response, social start-route closure, current DNS origins and room-scan permission headers. It did not change hPanel files, environment variables, DNS, email, databases or credentials.
