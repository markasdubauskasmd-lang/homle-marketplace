# Hosted participant booking rehearsal

This is the evidence check for one real hosted Homle rehearsal performed by two founder-approved test accounts: one Landlord and one Cleaner. It verifies the recorded lifecycle without changing a booking, payment, account or marketplace setting.

## Safety boundary

- Use private test accounts only. Never use a customer or working Cleaner account.
- Use Stripe test mode only. The verifier rejects every non-test secret key.
- Use the migration-owner external URL for the private staging database. The verifier rejects the web/worker role, a non-staging database, and a remote connection without `sslmode=verify-full`.
- The database transaction is `REPEATABLE READ READ ONLY`; the result contains no email address, account ID or booking UUID.
- The verifier does not clean up records. Cleanup remains a separate, deliberate owner action after evidence has been reviewed.

## What must happen first

Complete the Administrator launch-desk rehearsal on two devices. The selected booking must prove:

1. approved and verified Landlord and Cleaner accounts with their separate role profiles;
2. request match, Cleaner acceptance and confirmation;
3. journey start, live location, arrival and automatic location stop;
4. cleaning start, resolved checklist updates, before/after photos and completion;
5. two-way booking messages and the participant real-time events;
6. exactly one Landlord review;
7. Stripe test authorization, capture, transfer, reversal and full refund; and
8. denial of progress, message, real-time and review projections to an unrelated account.

## Run the no-write verifier

Set the values in the same private terminal session. Do not paste secrets into Git, screenshots, chat or documentation.

```powershell
$env:HOMLE_HOSTED_REHEARSAL_DATABASE_URL = Read-Host "Migration-owner external staging database URL"
$env:HOMLE_HOSTED_REHEARSAL_BOOKING_ID = Read-Host "Completed rehearsal booking UUID"
$env:STAGING_ACCOUNT_EMAIL_SHA256 = Read-Host "Landlord and Cleaner approved email fingerprints"
$env:STRIPE_SECRET_KEY = Read-Host "Stripe test secret key"
$env:STAGING_ACCOUNTS_ONLY = "true"
$env:MARKETPLACE_ENABLED = "true"
$env:PAYMENTS_ENABLED = "true"
$env:HOMLE_HOSTED_REHEARSAL_CONFIRMATION = "VERIFY ONE PRIVATE HOMLE HOSTED BOOKING REHEARSAL"
pnpm run verify:hosted-rehearsal
Remove-Item Env:HOMLE_HOSTED_REHEARSAL_DATABASE_URL, Env:HOMLE_HOSTED_REHEARSAL_BOOKING_ID, Env:STAGING_ACCOUNT_EMAIL_SHA256, Env:STRIPE_SECRET_KEY, Env:STAGING_ACCOUNTS_ONLY, Env:MARKETPLACE_ENABLED, Env:PAYMENTS_ENABLED, Env:HOMLE_HOSTED_REHEARSAL_CONFIRMATION
```

A passing report returns a 12-character one-way booking fingerprint, aggregate evidence states, the staging database host/name and `writesPerformed: false`. Any missing evidence fails closed and names the incomplete stage.

## What this does not prove

It does not prove transactional email delivery, public supply, production payment readiness, marketplace profitability or legal launch readiness. Those remain separate launch gates. It also does not authorize contacting participants or charging real money.
