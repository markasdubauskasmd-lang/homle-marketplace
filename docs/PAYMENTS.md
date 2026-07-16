# Marketplace payment boundary

## Status

Tideway now has a detached provider-neutral payment workflow, locked PostgreSQL ledger, an exact-version Stripe **test-mode-only** adapter and a mobile Payment Element checkout for the frozen booking total. Manual capture, cancellation, bounded refunds and Cleaner transfer remain server-owned. The checkout and raw signed-webhook route compose only when the complete marketplace and explicit payment gates attach. This is **not a live payment integration**: there is no approved Stripe account or Connect onboarding route, both flags remain false, and no provider was contacted or payment authorized, captured, refunded or transferred.

The remaining implementation should use Stripe Connect separate charges and transfers only after the founder has an approved marketplace account and confirms the merchant-of-record, refund, cancellation, Cleaner engagement and payout model. Stripe documents that the platform balance is responsible for fees, refunds and chargebacks under this model: <https://docs.stripe.com/connect/separate-charges-and-transfers>.

## Implemented invariants

- The Landlord may start authorization only for their own accepted `confirmed` booking, before journey start, using the exact frozen `customer_price_pence`, `terms_fingerprint` and GBP currency from PostgreSQL.
- The browser cannot provide or change the charge amount, capture amount, Cleaner pay, payout amount or destination account.
- Raw retry keys are SHA-256 hashed before storage. One payment exists per booking; capture, cancellation and transfer each have one live command. Refund commands may repeat only within the captured, unrefunded balance.
- A refreshed or reopened browser resumes the booking's one existing authorization atomically, even with fresh browser retry material. Tideway reuses the stored payment ID and its server-owned provider idempotency key instead of creating a second authorization.
- Capture is administrator-only and permitted only after the booking is `completed`. Cleaner transfer is administrator-only, uses the frozen `cleaner_pay_pence` and requires a provider-verified payout destination with payouts enabled.
- A Landlord may cancel an authorization only while the booking is still confirmed and no journey has begun. Refunds are administrator-only and limited to a captured completed, cancelled or disputed booking.
- Provider IDs and payout destinations are never accepted from browser input. Payment tables, provider event hashes and Cleaner destination IDs have no direct runtime-table access; narrow security-definer functions own every mutation.
- Provider events must be cryptographically verified by the adapter before reconciliation. Tideway stores the provider event ID, allowlisted kind, references, amount/currency, time and SHA-256 payload hash—not the raw payload, card data or client secret. Duplicate events are harmless and stale events cannot roll state backwards.
- The database treats signed provider events as the final authority. Synchronous provider calls only attach a reference and a pending state.
- Stripe Node 22.1.1 is exact-locked and the adapter pins API `2026-03-25.dahlia`, rejects live secret keys and live/wrong-version webhook events, uses manual PaymentIntent capture and transfers only from a captured source charge to the server-owned connected-account destination.
- Webhook verification receives the original bytes unchanged. The public endpoint has a 1 MiB limit, accepts POST only, has no session dependency, is absent while payments are detached and projects only bounded allowlisted fields into reconciliation. Signed events without Tideway metadata are acknowledged and ignored.
- `PAYMENTS_ENABLED` defaults to false. Credentials alone do not attach payments; the complete marketplace database, SMTP, private storage, exact HTTPS origin, monitoring and payment-provider readiness probes must also pass.
- `POST /api/marketplace/bookings/:bookingId/payment` starts or safely resumes authorization only for the authenticated booking Landlord. It requires exact-origin and CSRF checks plus a strong retry key; the amount and booking terms come only from PostgreSQL. A customer-action client secret can appear only in this authenticated mutation response and is never stored.
- `GET /api/marketplace/bookings/:bookingId/payment` returns only the owner-scoped payment reference, booking reference, status, GBP amount and aggregate captured/refunded amounts. It never returns Stripe object IDs, retry-key hashes, payout destinations or a client secret. Both participant routes are absent when the payment service is detached.
- `GET /api/marketplace/payments/config` returns only the test publishable key and `testMode: true` to an authenticated Landlord. Secret and live keys are rejected by configuration. `/booking-payment` first authenticates the role and reads the booking state; only a deliberate prepare/continue action can obtain the short-lived client secret, capability and dynamically load Stripe.js.
- The payment page never persists or logs the client secret, never handles full card data and uses `redirect: "if_required"` without a return URL that could expose secret query parameters. Its route-specific CSP allows only the minimum Stripe script, frame and network origins; the rest of Tideway keeps the stricter default policy.
- Migration 025 requires a current `authorized` payment, matching the booking's Landlord, Cleaner, exact price, GBP currency and frozen terms, before any first transition to en route, arrived or cleaning in progress. Authorizations older than five days fail closed. The Cleaner preflight exposes only readiness and occurs before optional ETA coordinates leave Tideway; the database trigger remains authoritative against direct-arrival or UI bypasses.

## Authorization timing

Manual card authorizations expire. Stripe documents common online authorization windows of roughly five to seven days and requires capture before the hold expires: <https://docs.stripe.com/payments/place-a-hold-on-a-payment-method>. Tideway therefore permits the authorization to begin only during the five days before the clean. A booking made earlier must show “payment opens closer to the visit”; it must not claim funds are held yet. A scheduled job must not start unless the future enabled payment gate proves the required authorization is current.

## Still required before test-mode activation

1. Founder approves Stripe Connect as the provider, the legal merchant/worker model, payment timing, cancellation/refund terms and the handling of chargebacks, re-cleans and failed transfers.
2. Create the approved Stripe test platform and connected Cleaner account; store test keys and the webhook secret in the hosting secret manager.
3. Register the exact webhook route and prove the adapter readiness probe against those test accounts. Stripe requires the unmodified request body for signature verification: <https://docs.stripe.com/webhooks/signature>.
4. Run the mobile Payment Element UI against the approved Stripe test platform on HTTPS, including success, decline, retry, reload, 3-D Secure where applicable, slow connection and webhook-delay cases. Preserve the rule that client secrets may be returned only to the booking Landlord over their authenticated mutation and must never be logged or persisted.
5. Schedule hold-expiry monitoring; reconcile signed events; alert on processing failures, disputes, transfer failures and reversals.
6. Run migrations 022-025 and the full RLS/concurrency harness against PostgreSQL 16, then complete a provider test-mode authorization -> completion -> capture -> Cleaner transfer -> partial/full refund cycle.
7. Keep live mode disabled until the founder explicitly approves it after legal, insurance, public-domain, Cleaner-supply, pricing, privacy and payment-account launch evidence all pass. This source adapter must be separately reviewed before any future live-mode implementation because it intentionally rejects live keys.

The source checkpoint advances E4 but does not satisfy its definition of done. A genuine test-mode provider cycle and real PostgreSQL evidence are still missing.
