# Booking-specific messaging

Tideway now has a private message contract for the Landlord and assigned Cleaner on one booking. It is additive to the current pilot and remains detached until PostgreSQL staging, authenticated account UI and delivery tests pass.

## Authorization and lifecycle

- Only the booking Landlord and assigned Cleaner can send. An Administrator may read for authorized moderation but cannot impersonate either participant.
- Messaging opens at `pending-cleaner-acceptance` and remains available through confirmed, journey, active-cleaning, review, completed and disputed states. It is closed for draft/search/pre-invite and cancelled records.
- Every read and write is authorized again in a `SECURITY DEFINER` database function using the transaction-local account context. RLS remains enabled, and the runtime role cannot directly read or mutate conversation/message tables.
- Sensitive property access instructions remain in the separately gated property projection; messaging does not broaden access to them.

## Privacy and abuse controls

Messages are limited to 2,000 normalized characters. Service and database rules reject email addresses, web links, UK-format telephone numbers and named outside-messaging networks. This reduces contact-information exposure but is not a substitute for monitoring and policy enforcement; staging abuse tests and an Administrator moderation workflow remain required.

Sends require a client-generated UUID retry key. The server separately generates the message ID. Replaying the same sender/key/content returns the original message, while reusing the key for different content fails. Per-account database locking enforces limits of 20 messages per minute and 200 per hour even across multiple application instances.

The accepted transaction creates:

- one append-only message tied to the booking and its one conversation;
- one idempotent in-app notification for the other participant, containing identifiers and sender role but no message body;
- one audit-log record containing no message body.

No edit/delete endpoint is exposed. Future moderation must preserve original evidence and use an explicit audited redaction state.

## API

- `GET /api/marketplace/bookings/:bookingId/messages?limit=50&beforeCreatedAt=...&beforeMessageId=...`
- `POST /api/marketplace/bookings/:bookingId/messages`

The GET route returns oldest-to-newest messages within each page, `hasMore`, and a stable tuple cursor. The POST body requires `clientMessageId` and `body`. Existing session, exact-origin, CSRF and role middleware protects mutations.

## Production gate

Apply `015_booking_messaging.sql` in staging and prove unrelated-user denial, Administrator send denial, cancelled-booking denial, retry idempotency under concurrency, cursor stability, rate-limit enforcement and contact-pattern rejection. The mobile booking screen must show clear rejection/retry states and must never imply that Tideway monitors messages continuously until real moderation operations exist.
