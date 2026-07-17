# Managed staging marketplace activation

This check proves that Homle can compose its booking marketplace and Stripe test-payment boundary before any customer-facing switch is enabled. It is a configuration and connectivity probe only: it does not create a property, booking, payment, customer, transfer or charge.

Run it only against the isolated managed staging database after transactional email, private object storage, monitoring, account authentication and Stripe test credentials are configured:

```powershell
$env:HOMLE_STAGING_SERVICE_PROBE_CONFIRMATION = "PROBE HOMLE MANAGED STAGING BOOKINGS AND TEST PAYMENTS"
pnpm run preflight:staging-activation
```

The probe fails closed unless `MARKETPLACE_ENABLED=true`, `PAYMENTS_ENABLED=true`, the database is a non-production managed staging database, email verification and password recovery are operational, private media storage is attached, and Stripe keys are test-mode keys with a configured webhook secret.

A successful result is not launch approval. The next evidence is a two-account mobile rehearsal: create a synthetic Landlord and Cleaner, upload and remove room media, accept one synthetic booking, complete a Stripe test authorization/capture/refund cycle, finish the cleaning checklist, submit one review, then purge both accounts and all synthetic records.

Google and Facebook callback URLs must exactly match the current `APP_ORIGIN`. When the custom domain replaces the Render preview address, update the provider consoles and `APP_ORIGIN` together before testing again.
