# SMTP email delivery

## Prepared boundary

`src/marketplace/smtp-email-delivery.mjs` is Tideway's internal text-only SMTP adapter for:

- account verification;
- password reset; and
- privacy-minimal booking notifications produced by the existing outbox worker.

The main marketplace attachment creates this adapter internally only after `MARKETPLACE_ENABLED=true`, verifies the SMTP connection after the restricted PostgreSQL probe succeeds, and closes the transport on failed startup or shutdown. The local pilot does not import Nodemailer dynamically, connect to SMTP or send mail while the marketplace flag is false.

This is source and isolated dependency evidence, not a verified mail-provider deployment. No SMTP account was contacted and no message was sent for this checkpoint.

## Transport controls

- Exact Nodemailer `9.0.3` is locked by package integrity and full lockfile SHA-256. Its reviewed lock entry has no transitive dependency.
- Only credentialed `smtp://` or `smtps://` URLs with a DNS hostname are accepted.
- URL paths, query options and fragments are rejected, preventing configuration such as `tls.rejectUnauthorized=false` from entering through the connection string.
- TLS certificate validation, TLS 1.2 minimum and the exact SMTP server name are forced. Port 587 requires STARTTLS; port 465 uses TLS immediately.
- Connection, greeting and socket timeouts are bounded. Pool size, messages per connection and send rate are bounded.
- Nodemailer file access, URL access, debug logging and transport logging are disabled.
- Sender, recipient, subject and text fields reject header controls; authentication links must use the exact configured `APP_ORIGIN`, expected path and a fragment token.
- Authentication and notification mail is text only. No address, access instructions, photo, live location, HTML, attachment, tracking pixel or third-party content is added.
- Provider failures reach only the approved private monitoring hook. Callers receive a generic error and bounded code without the provider message or credentials.

Each logical message receives a stable SHA-256-derived `Message-ID` and `X-Tideway-Delivery-Id` across retries. Standard SMTP does not guarantee provider-side idempotency, so a timeout after provider acceptance can still create a duplicate. Treat the outbox as at-least-once delivery and prove the selected provider's duplicate behavior in staging; use a provider API with a genuine idempotency key later if this is not acceptable.

## Secret configuration

Keep these values in the deployment secret manager:

```dotenv
SMTP_URL=smtps://encoded-user:encoded-password@smtp.provider.example:465
EMAIL_FROM=Tideway <no-reply@your-domain.example>
APP_ORIGIN=https://your-domain.example
```

Percent-encode reserved characters in the SMTP username and password. Never put real credentials in `.env.example`, Git, browser code, support messages, screenshots or analytics.

## Staging evidence required

1. Configure a dedicated transactional sender on the approved Tideway domain; verify SPF, DKIM and DMARC with the provider's current authoritative instructions.
2. Confirm startup fails closed for bad credentials, hostname/certificate mismatch, TLS downgrade and unreachable SMTP.
3. Deliver verification and reset messages only to reserved staging accounts; confirm the exact HTTPS link, expiry copy, sender alignment and no token in server/proxy logs.
4. Exercise a temporary recipient failure, permanent recipient rejection and a simulated accepted-then-timeout retry. Confirm outbox state and duplicate behavior.
5. Confirm booking notifications contain no property address, access detail, contact detail, photo, live location or user-written message body.
6. Configure bounce/complaint handling and suppression before real customer intake. The generic SMTP adapter does not ingest provider webhooks.
7. Record retention, processor terms, region, breach route, sending limits and monitoring ownership in launch control.

Do not enable account capability flags until SMTP, PostgreSQL, HTTPS and browser flows pass together.
