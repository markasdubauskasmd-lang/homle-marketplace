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
  the full sidebar on all five, both shells. `tests/cleaner-shell-boundary.mjs`
  fails if the shell is unhidden at build, if a failure path stops removing it,
  or if the marker is copied back into either module — confirmed by reverting the
  fix and watching it fail.
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
- **Why not fixed.** Migrating eleven operator desks onto the workspace shell is
  a comparable piece of work to everything above it, and they are internal
  tooling seen by staff, not customers. Doing it half-way would leave exactly the
  half-migrated state this audit exists to remove.
- **Status.** `[ ]`

**D-4 · P3 · Design** — *The 404 page carries `body.homle-workspace` but never
renders the shell,* so it has no sidebar, no top bar and no skip link, unlike the
four other pages on that class. `not-found.js` imports only the shell *model*.
Deliberate for a signed-out reader; wrong for a signed-in one. **Status `[ ]`.**

**D-17 · P3 · Dead code** — *`public/cleaner-reviews.html` and
`cleaner-reviews.js` are orphaned.* The only route pointing at them
(`server.mjs:5568`) is shadowed by a 308 redirect to `/cleaner/performance`
earlier in the request path, so the route entry is unreachable — but the file is
still served at its own filename by the `public/` fallback. A complete page from
the previous Cleaner generation. **Status `[ ]`.**

**D-18 · P3 · Navigation** — *`/admin/scan-operations` is linked from nowhere.*
Zero `href` to it anywhere in `public/`. Reachable only by typing the URL.
**Status `[ ]`.**

**D-19 · P3 · Dead code** — *Two retired stylesheets are still loaded ahead of
their replacements*: `landlord-dashboard.css` (72 KB, 35 dead selectors) on
`/landlord/dashboard`, and `landlord-help.css` on `/landlord/help`. Both are
overridden by their v2 successors, so nothing is visibly wrong; both are bytes
every reader downloads and a trap for the next editor. **Status `[ ]`.**

**D-20 · P3 · Accessibility** — *Six pages have no skip link*
(`landlord-journey`, `not-found`, `privacy`, `terms`,
`facebook-data-deletion`, `room-scan`), against 41 that do. **Status `[ ]`.**

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
- **[x] The room-photo chain, end to end, against real object storage.**
  Intent → presigned `PUT` → `HeadObject` → sharp re-encode → completion → signed
  read. The quarantine key and the final key differ, and the stored bytes differ
  from the uploaded bytes (4031 in, 4032 out), which is the sanitiser actually
  rewriting the image rather than trusting it. Read URLs expire in 5 minutes.
  Submission then reached `searching-for-cleaner` — the step that was BLOCKED
  before storage existed.
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
- **[x] CSRF, origin and session rotation are real.** A mutation without
  `X-CSRF-Token` → `403 csrf-rejected`; a wrong `Origin` → `403 origin-rejected`;
  a request with no `Origin` at all → `403`; each sign-in invalidated the
  previous session; a password reset revokes every session.
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
