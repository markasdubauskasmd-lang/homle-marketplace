# Immediate, guided marketplace journeys

Decision rule: **Can the user complete this action with fewer screens, fewer decisions, fewer fields or fewer clicks?** If yes, simplify it without removing consent, price, scope, identity or safety confirmation.

## Friction found

- The Landlord dashboard led with statistics, booking sections and tabs before telling the user what to do next.
- Adding a property exposed every optional operational field before the first clean could be started.
- A Landlord chose a primary cleaning type and then had to choose the same item again in a required-services checklist.
- Speech capture stopped with another instruction to press a separate summary button.
- Draft scans were present lower on the page, but the user had to find the correct request card.
- The Cleaner dashboard contained the right information, but the urgent request or live job competed with headings, statistics and multiple lists.
- The public page has a clear account-first booking action, but the older pilot request/application forms remain visually long further down the page. They should not become the authenticated marketplace journey.

## Simplified journeys

### Customer

`Book a clean` → Google/Facebook/email account → Landlord onboarding → the Landlord dashboard's single next action.

The account-first action remains visible in the hero and navigation. Provider sign-in retains the booking intent and avoids asking for contact information again. The next improvement is to remove or clearly separate the legacy pilot forms once the authenticated marketplace is enabled in staging.

### Landlord or property owner

Dashboard → **Do this next** → add the minimum property details → choose date/type → speak room notes → automatic concise tasks → confirm scope → camera/room scan → submit.

The top action changes automatically between add property, start request, continue room scan, authorize a confirmed booking and open live progress. Optional property, access, parking, recurring and budget fields stay available in disclosure panels without blocking the primary path. One cleaning-type choice now supplies the required service. Stopping speech updates the concise room tasks automatically; manual summary remains a fallback for typed edits. Scope review, photo consent, price/payment and final submission remain deliberate because they are safety/contract boundaries rather than avoidable friction.

### Cleaner

Dashboard → **Do this next** → review invitation, open active clean, prepare next job or complete profile.

The urgent action appears before counts and lists. Invitation cards retain the exact time, area, checklist size and Cleaner pay, plus private room-scan preview when the Landlord consented. Accept remains an explicit confirmed decision; active work opens directly into the large-action job lifecycle and short checklist.

## Remaining limitations

- A real mobile visual pass is still required because the desktop browser-control runtime could not connect during this audit.
- Web speech recognition depends on browser support and may use the browser vendor's service; typed notes remain the fallback.
- Mobile web background location remains less reliable than a native app after the screen is locked.
- Real Google/Facebook accounts, managed PostgreSQL, private object storage, email delivery, Stripe test mode and two-phone HTTPS testing are still staging gates.
- The current public page still carries legacy pilot forms below the account-first marketplace entry. Remove them from the public conversion path only when the authenticated replacement is enabled and proven.

## Verification

Static journey tests assert the single-next-action state, optional-field disclosures, removal of the duplicate service decision, automatic speech summary, safe text rendering, CSRF/session protection, role-specific booking information and mobile layouts. Full project checks cover database privileges, account security, scan consent, booking overlap, tracking, progress, messages, payments, reviews and disputes.
