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
- Isolated POST-only authentication controller for signup, verification resend/confirmation, login, reset request/confirmation, exact logout, logout-all and Cleaner/Landlord onboarding rotation. Internally verified SMTP delivery, shared rate limiting and a server-derived client key are mandatory composition dependencies.
- Capability-gated mobile account forms for login, signup, verification/recovery, reset and role onboarding; markup is hidden/disabled until the complete email-password runtime reports ready, and fragment tokens are removed before network activity.
- RLS on password credentials, verification tokens, reset tokens and sessions, plus a checked non-bypass runtime-role grant script.
- Bounded, concurrency-safe expired-session deletion through the separately credentialed worker role; web runtime `DELETE` authority on sessions is revoked and the orchestration loop reports when capped batches may remain.
- Setup details in `docs/DATABASE_SETUP.md`, the mandatory provider-verification boundary in `docs/AUTHENTICATION_SECURITY.md`, and isolated regression tests using fake PostgreSQL-compatible repositories.

Not yet enabled: real PostgreSQL, SMTP and private-bucket evidence, final monitoring, HTTPS deployment or genuine accounts. The server attachment, exact runtime dependencies, strict-TLS SMTP, S3/Sharp private-media boundary, Google OIDC and Facebook-plus-Tideway-mailbox callback are prepared behind an explicit gate. Provider capability flags remain off.

- Add a PostgreSQL connection/repository layer and transaction helper that always sets the RLS user context.
- Add opaque secure sessions, `HttpOnly; Secure; SameSite=Lax` cookies, CSRF tokens, rotation, logout-all-sessions and session expiry.
- Add email/password signup using memory-hard password hashing, email verification and single-use password-reset tokens.
- Add Google OIDC with authorization code plus PKCE; add Facebook authorization-code validation plus Tideway-owned mailbox verification; keep Apple behind its own later provider capability.
- In one transaction, create the first account from a verified provider identity or link it to the existing verified-email account. Reject ambiguous/unverified merges.
- Re-authenticated provider connection/removal in settings is implemented: password accounts use persistent-lockout-aware password proof; social-only accounts prove an exact existing subject, removal preserves a different method and all sessions are revoked.
- Add `/login`, `/signup`, `/onboarding` and `/settings` using the existing Tideway design tokens.
- Add role middleware and role-specific onboarding. Admin role is never self-selectable.

Tests: new Google account, verified-email deduplication, role onboarding, password reset, verification, session rotation/logout, CSRF and cross-role denial.

## Phase 2 — profiles, properties and discovery

Status: in progress.

Implemented cleaner-profile checkpoint:

- Ownership-only profile replacement with bounded biography, pricing, services, outward-postcode areas, radius, experience, languages, supplied equipment/products, work preference and availability status.
- Deterministic nine-requirement completion scoring; incomplete profiles remain private and cannot enter discovery. Provider photos are preserved when present, while email accounts can use the safe initials fallback instead of pasting a remote image URL.
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

Not yet enabled: account pages beyond honest closed entry states, real PostgreSQL/private-bucket execution, geocoding, an authenticated marketplace account or genuine public cleaner supply. The route, driver and object-storage source boundaries are attached only behind the false capability gate.

- Add cleaner profile, services, service areas, availability and completion calculator APIs/pages.
- Attach the prepared account routes after real PostgreSQL/session staging tests; add authenticated mobile pages and validated private object-storage photos.
- Add `/cleaners` and `/cleaners/:cleanerId` search with location, availability, rating, price, service, distance and verification filters.
- Never return cleaner email, phone or home address in public projections.
- Add landlord dashboard, cleaner dashboard, profile, availability, properties and property detail pages.

Tests: cleaner owns one profile, cannot edit another profile, public projection privacy, property ownership, access-instruction protection and search filters.

## Phase 3 — relational request, matching and booking lifecycle

Status: in progress.

Implemented account cleaning-request checkpoint:

- Authenticated-Landlord creation/listing against an owned non-archived property; submitted owner identifiers cannot select the account.
- Exact future scheduling, bounded duration/budget, shared supported services, constrained recurrence and required unique room-labelled tasks.
- Canonical SHA-256 scope fingerprint tying the property, schedule, instructions, economics context and reviewed checklist together.
- One transaction for property ownership check, request, ordered tasks and initial owner-protected status history.
- Safe migration/backfill from earlier request status labels plus submitted-at and request-history RLS.
- Contract tests in `tests/cleaning-request-service.mjs` and enablement boundary in `docs/ACCOUNT_CLEANING_REQUESTS.md`.

Implemented frozen invitation/acceptance checkpoint:

- Private server-owned pricing derives Cleaner pay from active service prices, covers explicitly configured costs and solves the minimum customer total meeting the approved margin floor; browser-submitted economics are discarded.
- One locked database transition rechecks request ownership/state/budget, Cleaner profile/service/full-window availability, freezes scope and terms fingerprints, copies the room checklist and records both histories plus an idempotent notification.
- Cleaner-only accept/decline rechecks eligibility, scope and availability; PostgreSQL’s exclusion constraint is the final concurrent overlap guard.
- Declines preserve the cancelled attempt and reopen matching while a partial unique index permits one replacement but never two live invitations.
- Direct app-role booking writes are revoked in favour of audited actor-aware functions. Contract/static coverage is in `tests/booking-workflow.mjs`; setup and staging boundaries are in `docs/BOOKING_INVITATIONS.md`.

Implemented request-specific matching checkpoint:

- Request-owner-only database function hard-filters inactive/incomplete profiles, preference/service mismatches, manual pricing, incomplete availability, pending/active overlaps and undeclared/out-of-radius coverage.
- Private profitability policy excludes unsafe or over-budget estimates before ranking.
- Distance, rating, estimated price, prior completed relationship, verification and internal acceptance reliability produce a deterministic shortlist; hard eligibility cannot be compensated by scoring.
- Public projections expose plain-language reasons and the estimated customer total while withholding contact details, service coordinates, Cleaner pay, platform costs, raw acceptance rate and internal factor scores.
- Contract/static coverage is in `tests/matching-service.mjs`; the enablement boundary is in `docs/REQUEST_MATCHING.md`.

Implemented invitation expiry/requeue checkpoint:

- Bounded concurrent workers claim due pending invitations with row locks and `SKIP LOCKED`, cancel each attempt once and release the partial-unique request slot.
- The associated request atomically returns to matching; booking/request histories distinguish automatic system changes from user actions and idempotent notifications inform both participants.
- A late assigned-Cleaner response returns the terminal expired record rather than leaving the request stuck or fabricating a response.
- Expiry execution belongs only to a separate checked `tideway_worker` role; the web runtime role has no execute grant.

- Import existing pilot request/scan/proposal/booking records through a dry-run-first migration tool while retaining legacy references.
- Create account-backed cleaning requests from saved properties and frozen room-scan checklists/media.
- Add ranked matching using explicit service area, confirmed availability, services, price, rating, earlier relationship and acceptance rate. Every factor remains explainable.
- Validate the prepared notification inbox and email outbox against real PostgreSQL and an approved idempotent email provider in staging.
- Extend the confirmed booking from acceptance through journey, arrival, active cleaning, review, completion, cancellation and dispute transitions.
- Add `/bookings/new` and `/bookings/:bookingId`; retain the existing protected booking packs as a migration fallback.

Tests: request creation, cleaner acceptance/decline, concurrent overlapping acceptance, unauthorized booking reads, frozen terms and complete lifecycle transitions.

## Phase 4 — live journey and cleaning progress

Status: in progress.

Implemented live-journey checkpoint:

- Cleaner-only explicit-consent journey start, current-location update and idempotent arrival transitions with server-side booking-state and participant checks.
- Participant-only tracking projection with public Cleaner identity, `live`/`stale`/`stopped`/`arrived` state, last-updated evidence and optional trusted-server ETA.
- Current-only five-minute location upsert, stale withholding, worker purge, automatic deletion after leaving journey statuses and no route-history table.
- One-time 500-metre nearby notification when property coordinates exist; arrival/journey notifications are idempotent durable records.
- Browser ETA input is discarded; missing/failed map infrastructure degrades without blocking arrival. Mobile-web foreground limits are documented in `docs/LIVE_JOURNEY_TRACKING.md`.

Implemented live cleaning-progress checkpoint:

- Assigned-Cleaner start, pause/resume, task status/note, issue, unexpected-task proposal and finish transactions; Landlord-only one-decision approval/decline for added work.
- Unexpected work requires a bounded time estimate and explicit confirmation that approval does not change frozen price or Cleaner pay; paid scope changes remain blocked pending a separate quoted change-order workflow.
- Participant snapshot calculates elapsed time excluding pauses, resolved/completed counts, room completion, safe photo metadata and the latest durable events.
- Every mutation writes timestamped actor evidence plus a monotonically increasing event version before idempotent participant notification records.
- Finish is blocked by an open pause, unresolved task or pending added-task decision and moves a fully resolved visit to `awaiting-review`.
- Direct web-role writes to progress/photo/notification tables are revoked. Details are in `docs/LIVE_CLEANING_PROGRESS.md`.

Implemented private job-media checkpoint:

- Assigned-Cleaner-only ten-minute upload intents use server-generated quarantine/final keys, exact declared MIME/size/SHA-256 values and private signed writes; object keys and bucket credentials never enter a browser response.
- Completion reads authoritative object metadata and rejects mismatches before a server-side decode, safety inspection, metadata strip and JPEG re-encode boundary.
- One audited database transaction creates the sanitized private photo, progress event and idempotent Landlord notification; abandoned intents are claimed by a bounded worker for quarantine cleanup.
- Participant-only reads receive a five-minute signed URL after database authorization. Missing storage infrastructure fails closed, and the implementation remains detached until a real adapter plus staging security evidence exists. Details are in `docs/PRIVATE_JOB_MEDIA.md`.

Implemented booking real-time checkpoint:

- PostgreSQL triggers add minimal durable events and transaction-commit `NOTIFY` wake-ups for booking status, current location, progress and messages; notifications are signals only and never trusted as display data.
- One lazy dedicated listener reconnects with bounded backoff, while participant-authorized snapshots provide current tracking, progress, messages and durable event catch-up without constant polling.
- The exact-origin SSE route uses event IDs, retry hints, heartbeats, slow-client disconnection and reserved per-user/process connection limits. Browser background limitations remain explicit.
- Source, security and staging boundaries are documented in `docs/BOOKING_REALTIME.md` and covered by `tests/realtime-service.mjs`.

- Connect the mobile booking UI to the authenticated booking-scoped SSE channel and validate proxy/multi-instance behavior in PostgreSQL staging.
- Add the mobile tracking page with foreground `watchPosition`, map rendering, permission/offline/retry states and large Start journey / I have arrived controls after an approved map provider is configured.
- Add the mobile active-job screen and connect it to the prepared private before/after/issue-photo endpoints after staging object-storage approval.
- Store updates transactionally, then render the prepared progress snapshots and durable event identifiers so reconnects catch up without blind polling.
- Add poor-connection/offline status, queued non-destructive task updates and clear conflict/retry handling.

Tests: consent and participant location authorization, automatic stop, unrelated-user denial, progress ownership, realtime delivery/reconnect and private media access.

## Phase 5 — communication, reviews, notifications and administration

Implemented booking-message checkpoint:

- One conversation per booking with participant-only sends and participant/authorized-Administrator reads; messaging state is checked inside the database and direct runtime table access is revoked.
- Server-generated message IDs plus client retry UUIDs make sends idempotent, while database locks enforce cross-instance per-account rate limits.
- Service and database validation reject direct email, telephone, web-link and named outside-messaging details; message bodies never enter notification payloads or audit metadata.
- Stable tuple-cursor pagination, bounded pages and isolated account routes are covered in `tests/message-service.mjs` and documented in `docs/BOOKING_MESSAGING.md`.

Implemented notification inbox/outbox checkpoint:

- Authenticated account-only inbox routes provide a bounded tuple cursor, exact unread count, single-read and race-safe read-all actions; transaction-local identity is rechecked by narrow database functions and direct runtime table access stays revoked.
- PostgreSQL derives one privacy-minimal email row from each supported lifecycle notification with a channel-prefixed idempotency key; names, contact/address/access data, message bodies, photos and coordinates never enter the outbox payload.
- A separate worker role claims bounded batches with `SKIP LOCKED` leases, retries transient failures with bounded backoff, stops after five attempts/permanent failure and excludes inactive or unverified recipients.
- Text-only email rendering uses the notification UUID to derive a stable SMTP Message-ID and delivery header under a trusted HTTPS origin. SMTP remains at-least-once because it cannot guarantee provider deduplication. No worker or provider is enabled without PostgreSQL, approved SMTP credentials and staging evidence. Details are in `docs/NOTIFICATIONS.md` and `docs/SMTP_EMAIL_DELIVERY.md`.

Implemented verified-review checkpoint:

- Landlord-only completion confirmation moves an actually finished `awaiting-review` booking to `completed` with audit/history evidence; only then can that booking receive one overall/category/written review.
- The unique booking constraint plus same-content retry handling protects concurrent submissions. Pending/rejected content stays hidden from the Cleaner and public directory.
- Public Cleaner review pages return approved ratings, text, optional response and stable pagination without booking, Landlord or moderation identity. The app role cannot query the raw review table.
- Approved-only triggers recalculate the exact average/count after moderation, while completed-job totals derive from recorded booking completion. Administrators can re-moderate fraud/abuse, and the assigned Cleaner receives one final professional response.
- Details are in `docs/VERIFIED_REVIEWS.md`; coverage is in `tests/review-service.mjs` and `tests/marketplace-http.mjs`.

- Add disputes, suspension, verification and review-moderation tools to the existing `/admin` design.
- Add marketplace statistics derived from audited records, not invented counters.

Tests: message isolation, idempotent notifications, completed-only unique reviews, aggregate recalculation, moderation/response ownership and suspended-account denial.

## Phase 6 — production hardening and deployment

- Provision the implemented S3-compatible private boundary; prove signed-header CORS, content-type/size/checksum verification, Sharp re-encoding, the explicit malware/threat decision and retention workers.
- Shared rate limiting, structured security logs, error monitoring, database backups/PITR, secret rotation and audit retention.
- Container/reverse-proxy deployment with HTTPS, trusted proxy rules, health/readiness checks and zero-downtime migrations.
- CI for syntax/lint, unit, database migration, integration, authorization, WebSocket and mobile browser tests.
- Data export/deletion workflow, privacy/legal review and location/photo consent copy.
- Load and failure testing on slow mobile networks; native/PWA decision for reliable background tracking.

## Environment and third-party inventory

Required before production account use:

- PostgreSQL: pooled normal-traffic `DATABASE_URL` plus direct session-capable `REALTIME_DATABASE_URL` to the same database.
- Sessions/authentication tokens/encryption: distinct `SESSION_SECRET`, `AUTH_TOKEN_SECRET`, `DATA_ENCRYPTION_KEY` values.
- Public deployment: `APP_ORIGIN` using verified HTTPS.
- Email verification/reset/notifications: `SMTP_URL`, `EMAIL_FROM`.
- OAuth as enabled: Google client ID/secret; Facebook app ID/secret plus exact Graph API version; Apple client/team/key/private key.
- Private object storage: exact endpoint, bucket, region, server access credentials and optional path-style flag.
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
