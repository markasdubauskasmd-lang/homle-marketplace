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
5. The Cleaner can change task status, add a note, report an issue, pause/resume and propose an unexpected task for Landlord approval.
6. **Finish cleaning** stays disabled until every server-projected task is resolved. The server remains authoritative.

All mutations use the opaque session plus the tab-bound CSRF token. Hiding a button is never the authorization boundary; the existing role-checked services, PostgreSQL functions, RLS and booking status rules remain responsible for every accepted change.

## Landlord experience

The Landlord receives the assigned Cleaner identity projection, scheduled time, ETA when an approved provider supplies one, last current-location update, arrival state, overall percentage, elapsed time, room tasks, Cleaner notes, issue states, private photo metadata and protected confirmed-property instructions. The Landlord can approve or decline a pending unexpected task; approval explicitly preserves the frozen booking price and Cleaner pay.

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

- Add participant booking-list queries and link active/upcoming jobs from both real dashboards. Until then, the canonical screen requires an authorised booking reference.
- Connect the real PostgreSQL runtime and create two genuine test accounts under the final HTTPS domain.
- Complete the private before/after photo interaction in the active-job UI; the secured upload/access services and photo metadata already exist.
- Add booking messaging to this screen or link the existing participant-only message service.
- Decide whether to approve a map/ETA provider after privacy, cost and deployment review.
- Perform the final two-device mobile-browser test over HTTPS, including denied permission, lost connection, reload/resume, arrival shutdown and an unrelated-account denial.

## Verification

`tests/active-job-ui.mjs` covers route parsing, selected-role behavior, lifecycle action selection, unresolved-task finish blocking, Landlord-only unexpected-task decisions, foreground geolocation cleanup, durable live snapshots, CSRF/session use, no unsafe HTML rendering, no external map dependency, canonical server routing, scoped geolocation policy and mobile/reduced-motion styles. Journey, progress and real-time service suites continue to prove the server-side authorization and privacy boundaries.
