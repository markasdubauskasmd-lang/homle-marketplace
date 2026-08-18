# Homle continuous improvement record — 14 August 2026

## Production evidence reviewed

- The live custom domain serves packaged release `570368b0` with 98 locked migrations.
- Database integrity is healthy and writes are currently allowed.
- Authentication, private media, real-time updates, postcode geocoding, pricing and matching, automatic dispatch, speech summarisation and room vision all report ready.
- Stripe test checkout now reports attached (`paymentsReady: true`) for approved staging accounts. The source adapter rejects live Stripe keys, public payment approvals remain false, and no real-money payment mode has been enabled.
- Transactional email remains unavailable. This blocks password-recovery and off-site notification delivery until a verified sender and provider credential are supplied.
- Address autocomplete remains optional and unavailable; manual protected address entry still works.
- The only application error in the previous 24 hours was an expected same-origin rejection. The 503 request pattern was automated WordPress and crawler traffic, not a Homle customer API failure.

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

## Protected boundary

During publication, newer commits on `main` were found to have changed Cleaner onboarding pages, scripts, styling, navigation, a backend route and their tests. One of those commits also accidentally truncated the booking-dashboard regression suite and caused GitHub's syntax gate to fail. Those concurrent changes contradicted this goal's explicit no-change boundary.

Every affected existing Cleaner file and test was restored byte-for-byte from the last approved protected snapshot, and the newly added Cleaner-only assets and route were removed. No Cleaner Dashboard page, script, style, route, form, business rule or backend behaviour is changed by this work. The 87-file byte-for-byte Cleaner Dashboard freeze remains mandatory before publication.
