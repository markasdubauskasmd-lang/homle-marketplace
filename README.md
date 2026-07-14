# Tideway marketplace

Independent pilot website for matching landlords and businesses with cleaning professionals. It does not use Polsia or Polsia credits.

## Run locally

Use Node.js 20 or newer:

```text
npm start
```

Then open `http://127.0.0.1:4173`.

## What works

- Customer cleaning request form with server-side validation
- High-entropy private customer tracker created with each request; it follows the real journey from required room scan through quote, cleaner confirmation, protected booking, job progress and completion
- One-click private handoff from a completed request into the required room scan, with reference and email prefilled for that browser session
- Tracker links keep their token in the browser fragment, remove it before the first server request and return no customer contact/access data, cleaner identity/pay or tracker authorisation token
- Photo/video-and-voice room scan that accepts up to ten room visuals, including at most two 30-second walkthrough videos, requires a deliberate room label and specific note for every visual, automatically summarises speech and media notes into concise room-labelled checklist bullets, and blocks saving until every shown room has a task
- Canonical multi-room scope labels keep numbered bedrooms and bathrooms aligned between photos and speech, while common spoken names such as “lounge” and “WC” map to the same cleaner-facing room labels
- Required customer scope-completeness confirmation: the scan cannot be stored until the customer confirms the final concise checklist includes every task they want quoted; the server records the confirmation time and review, matching, private decisions and booking audit all retain the gate
- The customer’s scope confirmation is tied to the exact current speech, task list, room labels and media notes; changing any of them clears the checkbox and requires a fresh review before submission
- Concise cleaner tasks are tied separately to the speech and room-media notes that generated them; later source changes mark the bullets out of date and block submission until the customer summarises again, while manual review edits to the current bullets remain allowed
- Live scan-readiness guidance tracks eight required items as the customer works: connected request details, one-to-ten room visuals, room labels and notes, instructions, concise tasks, room coverage, final-scope confirmation and media-sharing permission; it names each shown room still missing a cleaner task, the action explains every outstanding check when clicked, and the server independently repeats every security-critical check
- Genuine room-scan submission shows per-visual and saving progress, enforces two-video/30-second/15 MB video limits plus the existing photo limits, has bounded media-preparation and request timeouts, and restores an actionable button with the customer's entries preserved if an upload fails
- A successful scan now leaves the long form for a dedicated thank-you page showing the saved scan reference, three clear next steps and the protected customer tracker; the tracker token remains in a browser fragment and is removed immediately
- Audited human review decisions for room scans; a missing or unreviewed scan blocks cleaner-draft use, proposal approval and booking readiness
- Structured scan review requires a 0.5–24 hour human scope estimate, medium/high confidence and an evidence note; proposal hours default to the higher of this estimate or the founder minimum
- Price-sensitive scan detection flags oven/fridge interiors, inside storage, windows, linen/laundry, carpet or upholstery work, waste removal, outdoor areas and wall/ceiling washing; the customer sees the warning while reviewing the scan and the reviewer must explicitly confirm every detected item inside the cleaning-time estimate before matching or quoting can proceed
- Confirmed price-sensitive items are frozen into the customer quote and cleaner opportunity, shown in both message drafts and the customer tracker, and retained in both protected booking packs so scope cannot silently disappear between scan and job day
- Cleaner application form with server-side validation
- Audited seven-check cleaner screening record; approval, matching, proposals and bookings remain blocked until every check is confirmed
- Local private submission files in `data/`
- Private local control desk at `/admin` with lead filters, status tracking, internal notes and next-action dates
- Prioritised founder-action dispatch queue derived from recorded scan, matching, offer, booking and safety state; urgent safety reports, rematching, booking finalisation and overdue follow-ups are surfaced without sending messages or changing records
- Private first-profitable-booking runway derives eight conversion stages from authoritative records—request, submitted scan, reviewed scope, sent offer, two-sided acceptance, confirmed booking, recorded outcome and target-margin result—then names the current bottleneck and dispatch-ready cleaner count without exposing contact data or moving money
- Internal quote calculator that pre-fills approved rates, includes founder-confirmed payment fees, travel, supplies, risk contingency and additional job costs, and solves the customer total/hourly rate needed to meet the contribution-margin floor
- Local launch-readiness form for legal identity, pilot coverage, rates, cleaner pay, insurance, live payment handling, refunds and operating rules
- Founder-configured outward-postcode enforcement that blocks out-of-area matching, proposal use and booking readiness
- Human-reviewed matching stays closed until the room scan supplies a reviewed duration, then returns only fully screened approved cleaners whose confirmed availability can hold the job on the requested date with a start inside the customer's arrival preference
- Match results provide a feasible suggested start and finish inside the cleaner's confirmed window; proposal drafts prefill from that schedulable visit rather than the raw availability start
- Append-only cleaner availability windows with evidence notes and auditable withdrawal; matching returns only approved cleaners with a future confirmed window, and proposals must fit fully inside one
- Internal draft proposals freeze a complete cost breakdown and reject work below minimum hours, loss-making economics or the margin floor; changed founder cost assumptions close the stale proposal across drafts, private decisions and booking
- Exact proposal start and calculated finish times, with past-date and same-day duration validation
- Sent and accepted offers temporarily reserve the cleaner's exact interval; matching moves later suggestions around those holds, and cleaner decline, withdrawal or offer expiry releases the time automatically
- Cleaner travel coverage uses explicit outward postcode districts or comma-separated postcode areas; uncovered cleaners are excluded instead of merely receiving a lower score, and direct proposals outside their stated area are rejected
- Atomic send and booking checks prevent two overlapping offers or bookings from claiming the same cleaner capacity, including concurrent send attempts and legacy booking records
- Availability is rechecked when a proposal advances, either side decides and the booking is written; withdrawal closes affected private decisions and moves the customer tracker safely back to rematching
- One-live-offer control prevents competing ready, sent or accepted proposals for the same request; a cleaner decline immediately locks the affected customer quote and allows a reviewed replacement to take priority
- Live cleaner eligibility is rechecked on the customer journey and founder dispatch queue; if approval, screening, service fit or travel coverage changes before booking, the quote action closes and the tracker returns to neutral rematching without exposing the cleaner or internal reason
- Every later proposal records the exact predecessor it replaces. A replacement cannot advance until that offer is closed or exhausted, freezes a customer-visible list of changed terms, preserves any earlier acceptance only as audit evidence and always requires a fresh private customer decision
- Audited pre-booking withdrawal requires a founder reason, preserves any customer acceptance record, closes both private links and returns the request to rematching; a confirmed booking cannot be cancelled through proposal controls
- Proposal status gates that prevent a draft becoming ready, sent or accepted until launch checks, pilot coverage and the latest job-brief review pass
- Scan-to-quote duration protection blocks any proposal below the reviewed room-scan hours, even when its calculated contribution and margin would otherwise pass
- Review-only customer quote and cleaner opportunity drafts with explicit warnings and no send capability
- Private customer quote-review links that keep the token out of server URLs, require name/scope/terms confirmation, lock after one decision and preserve an acceptance snapshot for the booking audit
- Customer acceptance can no longer be fabricated from the control desk; accepted and declined states come from the private quote decision flow
- Private cleaner opportunity links show only the area, reviewed scope, hazards and proposed pay; customer identity, exact address, access notes and private photos remain protected
- Customers can separately authorise the one selected cleaner to review the frozen room photos and short videos through the active private opportunity link; the exact address, identity and access details stay hidden, and preview, expired, declined, withdrawn or booked links cannot load the media
- Cleaner decisions require the application name plus scope, pay and availability confirmations, lock after one response and cannot be created from the control desk
- Founder-set customer and cleaner response windows freeze into each sent offer, are capped at the visit start, appear on private pages and drafts, and automatically close stale decisions; booking audits verify both acceptances were timely
- Latest approved landlord checklist included in the review-only cleaner opportunity draft; photos remain separately protected for deliberate review
- Structured site scope, access and hazard collection plus a read-only accepted-proposal booking audit
- Safe lead-status transitions that prevent requests or cleaners skipping required workflow stages
- Internal confirmed-booking records that require separate customer and cleaner acceptance, a profitable passed audit and four remaining manual confirmations
- Structured confirmed-booking packs for the final address, matching postcode, access contact, arrival instructions, equipment plan and emergency instructions; duplicate bookings are rejected atomically
- Separate fragment-token customer and cleaner booking views: the customer view hides cleaner contact/pay, while the cleaner view exposes only the visit and access information needed after confirmation
- Reviewed room photos, short videos and their specific notes become visible to both sides only inside the confirmed protected booking packs; media requests require the private booking token and are never cached
- Private reschedule, cancellation, access, scope and safety request submission from either booking pack; submissions never mutate the confirmed booking, schedule or payment state automatically
- Local admin change-request queue with open, reviewing and permanently closed audit states plus a customer-visible response note
- Append-only job-day timeline: cleaners must confirm arrival and a safe start before recording completion, then the customer acknowledges the completed visit from their own protected booking pack
- Completed-job economics remain locked until the three job-day confirmations are present and every change or safety request is closed
- Completed-job records separate actual customer receipts, cleaner pay, payment fees, travel, supplies, other costs and refunds before calculating contribution and margin; recording never moves money
- Private data backup script and documented recovery procedure
- Responsive, accessible website
- Draft privacy notice and pilot terms
- No payment collection and no fabricated reviews, cleaner profiles or business claims
- Tracker stages are informational only: they expose a quote or confirmed customer booking link only after the corresponding audited record exists and never represent payment collection

## Before public launch

1. Add the legal operator name, trading address and verified contact details.
2. Decide the cleaner engagement model with UK employment/tax advice.
3. Confirm public liability and any other required insurance.
4. Approve pricing, cleaner pay, cancellation, complaint and re-clean rules.
5. Replace local file storage with an encrypted production database and access controls.
6. Document and approve any production speech-recognition provider, photo storage and retention controls.
7. Add transactional email/SMS only after the sending account is approved.
8. Complete a real pilot in one small service area before making broader coverage claims.

If the server is ever bound to a public interface, set a strong `ADMIN_KEY`. Local control-desk access is automatic only when the server, request hostname and network connection are all verified as loopback and no proxy headers are present.
