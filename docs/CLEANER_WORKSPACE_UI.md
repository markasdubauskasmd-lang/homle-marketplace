# Cleaner workspace interfaces

## What is implemented

The Cleaner workspace is rebuilt from the supplied "Cleaner Onboarding Dashboard" design. Five routes now share one visual system defined in `public/homle-cleaner.css`:

- `/cleaner/dashboard` — welcome, setup panel, onboarding progress, pending and confirmed jobs, summary tiles, alerts and messages.
- `/cleaner/schedule` — week grid with confirmed jobs and unanswered offers, week navigation, summary tiles, upcoming list.
- `/cleaner/jobs/<bookingId>` — pre-acceptance job detail: scope, client photos, notes, access boundary, client card.
- `/cleaner/reviews` — rating summary, approved review cards, star distribution.
- `/cleaner/profile/preview` — the client-facing profile card exactly as the directory renders it, plus a go-live checklist.

All five reuse the existing account gate, `dashboardWorkspaceAccess` role boundary and account menu. None introduces a new authentication or authorisation path.

## Content-Security-Policy boundary

The design ships as inline `style` attributes. Homle serves every page under `style-src 'self'` with no `'unsafe-inline'`, so inline styles are blocked by the browser and the page would render unstyled. Every declaration is therefore transcribed into `public/homle-cleaner.css` and served from this origin; the policy is unchanged.

Where a value must be computed at runtime — progress-bar widths, rating bars — it is set through CSSOM (`element.style.width`). CSP restricts style attributes parsed from markup, not programmatic CSSOM writes, so this stays inside the policy.

The design also loads Archivo and Poppins from `fonts.googleapis.com`, which `default-src 'self'` blocks. Both are vendored under `public/vendor/fonts`; see that directory's README for provenance, the variable-versus-static split and licence.

## Onboarding model

`public/cleaner-onboarding-steps.js` carries the design's own step list, transcribed from its `STEPS`, `TITLES` and `ICONS` tables. Eighteen steps drive the sidebar sub-navigation, the progress chips, the percentage, the remaining-step count, the phone mock and the application-status chip, so those surfaces cannot disagree with each other.

Each step declares how its completion is established. Nine are derived from real account data:

| Step | Source |
|---|---|
| Personal details | account display name and email |
| Identity verification | `cleaner_profiles.identity_check_status` |
| Background checks (DBS) | `cleaner_profiles.background_check_status` |
| Cleaning experience | `yearsExperience` |
| Banking & payments | payout account readiness |
| Equipment | `equipmentSupplied` / `productsSupplied` |
| Availability | saved future availability windows |
| Work areas | `serviceAreas` |
| Languages | `languages` |

The remaining nine — right to work, business details, tax and self-employment, references, insurance, transport, skills, training and certificates, compliance and declarations — have no backing store anywhere in this codebase. They declare `derive: null` and always read as outstanding.

A step is never marked complete to raise the percentage, and the identity/DBS/insurance chips never read "verified" for a record Homle does not hold. Document capture, expiry tracking and a vetting provider are all still outstanding; until they exist the workspace says so rather than implying a check has happened.

## Surfaces present in the design without a backend

These keep the design's position and icon but are inert and marked `aria-disabled`, rather than shipping as links to nowhere:

- **Jobs Map** — `MAP_PROVIDER` is `none`, and the design's own map page needs Leaflet plus OpenStreetMap tiles, which the CSP blocks.
- **Performance** — Homle records no on-time, response-rate or rebook metrics.

Related omissions, each stated on the page rather than filled with placeholder values:

- The schedule's calendar-sync line says jobs stay in Homle; there is no Google or Outlook integration.
- Job detail omits the design's "Getting there" map card for the reasons above.
- Reviews omits response rate, on-time arrival, rebook rate and the verified reference quotes, none of which are recorded.
- Reviews shows no per-category scores: they are collected on submission but deliberately not exposed in the public projection.
- The public profile shows no Academy training badges and no weekly availability grid; there is no Academy, and availability is stored as exact future windows rather than a recurring pattern.
- The floating support bubble opens the private inbox, which is the real message surface for a Cleaner.

## Privacy boundaries retained

Review cards are attributed to a verified client. The public review projection carries no Landlord identity by design and exposes only rating, timestamp and written text.

Job detail releases the exact address, entry instructions and access codes only after acceptance; before that it states that they unlock on acceptance. Client photos open through the existing short-lived signed link in a separate tab. They are not embedded: the access endpoint returns JSON holding that URL rather than image bytes, and the storage origin sits outside this page's `img-src`.

## Decision flow is not duplicated

Accept and decline exist only on the dashboard. That path carries CSRF recovery, idempotent retry, uncertain-write reconciliation, invitation-deadline locking and the payout-setup gate. Job detail links into it rather than reimplementing a second decision path, because a divergent copy could commit a Cleaner to a job twice.

For the same reason the design's "Job completion sign-off" screen is not a new page. That flow already exists in full on `/bookings/<bookingId>`, where `public/active-job.js` carries task updates, photo intents, pause and resume, finish and completion across a dual-role interface. Bringing that screen to the design means restyling the shared markup, not building a second one.

## Verification status

Selector coverage, syntax and tag balance, route mapping and the existing UI-test assertions are checked statically. The pages have not been rendered in a browser and the suite has not been executed against them; CI is the first execution. Typography matches the design only once the vendored fonts are served, which they now are.
