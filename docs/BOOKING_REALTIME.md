# Booking real-time delivery

Tideway now has a durable, authenticated Server-Sent Events (SSE) contract for booking status, current journey location, cleaning progress and booking messages. It uses PostgreSQL commit notifications to wake streams and does not constantly poll.

The Landlord dashboard also has a request-level stream for the short gap between authorising matching and the first Cleaner invitation. Migration `054_cleaning_request_realtime_events.sql` records privacy-minimal request wake-ups and publishes them on the separate `tideway_request_events` channel. The owner-authorised snapshot contains only request status and bounded automatic-dispatch state. It deliberately excludes property details, address, Cleaner identity and contact information. Once an invitation is created, the browser closes this stream and opens the existing participant-authorised booking stream.

## Durable event flow

Migration `016_booking_realtime_events.sql` adds a minimal booking event ledger. Triggers observe committed inserts/changes to booking status history, current Cleaner location, progress events and messages. Each trigger writes a deduplicated event containing only booking ID, responsible-user ID, event kind, source key and timestamp, then calls `pg_notify` on the fixed `tideway_booking_events` channel.

PostgreSQL delivers `NOTIFY` only when the surrounding transaction commits. The application keeps one dedicated `LISTEN` connection, validates every notification payload and reconnects with bounded exponential backoff. After reconnect it requests a full resynchronization because notifications emitted while disconnected are not replayed.

The notification is only a wake-up signal. It is never trusted as user-facing data. Every connected account receives a fresh database-authorized snapshot containing:

- current booking status;
- the participant-safe current journey projection;
- the participant-safe cleaning progress projection;
- the latest 20 private booking messages;
- durable event identifiers after the browser's last acknowledged version.

If more than 100 events were missed, `resyncRequired` is true and the complete current snapshots remain authoritative.

## Stream security and reliability

`GET /api/marketplace/bookings/:bookingId/events` requires:

- an active authenticated session;
- exact application `Origin` even though the route is read-only;
- database-confirmed booking participation or authorized Administrator access;
- a valid `Last-Event-ID` header or `afterEventId` cursor.

`GET /api/marketplace/cleaning-requests/:requestId/events` applies the same session, exact-origin, cursor, expiry, connection-limit and no-store rules, and additionally requires the Landlord role plus database-confirmed ownership. An unrelated Landlord cannot observe whether a request is matching or whether an invitation exists.

Responses use `text/event-stream`, `Cache-Control: no-store, no-transform`, disabled reverse-proxy buffering, a three-second browser retry hint and 20-second comment heartbeats. The stream sends `booking-snapshot` events only after initial authorization or a committed database signal. Slow clients are disconnected instead of accumulating unbounded response buffers.

The service limits each user to three streams and the process to 1,000 streams by default, including concurrent opening reservations. Each stream closes at session expiry or after 15 minutes, whichever comes first, so reconnect rechecks the session; every signal refresh also rejects an inactive account. Browser disconnects release heartbeats, expiry timers and counters. Deployment shutdown must call `runtime.realtimeService.close()` before closing the database pool.

## Disposable database proof

The marketplace integration runner opens a dedicated `tideway_app` connection and completes `LISTEN tideway_booking_events` before a separate application connection begins the participant lifecycle transaction. A run passes only when one booking produces committed wake-ups for `booking-status`, `journey-location`, `journey-location-stopped`, `cleaning-progress` and `booking-message`.

Every received payload must contain exactly `bookingId`, `eventId` and `kind`. Any extra field fails the run, preventing a notification from becoming a path for names, email addresses, locations, instructions, messages or photo data. After delivery, the Landlord's participant-authorized catch-up snapshot must contain the same five event families and current completed state. A separate unrelated account must receive `booking-not-found` from the same snapshot function.

On 18 July 2026 this proof passed on a fresh disposable PostgreSQL 16 database after all 55 locked migrations and both restricted-role grant files. The synthetic accounts, bookings and messages were removed by the suite; the database and temporary migration-owner role were then deleted and the local restricted-role passwords were cleared. This is real local database evidence, not a substitute for the remaining managed-staging multi-instance and two-phone rehearsal.

## Mobile-web boundary

SSE is reliable while the web page is active and reconnects using its durable event ID after ordinary connection loss. Mobile operating systems may suspend a background browser page, so Tideway must not promise uninterrupted background tracking. The Cleaner journey already stores only a short-lived current point; when the page resumes, the stream snapshot catches up from the database. A native application would be required for stronger background guarantees.

## Production gate

Before attachment, apply migration 016 in PostgreSQL staging and prove transaction-commit ordering, unrelated-user denial, exact-origin denial, reconnect catch-up, listener reconnection, proxy buffering disabled, per-user limits, slow-client cleanup and multi-instance behavior. Configure the reverse proxy with a timeout longer than the heartbeat interval. No external push provider or paid service is required for this SSE checkpoint.
