# Immediate, guided marketplace journeys

Decision rule: **Can the user complete this action with fewer screens, fewer decisions, fewer fields or fewer clicks?** If yes, simplify it without removing consent, price, scope, identity or safety confirmation.

## Friction found

- The Landlord dashboard led with statistics, booking sections and tabs before telling the user what to do next.
- Adding a property exposed every optional operational field before the first clean could be started.
- Adding a property required the Landlord to invent a label, and the request form still asked them to choose a property when only one existed.
- A Landlord chose a primary cleaning type and then had to choose the same item again in a required-services checklist.
- Speech capture stopped with another instruction to press a separate summary button.
- Draft scans were present lower on the page, but the user had to find the correct request card.
- The Cleaner dashboard contained the right information, but the urgent request or live job competed with headings, statistics and multiple lists.
- The Cleaner profile editor exposed introduction, services, pricing, travel boundaries and publication checks in one long form, even when only one section needed attention.
- A signed-in Cleaner could set only a vague Available/Limited label even though matching requires an exact future start and end; the real schedule existed only in the concierge fallback and Administrator workflow.
- Email-based Cleaners were required to find and paste an external HTTPS image URL before reaching 100% profile completion, despite the directory already having a safe initials fallback.
- Cleaner search exposed postcode, service, rating, price, availability and verification controls at once, then hid the request action inside each profile's detail disclosure.
- The public page has a clear account-first booking action, but the older pilot request/application forms remain visually long further down the page. They should not become the authenticated marketplace journey.

## Public conversion path

The public homepage is now a separate lightweight page rather than the old intake page with two long forms attached below it. It gives each visitor one immediate route: **Book a clean**, **Find a cleaner**, **Work as a cleaner** or **Sign in**. The explanation is reduced to four steps: book, scan and speak, review, follow.

The working concierge-pilot forms are preserved only on `/request` and `/join`. This keeps the safe fallback available without making a new customer scroll through or download its form-processing experience on the main conversion path. The homepage loads a small menu/year script and does not load customer-request drafts, Cleaner-application drafts, validation or submission code.

The homepage now fails safely into that working `/request` journey while the managed marketplace is detached. Its no-script links never send a visitor into disabled registration, sign-in stays hidden and **Find a Cleaner** uses guided matching. One public, non-cacheable `/api/health` read upgrades those links to `/signup?intent=book`, `/cleaners` and sign-in only when marketplace attachment, runtime readiness and account authentication are all true. A failed or malformed health read leaves the working guided request in place. Disabled-account fallback, room-scan restart, invalid tracker recovery and direct directory navigation also return to the guided request rather than a dead sign-up screen; the pilot page's own booking actions jump to its form without a reload. This lets the first honest public deployment collect fulfilment-gated requests without pretending that Google/Facebook accounts are already live, while preserving the one-click account journey for the later verified activation.

## Simplified journeys

### Customer

`Book a clean` → Google/Facebook/email account → Landlord onboarding → the Landlord dashboard's single next action.

The account-first action remains visible in the hero and navigation. When at least one social provider and email are available, the account page leads with Google/Facebook and keeps the three-field email fallback one tap away instead of showing every method at once. Provider sign-in retains the booking intent and avoids asking for contact information again. A booking-intent account sees one preselected Landlord/Property Manager confirmation rather than an irrelevant Cleaner choice, then continues directly to property details. Legacy pilot forms are now separated from the homepage and remain dedicated fallbacks only.

`Find a Cleaner` now opens a two-field primary search: outward postcode and service. Rating, price, availability and recorded-verification filters stay under **More filters**. Profile facts remain optional, while one visible **Start a cleaning request** action on every result enters the same account-first booking journey. It does not pretend that viewing a profile reserves or selects that Cleaner.

### Landlord or property owner

Dashboard → **Do this next** → add the minimum property details → choose date/type → speak room notes → automatic concise tasks → confirm scope → camera/room scan → submit.

The top action changes automatically between add property, start request, continue room scan, authorize a confirmed booking and open live progress. Property setup now requires only type, address line 1, town and postcode; a custom label is optional and the server otherwise creates a privacy-safe label such as “Flat in London”, never the street address. A Landlord's only saved property is selected automatically. The request safely suggests regular domestic for a home, workplace cleaning for an office/retail/clinic, and communal-area cleaning for communal property; it never guesses for “Other” and never overwrites the Landlord's explicit change. Optional property, access, parking, recurring and budget fields stay available in disclosure panels without blocking the primary path. One cleaning-type value now supplies the required service. The request then leads with one large speech action; stopping speech updates a room-grouped bullet review automatically. The raw transcript and manual bullet editor stay collapsed unless the Landlord chooses them, while unsupported browsers open the typed fallback automatically. Scope review, photo consent, price/payment and final submission remain deliberate because they are safety/contract boundaries rather than avoidable friction.

The single Landlord action evaluates the whole lifecycle rather than trusting the first record returned. A clean already in progress wins, followed by a confirmed booking needing payment, a confirmed booking, and then the current submitted matching request. This prevents an earlier Cleaner invitation from hiding a payable booking or sending the Landlord into a duplicate request.

### Cleaner

Dashboard → **Do this next** → review invitation, open active clean, prepare next job or complete profile.

The urgent action appears before counts and lists. Invitation cards retain the exact time, area, checklist size and Cleaner pay, plus private room-scan preview when the Landlord consented. Pay appears once with an explicit label, and the primary button says **Accept £X job**. One tap is the deliberate acceptance: inline copy states that it confirms availability for that exact time and pay, while the server still rechecks expiry, eligibility and overlap before confirmation. Decline remains a separate confirmed action because it reopens matching. Active work opens directly into the large-action job lifecycle and short checklist. Each normal task now leads with one full-width **Mark task complete** control; status changes, notes, skips, issues and corrections stay one disclosure away, and unapproved unexpected work remains locked.

The separate concierge fallback at `/join` now collects only contact details, matchable work areas, services, experience and one first availability window. Biography, languages and equipment planning are enforced as the next private-tracker step instead of competing with the initial Apply action. Optional usual availability and notes stay inside one disclosure.

The authenticated profile editor now opens the first incomplete section and shows one clear next action. Introduction, services and pricing, work boundaries, and final review are four short steps rather than one long page. Each step shows its own completion state, progress can be saved at any time, and publication remains deliberately unavailable until the same ten server-backed profile requirements are complete.

The Cleaner dashboard's single next action now follows real readiness order: urgent invitation/live job first, then complete and publish the profile, add exact availability, and finally finish payout setup. It never sends a Cleaner toward payment or scheduling while their profile is still unable to enter matching. The focused `/cleaner/availability` screen asks only for day, start and end, with tomorrow and normal working hours prefilled. One **I'm available** action creates the exact matchable window and updates the broad matching state automatically. Upcoming windows are shown in a short private list. Removing a time requires one confirmation, is blocked when an invitation or live job overlaps, and automatically marks the profile unavailable after the last future window is removed. The old manual Available/Limited profile choice is gone, so exact windows are the single source of truth.

Cleaner publication no longer depends on an image-hosting task. A genuine Google/Facebook photo imported during verified onboarding is preserved automatically; otherwise the public profile uses the existing initials avatar. Profile editing cannot replace that server-owned value with an arbitrary remote URL. Completion now reflects nine genuine work/profile decisions rather than counting a pasted link.

## Remaining limitations

- A real mobile visual pass is still required because the desktop browser-control runtime could not connect during this audit.
- Web speech recognition depends on browser support and may use the browser vendor's service; typed notes remain the fallback.
- Mobile web background location remains less reliable than a native app after the screen is locked.
- Real Google/Facebook accounts, managed PostgreSQL, private object storage, email delivery, Stripe test mode and two-phone HTTPS testing are still staging gates.
- `/request` and `/join` still use the longer concierge-pilot intake because they must collect enough safe information to operate without the managed account marketplace. They are no longer part of the homepage scroll.

## Verification

Static journey tests assert the lightweight homepage boundary, its direct role actions, absence of the legacy forms and form-processing script, dedicated fallback intake routes, provider-first account entry, two-field Cleaner search, optional discovery filters, direct account-first result actions, the one-decision booking-role confirmation, single-next-action dashboards, the guided four-step Cleaner profile editor, exact section completion, one-step exact Cleaner availability, minimum property setup, privacy-safe automatic labels, sole-property selection, safe cleaning-type suggestions, optional-field disclosures, removal of duplicate service and availability decisions, automatic speech summary, safe text rendering, CSRF/session protection, role-specific booking information and mobile layouts. Full project checks cover database privileges, account security, scan consent, booking and availability overlap, tracking, progress, messages, payments, reviews and disputes.
