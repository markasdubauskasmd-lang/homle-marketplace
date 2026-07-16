# Capability-gated account interface

Tideway now has mobile-first account form markup and browser logic for `/login`, `/signup`, `/verify-email`, `/reset-password` and `/onboarding`. The existing Tideway card, typography, spacing, focus and button system is reused; no second frontend framework was added.

## Fail-closed behaviour

- Every account form and fieldset is hidden and disabled in the server-rendered HTML.
- The browser calls the no-store `/api/auth/providers` capability endpoint.
- Email forms activate only when `emailPassword === true`; the Google control activates only when `google === true`. Each flag requires the matching complete backend plus the explicit runtime-composition gate.
- Today that flag is false, so users continue to see the honest account-unavailable state and the working request/cleaner-pilot actions.
- Google and Facebook controls exist hidden and inert in the server markup. The browser reveals only a provider explicitly advertised by the no-store capability response. Google now has a cryptographic callback implementation; Facebook remains false and hidden.

## Prepared journeys

- Login stores only the separate CSRF token in session storage; the opaque session remains in an HttpOnly cookie.
- A successful Google callback places only the Tideway CSRF value in a fragment, removes that fragment before any request, stores the value in the same tab and continues a role-pending account to onboarding. Google codes and tokens are never placed in browser storage.
- If session storage is unavailable, the browser immediately logs the newly issued/rotated session out instead of leaving an unusable authenticated state.
- A role-pending login continues to `/onboarding`, where only Cleaner or Landlord/Property Manager can be selected.
- Email-verification and password-reset tokens are removed from the address bar before any availability request or form interaction.
- A missing verification token opens a generic resend form; a missing reset token opens the generic reset-request form.
- Signup, verification resend and reset request keep their generic anti-enumeration copy.
- Reset confirmation clears stale browser CSRF material and does not create a new session.
- Every form has native mobile validation, bounded autocomplete fields, visible live feedback, pending buttons and one-column phone actions.

These pages are prepared source, not enabled account access. Before activation, attach the composed runtime, execute PostgreSQL migrations/RLS tests, connect approved email delivery and shared rate limiting, and run authenticated browser/accessibility tests under the final HTTPS origin.
