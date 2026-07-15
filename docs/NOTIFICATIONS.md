# Account notifications and email outbox

Tideway now has a source-complete notification boundary for authenticated marketplace accounts. It is not enabled on the current local pilot because the account runtime still has no staging PostgreSQL database or approved transactional-email account.

## In-app inbox

The web runtime exposes three authenticated routes:

- `GET /api/marketplace/notifications` returns only the current account's in-app notifications, an exact unread count and bounded tuple-cursor pagination.
- `POST /api/marketplace/notifications/:notificationId/read` marks one notification owned by the current account as read.
- `POST /api/marketplace/notifications/read-all` marks notifications at or before a supplied cutoff as read. If the browser omits the cutoff, the service freezes the server time before the database call so notifications arriving concurrently are not accidentally consumed.

Mutation routes require the existing exact-origin and CSRF checks. Database functions independently derive the account from transaction-local identity. A foreign notification therefore returns the same not-found result as a missing one. The runtime role cannot select or mutate `notifications` directly.

Inbox payloads are allowlisted twice, in PostgreSQL and in the service. Only booking/task/photo/message IDs, response deadline, matching-reopened flag, task decision, sender role and durable event ID can leave this boundary. Names, email addresses, phone numbers, property/access details, message bodies, photos and current location cannot enter the projection.

## Email outbox

Migration `017_notification_inbox_and_outbox.sql` creates an email outbox row automatically after supported in-app lifecycle events. The derived row uses a channel-prefixed unique key, so transaction retries cannot create duplicate email work.

Supported events cover invitation, response, confirmation, journey start/nearby/arrival, cleaning start/pause/resume/progress, issues and photos, unexpected-task decisions, completion/review and booking messages. Email rows contain only the minimal allowlisted payload and never copy a message body, address, access instructions, contact details, photo data or coordinates.

A separately credentialed `tideway_worker` claims due rows with `FOR UPDATE SKIP LOCKED`, a UUID lease and a bounded batch. Delivery attempts:

- use the notification UUID as the provider idempotency key;
- succeed only when the worker still owns a live lease;
- retry transient failures with bounded exponential backoff;
- stop after five attempts or a declared permanent failure;
- sanitize stored error codes and never return recipient details in run statistics;
- permanently close rows for inactive accounts or unverified email addresses before delivery.

`createEmailNotificationWorker` produces text-only privacy-minimal mail with a trusted HTTPS application origin. It does not accept an insecure public origin. The adapter passed to `delivery.send` must support the supplied `idempotencyKey`; otherwise a provider timeout after accepting a message can still cause an at-least-once duplicate on retry.

## Deployment boundary

1. Apply migrations through `017_notification_inbox_and_outbox.sql` using the migration owner.
2. Reapply `db/runtime-role-grants.sql` and `db/worker-role-grants.sql` after the functions exist.
3. Give the web process only the `tideway_app` database identity.
4. Give the email worker a separate pool authenticated only as `tideway_worker`; it receives execute rights on claim/complete functions and no direct table rights.
5. Configure `APP_ORIGIN` with the verified HTTPS host and keep `SMTP_URL`, `EMAIL_FROM` and provider credentials in the deployment secret manager.
6. Compose the provider adapter, run one worker instance in staging, and prove provider idempotency, retry classification, lease expiry, inactive/unverified-recipient suppression and no-address/no-location email content.
7. Monitor pending age, retry count and permanent-failure rate without logging recipient addresses or payloads.

No email worker is scheduled locally, no SMTP provider was called and no participant was contacted by this change.

## Verification

Run:

```powershell
node tests/notification-service.mjs
node tests/marketplace-http.mjs
```

The tests cover actor binding, cursor validation, read cutoffs, foreign/missing isolation, double payload redaction, worker leases, stable provider idempotency, transient retry, permanent failure, bounded error evidence, narrow grants and runtime composition.
