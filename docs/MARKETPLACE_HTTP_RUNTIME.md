# Account marketplace HTTP runtime

This checkpoint composes the existing PostgreSQL, session security, cleaner profile and landlord property modules behind an isolated native-Node controller. The main server now owns a fail-closed attachment point for that controller, disabled by default. It follows the existing application architecture; it does not introduce Express, React, a second server or a parallel data model.

## Prepared routes

| Route | Access | Server boundary |
| --- | --- | --- |
| `GET /api/marketplace/cleaners` | Public | Trusted client key, shared rate limit, restricted directory function and public projection only |
| `GET /api/marketplace/cleaners/:cleanerId/reviews` | Public | Separate shared rate-limit scope and approved-review public projection only |
| `PUT /api/marketplace/cleaner/profile` | Cleaner | Session, exact origin, CSRF and Cleaner role |
| `PUT /api/marketplace/landlord/profile` | Landlord | Session, exact origin, CSRF and Landlord role |
| `GET /api/marketplace/properties` | Landlord | Session and Landlord role; authenticated owner selected server-side |
| `POST /api/marketplace/properties` | Landlord | Session, exact origin, CSRF and Landlord role |
| `PUT /api/marketplace/properties/:propertyId` | Landlord | Session, exact origin, CSRF, Landlord role and owner-bound update query |
| `GET /api/marketplace/bookings/:bookingId/property` | Participant/admin | Session plus participant repository check, service authorization and protected-field projection |
| `GET /api/marketplace/cleaning-requests` | Landlord | Session and Landlord role; owner-only RLS listing |
| `POST /api/marketplace/cleaning-requests` | Landlord | Session, exact origin, CSRF, Landlord role, owned property and frozen room-task scope |

Prepared authentication routes use `POST` only: `/api/marketplace/auth/signup`, verification resend/confirmation, login, password-reset request/confirmation, logout, logout-all, and `/api/marketplace/onboarding`. They are attached to the runtime chain only when trusted email delivery, shared rate limiting and a server-derived client key are configured together.

The controller owns the `/api/marketplace/` namespace and does not intercept any existing pilot route. It accepts JSON objects only, limits bodies to 64 KiB, returns explicit method/validation/authentication errors, disables response caching and hides unexpected database details behind a generic error while forwarding the original error to the private monitoring hook. Cleaner discovery and public approved-review reads use separate scopes in the same trusted shared-limiter boundary as authentication. A denied request receives a bounded `Retry-After`; a missing client key, malformed limiter decision or limiter outage fails closed with a generic 503 while the private cause reaches monitoring. The Cleaner query/review service is never called after that failure.

## Runtime composition

`src/marketplace/runtime.mjs` creates one database boundary and composes:

1. authentication/session repository;
2. social identity, email credential and secure session-issuance services;
3. account security;
4. cleaner profile repository/service;
5. property repository/service;
6. marketplace HTTP router.

`src/marketplace/attachment.mjs` returns a zero-resource disabled boundary unless `MARKETPLACE_ENABLED=true`. Enablement then fails closed unless `DATABASE_URL`, separate 32+ character `SESSION_SECRET` and `AUTH_TOKEN_SECRET`, exact `APP_ORIGIN`, distinct 32+ character `DATA_ENCRYPTION_KEY`, email and private-object-storage configuration, a shared persistent rate limiter, trusted server-derived client key, trusted email delivery and complete private storage adapters are present. It loads deployment adapters only from the explicitly configured absolute `MARKETPLACE_ADAPTER_MODULE`, verifies that the database connection is PostgreSQL 16+, authenticated as non-bypass `tideway_app`, and has the critical migrations/functions, then composes the router. Startup failure closes the pool; shutdown closes the realtime listener and pool once.

The main server dispatches `/api/marketplace/*` to this router before the NDJSON pilot and exposes only booleans in `/api/health`. `/api/auth/providers` advertises email/password, reset and verification only when those routes are actually attached. Google, Apple and Facebook remain false even if credentials are present because provider token verification and callback routes do not yet exist. Session issuance stores only token/CSRF hashes and keyed metadata hashes; logout and role-change rotation revoke database sessions before clearing or replacing cookies.

Public signup, verification resend and password-reset request return the same generic response regardless of account existence. Trusted delivery receives a fragment-token HTTPS link; raw delivery material is never placed in the API response. A 500 ms minimum response window and the mandatory shared limiter reduce enumeration/abuse exposure. The replacement-verification migration invalidates older unused links atomically.

## Enablement procedure

The attachment point is present but remains disabled. Complete all of the following before setting `MARKETPLACE_ENABLED=true`:

1. Provision PostgreSQL 16 using separate migration-owner and restricted `tideway_app` roles.
2. Apply migrations and runtime grants in the documented order, then run real RLS and concurrent-overlap integration tests.
3. Add and lock a maintained PostgreSQL Node `pg` driver through the approved dependency workflow. The attachment dynamically imports `pg` only after enablement; the current dependency-free checkout intentionally has no driver, so enablement cannot succeed yet.
4. Put database/session/token/encryption secrets in the deployment secret manager and use an exact HTTPS `APP_ORIGIN` in production.
5. Provide an absolute deployment-owned adapter module exporting `createMarketplaceDeploymentAdapters({ env })`. It must return the persistent cross-instance limiter, a proxy-aware server-derived client key, trusted email delivery, private object storage with inspection/re-encoding/deletion, and private error monitoring. Prove limiter denial across two application instances and authentication behavior under HTTPS. Never trust a browser-supplied forwarding header directly.
6. Confirm `/api/health` changes from `marketplace.ready=false` to true only after the database probe and complete composition succeed; verify a startup failure exposes no partial routes or authentication capabilities.
7. Add mobile-first pages and browser tests using genuine staging accounts. Keep `/cleaners` closed until at least one real, completed, public Cleaner profile exists.

## Third-party services still requiring approval/configuration

- PostgreSQL hosting and backups/PITR.
- Private S3-compatible object storage and upload inspection for property/job media.
- SMTP or transactional email for verification, reset and booking notices.
- Google OIDC, then optional Apple and Facebook identity credentials.
- A map provider only when live journey tracking enters staging.
- Shared rate limiting, security monitoring and error reporting for multi-instance deployment.

No provider account, credential, paid service or Polsia credit was used for this source checkpoint.
