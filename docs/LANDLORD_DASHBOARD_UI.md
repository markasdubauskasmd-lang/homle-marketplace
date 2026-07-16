# Landlord account workspace

`/landlord/dashboard` is a mobile-first authenticated workspace for a real Landlord account. It reuses Tideway's existing visual system and contains no sample properties, people, prices or bookings.

## Implemented

- A private self-account route returns only the signed-in user's display name, email, selected role and roles. It never returns session tokens, database identifiers or provider identities.
- Successful email, Google and Facebook sign-in hand off an established Cleaner to `/cleaner/profile` and an established Landlord to `/landlord/dashboard`; accounts that have not selected a role continue to `/onboarding`.
- Landlords can list and create their own validated properties through the existing owner-authorised APIs. Protected entry instructions remain encrypted at rest by the marketplace service.
- Landlords can turn speech into a concise room-by-room checklist, edit every item and create a future cleaning-request draft for one of their properties.
- The browser always sends `submit: false`. Saving cannot search for, invite, assign or book a Cleaner and cannot take a payment.
- The page starts hidden and fails closed when authentication, the Landlord role, or the PostgreSQL marketplace attachment is unavailable. All account and property data is rendered with text-only DOM APIs.

## Scan-first boundary

The existing `/request` flow remains Tideway's working private room-photo and spoken-note route. The account dashboard does not pretend that production media storage is ready: photo/video capture stays closed until the private object-storage, image-sanitation, retention and PostgreSQL/RLS gates pass. Once those gates are proven, the room scan should be attached to the draft before any Cleaner matching begins.

## Activation requirements

1. Run the locked migrations and RLS/concurrency harness against PostgreSQL 16 with separate owner, web and worker roles.
2. Configure the exact HTTPS origin, secret manager, SMTP and private object storage; complete storage/CORS/lifecycle/threat-model verification.
3. Enable the marketplace attachment only after its readiness checks pass and onboard genuine accounts.
4. Add property editing/deletion and account-media upload UI, then exercise the complete scan-to-draft journey on mobile.
5. Keep matching, invitations and payments behind their separate approval and profitability gates.

No customer, Cleaner, property, request or booking record was created while testing this interface.
