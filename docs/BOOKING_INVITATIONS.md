# Frozen cleaner invitations and acceptance

This Phase 3 checkpoint adds the first account-backed booking transaction. It remains detached from the live pilot until PostgreSQL staging, approved private pricing inputs and real account sessions are available.

## Implemented workflow

- A Landlord may invite a public, complete and currently available Cleaner only for their own submitted request.
- The browser supplies only the request and Cleaner identifiers. Cleaner pay, platform costs, customer price and target margin come from one private server policy; submitted price fields are ignored.
- The policy derives Cleaner pay from the Cleaner’s active service prices and requested duration, covers approved labour on-cost, payment, travel, supplies and other costs, then solves the smallest customer price meeting the approved contribution-margin floor.
- Manual-quote services fail closed rather than receiving an invented price.
- PostgreSQL rechecks ownership, request state, budget, Cleaner publication/completion, every required service, full-window availability and positive target-margin economics while holding the request lock.
- The booking freezes the request fingerprint, ordered room checklist, schedule and a separate terms fingerprint. Request tasks are copied into booking tasks in the same transaction.
- An invitation response has a bounded deadline no later than the visit start. The assigned Cleaner alone can accept or decline.
- Acceptance rechecks current scope, profile eligibility, services and availability. The existing GiST exclusion constraint makes the confirmed update the final concurrency-safe overlap decision.
- Decline cancels only that attempt, reopens the request for matching and preserves both histories. A partial unique index permits one replacement attempt while still preventing two live attempts.
- Repeated matching accept or decline responses are idempotent. A conflicting second decision is rejected.
- Invitation, booking, request-history, task-copy, conversation and in-app notification records commit atomically. Realtime delivery will consume committed durable events in Phase 4.
- Direct runtime writes to booking, booking-history, task and conversation tables are revoked; the restricted app role must use the audited actor-aware transition functions.

## Private configuration

All eight `BOOKING_*` environment variables in `.env.example` must be supplied together. Basis-point values use 10,000 = 100%. Zero cost is valid only when it is an explicit approved business assumption. Partial configuration fails startup; missing configuration leaves Cleaner invitation creation unavailable with a safe 503 response while invitation responses remain supported.

These values are confidential operating inputs and must stay in the deployment secret manager. They must never be accepted from a Landlord/Cleaner request body or embedded in browser JavaScript.

## Migration and deployment boundary

Apply `009_booking_invitation_and_acceptance.sql` after migration 008. The migration backfills evidence fields for legacy booking rows without fabricating legacy margin evidence. New and changed rows must pass the positive-contribution and target-margin checks. Before enabling routes, run the migration against a restored staging copy, validate every legacy row, exercise two concurrent accept transactions and verify the `tideway_app` role cannot directly update a booking.

No customer was charged, Cleaner contacted, invitation sent or live pilot record modified by this checkpoint.
