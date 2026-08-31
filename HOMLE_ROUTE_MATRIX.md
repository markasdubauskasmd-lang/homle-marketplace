# Homle route matrix

Every route the application serves, what it is for, and what was actually
observed on it. Companion to `HOMLE_MASTER_AUDIT.md`, which carries the findings
and the fixes; this file carries the coverage.

## How to read it

`PASS` — exercised and correct. `FAIL` — exercised and wrong; the Issues column
names the finding. `BLOCKED` — could not be exercised here, and the reason is
recorded rather than guessed. `N/A` — the column does not apply to this route.

**A `BLOCKED` cell is not a `PASS`.** Five integrations are unconfigured in this
environment (Stripe, geocoding, address lookup, automatic dispatch and the vision
model), and no amount of source reading substitutes for running them. Where a
route depends on one, its Functionality cell says so.

**Roles.** `P` public · `L` Landlord · `C` Cleaner · `A` Administrator ·
`?` any signed-in account.

**Design systems.** `landing` the public marketing composition
(`landing-f56e7ce9.css`) · `entry` the account-entry composition
(`account-entry.css`) · `v2` the approved Landlord workspace
(`landlord-dashboard-v2.css`) · `shell` the shared workspace shell
(`homle-workspace.css` + `workspace-shell.js`) · `hc` the Cleaner workspace
(`homle-cleaner.css`) · `base` tokens plus `styles.css` with no page composition
of its own.

## Method

The evidence behind these cells, not an impression of it:

- A local PostgreSQL 16 cluster bootstrapped through the project's own
  `tools/bootstrap-staging-database.mjs` (105 locked migrations), a TLS SMTP sink
  delivering real verification mail, an S3-compatible object store on loopback,
  and `server.mjs` reporting `marketplace`, `authentication`, `email`, `realtime`
  and `media` all ready.
- Real accounts: two Landlords and one Cleaner, each registered, email-verified,
  signed in and onboarded through the HTTP API — not fixtures.
- Every route rendered in headless Chromium over the DevTools Protocol at
  1440×900, 834×1112 and 390×844, signed out and again signed in, recording
  console output, uncaught page errors, **every network response of 400 or
  worse**, computed styles, layout overflow and touch-target sizes per page and
  per viewport.
- Journeys walked as a person: registration, verification, sign-in, onboarding,
  property creation, the manual booking journey to checkout, the room-photo
  chain, the Updates inbox, Security & login, and the Cleaner workspace.

---

## Public and account entry

| Route | Role | Purpose | Desktop | Tablet | Mobile | Design | Functionality | API/data | Console | Network | A11y | Security relevance | Status | Issues |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/` | P | Marketing landing | PASS | PASS | PASS | landing | PASS | N/A | PASS | PASS¹ | PASS | Public. No account data. | PASS | — |
| `/login` | P | Sign in | PASS | PASS | PASS | entry | PASS | auth | PASS | PASS | PASS | Credential entry; constant-time, lockout, and throttling **whose keying is unverified in the deployed shape — see S-6**. Sign-in does not revoke other sessions | PASS | S-6 |
| `/signup` | P | Register | PASS | PASS | PASS | entry | PASS | auth | PASS | PASS | PASS | Account creation; staging allow-list, verification mail | PASS | — |
| `/verify-email` | P | Confirm mail | PASS | PASS | PASS | entry | PASS | auth | PASS | PASS | PASS | Token in the URL **fragment**, never the query, so it stays out of logs and referrers | PASS | — |
| `/verify-facebook` | P | Confirm Facebook mail | PASS | PASS | PASS | entry | PASS | auth | PASS | PASS | PASS | As above | PASS | — |
| `/forgot-password` | P | Request reset | PASS | PASS | PASS | entry | PASS | auth | PASS | PASS | PASS | Opaque acceptance; no account-existence oracle | PASS | — |
| `/reset-password` | P | Complete reset | PASS | PASS | PASS | entry | PASS | auth | PASS | PASS | PASS | Revokes every existing session | PASS | — |
| `/onboarding` | ? | Choose a workspace | PASS | PASS | PASS | entry | PASS | auth | PASS | PASS | PASS | `administrator` is not self-assignable — verified `422` | PASS | — |
| `/account-ready` | ? | Post-onboarding hand-off | PASS | PASS | PASS | entry | PASS | auth | PASS | PASS | PASS | — | PASS | — |
| `/privacy` | P | Privacy notice | PASS | PASS | PASS | base | PASS | N/A | PASS | PASS | PASS | Public | PASS | no skip link |
| `/terms` | P | Pilot terms | PASS | PASS | PASS | base | PASS | N/A | PASS | PASS | PASS | Public | PASS | no skip link |
| `/facebook-data-deletion` | P | Deletion callback landing | PASS | PASS | PASS | base | PASS | deletion API | PASS | PASS | PASS | Signed-request verification, opaque status | PASS | no skip link |

¹ The landing photography is fetched from an external host that this
environment's proxy refuses (`ERR_TUNNEL_CONNECTION_FAILED`). Environmental, not
a defect; the page degrades without layout shift.

## Shared signed-in workspace

| Route | Role | Purpose | Desktop | Tablet | Mobile | Design | Functionality | API/data | Console | Network | A11y | Security relevance | Status | Issues |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/settings` | ? | Security & login, privacy requests | PASS | PASS | PASS | shell | PASS | auth, privacy | PASS | PASS | PASS | Provider linking requires a step-up; a password change needs the current password | PASS | was legacy — P2-1/2/4 |
| `/notifications` | L | Updates inbox | PASS | PASS | PASS | shell | PASS | notifications | PASS | PASS | PASS | Refused another account's rows under test | PASS | was legacy — P1-1, P2-3/4/5/6 |
| *(any unmatched path)* | P | Designed 404 | PASS | PASS | PASS | ws tokens | PASS | account | PASS | PASS | PASS | No route or account disclosure | PASS | was raw JSON — P1-3. Re-rendered as each role: the way back now resolves to `/admin` for staff with the help line hidden, `/landlord/home` for a Landlord, `/` for a visitor — D-4, Q-7 area |

## Landlord workspace

| Route | Role | Purpose | Desktop | Tablet | Mobile | Design | Functionality | API/data | Console | Network | A11y | Security relevance | Status | Issues |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/landlord/dashboard` `/landlord/home` | L | Workspace home | PASS | PASS | PASS | v2 | PASS | bootstrap | PASS | PASS | PASS | Landlord-only; RLS-scoped | PASS | source of truth |
| `/landlord/bookings` | L | Bookings panel | PASS | PASS | PASS | v2 | PASS | bookings | PASS | PASS | PASS | Own bookings only | PASS | was 954px of sideways scroll on a long property name — F-9 |
| `/landlord/requests` | L | Requests panel | PASS | PASS | PASS | v2 | PASS | requests | PASS | PASS | PASS | Own requests only | PASS | deep link only, intentional |
| `/landlord/properties` | L | Properties panel | PASS | PASS | PASS | v2 | PASS | properties | PASS | PASS | PASS | Own properties only | PASS | deep link only, intentional |
| `/landlord/messages` | L | Conversations | PASS | PASS | PASS | v2 | PARTIAL | messages, realtime | PASS | PASS | PASS | Participants only — a non-participant gets `404` | PARTIAL | Empty and gated states only: **no booking exists in this database**, so no real conversation was ever exercised. Empty-state sentence de-duplicated — Q-4. The panel also announced itself ready while the thread was still loading — Q-8, fixed |
| `/landlord/account` | L | Account panel | PASS | PASS | PASS | v2 | PASS | account | PASS | PASS | PASS | — | PASS | — |
| `/landlord/payments` | L | Payments panel | PASS | PASS | PASS | v2 | BLOCKED | payments | PASS | PASS | PASS | Amounts are server-derived; the browser never sends one | BLOCKED | Stripe not configured here |
| `/landlord/book` | L | Scan / manual request builder | PASS | PASS | PASS | v2-adjacent | PASS² | scan, requests, pricing | PASS³ | PASS | PASS | Price recomputed server-side from the published rate list | PASS | 4 page-specific sheets |
| `/landlord/checkout` | L | Authorise payment | PASS | PASS | PASS | shell | BLOCKED | payments | PASS | PASS | PASS | Refuses an address without a valid booking reference | BLOCKED | Stripe not configured; shell unified — P2-7 |
| `/landlord/help` | L | Support requests | PASS | PASS | PASS | shell | PASS | support | PASS | PASS | PASS | Capped at five open requests — verified `409` | PASS | still loads the retired `landlord-help.css` |

² The manual journey was walked end to end, including the room-photo chain
(intent → presigned PUT → sanitise → completion → read) and submission reaching
`searching-for-cleaner`. The **scan** path's object detection is BLOCKED — no
vision model is configured.
³ TensorFlow.js logs two backend-initialisation warnings because headless
Chromium has no GPU. It falls back cleanly; no page error, no broken render.

## Cleaner workspace

Nineteen routes, all on `homle-cleaner.css`, all now rendering one sidebar from
`renderCleanerShell()`.

| Route | Role | Purpose | Desktop | Tablet | Mobile | Design | Functionality | API/data | Console | Network | A11y | Security relevance | Status | Issues |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/cleaner/dashboard` | C | Activity | PASS | PASS | PASS | hc | PASS | bootstrap | PASS | PASS | PASS | Cleaner-only. The chrome is removed, not just hidden, for an account without the workspace — see F-2 and F-6; this route was where the second bypass showed | PASS | — |
| `/cleaner/jobs-map` | C | Jobs map | PASS | PASS | PASS | hc | PASS | PASS | PASS | **PARTIAL** | PASS | Gate refuses a signed-out visitor and a Landlord-only account; opens for a Cleaner | PASS | Q-7 — the loopback branch is removed, so the real gate and job load now run and were exercised for all three roles. **Map tiles and the outcode lookup remain UNVERIFIED**: this sandbox's egress policy rejects CONNECT to `tile.openstreetmap.org` and `api.postcodes.io`, so all 9/6 tile requests failed with `ERR_TUNNEL_CONNECTION_FAILED`. Both processors *are* disclosed in the privacy notice — my earlier claim that they were not was wrong |
| `/cleaner/schedule` | C | Availability | PASS | PASS | PASS | hc | PASS | availability | PASS | PASS | PASS | Own availability only | PASS | — |
| `/cleaner/messages` | C | Conversations | PASS | PASS | PASS | hc | PASS | messages, realtime | PASS | PASS | PASS | Participants only | PASS | — |
| `/cleaner/notifications` | C | Cleaner inbox | PASS | PASS | PASS | hc | PASS | notifications | PASS | PASS | PASS | Own rows only | PASS | bell now points here — P2-15 |
| `/cleaner/performance` | C | Ratings and reliability | PASS | PASS | PASS | hc | PASS | reviews | PASS | PASS | PASS | — | PASS | — |
| `/cleaner/payouts` | C | Stripe Connect onboarding | PASS | PASS | PASS | hc | BLOCKED | payouts | PASS | PASS | PASS | Refuses any destination that is not `connect.stripe.com` | BLOCKED | Stripe not configured; was P1-2, D-9 |
| `/cleaner/settings` | C | Cleaner settings | PASS | PASS | PASS | hc | PASS | profile | PASS | PASS | PASS | — | PASS | — |
| `/cleaner/profile/preview` | C | Public profile preview | PASS | PASS | PASS | hc | PASS | profile | PASS | PASS | PASS | Shows only what the public sees | PASS | deep link only |
| `/cleaner/documents` `/cleaner/training` `/cleaner/contracts` | C | Compliance | PASS | PASS | PASS | hc | PASS | onboarding docs | PASS | PASS | PASS | Private document storage, signed reads | PASS | canvas fixed — P3-1 |
| `/cleaner/help-centre` `/cleaner/support-tickets` `/cleaner/report-incident` `/cleaner/disputes` | C | Support | PASS | PASS | PASS | hc | PASS | support, disputes | PASS | PASS | PASS | Own tickets only | PASS | — |
| `/cleaner/onboarding` + 14 registration step routes | C | Registration | PASS | PASS | PASS | hc + redesign | PASS | onboarding | PASS | PASS | PASS | Identity and right-to-work handling | PASS | brand mark now a link on all — P2-14 |
| `/cleaner/jobs/:uuid` | C | Job offer detail | PASS | PASS | PASS | hc | PASS | matching | PASS | PASS | PASS | Invited Cleaner only | PASS | — |
| *(second QA pass)* | — | 70 rendered states, 3 roles × 2 viewports | PASS | — | PASS | one canvas per workspace | PASS | PASS | PASS | PASS | PASS | — | PASS | 9 findings on the first run, 0 product defects on the last. The 4 remaining entries are proven environment/harness artifacts: the sandbox rejects CONNECT to `tile.openstreetmap.org`, and the harness injects a session cookie without the CSRF token a real sign-in stores (`/admin/pricing/preview` answers 200 with it, 403 without) |
| `/cleaner/reviews` | C | *(redirects to `/cleaner/performance`)* | N/A | N/A | N/A | N/A | PASS | N/A | N/A | N/A | N/A | — | PASS | the orphan `public/cleaner-reviews.{html,js}` are now removed — D-17 |

## Shared job routes

| Route | Role | Purpose | Desktop | Tablet | Mobile | Design | Functionality | API/data | Console | Network | A11y | Security relevance | Status | Issues |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/bookings/:uuid` `…/tracking` `…/cleaning-progress` | L, C | Active job | PASS | PASS | PASS | base | **PARTIAL** | progress, realtime | PASS | PASS | PASS | Both participants, each seeing their own side | **PARTIAL** | Gated states only — no booking exists in this database. Every escape hatch on the refusal state sends a signed-in user to `/login` — Q-4. On neither workspace system |
| `/opportunity` | C | Pre-acceptance offer | PASS | PASS | PASS | base | PASS | matching | PASS | PASS | PASS | Token-scoped | PASS | — |

## Administrator

| Route | Role | Purpose | Desktop | Tablet | Mobile | Design | Functionality | API/data | Console | Network | A11y | Security relevance | Status | Issues |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/admin` | A | Control desk | PASS | PASS | PASS | + `admin-desk.css` | PASS | admin | PASS | PASS | PASS | Administrator role required; not self-assignable | PASS | D-1 — one canvas, 11/11 shared nav, `aria-current` correct |
| `/admin/cases` | A | Case queue | PASS | PASS | PASS | + `admin-desk.css` | PASS | admin | PASS | PASS | PASS | As above | PASS | — |
| `/admin/support` | A | Support desk | PASS | PASS | PASS | + `admin-desk.css` | PASS | admin | PASS | PASS | PASS | As above | PASS | D-1 — `landlord-help.css` is live here (19 of 27 classes), not retired; the canvas is overridden rather than the sheet removed |
| `/admin/coverage` | A | Coverage report | PASS | PASS | PASS | + `admin-desk.css` | PASS | admin | PASS | PASS | PASS | As above | PASS | D-1 — canvas unified; its four reds remain inside the report's own tables |
| `/admin/funnel` | A | Marketplace funnel | PASS | PASS | PASS | + `admin-desk.css` | PASS | admin | PASS | PASS | PASS | As above | PASS | D-1 — was a transparent body; now on the workspace canvas |
| `/admin/payments` | A | Payment operations | PASS | PASS | PASS | + `admin-desk.css` | BLOCKED | payments | PASS | PASS | PASS | As above | BLOCKED | Stripe not configured. D-1 — the desk's data still 404s, but the navigation now stays, so an operator is no longer stranded here |
| `/admin/pricing` `/admin/scan-pricing` | A | Rate lists | PASS | PASS | PASS | + `admin-desk.css` | PASS | pricing | PASS | PASS | PASS | Server-side rate list is authoritative | PASS | — |
| `/admin/scan-operations` | A | Scan operations | PASS | PASS | PASS | + `admin-desk.css` | PASS | scan telemetry | PASS | PASS | PASS | As above | PASS | D-18 — now linked from all eleven desks |
| `/admin/bookings` | A | Booking operations | PASS | PASS | PASS | + `admin-desk.css` | PASS | admin | PASS | PASS | PASS | As above | PASS | — |
| `/admin/verifications` | A | Cleaner verification | PASS | PASS | PASS | + `admin-desk.css` | PASS | admin | PASS | PASS | PASS | Handles identity documents | PASS | — |

Every admin desk overflowed horizontally at 390px before this audit (P2-9); none
does now.

## Test harnesses

| Route | Role | Purpose | Desktop | Tablet | Mobile | Design | Functionality | API/data | Console | Network | A11y | Security relevance | Status | Issues |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/stripe-sandbox` | A | Stripe test checkout | PASS | PASS | PASS | base | BLOCKED | payments | PASS | PASS⁴ | PASS | Sandbox amount hardcoded at 30p; live keys refused | BLOCKED | Stripe not configured |
| `/tracking-test` | A | Tracking harness | PASS | PASS | PASS | base | PASS | tracking | PASS | PASS | PASS | Non-production only | PASS | — |
| `/room-scan.html` | — | *(308 → `/landlord/book`)* | N/A | N/A | N/A | N/A | PASS | N/A | N/A | N/A | N/A | — | PASS | deliberate stale-bookmark fallback |

⁴ `GET /api/marketplace/payments/config` answers `404` because payments are not
configured. The page states that plainly rather than failing silently — the
intended fail-closed behaviour.

---

## Coverage summary

| | Count |
|---|---|
| Named routes in `server.mjs` | 71 + 2 regex families + the 404 document |
| Distinct HTML documents behind them | 45 of the 47 in `public/` |
| Routes rendered at three viewports, signed out and signed in | 57 |
| Routes with an uncaught page error | **0** |
| Routes with a console error | **0** |
| Routes with horizontal overflow at any viewport | **0**, but see the correction below |
| Routes with an unexpected network failure | **0** now; **12 Cleaner routes were failing** — see F-7 |
| Routes marked BLOCKED on an unconfigured integration | 6 |

**Two corrections an independent QA reviewer forced on this table, both about
the instrument rather than the application.**

*Network.* This table first read "0 unexpected network failures" everywhere. It
was measured on Cleaner routes with a **Landlord** session, which the role gate
refuses before the notification badge ever runs. With a real Cleaner session,
`GET /notifications/events` answered **403 on twelve Cleaner routes** — the live
notification stream was dead in Chrome on all nineteen Cleaner pages. Fixed
(F-7) and re-measured as `[]`, but the cell was wrong when written.

*Overflow.* The check compared `scrollWidth` to `innerWidth` **under mobile
emulation**, and Chrome expands the layout viewport to fit overflowing content —
so `innerWidth` grows with `scrollWidth` and the check reports "no overflow"
precisely when overflow is worst. Re-measured at `mobile: false`,
`/landlord/bookings` had **954px of sideways scroll** at 390px with a
160-character property name the API accepts. Fixed (F-9); the figures above are
from the corrected measurement.

Every `4xx` that remains is correct behaviour: `401` on a workspace route fetched
while signed out, `404` on the deliberate missing-page probe, and `404` on the
payments config endpoint that is genuinely not configured.

## What this matrix does not cover

Stated plainly, because a matrix of PASS cells invites the opposite reading:

- **Stripe**, and therefore checkout authorisation, payouts, refunds, webhook
  replay and amount tampering. No test keys are configured here.
- **Geocoding and address lookup**, and therefore real Cleaner matching by
  distance, travel pricing per kilometre and live ETA.
- **The vision model**, and therefore the scan's object detection. The manual
  path was walked instead.
- **Automatic dispatch**, which the health endpoint reports unready here. Its
  two-worker lease behaviour is covered by the PostgreSQL integration suite
  against a real cluster, not by a browser.
- **Physical devices.** Every viewport here is desktop Chromium emulating a
  size. Real iOS and Android handsets over HTTPS remain required before launch,
  as the repository's own harness notes.
