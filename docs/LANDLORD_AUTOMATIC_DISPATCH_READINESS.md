# Landlord automatic-dispatch readiness

## Problem

Pricing, postcode-distance matching and automatic dispatch are separate runtime
capabilities. A web service can safely calculate and verify a direct invitation
while no background worker is running.

On 30 July 2026 the live Render health response truthfully reported:

- `matchingReady: true`
- `geocodingReady: true`
- `automaticDispatchReady: false`

The Landlord dashboard previously used only the first two values. It could
therefore offer automatic matching even though no process would perform the
invitation.

## Required behavior

- Direct, explicitly approved server-quoted invitations may remain available
  when pricing and geocoding are ready.
- Automatic controls must remain unavailable unless
  `automaticDispatchReady` is exactly `true`.
- A missing or failed health request must fail closed.
- Submitted requests remain safely open for Homle review.
- Copy must state that no Cleaner is contacted automatically.
- A previously saved automatic authorization must not be presented as actively
  finding a Cleaner while the worker is unavailable.

## Activation boundary

Do not turn on inline or standalone automatic-dispatch workers merely to remove
the warning. Starting the worker can create real Cleaner invitations for
requests whose Landlord has already authorized matching. That operational
activation requires explicit approval and a monitored worker plan.

## Verification

`tests/landlord-dashboard-ui.mjs` covers the separate capability state, the
fail-closed health projection, disabled automatic controls, preserved direct
matching, returning-request guidance and the no-contact boundary.

`tests/noncleaner-link-integrity.mjs` remains the regression boundary proving
that this Landlord-only change does not enter the separate Cleaner workspace.
