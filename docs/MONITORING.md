# Private operational monitoring

Homle must not enable marketplace accounts, workers or payments without private error monitoring and a real operator alert path. The release includes a deployment-owned adapter so this no longer requires writing another module:

```text
MARKETPLACE_ADAPTER_MODULE=homle:monitoring-webhook
MONITORING_WEBHOOK_URL=https://<approved-private-collector>/<event-path>
MONITORING_WEBHOOK_TOKEN=<separate 32-512 character secret>
MONITORING_WEBHOOK_TIMEOUT_MS=5000
```

Store all values in the host's secret manager. The endpoint must use trusted HTTPS and cannot contain credentials, a query string or fragment. The collector must accept an authenticated JSON `POST` using `Authorization: Bearer <token>`. Use a monitoring-only token; never reuse the Administrator, session, authentication, database, SMTP, storage, OAuth or payment secret.

## Privacy boundary

The adapter never sends the raw error message, stack trace, request body, URL, account/customer/Cleaner identifier, email, phone number, address, booking reference, database URL, object key or provider response. Each event contains only:

- a random event ID and timestamp;
- service/environment and fixed `unexpected-error` event type;
- normalized error class and safe machine code when available;
- a SHA-256 fingerprint derived from the private error class/message;
- allowlisted component, operation and worker-job labels;
- a bounded consecutive-failure counter when supplied.

The fingerprint helps group repeated failures but is not reversible evidence and must still be treated as private operational data. Apply access control and a documented retention period at the collector.

## Delivery behavior

- Delivery follows no redirect and times out after 1-10 seconds (5 seconds by default).
- At most 25 events are in flight by default; overload drops later events and emits one content-free local fallback marker.
- A rejected/failed delivery emits only `monitoring-delivery-failed`, the service name and random event ID to the host log. It never prints the endpoint, token or original error.
- Web and worker shutdown stop accepting new events and wait for bounded in-flight deliveries before closing.
- The adapter sends no startup event and remains completely inert while marketplace/workers are disabled.

## Staging proof before activation

1. Select and approve the private collector and alert owner; document retention and access.
2. Configure the endpoint/token only in managed staging.
3. Run the production and authentication preflights without printing secrets.
4. Trigger one synthetic, non-customer failure through a test-only staging fixture.
5. Confirm the collector receives exactly the privacy-minimal schema above and the responsible operator receives an alert.
6. Simulate collector timeout/rejection and confirm the application remains safe while the content-free fallback marker appears.
7. Remove synthetic events and rotate the staging token if it appeared in any setup screen capture.

Passing this check proves only error transport and alert ownership. It does not prove database, email, storage, OAuth, payments or end-to-end booking readiness. No monitoring provider was contacted during source implementation.
