# Homle continuous improvement record — 14 August 2026

## Scanner observability now identifies mobile failure modes — 20 August 2026

- Confirmed scanner telemetry is connected end to end: the browser reporter
  posts an allowlisted, identifier-free batch through an authenticated,
  CSRF-protected Landlord route; the runtime shares the collector with scan
  services; and the Administrator scan-operations screen reads aggregate rates.
- Added the missing provider-read latency observation on both success and
  failure paths. Exact time is immediately reduced to a coarse bucket.
- Split camera permission denial from general camera unavailability and now
  report on-device detector load/runtime failure, so mobile recovery work can
  target the real failure mode rather than one blended count.
- Corrected the architecture record, which still claimed telemetry and scan
  retention were unimplemented. The remaining limitation is explicit:
  telemetry is process-local and resets across deploys/restarts.
- No Cleaner Dashboard file, route, style, form, feature or backend behaviour
  changed.

## Landlord notification retries now stop when the session ends

Production request evidence included a private notification event request that
returned `403` after the same handset's account read returned `401`. Native
`EventSource` retries a failed connection automatically, so the shared badge
client could keep attempting that forbidden endpoint while the page stayed
open. That wastes mobile radio/battery and gives the user no path back to a
valid session.

The Landlord dashboard now loads a Landlord-owned notification badge client.
It closes the native stream on its first error, rechecks the bounded unread
endpoint, treats `401` and `403` as terminal until a deliberate page/online
recovery, and caps transient reconnects at 60 seconds. Hiding the page, going
offline or leaving it cancels both the stream and its timer. The existing
Cleaner notification client is still frozen and unchanged.

Focused notification and Landlord dashboard checks pass, as does the 89-file
byte-for-byte Cleaner Dashboard freeze.

## Landlord workspace reads now overlap account verification

The authenticated Landlord dashboard still had a two-stage startup waterfall:
it waited for the protected account response before beginning the independently
authorised profile, property, request, booking, support and readiness reads.
On a waking Render service or mobile connection, that added a complete second
network wait before the workspace could become interactive.

Those read-only requests now begin in the same startup burst as account
verification. The verified account and Landlord role still gate every render;
each endpoint remains server-authorised, and no returned private data is used
until that check passes. The optional Saved Cleaners panel remains outside the
primary awaited path with its own bounded failure state.

A real Chromium regression delays account verification and records request
arrival times at the fixture server. It proves the account and property reads
start together, then confirms the private workspace renders only after trusted
access succeeds. The full Landlord matrix now covers 91 desktop/mobile states,
and the 89-file Cleaner Dashboard freeze remains byte-for-byte unchanged.

## Production evidence reviewed

- The live custom domain serves packaged release `570368b0` with 98 locked migrations.
- Database integrity is healthy and writes are currently allowed.
- Authentication, private media, real-time updates, postcode geocoding, pricing and matching, automatic dispatch, speech summarisation and room vision all report ready.
- Stripe test checkout now reports attached (`paymentsReady: true`) for approved staging accounts. The source adapter rejects live Stripe keys, public payment approvals remain false, and no real-money payment mode has been enabled.
- Transactional email remains unavailable. This blocks password-recovery and off-site notification delivery until a verified sender and provider credential are supplied.
- Address autocomplete remains optional and unavailable; manual protected address entry still works.
- The only application error in the previous 24 hours was an expected same-origin rejection. A deeper request-log review found that the `503` pattern was not limited to automated probes: valid homepage requests also reached a sleeping free web service before its HTTP listener opened.

## Database lifecycle finding resolved

On 16 August 2026, Render's account API reported `homle-marketplace-staging-db` available and not suspended on the durable `basic_256mb` PostgreSQL 16 plan in Frankfurt. The former free-plan expiry no longer applies.

The source Blueprint still declared `plan: free` and still requested `DATABASE_EXPIRES_AT`. A later Blueprint sync could therefore conflict with the connected paid database or restore an obsolete readiness warning. The Blueprint now matches the live `basic_256mb` plan and no longer requests the expiry marker.

## Safeguard implemented

- The application still accepts `DATABASE_EXPIRES_AT` for any future time-limited deployment and refuses to present such a database as production-ready.
- The current Blueprint deliberately omits that variable because the connected staging database is no longer time-limited.
- The Blueprint test pins exactly one free web plan and exactly one `basic_256mb` database plan, preventing accidental database-plan regression.
- The live database remains a small, non-HA staging resource. Capacity, backup and recovery requirements still need an explicit production review before public launch.

This repository correction does not purchase or upgrade infrastructure; it records the plan already active in Render.

## Launch-state UX corrections

- The Landlord completion dialog previously displayed a 30p Stripe test link even when the same deployment reported that payments were detached. Following the link could only end at the protected unavailable state, which looked like a failed payment.
- The public account-entry page used a generated arrow character on every submit control. Chromium exposed all eight generated characters in the accessibility tree even while seven forms were hidden, so a screen reader could announce unrelated arrows after the single available Google action. The decoration now uses a silent CSS mask and a source regression prevents the spoken glyph from returning.
- A live 390px account-entry check found that the resolved Google sign-in screen still said “while this check runs” and presented “Checking session / Loading booking” as the journey. The real readiness control had already completed, so the page falsely looked stuck. The stable account journey now reads “Secure sign-in / Choose workspace / Book or work privately / Track updates”, while the safety note states plainly that sign-in itself neither creates a booking nor takes payment.
- The dialog now shows the test link and its test-mode explanation only when `/api/health` reports `paymentsReady: true`.
- When payments are detached it instead states that Stripe test checkout is not active, that no payment was attempted and that real booking checkout still opens only after a Cleaner accepts the frozen total.
- This changes no payment, booking, matching or Cleaner behaviour. It does not enable Stripe, accept money or weaken the test-key-only boundary.

## Stripe test checkout activated

On 16 August 2026, the existing Render Stripe test credentials were activated through the explicit `PAYMENTS_ENABLED` operator gate. The replacement deployment reached `live`, `/api/health` reported `paymentsReady: true`, marketplace readiness remained healthy and all 98 migrations remained verified.

The Blueprint now declares `PAYMENTS_ENABLED` as `sync: false`. This keeps checkout under Render operator control and prevents a future Blueprint sync from silently replacing the verified dashboard value with a source default. The following boundaries remain unchanged:

- the Stripe adapter accepts only `sk_test_` and `pk_test_` credentials and rejects live keys;
- staging-account restriction remains enabled;
- public marketplace and public payment approval flags remain false;
- a real booking checkout still opens only after an eligible Cleaner accepts the exact frozen scope, time and total;
- no capture, refund, transfer or public payment launch was performed by this activation.

## Scroll reveal performance verified

The landing-page hero reveal now follows one compositor-friendly scroll path rather than repeatedly recalculating expensive visual work. The real browser performance harness measured the hero and full-page journey on desktop and phone at a 16.7 ms median and 90th percentile frame interval, with no frame above 32 ms in 118 hero frames or 178 full-page frames. Reduced-motion behaviour remains available.

The opening reveal still inherited the later acts' cinematic trailing ease. It
therefore rendered smooth frames while moving only 13% toward fresh wheel or
trackpad input on each frame, which made the slide feel delayed. The opening
act now maps directly to the browser's current scroll position; the later room
walk and storytelling acts retain their authored easing. The browser test now
checks scroll-response latency as well as frame timing so a smooth-but-late
regression cannot pass unnoticed.

## Participant rehearsal is now a launch gate

The Administrator launch desk previously kept the final two-account mobile rehearsal only in explanatory copy. That meant the recorded business-readiness score could reach complete even when no Landlord-to-Cleaner, Stripe-test journey had been evidenced.

Business readiness now has an eighth, separate participant-rehearsal area. It stays incomplete until the operator records all three pieces of privacy-safe evidence:

- the complete non-customer Landlord and Cleaner journey passed on two devices;
- a summary of at least 40 characters records the stages and device/browser classes without identities, provider references, card data or secrets;
- the evidence has a valid verification date no later than today.

The form rejects a checked “passed” claim with vague or missing evidence and rejects future dates. This evidence does not enable accounts, contact users, move money or substitute for the rehearsal itself; it prevents technical service attachment from being mistaken for launch proof.

## The Landlord booking journey no longer waits indefinitely on advisory reads

The property-first booking page previously awaited `/api/health` before it
recovered the signed-in Landlord account. Its area-supply and Cleaner-directory
lookups also used raw, unbounded browser requests. A sleeping service or weak
connection could therefore leave the journey looking stuck even though those
readiness and directory results are advisory and the Landlord's answers were
otherwise usable.

The journey now keeps the existing 30-second safety boundary for account reads
and mutations, but bounds readiness at five seconds and directory lookups at
eight seconds. A slow readiness result falls back to the existing conservative
capability state and still opens the authenticated form. A slow directory read
shows the existing honest retry/empty guidance instead of spinning forever.
No request, booking, invitation or payment is attempted by these fallbacks.

## Cold-start homepage availability improved

Render request and application logs now prove the source of intermittent valid
homepage `503` responses. At 18:36 UTC, for example, a free-plan instance began
database verification, a homepage request waited 14.8 seconds and failed, the
nine-job inline worker supervisor finished, and only then did Homle open port
10000. Static homepage serving itself authors HTTP `200`; the failure was the
platform reaching a sleeping process before its listener existed.

Inline workers are explicitly non-fatal, so they no longer block the web
listener. Homle now opens the port after its database and application safety
boundaries, then starts the nine background jobs asynchronously. The health
response remains fail-closed while that initialization is in progress:
`automaticDispatchReady` stays false until the real worker attachment is ready.
This removes roughly five seconds from the observed wake path without claiming
matching readiness early or changing a request, invitation, booking or payment.

The service remains on Render's free web plan. It can still sleep, and the
database/bootstrap safety work still runs on every fresh instance, so fully
eliminating cold starts requires an always-on hosting plan or a separate static
front end. This change reduces avoidable startup delay; it does not represent a
hosting upgrade or a public-availability guarantee.

## Landlord readiness now recovers after a cold start

Opening the HTTP listener before the non-fatal worker supervisor exposed one
honest transient state: a Landlord could load the dashboard while automatic
dispatch was still starting. The first `/api/health` response correctly said
dispatch was unavailable, but the dashboard kept that answer for the whole
session and continued to show matching as paused after the worker became ready.

The dashboard now bounds its advisory health read at five seconds, renders the
private workspace without waiting indefinitely, and performs at most two
background rechecks after two and six seconds. A later ready response repaints
the request actions and removes the stale warning. A genuinely disabled worker
remains fail-closed after those two attempts; there is no permanent polling and
no request, invitation, booking or payment is sent by a readiness read.

## The opening reveal no longer reads layout while scrolling

The first cinematic slide still had a mobile-specific performance risk after
its response-delay fix: every animation frame called `getBoundingClientRect()`
for all five landing stages after the previous frame had changed their `--p`
variables. A browser could therefore be forced to synchronously reconcile
style and layout before it could draw the next touch-scroll frame.

Stage geometry is now measured once on setup and remeasured on load, page show
and viewport resize. Active scroll frames read only `scrollY`, use cached
document-space geometry and write compositor-friendly transforms. Viewport
dimensions are cached for the hero growth and room walk as well. The script has
a new content-addressed URL so an existing phone cannot retain the older hot
path from immutable cache. Regression coverage rejects any future
`getBoundingClientRect()` inside the active frame.

The animated phone's rendered width and height are cached in that same
measurement pass. The room walk and scan line no longer call `clientWidth` or
`clientHeight` after transform writes, removing the last synchronous-layout
opportunity from the active reveal frame.

The real browser harness still records 16.7 ms median and 90th-percentile frame
intervals on desktop and phone, with no frame over 32 ms across 118 hero frames
or 178 full-page frames. Reduced-motion behaviour and every landing action are
unchanged.

## Account entry no longer waits for marketplace health

The sign-in and sign-up pages previously awaited both provider discovery and
the complete marketplace health response before revealing Google or verified
email. Provider availability is the security decision that controls those
buttons; marketplace health is only advisory until Homle chooses the private
workspace destination after a successful sign-in. A waking worker or slow
database check could therefore make a working Google button look unavailable.

Provider discovery and the advisory readiness read now begin together, but the
available sign-in controls render as soon as the dedicated provider response
arrives. The readiness read has a five-second boundary and is awaited only when
email sign-in or onboarding needs to choose a workspace destination. Social
handoff and account-ready pages continue to verify the authenticated account
through the existing protected account endpoint, which returns its own trusted
workspace state.

A Chromium regression holds `/api/health` back for four seconds and proves that
Google is already visible, correctly routed and usable while that request is
still pending. No role, session, onboarding or Cleaner Dashboard behaviour was
changed.

## Protected boundary

During publication, newer commits on `main` were found to have changed Cleaner onboarding pages, scripts, styling, navigation, a backend route and their tests. One of those commits also accidentally truncated the booking-dashboard regression suite and caused GitHub's syntax gate to fail. Those concurrent changes contradicted this goal's explicit no-change boundary.

Every affected existing Cleaner file and test was restored byte-for-byte from the last approved protected snapshot, and the newly added Cleaner-only assets and route were removed. No Cleaner Dashboard page, script, style, route, form, business rule or backend behaviour is changed by this work. The 87-file byte-for-byte Cleaner Dashboard freeze remains mandatory before publication.

## Landlord startup now uses one secure bootstrap

The Landlord dashboard previously opened the account, profile, active places,
archived places, requests, bookings and support history through seven separate
private requests. A valid session usually hid that cost, but an expired mobile
session produced a burst of authorization failures and made the workspace look
stuck while every request failed independently.

A Landlord-only bootstrap route now authenticates and authorizes once, then
loads the six owner-bound datasets concurrently on the server. The browser
receives the account identity and available workspace data in one response.
Individual read failures are reported as named unavailable sections, so the
existing truthful partial-data state remains available without exposing error
internals or mixing owners. Public health still loads independently because it
is advisory, and Saved Cleaners remains an optional bounded panel after the
primary workspace is visible.

This reduces signed-out or expired-session dashboard startup from seven private
requests to one and preserves the role gate before any private content renders.
The full project suite, 91 Landlord rendered states, 764 computed-style checks,
two end-to-end booking journeys and the 89-file Cleaner Dashboard freeze pass.

## Transactional email now has a safe activation boundary

The live activation audit found that core authentication, booking, scanning,
matching, dispatch, media, payments and real-time features are ready, while
transactional email is still deliberately unavailable. Enabling Resend with an
API key alone would have delivered messages without a durable way to stop mail
to addresses that permanently bounced, complained or were suppressed by the
provider.

Resend activation now fails closed unless a valid webhook signing secret is
also present. The new callback route verifies the exact raw request with Svix,
accepts only the three permanent suppression events, rejects tampering, stale
timestamps, malformed recipients and conflicting retries, and stores no raw
email address or callback body. A private, function-only suppression ledger
keeps hashes and bounded provider identifiers. Email claiming excludes the
exact currently suppressed address through a dedicated hash index; changing to
a newly verified address does not inherit an old address's history.

Activation still requires external provider setup and must not be represented
as live until it is complete:

1. verify Homle's sending domain and approved `EMAIL_FROM` in Resend;
2. set `EMAIL_DELIVERY_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` and
   `RESEND_WEBHOOK_SECRET` in Render;
3. register `https://homlle.com/api/marketplace/email/resend/webhook` for
   `email.bounced`, `email.complained` and `email.suppressed`;
4. send and observe a test notification before customer use.

The full repository suite, all 190 registered test files, database/dependency
asset gates, signed-webhook hostile-input coverage and the 89-file
Cleaner Dashboard freeze pass. No Cleaner Dashboard file, route, component,
style or business workflow was changed.

## Render activation handoff is now self-checking

The deployment handoff had accumulated useful implementation history, but its
opening section still described an old pull request, an old live commit and an
obsolete payment-readiness state as if they were current instructions. That
made a correct release vulnerable to an operator repeating old work or
validating the wrong commit.

The handoff now starts with one canonical release checklist: merge through CI,
pin `TIDEWAY_EXPECT_RELEASE` to the exact current `main` commit, deploy the
latest commit explicitly, run the live activation verifier, confirm the health
identity and migrations, and check the marketplace worker startup evidence.
Current external activation boundaries are recorded separately from the
historical archive, including Resend suppression handling, provider-backed
authentication, Stripe test-only readiness, automatic dispatch and database
capacity. The Cleaner Dashboard remains an explicit protected boundary.

A deployment regression test now rejects stale release claims in the current
section and requires the release pin, live verifier, worker evidence and
external activation safeguards to remain present. This changes no runtime UI,
route, marketplace behaviour or Cleaner Dashboard file.

## Platform wake failures are now diagnosed before app repair

The live service became unavailable with Render's
`x-render-routing: hibernate-wake-error` response while no Homle instance or
application log was being produced. This routing failure happens before the
container starts, but the activation verifier previously collapsed it into the
same generic message used for an unhealthy application response. That could
send an operator towards database or marketplace repairs when the application
had never received the request.

The live verifier now recognizes this exact fail-before-start signal, marks it
retryable and directs the operator to verify the expected release pin, redeploy
the latest `main` commit and retry. Other 503 responses remain generic and are
not misclassified as Render wake failures. Regression coverage pins both paths.
No marketplace runtime, public page, private workspace or Cleaner Dashboard
file is changed.
