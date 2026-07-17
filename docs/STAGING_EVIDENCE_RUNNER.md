# Synthetic managed-staging evidence

`pnpm run evidence:staging-services` performs the three controlled external proofs that remain after the non-writing service probe. It must run only with explicit founder approval, against managed staging, using a founder-controlled non-customer mailbox. It does not create an account, booking or payment and does not contact Google, Facebook or Stripe.

## What the command deliberately does

1. Authenticates to SMTP and sends exactly two messages—one verification and one password-reset message—to `HOMLE_STAGING_EVIDENCE_EMAIL`.
2. Uploads one embedded 68-byte synthetic PNG to a random private request-photo quarantine key, verifies its metadata/checksum, re-encodes it as a metadata-free JPEG, reads it through a short-lived private URL and verifies the returned checksum.
3. Sends one synthetic privacy-minimal error event through the configured monitoring adapter.
4. Attempts deletion of both the quarantine and final object on success and every failure, then closes SMTP, storage and monitoring deterministically.

The approved mailbox local part must contain `homle-staging`, such as `founder+homle-staging@your-domain.example`. This prevents the evidence runner from being aimed casually at a customer address. The exact confirmation is bound to that mailbox. The JSON result does not include the address, object keys, message IDs, credentials or provider URLs.

The runner reuses every guard from the non-writing service probe: production TLS, a remote `_tideway_staging`/`_homle_staging` database configured as `tideway_app`, complete SMTP/storage/monitoring configuration and `PAYMENTS_ENABLED=false`. It creates no database row and never starts the web server.

## Explicitly approved run

Load the complete managed-staging environment from the deployment secret store. Set the founder-controlled mailbox and derive the exact confirmation without printing either value:

PowerShell:

```powershell
$env:HOMLE_STAGING_EVIDENCE_EMAIL = "founder+homle-staging@your-domain.example"
$env:HOMLE_STAGING_EVIDENCE_CONFIRMATION = "SEND HOMLE STAGING EVIDENCE TO $env:HOMLE_STAGING_EVIDENCE_EMAIL"
pnpm run evidence:staging-services
Remove-Item Env:HOMLE_STAGING_EVIDENCE_EMAIL, Env:HOMLE_STAGING_EVIDENCE_CONFIRMATION
```

POSIX shell:

```sh
export HOMLE_STAGING_EVIDENCE_EMAIL='founder+homle-staging@your-domain.example'
export HOMLE_STAGING_EVIDENCE_CONFIRMATION="SEND HOMLE STAGING EVIDENCE TO $HOMLE_STAGING_EVIDENCE_EMAIL"
pnpm run evidence:staging-services
unset HOMLE_STAGING_EVIDENCE_EMAIL HOMLE_STAGING_EVIDENCE_CONFIRMATION
```

Do not run this command merely to inspect configuration; use `pnpm run preflight:staging-services` for that non-writing check. Do not paste the mailbox, confirmation or environment into chat, screenshots or a deployment report.

## Human evidence after success

- Confirm both messages arrived only in the approved staging mailbox and their links use the exact staging HTTPS origin.
- Confirm the assigned operator received one `staging-evidence` / `synthetic-alert` monitoring event containing no mailbox, link, object key or business identifier.
- Inspect the private bucket and confirm neither random synthetic key remains. If either deletion failed, treat the run as failed and remove the two objects through the approved provider console before retrying.
- Retain only the pass/fail time, operator and environment name; do not copy message links, tokens, object keys or provider credentials into the evidence record.

This evidence still does not enable accounts. The next gate is the two-account, two-phone request-to-review rehearsal followed by complete synthetic-fixture removal.
