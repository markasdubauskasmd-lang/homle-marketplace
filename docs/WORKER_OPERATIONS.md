# Marketplace worker operations

Tideway has a separate, default-off process for continuous maintenance, notification delivery, private upload cleanup and consent-bound matching. It never shares the web process's database identity. The worker authenticates only as `tideway_worker`, has no direct public-table privileges and can execute only the 15 reviewed functions in `db/worker-role-grants.sql`.

## Safe capability split

`MARKETPLACE_WORKER_ENABLED=true` enables only the database maintenance supervisor. External or business-changing work remains independently closed:

- `WORKER_EMAIL_ENABLED=true` attaches verified SMTP and schedules privacy-minimal outbox delivery.
- `WORKER_MEDIA_ENABLED=true` attaches verified private object storage and schedules expired quarantine/final-object removal. Bucket lifecycle remains the cleanup backstop if an object provider fails after the database marks an upload expired.
- `WORKER_AUTOMATIC_DISPATCH_ENABLED=true` schedules only Landlord-consented, attempt-bounded matching. It also requires `MARKETPLACE_ENABLED=true` and the complete founder-approved private `BOOKING_*` economics.

All four flags default to false. Enabling the maintenance process does not imply permission to send email, expose photos, contact Cleaners or create invitations.

## Scheduled jobs

The maintenance-only process registers seven non-overlapping jobs:

| Job | Normal interval | Boundary |
|---|---:|---|
| Invitation expiry | 1 minute | Cancels only due unanswered invitations and reopens matching through the audited function. |
| Current-location expiry | 1 minute | Deletes only expired current points; detailed location history is not retained. |
| Payment readiness | 15 minutes | Notifies once when the five-day authorization window opens, then once inside 24 hours only if the exact authorization is still missing; it never changes money or booking status. |
| Confirmed-visit reminders | 15 minutes | Once payment is valid for the scheduled start, reminds both participants within 24 hours and prompts only the Cleaner inside two hours to open the active job when ready to set off. Keys include the exact schedule, and the job changes no booking, payment or location. |
| Session expiry | 15 minutes | Drains bounded expired-session batches without giving the web role delete access. |
| Rate-limit retention | 1 hour | Removes only limiter buckets inactive for two hours. |
| Pending social-identity retention | 1 hour | Removes only used/expired Facebook mailbox-verification material after its retention window. |

Optional media cleanup runs each minute, email delivery every 15 seconds and automatic dispatch each minute. Each job uses `setTimeout` after completion rather than `setInterval`, so one slow run cannot overlap itself. A failure is reported to the private deployment monitor, increments only privacy-safe counters and retries without printing record contents, addresses, object keys, provider errors or database URLs. Health does not become green until every registered job has succeeded at least once.

## Startup and shutdown

Production secrets belong in the deployment secret manager. Set `TIDEWAY_EXPECT_RELEASE` to the exact eight-character `sourceCommit` from the uploaded package manifest, configure `WORKER_DATABASE_URL` with the restricted worker credential, set `MARKETPLACE_ADAPTER_MODULE=homle:monitoring-webhook` with the approved private monitoring endpoint/token (or use a reviewed absolute custom adapter), and add only the capability-specific provider settings that have passed staging. Then run:

```text
pnpm run start:worker
```

The process first loads the bounded release identity embedded in its package and refuses to start if it is missing, malformed or different from `TIDEWAY_EXPECT_RELEASE`. It also refuses when the worker flag, database credential, monitoring adapter, PostgreSQL version, restricted role or required functions are incomplete. Its ready line and private snapshot expose only the source commit and migration count, never paths, repository details or credentials. SIGTERM/SIGINT clears future timers, waits for in-flight jobs and closes SMTP, object storage and PostgreSQL resources exactly once.

The supervisor exposes a programmatic `snapshot()` containing only job names, intervals, run/success/failure counts, timestamps and non-negative numeric/boolean result totals. The deployment adapter may project that snapshot into its private health/alerting system; do not expose raw errors or provider details on a public health route.

## Verification

Unit and orchestration checks:

```text
pnpm run check:worker
pnpm run test:worker
```

Real database proof must use a disposable database whose name ends `_tideway_test` and the restricted worker credential:

```powershell
$env:WORKER_DATABASE_VERIFICATION_URL = "postgresql://tideway_worker:password@staging-host/tideway_ci_tideway_test?sslmode=verify-full"
$env:TIDEWAY_WORKER_TEST_CONFIRMATION = "RUN TIDEWAY DISPOSABLE WORKER TESTS"
node tools/postgres-worker-verification-runner.mjs
Remove-Item Env:WORKER_DATABASE_VERIFICATION_URL, Env:TIDEWAY_WORKER_TEST_CONFIRMATION
```

The guarded verifier refuses another database name or role, probes PostgreSQL 16+, confirms function-only access and runs the seven maintenance jobs once. The predecessor schema passed locally against a fresh PostgreSQL 16.14 disposable database with 13 restricted functions and five jobs. Migration 041 added the fourteenth function/sixth job, and migration 044 adds the fifteenth function/seventh job. Repeat the guarded proof against managed staging before production activation. Provider-backed optional jobs, scheduler alerts and multi-instance evidence also remain required.
