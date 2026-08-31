# Homle master audit

Full-application design, functional, integration and security audit, and the
record of what was implemented in response.

Route-by-route coverage lives in **`HOMLE_ROUTE_MATRIX.md`**. This file carries
the findings, the fixes and the evidence.

**Method.** The application was not read only as source. A local PostgreSQL 16
cluster was bootstrapped through the project's own
`tools/bootstrap-staging-database.mjs` (105 locked migrations), a TLS SMTP sink
supplied real verification mail, an S3-compatible object store ran on loopback,
and `server.mjs` was run with the marketplace, authentication, email, realtime
and media boundaries all reporting ready. Three accounts — two Landlords and a
Cleaner — were registered, verified, signed in and onboarded through the real
HTTP API. Every route was then rendered in headless Chromium over the DevTools
Protocol at 1440×900, 834×1112 and 390×844, signed out and again signed in, with
console output, uncaught page errors, every network response of 400 or worse,
computed styles, layout overflow and touch-target sizes recorded per page and
per viewport.

**Statuses.** `[ ]` not started · `[~]` in progress · `[x]` verified ·
`[!]` blocked.

`[x]` means a check was run and passed, and the Verification field says which.
It does not mean "looks right".

---

## 1. The design system, as it actually is

The approved composition is the Landlord v2 workspace. Extracted from it and from
`homle-tokens.css`:

| Decision | Value |
|---|---|
| Canvas | `#f7f6f5` |
| Surface / card | `#ffffff` |
| Ink / soft ink | `#1a1a1a` / `#3a3a3a` |
| Muted ramp | `#666666`, `#6b6b6b`, `#707070` (contrast-led, ≥4.5:1 on canvas) |
| Accent | `#e11b22`, hover `#c4151b`, tint `#fdecec`, on-tint `#c4151b` |
| Lines | `#efedeb`, `#e7e4e0`, `#e1deda` |
| Success | `#2e9e63` / ink `#2a7047` / tint `#eaf4ee` (ink darkened from `#2e7d51`, which measured 4.48:1) |
| Warning | ink `#9a6d14` / tint `#fbf1df` |
| Type | DM Sans body **and** headings on workspace surfaces; Bricolage Grotesque for voice |
| Radius | 11px buttons · 12px fields and nav rows · 20px cards · 22px panels · 999 pills |
| Elevation | `0 1px 2px …/.05, 0 6px 16px …/.06` for cards; one deeper step for overlays |
| Shell | 240px white sidebar ≥900px; top bar with title, bell, avatar; floating bottom tab bar <900px |
| Focus | 3px `#2456e6`, offset 2px |

**The problem was never that these values were unknown.** They were declared six
times, as literals, in six files — `landlord-dashboard-v2.css`,
`account-pages.css`, `landlord-help-v2.css`, `landlord-checkout-v2.css`,
`landlord-journey-v2.css` and `admin-pricing.css` — so "one design system" was a
coincidence maintained by hand, and it had already started coming apart.

There are now **four** intended systems, and that is deliberate rather than
drift: the public landing composition, the account-entry composition, the shared
signed-in workspace (Landlord v2 plus `homle-workspace.css`, one palette from
`homle-tokens.css`), and the Cleaner workspace. The administrator desks belong to
none of them — see **D-1**.

---

## 2. Findings

Each finding carries the same fields, so a reader can act on it without
re-deriving it:

**ID · Priority · Area** — **Problem** — **Evidence** — **Root cause** —
**Fix** — **Files** — **Verification** — **Status**

### P0 — blocks production, security, payments or data

None outstanding. One was found and fixed during this audit: **S-1**.

---

**S-1 · P0 · Security / abuse**

- **Problem.** Every authenticated marketplace write was unthrottled. Sign-in,
  signup, password reset and the metered provider calls each had an allowance;
  once a session existed, none of the 59 routes behind
  `protect({ mutation: true })` had one.
- **Evidence.** Against the running stack, one session, one sequential loop:
  **400 properties created in 2.5 seconds, all `201`**, no refusal at any point.
  Not extrapolated — measured, and the rows counted in the database afterwards.
- **Root cause.** `rateLimitPolicyFor()` (`server.mjs:374`) returns `null` for
  everything under `/api/marketplace/`, and the marketplace router applied
  `limitPublicRead` to only 10 of its routes — the expensive reads and the
  metered provider calls. Authenticated writes were never in scope for either.
- **Fix.** An allowance at `protect({ mutation: true })`, the one place all 59
  routes pass through. Keyed by **account**, not address, so an office or
  carrier NAT does not put unrelated people in one bucket. Charged last, after
  origin, CSRF and role, so a request that has not proved which account it comes
  from cannot spend that account's budget — otherwise a third party could drain
  a victim's allowance with cross-site requests they cannot even sign.
  300 per 15 minutes; the heaviest genuine session (a Landlord walking the
  booking journey, a Cleaner working a job) lands near 100.
- **Files.** `src/marketplace/account-security.mjs`,
  `src/marketplace/runtime.mjs`, `src/marketplace/postgres-rate-limiter.mjs`,
  `db/migrations/105_marketplace_mutation_rate_limit.sql`,
  `db/migration-lock.json`, `tests/account-security.mjs`.
- **Verification.** Same 400-write run after the change: **300 through, 100
  refused `429`**, nothing in the server log. `tests/account-security.mjs`
  asserts the allowance is charged on an accepted mutation, not charged on a
  read, and not charged on a mutation refused for origin, CSRF or role.
- **Status.** `[x]`

> Migration 105 also widens `request_rate_limits_request_count_check`. It was
> sized for the largest policy of the day (120) and the function clamps to
> `maximum + 1`, so a 300 allowance made every write past 121 fail the CHECK and
> answer `503 abuse-control-unavailable`. The database caught that on the first
> run rather than letting the counter silently wrap.

**S-4 · P0 · Security** — *An account at its mutation allowance could not sign
out.*

- **Problem.** The allowance added in **S-1** is charged in
  `protect({ mutation: true })`, and the authentication router shares the same
  `security` instance — so `POST /auth/logout` and `/auth/logout-all` spent it
  too. An abuse control was blocking a security control.
- **Evidence.** Found by an independent code reviewer, then measured: a
  dedicated account driven to its allowance, then
  `POST /api/marketplace/auth/logout` → **`429 rate-limited`**. Somebody who
  believes their account is compromised could not end their sessions.
- **Root cause.** I wrote in `account-security.mjs` that the authentication
  router "composes unchanged" because "its own routes are already throttled by
  scope". Both halves were wrong: this runtime passes the metered instance into
  that router, and logout, onboarding and workspace-switch carry no scope of
  their own.
- **Fix.** `protect` takes `allowance: false`, and sign-out uses it. The same
  opt-out fixes a second problem in the same finding: three marketplace routes
  carry `mutation: true` for the CSRF and origin checks but **store nothing**
  and already spend a read allowance — a single scan review, which re-previews
  on every object correction, could burn a third of the write budget without
  writing anything.
- **Files.** `src/marketplace/account-security.mjs`,
  `src/marketplace/authentication-http.mjs`,
  `src/marketplace/marketplace-http.mjs`, `tests/mutation-allowance.mjs` (new).
- **Verification.** Same flood re-run: **300 writes allowed, 20 refused `429`,
  and `POST /auth/logout` → `200`.**
- **Status.** `[x]`

**S-5 · P1 · Test integrity** — *The S-1 fix's wiring was covered by no test.*

`tests/account-security.mjs` proves the module honours an allowance it is
handed. Nothing proved the application hands it one: **deleting the
`onMutation:` line from `runtime.mjs` reverted the whole P0 and the entire
196-file gate stayed green.** Found by the same reviewer.
`tests/mutation-allowance.mjs` now asserts the wiring, the account keying, the
scope name, both exemptions, and — separately — that the `request_count` CHECK
ceiling covers the largest policy, which is the invariant migration 105's own
header describes and which had been fixed by hand without a guard. Confirmed by
reverting each and watching it fail. **Status `[x]`.**

**F-7 · P0 · Broken feature** — *Cleaner live notifications were dead in Chrome,
on all nineteen Cleaner pages.*

- **Problem.** `GET /api/marketplace/notifications/events` called
  `requireOrigin`. **Chrome sends no `Origin` on a same-origin `EventSource`
  GET.** The Landlord client had been moved to a streamed POST to work around
  exactly that; the Cleaner client, on `notification-badge.js`, had not. So
  every Cleaner page opened the stream, got `403`, and — because Chrome does not
  retry a non-200 SSE — silently never reconnected. The Cleaner unread badge
  only ever updated on `visibilitychange`.
- **Evidence.** An independent QA reviewer swept 16 Cleaner routes with a real
  Cleaner session: `403` on 12 of them, `[]` on the Landlord equivalent. I
  reproduced it in Chrome, then measured the headers with a capture server: a
  same-origin EventSource arrives with `accept: text/event-stream`,
  `sec-fetch-site: same-origin`, `sec-fetch-mode: cors` and **no `Origin` at
  all**.
- **How my own sweep missed it.** I swept Cleaner routes only with a *Landlord*
  session, which the role gate refuses before the badge runs, and my signed-in
  Cleaner checks did not watch network failures. A whole side of the marketplace
  had a dead feature behind a `PASS`.
- **Fix.** `requireBrowserSameOrigin` accepts an exact `Origin` **or**
  `Sec-Fetch-Site: same-origin`. Those headers are forbidden header names —
  page script cannot set or override them, and a browser sets `cross-site` when
  it is one — so this is a real same-origin proof against the threat CSRF exists
  for. It fails closed: a browser sending neither is refused and the badge falls
  back to the polling it already does.
- **Files.** `src/marketplace/account-security.mjs`,
  `src/marketplace/marketplace-http.mjs`, `tests/account-security.mjs`.
- **Verification.** Chrome, same probe: `[]` on every Cleaner route. And the
  control still refuses what it must — an exact `Origin` passes; no `Origin`
  with `sec-fetch-site: same-origin` passes; a **hostile `Origin` is refused
  even when `same-origin` is claimed**; `cross-site`, `same-site`, `none` and
  neither-header are each `403`; signed out is `401`.
- **Status.** `[x]`

**F-8 · P1 · Correctness** — *A duplicate key answered `500`, and told the caller
whether any UUID existed.*

- **Problem.** No `23505` handling anywhere, so a unique-violation fell through
  to `500 internal-error`. Three ordinary situations looked like a broken
  server: retrying a create with the same client-supplied id (which is the
  journey's own recovery path), a double-click on a support request (whose
  idempotency key exists precisely so the second one is safe — six concurrent
  calls with one key produced four `201`s and two `500`s), and probing another
  tenant's property id, where **`500` versus `201` was a clean oracle for
  whether that id exists anywhere in the system.** RLS does not help: the
  primary-key index is global.
- **Fix.** `errorResponse` maps `23505` to `409 already-exists` with one message
  for every case, so the answer carries no more than the status. The browser
  already handles `409` on these routes by re-reading its own list.
- **Verification.** Re-run: first create `201`, same id again `409`, a fresh id
  `201`, an id already in use `409`; six concurrent support requests sharing one
  retry key produced **one row** and no `500`.
- **Residual.** `409`-versus-`201` still distinguishes "this UUID is in use",
  which for an unguessable v4 id is not usefully exploitable but is not nothing.
  The complete fix is an owner-scoped idempotency key rather than a
  client-chosen primary key — the shape support requests already use. That needs
  a migration and client changes on two resources. **Recorded, not done.**
- **Status.** `[x]` for the `500`; `[ ]` for the residual.

**F-9 · P1 · Layout** — *954px of sideways scroll on the primary Landlord
screen, and an overflow check that was blind to it.*

- **Problem.** A property name of 160 unbroken characters — exactly what the
  server accepts, `201` — pushed `/landlord/bookings` to
  `documentElement.scrollWidth 1344` at `innerWidth 390`, and 2358 at 1440. The
  card heading had no `overflow-wrap`.
- **The worse half.** My overflow metric compared `scrollWidth` to
  `innerWidth` **under mobile emulation**, and Chrome *expands the layout
  viewport* to fit overflowing content — so `innerWidth` became 1344 too and the
  check reported "no overflow" precisely when overflow was worst. The audit's
  "zero horizontal overflow on any route at any viewport" was measured with an
  instrument that cannot see this class of defect. The reviewer caught it only
  because they measured at `mobile: false`.
- **Fix.** `overflow-wrap: anywhere` and `min-width: 0` on the heading —
  `anywhere` rather than `break-word` so the wrap is counted in the intrinsic
  minimum width, which is what stops the grid track widening in the first place.
- **Verification.** Same 160-character name, measured at `mobile: false`:
  390px → 380, 834px → 824, 1440px → 1430. No page overflow at any width.
- **Status.** `[x]`

### P1 — broken important functionality

**F-1 · P1 · Design / navigation** — *The Updates page was not in the workspace.*

- **Problem.** A Landlord reaches Updates from the Account view, the sidebar bell
  and the account menu. All three left the workspace: a dark near-black top bar
  with a horizontal `Dashboard · Properties · Updates` nav, a 760px centred
  column, a dark footer, and **no bottom tab bar at all on a phone** — so the
  five destinations a Landlord has on every other screen vanished.
- **Evidence.** Rendered at three viewports with a real Landlord session.
- **Root cause.** The page predates the dashboard redesign and was restyled by
  `account-pages.css`, a file whose own header called itself a stop-gap.
- **Fix.** Rebuilt on the shared workspace shell, with day grouping, per-event
  icons, relative and absolute timestamps, an unread rail and a real empty state.
- **Files.** `public/notifications.html`, `public/notifications.js`,
  `public/notifications.css`, `public/notification-inbox-model.js`.
- **Verification.** `tests/notification-inbox-ui.mjs`; signed-in browser sweep
  shows canvas `#f7f6f5` and DM Sans, matching the dashboard exactly.
- **Status.** `[x]`

**F-2 · P1 · Security / role boundary** — *Cleaner chrome rendered for accounts
with no Cleaner workspace.*

- **Problem.** Opening any of the nineteen Cleaner routes with a signed-in
  **Landlord** session painted the full Cleaner sidebar: a `CLEANER` identity
  pill, Activity / Jobs Map / Messages / Performance, the whole Account group,
  and an unread count — above the words *"This account has no Cleaner
  workspace."* On `/cleaner/dashboard` there was no gate heading at all.
- **Evidence.** Browser probe with a verified Landlord session
  (`roles: ["landlord"]`, confirmed from inside the page), all four sampled
  Cleaner routes, recorded before and after.
- **Root cause.** Two of them. `renderCleanerShell()` runs at module load, before
  any account is known, and painted unconditionally. And the earlier fix for this
  defect on `/cleaner/payouts` (recorded below as the original P1-2) gated the
  page's **content** and left its **chrome** alone — so consolidating nineteen
  hand-copied asides into one renderer made the same wrong thing happen
  uniformly instead of fixing it. **This audit introduced the uniformity; it did
  not introduce the defect, and it did not fix it the first time.**
- **Fix.** The sidebar now answers the same question the content gate answers,
  from the same shared `dashboardWorkspaceAccess(account, "cleaner")` rule: built
  hidden, revealed only once a Cleaner workspace is confirmed, and **removed**
  from the DOM otherwise — not merely hidden, so nothing reads it out to
  assistive technology or reveals it later. A tab that has already confirmed
  access skips the wait, so a Cleaner never sees the sidebar appear late; that
  marker grants nothing on its own, since every read is authorised server-side.
- **Files.** `public/cleaner-sidebar.js`, `public/cleaner-page.js`,
  `public/cleaner-access-marker.js` (new, one owner for the per-tab marker),
  `tests/cleaner-shell-boundary.mjs` (new).
- **Verification.** Re-probed in the browser: a Landlord now gets no pill, no
  nav, no counts, on all four routes; a Cleaner (after switching workspace) gets
  the full sidebar on all five, both shells.
- **Status.** `[x]` — but only after a second round; see **F-6**.

**F-6 · P1 · Security / role boundary** — *My fix for F-2 had a bypass, and it
was the mechanism the fix added.*

- **Problem.** The per-tab marker that lets a returning Cleaner skip the wait
  was consulted with an **early return**: `if (rememberedCleanerAccess()) return
  revealCleanerShell();`. `sessionStorage` is per-tab and survives sign-out, and
  nothing cleared the marker on sign-out. So a Cleaner signs out, a Landlord
  signs in **in the same tab**, and the sidebar is revealed with no account
  check ever running.
- **Evidence.** Found by an independent code reviewer and reproduced exactly:
  a session with `roles: ["landlord"]` on `/cleaner/dashboard` showed the
  **CLEANER pill and eleven Cleaner destinations**. The five Cleaner pages that
  do not use `createCleanerPage` — the dashboard among them — never corrected
  it. My own browser re-probe could not have caught this: it used a fresh
  Landlord session in a tab that had never confirmed Cleaner access.
- **Root cause.** I treated a cache as an answer. The same reviewer found the
  mirror-image fault: a transient network failure **removed** the sidebar, and
  since `revealCleanerShell()` cannot restore a removed node, a real Cleaner
  whose connection flapped for one request lost their navigation until a full
  reload.
- **Fix.** The marker is now a head start and nothing more: it reveals
  optimistically and the check still runs and still corrects. Sign-out clears
  it. And the decision has **three** answers rather than two — reveal, remove,
  or *leave alone* — because a 5xx or a dropped connection is not a verdict in
  either direction. The decision moved into `public/cleaner-shell-decision.js`
  so a test can run the real one.
- **Files.** `public/cleaner-shell-decision.js` (new),
  `public/cleaner-sidebar.js`, `public/account-menu.js`,
  `tests/cleaner-shell-boundary.mjs`.
- **Verification.** The browser probe that reproduced the bypass now shows the
  sidebar removed and the marker cleared. `tests/cleaner-shell-boundary.mjs` was
  rewritten: it **executes** the real decision against ten outcomes rather than
  reading the source, because the reviewer was right that its first version
  counted string occurrences and compared character offsets as if they were
  execution order. Confirmed by reintroducing both faults and watching it fail.
- **Status.** `[x]`

**F-3 · P1 · Error handling** — *No 404 page.*

- **Problem.** Any unmatched path returned `{"ok":false,"error":"Not found."}` as
  `application/json`, which a browser renders as unstyled Times New Roman on
  white. Every mistyped URL, stale bookmark and expired share link landed there.
- **Evidence.** `curl` and browser, before and after.
- **Root cause.** The 404 fall-through had one branch, written for API clients.
- **Fix.** `wantsHtmlDocument()` distinguishes a document request from an API
  one; documents get a designed 404 in the app's design system, API paths keep
  the JSON body.
- **Files.** `server.mjs`, `public/not-found.html`, `public/not-found.css`,
  `public/not-found.js`.
- **Verification.** A browser gets the page; `/api/*`, a non-HTML extension and a
  client that does not accept HTML all still get JSON.
- **Status.** `[x]` *(the page carries no shell chrome and no skip link — see
  **D-4**)*

**F-4 · P1 · Test integrity** — *Thirteen test files were not run by
`pnpm test`.*

- **Problem.** Ten were named by no script at all. A test nothing runs is worse
  than a test nobody wrote: it reads as coverage on the file listing and provides
  none.
- **Evidence.** Following the `pretest` / `test` / `posttest` chains through the
  60-odd scripts they fan out to: 182 of 195 files reached.
- **Root cause.** The gate is three lifecycle hooks chaining named scripts, so a
  new suite is only covered if someone remembers to add it.
- **Fix.** All thirteen added; `tools/check-test-gate.mjs` now fails the build if
  a file in `tests/` is unreached, and equally if the gate names a file that no
  longer exists.
- **Files.** `package.json`, `tools/check-test-gate.mjs` (new).
- **Verification.** All 196 files reached; all thirteen pass as they stood, so
  this was a wiring gap, not a set of broken suites being skipped.
- **Status.** `[x]`

> **Correcting an earlier report of mine.** I previously told the owner that 83
> files sat outside the gate. That number came from scanning the scripts for
> literal `tests/…` paths *without following the `pnpm run` chains*, so it
> counted files that were in fact covered. The real gap was 13.

**F-5 · P1 · Process** — *The Cleaner Dashboard freeze test was red on the
pushed branch.*

- **Problem.** `tests/cleaner-dashboard-freeze.mjs` pins the Cleaner surface
  byte-for-byte because a product objective said it must not change. This
  audit's sidebar consolidation changed 30+ Cleaner files and deleted one, so the
  test failed — on already-pushed commits, while I was reporting the suite green.
- **Evidence.** `88 !== 89` at `tests/cleaner-dashboard-freeze.mjs:96`,
  reproduced against a clean checkout of `HEAD`.
- **Root cause.** I did not run the full gate after that commit, and the file's
  own instruction — *"do not refresh this digest unless the user explicitly
  replaces the no-change objective"* — makes this a decision, not a fix.
- **Fix.** Asked the product owner. They replaced the no-change objective with
  the design-unification objective and authorised the refresh, which is recorded
  in the file itself. **The shared Cleaner-outcome digest — who is offered a job,
  on what terms, what they earn, whether it is dispatched — has not moved and is
  not authorised to.**
- **Files.** `tests/cleaner-dashboard-freeze.mjs`.
- **Verification.** Both digests assert; the backend one is unchanged from before
  the audit.
- **Status.** `[x]`

### P2 — significant design or UX inconsistency

All of the following are `[x]`; each names the check that holds it.

| ID | Area | Problem | Fix | Verification |
|---|---|---|---|---|
| **D-2** | Palette | The workspace palette was declared as literals in **six** files. Two of them said so in their own headers — *"Every value is copied from `landlord-dashboard-v2.css` rather than invented."* Copying is the failure mode, not the fix. | One owner in `homle-tokens.css`; 87 literals across four sheets now read `var(--homle-ws-*, <literal>)`, the fallback keeping the Cleaner workspace unaffected. | `tests/design-system.mjs` fails if any workspace sheet writes one of those values outside a `var()` fallback. `tests/landlord-computed-styles.mjs` holds 764 dashboard elements still across the change. |
| **D-3** | Navigation | **Four** navigation shells inside one signed-in session: the v2 sidebar, a dark bar with horizontal nav (Updates, checkout), the same bar with only "Back to Homle" (Settings), and a white `Dashboard · Help` bar (Help). On a phone, three of them had no bottom bar at all. | One `homle-workspace.css` shell rendered by `workspace-shell.js`, adopted by Updates, Settings, Help and Checkout. | Signed-in sweep: all 13 Landlord routes render canvas `rgb(247,246,245)` and DM Sans, including the 404. |
| **D-5** | Notifications | The notification card styling **never applied** — `account-pages.css` styled `.notification-list > li`, the JS rendered `.notification-card`. What did apply came from `styles.css` and painted unread cards in a **mint-green gradient** from the palette Homle retired when it moved to coral. | One card component in the current palette; the dead rules deleted. | Verified by seeding real notifications and screenshotting the populated page. |
| **D-6** | Notifications | Dead role branching: `load()` redirected Cleaners before `showWorkspace()` ran, so every Cleaner branch and the whole `data-workspace-nav="cleaner"` markup was unreachable. | Removed; the redirect is the single statement of the rule. | `tests/notification-inbox-ui.mjs` |
| **D-7** | Notifications | The empty state offered a signed-in Landlord a **sign-in** link, because `data-empty-workspace-link` defaulted to `/login`. | Resolved from the account; the fallback is the workspace, never sign-in. | `tests/notification-inbox-ui.mjs` |
| **D-8** | Checkout | Checkout — the one screen where a Landlord is about to authorise money — looked least like the product they had been using a moment earlier. Its panels were also centred in their own 760px column, leaving the heading left-aligned and everything under it drifting right. | Shared shell, workspace column. | `tests/landlord-checkout-ui.mjs`, signed-in sweep. |
| **D-9** | Cleaner | `/cleaner/payouts` was the only Cleaner route not loading `homle-cleaner.css`: Bricolage Grotesque at display size on cream, in a marketing-shaped hero, while eighteen siblings rendered Archivo/Poppins on `#f7f0e5`. | Migrated onto the Cleaner workspace system and the shared `createCleanerPage` bootstrap. | `tests/cleaner-payout-ui.mjs` |
| **D-10** | Admin | Every admin desk overflowed horizontally at 390px — wide tables with no scroll container, so the page slid sideways and the header left the screen. | One shared table-scroll treatment; 9 `1fr` → `minmax(0, 1fr)`. | Sweep: **zero** horizontal overflow on any route at any viewport. |
| **D-11** | Contrast | The current sidebar destination — the one label on every workspace page that says where you are — measured **4.20:1**, under the 4.5:1 normal text needs. | `--homle-ws-accent-on-tint`, 5.30:1 on the same tint. | `tests/design-system.mjs` contrast assertions. |
| **D-12** | Contrast | Status green `#2e7d51` on its own tint measured **4.48:1**, and all its uses are small text. | `#2a7047`: 5.32:1 on tint, 5.99:1 on white, 5.55:1 on canvas. | as above |
| **D-13** | Mobile | The shared shell's phone tab bar rendered the sidebar's four destinations; the approved composition gives a phone six controls, with Places and a raised scan action, because a phone has no sidebar. The bar changed shape as a Landlord moved from the dashboard to their own Updates. | The shell model carries a separate phone composition. | `tests/landlord-computed-styles.mjs` at 390px. |
| **D-14** | Cleaner | The sidebar was copied into nineteen HTML files and the copies had drifted into **twelve** shapes. Almost none of it reached the screen: the runtime pruned and replaced both groups on load, so nineteen files disagreed about a navigation that was then overwritten. **Editing a page's sidebar looked like it worked and changed nothing.** | One `renderCleanerShell()` builds both shells; 1,336 lines of markup deleted. | Rendered sidebar measured identical on all nineteen pages before and after. |
| **D-15** | Cleaner | The notification bell on **fourteen** of fifteen Cleaner pages opened `/notifications` — the *Landlord* inbox — which redirects a Cleaner straight back. A wasted round trip and a flash of the wrong page, on every page. | All point at `/cleaner/notifications`; the redirect stays for old links. | `tests/noncleaner-link-integrity.mjs` |
| **D-16** | Caching | The four onboarding pages requested `cleaner-design-preview-motion.css` at two different versions — two cache entries for one file, and two chances to serve a stale one. | One version. | syntax and link integrity checks |

### P3 — refinement

| ID | Area | Problem | Fix | Status |
|---|---|---|---|---|
| **R-1** | Cleaner | Three different body canvases inside one workspace — `#f7f4eb` (with a **dark gradient** for the first 420px, from a retired `styles.css` rule), `#f2eee9`, and flat `#d7d7d7`. Invisible under `.hc`, visible on overscroll. | The Cleaner workspace owns its canvas, once. | `[x]` |
| **R-2** | Dead code | `public/cleaner-references.js` (121 lines) loaded by no page; its step had been removed from the onboarding model. | Deleted, with its syntax-check entry. The server-side section key stays accepted, because stored payloads may still carry it. | `[x]` |
| **R-3** | Dead code | `account-pages.css` described itself as a stop-gap for pages "built before the dashboard redesign". | Deleted. | `[x]` |
| **R-4** | Components | No shared empty, loading or error components; each page hand-rolled its own. | `homle-workspace.css` provides them. | `[x]` |

### Open — found, assessed, not fixed

These are real and recorded rather than quietly dropped. None is a correctness
or security defect; each is a scope call the owner should make.

**D-1 · P2 · Design** — *The eleven administrator desks belong to no design
system.*

- **Evidence.** `/admin` renders on canvas `oklch(0.975 0.015 95)` while every
  Landlord route renders `#f7f6f5`. Three admin sheets declare unrelated
  palettes from scratch with no tokens at all: `admin-launch.css` (31 unique hex,
  teal/green and amber, appearing nowhere else in the product),
  `admin-coverage.css` (18 unique, **four different reds**),
  `admin-funnel.css` (16 unique, red plus teal). There is no shared admin shell —
  navigation differs on **every** page, from three links to seven, and
  `/admin/support` still loads the **retired** `landlord-help.css`, making it the
  oldest-looking page in the product.
- **Measured again, signed in as a real administrator** (provisioned with
  `tools/bootstrap-administrator.mjs`), at 1440px and 390px. They rendered on
  **four canvases at once**: `oklch(0.975 0.015 95)` on eight desks,
  `rgb(247,242,233)` on `/admin/support` from `landlord-help.css`,
  `rgb(247,241,232)` on `/admin/coverage`, and `rgba(0,0,0,0)` on
  `/admin/funnel` — a transparent body, so whatever the browser painted behind
  it showed through.
- **Fix.** `public/admin-navigation.js` owns one list of all eleven desks and
  renders it into whatever container each page provides;
  `public/admin-desk.css` settles the canvas, the ink and that navigation strip
  and is loaded last on all eleven. It deliberately does **not** restyle the
  desks: they are internal tooling with dense tables that work, and rewriting
  them wholesale is how you break an operator's day. The eleven hand-copied
  link lists are now empty containers — they were replaced at runtime, so
  editing one looked like it worked and changed nothing.
- **Correction to the evidence above.** `landlord-help.css` is called "retired"
  in the paragraph above. **It is not.** 19 of its 27 classes are live on
  `/admin/support` and it is also the live sheet for `/landlord/help`; only 2
  of its classes are unreferenced. Removing it would have broken the support
  desk. `admin-desk.css` overrides its canvas instead.
- **A second defect, found by rendering.** The navigation strip mirrored
  `[data-admin-private-workspace]`'s `hidden`, which conflated "you are not an
  administrator" with "this desk's data did not load". Signed in as an
  administrator, `/admin/payments` (404, payments unconfigured) and
  `/admin/pricing` (403 on its preview call) hid the whole strip — so the one
  screen an operator most needs to leave was the one screen with no way out but
  the URL bar. It now asks `/api/marketplace/account` directly, through the same
  three-answer verdict the Cleaner shell uses (`reveal` / `remove` / `leave`
  when the answer is unknown), in `public/admin-navigation-decision.js`.
- **Verification.** All eleven desks measure one canvas (`rgb(247,246,245)`)
  and one font (DM Sans) at 1440px and 390px, with correct `aria-current` and
  no sideways scroll — including the two that cannot load their data. In a
  browser: **11 links for an administrator on every desk; 0 links and nothing
  left in the DOM for a signed-out visitor, a Landlord, and a dual-role
  Cleaner.** `tests/noncleaner-link-integrity.mjs` executes the real verdict
  against 12 outcomes.
- **Status.** `[x]`

**D-4 · P3 · Design** — *The 404 page carries `body.homle-workspace` but never
renders the shell.*

- **Partly withdrawn.** A centred card is the right pattern for an error page,
  and rendering a full workspace sidebar on a 404 a signed-out visitor may hit
  is wrong, not missing. The skip link was added earlier in this work; the page
  is on the shared tokens and workspace sheet, carries a brand mark home, and
  resolves its primary action from the account.
- **What was actually wrong, found by rendering it as each role.** A signed-in
  **administrator** was sent to the marketing site and offered
  `/landlord/help` — a page that refuses them for holding no Landlord
  workspace. An error page whose only two exits are the wrong site and a second
  error is not a recovery.
- **Fix.** `public/not-found-destination.js` decides the way back from the
  account alone, and the help sentence is dropped entirely when there is no
  support page the reader may open.
- **Verification.** Rendered at 1440px and 390px signed out, as a Landlord and
  as an administrator: administrator now goes to `/admin` with the help line
  hidden; Landlord to `/landlord/home`; visitor to `/`. The page had **no test
  at all** before this; `tests/not-found-page.mjs` now runs the real decision
  over nine account shapes.
- **Status.** `[x]`

**D-17 · P3 · Dead code** — *`public/cleaner-reviews.html` and
`cleaner-reviews.js` are orphaned.* The only route pointing at them
(`server.mjs:5568`) is shadowed by a 308 redirect to `/cleaner/performance`
earlier in the request path, so the route entry is unreachable — but the file is
still served at its own filename by the `public/` fallback. A complete page from
the previous Cleaner generation.

**Fixed.** Both files removed. `cleaner-performance.html` had already superseded
them — it reads the same `/api/marketplace/cleaners/{id}/reviews` and carries the
same `data-reviews-*` sockets — so the deletion removed a duplicate of a live
screen, not a feature. The Cleaner freeze's **shared-backend digest was verified
byte-identical** across the change; only the front-end count (90 → 88) and digest
moved. **Status `[x]`.**

*Noted in passing, not fixed:* every page in `public/` is also reachable at its
raw `.html` filename through the static fallback, so each clean URL has a
duplicate address. That is a canonicalisation matter across all 47 pages, not
specific to this orphan, and is recorded rather than churned.

**D-18 · P3 · Navigation** — *`/admin/scan-operations` is linked from nowhere.*
Zero `href` to it anywhere in `public/`. Reachable only by typing the URL.

**Fixed by D-1.** It is one of the eleven entries in `adminDestinations`, so it
now appears on every admin desk. Verified in a browser on all eleven.
`tests/noncleaner-link-integrity.mjs` asserts all eleven desks are present by
name, and the four per-desk suites that used to assert reachability against the
control desk's hand-copied markup now assert it against the shared list — a
stronger property, since it means reachable from all eleven rather than from one.
**Status `[x]`.**

**D-19 · P2 · Design** — *`landlord-dashboard.css` is not retired, and parts of
the dashboard were still on the landing palette.*

- **Problem, as first recorded.** I described this file as a retired sheet
  loaded ahead of its v2 replacement, overridden by it, with nothing visibly
  wrong. **That was wrong, and it mattered.**
- **Evidence.** Of its 211 classes, **110 are used in the live dashboard markup
  and appear nowhere in `landlord-dashboard-v2.css`.** It is not a leftover: it
  is still the only stylesheet for Payments, the Cleaner-profile dialog, the
  photo dialogs, property work, request continuation, favourites, history and
  the whole `pac-*` composition. `landlord-dashboard-v2.css` is a partial
  redesign layered on top. 68 of its classes are genuinely dead; 33 are shadowed
  by v2.
- **What was actually wrong.** Most of its live rules had already been moved
  onto the `--ld-*` family, which is why the page reads as coherent. Three
  blocks had not: the checklist-change note, the Cleaner-profile reviews and the
  payments list still read the **landing** token family — a translucent 1.5px
  edge derived from the landing ink, the landing 16px radius, and
  `--homle-surface`, which is a **cream** mix, inside a workspace that is
  `#f7f6f5`. Five card-shaped surfaces sat at an 18px radius where the workspace
  card is 20px; `.pac-card` at 26px and the photo dialog at 24px where the panel
  is 22px; and the outline button carried a raw `oklch()` edge at 1.5px where
  every other quiet edge is 1px on a named token. **This is the "some areas
  still belong to the old version" complaint, inside the screen the design
  system is measured from.**
- **Fix.** Every one of those now reads a `--homle-ws-*` token with its literal
  as the fallback, matching the convention the rest of the tree uses. No
  landing-family reference remains in the file.
- **Verification.** `tests/landlord-computed-styles.mjs` reported exactly two
  changed properties across its 760-element sample — the payment row's border
  moving from the translucent landing ink to the workspace border — and nothing
  else moved. The baseline was regenerated deliberately and the diff read.
- **The dead-selector half, measured properly and partly withdrawn.** I swept
  every stylesheet against the markup and scripts of the pages that actually
  load it. `landlord-help.css` is **not** dead weight: only **2** of its 27
  classes are unreferenced, and 19 are live on `/admin/support` alone. Naming
  it here alongside the dead selectors was wrong, and D-1 above corrects the
  matching claim that it is "retired". The real counts are
  `landlord-dashboard.css` 65 of 211 unreferenced, `landlord-dashboard-v2.css`
  46 of 332, `styles.css` 352 of 1151, `homle-cleaner.css` 75 of 803.
- **Not fixed, deliberately.** Deleting several hundred CSS rules is a
  visual-regression risk with no user-visible gain, and the sweep has known
  false-positive modes — a class composed at runtime from a template string is
  reported unreferenced when it is not. The measured facts are recorded here so
  the next editor can act on them with a screenshot harness, which is the tool
  this actually needs.
- **Also recorded, not changed.** `landlord-help.html` loads both
  `landlord-help.css` and `landlord-help-v2.css`; `landlord-dashboard.html`
  loads both `landlord-dashboard.css` and `landlord-dashboard-v2.css`. That
  reads like a half-migration and is not one — the v1 sheets are live and the
  pair together produces one look, as the computed-style baseline confirms. It
  is a naming problem, not a design problem.
- **Status.** `[x]` for the palette. **`[ ]`** for the unreferenced selectors,
  which are bytes every reader downloads and a trap for the next editor, but
  from which nothing renders incorrectly.

**D-21 · P2 · Design** — *The "no Cleaner matched" dialog rendered on the
retired green palette.*

- **Problem.** `.landlord-match-outcome-dialog` in **`landlord-dashboard-v2.css`
  itself** — the approved sheet — styled its facts on `var(--homle-line)` (the
  landing edge) over a `#fff9f7` peach, its values in `var(--green-dark)`, and
  its boundary note as `#7d201b` on `#fff1ee`. `--green-dark` resolves through
  `styles.css` to the brand green Homle **left behind when it moved to coral**.
- **Evidence.** Found by the guard added for D-19, not by reading. It is not a
  cosmetic corner: this dialog is what a Landlord reads when their booking
  found nobody — a real outcome on the primary screen.
- **Root cause.** The v2 redesign migrated the sheet's surfaces but not its
  dialogs, and nothing failed when it didn't.
- **Fix.** Workspace tokens throughout: border and radius from the scale, paper
  background, `--homle-ws-ink` values, and the boundary note on the accent tint
  with `--homle-ws-accent-on-tint`, which measures 5.30:1 on that tint.
- **Files.** `public/landlord-dashboard-v2.css`, `public/landlord-dashboard.css`,
  `tests/design-system.mjs`.
- **Verification.** `tests/design-system.mjs` now fails if any workspace sheet —
  including `landlord-dashboard.css`, which is not the retired file it was taken
  for — reads a landing-family token (`--homle-surface`, `--homle-line`,
  `--homle-radius`, `--homle-cream`, `--homle-paper`). Confirmed by
  reintroducing one and watching it fail. `tests/landlord-computed-styles.mjs`
  passes unchanged, so nothing else in the composition moved.
- **Status.** `[x]`

**D-20 · P3 · Accessibility** — *Six pages had no skip link,* against 41 that
did. Four now have one, each with a focusable landmark to land on:
`not-found`, `privacy`, `terms`, `facebook-data-deletion`.

Two deliberately do not. `room-scan.html` is 308-redirected to
`/landlord/book` and never renders. `landlord-journey.html` keeps its `<main>`
hidden behind an access gate, so a skip link would be a visible control that
does nothing until the gate opens — worse for a screen-reader user than no link
at all. Fixing it properly means revealing the link with the shell, which is a
change to the journey's bootstrap rather than a markup addition.
**Status `[~]` — four fixed, two recorded.**

**Q-1 · P2 · Data protection** — *A published retention promise the code does
not implement.* `public/privacy.html:35` states an incomplete cleaning request
keeps its property scope, timing, access and contact entries in the tab *"for up
to 30 minutes"* and is removed on *"expiry"*; the same copy appears on the
landing page and the dashboard. `landlord-journey.js`'s `saveDraft` writes **no
timestamp** and `restoreDraft` reads none, so the draft lives for the life of the
tab. Ten sibling modules do implement the expiry (`account-intent.js`,
`brief-draft.js`, `cleaner-application-draft.js`, `customer-request-draft.js`,
`landlord-request-draft.js`, `room-note-draft.js`, …); the journey — which holds
the most, including the address, the access notes and the dictated transcript —
was the outlier.

- **Fix.** The journey stamps `savedAt`/`expiresAt` from the **shared**
  `landlordRequestDraftLifetimeMs`, so there is one number rather than a second
  copy of the promise, and refuses on read anything it cannot show to be inside
  the window: unstamped, expired, claiming a longer window than the product
  offers, or stamped in the future so a clock change cannot extend it. Every
  refusal discards the draft rather than merely declining to show it.
- **Verification.** `tests/journey-draft-retention.mjs` asserts the promise is
  still stated on all three pages that make it, that the shared lifetime matches
  it, and that each of those four refusals happens — confirmed by removing the
  expiry check and watching it fail. If the promise ever changes, the test fails
  until the constant changes with it.
- **Status.** `[x]`

**Q-2 · P2 · Access** — *Dual-role accounts were locked out of the Landlord
dashboard with no way back.* An account holding both roles with
`selectedRole: "cleaner"` gets a gate on `/landlord/dashboard` whose only action
is "Open Cleaner dashboard" — while `GET /landlord/bootstrap` returns **200 with
their Landlord data**, and `/landlord/book` opens in full and offers them their
own properties. So the dashboard refuses what the booking journey allows, and
there is no "switch to Landlord" control anywhere in the Cleaner shell (the
mirror gate does offer one). Related: `intent` on
`POST /api/marketplace/auth/login` is accepted and ignored — it is read only for
signup and verification resend — so signing in with `intent: "book"` still lands
a dual-role account in the Cleaner workspace.

- **Fix.** The Landlord gate now mirrors the Cleaner one, which already offered
  the switch: "Switch to Landlord workspace" → `/onboarding?intent=book`.
  `showState` gained the `workspaceActionLabel` its counterpart already had.
- **Verification.** Browser, dual-role account with `selectedRole: "cleaner"`:
  the gate offers **"Switch to Landlord workspace"**; following it sets
  `selectedRole` to `landlord`, and `/landlord/dashboard` then opens on
  **"Hello, QA Landlord"**. The ignored `intent` on login is unchanged and
  remains recorded.
- **Status.** `[x]` for the lockout; `[ ]` for the ignored login `intent`.

**Q-3 · P2 · Concurrency** — *The five-open-support-request cap leaked under
concurrency.*

- **Problem.** `SELECT count(*) … >= 5` then INSERT, at READ COMMITTED, with no
  lock and no constraint behind it. Every concurrent transaction saw the same
  pre-insert count and every one passed. Eight concurrent posts against an
  account with one open request accepted **five where four slots remained**.
- **Fix.** A transaction-scoped advisory lock keyed on the account, taken in
  both creators — the support request and the booking-change request. Requests
  from different accounts never contend, so it costs nothing at scale.
- **A second race fixed in the same place.** The lock is taken **before** the
  retry-key read, not just before the count, so a double-click can no longer
  have both transactions miss and race the unique index —
  `create_landlord_support_request` also gains the `ON CONFLICT … DO NOTHING`
  and re-read that its sibling already had.
- **A wrong turn worth recording.** The first version factored the lock into a
  shared `SECURITY DEFINER` helper. That function is owned by whichever role
  runs the migration, and the two creators are owned by `homle_owner`, so the
  inner call was refused and **every support request answered 500**. Inlining is
  the fix; a test asserts the key stays byte-identical between them, which is
  what the helper was for.
- **Files.** `db/migrations/107_serialise_support_request_cap.sql`,
  `tests/support-request-cap.mjs` (new).
- **Verification.** Same probe: **four accepted where four remained**, four
  `409 support-request-limit`. Separately, on an account with all five slots
  free, six concurrent retries sharing one key produced **one row, six `201`s**,
  no `500` and no spurious `409`.
- **Status.** `[x]`

**Q-4 · P2 · Empty states** — *Escape hatches sent a signed-in user to
`/login`.* On `/bookings/<uuid>` and `…/tracking` with an unknown booking, a
signed-in Landlord is offered "My workspace", "Account" and "Sign in", all
pointing at `/login`, which renders a full sign-in form with no indication they
are already signed in. This is the D-7 defect, fixed on the Updates page and
still present on the shared job routes. `/landlord/messages` separately renders
its empty-state sentence **twice**, in two panels.

- **Root cause.** The job page's header links ship pointing at `/login`, because
  a signed-out visitor may legitimately land there, and were only rewritten in
  the **success** path — so every refusal, which is the common case since the
  booking may simply be somebody else's, left all three pointing at sign-in. And
  Messages printed one sentence from two panes that answer different questions.
- **Fix.** The job page resolves its links from the account as soon as the role
  is known, whatever happens to the booking, and only offers "Sign in" when
  there is genuinely no workspace; the refusal now reads "This booking is not on
  your account". The Messages list answers *do you have any conversations*; the
  reading pane answers *which one are you reading* and says nothing when there
  are none.
- **Status.** `[x]`

**Q-5 · P3 · Accessibility** — *One real touch target, and a missing `h1`.*

Re-measured at 390px against the **effective** hit area rather than each
element's own box, which corrects three of the four reported:

| Reported | Re-measured | |
|---|---|---|
| "Sign out" 214×23 | **not under 24px** | `::after { inset: 0 }` genuinely stretches it over its whole row |
| 404 link 113×16 | **not applicable** | an inline link inside a sentence, which WCAG 2.5.8 explicitly excepts |
| `/landlord/book` links | **not under 24px** | those are on the access gate, which a signed-in Landlord never sees |
| `/landlord/help` checkbox 18×18 | **confirmed** | the consent box a Landlord must tick before Homle accepts the request |

- **Fix.** The checkbox is drawn at 18 and padded to 24 with `content-box`, so
  the tick stays the size the composition expects while the finger gets the area
  the guideline asks for. `/landlord/book` gets a persistent visually-hidden
  `h1` — its only one was the access gate's, hidden the moment the shell
  renders, so the whole six-step flow started its heading tree at `h2`.
- **Verification.** The probe reports **0 controls under 24px** on
  `/landlord/account`, `/landlord/help` and `/landlord/book` at 390px.
- **Status.** `[x]`

**Q-6 · P3 · Navigation** — *The six-step booking journey created no history
entries*, so the browser Back button exited the whole flow from step 2 rather
than stepping back — and on a phone Back is the primary affordance on the
product's longest flow.

- **Fix.** Each step change syncs `history`, in one of three modes so that no
  path can strand the reader: a forward move **pushes**, the in-app back control
  and the first render **replace** (so Back never lands on the step it started
  from, and going back in the app leaves no forward entry to the step just
  left), and a `popstate` touches history not at all. The step being left is
  read first, so Back is not a way to lose an answer.
- **Verification.** Browser at 390px: **step 2 → Back → step 1 → Back →
  `/landlord/home`, and Forward → step 1.** Before, step 2 → Back →
  `/landlord/home`.
- **Status.** `[x]`

**Q-8 · P2 · Concurrency** — *The Landlord Messages panel announced itself
ready while its thread was still loading.*

- **Found by** a 1-in-3 flake in `tests/landlord-computed-styles.mjs`: the
  failed-conversation banner rendered in some runs and not others, on whichever
  viewport lost the race. Three identical runs disagreed, so it was neither my
  change nor a stylesheet regression.
- **Root cause.** `selectConversation` began `if (!selected ||
  state.loadingBookingId || state.sending) return;`. `landlord-dashboard.js`
  clears the panel's `aria-busy` when `openLandlordMessages` resolves, and
  `loadWorkspace` refreshes the bookings while a first open is still fetching —
  so two opens overlap routinely, not exceptionally. The second returned
  **instantly** and the panel announced a settled Messages view whose thread had
  not arrived: `aria-busy` came off, the reader and assistive technology were
  told the view was ready, and the content then changed underneath.
- **Fix.** The in-flight load is held in `state.pendingLoad`; an overlapping
  open for the same conversation awaits it rather than returning, and
  `openLandlordMessages` now always awaits `selectConversation`. No duplicate
  request is issued.
- **Verification.** `tests/landlord-messages-concurrency.mjs` executes the real
  module against a controlled network — the defect is entirely in the timing, so
  no source-text assertion could see it. **The test was confirmed to fail
  against the old code and pass against the fix.** Five consecutive
  computed-style baseline runs are clean where one in three failed before.
- **Status.** `[x]`

**Q-7 · P3 · Evidence** — *`/cleaner/jobs-map` cannot be verified by this
harness.* `localPreview` was gated on `location.hostname` being loopback, and
the entire audit ran on `127.0.0.1`, so `loadRealJobs()`, the
`createCleanerPage` gate and the matching API were **never executed**; on
loopback the page hid its access gate, revealed the map, rendered three
fabricated offers and never called `createCleanerPage` at all — so it rendered
in full to a Landlord-only account and to a signed-out visitor. A PASS on a
branch the harness cannot reach is not evidence, and the matrix was corrected
to BLOCKED.

- **Fix.** The hostname branch, `previewJobs()`, the three fabricated offers,
  the `booking.preview` rendering paths, the "Preview examples — not live
  offers" banner and its stylesheet rule are all removed. The page now always
  runs `createCleanerPage("map", loadRealJobs)`. This costs a designer's local
  preview that was never a product feature; it buys a route that can actually
  be tested and a role gate that cannot be skipped by the address you type.
- **Verification.** Rendered at 1440px and 390px: a signed-out visitor and a
  Landlord-only account are both refused by the gate with no map and no cards;
  a Cleaner (workspace activated through `POST /api/marketplace/auth/workspace`,
  the same call the sign-in page makes) gets the gate closed, the map revealed,
  the real empty state, a count of 0, no fabricated content, no page errors and
  no sideways scroll. `tests/booking-dashboard-ui.mjs` now asserts the inverse
  of what it used to: no hostname branch, an unconditional gate, and no
  fabricated offers.
- **Still UNVERIFIED, and an environment limit rather than a code fault.** Map
  tiles and the postcode lookup could not be exercised: this sandbox's egress
  policy rejects `CONNECT` to both `tile.openstreetmap.org` and
  `api.postcodes.io`. The page requested 9 tiles at 1440px and 6 at 390px and
  each failed with `net::ERR_TUNNEL_CONNECTION_FAILED`. **Tile rendering and
  outcode centring remain unverified here and must be checked on an environment
  with outbound access.**
- **The disclosure half of this finding was WRONG when I wrote it.** I recorded
  that neither processor appears in the privacy notice. Both do:
  `public/privacy.html` has a dedicated paragraph under "Sharing and storage"
  naming OpenStreetMap for map tiles and Postcodes.io for the nearest-postcode
  lookup, and describing exactly what each receives. `git log -S` dates it to
  commit `03ece3b` on **16 August 2026**, two weeks before this audit began. I
  did not read the notice carefully enough before recording the finding. No
  change was needed and none was made.
- **Status.** `[x]` for the code path; the tile/outcode rendering is
  **UNVERIFIED** pending an environment with outbound access.

**S-2 · P3 · Security** — *The legacy `/api/admin/*` surface authorises on shape,
not on a key.* `isAdminAuthorised()` (`server.mjs:2314`) returns true with no
key when the server is **bound to loopback**, the client is on loopback, the Host
is local and no proxy headers are present. Reproduced here:
`GET /api/admin/records` → `200` with no credential; adding `x-forwarded-for`
→ `401`.
**Assessed as not exploitable in production**, and the reason is worth stating
rather than trusting: `deployment-readiness.mjs:90` requires
`ADMIN_REQUIRE_KEY=true` and a real `ADMIN_KEY` in production, and
`server.mjs:37` refuses to boot if that preflight fails. The bypass also
requires the server to be *bound* to loopback, in which case only local
processes can reach it at all. So the threat model is an untrusted process on
the application host. Recorded, not changed. **Status `[ ]`.**

**S-6 · P1 · Security** — *Every IP-keyed limit rests on an unverified assumption
about the platform.*

- **Problem.** Under the shipped `render.yaml` (`TRUST_PROXY=true`,
  `TRUST_PROXY_PROVIDER=render`), `trusted-client-key.mjs` never consults the TCP
  peer. It reads `True-Client-IP` and requires only that the same value appear
  somewhere in the `X-Forwarded-For` chain. **A caller who sends both headers
  with the same invented value satisfies that check.**
- **Evidence.** An independent reviewer drove the real resolver with the
  `render.yaml` environment and a fixed socket peer, and got a different
  rate-limit key per request from headers alone.
- **What it would mean.** Every address-keyed control resets per request:
  `login` 10/15min, `signup` and `password-reset-request` and
  `verification-resend` 5/hour, and the two metered provider scopes. Brute-force
  and mail-flood protection would be decorative. The account-keyed
  `marketplace:mutation` allowance from **S-1** is unaffected — which is a point
  in favour of keying by account, not an excuse.
- **Why it is not being changed here.** The code's own comment says Render
  fronts every service with Cloudflare, which *sets* `True-Client-IP` to the
  verified connecting address. If that holds, the header is not caller-supplied
  and the design is sound. If it does not — and `True-Client-IP` is a Cloudflare
  Enterprise-tier header — the whole chain is forgeable. **Nothing in this
  repository verifies which is true, and I cannot verify it from here.**
  Rewriting a security-critical client-identification path on a guess about a
  platform's behaviour is more likely to break legitimate identification than to
  fix anything.
- **What the operator must do, before launch.** Send a request to the deployed
  service carrying `True-Client-IP: 192.0.2.1` and a matching `X-Forwarded-For`
  entry, from a machine whose real address is known, and confirm the rate-limit
  key the server derives is the real address and not `192.0.2.1`. If it is
  `192.0.2.1`, every IP-keyed limit above is bypassable and this is a launch
  blocker. Locally with `TRUST_PROXY=false` the peer address is used and
  spoofing fails: 14 wrong-password sign-ins carrying rotating
  `x-forwarded-for`, `x-real-ip` and `forwarded` headers were still cut off at
  the tenth with `429`.
- **Hardened in the meantime.** Cloudflare sets `CF-Connecting-IP` on every
  request it fronts, and unlike `True-Client-IP` it is not an optional feature.
  The two must now identify the same client whenever both are present, so
  forging only one no longer works. It is deliberately **not** required:
  making an unconfirmed header mandatory would answer `503` on every throttled
  route — sign-in included — if the platform does not send it, and breaking
  sign-in is worse than the gap. `tests/trusted-client-key.mjs` covers agreement,
  disagreement, absence and a malformed value.
- **Status.** `[!]` **BLOCKED — needs one measurement against the real
  deployment.**

**S-7 · P2 · Security** — *Any account can grant itself the other side of the
marketplace, with no step-up.*

`POST /api/marketplace/auth/workspace {"role":"cleaner"}` on a landlord-only
session returns `200` with `roles: ["cleaner","landlord"]` and auto-creates a
Cleaner profile. Only `administrator` is blocked. This is by design — a person
may genuinely be both — and every authorisation decision still uses the union of
held roles, so it grants no access to anyone else's data. Two consequences are
worth a decision rather than an assumption: it unlocks
`GET /api/marketplace/maps/config`, which hands out the Google Maps browser key,
and `cleaner/address-lookup`, a metered provider call; and a self-listed Cleaner
can set `is_public` on their own profile, with `verified` reported as a field
rather than enforced as a gate. Whether an unverified self-listed Cleaner can be
dispatched a job could not be closed out here — no bookings exist in this
database. **Status `[ ]`.**

**S-8 · P2 · Security** — *A Cleaner kept photo access indefinitely after the
job ended.*

- **Problem.** `get_cleaning_request_photo_object` admitted a Cleaner whose
  booking status was `completed`, with no time bound at all, so somebody who
  cleaned a flat once could keep minting signed URLs for photographs of its
  inside for as long as the record existed. Raised from P3: the severity scale
  says low, the content does not.
- **Fix.** Fourteen days from `completed_at`, which covers a dispute or a review
  and matches the window in which a booking can still be disputed. Two adjacent
  holes are closed with it: `awaiting-review`, which a booking can sit in
  indefinitely if nobody reviews and which would otherwise have been a way
  around the bound, and the pre-acceptance preview, which is now bounded to the
  invitation. A booking with no `completed_at` recorded is treated as expired
  rather than as forever. The Landlord who owns the request and an administrator
  are unchanged.
- **Files.** `db/migrations/106_bound_cleaner_photo_access_after_completion.sql`.
- **Verification.** Behavioural, against a real booking row in a transaction
  that was rolled back: the same Cleaner, the same booking, the same photograph,
  only the completion date moving. **Completed 1 day ago → 1 row. Completed 60
  days ago → refused. `completed_at` NULL → refused. The Landlord who owns it →
  1 row, unchanged.**
- **Status.** `[x]`

**S-3 · P3 · Security** — *A correct password on an unverified account returns
`403 email-verification-required`, distinct from `401 invalid-credentials`.* It
fires only after a correct password, so it is not a bare enumeration oracle, but
it does confirm "this account exists and this password is right" in one step.
**Status `[ ]`.**

---

## 3. What was checked and found correct

Recorded so the next reader does not re-derive it.

- **[x] Pricing cannot diverge between browser and server.**
  `public/pricing-engine.js` is the single implementation of the customer price,
  and the server *imports it* (`marketplace-http.mjs:11`, `runtime.mjs:28`).
  Margin, Cleaner share and processor fees are server-only, in
  `pricing-economics.mjs`. The two sides cannot drift because there is only one
  arithmetic. The browser never sends a price.
- **[~] The room-photo chain, end to end, against an S3-compatible store.**
  Intent → presigned `PUT` → `HeadObject` → sharp re-encode → completion → signed
  read. The quarantine key and the final key differ, and the stored bytes differ
  from the uploaded bytes (4031 in, 4032 out), which is the sanitiser actually
  rewriting the image rather than trusting it. Submission then reached
  `searching-for-cleaner` — the step that was BLOCKED before storage existed.

  **What this rested on, and what was done about it.** The store is a test
  double I wrote, and its first version verified **no signatures at all** — it
  accepted unsigned `GET`, `PUT` and `DELETE` on any key in the bucket. An
  independent reviewer demonstrated exactly that, and was right that it made the
  presigned-scope and expiry claims worthless: a double more permissive than the
  real service does not test the thing you think it tests.

  The double now implements SigV4 presigned verification — signature, expiry,
  signed headers and credential scope — and refuses any request carrying neither
  a presigned query nor an SDK `Authorization` header. Re-run against it:

  | Probe | Result |
  |---|---|
  | Unsigned `GET` / `PUT` / `DELETE` on a private key | `403` each (all three were `200`/`204` before) |
  | The app's own read URL, untouched | `200`, and it asks for `X-Amz-Expires=300` |
  | Same signature, key edited to another photo | `403` |
  | Same signature, `X-Amz-Expires` lengthened in the query | `403` |
  | A URL signed with a one-second life, after it lapsed | `403` (`200` before it did) |

  **What that is worth, precisely.** The first four are genuine
  cross-implementation evidence: the URL was signed by the real AWS SDK inside
  the application and verified by a hand-written implementation of the
  specification, so agreement means the app's presign is well-formed and its
  scope is real. The expiry-lapse row is weaker — both ends of it are mine.
  **Still to do against real S3:** bucket policy, server-side encryption
  actually applied, and that the provider enforces the same scope. Construction
  and a second implementation agreeing is not the provider's own enforcement.
- **[x] That chain refuses the four ways it can be abused.** A non-image
  declared `image/jpeg` → `409 unsafe-request-photo`. Bytes of a different size
  than declared → `409 request-photo-mismatch`. Bytes that do not match the
  declared checksum → the store refuses the `PUT` outright with `BadDigest`, as
  S3 does. A **second Landlord**, holding a real `landlord` role, reading the
  first's photo, scan and upload intent → `404` on all three, with no existence
  leak. An uninvited Cleaner → `404`. Signed out → `401`.
- **[x] Cross-tenant isolation is enforced by the database, not only the code.**
  RLS on all 59 `public` tables, policies scoped by
  `tideway_private.current_user_id()`; the app connects as `tideway_app`, which
  is neither superuser nor `BYPASSRLS`. Repositories *also* scope by the actor.
  Cross-tenant reads and mutations were attempted and refused.
- **[x] `administrator` cannot be self-assigned.** `POST /auth/workspace` with
  `{"role":"administrator"}` → `422`.
- **[x] CSRF and origin are real, and CSRF is bound to its session.** A mutation
  without `X-CSRF-Token` → `403 csrf-rejected`; a wrong `Origin` →
  `403 origin-rejected`; no `Origin` at all → `403`. An independent reviewer
  additionally confirmed that account A's CSRF token with account B's cookie is
  refused, and that session A's token with session C's cookie **on the same
  account** is also refused.
- **[!] CORRECTION — sign-in does NOT invalidate the previous session.** An
  earlier version of this document said it did. That was wrong, and it is the
  kind of wrong that matters: a reader would conclude a stolen cookie dies the
  next time the victim signs in. It does not.

  What actually happens: `rotate()` revokes the current session and issues a new
  one, so a **workspace switch** or a **session recovery** revokes. A plain
  sign-in calls `establish()` only, which revokes nothing. I mistook the one for
  the other. Measured in the QA database after this session's testing: **83
  unrevoked sessions on a single account.**

  So: sessions last 30 days, there is no idle timeout, no per-account cap, and
  no way for a person to see or revoke one other session — only "sign out
  everywhere". A password reset does revoke all sessions, and logout revokes its
  own and the revoked cookie replays as `401`; both were confirmed. Whether
  unbounded concurrent sessions are acceptable is a product decision, but it
  should be a decision, not an accident, and it should not be described as
  something it is not. **Status `[ ]` — recorded, not changed.**
- **[x] Sign-in throttling and lockout are real.** Repeated sign-ins during this
  audit were refused `429 rate-limited`, then `429 temporarily-locked` by a
  separate per-account lockout. Both had to be cleared deliberately to continue
  testing — which is the correct nuisance.
- **[x] Support requests cannot be used to flood.** Forty rapid creations
  produced five, then `409 support-request-limit` — a domain-level cap, not a
  throttle, and the right shape for that resource.
- **[x] Payment amounts are server-derived.** The charge amount comes from the
  booking, never from the request body; the sandbox is hardcoded at 30p; the
  Stripe adapter refuses live keys; webhooks are verified with
  `webhooks.constructEvent` and deduplicated.
- **[x] No secrets in the tree or its history.** `git log -p -S` over the
  credential patterns finds only placeholders. The repository ships its own
  secret scanner.
- **[x] Path traversal is refused.** `/../server.mjs`, `%2e%2e`, `/.env` and
  `/db/...` all `404`; the server resolves under `publicDir` and enforces the
  prefix.
- **[x] The 404 negotiates.** Browser gets the page; `/api/*`, a non-HTML
  extension and a client that does not accept HTML keep the JSON.
- **[x] Console and network are clean.** Across 57 routes at three viewports,
  signed out and signed in: **zero** uncaught page errors, **zero** console
  errors, **zero** horizontal overflow, and every `4xx` observed was correct
  behaviour. The only console output anywhere is two TensorFlow.js backend
  warnings on the scan page, which are headless Chromium having no GPU; it falls
  back cleanly.

---

## 4. What was NOT verified

Stated plainly, because the sections above are mostly green and that invites the
wrong conclusion.

- **[!] Stripe.** No test keys are configured here, so checkout authorisation,
  payouts, refunds, webhook replay, duplicate webhooks, missing webhooks and
  amount tampering were **not** exercised end to end. Their unit and adapter
  suites pass, and every path fails closed with an honest message, which was
  verified. That is not the same as a working payment.
- **[!] Geocoding and address lookup.** Unconfigured, so real Cleaner matching by
  distance, travel pricing per kilometre and live ETA were not exercised.
- **[!] The vision model.** Unconfigured, so the scan's object detection was not
  exercised. The manual booking path was walked instead, in full.
- **[!] Automatic dispatch.** Reports unready here. Its two-worker lease
  behaviour is covered by the PostgreSQL integration suite against a real
  cluster, not by a browser.
- **[!] Physical devices.** Every viewport in this audit is desktop Chromium
  emulating a size. Real iOS and Android handsets over HTTPS remain required
  before launch, as the repository's own harness notes.
- **[!] Load and concurrency.** No load testing was performed. The 400-write
  measurement in **S-1** was an abuse probe, not a performance benchmark.

**On the word "secure".** Nothing here supports calling the application secure in
absolute terms. What it supports is narrower and more useful: the specific
attacks listed in §3 were attempted against a running system and were refused,
and the one real abuse gap found is closed and covered by a test.

---

## 5. Verification runs

| What | Result |
|---|---|
| `node tools/syntax-check.mjs` | 510 files, pass |
| Full `pnpm test` | pass, 196 test files now reached by the gate |
| `tools/check-test-gate.mjs` | every file in `tests/` is run; no gate entry is stale |
| `tests/cleaner-dashboard-freeze.mjs` | pass; shared Cleaner-outcome digest unchanged |
| `tests/cleaner-shell-boundary.mjs` | pass; verified to fail when the fix is reverted |
| `tests/account-security.mjs` | pass, including the per-account mutation allowance |
| `tests/design-system.mjs` | pass, including one-owner and contrast assertions |
| `tests/landlord-computed-styles.mjs` | 764 elements, pass |
| `tests/postgres-integration-runner.mjs` | pass against a real cluster |
| `tests/postgres-verification-runner.mjs` | pass |
| `tests/postgres-rate-limiter.mjs` | pass against a real cluster |
| 57-route × 3-viewport sweep, signed out | 0 page errors, 0 console errors, 0 overflow |
| 16-route × 3-viewport sweep, signed in | as above; one canvas and one font across the workspace |
| Room-photo chain against real object storage | intent → PUT → sanitise → completion → signed read, plus five abuse cases |
| Authenticated write flood, 400 requests | 300 allowed, 100 refused `429` |
| Cross-role browser probe | a Landlord sees no Cleaner navigation; a Cleaner sees all of it |
