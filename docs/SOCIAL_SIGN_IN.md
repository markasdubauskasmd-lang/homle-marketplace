# Social sign-in boundary

## Current status

Google OpenID Connect is implemented in source and connected to the detached marketplace runtime. It is disabled on the current local pilot because the required PostgreSQL runtime, HTTPS domain and real Google Web OAuth credentials are not configured. The account page never reveals the Google control unless `/api/auth/providers` truthfully reports `google: true`.

Facebook Login is now implemented in detached source but remains disabled on the local pilot. Tideway validates the provider identity and App ID, but deliberately treats Facebook's `email` field as unverified. A first-time Facebook subject receives a separate Tideway mailbox-verification link before an account or identity is created. Existing password accounts are never auto-linked by this pre-authenticated flow; they use the authenticated `/settings` connection journey described below.

## Authenticated connection from Settings

An existing verified password account can connect Google or Facebook without relying on an email match:

1. `/settings` reads only provider names and connection timestamps through an actor-bound function; provider subjects and emails are not returned.
2. The account submits its current Tideway password over the same-origin, session and CSRF-protected connection route. The normal persistent password-attempt lock is reused.
3. A successful step-up creates both the provider's signed OAuth state and a second ten-minute HTTP-only cookie bound to the exact Tideway user, session and provider.
4. The provider state is itself signed as `link`, so a missing/expired connection cookie cannot downgrade the callback into ordinary pre-authenticated sign-in.
5. The callback requires the original live Tideway session, verifies both state cookies and connects the provider subject through a collision-locked database function. It cannot change role, profile, email or bookings.
6. The database rejects a provider subject already owned by another account and rejects replacing an account's existing provider subject. Only provider name and email-verification status enter the audit record.

Connection controls remain hidden when the provider is unavailable, already connected, the marketplace attachment is off or the account has no password identity. Social-only accounts still need a future recent-provider step-up flow. Provider removal also remains unavailable until Tideway can prove it will not lock out the last usable sign-in method.

## Google security model

The server uses Google's authorization-code flow and requests only `openid email profile`:

1. `GET /api/marketplace/auth/google/start` creates independent random state, nonce and PKCE verifier values.
2. Tideway signs the ten-minute flow payload with `AUTH_TOKEN_SECRET` and stores it only in an HTTP-only, same-site cookie. HTTPS deployments add `Secure`.
3. Google returns a one-time authorization code to the exact configured callback.
4. Tideway compares state in constant time and exchanges the code from the server using the original PKCE verifier and client secret.
5. Tideway verifies the ID token's RS256 signature against Google's bounded JWKS cache, and validates issuer, audience/authorised party, expiry, issued-at time, nonce, subject and `email_verified`.
6. The provider flow cookie is expired. The verified claims pass through the existing takeover-safe social-identity transaction and Tideway creates an opaque session whose raw token remains in an HTTP-only cookie.
7. The browser receives only Tideway's CSRF value in a URL fragment, removes it before making another request and stores it in that tab's session storage. No Google access token, refresh token, client secret or authorization code is retained.

The callback immediately redirects and renders no third-party resources, preventing the authorization code from leaking through page scripts or a referrer. Rate limits cover both start and callback routes. Errors use a generic browser result while unexpected internal failures go only to the private monitoring hook.

## Founder setup after the domain is chosen

Do not add credentials to source control or `.env.example`.

1. Create a Google Cloud project and Web OAuth client under the legal business account.
2. Configure the consent screen with the approved Tideway business identity, support email, homepage, privacy notice and terms URLs.
3. Register the JavaScript origin as the exact HTTPS `APP_ORIGIN`.
4. Register the redirect URI as exactly:

   ```text
   https://your-domain.example/api/marketplace/auth/google/callback
   ```

5. Store `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the hosting secret manager.
6. Complete PostgreSQL 16 migrations/RLS/concurrency tests, verify internal SMTP and private S3/Sharp boundaries against approved providers, prove shared limiting, and attach monitoring before enabling `MARKETPLACE_ENABLED=true`.
7. Run the default domain verifier first to prove Google is closed. After full attachment is deliberately enabled, set `TIDEWAY_EXPECT_SOCIAL_PROVIDERS=google` and rerun it: the report must prove the advertised capability, exact Google authorization host/path, canonical callback, PKCE request, secure host-only flow cookie and no-store response without following the provider redirect.
8. Test new-account creation, repeat login, role onboarding, password-account collision/step-up, logout and mobile browser behavior under the final domain.

## Facebook security model

The server uses a version-pinned Facebook authorization-code flow:

1. `GET /api/marketplace/auth/facebook/start` creates random state and stores its signed ten-minute payload only in an HTTP-only, same-site cookie.
2. Facebook returns a one-time code to the exact HTTPS callback. Tideway compares state in constant time and exchanges the code from the server.
3. Tideway inspects the returned access token, requiring `is_valid`, the exact configured App ID, a user token, matching user subject and unexpired token/data access.
4. The bounded `/me` request uses a bearer token and `appsecret_proof`; returned profile ID must match the inspected token subject. Access tokens and App secrets never enter a Tideway session or browser storage.
5. A previously Tideway-verified Facebook subject may sign in immediately. A new subject receives a one-hour, single-use, purpose-hashed Tideway email link. No account exists until that link is consumed.
6. The consume transaction locks subject and email, creates a new verified account or connects only to an existing verified social-only account, writes audit evidence and establishes Tideway's opaque session. Unverified, inactive and password-account collisions are consumed but not linked.
7. The private pending table is inaccessible to both restricted roles; a worker-only bounded purge removes used/expired material after 24 hours.

Facebook start, callback and verification confirmation each have shared PostgreSQL rate limits. Missing provider email directs the user to email sign-in without creating an account. Provider or internal errors produce generic browser outcomes.

## Facebook activation gate

Before Facebook can become public:

- create the Meta app under the approved legal business account and register the exact HTTPS callback `/api/marketplace/auth/facebook/callback`;
- store `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` and an explicitly selected supported `FACEBOOK_GRAPH_API_VERSION` in deployment secrets;
- complete Meta app review where required, the data-deletion callback, production privacy disclosures and provider-disconnection handling;
- retain the authenticated current-password connection proof and add recent-provider step-up for social-only accounts plus lockout-safe provider removal;
- pass the locked migration, RLS, concurrency, SMTP-delivery and full mobile-browser staging suites under the final domain.
- rerun `tools/domain-readiness.mjs` with `TIDEWAY_EXPECT_SOCIAL_PROVIDERS=google,facebook` (or `facebook` if Google is intentionally closed) and retain the passing, secret-free result.

Until those conditions pass against real infrastructure, the Facebook button remains hidden and `/api/auth/providers` reports `facebook: false`.
