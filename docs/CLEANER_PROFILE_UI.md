# Cleaner profile interfaces

## What is implemented

Tideway now has two real marketplace interfaces integrated with the existing visual system:

- `/cleaners` is a public, API-backed directory. It filters completed public profiles by UK outward postcode, service, availability window, rating, price and recorded verification status.
- `/cleaner/profile` is a mobile-first editor for an authenticated account whose server-side role is `cleaner`.

Neither page contains fixture people, ratings, prices, coverage or verification claims. While the marketplace attachment is disabled, both pages render an honest unavailable state and keep non-working private controls closed.

## Public directory boundary

The directory reads only `GET /api/marketplace/cleaners` through the existing shared public rate-limit boundary. Results originate from `tideway_private.search_cleaner_directory`, which admits only active, public, 100%-complete profiles.

Browser rendering uses DOM nodes and `textContent`; API values never enter `innerHTML`. Remote photos must use HTTPS, load without a referrer and fall back to generated initials. Public cards can contain professional profile fields, supported services, evidence-backed aggregate rating/completed-job values and a derived distance when the server supplies one. They cannot contain account email, phone, home address, service-area coordinates or internal acceptance data.

The page distinguishes:

- marketplace not connected;
- connection or abuse-control failure;
- a valid search with no matching profiles;
- new profiles with no completed-job reviews;
- real matching results.

Opening a profile does not confirm a booking. Every card retains the explicit scope, availability and price recheck boundary.

## Cleaner editor boundary

The editor first performs an authenticated no-store `GET /api/marketplace/cleaner/profile`. The route requires the server-side Cleaner role. Updates use `PUT` with the opaque session cookie and the separate tab-scoped CSRF token created during sign-in.

The form covers every Cleaner-controlled field accepted by the profile service: biography, experience, languages, preferences, hourly/fixed prices, supported services, radius, outward areas, supplied equipment/products and public visibility. Exact availability is a separate one-step schedule, not a vague profile choice. Cleaners are not asked to paste an external photo URL: a verified provider photo is preserved when available and the existing public initials fallback handles email accounts. Pounds are converted to exact integer pence. Fixed-price lines, list limits, UK outward postcodes and numeric bounds are validated before submission, then validated again by the server.

Editing outward postcodes preserves stored private coordinates only for unchanged codes. A new code has no invented coordinates; a removed code is omitted. Publication is automatically unavailable unless the same nine deterministic completion requirements used by the server reach 100%. The server remains authoritative and rejects any bypass. Profile saving cannot overwrite the server-owned provider photo or exact availability status.

Unsaved changes are signalled and protected on navigation. The phone layout keeps the save action reachable with one hand. The page distinguishes missing authentication, wrong role, detached runtime and connection failure without exposing private server errors.

## Activation evidence still required

These interfaces are production-shaped source, not an activated account marketplace. Before real use:

1. Apply all locked migrations and grants to approved PostgreSQL 16 staging and pass the behavioural RLS/concurrency runner.
2. Attach email/social authentication, shared rate limiting, SMTP, private object storage and monitoring under the final HTTPS origin.
3. Create genuine Cleaner accounts through verified onboarding; do not seed invented public profiles.
4. Run authenticated mobile-browser tests for owner edit, unrelated-account denial, publish/unpublish, directory filtering, image failure and session/CSRF expiry.
5. Enable `MARKETPLACE_ENABLED` only after the full attachment readiness probe passes.

Until then, the working private pilot remains the operational path and the new interfaces stay fail-closed.
