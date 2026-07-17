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
| `POST /api/marketplace/cleaning-requests` | Landlord | Session, exact origin, CSRF, Landlord role and owned property; always creates a private draft |
| `GET /api/marketplace/cleaning-requests/:requestId/scan` | Authorized participant/admin | Safe room/photo metadata only; invited Cleaner requires Landlord preview consent |
| `POST /api/marketplace/cleaning-requests/:requestId/photos/intents` | Landlord | Owner draft, session/origin/CSRF, reviewed-room binding, checksum/type/size and server-owned quarantine/final keys |
| `POST /api/marketplace/cleaning-requests/:requestId/photos/:uploadId/complete` | Landlord | Exact stored-object verification, bounded image decode, metadata-stripping JPEG re-encode and function-only completion |
| `GET /api/marketplace/cleaning-requests/:requestId/photos/:photoId/access` | Authorized participant/admin | Five-minute private no-store signed read; no object key/checksum projection |
| `POST /api/marketplace/cleaning-requests/:requestId/submit` | Landlord | Owner draft, session/origin/CSRF, at least one sanitized room photo, reviewed scope, explicit preview choice and audited combined fingerprint |
| `GET /api/marketplace/bookings/:bookingId/payment` | Booking Landlord/admin | Session, role plus owner-bound security-definer status projection; no provider IDs, retry material, payout destination or client secret |
| `GET /api/marketplace/cleaner/payout-account` | Cleaner | Session and Cleaner role; returns readiness only, never the stored provider destination |
| `POST /api/marketplace/cleaner/payout-account/onboarding` | Cleaner | Exact origin, CSRF and Cleaner role; creates/reuses server-owned test account and returns one short-lived exact Stripe-hosted link |
| `POST /api/marketplace/cleaner/payout-account/refresh` | Cleaner | Exact origin, CSRF and Cleaner role; retrieves provider status and stores only bounded readiness flags |
| `POST /api/marketplace/bookings/:bookingId/payment` | Booking Landlord | Session, exact origin, CSRF, Landlord role, strong retry key and server-frozen booking amount; route absent while payments are detached |
| `POST /api/marketplace/payments/webhook` | Stripe-signed event only | Exact raw bytes, 1 MiB limit, test-mode signature/version validation and allowlisted reconciliation; route absent while payments are detached |

Prepared authentication routes use `POST` only: `/api/marketplace/auth/signup`, verification resend/confirmation, login, password-reset request/confirmation, logout, logout-all, and `/api/marketplace/onboarding`. They are attached to the runtime chain only when internally verified SMTP delivery, shared rate limiting and a server-derived client key are configured together.

Google adds two deliberately narrow `GET` navigation routes when—and only when—its complete OIDC provider is attached: `/api/marketplace/auth/google/start` and `/api/marketplace/auth/google/callback`. Start creates signed short-lived state, nonce and PKCE material in an HTTP-only same-site cookie. Callback immediately exchanges the one-time code on the server, verifies Google's RS256/JWKS signature plus issuer, audience, expiry, nonce and verified email, clears the flow cookie, resolves the Tideway identity and issues Tideway's own opaque session. It redirects again before rendering any page so the provider code is not left in an HTML URL. Google access and refresh tokens are not stored.

Facebook adds start/callback routes only when its complete provider and pending-identity service are attached. It uses signed ten-minute state, an exact version-pinned callback, server-side code exchange, App-ID-bound token inspection, `appsecret_proof`, subject matching and bounded provider traffic. A returning Tideway-verified Facebook subject receives an opaque session. A new subject receives a private Tideway mailbox-verification email; `/api/marketplace/auth/facebook/verification/confirm` creates or connects only after that token is consumed. Password, inactive and unverified-account collisions never auto-link.

The controller owns the `/api/marketplace/` namespace and does not intercept any existing pilot route. It accepts JSON objects only, limits bodies to 64 KiB, returns explicit method/validation/authentication errors, disables response caching and hides unexpected database details behind a generic error while forwarding the original error to the private monitoring hook. Cleaner discovery and public approved-review reads use separate scopes in the same trusted shared-limiter boundary as authentication. A denied request receives a bounded `Retry-After`; a missing client key, malformed limiter decision or limiter outage fails closed with a generic 503 while the private cause reaches monitoring. The Cleaner query/review service is never called after that failure.

## Runtime composition

`src/marketplace/runtime.mjs` creates one database boundary and composes:

1. authentication/session repository;
2. social identity, email credential and secure session-issuance services;
3. account security;
4. cleaner profile repository/service;
5. property repository/service;
6. marketplace HTTP router.

`src/marketplace/attachment.mjs` returns a zero-resource disabled boundary unless `MARKETPLACE_ENABLED=true`. Enablement fails closed unless database/secrets/origin, SMTP and complete S3-compatible storage configuration, valid client identity and private operational monitoring are present. It loads the shipped `homle:monitoring-webhook` adapter or a reviewed absolute custom module, constructs the [client resolver](TRUSTED_CLIENT_IDENTITY.md), [SMTP delivery](SMTP_EMAIL_DELIVERY.md) and [private media storage](PRIVATE_JOB_MEDIA.md) internally, verifies PostgreSQL 16+ as non-bypass `tideway_app`, then verifies SMTP and the private bucket before composing routes. Normal SQL traffic uses `DATABASE_URL`; one separate pool capped at one connection uses the direct `REALTIME_DATABASE_URL`, proves `LISTEN/UNLISTEN`, and targets the same database before the runtime starts. Failure and shutdown close realtime signals, both database pools, SMTP, storage and monitoring exactly once.

The main server dispatches `/api/marketplace/*` to this router before the NDJSON pilot and exposes only booleans in `/api/health`. `/api/auth/providers` advertises email/password, reset and verification only when those routes are actually attached. Google or Facebook becomes true only when its complete verifier, callback, persistence and runtime boundary are attached; credentials alone still cannot advertise either provider. Apple remains false because its production callback does not yet exist. Session issuance stores only token/CSRF hashes and keyed metadata hashes; logout and role-change rotation revoke database sessions before clearing or replacing cookies.

Public signup, verification resend and password-reset request return the same generic response regardless of account existence. Trusted delivery receives a fragment-token HTTPS link; raw delivery material is never placed in the API response. A 500 ms minimum response window and the mandatory shared limiter reduce enumeration/abuse exposure. The replacement-verification migration invalidates older unused links atomically.

## Enablement procedure

The attachment point is present but remains disabled. Complete all of the following before setting `MARKETPLACE_ENABLED=true`:

- configure `DATABASE_URL` for normal request traffic and a direct, session-capable `REALTIME_DATABASE_URL` for the same database; never point the latter at a transaction-mode pooler;

1. Provision PostgreSQL 16 using separate migration-owner and restricted `tideway_app` roles.
2. Apply migrations and runtime grants in the documented order, then run real RLS and concurrent-overlap integration tests.
3. Install the reviewed `pg` 8.22.0 dependency with `pnpm install --frozen-lockfile --ignore-scripts` after `node tools/check-dependency-lock.mjs` passes. The exact direct version, pnpm version, transitive registry integrity values and normalized lockfile SHA-256 are source-gated. The attachment still imports `pg` only after enablement, so the dependency does not alter the local pilot.
4. Put database/session/token/encryption secrets in the deployment secret manager and use an exact HTTPS `APP_ORIGIN` in production. For Google, create a Web OAuth client and register exactly `${APP_ORIGIN}/api/marketplace/auth/google/callback`; keep its client secret server-side.
5. Configure the reviewed proxy boundary and SMTP sender. Provision the private bucket with the documented public-access block, encryption, signed-header CORS and lifecycle policy; prove real malformed/EXIF/threat cases. Configure the shipped privacy-minimal monitoring adapter as documented in `MONITORING.md`, or provide a reviewed absolute custom module exporting `createMarketplaceDeploymentAdapters({ env })` with monitoring and deterministic shutdown. Prove alert delivery, multi-instance limiting and authentication under HTTPS.
6. Confirm `/api/health` changes from `marketplace.ready=false` to true only after the database probe and complete composition succeed; verify a startup failure exposes no partial routes or authentication capabilities.
7. Add mobile-first pages and browser tests using genuine staging accounts. Keep `/cleaners` closed until at least one real, completed, public Cleaner profile exists.

## Third-party services still requiring approval/configuration

- PostgreSQL hosting and backups/PITR.
- Approved S3-compatible private bucket, least-privilege credentials, public-access/CORS/lifecycle evidence and the documented content-threat decision; the adapter and re-encoder are implemented internally.
- Approved SMTP service, aligned sender domain, bounce/complaint suppression and staging delivery evidence; the generic adapter is implemented internally.
- Verified Google Web OAuth credentials and consent-screen configuration; and, if enabled separately, a reviewed Meta app, exact Graph version, callback, deletion flow and staging evidence. Apple remains a later integration.
- A map provider only when live journey tracking enters staging.
- Final reverse-proxy CIDRs/header sanitation, security monitoring and error reporting for multi-instance deployment. The client resolver is implemented, but the PostgreSQL limiter still requires real two-instance staging evidence.

No provider account, credential, paid service or Polsia credit was used for this source checkpoint.
