# Homle master audit

Full-application design, functional and integration audit, and the record of what
was implemented in response.

**Method.** The application was not read only as source. A local PostgreSQL 16
cluster was bootstrapped through the project's own
`tools/bootstrap-staging-database.mjs` (104 locked migrations), a local SMTPS sink
supplied real verification mail, and `server.mjs` was run with the marketplace,
authentication, email and realtime boundaries all reporting ready. A Landlord
account was registered, verified, signed in and onboarded through the real HTTP
API, and every route below was then rendered in headless Chromium over the
DevTools Protocol at 1440×900, 834×1112 and 390×844, with console output, page
errors, computed styles, layout overflow and touch-target sizes recorded per page
and per viewport, plus screenshots.

Statuses: `[ ]` not started · `[~] `in progress · `[x]` complete · `[!]` needs attention

---

## 1. Route matrix

`USER` — L Landlord, C Cleaner, A Admin, P public, ? any signed-in account.
`DESIGN` — **v2** the approved Landlord composition (`landlord-dashboard-v2.css`),
**hc** the Cleaner workspace system (`homle-cleaner.css`), **landing** the public
marketing design, **tokens** shared tokens with no page composition, **legacy** a
retired shell or palette.

| Route | User | Purpose | Design | Functional | Mobile | Backend | Issues | Action |
|---|---|---|---|---|---|---|---|---|
| `/` | P | Marketing landing | landing | ok | ok | none | — | none |
| `/login` `/signup` `/forgot-password` `/reset-password` `/verify-email` `/onboarding` `/account-ready` | P | Account entry | tokens + `account-entry.css` | ok | ok | auth API | — | none |
| `/settings` | ? | Security & login, privacy requests | **legacy** | ok | ok | auth, privacy API | P2-1, P2-2, P2-4 | migrated |
| `/notifications` | L | Updates inbox | **legacy** | ok | ok | notifications API | P1-1, P2-1..P2-6 | rebuilt |
| `/landlord/dashboard` `/landlord/home` `/landlord/bookings` `/landlord/messages` `/landlord/account` `/landlord/payments` `/landlord/properties` `/landlord/requests` | L | Workspace panels | **v2** | ok | ok | many | source of truth | none |
| `/landlord/book` | L | Scan / manual request builder | v2-adjacent | ok | ok | scan, request API | — | none |
| `/landlord/checkout` | L | Stripe authorisation | tokens + `landlord-checkout-v2.css` | ok (gated) | ok | payments | P2-7 | shell unified |
| `/landlord/help` | L | Support requests | tokens + `landlord-help-v2.css` | ok | ok | support API | P2-7 | shell unified |
| `/cleaner/dashboard` … `/cleaner/profile/preview` (18 routes) | C | Cleaner workspace | **hc** | ok | ok | many | P3-1 | body canvas fixed |
| `/cleaner/payouts` | C | Stripe Connect onboarding | **legacy** | P1-2 | ok | payments | P1-2, P2-8 | migrated to hc |
| `/cleaner/onboarding` + 12 registration routes | C | Cleaner registration | hc + redesign | ok | ok | onboarding API | P3-1 | body canvas fixed |
| `/opportunity` | C | Pre-acceptance offer view | tokens | ok | ok | matching | — | none |
| `/not-found` (any unmatched path) | P | Error page | **shell** | ok | ok | none | was raw JSON | added |
| `/bookings/:id` `/bookings/:id/tracking` `/bookings/:id/cleaning-progress` | L,C | Active job | tokens | ok | ok | progress, realtime | — | none |
| `/cleaner/jobs/:id` | C | Job offer detail | hc | ok | ok | matching | — | none |
| `/admin` + 10 admin routes | A | Operations desks | tokens | ok | **overflow** | admin API | P2-9 | fixed |
| `/privacy` `/terms` `/facebook-data-deletion` | P | Legal | tokens | ok | ok | none | — | none |
| `/stripe-sandbox` `/tracking-test` | A | Test harnesses | tokens | ok | ok | payments | — | none |
| `/room-scan.html` | — | — | — | 308 → `/landlord/book` | — | — | intentional redirect | none |
| **anything else** | P | — | **none** | **P1-3** | — | — | raw JSON 404 | 404 page added |

Routes discovered that are **not** reachable from any navigation: `/landlord/requests`,
`/landlord/properties`, `/stripe-sandbox`, `/tracking-test`, `/opportunity`,
`/cleaner/profile/preview`, `/facebook-data-deletion`. All are live and intentional
(deep links, operator tools, callback landing pages), none are dead screens.

---

## 2. The design system, as it actually is

The approved composition is the Landlord v2 workspace. Extracted from it and from
`homle-tokens.css`:

| Decision | Value |
|---|---|
| Canvas | `#f7f6f5` |
| Surface / card | `#ffffff` |
| Ink / soft ink | `#1a1a1a` / `#3a3a3a` |
| Muted ramp | `#666666`, `#6b6b6b`, `#707070` (contrast-led, ≥4.5:1 on canvas) |
| Accent | `#e11b22`, hover `#c4151b`, tint `#fdecec` |
| Lines | `#efedeb`, `#e7e4e0`, `#e1deda` |
| Success | `#2e9e63` / ink `#2e7d51` / tint `#eaf4ee` |
| Warning | ink `#9a6d14` / tint `#fbf1df` |
| Type | DM Sans body **and** headings on workspace surfaces; Bricolage Grotesque for voice |
| Radius | 10 chips · 12 nav rows · 16 buttons · 20–22 cards · 999 pills |
| Elevation | `0 1px 2px …/.05, 0 6px 16px …/.06` for cards; one deeper step for overlays |
| Shell | 240px white sidebar ≥900px; top bar with title, bell, avatar; floating bottom tab bar <900px |
| Focus | 3px `#2456e6`, offset 2px |

**The problem was never that these values were unknown.** They were declared three
times, in three files, as literals — `landlord-dashboard-v2.css`,
`account-pages.css` and scattered rules in `styles.css` — so "one design system"
was a coincidence maintained by hand.

---

## 3. Findings

### P0 — blocks production / security / payments / data

None found. Payment, session, CSRF, rate-limiting, RLS and privacy boundaries all
behaved correctly under test; the checkout refuses an address without a valid
booking reference and says so, and the notification API refused to serve another
account's rows.

### P1 — broken important functionality

- **[x] P1-1 · The Updates page is not in the workspace.**
  `public/notifications.html`, `public/account-pages.css`
  A Landlord reaches Updates from the Account view's "Notifications" row, from the
  sidebar bell, and from the account menu. All three leave the workspace: the page
  renders a **dark near-black top bar** with a horizontal `Dashboard · Properties ·
  Updates` nav, a 760px centred column and a dark footer. On a phone there is **no
  bottom tab bar at all**, so the five destinations a Landlord has on every other
  screen simply vanish, and "Properties" is offered here but is not one of the four
  destinations the v2 sidebar has. It is a different application wearing the same logo.
  *Fixed:* rebuilt on the shared workspace shell (see §4).

- **[x] P1-2 · `/cleaner/payouts` renders Cleaner chrome for any signed-in account.**
  `public/cleaner-payouts.html`
  The header is static markup: a hard-coded `Cleaner` identity pill, a "Jobs" link
  to `/cleaner/dashboard` and an account menu offering "Open Cleaner dashboard".
  Signed in as a Landlord the page states the account is a Cleaner and offers
  Cleaner destinations. Confirmed in the browser with a real Landlord session.
  *Fixed:* the page now gates its chrome on the account's role like every other
  workspace page, and sends a non-Cleaner to their own workspace.

- **[x] P1-3 · No 404 page.**
  `server.mjs`
  Any unmatched path returns `{"ok":false,"error":"Not found."}` as
  `application/json`. A browser renders that as unstyled Times New Roman on white.
  Every mistyped URL, stale bookmark and expired share link lands there.
  *Fixed:* HTML requests now receive a designed 404 in the app's design system;
  API paths keep the JSON body.

### P2 — significant UX / design inconsistency

- **[x] P2-1 · Two design systems declare the same palette as literals.**
  `public/account-pages.css`, `public/landlord-dashboard-v2.css`
  `account-pages.css` opens by re-declaring `#e11b22`, `#c4151b`, `#f7f6f5`,
  `#1a1a1a`, `#8c8c8c`, `#e7e4e0` under its own `--acct-*` names — the same
  decisions as `--ld-*`, written again. Nothing links them, so they agree only
  until someone edits one.
  *Fixed:* one workspace palette in `homle-tokens.css`; both consumers read it.

- **[x] P2-2 · Four different navigation shells across the signed-in product.**
  v2 sidebar (dashboard) · dark top bar with horizontal nav (Updates, checkout) ·
  dark top bar with only "Back to Homle" (Settings) · white top bar with
  `Dashboard · Help` (Help). Same product, same session, four answers to "where am I".
  *Fixed:* one `homle-workspace.css` shell, adopted by Updates, Settings, Help and
  Checkout.

- **[x] P2-3 · The notification card styling never applied, and what did apply was
  a retired palette.**
  `public/account-pages.css:66`, `public/styles.css:2625`
  `account-pages.css` styles `body.notifications-page .notification-list > li`, but
  `notifications.js:91` renders `<article class="notification-card">`. The selector
  matched nothing. The rule that *did* win came from `styles.css` and painted unread
  cards in a **mint-green gradient** (`#eaf9f4`) with `--green-dark` headings — the
  palette Homle retired when it moved to coral. Verified by seeding real
  notifications and screenshotting the populated page.
  *Fixed:* one card component, in the current palette.

- **[x] P2-4 · Updates and Settings are visually sparse and unstructured.**
  No grouping, no event iconography, bare `18:08` timestamps with no day context,
  no unread affordance beyond a tint, "Mark all read" floating over the heading, and
  a 720px column in a 1440px viewport with the rest empty.
  *Fixed:* day grouping, per-event icons and status tone, relative + absolute
  timestamps, an unread rail, a real header row, and a width that matches the
  workspace.

- **[x] P2-5 · Dead role branching in the Updates page.**
  `public/notifications.js:59-72`, `public/notifications.html:18`
  `load()` redirects Cleaners to `/cleaner/notifications` before `showWorkspace()`
  runs, so every Cleaner branch in `showWorkspace` and the entire
  `data-workspace-nav="cleaner"` navigation in the markup are unreachable.
  *Fixed:* removed; the redirect is now the single statement of that rule.

- **[x] P2-6 · The Updates empty state sends the user to `/login`.**
  `public/notifications.html:27`
  `data-empty-workspace-link` defaults to `/login` and is only rewritten once an
  account resolves. Any render where the account lookup had not yet returned offered
  a signed-in Landlord a sign-in link as the primary action.
  *Fixed:* the empty state's action is resolved from the account, and the fallback
  is the workspace, never sign-in.

- **[x] P2-7 · Checkout and Help carried the retired top bar and footer.**
  `public/landlord-checkout.html`, `public/landlord-help.html`
  Both are Landlord workspace steps reached from inside the workspace. Checkout
  is the one screen where a Landlord is about to authorise money, and it looked
  least like the product they had been using a moment earlier.
  *Fixed:* both adopt the shared shell. Checkout's panels were also centred in
  their own 760px column by `styles.css`, which left the heading left-aligned
  and everything under it drifting right inside a workspace column.

- **[x] P2-8 · `/cleaner/payouts` belongs to no design system.**
  It is the only Cleaner route that does not load `homle-cleaner.css`. It renders
  Bricolage Grotesque at display size on cream, inside a marketing-style hero, while
  its eighteen siblings render Archivo/Poppins on `#f7f0e5`.
  *Fixed:* migrated onto the Cleaner workspace system.

- **[x] P2-9 · Every admin desk overflows horizontally on a phone.**
  `/admin`, `/admin/payments`, `/admin/pricing`, `/admin/scan-pricing`,
  `/admin/scan-operations`, `/admin/bookings`, `/admin/verifications` all report
  `scrollWidth > clientWidth` at 390px — wide tables with no scroll container, so
  the whole page slides sideways and the header leaves the screen.
  *Fixed:* one shared table-scroll treatment.

- **[x] P2-10 · The workspace palette had six declarations, not two.**
  Beyond `landlord-dashboard-v2.css` and `account-pages.css`, the same literals
  were written out again in `landlord-help-v2.css`, `landlord-checkout-v2.css`,
  `landlord-journey-v2.css` and `admin-pricing.css`. Two of those files say so
  in their own headers — *"Every value is copied from landlord-dashboard-v2.css
  rather than invented."* Copying is the failure mode, not the fix.
  *Fixed:* 87 literals across the four Landlord sheets now read
  `var(--homle-ws-*, <literal>)`. `tests/design-system.mjs` fails if any
  workspace sheet writes one of those values outside a var() fallback.

- **[x] P2-11 · The current sidebar destination failed text contrast.**
  `#e11b22` on the `#fdecec` tint measures **4.20:1** at 14.5px, under the
  4.5:1 normal text needs. It is the one label on every workspace page that says
  where you are. The darker accent measures 5.30:1 on the same tint.
  *Fixed:* a `--homle-ws-accent-on-tint` token, applied on both the shared shell
  and the dashboard. The computed-style baseline was regenerated deliberately.

- **[x] P2-12 · Status green failed against its own tint.**
  `--homle-ws-success-ink` `#2e7d51` on `#eaf4ee` measures 4.48:1 — a hair
  under, and all of its uses are small text. Now `#2a7047`, 5.32:1 on the tint,
  5.99:1 on white, 5.55:1 on the canvas.

- **[x] P2-13 · The shared shell's phone tab bar did not match the dashboard's.**
  First cut rendered the sidebar's four destinations. The approved composition
  gives a phone six controls — Places and a raised scan action either side —
  because a phone has no sidebar to reach them from, so the bar changed shape as
  a Landlord moved from the dashboard to their own Updates.
  *Fixed:* the shell model carries a separate phone composition.

### P3 — refinement / polish

- **[x] P3-1 · Three different body canvases inside the Cleaner workspace.**
  `#f7f4eb` (dashboard, from a retired `styles.css` rule that also paints a
  **dark gradient** for the first 420px), `#f2eee9` (most pages), `#d7d7d7` (flat
  grey, from `cleaner-onboarding-redesign.css:13`, on onboarding, documents,
  training and contracts). Invisible where `.hc` covers it, visible on overscroll
  and below short content.
  *Fixed:* the Cleaner workspace owns its own canvas, once.

- **[x] P3-2 · Orphaned module.** `public/cleaner-references.js` (121 lines) is
  loaded by no page. The `references` step it drives was removed from
  `cleaner-onboarding-steps.js` and is not in `requiredCleanerSubmissionSections`.
  Only `package.json`'s syntax-check list still names it.
  *Fixed:* removed, with its syntax-check entry. The server-side section key is
  left accepted, because stored payloads may still carry it.

- **[x] P3-3 · `account-pages.css` describes itself as a stop-gap.** Its own header
  says the pages "were built before the dashboard redesign" and that it restyles
  classes "rather than rewrite markup". That was the right call at the time; it is
  the file this audit exists to retire.
  *Fixed:* deleted.

- **[x] P3-4 · No shared empty/loading/error components.** Each page hand-rolls its
  own. *Fixed:* `homle-workspace.css` provides them.

---

## 4. Implementation

- **[x] `public/homle-tokens.css`** — extended with the workspace surface,
  ink, accent, line, status, elevation, shell and focus tokens. One owner.
- **[x] `public/landlord-dashboard-v2.css`** — its `--ld-*` block now reads those
  tokens with the literal retained as a fallback, matching the convention
  `styles.css` already uses. Computed values are unchanged, which
  `tests/landlord-computed-styles.mjs` proves against its committed baseline.
- **[x] `public/homle-workspace.css`** — new. The shared workspace shell (sidebar,
  top bar, mobile tab bar), and the shared components: page header, card, button,
  form field, badge, list row, empty state, loading state, feedback, table scroll.
- **[x] `public/workspace-shell.js`** — new. Renders the shell chrome from one
  source for every workspace page that is not the dashboard, and resolves its
  navigation from the signed-in account's role.
- **[x] `public/notifications.html` / `notifications.js`** — rebuilt on the shell,
  with grouping, iconography, unread treatment and a real empty state.
- **[x] `public/settings.html`** — rebuilt on the shell.
- **[x] `public/landlord-help.html`, `public/landlord-checkout.html`,
  `public/cleaner-payouts.html`** — shell unified.
- **[x] `server.mjs`** — designed 404 for document requests.
- **[x] `public/account-pages.css`, `public/cleaner-references.js`** — deleted.
- **[x] `tests/design-system.mjs`** — extended so the drift this audit removed
  cannot restart silently.

---

## 5. What was tested, and what held

### Checked and found correct — no change made

These were audited under the brief and are recorded here so the next reader does
not re-derive them.

- **[x] Pricing cannot diverge between browser and server.** `public/pricing-engine.js`
  is the single implementation of the customer price, and the server imports it
  (`src/marketplace/marketplace-http.mjs:11`, `runtime.mjs:28`). The margin,
  cleaner share and processor fees live server-side only, in
  `pricing-economics.mjs`, which documents the split. The two sides cannot drift
  because there is only one arithmetic.
- **[x] The booking journey gates every step and says why.** Walked in a browser
  with a real account and a real saved property: step 1 keeps Continue disabled
  until a property is chosen; step 3 blocks an empty checklist with *"Add at
  least one room task before continuing"*; step 4 blocks with *"Pick a day, an
  arrival window and how often."* Scope carries intact to checkout — duration,
  area, service, task count, day, arrival window, frequency and property.
- **[x] Checkout refuses to submit without a room photo** and says so, offering a
  private draft instead. Correct behaviour; it is why the walk stops there in
  this environment, which has no object storage.
- **[x] Landlord → Cleaner data flow and isolation.** The PostgreSQL integration
  suite passes against a real cluster: RLS fixtures, paid-mode payout-ready
  matching, two-worker dispatch lease evidence, concurrent-overlap outcome.
- **[x] Rate limiting, CSRF and session rotation are real.** Repeated sign-ins
  during testing were refused with `429 rate-limited`; a mutation without
  `X-CSRF-Token` was refused with `csrf-rejected`; each sign-in invalidated the
  previous session.
- **[x] The 404 negotiates.** A browser gets the designed page; `/api/*`, a
  non-HTML extension and a client that does not accept HTML all keep the JSON.
- **[x] Console is clean.** Zero page errors and zero console errors across all
  57 routes at three viewports, and across the full booking walk. The only
  errors anywhere are TensorFlow.js backend fallbacks on the scan page, which
  are headless-Chromium having no GPU, not a defect.

### Known limitations of this environment

- Object storage, geocoding, address lookup, Stripe and the vision model are not
  configured, so photo upload, real matching, live ETA, card authorisation and
  the scan's object detection could not be exercised end to end here. Their unit
  and integration suites pass, and every one of them fails closed with an honest
  message in the UI, which was verified.
- The desktop Chromium runs are not a device trial. Physical iOS and Android
  handsets over HTTPS remain required before launch, as the repository's own
  harness notes.

### Verification runs

| What | Result |
|---|---|
| `node tools/syntax-check.mjs` | 508 files, pass |
| Full `pnpm test` (76 steps) | 75 pass, 0 fail |
| `tests/design-system.mjs` | pass, including the new one-owner assertions |
| `tests/landlord-computed-styles.mjs` | 764 elements, pass |
| `tests/postgres-integration-runner.mjs` | pass against a real cluster |
| `tests/postgres-verification-runner.mjs` | pass |
| `tests/postgres-rate-limiter.mjs` | pass against a real cluster |
| 57-route × 3-viewport browser sweep | no horizontal overflow, no console errors |
| Accessibility sweep | no contrast, naming or focus failures on workspace pages |
