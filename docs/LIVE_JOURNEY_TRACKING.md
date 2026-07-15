# Live Cleaner journey tracking

This Phase 4 checkpoint prepares the account-backed, booking-scoped web journey from confirmed booking to arrival. It remains detached from the live pilot until PostgreSQL staging, authenticated account pages, HTTPS and an approved map/ETA provider are available.

## Journey boundary

- `POST /api/marketplace/bookings/:bookingId/journey/start` requires the assigned Cleaner, a confirmed booking, exact-origin/CSRF protection, explicit `consentGranted: true` and a valid current browser location.
- Starting changes the booking to `cleaner-en-route`, records consent/journey timestamps and status history, stores only the latest point, and queues an idempotent Landlord notification.
- `PUT /api/marketplace/bookings/:bookingId/journey/location` accepts current position only from that assigned Cleaner while the journey is active and consent remains recorded.
- `GET /api/marketplace/bookings/:bookingId/tracking` is restricted to the two booking participants or an Administrator. It returns the Cleaner’s public identity, booking status, sharing state and a non-expired current point—never pay, contact details, home/service coordinates, route history or property access instructions.
- `POST /api/marketplace/bookings/:bookingId/journey/arrive` works with or without location permission, records arrival once, changes the booking to `cleaner-arrived`, removes the current point and queues an idempotent notification.
- Any later booking status outside `confirmed` or `cleaner-en-route` triggers current-location deletion. This covers arrival now and cancellation/completion when their lifecycle transitions are added.

## Privacy and failure behaviour

The database holds one upserted location row per booking, never a trail. Each point expires after five minutes and is withheld once stale. A separately credentialed worker purges expired rows in concurrency-safe batches. Nearby is a one-time server calculation within 500 metres when property coordinates exist; it stores only the notification timestamp, not a proximity history.

Browser-submitted ETAs are discarded. A trusted optional server adapter may calculate ETA from current and destination coordinates; provider failure, missing coordinates or no provider returns `etaAvailable: false` without blocking location or arrival. Provider credentials stay server-side, while any browser map token must be origin-restricted.

The API exposes `live`, `stale`, `stopped`, `arrived` and `not-started` states so the interface can show honest retry/permission guidance. Invalid coordinates, missing consent, wrong roles, unrelated accounts, wrong booking states and unsafe time windows fail server-side.

## Mobile-web limitation

The reliable web mode requires the Cleaner to keep the active journey page visible. Mobile browsers may throttle or suspend `watchPosition()` when the screen locks, the tab is backgrounded or the operating system reclaims it. A PWA may improve installation, wake-lock guidance and reconnect UX, but it cannot guarantee background location on iOS or Android. Reliable background tracking ultimately requires a native application or wrapper with platform permission, persistent indicators and store/privacy review.

## Deployment checks

Apply migration 012 after migration 011. Schedule both worker functions at least once per minute:

```sql
SELECT * FROM tideway_private.expire_due_cleaner_invitations(100);
SELECT * FROM tideway_private.purge_expired_cleaner_locations(500);
```

Before enabling the browser experience, test explicit permission grant/denial, stale/offline recovery, unrelated-user denial, ETA-provider failure, nearby idempotency, concurrent updates, arrival deletion, cancellation deletion and expired-row purge in staging PostgreSQL over HTTPS.

No map service was selected, paid or contacted. No location was requested or stored by this checkpoint.
