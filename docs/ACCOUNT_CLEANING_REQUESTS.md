# Account-backed cleaning requests

This Phase 3 checkpoint prepares the transaction that turns a saved Landlord property and reviewed room checklist into a marketplace cleaning request. It remains detached from the live NDJSON pilot until PostgreSQL staging is available.

## Implemented boundary

- `POST /api/marketplace/cleaning-requests` requires an authenticated Landlord session, exact origin and CSRF token.
- The server selects `landlord_user_id` from the session. Submitted owner IDs are ignored.
- The repository locks and verifies that the selected property belongs to the authenticated Landlord and is not archived.
- Requested start/end must be exact UTC timestamps, in the future, within 366 days and between 30 minutes and 16 hours apart.
- Cleaning type and every required service must use the same supported service catalogue as Cleaner profiles.
- Each request requires 1–200 unique room-labelled tasks, preserving the reviewed scan as the core booking scope.
- Budget is optional but, when supplied, is integer pence within the supported financial range.
- Frequency is one-time, weekly, fortnightly or every four weeks. A recurring preference never creates or promises automatic bookings; each visit still requires a separate accepted booking.
- Scope is canonicalized and SHA-256 fingerprinted across property, schedule, services, instructions, budget, recurrence and ordered tasks.
- Property check, request row, task rows and initial status-history row execute inside one actor-bound transaction.
- Responses are whitelisted and do not return owner IDs, property access instructions, coordinates or persistence internals.
- `GET /api/marketplace/cleaning-requests` lists at most the authenticated Landlord's latest 100 requests.
- Creating or submitting a request never implies automatic matching consent. A submitted future request requires a separate authenticated Landlord action with a total one-to-five attempt limit; see [consent-bound automatic dispatch](AUTOMATIC_DISPATCH.md).
- `POST /api/marketplace/cleaning-requests/:requestId/withdraw` lets only the owning authenticated Landlord withdraw a `draft` or `searching-for-cleaner` request after an explicit reason choice.
- Withdrawal locks the request, refuses any non-cancelled related booking, revokes pending automatic-dispatch work and records both status history and a private audit event. It cannot cancel an invitation, confirmed booking or payment.

## Migration safety

Migration `008_account_cleaning_requests.sql` maps earlier draft status labels, backfills fingerprints for any pre-existing rows before adding `NOT NULL`, backfills submitted times and adds owner/admin RLS for request history. New requests use `draft`, `searching-for-cleaner`, `cleaner-invited`, `pending-cleaner-acceptance`, `matched` and `cancelled`. Migration `045_owner_request_withdrawal.sql` adds the function-only owner withdrawal transaction and permits an unsubmitted draft to enter the terminal `cancelled` state without weakening reviewed submission for active states.

## Later transactions

Frozen margin-checked invitation, final eligibility/availability/coverage rechecks, concurrent overlap protection, decline/replacement history and consent-bound automatic matching are now implemented behind the detached marketplace. They still require real PostgreSQL staging and genuine two-account evidence before activation.

No live customer request was imported, modified or submitted for this checkpoint.
