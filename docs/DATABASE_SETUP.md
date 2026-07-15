# Marketplace database setup

The existing local NDJSON pilot remains the active data store. The PostgreSQL marketplace schema is additive and has not been applied on this computer because PostgreSQL and `psql` are not installed here.

## Required boundary

- PostgreSQL 16 or a compatible managed PostgreSQL service.
- One migration owner that owns the schema and is never used by the web server.
- One `tideway_app` runtime role that is neither a superuser nor permitted to bypass row-level security.
- `DATABASE_URL` stored in the deployment secret manager and pointing to the runtime role.
- Separate random `SESSION_SECRET`, `AUTH_TOKEN_SECRET` and `DATA_ENCRYPTION_KEY` values stored only in the deployment secret manager.
- TLS certificate verification in production. Do not add `sslmode=no-verify` or embed credentials in Git.

## Apply in staging

Create the database and restricted runtime role using administrator tooling, then run these files as the migration owner in this order:

```text
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/001_marketplace_schema.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/002_marketplace_row_level_security.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/003_authentication_lookup_functions.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/004_social_identity_and_onboarding.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/005_email_password_lifecycle.sql
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/runtime-role-grants.sql
```

The application transaction boundary sets `app.user_id` and `app.user_roles` locally after `BEGIN` and before any protected query. Pre-login lookups can call only the three restricted `SECURITY DEFINER` authentication functions. A verified account may have an authenticated session with no selected role while onboarding is pending. First-account provisioning binds writes to the new user ID but does not grant a role; only Cleaner or Landlord onboarding may add a self-selected role. Administrator is never self-selectable.

Before production use, run the migrations and database integration tests against an empty staging database, inspect effective grants, confirm `tideway_app` cannot bypass RLS, and test denial from an unrelated account. The current repository contains a PostgreSQL-compatible pool adapter and fake-pool tests; a real PostgreSQL driver is intentionally not declared until package installation and a staging database are available.
