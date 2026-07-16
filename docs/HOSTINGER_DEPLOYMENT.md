# Homle deployment on Hostinger

## Current decision

The public brand and intended domain are **Homle** and `https://homle.co.uk`. The live domain currently serves an unrelated Brazilian hair-treatment site. A public rollback snapshot was captured before any replacement:

- `../homle.co.uk-public-rollback-2026-07-16.zip`
- SHA-256 `ACCAE642DF16D00FC38BA0C242846D4220EC383B5BCC3B6B4E9984B661191DD1`
- 10 entries: the public HTML, eight same-origin images and a capture manifest

This snapshot covers the public files only. Before hPanel removes the existing website, verify whether that website also owns email, databases or other private configuration and use Hostinger's account backup for those resources.

## Correct Hostinger deployment surface

Do not copy this project into `public_html` with the ordinary File Manager. Homle has a persistent Node server and protected API routes. Hostinger's supported flow is **Websites → Add Website → Deploy Web App → Upload website files**, using a Node.js-capable Business or Cloud plan. Hostinger currently requires an existing domain website to be removed before it can be re-added as a Node.js web app, so the backup check is a real rollback boundary.

Authoritative Hostinger references:

- [Add a Node.js Web App](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/)
- [Node.js hosting options](https://www.hostinger.com/support/node-js-hosting-options-at-hostinger/)
- [Add environment variables](https://www.hostinger.com/support/how-to-add-environment-variables-during-node-js-application-deployment/)
- [Connect Supabase PostgreSQL](https://www.hostinger.com/support/connecting-a-supabase-database-to-a-hostinger-node-js-application/)

## Prepared release

- `../Homle-Hostinger-Node-release-d94f8b7.zip`
- source commit `d94f8b7`
- SHA-256 `2F48617358B905FA7CF11739EB7B5E4A5A8E2AF64D43C63A5FE3146AE2F67E56`
- 171 runtime entries, 529,907 bytes; no `.env`, customer data, tests, documentation, Git history or local secrets
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

## First deployment sequence

1. Confirm the Hostinger plan offers **Deploy Web App** and preserve an hPanel backup of the existing website resources.
2. Add the domain as a Node.js web app and upload the prepared ZIP.
3. Select Node.js 24, type `Other`, entry `server.mjs`, and no static output directory.
4. Configure the reviewed production environment in hPanel; never upload a local `.env` into the application files.
5. Keep marketplace and payments disabled for the first infrastructure probe.
6. Verify `/api/health`, anonymous Administrator denial, closed local tracking lab and security headers.
7. Attach managed staging services and complete the two-account, two-phone test before enabling accounts or payments.
8. Run the external domain verifier, then remove every synthetic staging record before real intake.

## Current automation limitation

The signed-in browser-control connection failed before hPanel could be inspected or changed. No Hostinger file, website, database, email setting, DNS record or deployment was modified. Resume at step 1 when hPanel browser control is available or the founder manually opens the **Deploy Web App** upload step.
