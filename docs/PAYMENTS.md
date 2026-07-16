# Marketplace payment boundary

## Status

Tideway now has a detached provider-neutral payment workflow and locked PostgreSQL ledger for the frozen booking total, later capture, cancellation, bounded refunds and Cleaner transfer. It is **not a live payment integration**. There is no Stripe account, SDK adapter, webhook route, Payment Element, Connect onboarding route or public payment capability in this checkpoint. No provider was contacted and no payment was authorized, captured, refunded or transferred.

The remaining implementation should use Stripe Connect separate charges and transfers only after the founder has an approved marketplace account and confirms the merchant-of-record, refund, cancellation, Cleaner engagement and payout model. Stripe documents that the platform balance is responsible for fees, refunds and chargebacks under this model: <https://docs.stripe.com/connect/separate-charges-and-transfers>.

## Implemented invariants

- The Landlord may start authorization only for their own accepted `confirmed` booking, before journey start, using the exact frozen `customer_price_pence`, `terms_fingerprint` and GBP currency from PostgreSQL.
- The browser cannot provide or change the charge amount, capture amount, Cleaner pay, payout amount or destination account.
- Raw retry keys are SHA-256 hashed before storage. One payment exists per booking; capture, cancellation and transfer each have one live command. Refund commands may repeat only within the captured, unrefunded balance.
- Capture is administrator-only and permitted only after the booking is `completed`. Cleaner transfer is administrator-only, uses the frozen `cleaner_pay_pence` and requires a provider-verified payout destination with payouts enabled.
- A Landlord may cancel an authorization only while the booking is still confirmed and no journey has begun. Refunds are administrator-only and limited to a captured completed, cancelled or disputed booking.
- Provider IDs and payout destinations are never accepted from browser input. Payment tables, provider event hashes and Cleaner destination IDs have no direct runtime-table access; narrow security-definer functions own every mutation.
- Provider events must be cryptographically verified by the future adapter before reconciliation. Tideway stores the provider event ID, allowlisted kind, references, amount/currency, time and SHA-256 payload hash—not the raw payload, card data or client secret. Duplicate events are harmless and stale events cannot roll state backwards.
- The database treats signed provider events as the final authority. Synchronous provider calls only attach a reference and a pending state.

## Authorization timing

Manual card authorizations expire. Stripe documents common online authorization windows of roughly five to seven days and requires capture before the hold expires: <https://docs.stripe.com/payments/place-a-hold-on-a-payment-method>. Tideway therefore permits the authorization to begin only during the five days before the clean. A booking made earlier must show “payment opens closer to the visit”; it must not claim funds are held yet. A scheduled job must not start unless the future enabled payment gate proves the required authorization is current.

## Still required before test-mode activation

1. Founder approves Stripe Connect as the provider, the legal merchant/worker model, payment timing, cancellation/refund terms and the handling of chargebacks, re-cleans and failed transfers.
2. Create the approved Stripe platform and test connected Cleaner account; store test keys and the webhook secret in the hosting secret manager.
3. Add and version-lock the official server SDK. Implement an adapter for PaymentIntent manual authorization, capture/cancel, Refund, Transfer and raw-body webhook signature verification. Stripe requires the unmodified request body for signature verification: <https://docs.stripe.com/webhooks/signature>.
4. Add a default-off `PAYMENTS_ENABLED` composition gate that also requires PostgreSQL, HTTPS, webhook readiness, test-mode keys, approved connected-account state and an explicit non-live approval. Credentials alone must not expose payment controls.
5. Add participant-authorized HTTP routes and mobile Payment Element UI. Client secrets may be returned only to the booking Landlord over their authenticated session and must never be logged or persisted.
6. Connect authorization readiness to booking/journey gates; schedule hold-expiry monitoring; reconcile signed events; alert on processing failures, disputes, transfer failures and reversals.
7. Run migration 022 and the full RLS/concurrency harness against PostgreSQL 16, then complete a provider test-mode authorization → completion → capture → Cleaner transfer → partial/full refund cycle.
8. Keep live mode disabled until the founder explicitly approves it after legal, insurance, public-domain, Cleaner-supply, pricing, privacy and payment-account launch evidence all pass.

The source checkpoint advances E4 but does not satisfy its definition of done. A genuine test-mode provider cycle and real PostgreSQL evidence are still missing.
