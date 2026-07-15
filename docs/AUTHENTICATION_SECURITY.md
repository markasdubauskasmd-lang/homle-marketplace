# Authentication security boundary

The social-account resolver is not an OAuth verifier. It must receive claims only from a provider adapter that has cryptographically validated the provider response. Never pass browser form values, query-string profile fields or an unverified decoded token into `identity-service.mjs`.

## Callback verification required before account resolution

For every provider, the server must validate the authorization response against a short-lived, single-use login attempt stored server-side. That includes exact callback origin, state, PKCE verifier/challenge, nonce where applicable, token signature, allowed algorithm, issuer, audience/client ID, expiry and issued-at time. The email must be present and provider-verified. The stable provider subject, not email, is the identity key.

- Google: use authorization code with PKCE and validate the OpenID Connect ID token against Google's issuer and keys.
- Apple: use authorization code, nonce and Apple's signed ID token. Preserve Apple's first-login name carefully because it may not be returned again; private-relay email is valid only when Apple verifies it.
- Facebook: use authorization code, validate the app/client binding and fetch the identity through the provider API over TLS. Enable the provider only if a verified email is actually returned.

The callback must consume the login attempt exactly once before creating a Tideway session. Login attempts and provider access tokens must not be logged. Provider access/refresh tokens are not required for basic Tideway sign-in and should not be retained unless a later approved feature genuinely needs them.

## Account linking rules

- An existing provider plus provider-subject pair always resolves to its existing Tideway account, even if the provider later reports a different email. It is never silently moved to another account.
- A new provider identity may attach to an existing active Tideway account only when the provider has verified the exact same canonical email.
- Concurrent first callbacks are serialized by provider-subject and canonical-email advisory transaction locks; database uniqueness remains the final guard.
- Suspended, deletion-pending or deleted accounts cannot be bypassed by signing in through another provider.
- Connecting or removing an additional provider from Settings still requires a recent authenticated session and provider re-authentication. The pre-login resolver does not implement provider removal.

## Onboarding and sessions

A verified account may hold a restricted session before choosing a role. Only Cleaner or Landlord/Property Manager is selectable. The role transaction creates exactly one corresponding private starter profile and is idempotent for retries. Switching roles requires a later administrator-reviewed workflow; Administrator is never self-selectable.

After first role selection, the HTTP layer must rotate the session token so the new role set is reflected in a fresh server-side session context. All cookie-authenticated mutations require the CSRF token and an allowed origin.

No OAuth route should be enabled until provider-specific verifier tests, exact HTTPS callback URLs and staging PostgreSQL integration tests pass.

## Email/password boundary

Email signup, verification and password reset use a separate `AUTH_TOKEN_SECRET`, not the session secret. Raw verification and reset tokens exist only long enough for a trusted email-delivery adapter to create the HTTPS link; PostgreSQL stores purpose-bound HMAC hashes. Never return the internal `emailDelivery` material from a public API, log it or place it in analytics.

Public signup and reset-request responses remain generic whether an email exists. Password verification performs a real scrypt comparison even for an unknown email, and failed-attempt counters live in PostgreSQL so process restarts cannot clear them. Five consecutive failures lock the credential for 15 minutes. A correct password cannot bypass an active lock.

An unverified password account can request a replacement verification link without revealing whether the address exists. Issuing a replacement atomically expires earlier unused verification tokens, uses an email-scoped advisory transaction lock and writes an audit event. The public response remains byte-for-byte generic for known and unknown addresses.

Verification tokens are single-use and expire within 48 hours. Reset tokens are single-use, expire within two hours, replace the scrypt credential transactionally and revoke every active session for that account. The user must sign in again after a successful reset.

SMTP is not configured in this local workspace. The functions and trusted delivery handoff are foundations only; email/password capability flags stay false until PostgreSQL, `SESSION_SECRET`, the distinct `AUTH_TOKEN_SECRET`, exact `APP_ORIGIN`, `SMTP_URL` and `EMAIL_FROM` are all configured.

## Cookie-authenticated HTTP boundary

Private account routes use only the environment-appropriate session cookie name: production accepts the `Secure` host-prefixed cookie, while local HTTP development accepts a separate development cookie. A production request cannot fall back to the non-secure cookie. The raw opaque token is HMAC-hashed before session lookup and is never included in the authenticated context.

Every cookie-authenticated mutation requires all three checks: an exact configured `Origin`, the session's CSRF token in `X-CSRF-Token`, and an allowed server-side role. A role-pending account may access onboarding but receives no Cleaner or Landlord authority before selection. Hiding a button is never treated as authorization.

The public capability endpoint has an additional runtime-composition gate. Valid credentials alone cannot expose Google or email sign-in before the real database pool, repositories, delivery adapter and protected HTTP handlers are connected. Until then, `/login` and `/signup` show an honest unavailable state and only link to the working private pilot routes.

## Session issuance and rotation

`account-session-service.mjs` now provides the trusted session-issuance boundary that login and provider callbacks will call after authentication succeeds:

- the browser receives only the HttpOnly cookie plus a separate CSRF token; the raw session token is not returned in JSON;
- the repository receives only 32-byte HMAC token/CSRF hashes and expiry, never either raw token;
- user-agent and IP metadata are optional, bounded and stored only as domain-separated keyed hashes;
- production uses the Secure `__Host-` cookie; local development uses the separate non-secure cookie name;
- logout revokes the exact current database session before expiring the cookie, while logout-all revokes every account session;
- privilege-changing rotation verifies that the new session belongs to the same account, revokes the old session first and fails closed if replacement creation fails.

The isolated authentication controller now prepares generic signup, verification resend/confirmation, password login, reset request/confirmation, exact logout, logout-all and role onboarding routes. Email links carry their opaque token in the URL fragment, not a server-visible query string. Successful login returns the token only as an HttpOnly cookie and returns separate CSRF material; password reset never silently signs the browser in.

The controller cannot compose unless a trusted email-delivery adapter, shared rate limiter and server-derived client-key resolver are supplied, and email configuration is present. Authentication and the two public marketplace reads now use one reusable fail-closed boundary: bounded denials include `Retry-After`, while a missing key, malformed decision or limiter outage returns a generic 503 and sends the private cause only to monitoring. The runtime requires abuse control even when email delivery remains disabled. It remains detached from `server.mjs`; public entry stays closed until real PostgreSQL migrations, an approved driver, SMTP/provider adapters, cross-instance abuse-control evidence and HTTPS browser tests exist.

The prepared browser forms are separately fail-closed: HTML ships them hidden with disabled fieldsets, and `auth-entry.js` activates them only when the public email-password capability is true. Verification/reset fragments are removed immediately. If the browser cannot retain the separate CSRF token, the client closes the newly issued session instead of continuing with a partially usable account. See `docs/ACCOUNT_UI.md`.
