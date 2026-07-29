# Homle product and launch opportunity audit — 29 July 2026

This audit records the highest-value opportunities found while reviewing the current
marketplace, live Render readiness, account entry, Landlord journey, scanner,
matching, booking, payments, notifications and operational documentation.

The Cleaner Dashboard is deliberately excluded. None of the recommendations below
requires changing its design, pages, routes, workflows, styling or backend behaviour.

## Current architecture and live evidence

- Native Node.js 20+ web service and browser UI; there is no framework rewrite or
  parallel application.
- PostgreSQL 16 with locked migrations, transaction-local identity, row-level
  security and separate application/worker responsibilities.
- Opaque server sessions, CSRF protection, provider-first Google authentication and
  capability-gated email, Apple and Facebook authentication.
- Private S3-compatible room/job media with server-authorised reads and metadata
  stripping.
- PostgreSQL-backed matching, bookings, notifications, messages, reviews, disputes,
  current location and cleaning progress.
- Server-sent events provide participant updates without constant browser polling.
- Stripe test-mode-only source boundaries exist, but the public payment gate remains
  off and live keys are rejected.
- The live `/api/health` response on 29 July 2026 reported marketplace, authentication,
  media, realtime, geocoding, matching, automatic dispatch, speech summary and room
  vision ready. Transactional email and payments reported not ready.
- The live release was `ed0adf4f` before the account-entry improvement in this audit.

## Issue fixed during this audit

Unsigned account entry offered both **Open Landlord dashboard** and **Open Cleaner
dashboard** beneath every login/sign-up intent. These links only reopened protected
gates, added decisions and mixed the two roles on the page intended to separate them.

The shortcuts and their unused controller/CSS code were removed. Provider login,
intent preservation, explicit role activation, signed-in role routing and the
role-specific account-ready action remain unchanged.

Expected benefit: one fewer decision point, no cross-role distraction, and a clearer
path from **Book service** to Landlord account creation.

## Account management defect fixed

The protected account-settings backend remained active after its public page and
canonical `/settings` route were removed. Google, Apple and Facebook provider
connection and step-up callbacks still redirected authenticated users to that missing
route, so a successful security action could end on a 404. The same removal made the
already-protected data-export and account-deletion request intake unreachable.

The reviewed settings interface and route are restored, and the Landlord account menu
now links to it as **Sign-in and privacy**. Provider controls remain hidden until
authenticated capability discovery succeeds; connection/removal stays protected by
exact-provider step-up, last-method safeguards, CSRF and allowlisted provider
navigation. Privacy actions remain request intake only and cannot automatically
delete data, cancel a booking, move money or bypass retention review.

Expected benefit: provider connection callbacks have a valid destination, Landlords
can manage account access without leaving the product, and UK privacy-rights intake
is once again reachable without exposing provider subjects or private identifiers.

## Prioritised opportunities

### P0 — prove one genuine two-account booking rehearsal

Problem: source and integration tests are broad, but they do not prove the complete
hosted journey on two physical phones against the real provider configuration.

Action:

1. Use founder-approved test mailboxes only.
2. Create one Landlord and one Cleaner test account.
3. Add a real test property, scan rooms, review the checklist and submit a request.
4. Invite/accept, verify overlap prevention, journey sharing, arrival, checklist
   progress, completion and one review.
5. Capture only privacy-safe evidence and purge the test accounts/records afterward
   with the existing staging purge tooling.

Benefit: exposes integration and mobile-browser failures before customer acquisition.

### P0 — activate transactional email safely

Problem: `emailReady: false` means email signup verification, password reset and
outbound lifecycle notifications cannot be relied upon.

Technical requirements:

- verified sending domain and approved `EMAIL_FROM`;
- Render secret for the reviewed Resend HTTPS adapter or SMTP alternative;
- controlled staging sends and receipt evidence;
- bounce/complaint suppression and provider-webhook validation before broad sending;
- no customer contact until the founder authorises it.

Benefit: recoverable accounts and dependable booking notifications.

### P0 — complete a Stripe test-mode marketplace cycle

Problem: `paymentsReady: false`; a booking cannot yet prove authorization, capture,
Cleaner transfer, refund and reversal against a real test platform.

Technical requirements:

- founder approval of merchant-of-record, cancellation, refund, chargeback, Cleaner
  engagement and payout policies;
- approved Stripe Connect test platform and hosted Cleaner onboarding;
- signed webhook registration;
- two-account HTTPS rehearsal covering authorization, 3-D Secure, delayed webhook,
  completion, capture, transfer, partial/full refund and reversal;
- keep live keys rejected until legal and operational launch gates are approved.

Benefit: verifies money movement without risking real funds.

### P1 — launch-area supply and demand control

Problem: a marketplace can collect demand in an area where no suitable Cleaner has
declared coverage, creating manual support work and slow first response.

Recommendation: add an Administrator-only, privacy-minimal coverage report showing
request counts, eligible Cleaner counts, unmatched age and service gaps by outward
postcode or approved operating area. Do not expose exact addresses or Cleaner homes.

Benefit: tells the founder where to recruit supply and where not to promise coverage.

### P1 — explicit service-recovery workflow

Problem: disputes exist, but customers need a simple, bounded next action when work is
incomplete: report an issue, request review, then see the agreed remedy state.

Recommendation: extend the existing case workflow only after the founder approves
re-clean/refund rules. Keep evidence, deadlines, decisions and money actions
server-authorised and audited.

Benefit: increases trust while preventing informal promises or unaudited refunds.

### P1 — foreground-location reliability evidence

Problem: mobile web browsers cannot guarantee continuous background location. An
Uber-like experience can therefore appear stale when the Cleaner locks their phone.

Recommendation: keep current explicit foreground consent and last-updated time, add
hosted two-device browser evidence, and consider an installable PWA/native companion
only after data proves background reliability is a material problem.

Benefit: truthful arrival tracking without collecting unnecessary location history.

### P2 — privacy-minimal marketplace funnel analytics

Problem: operational metrics do not yet prove where users abandon account creation,
property setup, scanning, quote approval or booking confirmation.

Recommendation: record coarse, server-confirmed funnel transitions and failure codes;
never store room notes, addresses, photos, message text or OAuth tokens in analytics.

Benefit: directs engineering and marketing effort at measured conversion loss rather
than visual guesswork.

## Features deliberately not recommended yet

- Dynamic/surge pricing: insufficient liquidity and pricing evidence; it would reduce
  trust before solving a real problem.
- Public map history: unnecessary privacy exposure; current-point-only sharing is the
  safer product boundary.
- Automatic recurring charges/bookings: frequency is currently a planning preference.
  Each visit should remain separately scoped and accepted until cancellation and supply
  operations are proven.
- AI-generated dimensions or floor area from a browser camera: unreliable and likely
  to misprice work.
- Gamified Cleaner metrics without recorded evidence: would invent performance claims.

## Next implementation order

1. Ship and verify the focused account-entry fix.
2. Run the genuine two-account hosted rehearsal.
3. Activate and evidence transactional email.
4. Complete the founder-approved Stripe test-mode cycle.
5. Build the privacy-minimal supply/demand report only after the rehearsal exposes the
   real operating-area data required.
