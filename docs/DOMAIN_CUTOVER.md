# Domain and HTTPS cutover

The Homle domain is now in use. Owning and pointing a name is not the same as completing deployment evidence. Keep account and payment activation closed until the hosting, DNS, TLS and application checks below pass; do not point paid traffic at a partially configured marketplace.

## Information to record after purchase

- Exact domain name and registrar.
- Registrar account owner, MFA enabled state, auto-renew decision and recovery method. Keep recovery codes outside the repository.
- Canonical public origin: use the apex `https://homle.co.uk`; the production app redirects safe `www` reads to it permanently.
- Approved hosting target and DNS records.
- Where the ownership, DNS and HTTPS verification evidence is stored.
- Verification date and named person responsible for future renewal/certificate checks.

Do not put registrar credentials, transfer codes, DNS API tokens, private keys or provider secrets in Tideway, Git, screenshots or chat.

## Deployment requirements

1. Deploy the reviewed source checkpoint to the approved host without enabling payments or the account marketplace. The prepared host-neutral container may be used only after its Linux build, native dependency load, resolved digest and image vulnerability scan are recorded as described in `PRODUCTION_DEPLOYMENT.md`.
2. Point only the purchased hostname to that host. The final hostname must not resolve to loopback, private or reserved addresses.
3. Issue a publicly trusted certificate for the exact canonical hostname. Redirect plain HTTP permanently to the same HTTPS origin; do not redirect through Polsia or another unrelated hostname.
4. Configure the HTTPS proxy/CDN to preserve the request host safely and add `Strict-Transport-Security: max-age=31536000; includeSubDomains` only after HTTPS works on every intended subdomain. The Node application already supplies CSP, framing, MIME, referrer and device-permission policies. In production it also returns a path-and-query-preserving 308 for `GET`/`HEAD` requests whose host is exactly `www.` plus the configured `APP_ORIGIN` hostname; it never redirects mutations.
5. Set `APP_ORIGIN` to the exact canonical HTTPS origin with no path or trailing data. Keep `MARKETPLACE_ENABLED=false` until PostgreSQL, the locked driver and every deployment adapter pass staging.
6. Run `pnpm run preflight:production`. The server repeats this check before listening and refuses a public process without the protected Administrator key, private off-source data directory, exact HTTPS origin and reviewed trusted-proxy boundary. See `PRODUCTION_DEPLOYMENT.md`.
7. Verify the homepage, `/api/health` and `/api/auth/providers` from outside the hosting network. Anonymous access must not create a session cookie, health responses must be non-cacheable, and no authentication provider may be advertised before its real route is attached. The private `/admin` shell must return a JSON 401 to an anonymous request, and the local tracking lab must return JSON 404 responses throughout production.

## Automated evidence

Set the purchased origin in the current shell and run the read-only verifier:

```powershell
$env:TIDEWAY_PUBLIC_ORIGIN = "https://your-domain.example"
$env:TIDEWAY_EXPECT_RELEASE = "1234abcd" # exact sourceCommit from the prepared release manifest
node tools/domain-readiness.mjs
$env:TIDEWAY_EXPECT_RELEASE = $null
Remove-Item Env:TIDEWAY_PUBLIC_ORIGIN
```

The first run deliberately expects Google and Facebook to be closed. After PostgreSQL, SMTP, HTTPS and the deployment-held provider credentials pass staging, state exactly which social providers should be live and run the same verifier again:

```powershell
$env:TIDEWAY_PUBLIC_ORIGIN = "https://your-domain.example"
$env:TIDEWAY_EXPECT_RELEASE = "1234abcd"
$env:TIDEWAY_EXPECT_SOCIAL_PROVIDERS = "google,facebook"
node tools/domain-readiness.mjs
Remove-Item Env:TIDEWAY_EXPECT_SOCIAL_PROVIDERS
$env:TIDEWAY_EXPECT_RELEASE = $null
Remove-Item Env:TIDEWAY_PUBLIC_ORIGIN
```

Use `google` alone if Facebook has not completed its operational review. The expectation accepts only `google` and `facebook`, rejects duplicates and never accepts Apple because Apple sign-in has not been implemented. Do not set an expected provider merely to make the report pass: the value must describe the provider buttons intentionally approved for that deployment.

The command performs no DNS or hosting changes. It requires:

- public IPv4/IPv6 resolution only;
- a publicly trusted certificate with at least 14 days remaining;
- an exact permanent HTTP-to-HTTPS redirect;
- an HTTP 200 HTML homepage;
- CSP, HSTS, MIME, framing, referrer and Permissions Policy headers;
- healthy Tideway integrity with writes allowed;
- the exact eight-character packaged source commit and migration count embedded by the verified release builder, optionally matched to `TIDEWAY_EXPECT_RELEASE` from the private manifest;
- an explicit `localDemosEnabled: false` production-health signal;
- `Cache-Control: no-store` on health/authentication discovery;
- a read-only anonymous request to `/admin` that returns JSON 401 with `Cache-Control: no-store`, no redirect and no cookie;
- read-only requests to `/tracking-test`, `/tracking-test.html`, `/tracking-test.js` and `/api/tracking-test/snapshot` that each return JSON 404 with `Cache-Control: no-store`, no redirect and no cookie;
- role-safe, secret-free authentication capability discovery matching the exact expected Google/Facebook state while keeping Apple closed;
- a manual, non-following request to each Google/Facebook start route: disabled providers must return 404 without a cookie or redirect, while enabled providers must return the exact external HTTPS provider route, canonical Tideway callback, secure host-only flow cookie and `Cache-Control: no-store`.

The verifier never follows an application or Google/Facebook redirect, sends an Administrator key, starts a tracking session, exchanges an authorization code, creates an account or contacts the provider. It uses GET requests for the private/local-surface probes and reports only pass/fail evidence rather than response bodies, client IDs, state values, cookies or redirect URLs. The exposed release identity contains only the packaged source commit, build time and migration count—never a repository URL, branch, credential or private path.

Store the JSON result with the private launch evidence and record a concise hostname/date summary in the control desk. A passing result proves the public-origin boundary only; it does not prove legal identity, insurance, cleaner supply, pricing, payment readiness, PostgreSQL or end-to-end booking fulfilment.

## Social sign-in dependency

Google and Facebook application callback URLs cannot be finalised until the canonical origin passes this check. Their buttons remain hidden until the implemented provider-specific validation, exact callback routes, safe account linking/mailbox verification, staging PostgreSQL tests and deployment-held credentials are complete. Register credentials only in the provider console and deployment secret manager; never paste client secrets into source or the browser.
