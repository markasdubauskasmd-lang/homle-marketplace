# Homle — Launch Readiness

Investigation, prioritised findings and remediation status.

**Audit date:** 30 August 2026
**Method:** the complete application was stood up locally and exercised as a real
participant — PostgreSQL 16 with all locked migrations applied from scratch, the
real `server.mjs` runtime, a real SMTP transport, a real S3-compatible private
object store, and a real Chromium browser driving the signed-in dashboards.
Findings below were reproduced against that running system, not inferred from
reading code.

**On the live site:** `https://homlle.com` is not reachable from the audit
environment — the network policy answers `403` to `CONNECT homlle.com:443`, so no
request leaves the container. Every finding here was therefore reproduced against
a locally hosted instance of the same commit.

That does not weaken the conclusions. `NEXT_STEPS.md` records that "production
remains on the verified `main` release `2ef31b70` with 102 locked migrations" —
the same 102 migrations audited here. P0-1, P0-2 and P0-3 all live inside those
migrations, so **they are live in production now**. The symptoms reported from
the live site (price estimates unavailable, cleaning-time estimates unavailable,
no Cleaner availability, screens stuck "checking") are explained by P0-3 and
P1-1.

**Migration numbering — please read before merging.** `NEXT_STEPS.md` notes that
the unmerged branch `claude/home-webapp-github-access-z3lw0u` also adds
migrations numbered 103 and 104. This audit's migrations take 103 and 104
because they are the next free numbers after `main`'s 102, and that branch is
recorded as not deployable. If both are ever taken forward, one set must be
renumbered and `db/migration-lock.json` updated to match; the lock file will
detect the collision rather than allowing it through silently.

---

## Status summary

| ID | Severity | Issue | Status |
|----|----------|-------|--------|
| P0-1 | Launch blocker | Email verification always fails with a 500 | **FIXED / VERIFIED** |
| P0-2 | Launch blocker | Password reset always fails | **FIXED / VERIFIED** |
| P0-3 | Launch blocker | Outward postcode computed wrongly; matching finds nobody | **FIXED / VERIFIED** |
| P0-4 | Launch blocker | `pnpm test` cannot pass on Linux | **FIXED / VERIFIED** |
| P1-1 | Critical | Matching depends on geocoding, which is optional and fails silently | **Root cause FIXED**; customer-facing message blocked by the Cleaner freeze |
| P1-2 | Critical | No test executes the authentication SQL against a real database | **FIXED / VERIFIED** |
| P1-3 | Critical | Visual baseline pinned to one Chromium build, so the suite is red elsewhere | **FIXED / VERIFIED** |
| P1-4 | Critical | Landing-clip tests fail on any Chromium without an H.264 decoder | **FIXED / VERIFIED** |
| P2-1 | Important | `/landlord/properties` is headed "Bookings" | Documented — deliberate |
| P2-2 | Important | Verification email is plain text only | Documented |
| P2-3 | Important | New customer's first screen leads with an infrastructure caveat | Documented — resolves once configured |

---

## P0 — LAUNCH BLOCKERS

### P0-1 — Email verification always fails with a 500. Nobody can activate an account.

* **Issue** — `POST /api/marketplace/auth/verification/confirm` returns
  `500 internal-error` for every valid token. Because sign-in requires a verified
  address, no account created with an email address and password could ever be
  used. This is the first step of the customer journey, so the entire product was
  unreachable for new customers.
* **Location** — `db/migrations/005_email_password_lifecycle.sql`, function
  `tideway_private.consume_email_verification`; surfaced through
  `src/marketplace/auth-repository.mjs:75`.
* **Reproduction** — register any account, open the verification link, submit the
  token. Server log:
  `column reference "user_id" is ambiguous`.
* **Expected behaviour** — the token is consumed, the address is marked verified,
  and sign-in succeeds.
* **Current behaviour (before fix)** — HTTP 500; the account stays unverified
  forever; `POST /auth/login` then answers `403 email-verification-required`.
* **Root cause** — the function is declared
  `RETURNS TABLE (user_id uuid, email citext, verified_at timestamptz)`. In
  PL/pgSQL those column names become OUT parameters that are in scope for the
  whole body, so the unqualified `WHERE user_id = target_token.user_id` inside
  the function is ambiguous between the OUT parameter and the table column.
  PostgreSQL raises the error the first time that statement executes.
* **Severity** — P0. Complete loss of the sign-up journey.
* **Solution** — `db/migrations/103_authentication_lifecycle_column_resolution.sql`
  replaces the function body, qualifying every column against an explicit table
  alias. Signature, returned columns, privileges, security context, guards and
  audit records are unchanged.
* **Status** — **FIXED / VERIFIED.** Registration → verification → sign-in →
  onboarding → dashboard now completes end to end against a real database.

### P0-2 — Password reset always fails. A locked-out customer can never recover.

* **Issue** — `tideway_private.consume_password_reset` fails with the same
  ambiguity, so a customer who forgets their password can never regain access.
* **Location** — `db/migrations/005_email_password_lifecycle.sql`, function
  `tideway_private.consume_password_reset`.
* **Reproduction** — issue a reset token and call the function with a
  correctly formatted replacement hash:
  `consume_password_reset FAILED: column reference "user_id" is ambiguous`.
* **Expected behaviour** — the password is replaced, the token is consumed and
  every existing session is revoked.
* **Current behaviour (before fix)** — the statement aborts; no password change,
  no session revocation, HTTP 500 to the customer.
* **Root cause** — identical to P0-1: `RETURNS TABLE (user_id uuid, ...)` OUT
  parameters shadowing `password_credentials.user_id`,
  `password_reset_tokens.user_id` and `sessions.user_id`.
* **Severity** — P0. Account recovery is impossible, and the intended
  security behaviour — revoking sessions on password change — never ran.
* **Solution** — same migration; every column qualified against a table alias.
* **Status** — **FIXED / VERIFIED.** Reset now completes and revokes sessions.

### P0-3 — Outward postcodes are computed wrongly, so matching finds nobody.

* **Issue** — a property's outward postcode was derived with
  `substring(upper(replace(postcode,' ','')) from '^([A-Z]{1,2}[0-9][A-Z0-9]?)')`.
  Stripping the space first lets the optional third character swallow the first
  character of the *inward* code, so any single-digit district becomes a
  **different real district**.
* **Location** — four live database functions:
  `recommend_cleaners_for_request`, `invite_cleaner`,
  `get_administrator_coverage_report`, `list_my_booking_summaries`
  (originating in migrations 010, 026, 028, 031, 042, 059, 081, 090, 091).
* **Reproduction** — measured directly:

  | Postcode | Computed | Correct |
  |----------|----------|---------|
  | BS1 4ST | `BS14` | `BS1` |
  | M1 1AE | `M11` | `M1` |
  | E1 6AN | `E16` | `E1` |
  | EH1 1YZ | `EH11` | `EH1` |
  | L1 8JQ | `L18` | `L1` |
  | G1 1XW | `G11` | `G1` |

  Every wrong value is a real but unrelated district — BS14 is Whitchurch, six
  miles from the BS1 city centre; E16 is Canning Town, not Whitechapel.
* **Expected behaviour** — `BS1 4ST` yields `BS1`, matching Cleaners who
  registered `BS1` as a service area.
* **Current behaviour (before fix)** — `exact_postcode_area` was evaluated
  against the wrong district. With no geocoding provider configured
  `distance_km` is `NULL`, and exact-area membership is then the only
  eligibility signal that can be true — so a Landlord in a single-digit
  city-centre district matched **zero** Cleaners no matter how many served that
  area, while Cleaners in the unrelated neighbouring district were eligible to
  be invited. Cleaners were also shown the wrong area label for a job.
* **Root cause** — a greedy optional character in the regex, made reachable by
  removing the space before matching. (With the space left in place the same
  regex would have been correct, which is why the defect was not obvious.)
* **Severity** — P0. Silent mismatching in exactly the dense urban postcodes a
  cleaning marketplace launches into, plus incorrect location data shown to
  Cleaners.
* **Solution** — `db/migrations/104_correct_outward_postcode.sql` adds
  `tideway_private.outward_postcode(text)`, which applies the actual rule (a UK
  inward code is always exactly three characters, so the outward code is the
  remainder), accepts a value that is already an outward code, and returns
  `NULL` for anything else so eligibility fails closed rather than on a wrong
  district. The four live functions are reproduced with exactly that one
  expression changed.
* **Status** — **FIXED / VERIFIED.** All ten sampled postcodes now resolve
  correctly, and the matching function returns eligible Cleaners for a BS1
  property.

### P0-4 — `pnpm test` cannot pass on Linux, so the suite proves nothing in CI or Docker.

* **Issue** — the suite aborts partway through with an opaque
  `AssertionError: null !== 0`.
* **Location** — `tests/data-relocation.mjs:46`.
* **Reproduction** — `pnpm test` on any machine without PowerShell.
* **Expected behaviour** — the suite either runs the relocation guard rails or
  reports clearly that it cannot, and the remaining tests still run.
* **Current behaviour (before fix)** — `spawnSync("pwsh", …)` fails to launch,
  `status` is `null`, the assertion compares `null` to `0`, the process throws,
  and **every test after it is skipped silently**. The repository ships a
  Dockerfile and deploys to Render — both Linux — so the full suite was red on
  every platform the product actually runs on.
* **Root cause** — no guard for a missing interpreter, unlike the browser tests
  in this repository, which skip explicitly when Chromium is absent.
* **Severity** — P0 for launch confidence: a red suite cannot gate a release,
  and the tests hidden behind the failure were never being run.
* **Solution** — skip with an explicit message when PowerShell is unavailable,
  matching the existing convention. The guard rails still run wherever `pwsh`
  exists, so coverage is unchanged on CI images that provide it.
* **Status** — **FIXED / VERIFIED.** Full suite now runs to completion.

---

## P1 — CRITICAL

### P1-1 — Matching silently depends on geocoding, which is optional and off by default.

* **Issue** — a Landlord can complete and submit a request, reach
  `searching-for-cleaner`, and match nobody — with `HTTP 200` and an empty list
  — while fully eligible Cleaners exist.
* **Location** — `src/marketplace/booking-workflow.mjs` (`priceableTravelCost`),
  `src/marketplace/matching-service.mjs` (`rankRequestCandidates`),
  `deployment-readiness.mjs`.
* **Reproduction** — with `GEOCODING_PROVIDER=none` (the documented default) and
  any non-zero `BOOKING_TRAVEL_COST_PER_KM_PENCE`, create a property and request,
  publish a 100 %-complete Cleaner covering that outcode with matching
  availability, then request matches. The database function returns the Cleaner;
  the API returns `candidates: []`.
* **Expected behaviour** — either the deployment refuses to start in a
  configuration that cannot match anyone, or the empty result explains itself.
* **Current behaviour (before fix)** — without coordinates `distance_km` is
  `NULL`, so `priceableTravelCost` throws `409 travel-distance-unavailable`;
  `rankRequestCandidates` swallows every `409` and drops the candidate. The
  Landlord is shown an empty list with no reason, and nothing in the boot
  sequence, preflight or logs reports that matching cannot succeed.
* **Root cause** — an undeclared dependency. `.env.example` describes geocoding
  as optional and states that Homle "keeps its outward-postcode fallback", but
  the pricing path has no such fallback: per-kilometre travel pricing makes a
  resolved distance mandatory.
* **Severity** — P1. This is the direct explanation for the reported live
  symptoms of unavailable price and time estimates and no Cleaner availability.
* **Compounding factor — the health endpoint said everything was fine.**
  `matchingReady` was computed as "a booking-pricing policy loaded"
  (`src/marketplace/runtime.mjs`), which is true in exactly the configuration
  that can never match anyone. `/api/health` therefore reported
  `matchingReady: true` beside `geocodingReady: false`, so monitoring, the live
  release check and the activation snapshot all showed green on a marketplace
  that could not complete a single booking. That is why the failure was visible
  to customers long before it was visible to operators.
* **Solution applied** — two changes, both outside the frozen modules:
  1. `deployment-readiness.mjs` rejects a production deployment that prices
     travel per kilometre without a geocoding provider, so the combination
     cannot ship silently again. The configuration that makes matching
     impossible is now refused at the gate rather than discovered by a customer
     after they have submitted a request.
  2. `matchingReady` now means a Landlord can actually be shown a Cleaner: a
     pricing policy **and**, when travel is priced by distance, a geocoding
     provider. Verified in all three configurations — distance pricing without
     geocoding reports `false`; distance pricing with geocoding reports `true`;
     a flat travel fee, which needs no distance, reports `true`.
* **Deliberately not applied — blocked by the Cleaner backend freeze.** A second
  improvement was prepared and proven working: reporting *why* a request has no
  candidates, so a Landlord (and an operator) can tell "nobody covers this job"
  apart from "Cleaners cover it but Homle could not price the travel". It was
  measured returning `noCandidateReason: "travel-distance-unavailable"` on the
  running system. Delivering it requires editing
  `src/marketplace/matching-service.mjs`, which `tests/cleaner-dashboard-freeze.mjs`
  protects under the active Cleaner backend freeze. The change was **reverted**
  rather than shipped: the freeze is an explicit founder objective, and that
  test states it may only be refreshed when the founder replaces the objective.
  It is not this audit's decision to make. Lifting the freeze for this one
  module would take roughly ten lines — an optional observer callback plus one
  extra response field — and changes no Cleaner outcome: the same candidates are
  returned in the same order, with one additional explanatory field present only
  when the list is empty.
* **Remaining external dependency** — a geocoding provider must be selected in
  the deployment. `postcodes-io` requires no credential and no account;
  `google-maps` requires a restricted server key.
* **Status** — **ROOT CAUSE FIXED / VERIFIED.** The customer-facing explanation
  is **BLOCKED** pending a founder decision on the freeze.

### P1-2 — No test ever executed the authentication SQL, which is why P0-1 and P0-2 shipped.

* **Issue** — the authentication lifecycle functions were covered only by tests
  asserting that the migration *text contains their names* and by unit tests
  against a fake repository. Nothing executed them against PostgreSQL.
* **Location** — `tests/marketplace-foundation.mjs:221`,
  `tests/credential-service.mjs:122`.
* **Expected behaviour** — the functions the entire product depends on are
  executed against a real database before release.
* **Current behaviour (before fix)** — two total launch blockers survived 102
  migrations and an extensive suite because no test ran the SQL.
* **Severity** — P1. This is the process defect behind the P0s; without it the
  same class of bug recurs.
* **Solution** — a real-PostgreSQL regression test that exercises registration,
  email verification, sign-in and password reset through the actual functions,
  and asserts that no `RETURNS TABLE` function in `tideway_private` references an
  OUT parameter name unqualified in a predicate — the exact defect class of P0-1
  and P0-2. It skips with a clear message when no database is supplied, and runs
  wherever one is.
* **Status** — **FIXED / VERIFIED.**

### P1-3 — The visual baseline was pinned to one Chromium build, so the suite was red everywhere else.

* **Issue** — `tests/landlord-computed-styles.mjs` failed with 772 differences on
  a Chromium other than the one that captured its baseline. Combined with P0-4,
  `pnpm test` could not pass on this machine at all.
* **Location** — `tests/landlord-computed-styles.mjs`,
  `tests/fixtures/landlord-computed-styles.json`.
* **Reproduction** — run the test with a different Chromium build.
* **Root cause** — two sources of browser-dependent noise, neither visible to a
  customer:
  1. `outline-width` was recorded for all 764 measured elements. **Every one of
     them has `outline-style: none`**, so no outline is painted and the width
     describes nothing — but Chromium builds disagree about the value (`3px` on
     the capturing build, `0px` here), producing 764 failures.
  2. `oklch()` colours resolve to slightly different floating-point components
     between builds — `oklch(0.974813 0.0135622 27.005)` against
     `oklch(0.97481 0.0135611 27.0044)` for the same stylesheet — producing the
     remaining 8.
* **Severity** — P1. A visual-regression baseline that only its author's browser
  can reproduce cannot gate a release, and its failures train reviewers to
  ignore it.
* **Solution** — the baseline was **not** blanket-regenerated, which would have
  hidden any real regression. Instead the two noise sources were removed at
  capture: `outline-width` and `outline-color` are skipped when
  `outline-style` is `none` (so genuine focus rings are still compared exactly),
  and `oklch()` components are rounded to three significant figures — orders of
  magnitude finer than any perceptible or intentional colour change. The
  regenerated baseline was then diffed against the committed one and audited:
  the only changes are the removal of the 1,528 meaningless outline keys and the
  rounding of 36 colour values. **Zero elements added or removed and zero
  semantic value changes**, so no real regression could have been absorbed. The
  test then passed three consecutive runs.
* **Status** — **FIXED / VERIFIED.**

### P1-4 — The landing-clip tests fail on any Chromium without an H.264 decoder.

* **Issue** — `tests/browser-mobile-entry.mjs` failed with "The landing clip
  failed to decode, error code 4" and `tests/browser-landing-motion.mjs` with
  "The clip does not play while its act is on screen." Both aborted the suite.
* **Location** — `tests/browser-mobile-entry.mjs`,
  `tests/browser-landing-motion.mjs`.
* **Root cause** — measured, not assumed: in this runner
  `canPlayType('video/mp4; codecs="avc1.42E01E"')` returns `""`, so the browser
  has **no H.264 decoder** — it is a Chromium build without proprietary codecs.
  `MEDIA_ERR_SRC_NOT_SUPPORTED` (code 4) follows, and an undecodable clip can
  never leave the paused state. The landing page and its MP4 are fine; every
  customer browser (Chrome, Edge, Safari, Android Chrome, iOS Safari) decodes
  H.264. **This is not a product defect** and no customer is affected.
* **Severity** — P1 for launch confidence only: together with P0-4 and P1-3 it
  meant `pnpm test` could not complete on this machine.
* **Solution** — the three playback-dependent assertions in each test are gated
  on the runner actually supporting H.264, and say so loudly when skipped. Every
  other assertion — the reviewed content-addressed source, the deferred
  activation, the WebP poster, the absence of oversized fallbacks, image
  loading, overflow and touch targets — still runs everywhere. Where a codec
  exists, playback is proved exactly as before.
* **Status** — **FIXED / VERIFIED.** Both tests now pass here and retain full
  strength on a proprietary-codec build.

---

## P2 — IMPORTANT

### P2-1 — `/landlord/properties` is headed "Bookings".

* **Location** — `public/landlord-dashboard.js:1131` (`workspaceTabCopy`).
* **Current behaviour** — `/landlord/properties` resolves to the `places` view,
  whose heading is "Bookings"; `/landlord/requests` is headed "Properties".
* **Assessment** — this is deliberate and documented in the source: Properties
  was folded into Bookings, and the old address is kept resolving rather than
  404ing a bookmarked link. It is an information-architecture inconsistency
  rather than a defect, and changing it is a product decision about naming, not
  a bug fix.
* **Status** — Documented, not changed. Recommended follow-up: settle the
  Property / Place / Booking vocabulary and make the URL, navigation label and
  heading agree.

### P2-3 — A brand-new customer's first screen leads with an infrastructure caveat.

* **Location** — the Landlord dashboard readiness banner
  (`/landlord/home`).
* **Current behaviour** — a customer who has just signed up sees, above
  everything else: "Postcode distance matching is being connected…" and, once
  geocoding is configured but the dispatch worker is not, "Automatic Cleaner
  matching is temporarily paused…". Both are accurate and both clear once the
  deployment is complete — they are driven by real readiness signals, not
  hard-coded.
* **Assessment** — this is the product being honest rather than hiding a
  degraded state, which is the right instinct and worth keeping. The
  observation is only that on the first screen of an empty account it occupies
  the position where a next action belongs, so a new customer reads an
  infrastructure note before they read what to do. Once the deployment is fully
  configured neither banner appears, so this resolves itself at launch and no
  change was made. If either persists in production, the cause should be fixed
  rather than the banner suppressed.
* **Status** — Documented, not changed. Resolves once configuration is complete.

### P2-2 — Transactional email is plain text only.

* **Location** — `src/marketplace/email-delivery-message.mjs`.
* **Current behaviour** — verification and reset emails send a `text/plain` part
  only. Deliverability is fine and the link works, but the messages look
  unbranded next to the rest of the product.
* **Assessment** — cosmetic; no functional impact. A plain-text-only message is
  also the lowest-risk choice for spam filtering, so this is a deliberate
  trade-off worth keeping unless brand consistency is judged more important.
* **Status** — Documented, not changed.

---

## What was verified working

These were exercised against the running system and behaved correctly.

* **Authentication** — registration, email verification, sign-in, workspace
  activation, onboarding, session rotation, sign-out.
* **Object-level authorisation** — a second Landlord attempting to read, update,
  submit or withdraw another Landlord's property or request receives `404`
  without disclosing that the record exists; a Cleaner attempting a Landlord-only
  route receives `403 role-rejected`. Authorisation is enforced server-side, not
  by hiding buttons.
* **Rate limiting** — repeated sign-in and sign-up attempts are throttled with
  `429` and a `Retry-After` header, backed by a shared PostgreSQL limiter rather
  than per-process memory.
* **Pricing** — a single engine (`public/pricing-engine.js`) is used by both the
  browser and the server, so the customer's number and the authorised number
  cannot drift. All amounts are integer pence throughout; the quote is frozen
  onto the request when shown and survives to submission.
* **Validation** — property, request, profile and availability inputs are
  validated server-side with bounded lengths and explicit error codes; UK
  postcodes, task uniqueness and time windows are all enforced on the server.
* **Dependencies** — `pnpm audit --prod --audit-level high` reports no known
  vulnerabilities; the lockfile is pinned by SHA-256.
* **Browser** — no console errors, page errors or failed requests on any public
  or authenticated Landlord route.
* **Secrets** — no credentials, keys or `.env` files are committed.

---

## Homle final launch status

**Overall status: CONDITIONAL GO.** Every launch blocker found is fixed and
verified. The remaining condition is configuration, not code: a geocoding
provider must be selected, and Stripe must be activated, before real customers
can be served.

| | |
|---|---|
| **P0 remaining** | 0 |
| **P1 remaining** | 0 in code. One deliberate item (P1-1's customer-facing message) is withheld pending a founder decision on the Cleaner backend freeze. |
| **Production build** | `pnpm run check` passes: 508 source and test files syntax-checked, text-encoding guard, 104 locked migrations, dependency lock verified. |
| **Automated tests** | `pnpm test` runs to completion for the first time on Linux. The coverage guard confirms all 195 test files execute. |
| **Security** | Reviewed. Object-level authorisation enforced server-side and verified by probe; cross-account reads return 404 without disclosing existence; role separation enforced; shared-database rate limiting active; no committed secrets; no known dependency vulnerabilities; CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy` and a route-scoped `Permissions-Policy` all set, with HSTS correctly gated to production. |
| **Payments** | Not exercised. `PAYMENTS_ENABLED=false` in the audited configuration and the adapter rejects live keys until the approved test platform, webhook endpoint and staging database pass. |
| **Scanner** | Routes load with no console, page or network errors; the scan journey's own suites pass. Camera, microphone and vision-model behaviour need a real device and an `ANTHROPIC_API_KEY`, so they were not exercised here. |
| **Landlord journey** | Verified end to end on a database built from scratch: register → verify email → sign in → onboard → add property → create request → priced quote (£90.00, integer pence) → submit → matched Cleaner ranked with a real 0.69 km distance. |
| **Cleaner journey** | Verified: register → verify → sign in → onboard → publish a 100 %-complete profile with services and service areas → add availability → become matchable. |
| **Mobile** | Checked at 320, 375, 390, 430, 768, 1280 and 1920 px. No horizontal overflow on any tested route. |
| **Performance** | Not profiled. No blocking issue observed; page loads carried no failed requests. Core Web Vitals need a deployed HTTPS origin to measure honestly. |
| **Accessibility** | Reviewed. Correct `lang`, sound heading structure, every form control labelled, every button named, and every image carries an `alt` attribute — decorative images correctly using `alt=""`. |

### Changes completed

1. `db/migrations/103_authentication_lifecycle_column_resolution.sql` — makes
   email verification and password reset executable.
2. `db/migrations/104_correct_outward_postcode.sql` — adds
   `tideway_private.outward_postcode` and corrects the four live functions that
   derived a wrong postcode district.
3. `deployment-readiness.mjs` — refuses a production deployment that prices
   travel by distance without a geocoding provider.
4. `src/marketplace/runtime.mjs` — `matchingReady` now means a Landlord can
   actually be shown a Cleaner.
5. `db/integration/deployment-verification.sql` — proves both fixes are present
   in a target database and fails the deployment if they are not.
6. `tests/plpgsql-column-resolution.mjs` — new; catches the P0-1/P0-2 defect
   class with no database required.
7. `tests/authentication-lifecycle-database.mjs` — new; executes the
   authentication lifecycle against real PostgreSQL.
8. `tests/data-relocation.mjs` — skips cleanly without PowerShell instead of
   aborting the suite.
9. `tests/landlord-computed-styles.mjs` and its baseline — made portable across
   Chromium builds without weakening the comparison.
10. `tests/browser-mobile-entry.mjs`, `tests/browser-landing-motion.mjs` — clip
    playback assertions gated on the runner having an H.264 decoder.
11. `tests/marketplace-http.mjs`, `tests/database-assets.mjs` — updated to the
    corrected contracts.

### Recommended post-launch monitoring

* Alert on `matchingReady: false` from `/api/health`. It now means real
  customers cannot be matched, and it is the single highest-value signal here.
* Alert on requests that stay `searching-for-cleaner` past their requested start
  time — the funnel's dead end, whatever the cause.
* Track the rate of matching calls returning zero candidates against the volume
  of published Cleaners; a rise means supply, pricing or coverage has moved.
* Watch `500`s from the authentication routes. Both P0s presented that way and
  nothing alerted on them.
* Watch email delivery failures: the sign-up response is deliberately generic,
  so a broken transport is invisible from the customer's side.

---

## Remaining external dependencies

These cannot be completed from the audit environment and need a decision or a
credential from the operator.

1. **Geocoding provider** — required before any booking can be matched. See
   P1-1. `postcodes-io` needs no credential.
2. **Stripe** — `PAYMENTS_ENABLED=false` in the audited configuration, so the
   payment lifecycle was not exercised end to end. The adapter rejects live keys
   until the founder-approved test platform, webhook endpoint and staging
   database all pass.
3. **Live site access** — `homlle.com` is unreachable from this environment, so
   the deployed build could not be compared against this commit.
4. **Founder launch attestations** — `pnpm run preflight:production` refuses a
   public production deployment until each of these is explicitly set true, and
   each represents a real-world commitment no audit can make on the founder's
   behalf. They are correctly enforced and worth planning against:
   `PUBLIC_MARKETPLACE_APPROVED`, `LEGAL_BUSINESS_READY`, `INSURANCE_READY`,
   `CLEANER_SUPPLY_READY`, `PRICING_POLICY_APPROVED`, `CUSTOMER_SUPPORT_READY`,
   `CUSTOMER_TERMS_READY`. `CLEANER_SUPPLY_READY` is the one with a genuine lead
   time: it needs at least one real, verified, available Cleaner, and until then
   a correctly configured marketplace will still match nobody — for a legitimate
   reason rather than the defects fixed above.

---

## A note on scope and the Cleaner backend freeze

`tests/cleaner-dashboard-freeze.mjs` holds 89 Cleaner Dashboard files and nine
shared Cleaner-outcome modules — booking, matching, payout economics and
dispatch — byte-for-byte unchanged, and states that its digest may only be
refreshed when the founder replaces that objective. That freeze was respected
throughout: one prepared improvement was reverted rather than shipped (see
P1-1), and no protected file was touched. Every fix above lands in database
migrations, deployment gating, the runtime's readiness reporting, or tests.

Two other things were deliberately left alone. The Properties/Bookings heading
(P2-1) is documented in the source as an intentional consolidation, and renaming
it is a product decision, not a defect fix. The computed-style baseline was not
blanket-regenerated to force a green build; the two sources of browser noise
were removed at capture instead, and the resulting baseline diff was audited to
confirm no real design change was absorbed.
