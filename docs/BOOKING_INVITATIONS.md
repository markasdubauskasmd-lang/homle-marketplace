# Frozen cleaner invitations and acceptance

This Phase 3 checkpoint adds the first account-backed booking transaction. It remains detached from the live pilot until PostgreSQL staging, approved private pricing inputs and real account sessions are available.

## Implemented workflow

- A Landlord may invite a public, complete and currently available Cleaner only for their own submitted request.
- The browser supplies only the request and Cleaner identifiers. Cleaner pay, platform costs, customer price and target margin come from one private server policy; submitted price fields are ignored.
- The policy derives Cleaner pay from the Cleaner’s active service prices and requested duration, covers approved labour on-cost, payment, travel, supplies and other costs, then solves the smallest customer price meeting the approved contribution-margin floor.
- Manual-quote services fail closed rather than receiving an invented price.
- PostgreSQL rechecks ownership, request state, budget, the active Cleaner account, publication/completion, property-type preference, every automatically priceable required service, exact current Cleaner pay, full-window availability, declared outward-postcode/radius coverage, every overlapping pending/confirmed job and positive target-margin economics while holding the request lock.
- A transaction-scoped advisory lock serialises competing invitations for the same Cleaner. Only the current hardened wrapper is executable by the application role; superseded functions remain owner-only for migration/integration evidence and cannot be used by the web or worker role.
- The booking freezes the request fingerprint, ordered room checklist, schedule and a separate terms fingerprint. Request tasks are copied into booking tasks in the same transaction.
- An invitation response has a bounded deadline no later than the visit start. The assigned Cleaner alone can accept or decline.
- Acceptance rechecks current scope, profile eligibility, services and availability. The existing GiST exclusion constraint makes the confirmed update the final concurrency-safe overlap decision.
- Decline cancels only that attempt, reopens the request for matching and preserves both histories. A partial unique index permits one replacement attempt while still preventing two live attempts.
- Repeated matching accept or decline responses are idempotent. A conflicting second decision is rejected.
- An unanswered invitation is cancelled at its deadline, the request returns to `searching-for-cleaner`, both status histories identify the change as system-generated and idempotent participant notifications are queued. A late Cleaner response returns the terminal expired state without inventing a response timestamp.
- Concurrent expiry workers claim bounded batches with `FOR UPDATE SKIP LOCKED`; one expired attempt cannot be processed twice and its partial unique slot is released for replacement matching.
- Invitation, booking, request-history, task-copy, conversation and in-app notification records commit atomically. Realtime delivery will consume committed durable events in Phase 4.
- Direct runtime writes to booking, booking-history, task and conversation tables are revoked; the restricted app role must use the audited actor-aware transition functions.

## Private configuration

All eight `BOOKING_*` environment variables in `.env.example` must be supplied together. Basis-point values use 10,000 = 100%. Zero cost is valid only when it is an explicit approved business assumption. Partial configuration fails startup; missing configuration leaves Cleaner invitation creation unavailable with a safe 503 response while invitation responses remain supported.

These values are confidential operating inputs and must stay in the deployment secret manager. They must never be accepted from a Landlord/Cleaner request body or embedded in browser JavaScript.

## Migration and deployment boundary

Apply `009_booking_invitation_and_acceptance.sql`, request matching migration 010 and expiry migration `011_invitation_expiry_and_requeue.sql` after migration 008, then apply `028_invitation_eligibility_hardening.sql` and `029_consent_bound_automatic_dispatch.sql` in locked order. Migration 009 backfills evidence fields for legacy booking rows without fabricating legacy margin evidence. New and changed rows must pass the positive-contribution and target-margin checks. Migration 011 distinguishes user and system history actors and adds bounded idempotent expiry/requeue. Migration 028 makes the matching eligibility and Cleaner-pay assumptions authoritative again at the final invitation write; migration 029 adds explicit request-level consent, bounded attempts and leased worker functions.

The public web role cannot call the expiry worker. Create a separate non-superuser, non-RLS-bypass `tideway_worker`, apply `db/worker-role-grants.sql`, and schedule `SELECT * FROM tideway_private.expire_due_cleaner_invitations(100);` at least once per minute through the deployment scheduler. Store its separate connection credential in the secret manager. Alert if a run fails or if due rows remain after repeated full batches.

The same restricted role now supports [consent-bound automatic dispatch](AUTOMATIC_DISPATCH.md). The Landlord must opt in per request and choose a total attempt limit before the worker can lease it. Dispatch uses the same trusted pricing policy as manual invitation, excludes prior Cleaners, invokes this hardened final transaction and never creates more than the request's one live invitation.

Before enabling routes, run the migrations against a restored staging copy; test out-of-area, wrong-property, changed-price, inactive-account and overlapping-invitation rejection; validate every legacy row; race two invitations for one Cleaner; race two concurrent accept transactions; race two expiry workers; and verify `tideway_app` cannot directly update a booking, call a superseded function or execute the expiry batch.

No customer was charged, Cleaner contacted, invitation sent or live pilot record modified by this checkpoint.
