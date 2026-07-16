# Capability-gated account interface

Tideway now has mobile-first account form markup and browser logic for `/login`, `/signup`, `/verify-email`, `/verify-facebook`, `/reset-password`, `/onboarding` and `/settings`. The existing Tideway card, typography, spacing, focus and button system is reused; no second frontend framework was added.

## Fail-closed behaviour

- Every account form and fieldset is hidden and disabled in the server-rendered HTML.
- The browser calls the no-store `/api/auth/providers` capability endpoint.
- Email forms activate only when `emailPassword === true`; Google and Facebook controls activate only under their matching capability. The Facebook verification form additionally requires `facebook === true`. Each flag requires the matching complete backend plus the explicit runtime-composition gate.
- Today that flag is false, so users continue to see the honest account-unavailable state and the working request/cleaner-pilot actions.
- Google and Facebook controls exist hidden and inert in the server markup. The browser reveals only a provider explicitly advertised by the no-store capability response. Both callback implementations now exist, while both remain false and hidden without complete staging infrastructure and verified credentials.

## Prepared journeys

- Every public **Book a clean** action opens `/signup?intent=book`. When Google or Facebook is configured, its start link carries only the fixed `book` intent; email/password remains the fallback. Private email-verification and resend links carry that same fixed action in their fragment, so opening mail in a new tab or device returns a verified customer to booking sign-in.
- The server signs the booking intent into the short-lived provider flow instead of accepting a general return URL. Arbitrary and duplicated intents are rejected, so this journey cannot become an open redirect.
- A successful social sign-in automatically creates or safely reuses the verified Tideway account. New accounts continue to role onboarding with Landlord preselected, then open `/landlord/dashboard?start=booking`. A first-time Landlord immediately receives the property form; a returning Landlord with saved properties goes directly to the room-scan request form. Saving the request automatically opens its required private room-scan card, loads the current scan state and focuses the room selector. The user still confirms the role; an existing Cleaner-only account receives a clear message and is never silently changed.
- The browser remembers only the allowlisted booking action in session storage for 30 minutes, removes it after reaching the Landlord workspace and never stores a provider token or arbitrary destination.
- Login stores only the separate CSRF token in session storage; the opaque session remains in an HttpOnly cookie.
- A successful Google callback places only the Tideway CSRF value in a fragment, removes that fragment before any request, stores the value in the same tab and continues a role-pending account to onboarding. Google codes and tokens are never placed in browser storage.
- A first Facebook callback never trusts the provider email: it sends a private Tideway verification link. `/verify-facebook` removes the token before its first request, consumes it once, establishes only Tideway's opaque session and continues a new role-pending account to onboarding. A previously verified Facebook subject follows the normal social-session path.
- If session storage is unavailable, the browser immediately logs the newly issued/rotated session out instead of leaving an unusable authenticated state.
- A role-pending login continues to `/onboarding`, where only Cleaner or Landlord/Property Manager can be selected.
- `/settings` fails closed until the authenticated provider-list route succeeds. Password accounts use current-password step-up. Social-only accounts deliberately reauthenticate through one exact connected provider before a ten-minute approval exposes another connection; that browser approval is cleared when the connection starts. Removal appears only when a second method exists and either password proof is available or the recently verified different provider will remain; success signs out every session. Returned navigation is allowlisted to the exact provider host and canonical callback.
- Email-verification and password-reset tokens are removed from the address bar before any availability request or form interaction.
- A missing verification token opens a generic resend form; a missing reset token opens the generic reset-request form.
- Signup, verification resend and reset request keep their generic anti-enumeration copy.
- Reset confirmation clears stale browser CSRF material and does not create a new session.
- Every form has native mobile validation, bounded autocomplete fields, visible live feedback, pending buttons and one-column phone actions.

These pages are prepared source, not enabled account access. Before activation, attach the composed runtime, execute PostgreSQL migrations/RLS tests, connect approved email delivery and shared rate limiting, and run authenticated browser/accessibility tests under the final HTTPS origin.
