# First Administrator provisioning

Tideway never lets a public user select the `administrator` role. Migration `034_bootstrap_administrator_provisioning.sql` and `tools/bootstrap-administrator.mjs` provide one deliberately narrow bootstrap path for the founder's first Administrator account. The source is prepared and tested; **do not run it against a real account until the founder explicitly approves that exact permission change**.

## Safety boundary

- The target must already be an active Tideway account with a verified email and at least one implemented sign-in identity: email/password, Google or Facebook. The command never creates an account or identity.
- The database login must be the exact owner of the Tideway `users` table. `tideway_app`, `tideway_worker`, other database users and even a different superuser session are rejected.
- Remote connections require certificate-verified TLS (`sslmode=verify-full`). Credentials remain in the process environment/driver and are never printed or placed in command arguments.
- A global transaction lock permits only the first Administrator. Once any Administrator exists, every new bootstrap request is rejected.
- A random UUID v4 identifies the attempt. An exact lost-response retry returns the original result; reusing that identifier with different account/operator/reason evidence is rejected.
- The grant records `granted_by = NULL` to distinguish the migration-owner bootstrap from an in-product grant. An immutable audit record stores the request ID, operator/change reference, bounded reason and session-revocation count.
- Every active session belonging to the target is revoked in the same transaction. The founder must sign in again before opening `/admin/cases`.
- This command cannot remove an Administrator or grant a second one. A future multi-Administrator workflow requires a separately reviewed, dual-control design.

The disposable PostgreSQL 16.14 suite proves restricted-role denial, exact owner execution, two-session revocation, one-time grant, exact retry, changed-retry denial, second-bootstrap denial, audit evidence and complete fixture removal.

## Approved production runbook

Complete these prerequisites first:

1. Apply and verify all 37 locked migrations and both restricted-role grant files against managed staging/production.
2. Enable the approved authentication provider on the final HTTPS domain.
3. Create the founder's normal Tideway account through that public authentication flow and verify its email.
4. Record explicit founder approval for the exact account, operator/change reference and reason. Do not put passwords, database URLs, provider secrets or recovery codes in the reason.
5. Obtain the migration-owner URL from the deployment secret manager. Never use the web or worker database credential.

Then run from a protected operator terminal. These variable names are examples; the values must come from the approved evidence and secret manager:

```powershell
$env:ADMIN_PROVISION_DATABASE_URL = "postgresql://migration-owner:secret@managed-host/tideway?sslmode=verify-full&sslrootcert=C:/protected/ca.pem"
$env:ADMIN_PROVISION_EMAIL = "founder@example.com"
$env:ADMIN_PROVISION_REQUEST_ID = [guid]::NewGuid().ToString()
$env:ADMIN_PROVISION_OPERATOR_REFERENCE = "CHANGE-REFERENCE"
$env:ADMIN_PROVISION_REASON = "Founder-approved first Administrator for marketplace operations."
$env:ADMIN_PROVISION_CONFIRMATION = "PROVISION FIRST TIDEWAY ADMINISTRATOR"
pnpm run provision:administrator
Remove-Item Env:ADMIN_PROVISION_DATABASE_URL,Env:ADMIN_PROVISION_EMAIL,Env:ADMIN_PROVISION_REQUEST_ID,Env:ADMIN_PROVISION_OPERATOR_REFERENCE,Env:ADMIN_PROVISION_REASON,Env:ADMIN_PROVISION_CONFIRMATION
```

Retain the request ID and change reference in the approved operational record. If the terminal loses the success response, rerun with every value exactly unchanged; do not generate a new request ID. After success, confirm the old session is rejected, sign in again, open `/admin/cases`, and verify no unrelated account has Administrator access. Never paste the migration-owner URL into Tideway, source control, chat, email or browser storage.
