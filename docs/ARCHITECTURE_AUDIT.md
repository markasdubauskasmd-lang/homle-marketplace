# Tideway architecture audit

Audit date: 15 July 2026

## Existing application

Tideway is a dependency-free Node.js 20 web application, not a React, Next.js, Express or serverless project. `server.mjs` uses the native `node:http` server and serves semantic HTML, one shared CSS file and browser ES modules from `public/`. There is no compilation or bundling step.

| Area | Current implementation | Reusable parts | Production marketplace gap |
| --- | --- | --- | --- |
| Framework | Native Node HTTP server plus vanilla browser modules | Small runtime, existing API handlers and secure response helpers | The monolithic server must be split into account, marketplace, booking and realtime modules as features grow |
| Database | Eighteen append-only NDJSON record types and private media on local disk; writes serialize through one process | Auditable pilot history, integrity checks, request/scan/proposal/booking domain knowledge | No relational constraints, multi-instance transaction safety, indexed search, row-level security or production backup/retention controls |
| Authentication | No user accounts. Customer, cleaner, quote, opportunity and booking links use high-entropy fragment tokens passed in headers. Admin is loopback-only or protected by `ADMIN_KEY` | Token isolation, constant-time secret comparison, same-origin checks and private projections | No OAuth, password credential, verified email, account linking, roles, sessions, logout, password reset or account settings |
| API | REST-like routes in `server.mjs`; JSON bodies; server validation; scoped in-memory rate limits | Working intake, scan, matching, proposal, two-sided decision, booking, job-event and outcome flows | No versioned marketplace API, account middleware, database repository, realtime transport or horizontal rate limiter |
| Styling | `public/styles.css` with Tideway green/mint/cream tokens, responsive layouts, visible focus states, large mobile actions and semantic HTML | Preserve tokens, `.button`, cards, guided forms, status panels and mobile breakpoints | Auth, dashboards, search, active job and settings components need to reuse this system |
| Realtime | No WebSocket or subscription layer; users manually refresh protected pages | Append-only job-event semantics | Live location, task progress, messages and notifications require authenticated channels and reconnect handling |
| Files | Room photos and videos are validated, stored locally and served through authorised non-cacheable routes | Account marketplace now has internal signed S3 quarantine/read, checksum/encryption headers, bounded Sharp decode, metadata-stripping JPEG output and cleanup contracts | Provision a private bucket; prove public denial, CORS, lifecycle, malformed/decode/EXIF behavior and the explicit malware/threat decision; run retention jobs |
| Deployment | Local loopback listener and optional trusted-Wi-Fi listener; no container, reverse proxy, CI or public host | Health endpoint and graceful shutdown | HTTPS, secret manager, PostgreSQL, object storage, email, OAuth callbacks, shared rate limiting, monitoring and automated deploy/rollback are required |
| Tests | One broad end-to-end smoke test starts an isolated server and temporary data directory; syntax checks cover browser/server modules | Strong regression coverage of the current booking workflow | Add unit, database migration, authorization, concurrency, WebSocket and browser tests plus CI |

## Existing API groups

- Public intake: cleaning requests, cleaner applications and room scans.
- Private token flows: customer tracker/withdrawal, cleaner tracker/availability, quote and cleaner decisions, protected booking packs, job events and change requests.
- Local administration: records, integrity, matching, proposals, scan review, screening, availability, bookings, outcomes, retention and launch configuration.

These flows remain operational while the account-backed marketplace is introduced. Existing NDJSON references should be imported into PostgreSQL through an explicit, reversible migration tool; they must not be silently rewritten or treated as authenticated accounts.

## Target architecture

1. Keep the current HTML/CSS/ES-module frontend and progressively add route-specific pages and reusable browser components.
2. Refactor the native Node server behind small routers and service modules instead of introducing a second application.
3. Use PostgreSQL 16 for accounts, profiles, properties, requests, bookings, progress, messages, reviews, notifications, disputes and audit logs.
4. Use database transactions and the booking exclusion constraint for cleaner acceptance and confirmation.
5. Use secure opaque session cookies backed by hashed server-side sessions; rotate on login and role changes. Require CSRF tokens on cookie-authenticated mutations.
6. Link OAuth identities only after a provider asserts a verified email. Account linking must run in one transaction and require re-authentication from settings.
7. Use an S3-compatible private object store for property/job media. Store keys, not public URLs, and authorise every read on the server.
8. Use authenticated WebSockets for booking-scoped progress, messages and current-location updates. Persist important state changes before broadcasting.
9. Store only the cleaner's latest journey location per booking with a short expiry. Preserve arrival/nearby status events, not a detailed route history.
10. Keep map, email and OAuth credentials in deployment environment secrets. The browser receives only an origin-restricted public map token when a map is actually enabled.

## Mobile web location boundary

`navigator.geolocation.watchPosition()` is suitable while the active-job page is visible, but mobile browsers may throttle or suspend it when the screen locks, the tab is backgrounded or the operating system reclaims the page. The web implementation must therefore show a foreground-sharing requirement, permission/connection state, last update time and a prominent retry/resume action. It must stop on arrival, cancellation, completion, logout or session loss.

A PWA can improve installation, wake-lock guidance and reconnection, but it cannot guarantee continuous background geolocation on iOS or Android. Reliable turn-by-turn/background tracking ultimately requires a native wrapper or native application with platform background-location entitlement, a clear persistent indicator and a stricter consent review.

## Security invariants

- Private actions are authorised on the server and, where possible, again by PostgreSQL row-level security.
- The application sets `SET LOCAL app.user_id` and `SET LOCAL app.user_roles` inside every database transaction before accessing RLS tables.
- OAuth state, PKCE verifiers, session tokens, verification tokens and reset tokens are high entropy and stored only as hashes.
- Verified-email linking never merges an unverified provider email and never links solely because a browser supplied an email string.
- Exact property access instructions stay encrypted and exact visit details are projected to the assigned cleaner only from confirmation through the active visit/review window; cleaner access ends after cancellation, completion or dispute.
- Location writes require the assigned cleaner, explicit booking consent and an allowed active status. Arrival and every terminal state remove the current location.
- Reviews require the completed booking's landlord and remain unique per booking; moderation changes recalculate the public aggregate transactionally.
- All important booking/task/location-consent/review/moderation changes create audit or status-history records before realtime delivery.
