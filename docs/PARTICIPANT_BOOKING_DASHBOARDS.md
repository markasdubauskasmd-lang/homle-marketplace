# Participant booking dashboards

## Current status

Tideway now has authenticated, mobile-first booking lists for both marketplace roles:

- `/cleaner/dashboard` shows pending invitations, active/upcoming work and history. A Cleaner can accept or decline an assigned invitation. Acceptance is still decided by the server after it rechecks invitation expiry, eligibility, availability and overlapping confirmed work.
- `/landlord/dashboard` shows the signed-in Landlord's active/upcoming bookings and history alongside their properties and request-draft workspace. Eligible bookings link to payment authorization and confirmed work links to the participant-only active-job screen.

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

1. Apply the 26 locked migrations and restricted runtime grants to PostgreSQL 16.
2. Run the deployment verifier and behavioral RLS/concurrency harness with separate owner, web and worker roles.
3. Attach the complete marketplace only under the final HTTPS origin.
4. Create two genuine staging accounts, invite the Cleaner, and verify both role views on separate mobile devices.
5. Confirm that unrelated users, expired invitations and modified browser requests fail closed.

No real booking, Cleaner decision or payment was created during source verification.
