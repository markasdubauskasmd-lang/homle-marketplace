# Landlord account workspace

`/landlord/dashboard` is a mobile-first authenticated workspace for a real Landlord account. It reuses Tideway's existing visual system and contains no sample properties, people, prices or bookings.

## Implemented

- The Landlord workspace has its own visual identity, route and primary navigation. Cleaner actions are not mixed into the Landlord navigation. A dual-role account can still switch deliberately from the authenticated account menu without merging either dashboard.
- The authenticated header shows the verified Google or Facebook profile photo when the provider supplied an HTTPS image. If there is no usable provider photo, it renders safe initials. The menu shows only the signed-in display name and email plus account settings and an optional workspace switch; it never exposes provider subjects, tokens or database IDs.
- Account identity is loaded and rendered before properties, requests, bookings and optional services. If one secondary service is unavailable, the Landlord still sees the correct private role workspace, account photo/initials and an explicit retry state instead of an empty combined dashboard.
- A private self-account route returns only the signed-in user's display name, email, selected role and roles. It never returns session tokens, database identifiers or provider identities.
- Successful email, Google and Facebook sign-in hand off an established Cleaner to `/cleaner/dashboard` and an established Landlord to `/landlord/dashboard`; accounts that have not selected a role continue to `/onboarding`.
- Landlords can list, create and reopen their own validated properties through the existing owner-authorised APIs. One clear card action opens the same short form for updating access, parking, preferences, checklist and property details; protected entry instructions are encrypted again on every save.
- Landlords can turn speech into a concise room-by-room checklist, edit every item and create a future cleaning-request draft for one of their properties.
- The browser always sends `submit: false`. Saving cannot search for, invite, assign or book a Cleaner and cannot take a payment.
- The workspace lists the signed-in Landlord's active, upcoming and historical booking summaries. Confirmed jobs link to the participant-only active-job screen, while eligible confirmed bookings link to their exact payment-authorization step.
- A completed visit offers **Book again** only when the server's owner-bound booking lookup returns both the same Cleaner and the Landlord's own property. Those opaque identifiers remain out of Cleaner summaries and expire from the browser handoff after 30 minutes. The property is rechecked against the current owner-authorized property list, then the existing request flow still requires a new schedule and fresh reviewed room scope before any invitation can be made.
- Draft and searching requests expose one quiet **Withdraw request** action. Its reason dialog is keyboard accessible, prevents duplicate submission and explains that it cannot cancel a confirmed booking or change a payment; later request states never expose the control.
- A searching request without an active invitation no longer implies that Homle is contacting Cleaners without consent. **Find my Cleaner** authorizes exactly one additional invitation through the existing owner-only dispatch boundary. The server still chooses from currently eligible, available and profitably priceable matches, a Cleaner must accept, and no payment is taken. The action advances one total attempt at a time up to five; while an authorization is active it cannot be repeated. An uncertain mobile result requires a read-only saved-status refresh before another write becomes available.
- While matching is active, the page follows a private Landlord-authorised request stream. It refreshes the durable request state when matching changes and automatically changes over to the booking event stream when the invitation exists. Unsupported or interrupted SSE never repeats a write and leaves one explicit read-only refresh action.
- The summary endpoint returns the Landlord's customer total but never Cleaner pay, precise location, access instructions or unrelated bookings.
- The page starts hidden and fails closed when authentication, the Landlord role, or the PostgreSQL marketplace attachment is unavailable. All account and property data is rendered with text-only DOM APIs.

## Scan-first boundary

The account dashboard now treats the room scan as the required booking handoff. Property setup requires only the four facts needed to locate and classify the clean; custom names and all operational details are optional. When no name is supplied, the server generates a type-and-locality label that cannot reveal the street address. The only saved property is selected automatically. Its type supplies a conservative editable cleaning-category suggestion for supported homes, workplaces and communal properties; “Other” remains unselected and any deliberate Landlord selection wins. A Landlord then taps one large speech action and talks naturally; stopping speech automatically produces a room-grouped bullet review. Raw transcription and manual bullet editing are collapsed fallbacks, and the typed fallback opens automatically when browser speech capture is unavailable. Only the reviewed concise tasks are saved, then the Landlord attaches current room photos through the private sanitation pipeline before deliberate submission. Any later walkthrough, generated checklist, manual checklist or reusable-checklist change clears the review confirmation and requires the Landlord to reconcile the current scope again. Saving a new draft automatically opens its private scan and focuses the room selector.

Successful submission now replaces the workspace with a dedicated authenticated thank-you state. It shows the submitted request reference plus photo/task counts, explains whether bounded automatic invitation was authorised, states that no payment was taken, and offers private tracking or another request. If the Landlord initially leaves matching unauthorized, the returning dashboard promotes **Find my Cleaner** as the next action instead of claiming that Homle is already looking. If submission or later authorization succeeds but the follow-on response is uncertain, the page confirms only the durable state it can prove and requires a read-only refresh before another write; it does not claim that an invitation did or did not occur.

These controls remain fail-closed while the marketplace attachment is disabled. Real account capture still requires the managed PostgreSQL, private object-storage, image-sanitation, retention, RLS and HTTPS device gates below; the separate `/request` route remains the working local concierge-pilot path meanwhile.

Saved property edits keep existing map coordinates only when every address field is unchanged. Editing any address field clears stale coordinates until the approved geocoding path supplies a replacement. The owner-bound update route, encryption boundary, address-coordinate rule, unsaved-change warning, accessible success state, withdrawal confirmation and full-width phone actions are covered by focused tests.

## Activation requirements

1. Run the locked migrations and RLS/concurrency harness against PostgreSQL 16 with separate owner, web and worker roles.
2. Configure the exact HTTPS origin, secret manager, SMTP and private object storage; complete storage/CORS/lifecycle/threat-model verification.
3. Enable the marketplace attachment only after its readiness checks pass and onboard genuine accounts.
4. Add deliberate property archiving/deletion and account-media upload UI, then exercise the complete scan-to-draft and property-edit journeys on real mobile browsers.
5. Keep matching, invitations and payments behind their separate approval and profitability gates.

No customer, Cleaner, property, request or booking record was created while testing this interface.
