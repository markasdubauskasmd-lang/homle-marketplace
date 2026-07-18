# Participant booking dashboards

## Current status

Tideway now has authenticated, mobile-first booking lists for both marketplace roles:

- `/cleaner/dashboard` shows pending invitations, active/upcoming work and history. The invitation presents pay once with an exact label and a one-tap **Accept £X job** action; adjacent copy makes the availability/time/pay commitment explicit before the tap. It also shows a live time remaining and the exact London response deadline, with a distinct urgent state in the final hour. Decline retains its separate confirmation. Acceptance is still decided by the server after it rechecks invitation expiry, eligibility, availability and overlapping confirmed work.
- The response countdown is a browser-only display timer, not server polling. At the exact deadline it locks both decision controls and makes one read-only booking-summary refresh. It never sends, repeats or assumes an accept/decline response; an offline or failed refresh keeps the controls locked until the Cleaner deliberately reconnects and refreshes.
- `/landlord/dashboard` shows the signed-in Landlord's active/upcoming bookings and history alongside their properties and request-draft workspace. Eligible bookings link to payment authorization and confirmed work links to the participant-only active-job screen.

The pages are separate role-specific workspaces. `/landlord/dashboard` uses a warm property-focused header and Landlord-only primary actions; `/cleaner/dashboard` uses a dark work-focused header and Cleaner-only primary actions. Both run the same exact-role access decision before any secondary data is requested. A dual-role account deliberately activates a role through the authenticated onboarding/settings boundary rather than blending dashboard navigation; opening the other role URL presents only the currently active workspace link and never renders the requested role's records. Each dashboard's account menu shows the approved Google or Facebook profile photo when available, otherwise safe initials, without exposing provider identifiers or private tokens. The content policy permits only trusted Google/Facebook image CDN hosts and the browser renderer rejects arbitrary or non-HTTPS avatar URLs. The same menu revokes the exact current server session through a bounded, same-origin CSRF-protected **Sign out** action and returns to the matching booking or working entry point.

Both pages remain closed while the default-off PostgreSQL marketplace attachment is unavailable. They contain no sample people, prices, properties or bookings.

## Privacy and pricing boundary

Migration 026 adds one restricted `SECURITY DEFINER` summary function. It derives the current account and selected role from the transaction-local database identity, requires the booking participant relationship and returns only a bounded safe projection.

- A Cleaner receives only their agreed pay. Customer price and platform margin are not returned.
- A Landlord receives only their booking total. Cleaner pay and platform margin are not returned.
- Precise addresses, access instructions, coordinates, contact details and private profile fields are excluded.
- Before confirmation, the Cleaner sees only the outward postcode area and a generic property label.
- Active-job and payment links are derived from server-owned booking state; changing browser data cannot authorize an action.

All invitation decisions require the Tideway session, selected Cleaner role, same-origin request and tab-bound CSRF token. The database workflow records the response and blocks overlapping confirmed bookings transactionally.

## Activation requirements

1. Apply all migrations in `db/migration-lock.json` (currently 55) and the restricted runtime grants to PostgreSQL 16.
2. Run the deployment verifier and behavioral RLS/concurrency harness with separate owner, web and worker roles.
3. Attach the complete marketplace only under the final HTTPS origin.
4. Create two genuine staging accounts, invite the Cleaner, and verify both role views on separate mobile devices.
5. Confirm that unrelated users, expired invitations and modified browser requests fail closed.

The disposable PostgreSQL runner now proves one complete synthetic participant lifecycle and removes every reserved fixture afterward. It does not create a real booking or contact a payment, email, storage, map, customer or Cleaner provider; managed two-phone and provider-backed test evidence remains required.
