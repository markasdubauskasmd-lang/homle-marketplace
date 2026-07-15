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
