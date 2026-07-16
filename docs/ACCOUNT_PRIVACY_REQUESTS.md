# Account privacy requests

Tideway's authenticated `/settings` page lets a customer request either a copy of their account data or account deletion. This is request intake and status tracking only: it does not immediately delete an account, cancel a booking, change a payment, issue a refund or bypass a retention obligation.

## Safety boundary

- `GET /api/marketplace/privacy-requests` returns at most the signed-in account's 20 newest requests.
- `POST /api/marketplace/privacy-requests` requires the session's exact origin and CSRF token, plus a client-generated UUID that is reused after an uncertain network response.
- Migration 035 serializes each account/request type and permits only one active export and one active deletion request. A second active request returns the existing record.
- The web role cannot read or mutate `privacy_requests` directly. It can only execute the actor-bound `request_my_privacy_action` and `get_my_privacy_requests` functions.
- Creation writes a minimal audit event containing the request type but no exported content, contact data or deletion reason.
- The settings page uses text-only DOM rendering and makes the deletion acknowledgement explicit.

## Deliberately not automated

An authorized operator must still verify identity and review active bookings, disputes, payment records, fraud/safety needs and applicable legal retention before changing request status or fulfilling it. The current implementation never changes `users.account_status` and never removes or exports records. Administrator fulfillment, secure export delivery, retention schedules and operational response targets remain launch work.

The disposable PostgreSQL integration suite proves function-only table access, idempotent active export intake, separate export/deletion requests and owner-only history, then removes its reserved test rows.
