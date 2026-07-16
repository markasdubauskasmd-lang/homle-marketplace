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

- `GET /api/marketplace/admin/disputes` returns a bounded, status-filtered queue without participant contact data or property access details.
- `PATCH /api/marketplace/admin/disputes/:disputeId` can mark a case `reviewing` or resolve it.
- Resolution requires 20–5,000 characters of explanation and an exact `completed` or `cancelled` booking outcome.
- A final decision writes the case, booking status, history, participant notifications and audit event in one transaction.
- Retrying the exact final resolution is idempotent; attempting to change a final decision is rejected.
- A completed visit keeps its original `completed_at` evidence even if a later case outcome cancels the commercial booking.

The protected APIs are implemented, but no general-purpose Administrator UI is claimed complete yet. Operational policy, response targets, evidence-handling guidance, refund/re-clean decisions and escalation ownership still require founder approval before real intake.

## Database boundary and proof

The runtime role has no direct `SELECT`, `INSERT`, `UPDATE` or `DELETE` privilege on `disputes`. It can call only:

- `open_booking_dispute`
- `get_booking_dispute`
- `list_admin_booking_disputes`
- `review_booking_dispute`

The disposable PostgreSQL 16 integration suite uses distinct migration-owner and restricted application roles. It proves direct-table denial, unrelated-account denial, retry idempotency, one-active-case behavior, participant outcome access, Administrator-only review, exact history/audit evidence and complete fixture removal.
