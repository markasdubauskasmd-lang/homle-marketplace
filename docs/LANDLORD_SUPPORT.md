# Landlord support

Homle now has an authenticated, in-app support path for Landlords and a separate Administrator triage queue.

## Journeys

- Landlord: `/landlord/help`
  - Opens only for an authenticated Landlord role.
  - Accepts account-access, property, room-scan, booking-preparation or other questions.
  - Shows only the current account's request history and final in-app responses.
  - Uses a client retry UUID so an uncertain mobile retry does not create a duplicate.
- Administrator: `/admin/support`
  - Opens only for an authenticated Administrator role.
  - Filters the private queue by status and category.
  - Can mark a request under review or record one final in-app response.

## Deliberate boundaries

- A confirmed-booking problem still belongs in that booking's dispute flow. Support does not invent or change a booking.
- Support does not send email, promise a response time, contact a user, process a payment, change an account or call an external system.
- Passwords, access codes, payment-card details and secret keys are rejected in the browser, service and database function.
- The queue does not project account email, property address, access instructions or account identifiers.
- The application database role has no direct read or write privilege on `support_requests`. All access is through role-aware `SECURITY DEFINER` functions with pinned search paths.
- Five simultaneous open/reviewing requests per Landlord is the current abuse and operator-capacity limit.

## Database

Migration `080_landlord_support_requests.sql` adds:

- `support_requests`
- owner history and Administrator queue indexes
- idempotent Landlord creation
- owner-only listing
- Administrator-only queue and review
- immutable final responses
- audit records for creation, review start and resolution

The disposable PostgreSQL rehearsal proves Cleaner denial, Landlord ownership isolation, privacy-field rejection, Administrator minimum-data projection, idempotent retries and final-response visibility.

## Operations still required

The feature deliberately uses in-app answers while outbound email is not configured. A future approved email notification can alert a Landlord that an answer is ready, but the private answer should remain in Homle rather than being copied into email.
