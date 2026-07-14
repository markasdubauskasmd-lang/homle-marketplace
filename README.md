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
- One-click private handoff from a completed request into the photo-and-voice brief, with reference and email prefilled for that browser session
- Photo-and-voice job brief builder that automatically summarises speech into concise, room-labelled checklist bullets and privately stores resized room photos
- Audited human review decisions for photo job briefs; unreviewed briefs block cleaner-draft use, proposal approval and booking readiness
- Cleaner application form with server-side validation
- Audited seven-check cleaner screening record; approval, matching, proposals and bookings remain blocked until every check is confirmed
- Local private submission files in `data/`
- Private local control desk at `/admin` with lead filters, status tracking, internal notes and next-action dates
- Internal quote calculator that pre-fills approved rates, enforces minimum hours and calculates the customer total and hourly rate needed to meet the founder-approved contribution margin
- Local launch-readiness form for legal identity, pilot coverage, rates, cleaner pay, insurance, live payment handling, refunds and operating rules
- Founder-configured outward-postcode enforcement that blocks out-of-area matching, proposal use and booking readiness
- Human-reviewed matching suggestions using fully screened approved cleaners, requested service type and postcode coverage
- Internal draft proposals that link a request to an approved cleaner and reject work below the minimum hours, loss-making economics or a below-target contribution margin
- Exact proposal start and calculated finish times, with past-date and same-day duration validation
- Atomic schedule-conflict protection that prevents one cleaner accepting or booking overlapping work, including legacy booking records
- Proposal status gates that prevent a draft becoming ready, sent or accepted until launch checks, pilot coverage and the latest job-brief review pass
- Review-only customer quote and cleaner opportunity drafts with explicit warnings and no send capability
- Private customer quote-review links that keep the token out of server URLs, require name/scope/terms confirmation, lock after one decision and preserve an acceptance snapshot for the booking audit
- Customer acceptance can no longer be fabricated from the control desk; accepted and declined states come from the private quote decision flow
- Private cleaner opportunity links show only the area, reviewed scope, hazards and proposed pay; customer identity, exact address, access notes and private photos remain protected
- Cleaner decisions require the application name plus scope, pay and availability confirmations, lock after one response and cannot be created from the control desk
- Latest approved landlord checklist included in the review-only cleaner opportunity draft; photos remain separately protected for deliberate review
- Structured site scope, access and hazard collection plus a read-only accepted-proposal booking audit
- Safe lead-status transitions that prevent requests or cleaners skipping required workflow stages
- Internal confirmed-booking records that require separate customer and cleaner acceptance, a profitable passed audit and four remaining manual confirmations
- Completed-job records for actual customer receipts, cleaner pay, costs, refunds, contribution and margin; recording never moves money
- Private data backup script and documented recovery procedure
- Responsive, accessible website
- Draft privacy notice and pilot terms
- No payment collection and no fabricated reviews, cleaner profiles or business claims

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
