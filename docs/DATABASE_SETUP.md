# Marketplace database setup

The existing local NDJSON pilot remains the active data store. The PostgreSQL marketplace schema is additive and has not been applied on this computer because PostgreSQL and `psql` are not installed here.

## Required boundary

- PostgreSQL 16 or a compatible managed PostgreSQL service.
- One migration owner that owns the schema and is never used by the web server.
- One `tideway_app` runtime role that is neither a superuser nor permitted to bypass row-level security.
- One separately credentialed `tideway_worker` role that is neither a superuser nor permitted to bypass row-level security. It receives only the named bounded maintenance/delivery functions, never direct table access or web login duties.
- `DATABASE_URL` stored in the deployment secret manager and pointing to the runtime role.
- Separate random `SESSION_SECRET`, `AUTH_TOKEN_SECRET` and `DATA_ENCRYPTION_KEY` values stored only in the deployment secret manager.
- TLS certificate verification in production. Do not add `sslmode=no-verify` or embed credentials in Git.

## Apply in staging

Before any migration-owner connection is used, verify that the complete ordered SQL set and both least-privilege role scripts still match the reviewed repository lock:

```text
node tools/check-database-assets.mjs
```

This dependency-free check requires all 19 consecutively numbered migrations, rejects missing or unlocked SQL files, verifies the SHA-256 of every migration and role-grant script, and requires each file to retain its explicit `BEGIN;`/`COMMIT;` boundary. An intentional SQL change must be reviewed and receive an explicit matching lock update in the same commit. This is a source-integrity gate only; it does not replace executing the migrations and security/concurrency tests against a real PostgreSQL database.

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

This is a deployed-structure and effective-grant check, not a substitute for the real multi-account RLS, transaction-concurrency, double-booking and notification-worker integration tests in E2. It has not run on this development computer because neither PostgreSQL nor `psql` is installed and no founder-approved staging database is connected.

The application transaction boundary sets `app.user_id` and `app.user_roles` locally after `BEGIN` and before any protected query. Pre-login lookups can call only restricted `SECURITY DEFINER` authentication functions. A verified account may have an authenticated session with no selected role while onboarding is pending. First-account provisioning binds writes to the new user ID but does not grant a role; only Cleaner or Landlord onboarding may add a self-selected role. Administrator is never self-selectable.

Run `SELECT * FROM tideway_private.expire_due_cleaner_invitations(100);`, `SELECT * FROM tideway_private.purge_expired_cleaner_locations(500);` and `SELECT * FROM tideway_private.expire_due_job_photo_uploads(500);` through the deployment scheduler using only the `tideway_worker` connection, at least once per minute. Run `SELECT * FROM tideway_private.purge_expired_sessions(500);` through the same restricted role at least every 15 minutes; `createSessionPurgeWorker` drains at most five batches by default and reports `moreMayRemain` for an immediate follow-up. The functions use bounded `SKIP LOCKED` batches so concurrent workers do not process the same row. For every expired upload, the worker must also delete both returned quarantine and final object keys through the private storage adapter; a bucket lifecycle rule must be the final cleanup backstop. Monitor failures and continue immediately while a run returns the batch limit. The web role has its direct session-delete grant revoked and must receive no execute grant on maintenance functions.

Before production use, run the migrations and database integration tests against an empty staging database, inspect effective grants, confirm `tideway_app` cannot bypass RLS, and test denial from an unrelated account. The current repository contains a PostgreSQL-compatible pool adapter and fake-pool tests; a real PostgreSQL driver is intentionally not declared until package installation and a staging database are available.
