# Marketplace worker operations

Tideway has a separate, default-off process for continuous maintenance, notification delivery, private upload cleanup and consent-bound matching. It never shares the web process's database identity. The worker authenticates only as `tideway_worker`, has no direct public-table privileges and can execute only the 13 reviewed functions in `db/worker-role-grants.sql`.

## Safe capability split

`MARKETPLACE_WORKER_ENABLED=true` enables only the database maintenance supervisor. External or business-changing work remains independently closed:

- `WORKER_EMAIL_ENABLED=true` attaches verified SMTP and schedules privacy-minimal outbox delivery.
- `WORKER_MEDIA_ENABLED=true` attaches verified private object storage and schedules expired quarantine/final-object removal. Bucket lifecycle remains the cleanup backstop if an object provider fails after the database marks an upload expired.
- `WORKER_AUTOMATIC_DISPATCH_ENABLED=true` schedules only Landlord-consented, attempt-bounded matching. It also requires `MARKETPLACE_ENABLED=true` and the complete founder-approved private `BOOKING_*` economics.

All four flags default to false. Enabling the maintenance process does not imply permission to send email, expose photos, contact Cleaners or create invitations.

## Scheduled jobs

The maintenance-only process registers five non-overlapping jobs:

| Job | Normal interval | Boundary |
|---|---:|---|
| Invitation expiry | 1 minute | Cancels only due unanswered invitations and reopens matching through the audited function. |
| Current-location expiry | 1 minute | Deletes only expired current points; detailed location history is not retained. |
| Session expiry | 15 minutes | Drains bounded expired-session batches without giving the web role delete access. |
| Rate-limit retention | 1 hour | Removes only limiter buckets inactive for two hours. |
| Pending social-identity retention | 1 hour | Removes only used/expired Facebook mailbox-verification material after its retention window. |

Optional media cleanup runs each minute, email delivery every 15 seconds and automatic dispatch each minute. Each job uses `setTimeout` after completion rather than `setInterval`, so one slow run cannot overlap itself. A failure is reported to the private deployment monitor, increments only privacy-safe counters and retries without printing record contents, addresses, object keys, provider errors or database URLs. Health does not become green until every registered job has succeeded at least once.

## Startup and shutdown

Production secrets belong in the deployment secret manager. Configure `WORKER_DATABASE_URL` with the restricted worker credential, `MARKETPLACE_ADAPTER_MODULE` with the deployment-owned monitoring adapter, and only the capability-specific provider settings that have passed staging. Then run:

```text
pnpm run start:worker
```

The process refuses to start when the worker flag, database credential, monitoring adapter, PostgreSQL version, restricted role or required functions are incomplete. SIGTERM/SIGINT clears future timers, waits for in-flight jobs and closes SMTP, object storage and PostgreSQL resources exactly once.

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

The guarded verifier refuses another database name or role, probes PostgreSQL 16+, confirms function-only access and runs the five maintenance jobs once. On 16 July 2026 it passed locally against a fresh PostgreSQL 16.14 disposable database: 13 restricted functions and five jobs succeeded with no customer data present. Managed staging, provider-backed optional jobs, scheduler alerts and multi-instance evidence remain required before production activation.
