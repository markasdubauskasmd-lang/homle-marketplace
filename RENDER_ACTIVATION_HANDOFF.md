# Render activation handoff

**For the Render-connected assistant.** Written 2026-07-19 by the code assistant
(GitHub side). The code side is done and merged to `main`. The steps below are
Render-dashboard actions to finish activating the marketplace on the existing
free staging deployment. **Do not commit any secret into the repo** — every
secret below is entered in the Render dashboard only.

---

## 1. Current state (verified against the live service)

Live service: **`homle-marketplace-preview`** → https://homle-marketplace-preview.onrender.com
Database: **`homle-marketplace-staging-db`** (Render free PostgreSQL 16, Frankfurt).

`GET /api/health` was re-verified after the 19 July activation deploy and returns:

```json
{ "marketplace": { "enabled": true, "ready": true, "authenticationReady": true,
  "realtimeReady": true, "emailReady": false, "mediaReady": false,
  "matchingReady": true, "paymentsReady": false },
  "release": { "sourceCommit": "0f6a95c8", "migrationCount": 63 } }
```

Accounts, live updates and matching now work on the restricted real staging database.
The remaining provider-backed blockers are transactional email and private room-photo
storage. Payments intentionally remain off.

> **The deployed commit is now BEHIND `main`.** `autoDeployTrigger` is off by design,
> so the work listed below is merged and CI-verified but **not yet live**. One
> **Manual Deploy → Deploy latest commit** ships all of it.

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
- **NOT verified:** the camera path on a physical device.

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

## 2. Actions on Render (in order)

### Step 0b — Redeploy for everything merged since — OPEN
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

### Step 2 — Room photos  (turns `mediaReady` → true) — **NOW THE CRITICAL BLOCKER**
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

### Step 3b — Real-distance matching — OPEN
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

### Recommended order for one sitting
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
