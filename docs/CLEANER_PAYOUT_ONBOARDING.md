# Cleaner payout onboarding

## Status

Tideway now has a one-action, mobile-first Cleaner payout setup path at `/cleaner/payouts`. It is part of the existing default-off, Stripe test-mode-only payment boundary. No Stripe account was created, no provider was contacted, no permissions were changed and no money moved while this was implemented.

The flow is deliberately short:

1. The signed-in Cleaner selects **Set up payouts**.
2. Tideway creates or safely reuses one server-owned Stripe test connected-account reference.
3. The Cleaner is redirected only to `https://connect.stripe.com` to provide verification and bank details directly to Stripe.
4. Stripe returns the Cleaner to Tideway over HTTPS.
5. Tideway retrieves the provider status and shows either **Payouts are ready** or one **Finish payout setup** action.

Stripe documents that hosted Account Links are single-use, account-specific URLs and should be shown only to the authenticated account holder inside the platform. Stripe also requires HTTPS return and refresh URLs and warns that returning from onboarding does not itself prove requirements are complete. Tideway therefore retrieves the connected account after return instead of trusting the redirect. See [Stripe-hosted marketplace onboarding](https://docs.stripe.com/connect/marketplace/tasks/onboard) and [Account Link creation](https://docs.stripe.com/api/account_links/create).

## Security and privacy boundary

- Cleaner and CSRF authorization are enforced by the server for every setup or refresh mutation.
- The browser cannot submit a Stripe account ID, payout-readiness flag, bank detail or destination.
- One private database row establishes a stable retry reference before Stripe account creation. Provider creation uses that server-owned reference as its idempotency key, preventing ordinary lost-response retries from creating another account.
- The Stripe account ID is stored only in the private schema. Cleaner-facing status returns readiness booleans and outstanding-requirement count only. The short-lived provider link is returned only by the authenticated setup mutation.
- Direct application and worker access to both private payout tables is revoked. Narrow actor-bound functions own start, attach and status synchronization.
- Conflicting account attachment is rejected and important state changes are audited without storing identity or bank data.
- The Stripe adapter accepts test keys only, and payment mode requires an exact HTTPS `APP_ORIGIN` even in staging.
- The frontend rechecks that the next page is exactly on `https://connect.stripe.com` before navigating.
- A refreshed or expired provider link returns through an authenticated Tideway route that generates a new single-use link.

## Activation gate

The code is ready for an approved test environment, not for live payouts. Before making the control visible to genuine Cleaners:

1. The founder approves Stripe Connect, merchant-of-record responsibilities, Cleaner engagement status, payout timing, fees, tax handling, refunds, chargebacks, disputes and failed-transfer procedures.
2. Create the approved Stripe test platform and configure its hosted onboarding branding and terms.
3. Apply all locked migrations and grants to managed PostgreSQL staging.
4. Configure only test keys in the hosting secret manager and register the exact HTTPS return, refresh and webhook routes.
5. Complete one two-account HTTPS rehearsal: Cleaner onboarding, Landlord authorization, job completion, capture, Cleaner transfer, cancellation and refund.
6. Confirm that payout status changes and transfer failures are monitored and that support ownership is documented.

Live keys remain rejected by source. Enabling live payouts requires a separately reviewed implementation and explicit founder approval.
