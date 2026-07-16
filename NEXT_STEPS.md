# Tideway — Build Brief & Work Queue (for the coding agent)

**Audience:** the coding agent (Codex) working in this repo (`tideway-marketplace/`).
**Companion audit:** `../TIDEWAY_AUDIT_2026-07-15.md` (full findings, evidence, line refs). Finding IDs below (F1–F21) map to that audit.
**Last updated:** 16 July 2026.

## Implementation progress — 16 July 2026

- **P0-1, P0-2, P0-4 and P0-8 complete** in `719cc24`: room scans require their private tracker token and never return it; browser mutations fail closed without same-origin evidence; `/admin` and `/admin.html` share the same gate; `ADMIN_REQUIRE_KEY=true` closes the localhost exception; isolated HTTP regressions cover each boundary.
- **P0-3, P0-5 and P0-6 complete** in `5cc8f99`: shipped mojibake is repaired and guarded; cloud-synchronised private data paths produce a startup privacy warning; retention remains launch-gated; private-data backups default off-project, reject common cloud-sync destinations, extract and compare every file, and state truthfully that the zip is unencrypted.
- **P0-7 complete in launch documentation**: the Polsia and independent-local scorecards are separated, the current inventory is 173 JavaScript modules / 61 test files, and the unsupported £20 referral claim is inventoried.
- Current full evidence after the verified participant-review checkpoint: 164 syntax/encoding/database/dependency-asset commands and 64 test commands pass (228 total); the production dependency audit reports no known vulnerabilities and real lead/scan data was not touched. The earlier verified source archive remains the tracked `5cc8f99` checkpoint: `../Tideway-independent-source-2026-07-16.zip`, 192 entries, SHA-256 `237D331367EF0B0C85AE5420B8FBDB1E405FEFE4BDDCB8ACB84CFAFDFE18E705`.
- **Founder action still required before real intake:** configure an access-restricted off-OneDrive `DATA_DIR`, stop the server and create/store one private backup on an approved encrypted device or vault, then record the retention decisions. The agent must not move or copy live private records without that explicit location/approval.
- **Next engineering gate:** record PostgreSQL as the production marketplace runtime while keeping the NDJSON application time-boxed to the Tier 0 concierge pilot. Do not add long-term auth or payments to the NDJSON monolith.
- **Storage-risk visibility added after P0:** the control desk now presents a red action-required storage panel and includes off-sync storage in operating-rule readiness. The API exposes only the provider and safe/unsafe state, never the private path, and performs no relocation.
- **Private-data relocation is now safely rehearsable:** `tools/relocate-data.ps1` defaults to a zero-write dry run, refuses project-internal/cloud-synchronised destinations, requires an explicit stopped-server confirmation plus an exact typed phrase for copying, never overwrites or deletes, and verifies every copied file plus the unchanged source by SHA-256. Synthetic regression coverage is part of the full suite. The live folder was inspected only in dry-run mode: five private files remain in OneDrive pending founder approval of the destination, backup and access controls.
- **E3 takeover hardening plus Google and Facebook sign-in complete in detached source:** verified Google email may deduplicate automatically only into an already verified social-only account. Facebook's email remains untrusted: a new App-bound subject must consume Tideway's own single-use mailbox-verification link before account creation or social-only linking. Pre-authenticated callbacks cannot attach to password, inactive or unverified accounts. A verified password account can now connect Google/Facebook from `/settings` only after persistent-lockout-aware current-password step-up; the signed OAuth purpose plus a second user/session/provider-bound cookie prevent callback downgrade or cross-account attachment, and function-only PostgreSQL collision locks/audit history are prepared. Social-only step-up and lockout-safe removal remain closed. Both providers remain disabled until real PostgreSQL/SMTP tests, HTTPS origin, app review and verified credentials pass.
- **Real Cleaner profile interfaces complete behind the attachment gate:** `/cleaners` is a real API-backed, safely rendered search interface with honest unavailable/empty states and no fixture people. `/cleaner/profile` is an owner-only mobile editor that preserves unchanged private area coordinates, validates exact prices and every profile field, requires session/CSRF protection and blocks incomplete publication. Real profiles remain absent until genuine account onboarding and PostgreSQL staging pass.
- **Real Landlord account workspace complete behind the attachment gate:** `/landlord/dashboard` lists and creates only the signed-in owner's private properties, turns speech into editable room-by-room bullets and saves exact future cleaning-request drafts. The browser always sends `submit: false`, so no matching, invitation, booking or payment can occur. Successful Google, Facebook and email sessions now hand established roles to the correct workspace; media capture remains on the working `/request` pilot until private account storage passes staging.
- **Real participant active-job interface complete behind the attachment gate:** `/bookings/:bookingId`, `/tracking` and `/cleaning-progress` now open one authenticated mobile screen backed by the participant-only journey, progress, property and durable event APIs. Cleaners deliberately start or resume foreground location, record arrival, start/pause/resume work, update tasks/issues, propose unexpected work and finish only after every task resolves; Landlords receive live status and control unexpected-task approval at the frozen price. Browser watches stop at arrival/terminal state/page exit, no external map receives coordinates and unavailable infrastructure fails closed. Approved map/ETA selection and the final HTTPS two-device trial remain open.
- **Private booking chat connected to the active-job screen:** Cleaner and Landlord messages use the existing participant-only service, server-enforced contact-detail blocking, CSRF-protected idempotent sends, stable earlier-history cursors and the durable no-poll event stream. The browser preserves the retry key after a lost response, safely deduplicates live delivery and renders no message as HTML. Real two-account PostgreSQL/HTTPS evidence is still required before activation.
- **Private before/after job evidence connected to the active-job screen:** after arrival the Cleaner can take one rear-camera image or choose an existing supported photo, label it before/after/issue and attach it to a checklist task. The browser size/type-checks and SHA-256 hashes locally, uses only the server's exact signed headers, omits Tideway credentials/referrers, blocks redirects, retains safe retry state and waits for server sanitation before showing metadata. Participants request five-minute private views; the page clears each signed URL on close. The active-job CSP permits only validated exact storage/bucket origins, while camera stays denied everywhere else. Real bucket/CORS/lifecycle/content-threat and HTTPS device evidence remains required.
- **Verified ratings connected to the completed-booking experience:** the Landlord now confirms the Cleaner-finished visit after checking tasks, notes, issues and private photos, then receives one overall/category/written review form. The Cleaner sees nothing until approval and can add one final professional response. Client states never bypass the completed-only, participant-only, one-per-booking, moderation and approved-only aggregate rules already enforced by PostgreSQL. Real two-account PostgreSQL/HTTPS evidence and Administrator moderation operations remain required before activation.
- **Real participant booking dashboards complete behind the attachment gate:** `/cleaner/dashboard` lists assigned invitations and active/upcoming/history records, lets the Cleaner accept or decline with session/CSRF protection, and links confirmed work to the active-job screen. `/landlord/dashboard` now lists the Landlord's active/upcoming/history records and role-safe payment/job actions. Migration 026 owns participant isolation and returns only Cleaner pay to a Cleaner or customer total to a Landlord; precise addresses, access instructions, contact data, platform margin and the other side's price are excluded.
- **PostgreSQL source activation gate added:** all 27 ordered migrations plus the runtime/worker least-privilege grant scripts are SHA-256 locked and checked for missing, unexpected, reordered, modified or transaction-boundary-damaged assets. This prevents an unreviewed SQL set from silently entering staging, but does not claim the absent real PostgreSQL execution/RLS/concurrency evidence required by E1/E2.
- **PostgreSQL deployment verifier prepared:** `tools/postgres-verification-runner.mjs` invokes a read-only SQL audit without putting the verification URL or password in process arguments. It validates the deployed RLS inventory, restricted roles, ownership, critical constraints/indexes, trusted definer functions, app/worker grants and protected-table revocations. Its source and credential-handling tests pass, but it has not run against a real database because this computer has no PostgreSQL/`psql` and no approved staging connection; E2 remains open.
- **PostgreSQL behavioural integration harness prepared:** a guarded disposable-database runner now uses distinct owner/app credentials, reserved non-customer fixtures and two simultaneous `psql` transactions. It is ready to prove ownership RLS, unrelated-user denial, pre/post-acceptance access-instruction privacy, revoked direct workflow writes, exactly-once booking history and the exclusion constraint under a real acceptance race, with fixture cleanup on success/failure. Local orchestration tests pass; E2 still cannot be marked complete until this exact harness passes against PostgreSQL 16.
- **E1 fail-closed attachment now owns database, client identity, SMTP and private media boundaries:** the default-off attachment constructs a shared limiter, trusted proxy resolver, strict-TLS mailer and private S3-compatible storage internally. Storage permits only server-generated quarantine/final job-photo keys, signs exact checksum/encryption headers, bounds streamed source bytes/pixels/pages, applies orientation, flattens alpha, strips metadata through JPEG re-encode, records an output checksum and issues five-minute no-store reads. PostgreSQL, SMTP and bucket access are verified before routes attach; every resource closes on failure. Exact `pg`, Nodemailer, matched AWS SDK v3 and Sharp packages are full-lockfile gated. Real provider/bucket/CORS/threat/proxy evidence and deployment monitoring remain outstanding, so the flag stays false.
- **Domain/HTTPS and social-provider cutover gate prepared:** `tools/domain-readiness.mjs` performs a read-only external check of the exact canonical origin, public-only DNS, trusted TLS lifetime, permanent HTTP redirect, homepage content type, CSP/HSTS/browser policies, Tideway health, API cache prevention and truthful authentication discovery. It defaults to proving Google/Facebook are closed; after approved staging an explicit `TIDEWAY_EXPECT_SOCIAL_PROVIDERS` list requires the matching capability and validates the provider-specific start redirect, canonical callback, secure host-only flow cookie and no-store response without following the redirect or exposing flow material. Apple cannot be selected because its flow is not implemented. Deterministic tests cover closed and enabled Google/Facebook states plus private DNS, short certificate, redirect, header, health and provider failures. The founder still must purchase/provide the hostname and approved hosting; no DNS or public deployment was changed.
- **E7 concrete shared limiter complete in detached source:** ten exact authentication/directory/review scopes now use an atomic PostgreSQL fixed-window function. The Node adapter purpose-HMACs the trusted client key separately per scope, so raw IP/key material never reaches storage and buckets cannot be correlated across scopes. Web/worker roles have no direct counter access; the worker alone can purge two-hour-inactive buckets in bounded `SKIP LOCKED` batches. Bounded denials return `Retry-After`; malformed decisions/outages fail closed with private monitoring. Real PostgreSQL execution, scheduled purge and two-instance evidence remain outstanding.

---

## 0. How to use this document

- Work the queue **top to bottom**. Sections are ordered by dependency: P0 (fix now) → P1 (make it a real app that takes payments) → P2 (make it truly automated).
- Every task has: **Owner** (agent or founder), **Files/anchors**, **Steps**, **Acceptance criteria**, **Validate**.
- Prefer **searchable anchors** (function/string names) over line numbers — line numbers drift; the anchors are exact.
- Do **not** start a task marked **Owner: Founder**. Instead, if it blocks you, leave the code ready behind a capability flag (the repo already uses this "build detached until infra exists" pattern) and note in your commit what founder input is required.
- After any change, run the validation in §7. Do not mark a task done if `npm test` or `npm run check` fails.

---

## 1. Where things stand (read once)

This repo contains **two runtimes**:

1. **The live pilot** — `server.mjs` (~5,094 lines) + `public/`. Its active NDJSON path remains dependency-free while the marketplace flag is false. This is what runs today. It boots clean and `GET /api/health` returns healthy. It does **not** take payments and has **no** production login. Post-scan steps (quote/match/book) are **manual** via `/admin`.
2. **The detached marketplace** — `src/marketplace/*` + `db/migrations/001–027` (PostgreSQL, RLS, auth, bookings, matching, tracking, reviews, private media, shared limiting, payments and maintenance). Exact database/mail/S3/image dependencies plus the limiter, SMTP delivery, object storage and client resolver are integrated behind the default-off attachment. **It still cannot be enabled safely:** PostgreSQL, SMTP and a real private bucket have not passed staging; CORS/lifecycle/public-access/threat controls and final proxy topology are unverified; approved monitoring remains absent (F2, F8).

The intended product is an Uber-style cleaning marketplace: *request → room scan → checklist → match one cleaner → both accept → confirm → track → complete.*

**The app is ~40% of the business.** The rest is cleaner supply, trust/insurance, and moving money — those are founder tasks and set the real timeline (see §8).

---

## 2. Non-negotiable safety rules (already in this project — keep enforcing)

- **No spending, no Polsia credits, no publishing, no outreach, no contracts, no hiring/rejection, no charging, no payments** without explicit founder approval.
- **Never publish or invent trust claims** (ratings, "DBS-checked", "insured", "10,000+ cleans", coverage areas). Keep all public copy honest and pilot-stage.
- **Never contact real applicants/customers** or send any message automatically.
- **Never commit secrets.** `.env` stays local; only `.env.example` (placeholders) is tracked.
- **Never put real customer PII into cloud-synced plaintext** (see P0-5).
- Build risky/paid integrations **behind capability flags** that stay off until the founder supplies verified infra.

---

## 3. Split of work: founder-only vs agent

**Owner: Founder (agent must NOT attempt — flag and wait):**
- **F1 — Take down / neutralise the live public site** `https://tideway-7.polsia.app/` (still advertising fabricated claims + a working booking form). This is the #1 real-world risk. Agent cannot access that deployment.
- Choose legal structure; obtain public liability insurance; open + verify the payment provider account (Stripe underwriting); recruit and vet real cleaners (DBS + references); sign off pricing, pilot postcodes, and the items in `../FOUNDER_DECISIONS.md`.
- Provide production infra: managed Postgres URL, SMTP/SMS credentials, object storage keys, map provider token, HTTPS origin. (Agent wires the code; founder supplies the accounts.)

**Owner: Agent (do these):** everything in §5 marked Owner: Agent — code fixes, tests, integrations behind flags, docs.

---

## 4. The one decision that sequences everything (RUNTIME FORK)

Before P1, the founder must record ONE choice in `../TIDEWAY_LAUNCH_CONTROL.md`:

- **Path A — Keep the NDJSON pilot as the product for now.** Park `src/marketplace/*` + migrations explicitly. Add payments/notifications onto `server.mjs`. Fastest to a first paid booking; won't scale to true automation.
- **Path B — Commit to the Postgres marketplace.** Add a driver, wire `runtime.mjs` into a server entrypoint, and stand up real DB tests. Slower, but this is the only path to a genuine automated "Uber" app.

Until this is chosen, the agent should do all of **P0** (both paths need it) and prepare P1 scaffolding behind flags.

---

## 5. Work queue

### P0 — Fix now (Owner: Agent unless noted; small, no infra required)

**P0-1 — Stop handing out the private tracker token on an email-only match (F6, High).**
- Files/anchors: `server.mjs`, the `/api/job-briefs` handler. Search the match line `requestTokenValid ? record.customerStatusToken === suppliedRequestToken : record.email === email` and the response field `customerStatusToken:` in that handler.
- Steps: require a valid `x-request-token` to submit a job brief; remove the `record.email === email` fallback path, OR keep an email path but **do not return `customerStatusToken`** in the response (the customer already has it from their tracker link).
- Acceptance: a job-brief POST with a valid `requestId` + `email` but no/invalid token no longer returns a `customerStatusToken` and cannot mutate the request.
- Validate: add an HTTP test asserting this; `npm test`.

**P0-2 — Harden CSRF: reject missing/blank Origin on mutations (F9, Medium).**
- Files/anchors: `server.mjs`, function `ensureSameOrigin` (currently `if (!origin) return;`).
- Steps: on state-changing routes (POST/PUT/PATCH/DELETE), treat a missing or blank `Origin` as a failure rather than a pass. Keep same-origin allow logic unchanged.
- Acceptance: a mutation request with no `Origin` header is rejected; same-origin requests still succeed.
- Validate: HTTP test for both cases; `npm test`.

**P0-3 — Fix mojibake in shipped UI text (F16, Medium).**
- Files/anchors: search the byte sequence `â€` across the repo. Known hits: `server.mjs` (2), `public/admin.html` (near the founder-decisions/readiness copy), `public/admin.js`, `public/cleaner-status.js`.
- Steps: replace corrupted em-dash/ellipsis with correct UTF-8 (`—`, `…`). Add a cheap guard to `npm run check` (e.g. a grep that fails if `â€` appears in `public/` or `server.mjs`).
- Acceptance: no `â€`/`Â` sequences remain; the guard passes.
- Validate: run the guard; visually confirm affected pages.

**P0-4 — Close the admin-shell gap and make loopback-admin explicit (F7, F12, Medium).**
- Files/anchors: `server.mjs`, `isAdminAuthorised`; the exact `/admin` gate (search `pathname === "/admin"`); `serveFile` route map (search `"/admin": "admin.html"`).
- Steps: (a) gate `/admin.html` the same way as `/admin`; (b) add `ensureSameOrigin` to admin GET endpoints; (c) add an env flag (e.g. `ADMIN_REQUIRE_KEY=true`) that requires `ADMIN_KEY` even on loopback, defaulting to current behaviour so local dev isn't broken.
- Acceptance: `/admin.html` returns 401 without authorisation; with `ADMIN_REQUIRE_KEY=true`, loopback requests without the key are denied.
- Validate: HTTP tests; `npm test`.

**P0-5 — Keep customer data out of cloud-synced plaintext + wire retention (F3, High). (Agent: code/guard. Founder: confirm data location + retention values.)**
- Files/anchors: `server.mjs`, `const dataDir = process.env.DATA_DIR ...`; retention config in `public/admin.html` / config validation.
- Steps: (a) add a startup warning (not a crash) if `dataDir` resolves inside a known cloud-sync path (e.g. contains `OneDrive`, `Dropbox`, `Google Drive`) and `DATA_DIR` was not explicitly set; (b) document the recommended non-synced `DATA_DIR` in `README.md` and `RECOVERY.md`; (c) ensure inactive-enquiry and completed-booking retention are required before real intake (surface them in launch readiness).
- Acceptance: starting with data in a synced folder prints a clear warning; docs state the correct location; retention fields are part of the readiness gate.
- Validate: boot with a synthetic synced path and confirm the warning; `npm run check`.

**P0-6 — Make backups trustworthy (F4, F13, Medium). (Agent: script. Founder: run it, store off-sync.)**
- Files/anchors: `tools/backup-data.ps1`; note `../Tideway-independent-source-2026-07-15.zip` is currently **corrupt/truncated**.
- Steps: add post-archive integrity verification (`Expand-Archive -WhatIf` / checksum) that fails loudly; write archives **outside** the OneDrive tree by default; add encryption (or clearly stop calling them "device-protected" in `RECOVERY.md`); regenerate a verified source archive.
- Acceptance: the script refuses to report success on a corrupt archive; the newest archive passes an integrity check; docs match reality.
- Validate: run the script; verify the emitted archive with `unzip -t` / `Expand-Archive`.

**P0-7 — Reconcile the launch docs (F14, Medium). (Owner: Agent, docs only.)**
- Files/anchors: `../TIDEWAY_LAUNCH_CONTROL.md` (scorecard vs progress log; stale module/test counts; missing £20 referral claim in the inventory).
- Steps: split the scorecard so each blocker names its property (Polsia site vs local app); refresh counts to the real totals (`find`); complete the unsupported-claims inventory.
- Acceptance: no line conflates the two sites; counts match the repo; the referral claim is listed.
- Validate: re-read against `find . -name '*.mjs' | wc -l` and `find tests -name '*.mjs' | wc -l`.

**P0-8 — Add end-to-end HTTP tests for the P0 auth fixes.**
- Steps: boot the server on a temp `DATA_DIR` (mirror `tests/smoke.mjs`) and assert P0-1 and P0-2 behaviours plus the P0-4 admin gate.
- Acceptance: tests fail before the fix, pass after; wired into `npm test`.

### P1 — Make it a real app that takes payments (bigger epics; needs the §4 decision + founder infra)

**E1 — Stand up the database + wire the runtime (F2, F8). Path B, or a slimmer version for Path A.**
- Steps: add and version-lock a maintained Postgres driver; construct a pool from `DATABASE_URL`; compose `createMarketplaceRuntime(pool)` into a real server entrypoint behind capability gates; apply `db/migrations/001–020` + `runtime-role-grants.sql` / `worker-role-grants.sql` to a provisioned database.
- Acceptance: with infra present, `runtime` reports ready and authenticated routes respond; with infra absent, everything stays safely disabled (no partial login).
- Validate: real integration run (E2); `npm test`.
- Prepared source: the main server attachment, exact locked `pg` driver graph, pool loader/probe, deployment-adapter contract, truthful capability discovery, isolated dispatch and resource shutdown are complete behind `MARKETPLACE_ENABLED=false`. Still required: real adapter implementation and the E2 database run.

**E2 — Real database integration tests (replaces string-match "DB tests") (F8).**
- Steps: provision approved PostgreSQL staging or ephemeral PostgreSQL 16 in CI; run the locked migrations and role grants; run `tools/postgres-verification-runner.mjs`; then exercise RLS (owner isolation), workflow-function authorization, concurrency, and the double-booking exclusion constraint against the live DB.
- Acceptance: RLS/concurrency/exclusion behaviours are asserted against real Postgres and pass.
- Prepared command: inject separate `DATABASE_INTEGRATION_OWNER_URL` and `DATABASE_INTEGRATION_APP_URL` secrets for a database ending `_tideway_test`, set the exact documented confirmation phrase, then run `node tools/postgres-integration-runner.mjs`. Do not use a production or customer-data database.

**E3 — Fix OAuth unverified-merge before enabling any OAuth route (F5, High).**
- Files/anchors: `db/migrations/004` (`resolve_social_identity`, the email-only link path); account creation in `005` (`email_verified_at` starts NULL).
- Steps: refuse to auto-link a provider into an account whose email was never verified; require step-up or credential reset on merge.
- Acceptance: the pre-registration takeover path is closed; a test proves an attacker-created unverified account cannot be linked/hijacked.
- Prepared source: takeover-safe Google resolution, the Facebook pending-mailbox-verification boundary and authenticated password-account provider connection pass adversarial source tests. Activation still requires the E2 PostgreSQL run, final HTTPS domain, approved SMTP, real provider credentials and Meta operational review/deletion evidence. Social-only provider step-up and lockout-safe removal remain open; all public controls remain hidden.

**E4 — Payments (ledger prepared; provider integration is not live). Owner: Agent builds; Founder supplies verified account + approves go-live.**
- Steps: integrate a marketplace payments provider (e.g. Stripe Connect): authorise/hold customer payment at booking, take the platform fee, pay out the cleaner, handle refunds and re-clean adjustments; verify events via signed webhooks; reconcile against the existing booking payment-evidence fields. Keep everything behind a `PAYMENTS_ENABLED` flag; test mode only until the founder approves.
- Acceptance: in test mode, a full charge → payout → refund cycle works and reconciles with booking records; no live charge occurs without the flag + approval.
- Validate: provider test-mode suite; webhook signature tests.
- Prepared source: the provider-neutral workflow and migrations 022-025 freeze authorization to the accepted booking total, hash retry keys, resume the one booking authorization after a browser restart, reserve role-bound capture/cancel/refund/transfer commands and keep payout destinations server-owned. Exact Stripe Node 22.1.1 supplies a test-key-only manual-capture/refund/source-backed-transfer adapter pinned to API `2026-03-25.dahlia`; the raw signed-webhook route preserves exact bytes, rejects live/wrong-version events and ignores unrelated signed events. The mobile `/booking-payment` page authenticates the Landlord, reads only their safe booking status, and dynamically loads Stripe Payment Element only after a deliberate authorization request returns the in-memory client secret and a test publishable capability. It uses a route-specific CSP and never stores or logs card/client-secret material. A participant-safe journey preflight runs before optional ETA disclosure, while an authoritative booking trigger blocks en route, direct arrival and cleaning start when the payment is missing, stale or mismatched to the frozen amount/terms. The disposable PostgreSQL harness is prepared to prove missing/stale/current cases against a real database. Composition stays default-off behind both `MARKETPLACE_ENABLED` and `PAYMENTS_ENABLED`. Connect onboarding, approved platform/connected accounts and a real HTTPS test-mode cycle are still required; no provider was contacted.

**E5 — Notifications: email + SMS (F19).**
- Files/anchors: existing design in `src/marketplace/notification-*` and `email-notification-*`.
- Steps: verify the implemented internal SMTP transport against the approved provider; decide whether SMS is necessary for the first pilot; **schedule** the workers with the restricted worker role (currently invoked only by tests); make status transitions notify both sides.
- Acceptance: booking/quote/arrival events send real (test-mode) notifications via a scheduled worker.

**E6 — Production config: HTTPS origin, secrets manager, private object storage for room media.**
- Steps: provision the configured private bucket for the implemented adapter; prove public-access denial, signed-header CORS, encryption, lifecycle cleanup, decode/EXIF behavior and the documented malware/threat decision; load secrets from a manager, not files; set `APP_ORIGIN` to the verified HTTPS origin; keep dispatch blocked until a non-local HTTPS origin is configured.
- Acceptance: media served from private storage via token-authorised URLs; no secret read from disk in production.

**E7 — Session purge + public rate limiting (F18). Source complete; staging evidence pending.**
- Steps: deploy the prepared expired-session purge worker and persistent shared limiter; verify both against PostgreSQL and two application instances.
- Acceptance: the sessions table stays bounded under real scheduled execution; public GET throttling is shared across instances.

### P2 — Make it truly automated "Uber" (after P1 is real and proven)

- **Automated real-time dispatch/matching** tuned for liquidity (auto-invite the best cleaner, timeouts, requeue) — build on `matching-*` + invitation-expiry worker.
- **Live in-app GPS tracking in production** — real map provider, arrival notifications; document that mobile-web background tracking isn't guaranteed.
- **Two-way ratings surfaced end to end** — source complete in the participant booking flow; activation requires real database/RLS, moderation operations and two-account HTTPS evidence.
- **Dispute/refund/trust-&-safety flows**, fraud checks, re-clean handling at scale.
- **Observability** — structured logging, error monitoring, health/readiness probes, alerting, on-call.
- **Scale/perf** — replace the per-write full-integrity scan + global write lock with incremental checks (F11); shared/persistent rate limiter with a correct trusted-proxy hop (F10); plan NDJSON→DB migration if staying on files longer.
- **Maintainability** — split the 5,094-line `server.mjs` by route domain; extract the duplicated TTL/draft helpers; unify `?v=` import specifiers (F21).
- **Mobile** — harden PWA or ship native apps.

---

## 6. Definition of done per tier

- **Tier 0 (first real, manual booking):** honest public presence; legal entity + insurance + payment account exist (founder); the current app runs the ops manually; P0 complete.
- **Tier 1 (real app takes payments online):** §4 decision made; E1–E7 done; test-mode payments reconcile; real DB tests pass; P0 auth fixes shipped.
- **Tier 2 (automated "Uber"):** automated dispatch + live tracking + ratings + disputes + monitoring in production, handling real money reliably.

---

## 7. How to validate any change (run every time)

```
node --version            # must be >= 20 (engines)
npm run check             # syntax check across the tree
npm test                  # full suite incl. smoke; must be green
node server.mjs           # then GET /api/health should return {"ok":true,...healthy}
```

- Do not mark a task complete if `npm test` or `npm run check` fails.
- For auth/payment/DB changes, add a test that **fails before** and **passes after** the change.
- Keep commits small and message them by outcome (matches this repo's history style).

---

## 8. Timeline (founder-facing summary)

Assumes solo founder + AI codegen; a single experienced developer roughly halves the build tiers. Payments, insurance, and legal have irreducible lead times regardless of code speed.

- **First real (manual) booking — ~3–6 weeks.** Dominated by cleaner recruitment/vetting + insurance, not code. P0 is a few days of agent work.
- **Real app taking payments online — ~2–4 months.** E1–E7, with payments (E4) and accounts/DB (E1–E3) as the long poles.
- **Genuine automated "Uber for cleaning" — ~6–12+ months.** Gated by cleaner supply and trust more than by code.

**Guidance:** don't build P2 before Tier 0 proves customers will pay and cleaners will show up. Get ~5 cleaners and ~5 paying customers through the manual flow first; let that decide what to automate.

---

## 9. Task template (use for any new work you add here)

```
### <ID> — <short objective> (<finding ref if any>, <severity>)
- Owner: Agent | Founder
- Files/anchors: <paths + searchable function/string names>
- Why: <user/business impact in one line>
- Steps: <ordered, concrete>
- Acceptance: <observable pass condition>
- Validate: <exact commands / tests>
```
