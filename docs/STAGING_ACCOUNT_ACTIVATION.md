# Homle real-account staging activation

This checklist opens real Homle accounts for approved testers without opening cleaning requests, room-photo storage or payments. The public preview remains deny-by-default throughout.

## Important: do not open callback URLs yourself

The Google and Facebook callback URLs are machine endpoints. Opening one in a browser without first starting at Homle is expected to return `Not found` or a failed-login response. A provider sends the browser there automatically after a valid sign-in attempt.

## 1. Owner creates the provider credentials

In Google Cloud, create an OAuth client with application type **Web application**. Google's [web-server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server) requires an exact authorized redirect URI. Use:

- Authorized JavaScript origin: `https://homle-marketplace-preview.onrender.com`
- Authorized redirect URI: `https://homle-marketplace-preview.onrender.com/api/marketplace/auth/google/callback`

Keep the OAuth consent screen in testing while Homle is staging and add only the founder-approved test Google account. Store the resulting client ID and secret directly in Render as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Never put the secret in Git, a screenshot, chat or a support message.

For Facebook, create a Meta app owned by the Homle business owner and add Facebook Login for the web preview. Configure:

- Valid OAuth redirect URI: `https://homle-marketplace-preview.onrender.com/api/marketplace/auth/facebook/callback`
- Data-deletion callback: `https://homle-marketplace-preview.onrender.com/api/marketplace/auth/facebook/data-deletion`
- Data-deletion status page: `https://homle-marketplace-preview.onrender.com/facebook-data-deletion`

Store the numeric App ID, secret and the currently selected supported Graph API version directly in Render as `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` and `FACEBOOK_GRAPH_API_VERSION`.

## 2. Owner connects a real email sender

Choose one reviewed delivery path:

- Resend HTTPS: `EMAIL_DELIVERY_PROVIDER=resend`, `RESEND_API_KEY`, and a verified `EMAIL_FROM`; or
- SMTP over TLS: `EMAIL_DELIVERY_PROVIDER=smtp`, `SMTP_URL`, and a verified `EMAIL_FROM`.

Facebook's first-login mailbox check, password verification and password reset depend on this sender. Homle never advertises those capabilities until delivery verifies successfully.

For a Google-only account rehearsal, the email sender may be omitted. Google sign-in and role onboarding remain available, while email/password, password reset, email verification and Facebook stay unavailable. The full booking marketplace still requires a verified sender for participant notifications before `MARKETPLACE_ENABLED=true`.

## 3. Approve only the staging test account

Keep `STAGING_ACCOUNTS_ONLY=true`. Generate the canonical fingerprint locally:

```powershell
$StagingEmail = Read-Host "Approved non-customer staging email"
$StagingEmail | node tools/staging-account-email-hash.mjs
Remove-Variable StagingEmail
```

Store only the resulting fingerprint in Render as `STAGING_ACCOUNT_EMAIL_SHA256`. Do not store or commit the raw address. Multiple approved testers use comma-separated fingerprints, up to 20.

## 4. Activate accounts only

After the owner has reviewed Render's restricted log access for this private test, set:

- `RENDER_LOG_MONITORING_ACKNOWLEDGED=true`
- `AUTHENTICATION_ENABLED=true`
- `MARKETPLACE_ENABLED=false`
- `PILOT_INTAKE_ENABLED=false`
- `PAYMENTS_ENABLED=false`

Deploy, then verify `/api/auth/providers`. It must advertise only providers that composed successfully. Start sign-in from `/login` or `/signup`; never start at a callback URL.

Before asking a tester to sign in, run the external readiness verifier. It makes one anonymous, no-cookie request to Google's validated authorization URL and stops before login. If Google has not saved the exact callback on the matching web client, the report fails with `google-provider-registration` and prints the exact URI to add; this prevents another tester from reaching Google's `redirect_uri_mismatch` page:

```powershell
$env:TIDEWAY_PUBLIC_ORIGIN = "https://homle-marketplace-preview.onrender.com"
$env:TIDEWAY_EXPECT_RELEASE = "1234abcd" # exact live sourceCommit from /api/health
$env:TIDEWAY_EXPECT_SOCIAL_PROVIDERS = "google"
node tools/domain-readiness.mjs
Remove-Item Env:TIDEWAY_PUBLIC_ORIGIN, Env:TIDEWAY_EXPECT_RELEASE, Env:TIDEWAY_EXPECT_SOCIAL_PROVIDERS
```

Do not continue to mobile onboarding until every check passes. The verifier never signs in, creates an account or exposes the client ID, flow state, cookie or secret in its result.

## 5. Evidence and cleanup

Test one approved Landlord and one approved Cleaner onboarding path. Each approved Google account must return to Homle, save exactly one role and reach `/account-ready`, where the role-specific completion state is verified through the authenticated current-account endpoint. The full property/profile editors remain closed until the marketplace dependencies pass. Confirm that a different email cannot create an account, request verification, reset a password or sign in.

Before cleanup, run the no-write evidence verifier. It accepts the two raw emails only through private prompts, requires both fingerprints to remain on the allowlist and returns only roles, counts, timestamps and the staging database name/host. It opens a repeatable-read read-only transaction and refuses missing/wrong roles, duplicate accounts, the wrong provider, inactive sessions, dual profiles or any marketplace/payment activity:

```powershell
$env:STAGING_ROLE_REHEARSAL_DATABASE_URL = Read-Host "Migration-owner external staging database URL"
$env:STAGING_ACCOUNT_EMAIL_SHA256 = Read-Host "Comma-separated approved staging email fingerprints"
$env:STAGING_ROLE_REHEARSAL_CONFIRMATION = "VERIFY TWO APPROVED HOMLE STAGING ROLE PROFILES"
$env:STAGING_ROLE_REHEARSAL_PROVIDER = "google"
pnpm run verify:staging-roles
Remove-Item Env:STAGING_ROLE_REHEARSAL_DATABASE_URL, Env:STAGING_ACCOUNT_EMAIL_SHA256, Env:STAGING_ROLE_REHEARSAL_CONFIRMATION, Env:STAGING_ROLE_REHEARSAL_PROVIDER
```

Only after that evidence passes, set `AUTHENTICATION_ENABLED=false` first and deploy the closed state before removing either account.

The repository includes an owner-only account cleanup command that deletes an approved account, its sessions, identities and account-only profile data. It refuses Administrator accounts and refuses any account that has properties, cleaning requests, media, bookings, payments, messages, reviews, disputes, privacy cases or other marketplace activity. This prevents an account rehearsal cleanup from silently destroying business evidence.

Use the migration-owner **external** staging database URL with verified TLS, never the web or worker role. Supply the approved email through the private prompt so it does not enter shell history:

```powershell
$env:STAGING_ACCOUNT_PURGE_DATABASE_URL = Read-Host "Migration-owner external staging database URL"
$env:STAGING_ACCOUNT_PURGE_REQUEST_ID = [guid]::NewGuid().ToString()
$env:STAGING_ACCOUNT_PURGE_REASON = "Remove the completed non-customer account-only staging rehearsal."
$env:STAGING_ACCOUNT_PURGE_CONFIRMATION = "DELETE APPROVED ACCOUNT-ONLY HOMLE STAGING TEST"
$env:AUTHENTICATION_ENABLED = "false"
$env:MARKETPLACE_ENABLED = "false"
$env:PILOT_INTAKE_ENABLED = "false"
$env:PAYMENTS_ENABLED = "false"
pnpm run purge:staging-account
Remove-Item Env:STAGING_ACCOUNT_PURGE_DATABASE_URL, Env:STAGING_ACCOUNT_PURGE_REQUEST_ID, Env:STAGING_ACCOUNT_PURGE_REASON, Env:STAGING_ACCOUNT_PURGE_CONFIRMATION
```

Keep the printed random cleanup request reference as evidence. A later full booking rehearsal needs its separate media and transaction retention process; this command deliberately refuses that broader case.

This account-only stage intentionally does not require object storage, live booking actions, a worker or Stripe. Those stay closed until their separate readiness checks pass.
