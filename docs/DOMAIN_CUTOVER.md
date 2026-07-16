# Domain and HTTPS cutover

The founder plans to purchase the Tideway domain on 17 July 2026. Buying a name is not the same as completing deployment evidence. Keep the website local until the hosting, DNS, TLS and application checks below pass; do not point paid traffic at a placeholder or partially configured marketplace.

## Information to record after purchase

- Exact domain name and registrar.
- Registrar account owner, MFA enabled state, auto-renew decision and recovery method. Keep recovery codes outside the repository.
- Canonical public origin: choose either the apex domain or `www` and redirect the other permanently.
- Approved hosting target and DNS records.
- Where the ownership, DNS and HTTPS verification evidence is stored.
- Verification date and named person responsible for future renewal/certificate checks.

Do not put registrar credentials, transfer codes, DNS API tokens, private keys or provider secrets in Tideway, Git, screenshots or chat.

## Deployment requirements

1. Deploy the reviewed source checkpoint to the approved host without enabling payments or the account marketplace.
2. Point only the purchased hostname to that host. The final hostname must not resolve to loopback, private or reserved addresses.
3. Issue a publicly trusted certificate for the exact canonical hostname. Redirect plain HTTP permanently to the same HTTPS origin; do not redirect through Polsia or another unrelated hostname.
4. Configure the HTTPS proxy/CDN to preserve the request host safely and add `Strict-Transport-Security: max-age=31536000; includeSubDomains` only after HTTPS works on every intended subdomain. The Node application already supplies CSP, framing, MIME, referrer and device-permission policies.
5. Set `APP_ORIGIN` to the exact canonical HTTPS origin with no path or trailing data. Keep `MARKETPLACE_ENABLED=false` until PostgreSQL, the locked driver and every deployment adapter pass staging.
6. Verify the homepage, `/api/health` and `/api/auth/providers` from outside the hosting network. Anonymous access must not create a session cookie, health responses must be non-cacheable, and no authentication provider may be advertised before its real route is attached.

## Automated evidence

Set the purchased origin in the current shell and run the read-only verifier:

```powershell
$env:TIDEWAY_PUBLIC_ORIGIN = "https://your-domain.example"
node tools/domain-readiness.mjs
Remove-Item Env:TIDEWAY_PUBLIC_ORIGIN
```

The command performs no DNS or hosting changes. It requires:

- public IPv4/IPv6 resolution only;
- a publicly trusted certificate with at least 14 days remaining;
- an exact permanent HTTP-to-HTTPS redirect;
- an HTTP 200 HTML homepage;
- CSP, HSTS, MIME, framing, referrer and Permissions Policy headers;
- healthy Tideway integrity with writes allowed;
- `Cache-Control: no-store` on health/authentication discovery;
- role-safe, secret-free authentication capability discovery with Google, Facebook and Apple still closed until their complete provider-specific staging gates pass.

Store the JSON result with the private launch evidence and record a concise hostname/date summary in the control desk. A passing result proves the public-origin boundary only; it does not prove legal identity, insurance, cleaner supply, pricing, payment readiness, PostgreSQL or end-to-end booking fulfilment.

## Social sign-in dependency

Google and Facebook application callback URLs cannot be finalised until the canonical origin passes this check. Their buttons remain hidden until the implemented provider-specific validation, exact callback routes, safe account linking/mailbox verification, staging PostgreSQL tests and deployment-held credentials are complete. Register credentials only in the provider console and deployment secret manager; never paste client secrets into source or the browser.
