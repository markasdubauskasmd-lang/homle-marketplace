# Marketplace payment boundary

## Status

Tideway now has a detached provider-neutral payment workflow, locked PostgreSQL ledger and an exact-version Stripe **test-mode-only** adapter for the frozen booking total, manual capture, cancellation, bounded refunds and Cleaner transfer. A raw signed-webhook route is composed only when the complete marketplace and explicit payment gates attach. It is **not a live payment integration**. There is no Stripe account, Payment Element, Connect onboarding route or public payment control in this checkpoint. No provider was contacted and no payment was authorized, captured, refunded or transferred.

The remaining implementation should use Stripe Connect separate charges and transfers only after the founder has an approved marketplace account and confirms the merchant-of-record, refund, cancellation, Cleaner engagement and payout model. Stripe documents that the platform balance is responsible for fees, refunds and chargebacks under this model: <https://docs.stripe.com/connect/separate-charges-and-transfers>.

## Implemented invariants

- The Landlord may start authorization only for their own accepted `confirmed` booking, before journey start, using the exact frozen `customer_price_pence`, `terms_fingerprint` and GBP currency from PostgreSQL.
- The browser cannot provide or change the charge amount, capture amount, Cleaner pay, payout amount or destination account.
- Raw retry keys are SHA-256 hashed before storage. One payment exists per booking; capture, cancellation and transfer each have one live command. Refund commands may repeat only within the captured, unrefunded balance.
- Capture is administrator-only and permitted only after the booking is `completed`. Cleaner transfer is administrator-only, uses the frozen `cleaner_pay_pence` and requires a provider-verified payout destination with payouts enabled.
- A Landlord may cancel an authorization only while the booking is still confirmed and no journey has begun. Refunds are administrator-only and limited to a captured completed, cancelled or disputed booking.
- Provider IDs and payout destinations are never accepted from browser input. Payment tables, provider event hashes and Cleaner destination IDs have no direct runtime-table access; narrow security-definer functions own every mutation.
- Provider events must be cryptographically verified by the adapter before reconciliation. Tideway stores the provider event ID, allowlisted kind, references, amount/currency, time and SHA-256 payload hash—not the raw payload, card data or client secret. Duplicate events are harmless and stale events cannot roll state backwards.
- The database treats signed provider events as the final authority. Synchronous provider calls only attach a reference and a pending state.
- Stripe Node 22.1.1 is exact-locked and the adapter pins API `2026-03-25.dahlia`, rejects live secret keys and live/wrong-version webhook events, uses manual PaymentIntent capture and transfers only from a captured source charge to the server-owned connected-account destination.
- Webhook verification receives the original bytes unchanged. The public endpoint has a 1 MiB limit, accepts POST only, has no session dependency, is absent while payments are detached and projects only bounded allowlisted fields into reconciliation. Signed events without Tideway metadata are acknowledged and ignored.
- `PAYMENTS_ENABLED` defaults to false. Credentials alone do not attach payments; the complete marketplace database, SMTP, private storage, exact HTTPS origin, monitoring and payment-provider readiness probes must also pass.

## Authorization timing

Manual card authorizations expire. Stripe documents common online authorization windows of roughly five to seven days and requires capture before the hold expires: <https://docs.stripe.com/payments/place-a-hold-on-a-payment-method>. Tideway therefore permits the authorization to begin only during the five days before the clean. A booking made earlier must show “payment opens closer to the visit”; it must not claim funds are held yet. A scheduled job must not start unless the future enabled payment gate proves the required authorization is current.

## Still required before test-mode activation

1. Founder approves Stripe Connect as the provider, the legal merchant/worker model, payment timing, cancellation/refund terms and the handling of chargebacks, re-cleans and failed transfers.
2. Create the approved Stripe test platform and connected Cleaner account; store test keys and the webhook secret in the hosting secret manager.
3. Register the exact webhook route and prove the adapter readiness probe against those test accounts. Stripe requires the unmodified request body for signature verification: <https://docs.stripe.com/webhooks/signature>.
4. Add participant-authorized authorization/status routes and mobile Payment Element UI. Client secrets may be returned only to the booking Landlord over their authenticated session and must never be logged or persisted.
5. Connect authorization readiness to booking/journey gates; schedule hold-expiry monitoring; reconcile signed events; alert on processing failures, disputes, transfer failures and reversals.
6. Run migration 022 and the full RLS/concurrency harness against PostgreSQL 16, then complete a provider test-mode authorization -> completion -> capture -> Cleaner transfer -> partial/full refund cycle.
7. Keep live mode disabled until the founder explicitly approves it after legal, insurance, public-domain, Cleaner-supply, pricing, privacy and payment-account launch evidence all pass. This source adapter must be separately reviewed before any future live-mode implementation because it intentionally rejects live keys.

The source checkpoint advances E4 but does not satisfy its definition of done. A genuine test-mode provider cycle and real PostgreSQL evidence are still missing.
