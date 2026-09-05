# Checkout session recovery audit — 5 September 2026

## Current evidence

The preceding goal turn made progress: PRs #417 and #418 were merged and deployed.
This continuation rechecked GitHub main and the public health endpoint: both identify
`b55102cf`. Health reports healthy data integrity, writes enabled, and ready payment,
matching, automatic dispatch, speech and vision integrations. Email and address
lookup still report unavailable. These readiness flags do not prove a completed
hosted payment or physical-device booking journey.

## Problem and boundary

The Landlord checkout's payment preparation handler checked its loading flag, then
awaited session recovery before setting that flag or disabling its button. A slow
session response allowed repeated clicks to overlap recovery calls and subsequent
payment preparations. Server idempotency remains essential, but does not serialize
CSRF recovery or competing browser payment forms.

Only the Landlord checkout controller and its cache-version reference change. The
payment endpoint, authorization logic, amount verification, idempotency storage,
session implementation and all Cleaner files remain unchanged.

## Change and verification

Acquire the existing loading guard and disable the button before the first await.
Recover the session inside the existing try/finally so every failure releases the
guard and restores the button. Retain the existing visible failure messages.

The regression test runs the real checkout page in isolated Chromium against local
test endpoints. Before the fix, three clicks produced three session requests and
the test failed. After the fix, at 390px and 1280px:

- Three clicks send one session recovery.
- Failed session recovery sends no payment preparation and restores the button.
- A deliberate retry recovers the session and sends one payment preparation.
- A provider failure stays visible and permits a deliberate retry.
- Repeated payment attempts preserve the booking's existing idempotency key.
- No unhandled browser errors occur.

The Cleaner freeze verifies 89 protected files and 9 shared outcome modules remain
byte-for-byte unchanged. No live payment action, invitation or email was sent during
this audit.

## Remaining work

Continue the full objective's hosted journey verification. Email delivery, address
lookup, actual two-device behavior and a complete provider-backed test payment cycle
are not established by this browser regression or the health endpoint. Existing
product opportunity recommendations remain in
`docs/PRODUCT_OPPORTUNITY_AUDIT_2026-07-29.md`; this correction addresses a verified
payment interaction defect before adding features.
