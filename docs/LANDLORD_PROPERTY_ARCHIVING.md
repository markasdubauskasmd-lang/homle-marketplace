# Landlord property archiving

Homle lets a Landlord remove an obsolete property from their active workspace without deleting marketplace history.

## Behaviour

- Only the authenticated owning Landlord can archive a property.
- A property with an open cleaning request or active booking cannot be archived.
- Completed and cancelled bookings remain intact.
- Archived properties disappear from new cleaning requests and matching.
- The operation records a privacy-minimal audit event containing only the property identifier and archive timestamp.

The database function locks the property row while checking active work. Cleaning-request creation already takes a share lock on the same active row, so archive and request creation cannot race past each other.

## Interface

The Landlord property card offers **Archive property**. A confirmation dialog explains the effect and the active-work restriction. Successful archiving removes the property from the active list immediately; conflicts leave the record unchanged and explain what must be closed first.

## Verification

Focused service, repository, HTTP and Landlord UI tests cover actor binding, role isolation, CSRF, route-ID binding and safe history wording. The disposable PostgreSQL scenario proves active request/booking rejection, unrelated-account rejection, completed-history retention, minimal audit evidence and restricted function execution.

This feature does not change Cleaner Dashboard pages, Cleaner workflows, prices, payments or matching rules.
