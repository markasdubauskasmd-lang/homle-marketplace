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

`GET /api/health` currently returns:

```json
{ "marketplace": { "enabled": true, "ready": true, "authenticationReady": true,
  "realtimeReady": true, "emailReady": false, "mediaReady": false,
  "matchingReady": false, "paymentsReady": false },
  "release": { "sourceCommit": "307eba6b", "migrationCount": 60 } }
```

So accounts and live updates already work on the real database. Four capabilities
are still off, and the deployed build is **stale**.

**The deployed commit `307eba6b` predates 6 merged PRs** (#12–#17). The stale build
still has the Apple sign-in 503 bug, no geocoding, and only 60 migrations.
`autoDeployTrigger` is `off` by design, so it will not update itself.

Merged since that build (all on `main`, all CI-green):
- #12 — fixes 4 always-503 rate-limit scopes incl. **Apple sign-in**; Render IP-spoof fix (migration 061)
- #13 — GitHub Actions CI (unit + real PostgreSQL)
- #14 / #15 — postcode geocoding for properties and cleaner service areas
- #16 — cleaner self-verify lockdown trigger (migration 062)
- #17 — payment webhook mismatch alerting

---

## 2. Actions on Render (in order)

### Step 0 — Redeploy from `main` (required first)
Render → `homle-marketplace-preview` → **Manual Deploy → Deploy latest commit**.
This ships #12–#17 and, via the staging bootstrap, applies migrations 61 and 62.
After it deploys, `GET /api/health` should show `migrationCount: 62`.

### Step 1 — Email  (turns `emailReady` → true)
Environment tab, add either provider (pick one). **RESEND is easiest on Render free**
(HTTPS, no SMTP port):
- `EMAIL_DELIVERY_PROVIDER` = `resend`
- `RESEND_API_KEY` = `re_…`  *(secret — dashboard only)*
- `EMAIL_FROM` = `Homle <no-reply@YOURDOMAIN>`

*(SMTP alternative: `EMAIL_DELIVERY_PROVIDER=smtp`, `SMTP_URL=smtps://user:pass@host:465`.)*

### Step 2 — Room photos  (turns `mediaReady` → true)
An S3-compatible private bucket (Cloudflare R2 / Backblaze B2 / AWS S3). Add:
- `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_REGION`
- `OBJECT_STORAGE_ACCESS_KEY_ID`, `OBJECT_STORAGE_SECRET_ACCESS_KEY` *(secret)*
- `OBJECT_STORAGE_FORCE_PATH_STYLE` = `true` if the provider needs path-style URLs (R2/B2 usually do)

### Step 3 — Matching / pricing  (turns `matchingReady` → true)
`matchingReady` requires the **complete** set of 13 `BOOKING_*` variables (all-or-nothing).
These set customer price and margin — **the founder must approve real values.** Starter
values below are for testing only; they are a placeholder, not an approved price list.

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

### Step 4 — Approved testers  (needed to create any account)
`STAGING_ACCOUNTS_ONLY` is `true`, so signup is blocked until approved emails are listed.
- `STAGING_ACCOUNT_EMAIL_SHA256` = comma-separated SHA-256 hashes of allowed tester emails.
- Generate with `node tools/staging-account-email-hash.mjs <email>` (repo tool). Never commit the raw emails.

### Verify
After Steps 0–3, `GET /api/health` should show `emailReady`, `mediaReady`, `matchingReady` all `true`.
Then create one landlord + one cleaner test account and run a booking end to end.

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
