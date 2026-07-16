# Landlord account workspace

`/landlord/dashboard` is a mobile-first authenticated workspace for a real Landlord account. It reuses Tideway's existing visual system and contains no sample properties, people, prices or bookings.

## Implemented

- A private self-account route returns only the signed-in user's display name, email, selected role and roles. It never returns session tokens, database identifiers or provider identities.
- Successful email, Google and Facebook sign-in hand off an established Cleaner to `/cleaner/dashboard` and an established Landlord to `/landlord/dashboard`; accounts that have not selected a role continue to `/onboarding`.
- Landlords can list and create their own validated properties through the existing owner-authorised APIs. Protected entry instructions remain encrypted at rest by the marketplace service.
- Landlords can turn speech into a concise room-by-room checklist, edit every item and create a future cleaning-request draft for one of their properties.
- The browser always sends `submit: false`. Saving cannot search for, invite, assign or book a Cleaner and cannot take a payment.
- The workspace lists the signed-in Landlord's active, upcoming and historical booking summaries. Confirmed jobs link to the participant-only active-job screen, while eligible confirmed bookings link to their exact payment-authorization step.
- The summary endpoint returns the Landlord's customer total but never Cleaner pay, precise location, access instructions or unrelated bookings.
- The page starts hidden and fails closed when authentication, the Landlord role, or the PostgreSQL marketplace attachment is unavailable. All account and property data is rendered with text-only DOM APIs.

## Scan-first boundary

The account dashboard now treats the room scan as the required booking handoff. A Landlord taps one large speech action and talks naturally; stopping speech automatically produces a room-grouped bullet review. Raw transcription and manual bullet editing are collapsed fallbacks, and the typed fallback opens automatically when browser speech capture is unavailable. Only the reviewed concise tasks are saved, then the Landlord attaches current room photos through the private sanitation pipeline before deliberate submission. Any later walkthrough, generated checklist, manual checklist or reusable-checklist change clears the review confirmation and requires the Landlord to reconcile the current scope again. Saving a new draft automatically opens its private scan and focuses the room selector.

Successful submission now replaces the workspace with a dedicated authenticated thank-you state. It shows the submitted request reference plus photo/task counts, explains whether bounded automatic invitation was authorised, states that no payment was taken, and offers private tracking or another request. If submission succeeds but the later automatic-dispatch response is uncertain, the page confirms only the durable submission and warns the Landlord to inspect the request before retrying; it does not claim that an invitation did or did not occur.

These controls remain fail-closed while the marketplace attachment is disabled. Real account capture still requires the managed PostgreSQL, private object-storage, image-sanitation, retention, RLS and HTTPS device gates below; the separate `/request` route remains the working local concierge-pilot path meanwhile.

## Activation requirements

1. Run the locked migrations and RLS/concurrency harness against PostgreSQL 16 with separate owner, web and worker roles.
2. Configure the exact HTTPS origin, secret manager, SMTP and private object storage; complete storage/CORS/lifecycle/threat-model verification.
3. Enable the marketplace attachment only after its readiness checks pass and onboard genuine accounts.
4. Add property editing/deletion and account-media upload UI, then exercise the complete scan-to-draft journey on mobile.
5. Keep matching, invitations and payments behind their separate approval and profitability gates.

No customer, Cleaner, property, request or booking record was created while testing this interface.
