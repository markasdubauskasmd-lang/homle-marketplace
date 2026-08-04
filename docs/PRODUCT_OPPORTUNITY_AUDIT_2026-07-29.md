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
- The live `/api/health` response rechecked on 30 July 2026 reported marketplace,
  authentication, media, realtime, geocoding, matching, speech summary and room
  vision ready. Transactional email, payments and automatic dispatch reported not
  ready, and public intake remained closed.
- The live release was `4cbf3210` with 80 locked migrations when this evidence
  was rechecked after the private support journey deployed.

## Issue fixed during this audit

### Archived-property recovery

The owner-safe property archive flow retained completed work but was irreversible in
the product. A mistaken archive therefore removed the property from future requests
and required manual database support to recover it.

The Landlord dashboard now keeps archived locations in a collapsed owner-only list
and restores one through a protected, audited database operation. The restored
property returns to active request selection while its historical work remains
intact. The recovery route remains Landlord-only, owner-bound, CSRF-protected and
archived-only.

Expected benefit: fewer founder support interventions, faster correction of an
ordinary Landlord mistake, and less risk that someone recreates the same property and
fragments its history.

The Cleaner Dashboard, matching, pricing, payments and shared presentation assets
were not changed.

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

## Private Landlord support journey added

The Landlord account previously had no single recoverable path for account, property,
room-scan or pre-booking problems. Booking disputes were too late and too specific,
while publishing an email address would have created an unaudited parallel queue.

`/landlord/help` now accepts a bounded category, subject and description after an
explicit sensitive-data check. The same page shows the Landlord only their own request
status and final in-app response. `/admin/support` provides the separate
Administrator-only triage queue. Database functions enforce role isolation, active
request limits, idempotent retries and an audit trail; the queue cannot change a
booking, payment, account or external system. Migration 080 and the real PostgreSQL
RLS rehearsal are live.

Expected benefit: Landlords have one private next step before a booking exists, while
the founder receives a controlled queue without access codes, payment data, room
photographs or unnecessary identity fields.

## Unsupported public trust claim fixed

The live homepage said **Vetted professionals** even though the service remains a
restricted private pilot and no public Cleaner supply or coverage is confirmed. That
headline turned an implemented verification capability into a claim about current
supply, contradicting the product's evidence-only launch rules.

The homepage now says **Fit checked before matching** and explains the actual
server-backed boundary: coverage, availability and price are confirmed before a
Cleaner is invited. No verification workflow, matching rule, Cleaner page or Cleaner
Dashboard behavior changed. A landing-page regression rejects common unsupported
public screening and insurance claims.

Expected benefit: prospective customers receive an accurate explanation of how
matching works without being promised supply or vetting evidence Homle does not yet
have.

## Non-Cleaner route and asset defect fixed

The public Facebook data-deletion status page requested `/account.css`, an asset that
has never existed in the repository and returned a live 404. The page already uses
the shared account primitives shipped in `styles.css`, so the dead request added no
visual behavior; it only wasted a request and left a production error on a required
provider-compliance journey.

The invalid stylesheet reference is removed. A new source-level integrity gate now
checks every local route and asset reference across the shipped customer, Landlord,
account, legal and Administrator HTML pages while explicitly excluding the Cleaner
workspace. API actions are left to their existing HTTP authorization suites.

Expected benefit: the Facebook deletion journey loads without a known production
404, and future non-Cleaner page changes fail CI when they introduce a missing local
route, script, stylesheet, image or manifest.

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

### P1 — launch-area supply and demand control — implemented

Problem: a marketplace can collect demand in an area where no suitable Cleaner has
declared coverage, creating manual support work and slow first response.

Implemented: `/admin/coverage` provides an Administrator-only, privacy-minimal
operational report for 7, 30 or 90 days. It groups demand by outward postcode and
reuses the production eligibility matcher per future unmatched request instead of
inventing a weaker counting rule. It shows zero-match and at-risk demand, unmatched
age, service gaps and a coarse active-listed-supply total. The database and API return
no identities, exact postcodes, addresses, coordinates, notes or photos.

Limit: this is a current operational snapshot, not a forecast or a coverage promise.
Eligible counts are capped at 50 per request; active listed supply is not attributed
to an area. The report never contacts or recruits Cleaners and changes no request,
booking, price, payment or Cleaner Dashboard behavior.

Benefit: tells the founder where supply is missing and where not to promise coverage,
using the same eligibility boundary that actually governs matching.

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

Implemented: `/admin/funnel` derives counts from authoritative account, property,
structured-scan, request, booking, payment and review records. It uses separate
account/request/payment cohorts, excludes the newest 24 hours and shows 7, 30 or 90
day windows. No tracking event, browser identifier or private record is added.

Privacy boundary: the Administrator-only database projection returns counts and
timestamps only—never identities, IDs, addresses, postcodes, rooms, photos, provider
references, prices or payment amounts. The runtime has execute permission on that
projection but no direct structured-scan or payment-table read.

Benefit: directs product and marketing work at measured conversion loss rather than
visual guesswork. Remaining limitation: this is operational cohort evidence, not
causal attribution, and small cohorts must not be over-interpreted.

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
