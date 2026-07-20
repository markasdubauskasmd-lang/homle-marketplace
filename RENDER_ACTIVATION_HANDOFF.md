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
storage. Payments intentionally remain off. The deployed commit is current with
`main`, and `autoDeployTrigger` remains off by design.

---

## 2. Actions on Render (in order)

### Step 0b — Redeploy again for the live-speech fix — OPEN
`main` has moved past the deployed release. Merged since: **#24** (walkthrough speech
now turns into concise bullets live, from the founder's first-run feedback) and **#22**.
Deploy latest commit so the founder sees the fix they asked for. Combine this with
Step 2 below in a single redeploy if the bucket is configured first.

**Open draft PR #23** (`agent/nearby-cleaner-postcode-search`) — CI is green and the
code assistant reviewed it: the geocode fallback is fail-safe, and the wide
`maximumDistanceKm: 500` is correctly bounded by each Cleaner's own
`travel_radius_km` via `LEAST(...)` in migration 006. It was left unmerged only
because it is still marked **draft** — mark it ready when you are finished with it.

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
