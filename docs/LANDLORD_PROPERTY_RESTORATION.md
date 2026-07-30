# Landlord property restoration

## Why this exists

Landlords can archive a property that is no longer used without deleting its booking
history. Before migration 083, that safe archive action had no equally safe recovery
path. An accidental archive therefore required database intervention even though the
property and its history still existed.

## Owner experience

- Active properties remain the default view and the only properties offered to new
  cleaning requests.
- A collapsed **Archived properties** section appears only when the signed-in
  Landlord owns at least one archived property.
- The section shows the property name, general location facts, saved-task count and
  archive date. It does not expose access instructions.
- **Restore property** returns that property to the active list immediately after the
  protected server operation succeeds.
- Existing completed or cancelled request and booking history is retained.

## Security boundary

`tideway_private.restore_my_property(uuid)` is a `SECURITY DEFINER` function with a
fixed search path. It:

1. requires a transaction-local authenticated Landlord role;
2. locks and selects only a property owned by that Landlord whose `archived_at` value
   is present;
3. clears only `archived_at` and updates the property timestamp; and
4. writes a privacy-minimal `property-restored` audit entry containing only the
   restoration timestamp.

The application role may execute the function, but `PUBLIC` may not. The browser
cannot provide an owner identifier, and the API remains protected by session, role,
origin and CSRF checks.

## Verification

Unit and UI coverage prove:

- only Landlords can list or restore their archived properties;
- resource identifiers remain bound to the authenticated actor;
- active properties cannot be restored as if they were archived;
- unrelated Landlords and Cleaners are denied;
- restored properties return to new-request selection;
- completed booking history survives archive and restoration;
- restoration writes exactly one privacy-minimal audit event; and
- the database grant is limited to the application role.

The disposable PostgreSQL integration scenario in
`db/integration/property-archive-behaviour.sql` exercises the role, history and audit
rules against a real database.

## Deliberate isolation

This change does not modify Cleaner Dashboard pages, Cleaner routes, Cleaner
workflows, matching, pricing, payments or shared presentation assets. It is confined
to Landlord property management and the protected property database boundary.
