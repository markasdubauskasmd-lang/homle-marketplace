# Social sign-in boundary

## Current status

Google OpenID Connect is implemented in source and connected to the detached marketplace runtime. It is disabled on the current local pilot because the required PostgreSQL runtime, HTTPS domain and real Google Web OAuth credentials are not configured. The account page never reveals the Google control unless `/api/auth/providers` truthfully reports `google: true`.

Facebook is not implemented or advertised. Meta Login identifies a Facebook account, but Tideway's current account-deduplication rule requires a cryptographically/provider-verified email before creating or linking an identity. Tideway must not treat the mere presence of an `email` field as proof of mailbox ownership. The safe future flow is Facebook token validation followed by Tideway email verification for a new account, or authenticated settings plus step-up for linking an existing account.

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
7. Verify `/api/auth/providers` reports Google true only after full attachment, then test new-account creation, repeat login, role onboarding, password-account collision/step-up, logout and mobile browser behavior under the final domain.

## Facebook implementation gate

Before Facebook can become true, add all of the following behind its own capability:

- exact state-protected OAuth callback and server-side access-token inspection bound to Tideway's Facebook App ID;
- `appsecret_proof` for Graph requests and bounded provider responses/timeouts;
- a pending identity/email-verification transaction that cannot auto-merge on an unverified provider email;
- authenticated provider linking with recent password/provider step-up;
- app review, data-deletion callback and production privacy disclosures;
- adversarial tests for forged tokens, wrong app/user IDs, absent email, duplicate email, pre-registration takeover, callback replay and provider disconnection.

Until those conditions pass against real infrastructure, the Facebook button remains hidden and `/api/auth/providers` reports `facebook: false`.
