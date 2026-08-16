# Homle continuous improvement record — 14 August 2026

## Production evidence reviewed

- The live custom domain serves packaged release `6fb4767f` with 98 locked migrations.
- Database integrity is healthy and writes are currently allowed.
- Authentication, private media, real-time updates, postcode geocoding, pricing and matching, automatic dispatch, speech summarisation and room vision all report ready.
- Stripe currently reports detached (`paymentsReady: false`). `render.yaml` deliberately keeps `PAYMENTS_ENABLED=false`, the source adapter is test-mode-only, and no payment should be advertised as available until the protected server capability reports ready.
- Transactional email remains unavailable. This blocks password-recovery and off-site notification delivery until a verified sender and provider credential are supplied.
- Address autocomplete remains optional and unavailable; manual protected address entry still works.
- The only application error in the previous 24 hours was an expected same-origin rejection. The 503 request pattern was automated WordPress and crawler traffic, not a Homle customer API failure.

## Critical database lifecycle finding

Render's account API reports that `homle-marketplace-staging-db` is a free PostgreSQL 16 instance with provider-enforced expiry at `2026-08-16T07:04:50.151062Z`.

The application remains usable for testing before that time, but accounts, properties, scans, requests, bookings and payment records become inaccessible at expiry. Render documents a 14-day paid-upgrade grace period before deletion, but the database is unavailable during the grace period and free instances have no managed backups.

## Safeguard implemented

- The private Administrator activation evidence now accepts `DATABASE_EXPIRES_AT`.
- A connected database with that expiry marker can no longer be presented as production-ready.
- The control desk shows the exact deadline and durable-storage action without exposing credentials, database addresses or provider secrets.
- `render.yaml` records the operator-owned variable without inventing a value for future services.
- Removing the variable is an explicit operator attestation to be performed only after moving to durable managed storage.

This safeguard does not purchase or upgrade infrastructure. The owner must explicitly approve the paid database change in Render before 16 August 2026 to avoid interruption.

## Launch-state UX corrections

- The Landlord completion dialog previously displayed a 30p Stripe test link even when the same deployment reported that payments were detached. Following the link could only end at the protected unavailable state, which looked like a failed payment.
- The public account-entry page used a generated arrow character on every submit control. Chromium exposed all eight generated characters in the accessibility tree even while seven forms were hidden, so a screen reader could announce unrelated arrows after the single available Google action. The decoration now uses a silent CSS mask and a source regression prevents the spoken glyph from returning.
- The dialog now shows the test link and its test-mode explanation only when `/api/health` reports `paymentsReady: true`.
- When payments are detached it instead states that Stripe test checkout is not active, that no payment was attempted and that real booking checkout still opens only after a Cleaner accepts the frozen total.
- This changes no payment, booking, matching or Cleaner behaviour. It does not enable Stripe, accept money or weaken the test-key-only boundary.

## Protected boundary

During publication, newer commits on `main` were found to have changed Cleaner onboarding pages, scripts, styling, navigation, a backend route and their tests. One of those commits also accidentally truncated the booking-dashboard regression suite and caused GitHub's syntax gate to fail. Those concurrent changes contradicted this goal's explicit no-change boundary.

Every affected existing Cleaner file and test was restored byte-for-byte from the last approved protected snapshot, and the newly added Cleaner-only assets and route were removed. No Cleaner Dashboard page, script, style, route, form, business rule or backend behaviour is changed by this work. The 87-file byte-for-byte Cleaner Dashboard freeze remains mandatory before publication.
