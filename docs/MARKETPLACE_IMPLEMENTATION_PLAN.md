# Authenticated marketplace implementation plan

This plan extends the current Tideway application. It does not replace the working request, room-scan, proposal, protected-booking or job-economics flows.

## Phase 0 — architecture and safety foundation

Status: complete as a source-code foundation; the migrations still require a staging PostgreSQL execution test.

- Add PostgreSQL migrations for accounts, identities, profiles, properties, marketplace requests, bookings, status history, tasks, current location, messages, reviews, notifications, disputes, privacy requests and audit logs.
- Add database exclusion and review constraints plus row-level security policies.
- Add shared role, booking-status, task-status and authorization contracts.
- Add fail-closed environment validation and a secret-free `/api/auth/providers` capability endpoint.
- Keep all providers disabled until complete credentials and a verified deployment origin exist.

Files added or changed:

- `src/marketplace/domain.mjs`
- `src/marketplace/config.mjs`
- `db/migrations/001_marketplace_schema.sql`
- `db/migrations/002_marketplace_row_level_security.sql`
- `.env.example`
- `tests/marketplace-foundation.mjs`
- `server.mjs`, `package.json`, `tests/smoke.mjs`

## Phase 1 — accounts, authentication and onboarding

Status: in progress.

Implemented checkpoint:

- PostgreSQL-compatible transaction adapter with transaction-local RLS identity/role context, rollback and connection release.
- Separate pre-authentication, authenticated-account, role-bearing user and first-account-provisioning transaction boundaries; a verified first-time account can hold a session while role onboarding is still pending.
- Cryptographically random opaque session and CSRF tokens stored as HMAC hashes, production host-only cookies and a separate non-secure local-development cookie name.
- Bounded scrypt password hashing and verification.
- Restricted parameterized authentication lookup functions for password accounts, active sessions and verified-email deduplication.
- Authentication repository methods for lookup, session creation, single-session logout and logout-all-sessions.
- Atomic social-identity resolution with verified-email account reuse, provider-subject identity stability, concurrent-callback locks, suspended-account denial and audit events.
- Cleaner/Landlord-only idempotent role onboarding that creates the correct private starter profile while preventing self-service role switching and administrator selection.
- Email/password account registration with scrypt-only stored credentials, purpose-bound hashed email tokens, generic duplicate handling and a private trusted-delivery handoff.
- Single-use email verification and password reset, database-persistent five-attempt lockout, and automatic revocation of every session after password replacement.
- Generic verification resend with one live token, concurrency locking and restricted/audited database execution.
- Fail-closed provider capability flags that require the complete database/session/origin boundary and a separate `AUTH_TOKEN_SECRET` for verification/reset material.
- Reusable account middleware for environment-specific cookies, hashed session lookup, exact-origin and CSRF mutation checks, server-side role enforcement and role-pending onboarding isolation.
- Branded mobile `/login` and `/signup` entry pages that show no non-working provider/form controls and keep the operational request and cleaner-application paths available while account runtime composition is incomplete.
- Isolated POST-only authentication controller for signup, verification resend/confirmation, login, reset request/confirmation, exact logout, logout-all and Cleaner/Landlord onboarding rotation. Trusted email delivery, shared rate limiting and a server-derived client key are mandatory composition dependencies.
- RLS on password credentials, verification tokens, reset tokens and sessions, plus a checked non-bypass runtime-role grant script.
- Setup details in `docs/DATABASE_SETUP.md`, the mandatory provider-verification boundary in `docs/AUTHENTICATION_SECURITY.md`, and isolated regression tests using fake PostgreSQL-compatible repositories.

Not yet enabled: server attachment of the prepared mutation handlers, a database driver, cryptographic provider adapters, SMTP delivery, OAuth callbacks, onboarding forms or a production PostgreSQL instance. Provider capability flags therefore remain off behind an explicit runtime-composition gate. The social resolver must never receive browser-supplied claims directly, and internal email-delivery material must never be returned by a public API.

- Add a PostgreSQL connection/repository layer and transaction helper that always sets the RLS user context.
- Add opaque secure sessions, `HttpOnly; Secure; SameSite=Lax` cookies, CSRF tokens, rotation, logout-all-sessions and session expiry.
- Add email/password signup using memory-hard password hashing, email verification and single-use password-reset tokens.
- Add Google OIDC with authorization code plus PKCE, then Apple and Facebook behind provider capability flags.
- In one transaction, create the first account from a verified provider identity or link it to the existing verified-email account. Reject ambiguous/unverified merges.
- Add re-authenticated provider connection/removal in settings.
- Add `/login`, `/signup`, `/onboarding` and `/settings` using the existing Tideway design tokens.
- Add role middleware and role-specific onboarding. Admin role is never self-selectable.

Tests: new Google account, verified-email deduplication, role onboarding, password reset, verification, session rotation/logout, CSRF and cross-role denial.

## Phase 2 — profiles, properties and discovery

Status: in progress.

Implemented cleaner-profile checkpoint:

- Ownership-only profile replacement with bounded biography, pricing, services, outward-postcode areas, radius, experience, languages, supplied equipment/products, work preference and availability status.
- Deterministic ten-section completion scoring; incomplete profiles remain private and cannot enter discovery.
- Restricted public directory search across location, full-window availability, rating, price, service, distance, verified status and pagination.
- Public projection whitelist that excludes cleaner email, phone, home address, service-area coordinates and internal acceptance rate even if a lower layer accidentally returns them.
- Service-area coordinates removed from direct public RLS access; the directory may return only rounded calculated distance.
- Contract/static tests in `tests/cleaner-profile.mjs` and the privacy/enablement boundary in `docs/CLEANER_DIRECTORY.md`.

Implemented landlord/property privacy checkpoint:

- Authenticated-landlord-bound profile and multi-property create/update/list services; client input cannot select the owner.
- Bounded UK property details and room-by-room saved checklist validation.
- AES-256-GCM entry-instruction encryption bound to the property ID, with a distinct deployment secret requirement.
- Booking-participant repository filter plus whitelist projection: the assigned cleaner sees exact address, entry, parking and special notes only during the active accepted-booking window.
- Property-photo and property-row RLS policies now use the same active window and remove access after completion/dispute.
- Contract/static tests in `tests/property-service.mjs` and the enablement boundary in `docs/PROPERTY_PRIVACY.md`.

Implemented account HTTP composition checkpoint:

- Isolated native-Node `/api/marketplace/` controller for restricted public cleaner search, own Cleaner profile update, own Landlord profile/property operations and booking-participant property projection.
- Existing opaque session, exact-origin, CSRF and server-side role middleware protects every account mutation; request-body owner IDs cannot select the affected account.
- JSON content/type/size boundaries, explicit methods, no-store responses and sanitized unexpected errors.
- Fail-closed runtime factory composes one database/security/repository/service/controller graph only when database, session, exact-origin and encryption configuration exists.
- Trusted session issuance/rotation returns an HttpOnly cookie plus CSRF token while passing only token hashes to persistence; exact logout, logout-all and same-account privilege rotation are covered.
- Contract tests in `tests/marketplace-http.mjs` and `tests/account-session-service.mjs`, with the staged enablement procedure in `docs/MARKETPLACE_HTTP_RUNTIME.md`.

Not yet enabled: server attachment of the prepared account routes, login/session mutation routes, account pages beyond honest closed entry states, real PostgreSQL execution/driver, geocoding, an authenticated marketplace account, object storage, or genuine public cleaner supply.

- Add cleaner profile, services, service areas, availability and completion calculator APIs/pages.
- Attach the prepared account routes after real PostgreSQL/session staging tests; add authenticated mobile pages and validated private object-storage photos.
- Add `/cleaners` and `/cleaners/:cleanerId` search with location, availability, rating, price, service, distance and verification filters.
- Never return cleaner email, phone or home address in public projections.
- Add landlord dashboard, cleaner dashboard, profile, availability, properties and property detail pages.

Tests: cleaner owns one profile, cannot edit another profile, public projection privacy, property ownership, access-instruction protection and search filters.

## Phase 3 — relational request, matching and booking lifecycle

- Import existing pilot request/scan/proposal/booking records through a dry-run-first migration tool while retaining legacy references.
- Create account-backed cleaning requests from saved properties and frozen room-scan checklists/media.
- Add ranked matching using explicit service area, confirmed availability, services, price, rating, earlier relationship and acceptance rate. Every factor remains explainable.
- Add invitation, accept/decline and confirmation transactions. PostgreSQL's exclusion constraint is the final double-booking guard.
- Record every status change in `booking_status_history` and publish only after commit.
- Add `/bookings/new` and `/bookings/:bookingId`; retain the existing protected booking packs as a migration fallback.

Tests: request creation, cleaner acceptance/decline, concurrent overlapping acceptance, unauthorized booking reads, frozen terms and complete lifecycle transitions.

## Phase 4 — live journey and cleaning progress

- Add authenticated booking-scoped WebSocket channels with origin checks, heartbeat, bounded reconnect/backoff and per-user connection limits.
- Add foreground web location sharing: explicit consent, `Start journey`, current-position upsert, last-updated state, optional server ETA adapter, nearby event and arrival stop.
- Delete current location automatically on arrival/cancellation/completion and expire disconnected updates. Do not store route history.
- Add active job screen with start, pause/resume, task updates, notes, before/after photos, issues, unexpected-task approval and finish.
- Store updates transactionally, then broadcast progress snapshots and durable event identifiers so reconnects can catch up without blind polling.
- Add poor-connection/offline status, queued non-destructive task updates and clear conflict/retry handling.

Tests: consent and participant location authorization, automatic stop, unrelated-user denial, progress ownership, realtime delivery/reconnect and private media access.

## Phase 5 — communication, reviews, notifications and administration

- Add one booking conversation with participant/admin-only messages and no exposed personal contact details.
- Add in-app notification inbox and an idempotent email outbox for all required lifecycle events.
- Add one landlord review per completed booking, category ratings, moderation and one cleaner response.
- Add disputes, suspension, verification and review-moderation tools to the existing `/admin` design.
- Add marketplace statistics derived from audited records, not invented counters.

Tests: message isolation, idempotent notifications, completed-only unique reviews, aggregate recalculation, moderation/response ownership and suspended-account denial.

## Phase 6 — production hardening and deployment

- Private S3-compatible object storage, upload signatures or server streams, content-type/size verification, image re-encoding/malware scanning and retention workers.
- Shared rate limiting, structured security logs, error monitoring, database backups/PITR, secret rotation and audit retention.
- Container/reverse-proxy deployment with HTTPS, trusted proxy rules, health/readiness checks and zero-downtime migrations.
- CI for syntax/lint, unit, database migration, integration, authorization, WebSocket and mobile browser tests.
- Data export/deletion workflow, privacy/legal review and location/photo consent copy.
- Load and failure testing on slow mobile networks; native/PWA decision for reliable background tracking.

## Environment and third-party inventory

Required before production account use:

- PostgreSQL: `DATABASE_URL`.
- Sessions/authentication tokens/encryption: distinct `SESSION_SECRET`, `AUTH_TOKEN_SECRET`, `DATA_ENCRYPTION_KEY` values.
- Public deployment: `APP_ORIGIN` using verified HTTPS.
- Email verification/reset/notifications: `SMTP_URL`, `EMAIL_FROM`.
- OAuth as enabled: Google client ID/secret; Apple client/team/key/private key; Facebook app ID/secret.
- Private object storage: endpoint, bucket and server access credentials.
- Map provider in tracking phase: `MAP_PROVIDER` and an origin-restricted public token. No provider is selected or enabled without founder approval and cost/privacy review.

No OAuth, map, email, database or storage secret belongs in client-side JavaScript, Git, the admin form or customer records.

## Deployment sequence

1. Provision separate staging PostgreSQL and private object storage.
2. Store environment values in the platform secret manager; validate with `NODE_ENV=production` before starting.
3. Apply migrations in order using a restricted migration identity.
4. Run foundation, migration, integration and existing smoke tests.
5. Deploy behind HTTPS with the app role unable to bypass RLS; verify callback URLs exactly.
6. Dry-run legacy record import, compare counts/checksums, then import once with an audit report.
7. Test one staging cleaner and landlord account end to end without real payment or outreach.
8. Enable one OAuth provider at a time. Public launch still waits for legal identity, pilot coverage, insurance, operating rules, payment/refund evidence and real cleaner supply.
