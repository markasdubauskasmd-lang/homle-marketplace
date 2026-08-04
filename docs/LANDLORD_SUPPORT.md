# Landlord support

Homle now has an authenticated, in-app support path for Landlords and a separate Administrator triage queue.

## Journeys

- Landlord: `/landlord/help`
  - Opens only for an authenticated Landlord role.
  - Accepts account-access, property, room-scan, booking-preparation, confirmed-booking change or other questions.
  - A confirmed booking card can open the page with that booking preselected.
  - A booking-change request records reschedule or cancel as structured data. Reschedule also requires a future proposed start within 365 days.
  - Shows only the current account's request history and final in-app responses.
  - Uses a client retry UUID so an uncertain mobile retry does not create a duplicate.
- Administrator: `/admin/support`
  - Opens only for an authenticated Administrator role.
  - Filters the private queue by status and category.
  - Can mark a request under review or record one final in-app response.

## Confirmed booking changes

Only the owner of a future booking whose current status is `confirmed` can create a
booking-change request. The browser, service and database all validate the booking
identifier, requested action and proposed time. The database is authoritative for
ownership and status, allows one unresolved booking-change request per booking, and
returns an exact concurrent retry instead of creating a second record.

This is operational intake, not a booking state transition. Submission and
Administrator response do not change the scheduled time, booking status, Cleaner
commitment, payment or notification state. The UI says this before submission and
again in the resulting request history. That fail-closed boundary is intentional:
actual rescheduling or cancellation must wait for founder-approved notice,
cancellation, refund/payment-adjustment and Cleaner-compensation policies.

## Deliberate boundaries

- A quality, damage or safety problem after work starts still belongs in that booking's dispute flow. Support does not invent or change a booking.
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

Migration `088_landlord_booking_change_requests.sql` adds the structured booking
link, change kind and proposed start, plus a restricted owner-checked creation
function and an unresolved-request uniqueness boundary. The disposable PostgreSQL
rehearsal also proves that a Cleaner and unrelated Landlord cannot create the
request, retries are idempotent and the booking remains confirmed after creation.

## Operations still required

The feature deliberately uses in-app answers while outbound email is not configured. A future approved email notification can alert a Landlord that an answer is ready, but the private answer should remain in Homle rather than being copied into email.
