# Audited booking cases

Migration `033_audited_booking_disputes.sql` turns the original dispute table into a function-only trust-and-safety workflow. This feature remains behind the default-off marketplace attachment until managed staging passes.

## Participant flow

- Either the exact Landlord or Cleaner on a confirmed-through-completed booking may open a case.
- Allowed categories are `quality`, `damage`, `access`, `safety`, `conduct`, `payment` and `other`.
- The description is trimmed, control-character checked and limited to 20–5,000 characters.
- A browser-generated request UUID plus `(booking, opener)` uniqueness makes a lost-response retry idempotent.
- A partial unique index permits only one `open` or `reviewing` case per booking. If the other participant submits while it is active, the same case is returned.
- Opening changes the booking to `disputed`, writes booking history, sends private participant notifications and records an audit event. It does not issue a refund, capture money or contact anyone outside Tideway.

Participants use:

- `GET /api/marketplace/bookings/:bookingId/dispute`
- `POST /api/marketplace/bookings/:bookingId/dispute`

Both routes require an authenticated booking participant; the mutation also requires exact origin and CSRF evidence.

## Administrator flow

- `/admin/cases` is a mobile-first, fail-closed Administrator account screen. It first verifies the private Tideway account and exact `administrator` role, then loads the protected queue.
- The screen displays only a shortened booking reference, case category, participant role, description and lifecycle timestamps. It does not request or render property addresses, access instructions, contact information, provider identifiers or payment details.
- Status filtering and bounded 50-record pages keep the queue usable without broad reads. Counts are explicitly limited to the current loaded page rather than presented as marketplace totals.
- Starting review and recording resolution use same-origin session cookies plus the tab-held CSRF value. Private case text is rendered through DOM `textContent`, never HTML insertion or persistent browser storage.
- Offline, authentication, wrong-role, disabled-runtime, empty, loading and retry states preserve the last visible queue without claiming that an uncertain update failed. If the mutation succeeds but refresh fails, the screen says the decision was recorded and requires a refresh before another action.
- `GET /api/marketplace/admin/disputes` returns a bounded, status-filtered queue without participant contact data or property access details.
- `PATCH /api/marketplace/admin/disputes/:disputeId` can mark a case `reviewing` or resolve it.
- Resolution requires 20–5,000 characters of explanation and an exact `completed` or `cancelled` booking outcome.
- A final decision writes the case, booking status, history, participant notifications and audit event in one transaction.
- Retrying the exact final resolution is idempotent; attempting to change a final decision is rejected.
- A completed visit keeps its original `completed_at` evidence even if a later case outcome cancels the commercial booking.

The source-complete operations screen is not a claim that trust-and-safety operations are ready. Operational policy, response targets, evidence-handling guidance, refund/re-clean decisions, escalation ownership, an approved Administrator account and the real two-account HTTPS staging trial still require approval and evidence before real intake. The visual browser-automation connection was unavailable at this checkpoint, so responsive markup/style assertions and HTTP tests passed but a human visual pass remains required in staging.

## Database boundary and proof

The runtime role has no direct `SELECT`, `INSERT`, `UPDATE` or `DELETE` privilege on `disputes`. It can call only:

- `open_booking_dispute`
- `get_booking_dispute`
- `list_admin_booking_disputes`
- `review_booking_dispute`

The disposable PostgreSQL 16 integration suite uses distinct migration-owner and restricted application roles. It proves direct-table denial, unrelated-account denial, retry idempotency, one-active-case behavior, participant outcome access, Administrator-only review, exact history/audit evidence and complete fixture removal.
