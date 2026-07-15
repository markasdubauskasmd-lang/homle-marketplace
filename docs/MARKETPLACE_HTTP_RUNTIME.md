# Account marketplace HTTP runtime

This checkpoint composes the existing PostgreSQL, session security, cleaner profile and landlord property modules behind an isolated native-Node controller. It follows the existing application architecture; it does not introduce Express, React, a second server or a parallel data model.

## Prepared routes

| Route | Access | Server boundary |
| --- | --- | --- |
| `GET /api/marketplace/cleaners` | Public | Restricted directory function and public projection only |
| `PUT /api/marketplace/cleaner/profile` | Cleaner | Session, exact origin, CSRF and Cleaner role |
| `PUT /api/marketplace/landlord/profile` | Landlord | Session, exact origin, CSRF and Landlord role |
| `GET /api/marketplace/properties` | Landlord | Session and Landlord role; authenticated owner selected server-side |
| `POST /api/marketplace/properties` | Landlord | Session, exact origin, CSRF and Landlord role |
| `PUT /api/marketplace/properties/:propertyId` | Landlord | Session, exact origin, CSRF, Landlord role and owner-bound update query |
| `GET /api/marketplace/bookings/:bookingId/property` | Participant/admin | Session plus participant repository check, service authorization and protected-field projection |

The controller owns the `/api/marketplace/` namespace and does not intercept any existing pilot route. It accepts JSON objects only, limits bodies to 64 KiB, returns explicit method/validation/authentication errors, disables response caching and hides unexpected database details behind a generic error while forwarding the original error to the private monitoring hook.

## Runtime composition

`src/marketplace/runtime.mjs` creates one database boundary and composes:

1. authentication/session repository;
2. social identity, email credential and secure session-issuance services;
3. account security;
4. cleaner profile repository/service;
5. property repository/service;
6. marketplace HTTP router.

Composition fails closed unless `DATABASE_URL`, separate 32+ character `SESSION_SECRET` and `AUTH_TOKEN_SECRET`, exact `APP_ORIGIN` and distinct 32+ character `DATA_ENCRYPTION_KEY` are present. It does not connect eagerly or enable public authentication capability flags. Session issuance stores only token/CSRF hashes and keyed metadata hashes; logout and role-change rotation revoke database sessions before clearing or replacing cookies.

## Enablement procedure

These controllers are not attached to the live pilot server yet. Complete all of the following before attachment:

1. Provision PostgreSQL 16 using separate migration-owner and restricted `tideway_app` roles.
2. Apply migrations and runtime grants in the documented order, then run real RLS and concurrent-overlap integration tests.
3. Add and lock a maintained PostgreSQL Node driver through the approved dependency workflow; the current dependency-free pilot has no package installer or database driver.
4. Put database/session/token/encryption secrets in the deployment secret manager and use an exact HTTPS `APP_ORIGIN` in production.
5. Compose login/session creation, logout and role onboarding routes first so browser requests can receive real opaque sessions and CSRF material.
6. Attach the router before legacy API dispatch, add shared persistent rate limiting and structured private error monitoring.
7. Add mobile-first pages and browser tests using genuine staging accounts. Keep `/cleaners` closed until at least one real, completed, public Cleaner profile exists.

## Third-party services still requiring approval/configuration

- PostgreSQL hosting and backups/PITR.
- Private S3-compatible object storage and upload inspection for property/job media.
- SMTP or transactional email for verification, reset and booking notices.
- Google OIDC, then optional Apple and Facebook identity credentials.
- A map provider only when live journey tracking enters staging.
- Shared rate limiting, security monitoring and error reporting for multi-instance deployment.

No provider account, credential, paid service or Polsia credit was used for this source checkpoint.
