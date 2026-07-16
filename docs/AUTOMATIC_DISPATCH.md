# Consent-bound automatic dispatch

Tideway's automatic matching remains behind the default-off authenticated marketplace. It does not run in the local pilot and this source change does not contact a Cleaner, create an operational invitation or spend money.

## Landlord control

Automatic dispatch is never inferred from creating or submitting a cleaning request. The authenticated Landlord must explicitly call the request-scoped automatic-dispatch action and choose a total attempt limit from one to five. They may revoke consent while the request is still configurable. Every authorization or revocation is written to the audit log. The web role cannot update or delete a cleaning request directly; it receives only the narrow consent function.

The attempt count includes every preserved invitation for the request, including a manual attempt. This prevents switching between manual and automatic paths from exceeding the Landlord's total chosen limit. A Cleaner who has already been attempted for that request is never selected again.

## Worker lifecycle

`createAutomaticDispatchWorker` uses a pool authenticated only as `tideway_worker`:

1. Claim a bounded set of due, submitted, future requests with a UUID lease and `FOR UPDATE SKIP LOCKED`.
2. Read candidates only while the worker owns an unexpired lease and while Landlord consent is still active.
3. Apply the same private pricing policy used by manual invitations. Manual-quote and over-budget candidates are excluded; the best profitable match is attempted first.
4. Call the hardened final invitation transaction. It independently rechecks account/profile status, property preference, exact current pay, full availability, declared coverage and overlapping work while serialising invitations for that Cleaner.
5. If a candidate became stale, try the next ranked candidate. If none remain, release the lease with a bounded retry time. One request can have only one live invitation.

The invitation and request histories are system-attributed but retain private evidence that the Landlord authorized dispatch. Existing invitation expiry or Cleaner decline returns the request to searching; the still-active consent permits a later bounded attempt until the chosen limit is reached.

## Activation gate

Before scheduling this worker:

- apply and verify all 37 locked migrations and both restricted-role grant files on PostgreSQL 16;
- pass the real multi-account RLS and two-worker concurrency harness;
- configure and approve every private `BOOKING_*` cost and margin input;
- provide genuine active Cleaner profiles, availability, coverage and prices;
- prove invitation email/in-app delivery and expiry in staging;
- attach private monitoring and alert on leases, repeated transient failures and full batches;
- keep `MARKETPLACE_ENABLED=false` until the complete authentication, private storage, email and deployment gates also pass.

The repository now has a default-off monitored worker scheduler, and its five database-only jobs pass through the real restricted local PostgreSQL 16.14 role. Automatic dispatch remains separately disabled without a production worker credential, approved economics, genuine Cleaner supply, delivery and managed concurrency evidence. No dispatch job was run and no person was contacted.
