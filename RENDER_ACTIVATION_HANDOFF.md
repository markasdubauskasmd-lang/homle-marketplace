# Render activation handoff

## Open PR #283 — Landlord dashboard v2 design (needs a redeploy, nothing else)

Not yet merged. CI green on `8f00450`. **No migration, no new secret and no
Render setting is required.** Merge to `main`, then one redeploy publishes it.

`render.yaml` sets `autoDeployTrigger: "off"`, so **merging does not deploy** —
the redeploy has to be triggered in the Render dashboard.

### What actually changed, in product terms

- **The Landlord dashboard is the approved v2 composition.** Sidebar of five
  destinations (Home, Properties, Bookings, Messages, Account), a top bar with
  the greeting, bell and avatar, and a mobile bottom bar below 900px.
- **Home is new and leads.** Scan and Manual sit as two equal cards with a tab
  marking which is in focus; then guide prices; then the live booking with a
  five-step tracker driven by real booking status.
- **Bookings and Home are real URLs** (`/landlord/bookings`, `/landlord/home`),
  as Properties, Requests and Account already were.
- **Properties and Bookings cards were rebuilt**, not just restyled — the render
  functions emitted a different structure from the design.

### Deliberate decisions — do not "fix" these

- **Messages is an announced placeholder.** There is no thread model, endpoint
  or store anywhere in this repo. The view is built to the design's shape but
  says "Messaging is coming soon" and its composer is disabled. Do not make it
  look live until a messaging API exists; the markup is ready to fill.
- **The recommended prices are not quotes.** They come from
  `LD_INDICATIVE_PLANS` in `landlord-dashboard.js`, a labelled constant. There
  is no landlord-facing pricing endpoint — the only pricing rules that exist
  price a completed scan, not a catalogue. The section is flagged "Indicative",
  says "not a quote", and each card links to the scan that produces a real
  price. Do not wire these to a checkout.
- **The manual request builder is untouched**, deliberately. The v2 rules
  exclude it by selector. It did stop appearing collapsed at the foot of every
  other view, because that put a second "Manual request" banner directly under
  the Manual card on Home.
- **The scan still leads.** The Scan card is first and the tab never hides the
  other card — there is a test asserting exactly that.

### One security fix rides along

`setSecurityHeaders` matched only `/landlord/dashboard`, but five routes serve
that same document. `/landlord/requests` — where speech capture runs — was being
sent `microphone=()`, and none of the other routes received the private-media
CSP. The check now follows the document. Worth a smoke check after deploy:
speech capture on `/landlord/requests`, and room photos on the dashboard.

### Still outstanding

- `landlord-dashboard.css` still carries the old `.scan-hero` rules, which now
  style nothing. Left in place rather than deleted in the same change.
- `emailReady` and `paymentsReady` remain false on the live deployment.

## Merged 2026-08-05 — Landlord dashboard (needs a redeploy, nothing else)

Five PRs, all merged to `main`, CI green. **No migration, no new secret and no
Render setting is required.** One redeploy publishes all of it.

| PR | What it does |
| --- | --- |
| #236 | Checklist review loop + Cleaner profiles |
| #237 | Guard against controls that cannot work |
| #238 | Real workspace URLs + a loading state |
| #239 | Payments panel (status, not receipts) |
| #240 | Stepped wizard off the critical path |

### What actually changed, in product terms

- **A Landlord can now see what they changed** before approving scope. The scan
  generates a checklist, the Landlord edits it, and the panel lists exactly what
  they added and removed against what the scan found, with a one-click restore.
  The module that computes this had existed and been tested for weeks, imported
  by nothing.
- **A Landlord can look at a Cleaner** before inviting them into a property —
  photo, rating, services, and completed-job reviews. Both endpoints already
  existed; the reviews one had never been called from the Landlord side.
- **Properties, Requests, Account and Payments are real URLs.** They were
  in-page anchors, so nothing could be bookmarked or shared and Back did
  nothing. Old `#landlord-*` links still resolve.
- **The dashboard shows that it is loading.** Empty states used to render from
  first paint, so a Landlord with six properties was told they had none until
  data arrived.
- **22,370 bytes less JavaScript on first paint**, measured: the stepped wizard
  now loads when its panel opens rather than on every visit.

### Deliberate decisions — do not "fix" these

- **There are no invoices or receipts, on purpose.** No receipt URL, invoice
  URL, receipt number, charge id or payment intent is exposed to a Landlord
  anywhere in this system, and `booking-summary-model.js` states repeatedly that
  these totals are "not a receipt or refund record". A receipt-shaped document
  built from authorisation data is something a Landlord could reasonably treat
  as proof of payment in a dispute. The Payments panel shows authorisation
  STATUS and never says "paid". Real receipts must come from the payment
  provider once `paymentsReady` is true — it is currently false.
- **The room scan stays the primary action.** The scan hero is the main banner
  and the manual-request CTA is deliberately smaller.
- **The stepped wizard is progressive enhancement.** If it fails to load the
  request form still works. Do not make it a hard dependency.

### Still outstanding

- Full code-splitting of `landlord-dashboard.js` (still ~144KB) needs the panels
  in separate documents. Not attempted; it wants device testing.
- `emailReady` and `paymentsReady` are both false on the live deployment.


## CURRENT LIVE TRUTH — 4 August 2026

The current verified live release at **`https://homlle.com`** is **`e3403963`** with **88** locked
migrations, healthy data integrity and writes allowed. Marketplace runtime,
authentication, private media, realtime updates, geocoding, direct matching,
speech summarisation and room vision are ready. Google account entry is available.

The canonical-domain cutover was exercised against this release on 4 August 2026.
Render's runtime uses `APP_ORIGIN=https://homlle.com`, and the existing Google Web
client accepts the exact
`https://homlle.com/api/marketplace/auth/google/callback`. Both the booking and
Cleaner-work account intents redirect to Google's authorization endpoint with
that callback plus state, nonce and PKCE. `https://www.homlle.com/test?x=1`
redirects to `https://homlle.com/test?x=1`, preserving path and query. The apex
landing returns 200 with the expected Homle title, and the secret-free live
activation verifier passed for packaged release `e3403963`. PR #214, the complete
local suite, GitHub unit/safety CI, real PostgreSQL/RLS CI and post-merge CI all
passed. The Cleaner Dashboard was not changed.

Transactional email/email-password recovery, Facebook, Apple and Stripe test
payments remain provider-backed launch gaps. Automatic dispatch is deliberately
held off: direct Landlord-approved quote and invitation rehearsal remains possible,
but the background worker can create Cleaner invitations and must not be enabled
merely to turn a health flag green. Activation requires explicit founder approval,
approved supply and pricing, delivery evidence, monitoring and proof that exactly
one worker process is scheduled.

Run the secret-free verifier after every release:

```powershell
pnpm run verify:live-activation https://homlle.com --expect-release=<exact-eight-character-main-commit>
```

Use the exact packaged `main` commit being deployed; never copy the historical
baseline after `main` advances. Historical sections below are retained for implementation context. Where they
contradict this section or the live verifier, this section and the verifier win.

## ARCHIVE — merged on 2026-07-28 visual system and sign-in page (already deployed)

This section describes historical release work. It is already deployed and must
not be used as a current activation checklist. No migration, new secret or Render
setting is required for the visual changes below.

- **PR #135 + #140 — one visual system across the app.** `public/homle-tokens.css`
  is now the single owner of typography, palette, radius and shadow, and every
  page reads from it. Two things were badly wrong before and are fixed: `styles.css`
  asked for `"Sora"` and `Inter`, neither of which is vendored or loadable under the
  CSP, so ~30 pages silently rendered in system sans-serif while the landing page
  used real Bricolage Grotesque; and five shared panels (account side, brief hero,
  Cleaner publish, Landlord scan boundary, booking payment summary) were near-black
  maroon gradients — a second visual identity inside the same stylesheet. They now
  use the landing's cream surface. Distinct hex values went 492 → 384.
- **PR #147 — the sign-in page (`/login`) rebuilt on the landing design.** New
  `public/account-entry.css`. Same page also serves `/signup`, `/verify-email`,
  `/reset-password`, `/onboarding` and `/account-ready`, and every one of those
  modes still works — the redesign changed presentation only, not the auth flow.

### Historical Google sign-in activation note — complete

`Continue with Google` is now active and verified on the current live release.
The page still correctly refuses to show a provider the deployment cannot honour.
Google remains gated on both of these Render secrets
(`src/marketplace/config.mjs`):

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

On the verified live release both Google values are present and the button works.
If either secret is rotated or a new service is created, set both and redeploy;
the button will appear without a code change. Apple and Facebook behave
identically via their own variable pairs. **Do not remove the gate to make a
button visible** — without working credentials it is a dead control that errors
on click, and `tests/smoke.mjs` asserts this page never advertises an unavailable
provider.

### Deliberate decisions — do not "fix" these

- **The sign-in card is not a magic link.** The design handoff proposed
  `Email me a sign-in link`, and flagged it as an open question. This deployment has
  no magic-link endpoint; it uses email + password plus OAuth. The card keeps the
  real form on purpose.
- **`.scan-page` and `.journey-page` keep their dark palettes.** Those are
  full-screen camera experiences where a dark ground is the design, not drift.
- **The Cleaner workspace (`homle-cleaner.css`) was left alone** at the owner's
  request, and loads `styles.css` *without* the token file — which is why every
  shared `var()` carries a literal fallback. Removing those fallbacks breaks the
  Cleaner pages.

## ARCHIVE — historical implementation notes, not a publication queue

The entries below record implementation work from earlier releases. Their
original publication wording is preserved only as history and may describe an
older commit boundary. Do not deploy, configure or activate anything from this
section without reconciling it against **CURRENT LIVE TRUTH**, the current
`main` branch and the live activation verifier above.

- Landlords now have one private notification bell beside the signed-in account picture, and Cleaner invitations no longer require a reload while transactional email is unavailable. Migration 072 emits a commit-bound, privacy-minimal PostgreSQL signal for each in-app notification. An authenticated account-scoped SSE route sends the browser only `{"changed":true}`, then the existing protected inbox is reread and the Cleaner dashboard refreshes actionable invitations. Cross-account isolation, session expiry, connection limits, backpressure cleanup, reconnect catch-up, database trigger safety, package identity and dedicated booking/account LISTEN readiness are covered. Commit `d218ddf` plus the current verified migration/SSE work are local only and have not been pushed, merged or deployed.
- The guided Landlord journey now survives payout-readiness races both while obtaining the exact quote and at the final invitation write. Quote recovery excludes the failed selection and verifies no more than five server-ranked alternatives, skipping only the specific payout-readiness result. If the approved Cleaner then loses readiness before the atomic invitation write, Homle quote-verifies one final different Cleaner and requires a second named exact-price approval. Declining sends nothing; a repeated commit-boundary failure stops safely. Publish `landlord-journey.js?v=journey8` and `landlord-journey-model.js?v=journey7` together with their HTML reference.
- The guarded disposable-PostgreSQL rehearsal now includes the paid matching boundary introduced by migration 068. It checks no-payment eligibility, payout-unready exclusion, provider-verified re-entry, role denial and payout-data projection privacy. The harness contract passes locally, but this computer has no configured `psql` client or disposable database credentials; execute the guarded database run before treating the new SQL behaviour as provider-backed release evidence.
- The Landlord dashboard still handles a directly selected payout-unready Cleaner as a saved-request recovery, not a technical dead end. It states that no invitation or payment was created, directs the Landlord to the best eligible match and clears the unusable direct selection. Publish `landlord-dashboard.js?v=20260723-6` with its HTML reference.
- Paid interactive matching, direct Cleaner quote/invite and consent-bound automatic dispatch now filter through private payout-readiness boundaries whenever test payments are enabled. A manually selected payout-unready Cleaner fails before any invitation write, and the Landlord receives only a safe unavailable result—never a payout flag, provider account or bank detail. No-payment rehearsals remain unchanged, and Cleaner acceptance retains its independent race-safe readiness recheck.
- Paid invitation acceptance now requires the Cleaner’s server-verified payout readiness whenever the test-payment provider is attached. Missing or temporarily unverifiable payout setup performs no booking transition; the Cleaner receives a direct **Set up payouts** recovery action. Declines and no-payment rehearsals remain available.
- Cleaner and Landlord booking cards now distinguish role-specific job value from authorization, final payment evidence and Cleaner transfer evidence. The wording is generated from the existing participant-safe booking summary only; it exposes no provider identifier or banking data and performs no payment action.
- Administrator settlement cards now expose one explicit safe next step. Capture leads to Cleaner transfer only after provider reconciliation and payout readiness; an unfinished Cleaner payout account produces a wait-and-refresh instruction, while refund is always secondary exception handling. The browser cannot run capture, refund or transfer automatically.
- Claude's latest animations now have a shared current cache key across every shipped page, while `home.css` and `home-hero.js` have an explicit current landing key. The Landlord journey and direct scanner no longer point at older shared-style keys, so a phone cannot legitimately retain the previous animation layer after publication.
- The active Cleaner/Landlord booking screen now includes **Refresh booking**. It reloads only participant-authorised read models, preserves the last verified state on an ordinary connection failure, reopens durable live updates and cannot issue a booking, payment, location, message or media mutation.
- A completed verified review now gives each participant one clear exit: **Return to Landlord bookings** for the Landlord and **Return to Cleaner jobs** for the Cleaner. It appears only after the server returns a review and changes navigation only.
- A server-verified complete test-payment state now reveals **Open confirmed booking**, taking the Landlord directly from secure authorization into the participant-protected booking screen. Non-final or uncertain payment states cannot show that action, and opening it sends no payment request.
- A confirmed Cleaner booking now checks current server-side payment readiness before the browser can request location permission. Unpaid or unchecked bookings offer **Check booking authorization**, a read-only retry that never opens the location prompt; an authorized booking then receives **Start journey** as a separate deliberate action.
- The Landlord booking card now presents **Authorize booking total** before the live-job link whenever authorization is available; the second link is labelled **View booking details** until that boundary is complete.
- Claude's latest landing/Landlord animation pass is present and verified: the hero pointer motion composes with the permanent phone tilt, the scan line stays animated, and mobile/reduced-motion behavior remains intact.
- Focused journey, HTTP, active-job, progress, messaging, review, dashboard, notification and animation tests and the full `pnpm run check` plus `pnpm test` suites pass locally.
- The older audited journey, payment, scanner, dashboard and animation changes in this list are already included in live release `afd7a1fe`. Only the notification bell and its migration-072 account-stream extension identified above are still local.

## CURRENT LIVE TRUTH - verify this before following older notes

Verified on **2026-07-26** against
`https://homle-marketplace-preview.onrender.com`:

- live release: **`afd7a1fe`**, database migrations applied: **71** of **72** locked
  - 069, 070 and 071 (queue pagination, and the three missing indexes) ARE applied.
  - **072 `account_notification_realtime_events` is locked but not yet applied.** It is
    the only outstanding migration. Nothing in the scanner work depends on it.
- data integrity: healthy; restricted staging writes: allowed
- ready: separate Cleaner/Landlord accounts, Google sign-in, private photo/video storage, participant-only
  realtime updates, postcode geocoding, matching/pricing, automatic dispatch,
  speech summarisation and room reading
- not ready: Facebook Login, Sign in with Apple, email/password verification
  and reset, transactional notifications, and Stripe **test** payments
- real payments: deliberately not approved or enabled

**Private object storage is complete and healthy. Do not create another bucket or
replace its credentials because an older section below says `mediaReady: false`.**
That snapshot is historical. The remaining provider credentials are Facebook,
Apple, an approved transactional-email provider/sender and, after explicit
founder setup, Stripe test credentials.

Run the source-controlled, secret-safe verifier before and after every deploy:

```powershell
pnpm run verify:live-activation https://homle-marketplace-preview.onrender.com --expect-release=afd7a1fe
```

The verifier makes bounded no-credential requests to the public health and
account-provider endpoints, requires the exact packaged release, projects only
approved boolean capability fields and names the remaining provider actions. It never activates payments,
changes a booking or prints environment variables. Sections below are retained
as implementation history; where they contradict this section or the verifier,
the verifier is authoritative.

### Scanner and booking improvements included in the current live release

- Account booking intent now opens `/landlord/book` directly after the verified
  account/role handoff instead of detouring through the management dashboard.
  Direct links and installed-app scan shortcuts stay behind an account gate:
  signed-out visitors return to signup, Cleaner-only accounts confirm the
  separate Landlord workspace, and temporary service faults show a retry action
  without revealing camera controls. The new account guard and booking repair
  use the `journey4` cache key.
- The normal **Find the best available Cleaner** choice no longer stops after
  submitting an unmatched request. Once the reviewed scan is safely submitted,
  Homle resolves the current first-ranked eligible Cleaner through the private
  request-specific matching service, obtains a fresh server-owned invitation
  quote and asks the Landlord to approve that exact total before one invitation
  is sent. Empty or stale matching results leave the request open without an
  invitation or payment. Direct Cleaner choices retain the same quote boundary.
- The redesigned `/landlord/book` journey now uses the real authenticated
  property/request/media contract. It creates retry-stable private drafts,
  uploads only the current in-memory room photos through signed storage,
  submits the Landlord-reviewed checklist, and obtains a server-owned exact
  quote before a selected Cleaner can be invited. It never writes room photos
  into the browser recovery draft, never claims a booking before acceptance and
  never takes payment at this step. Mobile uploads time out with a recoverable
  message instead of spinning forever. Deploying this code still requires the normal approved
  release process and a physical signed-in two-phone rehearsal.
- Confirmed rooms in the scan hub now have a separate **Remove** control. It
  opens a deliberate **Keep room / Remove room** decision rather than deleting
  on the first tap. Confirmation removes that room's in-memory photo, corrected
  note and checklist contribution together, refreshes the room count and
  finish gate, and leaves every other room untouched.
- Closing a scan with any room, photo or note now requires an explicit
  **Keep scanning** or **Discard scan** decision, and browser navigation receives
  a standard unsaved-work warning. Nothing private is copied into browser
  storage. A local blocked-camera rehearsal also found that its recovery panel
  physically covered the close and room-count controls; their tap layer is now
  above that panel. Keeping the scan preserves the corrected note, while an
  explicit discard tears down the camera and overlay cleanly.
- The transcript is now an editable per-room note instead of a temporary card
  that disappears after listening. It has a one-tap typed fallback when browser
  speech is unsupported or fails, retains ordinary spaces while typing, and is
  normalised only when saved. Camera-recovery mode exposes only its recovery
  actions to keyboard and assistive navigation while preserving this fallback.
- Spoken notes are now isolated per room instead of being appended to one global
  walkthrough and resent with every room read. A note change re-scopes that
  room, revisits restore its note, the final transcript keeps room labels, and
  stale mobile speech callbacks cannot stop a new recording or write into the
  next room.
- The guided scanner now treats `visibilitychange`, `pagehide` and `pageshow` as
  camera privacy/lifecycle boundaries. It releases camera/detection and active
  speech while backgrounded, stops a late permission result before attachment,
  and reacquires only when a live frame is still needed. Native photo/video
  decoding blocks the resume until it finishes, a frozen result never has a
  hidden stream reopened behind it, and Retake can reacquire after mobile Safari
  or Chrome ended the previous stream. A physical installed-mode phone rehearsal
  remains required.
- Every shipped HTML page now uses the hash-locked approved
  `/homle-logo.png` tab icon. The booking journey, scanner and Administrator
  payment page previously referenced a nonexistent `/favicon.svg`, and the
  Facebook deletion page had no icon. The public-brand test now rejects either
  condition across the complete public HTML set.
- The installable Homle manifest now leads with secure **Scan rooms** and
  **Cleaner jobs** shortcuts. The Landlord/Cleaner dashboards, guided booking
  journey, direct scanner and active-job view all expose the same manifest and
  iPhone standalone metadata. The destinations retain their existing
  authentication/role gates, and no offline service worker was added, so private
  workspace or booking data is not cached for offline use.
- Claude's premium landing animation is present. A later visual audit found that
  desktop pointer parallax replaced the phone's permanent six-degree tilt.
  Parallax now writes temporary CSS coordinates which compose with that tilt
  and removes them on pointer exit. The regression is covered by the landing UI
  contract and remains disabled under `prefers-reduced-motion`.
- The guided scanner now detects a returned camera stream that never produces a
  current frame, releases it after six seconds and exposes a working retry
  instead of remaining blank and “warming up”. A native **Open your phone
  camera** escape remains visible even while the stream claims to be live, so a
  black-but-open browser camera cannot trap the Landlord.
- The same guided scanner now offers short room-video capture. It validates the
  existing 1–30 second MP4/MOV/WebM boundary, extracts the beginning, middle and
  end locally and combines them into one portrait/landscape-aware contact sheet;
  the raw video and its audio are not uploaded. One resulting JPEG then uses the
  existing photo consent, review and room-reading boundary, so coverage improves
  without tripling provider requests.
- Native mobile photo capture keeps the broad `image/*` picker needed by iPhone
  and Android, but the decoder now rejects SVG/XML and disguised non-photo files,
  empty/oversized files, decoded sides above 16,384 pixels and images above
  50 megapixels. Normal 48-megapixel phone photographs remain supported.
- The complete syntax and product suites pass with these scanner, animation
  and account-first booking changes, and they are included in live release
  `afd7a1fe`. A physical signed-in two-phone rehearsal remains required before
  treating every mobile camera/browser combination as verified.
  A deliberate physical iPhone/Android camera and video rehearsal is still
  required after an approved release.

**For the Render-connected assistant.** Written 2026-07-19 by the code assistant
(GitHub side). The code side is done and merged to `main`. The steps below are
Render-dashboard actions to finish activating the marketplace on the existing
free staging deployment. **Do not commit any secret into the repo** — every
secret below is entered in the Render dashboard only.

---

## ARCHIVE — UI work that was waiting before the 23 July deploy

A run of UI changes was merged to `main` and needed one deploy to go live.
Release `746d0599` now contains this work; this section is retained only to
explain the source history.
**None of them need any new environment variable, secret, database change or
migration** — they are front-end and, for the scanner, a same-origin vendored
model. To ship them: Render → `homle-marketplace-preview` →
**Manual Deploy → Deploy latest commit**. That is the whole task.

| PR | What changed | New env vars? |
|---|---|---|
| **#49** | On-device object detection in the room scanner (vendored TensorFlow.js COCO-SSD; boxes drawn live, tap to select, Anthropic names only the chosen items). | No |
| **#51** | Room scanner rebuilt around a **room hub**: pick a room → scan objects → confirm → next room, with the ability to return to a room and edit it. | No |
| **#52 / #53** | **Landing page (`/`) redesigned** as the "scroll to scan" hero — a room that a beam wipes clean as you scroll, then "Come home to calm." and a features section. Header restyled and the mobile scan animation fixed. | No |
| **#54 / #56** | The Homle **logo** finalised (red square, white house) and applied everywhere, including the app icons. | No |
| **#57** | The manual **"Cleaning request drafts" workspace is hidden** on the landlord dashboard (one CSS rule; markup and JS kept). Landlords use the guided room scan at `/landlord/book` instead. **→ Superseded by #72**, which brings the builder back (restyled) behind its own tab at the owner's request. | No |
| **#58** | An **animation/"feel" layer**: button press feedback, a liquid-lerped scan scrub with milestone ticks + a 100% payoff, scroll reveals, and cross-page View Transitions. Pure front-end, all behind `prefers-reduced-motion`. | No |
| **landlord dashboard** | The **landlord dashboard restyled** to the sidebar / card design (new `public/landlord-dashboard.css`, loaded only there). CSS only — the markup, every data-* hook and `landlord-dashboard.js` are untouched, so all data loading and flows are unchanged. | No |
| **#63** | **Landing hero premium/smoothness pass**: depth shadows, vignette + light, a volumetric scanner beam, ambient dust motes, a 100% particle burst, mouse-parallax depth, tighter pacing, and a compositor-only (translateX/scaleX) rewrite so the scrub is 60fps. Front-end only, all behind `prefers-reduced-motion`. | No |
| **#72** | The landlord **"Prepare a clean" builder is back** (reverses the #57 hide), behind its own dashboard tab and restyled as the approved design's **stepped wizard**: one white card, step dots, one step at a time (property → time & type → extras → voice walkthrough → review → save), Back/Next, and a live **no-price** "Your clean so far" summary. It stays a **private draft** — matching off, no Cleaner invited, **no price shown, no payment taken** (the design's card-payment step and running £ total were deliberately not built, since there is no payment processor). "Open the builder" now **expands the form** instead of auto-starting the microphone; voice stays behind the explicit "Start speaking" control. New `public/landlord-prepare-wizard.js` (progressive enhancement) + scoped CSS; no field/hook/backend changed. | No |
| **#74** | **Prepare a clean — design step inputs.** Each wizard step now uses the mockup's own input, one item per step: cleaning session **cards**, a duration **button grid**, a month **calendar**, a time-slot **grid**, and the **"My basket"** panel (address + cleaning bullets). All are progressive enhancement over the same native `<select>`/`<input>` fields (kept in the DOM, hidden), so submit/validation/recovery are unchanged. **Still no price:** the mockup's per-hour rates and "Total £…" are placeholders and were deliberately **not** built — the app has no payment processor and the real price is per-Cleaner at approval, so the basket shows "exact price at Cleaner approval, no payment now". Owner-approved: match the design minus the invented £ figures. Front-end only, no env vars. | No |
| **#80** | **Room scan made faster.** The biggest cause of "slow": the 5.65MB on-device detector did not begin downloading until *after* a room was chosen (a guard returned early while the room picker was showing), and the four TF.js files downloaded one-after-another. Now the download starts as the scanner opens, in parallel, and a status line reports it. Inference runs on a downscaled 320px copy of the frame instead of the full 1080p one (measured 80ms -> 58ms per pass; bigger win on a phone), the viewfinder is measured once instead of every pass, boxes are reused instead of rebuilt ~10x/second, and a held `filter` on the live video plus three full-viewport blurs over a playing camera feed were removed. Also new: lighting/framing guidance, a confirmation when a room is saved, and the review list now shows the objects captured. **Front-end only, no env vars.** NOTE: the live camera path was not testable on the build machine (no camera) - the box geometry and timings were verified against the real model, but a real-phone pass is still worth doing. | No |
| **#81** | **Unfinished room notes are recovered** (spoken and typed), so a backgrounded tab or stray tap cannot lose a walkthrough. Deliberately **notes only** - room photographs, detected objects, condition grades and tasks are never written to browser storage; `sessionStorage`, 30-minute life, fails closed, and spoken access details (key-safe codes, where a spare key is hidden) are stripped before anything is written. Discarding or finishing a scan clears them. Front-end only, no env vars. | No |
| **#84** | **Codebase audit and cleanup.** A full read of all ~69,000 lines produced this. Fixed, all front-end or Node only, **no env vars, no schema change**: (1) a customer's refusal was reported as *requested, priced* work - a clause-boundary off-by-one meant "do not clean inside the oven" lost its "D" and the exclusion guard stopped matching, so an Administrator would confirm and price work the customer refused; (2) the booking calendar's button label and the date it submitted disagreed before UTC midnight and across daylight saving, so the wrong day could be booked; (3) editing a published Cleaner profile silently unpublished it while reporting success; (4) a refresh failure after a *successful* audited decision re-armed the button, allowing a duplicate audit entry (both `admin-cases` and `admin-verifications`); (5) a signed-out caller got 500 instead of 401; (6) bookings rendered a different hour for non-UK viewers; (7) a crash path that killed the process with every in-flight request (no `headersSent` guard, and third-party error messages echoed to clients); (8) the runtime DB role could grant itself `administrator` - table write privileges revoked in `runtime-role-grants.sql` (**the checksum in `db/migration-lock.json` moved with it**). | No |
| **#84 (verification)** | `npm run check` **was failing outright** - the hand-maintained chain had grown past the Windows command-line limit. It is now `tools/syntax-check.mjs`, which derives the file list from disk (351 files, one command, reports every failure instead of stopping at the first). 6 test suites that nothing executed and 44 files that were never syntax-checked are now wired in, and `tests/verification-coverage.mjs` fails if either list falls behind again. `npm run coverage` now exists (Node's built-in V8 coverage, no dependency): **35.2% of lines are executed by the suite, and only 14.7% of `src/`** - nine repositories are at 0%. Source is pinned to LF in `.gitattributes`, because part of the suite asserts on source text and a CRLF checkout broke it. | No |
| **RESOLVED** | CI and local pnpm runs now opt into lifecycle scripts through the reviewed `.npmrc`, and the workflow labels the full pretest/test/posttest boundary explicitly. The 26 July verification run executed the pre/post suites and all 137 test files; `tests/verification-coverage.mjs` guards the inventory. | No |
| **#87, #89, #90, #91** | **Database defects resolved, and the earlier list corrected.** The audit listed six; on re-reading the actual query bodies only **four** were real. Fixed and merged: (1) **migration 069** - the Administrator cleaner-vetting queue in `063` applied `LIMIT/OFFSET` to a bare `jsonb_agg`, which is one row, so **page 1 returned the entire queue and page 2 returned nothing**; (2) **migration 070** - `bookings(cleaning_request_id)` had only a *partial* unique index carrying `status <> 'cancelled'`, which the dispatch attempt-limit count cannot use because it must include cancelled attempts, so it scanned `bookings` on every dispatch; (3) **migration 071** - `payment_commands` had only partial uniques with status predicates, so the four correlated subqueries behind the Administrator payment page could use none of them - up to **400 sequential scans per page**; (4) **migration 071** - `cleaner_profiles` had **no index at all** beyond its primary key, so the unauthenticated `search_cleaner_directory` scanned every profile ever created. **Two claims were wrong and need no work:** `cleaning_requests.budget_pence` nullable is safe - dispatch raises `automatic-dispatch-price-cap-required` *before* inserting a booking, so no attempt is consumed; and `disputes`/`reviews` `ON DELETE CASCADE` is inert because nothing in production deletes from `bookings` (the only `DELETE`s are test-fixture cleanup, where cascading is wanted). | **YES - apply migrations 069, 070, 071** |
| **#92, #93** | **Duplication given one owner where it was worth it, and left alone where it was not.** `requestJson` existed 14 times; 8 now share `public/request-json.js` and 6 keep their own because they carry offline detection and an `uncertain` flag meaning a payment step may already have been prepared. `storedCsrf` (10 byte-identical copies) is now `public/session-csrf.js`. Booking statuses were restated inline in two services beside a canonical export and now derive from it, with `tests/booking-status-agreement.mjs` pinning them against the PostgreSQL enum in both directions. `showFeedback` (13 copies) was deliberately NOT consolidated - the variants differ on signature, default kind, hide-on-empty and focus, and normalising them would be a silent UI change to 5 lines of presentational code. | No |
| **#94** | **Recorded why the data-integrity gate is not cached.** `refreshDataIntegrity` reads all 20 private NDJSON files on every mutation, inside the write queue. Both halves true, and deliberately kept: it guards only the legacy pilot JSON routes (the marketplace routers return above it) and those are gated behind `PILOT_INTAKE_ENABLED`, which is false here - so it runs on no production request. Not cached because a stale "healthy" verdict is the one failure mode that matters for a gate whose job is refusing writes onto corrupt data. | No |
| **#98** | **Scanner: false labels and repeated speech.** Three overlapping boxes labelled OVEN on a bedside cabinet, and "tidy up the cupboards" transcribed as "tidy tidy up tidy up the...". Speech: `onresult` built an append-delta from the cumulative `event.results`, and Android Chrome re-fires already-final segments, so each event re-appended stored text. Detection: the threshold was coco-ssd's 0.5 default, the room the customer had chosen was never consulted, and dedupe needed IoU >= 0.68 so three stacked same-class boxes all survived. | No |
| **#99** | **Continuous scanning - no shutter press.** The scan read ONE frame per room, so anything not in that shot was never found. The phone now decides on-device which frames are worth reading (view changed, phone settled, minimum interval, per-room budget) and accumulates a per-room inventory, deduplicated by label and correctable in a tap. Detections glow instead of being boxed. **Consent copy changed** and now states the real per-room total: up to four frames while walking plus one on confirmation. A test fails if that number and the enforced number diverge. | No |
| **#100** | **Model split - the dearer tier only where it decides the price.** Walking frames stay on the cheap tier (they only need objects named); the one confirmation read per room can use a stronger one, because it produces the condition grade and the checklist the job is priced and timed from. **`ROOM_VISION_CONFIRMATION_MODEL` - optional.** Unset means no split and behaviour identical to before. `purpose` is compared against the exact string server-side so a crafted request can never escalate to the dearer model, only stay cheap. | **`ROOM_VISION_CONFIRMATION_MODEL`** (optional, unset = no change) |
| **#101** | **Condition analysis, and the slow save button.** Condition was being judged from evidence already destroyed: the frame was sent at 1280px/JPEG 0.82 and limescale, grease and dust are the fine texture JPEG discards first. Now 1600px/0.90, crops 0.88. The schema had ONE room-level grade; every detection now carries its own condition, soiling type (enum, because free text produced five spellings of "limescale"), confidence and the evidence behind the grade - and "clean" is a real answer. Both prompts now share one description of what each soil type looks like and what the scale means. Save no longer awaits the vision call: the room saves instantly marked `reading`, the model runs in the background and updates it in place, and Finish warns rather than silently discarding a pending read. | No |
| **Scanner privacy gap fixed locally** | The old standalone `/landlord/scan` and `/room-scan.html` entries now redirect server-side to `/landlord/book`, where the scanner opens inside the authenticated guided journey and hands photos back in memory. The compatibility page does the same if it is ever served from an old cache. It no longer serialises finished room photos into `sessionStorage`. Both former readers still remove the legacy `homle_scan_result` key, but refuse any old handoff that contains photos, so stale tabs cannot revive private room imagery from browser storage. Focused privacy, scanner, journey and brand regressions pass. | No |

Notes that will save you time:

- **The on-device detector is served from `/vendor/` and is cached `immutable`.**
  A normal deploy serves the new files fine. If the scanner ever shows no live
  boxes, it is the on-device half (check the browser console), not a Render env
  var — the Anthropic key only affects the *naming* of selected items.
- **The landing redesign uses self-hosted fonts under `/vendor/fonts`** and no
  external requests, so it works under the existing CSP with no change.
- **`GET /api/health` is unaffected** by any of these — same fields, same
  meaning. Use the current verifier at the top of this document for the actual
  provider gaps; private room-photo storage is now healthy.
- **The hidden requests panel (#57) is CSS-only and reversible.** If the founder
  ever wants that manual draft flow back, delete the single
  `.landlord-workspace-panel[data-landlord-panel="requests"]` rule in
  `public/styles.css` — no code was removed.

Everything under the horizontal rule below is historical activation evidence.
It explains how the current service was assembled but is not an action list.

---

## ARCHIVE — 19 July activation snapshot (superseded)

Live service: **`homle-marketplace-preview`** → https://homle-marketplace-preview.onrender.com
Database: **`homle-marketplace-staging-db`** (Render free PostgreSQL 16, Frankfurt).

This was the 19 July snapshot. It is not the current service state:

```json
{ "marketplace": { "enabled": true, "ready": true, "authenticationReady": true,
  "realtimeReady": true, "emailReady": false, "mediaReady": false,
  "matchingReady": true, "paymentsReady": false },
  "release": { "sourceCommit": "0f6a95c8", "migrationCount": 63 } }
```

Accounts, live updates and matching work on the restricted real staging
database. Private room-photo storage has since been configured and is healthy.
Current provider-backed blockers are listed at the top of this document.
Payments intentionally remain off.

> This paragraph originally recorded a deploy gap that has since been closed.
> `autoDeployTrigger` remains off by design.

## 0. READ FIRST — the room scanner (added 2026-07-21)

The Landlord side was rebuilt around a guided booking journey with a camera
room scanner. **The founder has already saved the environment variables for it
in Render but has NOT deployed.** Deploying the latest `main` is the remaining
step.

### What was added

| Route | What it is |
|---|---|
| `/landlord/dashboard` | Now leads with a room-scan banner; bookings, then properties below |
| `/landlord/book` | The six-step guided journey: postcode → service → results → when → cleaner → confirm |
| `/landlord/scan` | Compatibility redirect to `/landlord/book`; the scanner opens only inside the authenticated guided journey |

The scanner uses the real rear camera and real speech recognition. Each captured
photo can be read by a language model that returns the **objects** it can see
(fixtures, appliances including small ones like an air fryer, furniture), the
room's condition, and cleaning tasks — drawn as boxes on the photo.

> #### CHANGED by PR #49 (2026-07-21) — not yet merged at time of writing
>
> **Object detection now runs on the phone, not in the cloud.** Read this before
> deploying anything after #49, because it changes what to check when the scan
> misbehaves.
>
> - A vendored TensorFlow.js COCO-SSD model (`public/vendor/`, ~5.65 MB) draws
>   boxes on the **live viewfinder**, before any capture. The first tap freezes
>   the frame; the Landlord taps boxes to choose them, and taps empty space to
>   add anything the detector cannot see — air fryer, shower, worktop, radiator,
>   hob, extractor are all outside COCO's 80 classes.
> - Anthropic is then asked only to **name the selected items and grade the
>   room**. It no longer returns coordinates at all; the device owns the geometry.
> - **No new environment variables.** The five above are unchanged, and the
>   on-device half needs none — it is served from this origin and works with the
>   Anthropic key absent (you get boxes you can tap, just no names).
> - **`roomVisionReady` still means the same thing** and is still the right field
>   to check. If boxes appear but never get named, that is the Anthropic half; if
>   no boxes appear at all on a live viewfinder, that is the on-device half and
>   Render logs will show nothing, because nothing was sent.
> - **The boxes were previously invisible.** `.vf-still` sits above the box layer,
>   so every box was painted behind the photograph. This is almost certainly why
>   the "NOT verified" note below says nobody ever saw object recognition work —
>   a real scan would have shown no boxes **even with a correctly configured key**.
>   Fixed in #49. Do not conclude from earlier testing that the model was at fault.
> - **`/vendor/` is served `Cache-Control: immutable` for one year** from
>   versioned paths (`/vendor/tfjs-4.22.0/`, `/vendor/coco-ssd-lite-v1/`). If the
>   detector is ever re-vendored it **must** go to a new versioned path —
>   overwriting those filenames would strand every browser that already cached
>   them, permanently. `tools/vendor-room-detector.mjs` is the script that
>   produces them and records where they came from.
> - **Cost per scan drops**, because only the chosen items are read rather than
>   every photo at full resolution. The migration 066 rate limit is unchanged.
> - **Still unverified, and this is the important one:** nobody has loaded the
>   model in a real browser or pointed a phone at a real room. The logic and the
>   weight quantisation are tested; the runtime is not. The failure mode is soft
>   by design — if the detector does not load, the scan behaves exactly as it does
>   today and the booking flow is unaffected — but expect the first real run to
>   surface problems.

### Environment variables (already entered by the founder, not yet deployed)

```
ROOM_VISION_PROVIDER    = anthropic
SPEECH_SUMMARY_PROVIDER = anthropic
ANTHROPIC_API_KEY       = sk-ant-…   (secret)
ROOM_VISION_MODEL       = claude-haiku-4-5
ROOM_VISION_CONFIRMATION_MODEL = (unset)   optional; see below
SPEECH_SUMMARY_MODEL    = claude-haiku-4-5
```

Both features are **capability-gated**: with these unset the scan still captures
photos and still scopes from the spoken note, it simply shows no object boxes.
Nothing breaks.

### Three things that will cost you hours if you don't know them

1. **Deploy `b362411` or later, never anything older.** Haiku returns
   `400 "This model does not support the effort parameter"`. Both adapters used
   to send it unconditionally, so on Haiku *every* call failed — and because
   they fall back silently by design, the scan would have looked configured and
   simply shown no boxes. Fixed in `2470ba6`; do not roll back past it.
2. **The room-reading route has its own request body limit** (900 KB, in
   `http-support.mjs`). The global limit is 64 KB and a room photo is 150–400 KB,
   so before this every capture 413'd silently. If you touch body limits, keep
   `maximumRoomPhotoBodyBytes` on that route.
3. **`GET /api/health` reports the truth.** Check `speechSummaryReady` and
   `roomVisionReady` after deploying. If a scan shows photos but no boxes, the
   Render logs for `/api/marketplace/landlord/room-reading` are the first place
   to look — the client is deliberately given a generic message.

### What is verified and what is not

- **Verified against the live API:** the spoken-walkthrough summary. Real output,
  correct handling of exclusions ("don't clean inside the oven" stays an
  exclusion), preserved qualifiers ("a quick mop"), and phrasing the rule-based
  parser cannot handle.
- **NOT verified:** object recognition on a real photograph. It has only been
  run against a synthetic test image, where it correctly returned no boxes and
  no condition rather than guessing. Nobody has yet pointed a phone at a real
  room. Expect the first real run to surface problems.
- **NOT verified:** the camera path on a physical device. The current source now
  verifies that a returned stream produces a real frame within six seconds; a
  stalled stream is released and hands the user to a retryable native rear-camera
  capture (`image/*`, `capture="environment"`) instead of warming forever. This
  reliability guard still needs a deliberate iPhone/Android permission rehearsal.

### Cost and safety

On Haiku a four-room scan is roughly 1.5p; on Opus roughly 8p. Migration 066
adds a reviewed rate-limit scope capping image reads at 40 per 15 minutes.
Photos are read in memory and never stored by the reader. A consent screen asks
the Landlord before the first photograph is sent anywhere, and declining leaves
a fully working scan.

**The API key currently in Render was shared in a chat transcript and should be
rotated.**

### Deliberate omissions — do not "fix" these

- **No floor area or room dimensions anywhere.** A phone browser cannot measure
  a room; iOS does not expose LiDAR to web pages. The design prototype showed
  "62 m²" as a hardcoded constant. Reproducing it would misprice jobs on a
  number nobody measured.
- **Guide time is a range, not a single figure.** It comes from the number of
  tasks scoped, which cannot support a precise duration.
- **A room the model could not judge reads "Not assessed"**, never a confident
  "Light".

---

### 1a. Historical merged-release notes — already deployed

Read this before deploying, so you know what changes for the founder.

| PR | What it changes | Needs a Render setting? |
|---|---|---|
| **#24** | Speaking the room walkthrough now turns into concise Cleaner bullets **live**, about a second after each pause. The separate summarise step is gone. Typing works the same way. Manual edits to the checklist switch the live pass off so they are never overwritten. | No |
| **#26** | The tracking page now shows **how close the Cleaner is** — a marker that travels toward the home plus an "Approach" readout. Derived from the estimated arrival *time*, never from coordinates, so the customer's home position never reaches the browser. No map provider, no API key, no cost. Progress is monotonic: a delay holds position and says "running later than expected" rather than moving the Cleaner backwards. | No |
| **#27** | **Background jobs can finally run** (see Step 2b — this one *does* need settings) and **customers can now read written reviews** on Cleaner profiles. | **Yes — Step 2b** |
| **#25** | Documentation only: recorded that room-photo storage blocks the first real booking. | No |
| **#29** | **The spoken walkthrough now produces a usable checklist.** The founder reported the previous output was unusable, and it was — see the section below, because two of the defects affected price and contract terms. | No |

**Thank you — Steps 2, 2b and 3b are confirmed working on the live service.**
`GET /api/health` now reports `mediaReady: true`,
`automaticDispatchReady: true` and `geocodingReady: true`, so private room-photo
storage, background jobs and distance-aware matching are active. `emailReady`
and `paymentsReady` remain `false`; transactional email and Stripe test-mode
activation are the current provider-backed launch gates.

#### Why #29 matters more than a formatting fix

Browser speech recognition emits a continuous stream with almost no punctuation, but the
parser looked for clause boundaries in punctuation and only recognised a room change from
a formal lead-in. Natural speech broke it. Two of the defects were safety-critical,
because this checklist is the Cleaner's work order **and feeds pricing**:

1. **An exclusion could be inverted.** "the oven has grease but don't clean it" produced
   **"Degrease the oven"** — the opposite of the instruction, on a separately priced item.
   It also failed on `don’t` written with a typographic apostrophe, which is exactly what
   phone keyboards and speech engines emit.
2. **Scope words that change the price were dropped.** "inside of the oven" became a
   generic oven clean; "a quick clean" became "Clean thoroughly".

Both are fixed and covered by tests. If anyone later edits `public/checklist.js`, the
tests in `tests/spoken-scope.mjs` exist to stop these two classes of defect returning —
do not weaken them.

Two things in #27 are worth understanding because they were silent product failures:

1. **Automatic matching never worked.** The background workers were fully built, but no
   process anywhere ran them. A Landlord who chose automatic matching received a success
   message and then waited forever with no error. Step 2b fixes this. `/api/health` now
   reports `automaticDispatchReady`, so the feature cannot be offered with nothing behind it.
2. **Written reviews were invisible.** They were collected and moderated but never
   displayed; customers saw only an average star rating. They now appear on profiles.
   The Cleaner's *reply* is deliberately still not shown — a reply is written after
   moderation and screened only for contact details, so publishing it could still name
   the customer. Do not "fix" this without adding moderation for replies.

---

## 2. ARCHIVE — completed Render activation history (do not execute)

### Step 0b — Redeploy for everything merged since — COMPLETE (historical)
`main` has moved past the deployed release: **#24, #25, #26, #27, #29** (see section 1a
for what each one changes). Steps 2b and 3b are already done and live. The remaining
sequence is:

1. **Step 2 — object storage.** The last blocker; no booking can be completed without it.
2. **Step 1 — email**, once a Resend key is available.
3. **One Manual Deploy → Deploy latest commit**, which also ships #24, #26 and #29.

PR #23 (nearby Cleaner postcode search) is merged and deployed — thank you. The live
release now includes migration 064 and reports 64 locked migrations.

### Step 0 — Redeploy from `main` — COMPLETE
Render → `homle-marketplace-preview` → **Manual Deploy → Deploy latest commit**.
The completed deploy shipped through #21 and, via the staging bootstrap, verified all
63 locked migrations. Do not redeploy merely to repeat this step; compare the live
release commit with `main` first.

### Step 1 — Email  (turns `emailReady` → true)
Environment tab, add either provider (pick one). **RESEND is easiest on Render free**
(HTTPS, no SMTP port):
- `EMAIL_DELIVERY_PROVIDER` = `resend`
- `RESEND_API_KEY` = `re_…`  *(secret — dashboard only)*
- `EMAIL_FROM` = `Homle <no-reply@YOURDOMAIN>`
- `RESEND_WEBHOOK_SECRET` = `whsec_…` *(secret — dashboard only)*

Register `https://homlle.com/api/marketplace/email/resend/webhook` for
`email.bounced`, `email.complained` and `email.suppressed`. Homle deliberately
reports email as not ready without this signed permanent-suppression path.

*(SMTP alternative: `EMAIL_DELIVERY_PROVIDER=smtp`, `SMTP_URL=smtps://user:pass@host:465`.)*

### Step 2 — Room photos — COMPLETE (historical)
The founder attempted the first real end-to-end booking on 2026-07-20 and could not
save a room photo. This is not a bug: `mediaReady` is `false` because no bucket is
configured. It blocks the whole walkthrough, because
`db/migrations/030_private_request_room_scans.sql` requires at least one stored photo
to submit a request (`photo_count < 1` → `request-scan-incomplete`). **No booking can
be completed end to end until this step is done.** Treat it as the top priority.

An S3-compatible private bucket (Cloudflare R2 / Backblaze B2 / AWS S3). Add:
- `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_REGION`
- `OBJECT_STORAGE_ACCESS_KEY_ID`, `OBJECT_STORAGE_SECRET_ACCESS_KEY` *(secret)*
- `OBJECT_STORAGE_FORCE_PATH_STYLE` = `true` if the provider needs path-style URLs (R2/B2 usually do)

Backblaze B2 is the cheapest route on a free stack (10 GB free). Keep the bucket
**private** — the app issues short-lived signed URLs and the room-photo privacy model
depends on the objects never being publicly readable.

### Step 2b — Background jobs  (turns `automaticDispatchReady` → true) — **NEW, IMPORTANT**

Until now **nothing on Render ever ran the background workers.** `render.yaml` defines
only a web service, and a separate worker service needs a paid plan. The consequence
was a silent product failure: a Landlord who chose **automatic matching** got a success
message, and then their request sat in `searching-for-cleaner` forever. Invitation
expiry/requeue never ran either, so a non-responding Cleaner blocked a request
indefinitely, and the email outbox filled without ever being sent.

The web service can now host those same jobs in its own process. Add:

- `MARKETPLACE_INLINE_WORKERS` = `true`  ← **the new flag; without it nothing changes**
- `MARKETPLACE_WORKER_ENABLED` = `true`
- `TIDEWAY_EXPECT_RELEASE` = the exact eight-character commit reported by the release being deployed
- `WORKER_DATABASE_URL` = the **`tideway_worker`** connection string *(secret — dashboard only)*
- `WORKER_AUTOMATIC_DISPATCH_ENABLED` = `true`
- `WORKER_EMAIL_ENABLED` = `true` *(only once Step 1 email is configured)*
- `WORKER_MEDIA_ENABLED` = `true` *(only once Step 2 storage is configured)*

Rules that matter:

1. **Set `MARKETPLACE_INLINE_WORKERS=true` on exactly one process.** If a standalone
   worker service is ever added later, remove this flag from the web service first —
   otherwise every job runs twice.
2. `WORKER_DATABASE_URL` **must** authenticate as `tideway_worker`, not `tideway_app`.
   The process refuses to start otherwise, by design.
3. **Update `TIDEWAY_EXPECT_RELEASE` before every manual deployment.** The worker
   deliberately refuses a stale value even though the web process can still serve.
   On 10 August 2026, release `bc7ba44c` was healthy but every background job was
   disabled because the value still named `66e93539`. Updating the value to the
   release actually deployed restored all nine scheduled jobs. Confirm the startup
   log says `Inline marketplace workers started` after each deployment.
4. `WORKER_EMAIL_ENABLED` is operator-owned (`sync: false` in `render.yaml`). Keep
   it false until `/api/health` reports `emailReady: true`, the signed suppression
   webhook has been exercised, and a monitored staging delivery has passed. Then
   set it true in Render; later Blueprint syncs preserve that explicit decision.
5. A free Render instance sleeps when idle, which pauses these jobs. They catch up on
   the next request, so due work is not lost, but **wall-clock timing is not guaranteed
   on the free plan.** Do not promise customers timed automatic dispatch until the
   service no longer sleeps.
5. Verify with `GET /api/health` → `marketplace.automaticDispatchReady: true`. If it is
   `false`, the flag, the worker URL or `WORKER_AUTOMATIC_DISPATCH_ENABLED` is missing;
   the service log states which. A worker that cannot start is logged loudly and left
   off — it never takes the website down.

### Step 2c — Assisted walkthrough summary — OPTIONAL, founder decision

The rule-based checklist parser is good but cannot understand phrasing it was
not written for. PR #31 adds an **optional** assisted summary that reads the
dictated walkthrough properly. It is **off unless configured** — with no
provider set, nothing is sent anywhere and there is no cost.

To enable, add to the Render web service:
- `SPEECH_SUMMARY_PROVIDER` = `anthropic`
- `ANTHROPIC_API_KEY` = `sk-ant-…` *(secret — dashboard only)*
- `SPEECH_SUMMARY_MODEL` — optional; defaults to `claude-opus-4-8`

**Do not enable this without the founder's decision.** Two things they must
weigh, neither of which is a defect:

1. **Cost.** Every pause during a walkthrough can trigger one metered call.
   Usage is small per booking but it is real, recurring, per-customer spend.
   A reviewed rate-limit scope (migration 065) caps abuse at 30 calls per
   15 minutes per client, but it does not make honest usage free.
2. **Privacy.** The words the Landlord speaks about the inside of their
   property are sent to Anthropic. Room photos, addresses, account and booking
   details are **not** — only the transcript, and a test enforces that. Whether
   sending the spoken description off-platform is acceptable is a founder call,
   and it should be reflected in the privacy policy before enabling.

Verify with `GET /api/health` → `marketplace.speechSummaryReady: true`. If the
provider is missing, misconfigured, rate-limited or slow, the Landlord silently
keeps the on-device checklist — the walkthrough is never blocked.

### Step 3 — Matching / pricing — COMPLETE FOR STAGING
`matchingReady` requires the **complete** set of 12 `BOOKING_*` variables (all-or-nothing).
These set customer price and margin — **the founder must approve real values.** Starter
values below are now active for restricted testing only; they are a placeholder, not
an approved price list and must not be used for live customer payments.

| Variable | Starter (review) | Meaning |
|---|---|---|
| `BOOKING_TARGET_MARGIN_BPS` | `2500` | 25% target margin |
| `BOOKING_MINIMUM_CONTRIBUTION_PENCE` | `800` | £8 minimum platform take per booking |
| `BOOKING_LABOUR_ON_COST_BPS` | `1500` | 15% on-cost on cleaner pay |
| `BOOKING_PAYMENT_FEE_BPS` | `150` | 1.5% processing |
| `BOOKING_PAYMENT_FEE_FIXED_PENCE` | `20` | 20p fixed processing |
| `BOOKING_RISK_CONTINGENCY_BPS` | `300` | 3% contingency |
| `BOOKING_TRAVEL_COST_PENCE` | `0` | flat travel cost |
| `BOOKING_TRAVEL_COST_PER_KM_PENCE` | `45` | 45p per km |
| `BOOKING_TRAVEL_DISTANCE_MULTIPLIER_BPS` | `13000` | 1.3× (round-trip + buffer) |
| `BOOKING_SUPPLIES_COST_PENCE` | `200` | £2 supplies |
| `BOOKING_OTHER_COST_PENCE` | `0` | other |
| `BOOKING_INVITATION_TTL_MINUTES` | `120` | invite expiry |

### Step 3b — Real-distance matching — COMPLETE (historical)
Add `GEOCODING_PROVIDER=postcodes-io` to the Render web service. This enables the
reviewed UK postcode geocoder used to store property and Cleaner service-area
coordinates before matching. It requires no provider account or API key. Do not call
distance matching production-ready until the secret-safe environment preflight
reports this exact setting.

### Step 4 — Approved testers — COMPLETE
`STAGING_ACCOUNTS_ONLY` is `true`, so signup is blocked until approved emails are listed.
- `STAGING_ACCOUNT_EMAIL_SHA256` = comma-separated SHA-256 hashes of allowed tester emails.
- Generate with `node tools/staging-account-email-hash.mjs <email>` (repo tool). Never commit the raw emails.

### Verify
After Steps 1–2, 2b and 3b, `GET /api/health` should show `emailReady`, `mediaReady`,
`matchingReady` and `automaticDispatchReady` all `true`, and the Render environment
preflight should report no marketplace-runtime omissions.
Then create one landlord + one cleaner test account and run a booking end to end.

### Historical recommended order (already executed where applicable)
1. **Step 2 storage** — without it no booking can be submitted at all.
2. **Step 1 email** — unlocks verification and notification delivery.
3. **Step 2b background jobs** — makes automatic matching and invitation expiry real.
4. **Step 3b** `GEOCODING_PROVIDER=postcodes-io` — real-distance matching.
5. **One redeploy**, then walk a booking end to end on a phone.

Everything above is dashboard configuration. **No code change is required for any of
it** — the code for all five is merged and CI-verified on `main`.

---

## 3. Guardrails (do not break these)
- **Never commit secrets.** The blueprint test (`tests/render-blueprint.mjs`) enforces that
  `SMTP_URL`, `OBJECT_STORAGE_SECRET_ACCESS_KEY`, `STRIPE_SECRET_KEY`, etc. stay out of `render.yaml`.
- Keep `STAGING_ACCOUNTS_ONLY=true` and the public-launch gates `false` until the founder
  approves legal/insurance/pricing/support/terms for a public launch.
- **Do not add a `worker` service to `render.yaml`** — it is a paid service and the blueprint
  test forbids it. The background workers (auto-dispatch, email sending) are deployed separately
  when a paid plan is available; the marketplace runs without them (no auto-dispatch/outbound email until then).
- CI must stay green. Every change goes via a PR; the CI runs unit + real-PostgreSQL and is strict.

## 4. Still founder-only (out of scope for code or Render config)
- Live payments — real Stripe account + underwriting, then `PAYMENTS_ENABLED=true` with **test** keys first.
- Cleaner vetting — choose an ID/DBS/background-check provider; the DB self-verify lock is already in place.
- Maps + navigation — choose a map provider and a location-privacy stance.
- Custom domain + paid plan — set `APP_ORIGIN` to the final HTTPS origin once purchased.
