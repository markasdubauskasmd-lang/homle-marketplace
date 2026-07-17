# Managed staging service probe

Run `pnpm run preflight:staging-services` only after a fresh managed staging database has passed the guarded bootstrap and the runtime, SMTP, private bucket and monitoring credentials are present in the deployment secret store. The probe composes the same marketplace attachment used by the server, but never opens a listening port.

## Safety boundary

The command refuses to run unless:

- `NODE_ENV=production` and `MARKETPLACE_ENABLED=true`;
- `PAYMENTS_ENABLED=false`;
- the exact confirmation is supplied;
- `DATABASE_URL` authenticates as `tideway_app` to a database ending `_tideway_staging` or `_homle_staging`;
- `REALTIME_DATABASE_URL` is a direct `tideway_app` connection to that exact same database and the attachment proves the dedicated connection supports `LISTEN/UNLISTEN`;
- an external database URL uses `sslmode=verify-full`; a same-workspace Render service may instead use only the Blueprint-provided internal `dpg-*` hostname over Render's private network, with no public route or TLS override;
- the three distinct application secrets, SMTP, private object storage and monitoring adapter are completely configured.

It performs only these service checks:

1. A read-only PostgreSQL schema, version, role and grant query.
2. SMTP authentication with Nodemailer's `verify()`; it sends no message.
3. Private bucket access with `HeadBucket`; it uploads, reads and deletes no object.
4. Monitoring-adapter construction and deterministic close; the built-in adapter sends no startup event.
5. Authentication-router composition with payments disabled.

It does not contact Google, Facebook or Stripe, send an email, create an account, write a database row, upload a photo, publish a route or turn on the running website. The JSON result contains only booleans, the staging database name/role/TLS mode and the next evidence steps. Database, SMTP, storage, monitoring and provider credentials are never printed; failure output redacts configured secret values and service URLs.

## Command

Inject the reviewed environment through the managed staging secret store, then set the exact one-run confirmation:

PowerShell:

```powershell
$env:HOMLE_STAGING_SERVICE_PROBE_CONFIRMATION = "PROBE HOMLE MANAGED STAGING SERVICES"
pnpm run preflight:staging-services
Remove-Item Env:HOMLE_STAGING_SERVICE_PROBE_CONFIRMATION
```

POSIX shell:

```sh
HOMLE_STAGING_SERVICE_PROBE_CONFIRMATION='PROBE HOMLE MANAGED STAGING SERVICES' pnpm run preflight:staging-services
```

Do not paste the environment into a terminal command, chat, screenshot or report. A passing result is composition evidence, not launch approval.

## Evidence still required after a pass

- With explicit founder approval, run the guarded [synthetic staging evidence](STAGING_EVIDENCE_RUNNER.md) command against a founder-controlled non-customer mailbox. It delivers one verification and one password-reset message, performs one signed private-image round trip with mandatory cleanup, and sends one privacy-minimal monitoring event.
- Confirm the two messages, assigned-operator alert and empty synthetic object keys independently; the command cannot confirm human receipt or provider-console cleanup by itself.
- Complete the two-account, two-phone request, room scan, acceptance, payment-test, journey, cleaning and review rehearsal.
- Remove every synthetic account, object, event and booking before enabling real intake.
