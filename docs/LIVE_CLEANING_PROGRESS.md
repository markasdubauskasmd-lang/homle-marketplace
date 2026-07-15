# Live cleaning progress

This Phase 4 checkpoint prepares the transactional active-job checklist shared by the assigned Cleaner and Landlord. It remains detached from the live pilot until PostgreSQL staging, authenticated account pages and realtime transport are available.

## Active-job workflow

- The assigned Cleaner may start only after recorded arrival and inside the bounded visit window. Start is idempotent and changes the booking from `cleaner-arrived` to `cleaning-in-progress`.
- The Cleaner can pause with a required reason and resume with an optional note. One open pause per booking is enforced by a partial unique index; elapsed time subtracts every pause interval.
- Each checklist task can move through Not started, In progress, Completed, Skipped or Issue reported. Skipped and issue states require a note.
- Every task change records previous/new state, timestamp and responsible user. A durable monotonically increasing progress event is committed in the same transaction for later WebSocket delivery/reconnect.
- The Landlord sees overall resolved percentage, completed-task count, room completion, elapsed time excluding pauses, task notes, issues, photo metadata and the latest 50 durable events.
- Only participant-safe photo metadata is projected. Private object keys are never returned; authenticated before/after upload/read endpoints still require the private object-storage phase.

## Unexpected work and frozen economics

The Cleaner may propose an unexpected task only while active and unpaused, with a room, description and 1–480 minute estimate. It stays blocked in `pending` until the booking Landlord makes one final approval or decline decision.

Approval explicitly confirms that the additional task does **not** change the frozen customer price or Cleaner pay. No browser action changes money, captures payment or silently rewrites booking economics. Work that needs an extra charge or payout must use a future separately quoted change-order workflow; it cannot be approved through this zero-price-change action. A declined task becomes skipped with an audited reason.

## Completion gate

Finish cleaning is unavailable while paused, while any standard task is unresolved, or while an unexpected task awaits a decision. Completed, skipped and issue-reported tasks are terminal for the visit checklist. Finish changes the booking to `awaiting-review`, records completion time/status history, emits the final durable event and queues idempotent cleaning-complete/review-request notifications.

## Security boundary

Mutation routes require exact origin, CSRF, the appropriate role and booking participation. Direct runtime writes to bookings, task state/history, pauses, unexpected decisions, progress events, photos, locations and notifications are revoked. The app role must use the restricted actor-aware functions in migration 013. An unrelated account receives no snapshot.

Before enabling, execute migration 013 in staging and test concurrent pause, repeated updates, issue notes, another booking’s task ID, Cleaner self-approval denial, final-decision replay, unchanged-price confirmation, unresolved finish denial, participant reads and event ordering.

No task, job, photo, notification, payment or live record was created by this checkpoint.
