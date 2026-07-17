# Account notifications and email outbox

Homle now has a source-complete notification boundary for authenticated marketplace accounts. Stable internal database and environment identifiers still use `tideway`. The separate worker process can schedule email, but `WORKER_EMAIL_ENABLED` remains false because there is no approved transactional-email account or managed staging evidence.

## In-app inbox

The mobile-first `/notifications` page is linked from both the Landlord and Cleaner workspaces. It shows concise booking updates, unread state and one valid booking action per item. It includes signed-out, loading, empty, pagination, offline, retry and success states. Unknown future event types fall back to neutral booking copy rather than exposing raw event data.

Both role dashboards show a compact unread count beside **Updates**. It requests only the count from the account-bound inbox, caps the visual label at `99+`, retries after a browser back/forward restore or a later visible-tab return, and uses no constant polling. An unavailable or signed-out inbox leaves the navigation usable without inventing a count or blocking the dashboard.

The browser renders only with DOM `textContent`, validates every booking identifier before creating a link and uses the current role only to select the return workspace. Opening an unread update sends a navigation-safe, CSRF-protected read mutation. **Mark all read** supplies the timestamp captured before the inbox load, then reloads the authoritative page so an update arriving concurrently remains visible and unread.

The web runtime exposes three authenticated routes:

- `GET /api/marketplace/notifications` returns only the current account's in-app notifications, an exact unread count and bounded tuple-cursor pagination.
- `POST /api/marketplace/notifications/:notificationId/read` marks one notification owned by the current account as read.
- `POST /api/marketplace/notifications/read-all` marks notifications at or before a supplied cutoff as read. If the browser omits the cutoff, the service freezes the server time before the database call so notifications arriving concurrently are not accidentally consumed.

Mutation routes require the existing exact-origin and CSRF checks. Database functions independently derive the account from transaction-local identity. A foreign notification therefore returns the same not-found result as a missing one. The runtime role cannot select or mutate `notifications` directly.

Inbox payloads are allowlisted twice, in PostgreSQL and in the service. Only booking/task/photo/message/case IDs, response deadline, matching-reopened flag, task decision, sender role, durable event ID and bounded case status/outcome can leave this boundary. Case descriptions and resolution notes, names, email addresses, phone numbers, property/access details, message bodies, photos and current location cannot enter the projection.

## Email outbox

Migration `017_notification_inbox_and_outbox.sql` creates an email outbox row automatically after supported in-app lifecycle events. The derived row uses a channel-prefixed unique key, so transaction retries cannot create duplicate email work.

Supported events cover invitation, response, confirmation, payment timing, a payment-ready confirmed-visit reminder, the Cleaner's payment-ready journey prompt, journey start/nearby/arrival, cleaning start/pause/resume/progress, issues and photos, unexpected-task decisions, completion/review, booking messages and the opened/reviewing/resolved private booking-case lifecycle. Migration 044 queues the visit reminder once per participant and exact schedule only inside 24 hours, then a separate Cleaner-only prompt inside two hours; both require the exact authorization to remain valid at the scheduled start. Email rows contain only the minimal allowlisted payload and never copy a case description, resolution note, message body, address, access instructions, contact details, payment detail, photo data or coordinates. The worker's executable copy map is regression-checked against the latest database email allowlist so a newly queued event cannot silently become a permanent delivery failure.

A separately credentialed `tideway_worker` claims due rows with `FOR UPDATE SKIP LOCKED`, a UUID lease and a bounded batch. Delivery attempts:

- use the notification UUID as the provider idempotency key;
- succeed only when the worker still owns a live lease;
- retry transient failures with bounded exponential backoff;
- stop after five attempts or a declared permanent failure;
- sanitize stored error codes and never return recipient details in run statistics;
- permanently close rows for inactive accounts or unverified email addresses before delivery.

`createEmailNotificationWorker` produces text-only privacy-minimal mail with a trusted HTTPS application origin. Each message contains one exact same-origin action: a new invitation opens the Cleaner dashboard containing Accept/Decline; a decline or expired invitation opens the relevant role workspace; active booking, journey, progress, message, review and case events open `/bookings/{bookingId}`. Every mapping starts from a validated opaque booking UUID, and a malformed ID produces no in-app action. Links have no query, fragment, tracking token, property detail or participant contact data; destination routes still perform server-side account or participant authorization. The worker does not accept an insecure public origin. The internal [SMTP adapter](SMTP_EMAIL_DELIVERY.md) converts the supplied `idempotencyKey` into a stable Message-ID and delivery header. Standard SMTP does not guarantee provider-side idempotency, so a provider timeout after accepting a message can still cause an at-least-once duplicate on retry; this must be measured with the chosen provider.

## Deployment boundary

1. Apply every locked migration through the current migration lock using the migration owner. Migration 017 creates the outbox, migration 033 extends it for private booking-case events and migration 044 adds the payment-ready visit schedule.
2. Reapply `db/runtime-role-grants.sql` and `db/worker-role-grants.sql` after the functions exist.
3. Give the web process only the `tideway_app` database identity.
4. Give the separate [worker process](WORKER_OPERATIONS.md) a pool authenticated only as `tideway_worker`; it receives execute rights on claim/complete functions and no direct table rights.
5. Configure `APP_ORIGIN` with the verified HTTPS host and keep `SMTP_URL`, `EMAIL_FROM` and provider credentials in the deployment secret manager.
6. Run the internal SMTP adapter and one worker instance in staging, and prove provider duplicate behavior, retry classification, lease expiry, inactive/unverified-recipient suppression and no-address/no-location email content.
7. Monitor pending age, retry count and permanent-failure rate without logging recipient addresses or payloads.

The scheduler and restricted database-only jobs pass locally, but email scheduling remains capability-disabled. No SMTP provider was called and no participant was contacted by this change.

## Verification

Run:

```powershell
node tests/notification-service.mjs
node tests/notification-inbox-ui.mjs
node tests/marketplace-http.mjs
```

The tests cover actor binding, cursor validation, read cutoffs, foreign/missing isolation, double payload redaction, safe case-state projection, safe route construction and rendering, role return, mobile states, exact database-to-worker event parity, worker leases, stable provider idempotency, transient retry, permanent failure, bounded error evidence, narrow grants and runtime composition.
