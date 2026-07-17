# Marketplace database setup

The existing local NDJSON pilot remains the active data store. The PostgreSQL marketplace schema is additive. On 16 July 2026, all locked assets were applied from scratch to a disposable PostgreSQL 16.14 database bound only to `127.0.0.1`, outside OneDrive and outside the project. The deployment verifier and behavioural integration suite passed; the database contained zero fixture users afterward. This local evidence does not replace managed staging, approved production credentials or backup/monitoring evidence.

## Required boundary

- PostgreSQL 16 or a compatible managed PostgreSQL service.
- One migration owner that owns the schema and is never used by the web server.
- One `tideway_app` runtime role that is neither a superuser nor permitted to bypass row-level security.
- One separately credentialed `tideway_worker` role that is neither a superuser nor permitted to bypass row-level security. It receives only the named bounded maintenance/delivery functions, never direct table access or web login duties.
- `DATABASE_URL` stored in the deployment secret manager and pointing to the runtime role.
- Separate random `SESSION_SECRET`, `AUTH_TOKEN_SECRET` and `DATA_ENCRYPTION_KEY` values stored only in the deployment secret manager.
- TLS certificate verification in production. Do not add `sslmode=no-verify` or embed credentials in Git.

## Install the reviewed runtime dependency

The production manifest pins `pg` 8.22.0 alongside the reviewed SMTP and private-media packages, and pins pnpm 11.7.0. `pnpm-lock.yaml` contains the exact transitive versions and registry integrity values; `tools/check-dependency-lock.mjs` locks that complete file by normalized SHA-256. Validate before installing, and install without package lifecycle scripts:

```text
node tools/check-dependency-lock.mjs
pnpm install --frozen-lockfile --ignore-scripts
```

The local pilot does not require this installation while `MARKETPLACE_ENABLED=false`; `src/marketplace/attachment.mjs` dynamically imports the driver only after explicit enablement. Never commit or sync `node_modules`. A frozen install and import of `pg.Pool` were verified in an isolated temporary folder on 16 July 2026, leaving no project `node_modules` folder. `pnpm audit --prod --audit-level high` reported no known vulnerability at that checkpoint; rerun the audit and review upstream release notes before every deployment or dependency update.

## Apply in staging

Before any migration-owner connection is used, verify that the complete ordered SQL set and both least-privilege role scripts still match the reviewed repository lock:

```text
node tools/check-database-assets.mjs
```

This dependency-free check requires all 38 consecutively numbered migrations, rejects missing or unlocked SQL files, verifies the SHA-256 of every migration and role-grant script, and requires each file to retain its explicit `BEGIN;`/`COMMIT;` boundary. An intentional SQL change must be reviewed and receive an explicit matching lock update in the same commit. This is a source-integrity gate only; it does not replace executing the migrations and security/concurrency tests against a real PostgreSQL database.

For a newly created, empty managed staging database, prefer the guarded bootstrap runner. It refuses production-like database names, the application and worker identities, non-empty schemas, PostgreSQL versions below 16 and a missing exact confirmation. It applies the locked migrations in order, applies both restricted-role grants and runs the read-only deployment verifier. Credentials are passed to `psql` through libpq environment variables rather than process arguments.

PowerShell:

```powershell
$env:DATABASE_BOOTSTRAP_URL = "postgresql://migration_owner:password@staging-host/acme_homle_staging?sslmode=verify-full"
$env:HOMLE_DATABASE_BOOTSTRAP_CONFIRMATION = "BOOTSTRAP EMPTY HOMLE STAGING DATABASE"
node tools/bootstrap-staging-database.mjs
Remove-Item Env:DATABASE_BOOTSTRAP_URL, Env:HOMLE_DATABASE_BOOTSTRAP_CONFIRMATION
```

POSIX shell:

```sh
DATABASE_BOOTSTRAP_URL='postgresql://migration_owner:password@staging-host/acme_homle_staging?sslmode=verify-full' HOMLE_DATABASE_BOOTSTRAP_CONFIRMATION='BOOTSTRAP EMPTY HOMLE STAGING DATABASE' node tools/bootstrap-staging-database.mjs
```

This command is only for a disposable fresh staging target. If any migration fails after the guard passes, do not rerun it against the partially initialized database: delete and recreate that empty staging database through the approved provider workflow, then investigate and retry from the beginning. The runner never drops or cleans a database.

Create the database and restricted runtime role using administrator tooling, then run these files as the migration owner in this order:

```text
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/001_marketplace_schema.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/002_marketplace_row_level_security.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/003_authentication_lookup_functions.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/004_social_identity_and_onboarding.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/005_email_password_lifecycle.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/006_cleaner_directory.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/007_email_verification_resend.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/008_account_cleaning_requests.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/009_booking_invitation_and_acceptance.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/010_request_cleaner_matching.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/011_invitation_expiry_and_requeue.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/012_live_journey_tracking.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/013_live_cleaning_progress.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/014_private_job_media.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/015_booking_messaging.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/016_booking_realtime_events.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/017_notification_inbox_and_outbox.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/018_verified_booking_reviews.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/019_expired_session_purge.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/020_shared_rate_limits.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/021_facebook_pending_identity.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/022_marketplace_payment_ledger.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/023_landlord_payment_status.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/024_resumable_booking_payment_authorization.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/025_job_start_payment_gate.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/026_participant_booking_summaries.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/027_authenticated_provider_connections.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/028_invitation_eligibility_hardening.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/029_consent_bound_automatic_dispatch.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/030_private_request_room_scans.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/031_fix_invitation_service_area_lookup.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/032_social_provider_step_up_and_removal.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/033_audited_booking_disputes.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/034_bootstrap_administrator_provisioning.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/035_account_privacy_request_intake.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/036_cleaner_payout_onboarding.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/037_pre_authorization_booking_total.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/038_facebook_data_deletion_callback.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/runtime-role-grants.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/worker-role-grants.sql
```

## Verify the deployed boundary

After the migrations and role grants are applied, run the read-only deployment verifier as the migration owner. Keep this separate verification URL in the deployment secret manager; the runner passes credentials to `psql` through libpq environment variables and never places them in process arguments.

PowerShell:

```powershell
$env:DATABASE_VERIFICATION_URL = "postgresql://migration_owner:password@staging-host/tideway?sslmode=verify-full"
node tools/postgres-verification-runner.mjs
Remove-Item Env:DATABASE_VERIFICATION_URL
```

POSIX shell:

```sh
DATABASE_VERIFICATION_URL='postgresql://migration_owner:password@staging-host/tideway?sslmode=verify-full' node tools/postgres-verification-runner.mjs
```

The command requires the `psql` client and runs `db/integration/deployment-verification.sql` inside an explicit read-only transaction. It verifies PostgreSQL and extension versions, the complete RLS table inventory, non-bypass runtime/worker roles, ownership, critical constraints and indexes, trusted `SECURITY DEFINER` search paths, required function grants, revoked direct access to protected data, and worker isolation. Remote URLs default to `sslmode=verify-full`; only `sslmode`, `sslrootcert` and a 1–60 second `connect_timeout` are accepted as URL parameters.

This is a deployed-structure and effective-grant check, not a substitute for the real multi-account RLS, transaction-concurrency, double-booking and notification-worker integration tests in E2. On 17 July 2026, the guarded fresh-database bootstrap passed the current verifier against disposable local PostgreSQL 16.14 after applying all 38 migrations and both grant files under a separate non-superuser migration owner. It verified 42 application functions, 40 RLS tables and 13 worker functions; explicitly denied both restricted roles direct access to the Facebook deletion-confirmation table; and retained the separate owner-only Administrator-bootstrap denial check. Repeat the same proof against founder-approved managed staging.

## Run the marketplace integration suite

Use a separate, disposable database whose name ends exactly in `_tideway_test`. Apply the locked migrations and both role-grant files first. The suite refuses any other database name, requires separate migration-owner and `tideway_app` credentials, runs the deployment verifier again, and uses only reserved `invalid.example` accounts and fixed test UUIDs. It proves owner-only first-Administrator bootstrap, restricted-role denial, exact retry, session revocation and fixture removal before creating its normal fixtures. It then proves known-subject Facebook deletion queueing, opaque retry stability, honest unknown-subject completion, request-ID collision denial, status isolation and private-table denial; unrelated-account denial; exact-subject social-provider step-up; disabled-provider exclusion from the usable-method count; last-sign-in-method protection; atomic session revocation; Landlord ownership; assigned-Cleaner access timing; direct booking-mutation denial; and a real two-transaction overlap race in which exactly one acceptance succeeds. Its reserved fixtures are removed on success and cleanup is attempted after every test failure.

PowerShell:

```powershell
$env:DATABASE_INTEGRATION_OWNER_URL = "postgresql://migration_owner:password@staging-host/tideway_ci_tideway_test?sslmode=verify-full"
$env:DATABASE_INTEGRATION_APP_URL = "postgresql://tideway_app:password@staging-host/tideway_ci_tideway_test?sslmode=verify-full"
$env:TIDEWAY_DATABASE_TEST_CONFIRMATION = "RUN TIDEWAY DISPOSABLE DATABASE TESTS"
node tools/postgres-integration-runner.mjs
Remove-Item Env:DATABASE_INTEGRATION_OWNER_URL, Env:DATABASE_INTEGRATION_APP_URL, Env:TIDEWAY_DATABASE_TEST_CONFIRMATION
```

Inject the two URLs from a secret manager in CI rather than committing or printing them. The runner passes credentials only through child-process environment variables and does not put connection URLs in `psql` arguments. It never contacts the normal `DATABASE_URL`, and the public/local pilot is not involved. A failed cleanup must be treated as a test-environment incident; remove the three reserved users and their cascaded fixtures before rerunning.

The current suite passed from a fresh 38-migration schema on PostgreSQL 16.14 on 17 July 2026. It proved owner-only first-Administrator provisioning, signed-provider deletion persistence, restricted-role denial, exact retry and session revocation, owner isolation, unrelated-user denial, private access-instruction timing, revoked direct workflow writes, current-payment journey gating, audited disputes, exactly-once history and a two-transaction overlap race in which exactly one acceptance succeeded. The worker proof then passed 13 restricted functions and five maintenance jobs. Cleanup left zero reserved users, bookings, Facebook callbacks and privacy requests; both disposable databases and the temporary migration-owner role were removed. Repeat this same proof in managed staging before attachment.

The application transaction boundary sets `app.user_id` and `app.user_roles` locally after `BEGIN` and before any protected query. Pre-login lookups can call only restricted `SECURITY DEFINER` authentication functions. A verified account may have an authenticated session with no selected role while onboarding is pending. First-account provisioning binds writes to the new user ID but does not grant a role; only Cleaner or Landlord onboarding may add a self-selected role. Administrator is never self-selectable.

Run `SELECT * FROM tideway_private.expire_due_cleaner_invitations(100);`, `SELECT * FROM tideway_private.purge_expired_cleaner_locations(500);` and `SELECT * FROM tideway_private.expire_due_job_photo_uploads(500);` through the deployment scheduler using only the `tideway_worker` connection, at least once per minute. Run the consent-bound `createAutomaticDispatchWorker` on the same cadence through its own `tideway_worker` pool; it leases only requests explicitly authorized by their Landlord, chooses profitable eligible candidates and writes one invitation at a time. Run `SELECT * FROM tideway_private.queue_due_booking_payment_reminders(100);` and `SELECT * FROM tideway_private.purge_expired_sessions(500);` through the same restricted role at least every 15 minutes; both drain at most five batches by default and report `moreMayRemain` for an immediate follow-up. The payment-readiness function only queues a private warning for confirmed cleans whose exact authorization will not remain current at the scheduled start; it cannot change a booking or money. Run `SELECT tideway_private.purge_expired_rate_limits(1000);` and `SELECT tideway_private.purge_expired_pending_social_identities(1000);` at least hourly and continue in bounded batches while either returns the limit. The functions use bounded `SKIP LOCKED` batches so concurrent workers do not process the same row. For every expired upload, the worker must also delete both returned quarantine and final object keys through the private storage adapter; a bucket lifecycle rule must be the final cleanup backstop. Monitor failures and continue immediately while a run returns the batch limit. The web role cannot directly update or delete cleaning requests, has its direct session-delete grant revoked, and neither restricted role has direct access to private limiter keys or pending social-identity material.

The [separate worker process](WORKER_OPERATIONS.md) now owns those schedules and keeps email, media cleanup and automatic dispatch behind separate flags. Its guarded predecessor verifier passed five database-only jobs through the real `tideway_worker` identity on PostgreSQL 16.14 and confirmed access to 13 functions without public-table privileges. Migration 041 adds the fourteenth function and sixth job; repeat the guarded proof under the managed scheduler with alerting and provider-backed optional capabilities before production.

Before production use, repeat the migrations and database integration tests against an empty managed staging database, inspect effective grants, confirm `tideway_app` cannot bypass RLS, and test denial from an unrelated account. The current repository contains a PostgreSQL-compatible pool adapter and exact locked driver dependency. Local E2 database behaviour is now proven with separate owner and `tideway_app` credentials; managed staging, scheduled-worker and multi-instance evidence remain open.
