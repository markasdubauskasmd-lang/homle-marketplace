# Managed staging marketplace activation

This check proves that Homle can compose its booking marketplace and Stripe test-payment boundary before any customer-facing switch is enabled. It is a configuration and connectivity probe only: it does not create a property, booking, payment, customer, transfer or charge.

Run it only against the isolated managed staging database after transactional email, private object storage, monitoring, account authentication and Stripe test credentials are configured:

```powershell
$env:HOMLE_STAGING_SERVICE_PROBE_CONFIRMATION = "PROBE HOMLE MANAGED STAGING BOOKINGS AND TEST PAYMENTS"
pnpm run preflight:staging-activation
```

The probe fails closed unless `MARKETPLACE_ENABLED=true`, `PAYMENTS_ENABLED=true`, the database is a non-production managed staging database, email verification and password recovery are operational, private media storage is attached, and Stripe keys are test-mode keys with a configured webhook secret.

A successful result is not launch approval. The local PostgreSQL integration runner now provides a disposable two-account lifecycle proof through invitation acceptance, consented journey, arrival, cleaning, completion, review approval and Cleaner response. It uses a synthetic local payment-ledger prerequisite and deliberately contacts no provider.

The remaining launch evidence is a managed two-account mobile rehearsal: create a staging Landlord and Cleaner, verify both role-specific dashboards on separate phones, upload and remove room media, accept one booking, complete a genuine Stripe test authorization/capture/refund cycle, finish the cleaning checklist, submit one review, then purge both accounts and all synthetic records. This provider-backed rehearsal must not be replaced by the local ledger fixture.

Google and Facebook callback URLs must exactly match the current `APP_ORIGIN`. When the custom domain replaces the Render preview address, update the provider consoles and `APP_ORIGIN` together before testing again.
