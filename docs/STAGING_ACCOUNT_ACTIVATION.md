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

## 5. Evidence and cleanup

Test one approved Landlord and one approved Cleaner onboarding path. Confirm that a different email cannot create an account, request verification, reset a password or sign in. After the rehearsal, delete synthetic accounts, revoke their sessions and set `AUTHENTICATION_ENABLED=false` until the next controlled test.

This account-only stage intentionally does not require object storage, live booking actions, a worker or Stripe. Those stay closed until their separate readiness checks pass.
