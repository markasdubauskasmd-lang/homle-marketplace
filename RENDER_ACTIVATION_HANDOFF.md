# Render activation handoff

## Local verified improvement awaiting publication

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
- Focused journey, HTTP, active-job, progress, messaging, review, dashboard and animation tests and the full `pnpm run check` plus `pnpm test` suites pass locally.
- These local changes have not been committed, pushed or deployed.

## CURRENT LIVE TRUTH - verify this before following older notes

Verified on **2026-07-23** against
`https://homle-marketplace-preview.onrender.com`:

- live release: **`746d0599`**, database migrations: **66**
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
pnpm run verify:live-activation https://homle-marketplace-preview.onrender.com --expect-release=746d0599
```

The verifier makes bounded no-credential requests to the public health and
account-provider endpoints, requires the exact packaged release, projects only
approved boolean capability fields and names the remaining provider actions. It never activates payments,
changes a booking or prints environment variables. Sections below are retained
as implementation history; where they contradict this section or the verifier,
the verifier is authoritative.

### Local scanner improvements waiting for a future approved release

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
- The complete local syntax and product suites pass with these scanner,
  animation and account-first booking changes. They remain uncommitted,
  unpushed and undeployed pending the normal approved release process and a
  physical signed-in two-phone rehearsal.
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
| `/landlord/scan` | Direct entry to the scanner; normally it opens as an overlay inside the journey |

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

### 1a. Merged since the deployed release — needs a redeploy to go live

Read this before deploying, so you know what changes for the founder.

| PR | What it changes | Needs a Render setting? |
|---|---|---|
| **#24** | Speaking the room walkthrough now turns into concise Cleaner bullets **live**, about a second after each pause. The separate summarise step is gone. Typing works the same way. Manual edits to the checklist switch the live pass off so they are never overwritten. | No |
| **#26** | The tracking page now shows **how close the Cleaner is** — a marker that travels toward the home plus an "Approach" readout. Derived from the estimated arrival *time*, never from coordinates, so the customer's home position never reaches the browser. No map provider, no API key, no cost. Progress is monotonic: a delay holds position and says "running later than expected" rather than moving the Cleaner backwards. | No |
| **#27** | **Background jobs can finally run** (see Step 2b — this one *does* need settings) and **customers can now read written reviews** on Cleaner profiles. | **Yes — Step 2b** |
| **#25** | Documentation only: recorded that room-photo storage blocks the first real booking. | No |
| **#29** | **The spoken walkthrough now produces a usable checklist.** The founder reported the previous output was unusable, and it was — see the section below, because two of the defects affected price and contract terms. | No |

**Thank you — Steps 2b and 3b are confirmed working on the live service.** `GET /api/health`
now reports `automaticDispatchReady: true` and `geocodingReady: true`, so background jobs
are genuinely running and matching is distance-aware. `emailReady` and `mediaReady` are
still `false`; **Step 2 (room-photo storage) remains the one blocker preventing any
booking from being completed end to end.**

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
3. A free Render instance sleeps when idle, which pauses these jobs. They catch up on
   the next request, so due work is not lost, but **wall-clock timing is not guaranteed
   on the free plan.** Do not promise customers timed automatic dispatch until the
   service no longer sleeps.
4. Verify with `GET /api/health` → `marketplace.automaticDispatchReady: true`. If it is
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
