# Authenticated active-job interface

## Current status

Tideway now has one real participant screen for the confirmed booking lifecycle. These canonical routes serve the same mobile-first interface:

- `/bookings/:bookingId`
- `/bookings/:bookingId/tracking`
- `/bookings/:bookingId/cleaning-progress`

The page contains no fixture booking or sample Cleaner. It authenticates the Tideway session, derives the selected Cleaner or Landlord role and then requests the participant-protected tracking, cleaning-progress and booking-property projections. An unrelated or signed-out account receives no booking details.

The screen remains fail-closed while `MARKETPLACE_ENABLED=false`. A real two-account trial still requires the PostgreSQL/SMTP/private-storage attachment, migrations and runtime grants to pass staging.

## Cleaner experience

The Cleaner receives large, one-hand controls appropriate to the current server state:

1. **Start journey** asks for location permission only after the Cleaner taps it, records explicit consent and sends the first current point.
2. While the page stays open, foreground `watchPosition` updates the current point at a bounded interval. Reloading the page requires a deliberate **Resume location sharing** action; sharing never restarts silently.
3. **I have arrived** records arrival and clears the browser watch. The database also deletes the current point and stops sharing.
4. **Start cleaning** opens the real room checklist.
5. Every eligible unresolved checklist item leads with one large **Mark task complete** action. Skip, issue, in-progress, correction and optional notes remain under **More options or add note** rather than appearing on every task. Pending/declined unexpected work cannot be completed; approved unexpected work receives the same one-tap control.
6. The Cleaner can pause/resume and propose an unexpected task for Landlord approval only after confirming it fits the remaining booked time and agreed pay. The server checks that boundary again; anything needing more time or pay is reported as an issue for separate scope review.
7. **Finish cleaning** stays disabled until every server-projected task is resolved. The server remains authoritative.

Both participants can use the private booking chat from this screen. Messages arrive through the durable booking event stream, older messages use stable cursor pagination and a browser retry reuses the same idempotency key if the server response is lost. Tideway blocks phone numbers, email addresses, links and outside-messaging handles so participants can coordinate without exposing personal contact details.

After arrival, the Cleaner can deliberately take one new rear-camera photo or choose one existing JPEG, PNG, WebP or HEIC image. The browser rejects unsupported, empty or oversized input, calculates SHA-256 locally, requests one ten-minute signed upload, sends the file directly to the exact configured private-storage origin without Tideway cookies or a referrer and asks the server to verify and sanitize it. Before evidence closes after cleaning finishes; after/issue evidence remains available while awaiting review. Both participants receive live photo metadata and can request a five-minute private view. The signed URL is cleared from the page when its viewer closes.

After the Cleaner resolves every task and finishes, the same participant screen gives only the booking Landlord the completion confirmation. The Landlord is told to inspect tasks, notes, issues and private after photos before recording the visit as completed. Only then does the one-review form open: overall score is required, four category scores and bounded written feedback are optional, and a final confirmation makes the one-per-booking boundary clear. Pending/rejected moderation details remain visible only to the Landlord. The Cleaner sees nothing until approval and may then add one final professional response. All review content renders as text, and the server remains authoritative for role, booking status, duplicate, content and moderation checks.

All mutations use the opaque session plus the tab-bound CSRF token. Hiding a button is never the authorization boundary; the existing role-checked services, PostgreSQL functions, RLS and booking status rules remain responsible for every accepted change.

## Landlord experience

The Landlord receives the assigned Cleaner identity projection, scheduled time, ETA when an approved provider supplies one, last current-location update, arrival state, overall percentage, elapsed time, room tasks, Cleaner notes, issue states, private photo metadata and protected confirmed-property instructions. The Landlord can approve or decline a pending unexpected task only after the Cleaner has explicitly accepted the remaining-time and frozen-pay boundary; approval still preserves the frozen booking price and Cleaner pay.

The page consumes the existing durable authenticated event stream. PostgreSQL commit signals produce participant-safe snapshots, the browser reconnects with SSE semantics and the UI keeps the last verified state during a connection loss. It does not use constant polling.

## Location and map boundary

The interface visualises journey state without sending coordinates to Google, Mapbox, OpenStreetMap or an advertising map provider. This avoids disclosing an assigned Cleaner’s live point to an unapproved third party. It is deliberately labelled as a private journey surface, not a street map.

A geographical street map remains an activation decision. If one is approved, its provider, data-processing terms, key restrictions, retention and coordinate disclosure must be reviewed; keys must remain in deployment secrets and an authorised server projection should minimise data sent to the browser/provider.

Web location has material reliability limits:

- mobile browsers generally require HTTPS for geolocation;
- the page must remain open for dependable foreground updates;
- operating-system power saving and browser suspension can stop updates;
- a local Wi-Fi HTTP preview may display the screen but should not be treated as a valid phone-location test.

The current solution is the most defensible web baseline. Reliable locked-screen/background journey tracking would require an installed native application and explicit platform background-location permissions. A PWA improves installation and offline presentation but does not remove iOS/Android background-geolocation restrictions.

## Remaining product work

- Run migration 026 in staging and verify that Cleaner and Landlord dashboards list only their own role-safe booking summaries before opening this screen.
- Connect the real PostgreSQL runtime and create two genuine test accounts under the final HTTPS domain.
- Decide whether to approve a map/ETA provider after privacy, cost and deployment review.
- Perform the final two-device mobile-browser test over HTTPS, including denied permission, lost connection, reload/resume, arrival shutdown and an unrelated-account denial.

## Verification

`tests/active-job-ui.mjs` covers route parsing, selected-role behavior, lifecycle action selection, eligible one-tap task completion, unexpected-task approval gating, detailed task fallbacks, loading/accessibility states, unresolved-task finish blocking, Landlord-only unexpected-task decisions, completion/review UI states, bounded review scores/text, final Cleaner response, private booking-case categories/details/confirmation, foreground geolocation cleanup, durable live snapshots, private-chat lifecycle, chronological deduplication, retry UUIDs, stable pagination, photo MIME/size/lifecycle checks, deterministic local SHA-256, exact signed-header upload behavior, credential/referrer isolation, camera and exact storage-origin policies, preview cleanup, CSRF/session use, no unsafe HTML rendering, no external map dependency, canonical server routing and mobile/reduced-motion styles. Journey, progress, media, message, review, dispute and real-time service suites continue to prove the server-side authorization and privacy boundaries.

## Private booking cases

The same participant page exposes **Open a Tideway case** only while a booking can legitimately be disputed. The form requires a category, at least 20 characters of factual detail and an explicit accuracy/sharing confirmation. It keeps one retry UUID until the response succeeds so a connection loss cannot create a second case. A successful opening immediately displays `disputed`, stops any browser location watch and replaces the form with the private case status, description and eventual Administrator resolution. It does not promise a refund and does not change payment records.
