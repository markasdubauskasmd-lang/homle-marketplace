# Progress

**Resume here after a context reset.** Read `CLAUDE.md` first (rules + hard
limits + the real stack), then this file, then `DECISIONS.md` and
`HUMAN_TODO.md`.

**Branch:** `claude/great-mendel-7ozvur` · **Base:** `main` at `f38cb82` (#557)
**Last updated:** 20 September 2026 · 43 commits ahead of `main`

---

## Phase 0 — Audit · DONE

| Check | Result |
|---|---|
| `pnpm install --frozen-lockfile` | Passes; 57 packages, lock verified by SHA-256 |
| `pnpm run check` (lint/typecheck equivalent, see D3) | **Green**, 608 files |
| `pnpm test` main chain | **Green**, 180 suites |
| `pnpm test` post-hooks | **Green**, 40 suites, except the two browser timeouts below |
| CI on base commit | Green (Actions run 1489) |
| Migrations | 114 at audit; now 123, all locked in `db/migration-lock.json` |
| Live site | **Unverifiable from this container** — network policy refuses `CONNECT homlle.com:443` with 403 |

Two heavy Chromium suites fail locally and pass in GitHub CI — see the
environment-quirks note in `CLAUDE.md`. `tests/customer-tracking-style.mjs`
fails reproducibly; `tests/shared-customer-motion.mjs` fails about one run in
two. Neither is a defect, and neither should be "fixed" by loosening an
assertion.

---

## The queue

Ordered by the brief's rule: **anything that blocks a paid booking comes first.**

### P0a — blocks ANY booking: there can be no supply

Found by the Phase 2 audit. These are the real reason the live directory returns
zero cleaners, and they outrank everything else: with no publishable cleaner and
no bookable availability, no customer can ever be matched, so no money can ever
move. `HUMAN_TODO.md` §3 has been corrected to stop recruitment until these ship.

| ID | Task | Status |
|---|---|---|
| C1 | ✅ **DONE** `6ffd24a2` — **A cleaner can never publish a profile.** `cleaner-profile.mjs:111` refuses `isPublic` below 100% completion, but four of the nine fields `profileCompletionPercent` requires (`:77-90`) — biography ≥40 chars, price, languages, residential/commercial preference — are written by **no page in `public/`**; every writer passes the existing value through. Ceiling ≈56%. The publish switch is inert: `cleaner-public-profile.html:253` is `aria-readonly="true"` and `cleaner-public-profile.js:187-191` only reads it. `isPublic: true` appeared nowhere in the codebase. | ✅ |
| C2 | ✅ **DONE** `d8ea572b` — **A cleaner cannot create a matchable availability window.** `POST /api/marketplace/cleaner/availability` exists and validates correctly (`marketplace-http.mjs:646-664`), but all 14 front-end references are reads. The page built for it is unreachable — `server.mjs:5694` 308-redirects `/cleaner/availability` → `/cleaner/jobs-map`, so `public/cleaner-availability.js` is dead code. The schedule screen saved a weekly blob into the encrypted onboarding section that the matcher never reads. | ✅ |
| C3 | ✅ **DONE** `d8ea572b` — **"Holiday mode" was a false trust claim.** `cleaner-dashboard.html:281-292` promises "Homle will not offer new jobs on this date". `holidayMode`/`unavailableDate` appear nowhere in `src/`, `db/migrations/` or `server.mjs` — it is enforced nowhere and offers keep arriving. Breached CLAUDE.md hard limit 3. Now described as the note it is, pointing at available hours, which do stop offers. Enforcing it against matching is follow-up. | ✅ |

### P0b — blocks a paid booking

| ID | Task | Status |
|---|---|---|
| M1 | **No route to cancel a confirmed booking.** `domain.mjs:56` permits `confirmed:cancelled` for a landlord but no HTTP route exists. A customer cannot cancel or release their card hold. Also strands the refund path, which requires a cancelled/completed/disputed booking. | ✅ **DONE** `ca3fbac9`, reviewed and repaired in `9a739c34` |
| M2 | ✅ **DONE** `b055895f`, composed in the web process — **capture and payout were manual admin clicks.** The background worker's `tideway_worker` credential has no grants on the payment commands, so settlement runs where the application credential already lives rather than widening a deliberately narrow role. `payment-service.mjs:286` requires the administrator role; the only route is admin-gated. A human must click Transfer for every job, and the Stripe hold expires in ~7 days. The brief requires no manual steps. | TODO |
| M3 | ✅ **DONE** `e2741e51` — **Migration 025 requires an authorized payment before a job can start, unconditionally**, while `PAYMENTS_ENABLED` defaults false. A deployment with payments off is a marketplace where no cleaner can ever start work. | TODO |
| M4 | **Five-day authorization window** (`022:113`) means no pay-at-booking. A booking three weeks out cannot be paid for when it is made. | TODO |
| M5 | **No-shows entirely unimplemented** — no code, schema or tests. Only prose in a preview FAQ. | TODO |
| M6 | ✅ **DONE** `98b6a1f8` — **No payment-outcome emails**: no receipt, capture, refund, failed-payment or cancellation mail. Receipts are pull-only (customer must click). | TODO |
| M7 | ✅ **DONE** `f55d8768` — **No settlement reconciliation.** Platform fee is an arithmetic residual with no `application_fee_amount`; nothing proves captured − transferred − refunded = expected contribution. | TODO |
| M8 | ✅ **DONE** `pending` — migration 125 ends a booking nobody paid for twelve hours before its slot, releasing any live hold first, cancelling the request, and telling both sides so the Cleaner gets their day back. Re-audited: the dunning half already existed (migrations 041, 043, 117, 123 — two staged reminders and a failed-payment email). The missing piece was the ending. See D13. **Was: failed payments have no dunning**, no retry schedule, no auto-cancel, no notification. | ✅ |

### P1 — legal and trust exposure

| ID | Task | Status |
|---|---|---|
| L1 | 🟡 **MOSTLY DONE** `dc1389d5`, `df6275fd`, export added — queue with statutory deadlines, audited progression, and a downloadable subject access response assembled from the requester's own authenticated reads. **Erasure remains manual** pending the founder/solicitor decisions in `docs/DATA_RETENTION_AND_ERASURE.md`; a hard delete is impossible anyway (27 of 40 foreign keys refuse it). **GDPR export/deletion was intake-only.** `privacy-request-service.mjs` has only `list` and `request`; migration 035 inserts a row and never touches user data. No admin fulfilment queue, no export artefact, no SLA. Hard UK GDPR blocker (Art. 15/17, one-month deadline). | TODO |
| L2 | ✅ **DONE** `75c50e9a` — **No Cookie Policy**, and the privacy notice does not disclose the session/auth cookies actually set. | TODO |
| L3 | Terms, Privacy and the 9 Cleaner Agreement PDFs are self-declared drafts with operator identity unfilled. Signing is hard-blocked in code. Needs a solicitor — `HUMAN_TODO.md` §5. | FOUNDER |

### P2 — growth (the stated main channel is unserved)

| ID | Task | Status |
|---|---|---|
| G1 | ✅ **DONE** `455ede5e` — **Landing page did not address landlords or letting agents at all.** Zero portfolio/multi-property/agency copy, no section, no CTA. The only trace is a subtitle inside a collapsed dropdown. This is the stated main growth channel. | TODO |
| G2 | Cleaner audience gets two links and no pitch — no earnings, flexibility or how-it-works copy. | TODO |
| G3 | 🟡 **PARTLY DONE** `455ede5e` — two indexable pages now, both with canonical and OG tags, sitemap updated. The remaining 48 are private or deliberately `noindex`, so the real gap is the absence of service and area landing pages rather than missing tags. **SEO: was one indexable page.** 49 of 50 pages have no canonical or OG tag; sitemap has a single URL, test-locked; Terms and Privacy are `noindex`. No service or area landing pages. | TODO |
| G4 | ✅ **DONE** `75ac9006` — migration 124 `public_funnel_hourly`, an anonymous origin-checked rate-limited beacon, instrumentation on the landing pages, signup, property, scan, price, slot and payment authorization, and a visitor lane beside the account-derived lanes on `/admin/funnel`. The vocabulary is stated in the browser, the server and the database, and a test asserts the three agree. D12 records why it stops at the authorized payment. **Was: no analytics of any kind** and no funnel conversion events. | ✅ |
| G5 | Cookie consent banner — **not needed** given D11: a cookieless first-party endpoint sets nothing requiring consent. It becomes required only if analytics ever gains a visitor identifier, and the cookie policy must change before it does. | N/A under D11 |

### P3 — quality, now unblocked

| ID | Task | Status |
|---|---|---|
| Q1 | Retire the Cleaner Dashboard freeze gate | **DONE** — `b6947338` |
| Q2 | Ignore test screenshot output | **DONE** — `04db97fa` |
| Q3 | Remove invented example jobs from the empty Cleaner calendar | **DONE** — `a5822711` |
| Q4 | P1-6: converge Landlord and Cleaner dashboards onto one design system | TODO — large |
| Q5 | ✅ **DONE** `2d79d573` — Property / Place / Booking vocabulary settled; "place" is gone from visible copy |
| Q6 | Close the 40 dead PRs (all verified to contain nothing not in `main`) | FOUNDER — outward-facing |
| Q7 | `.scan-hero` CSS — not dead, see D6; retire with `.hub-cta` together | DEFERRED |
| Q8 | Publication guard: 6 false positives + 122 MB tracked vs 100 MiB limit | TODO |
| Q10 | **Review of M8 found a shipped defect in M1.** `cancel_booking_as_landlord` (migration 115) inserted a `text` value into the `booking_status` enum column `booking_status_history.from_status`, so every Landlord cancellation released the customer's card hold and then threw, leaving the booking `confirmed` and the Cleaner's slot blocked. `expire_unpaid_booking` copied the pattern. Repaired in migration 126 and now executed against a real PostgreSQL by `db/integration/booking-cancellation-verification.sql`, which fails against the pre-126 schema. See D14. | ✅ |
| Q9 | **The Cleaner's schedule can never show "Booked".** `public/cleaner-schedule.js:424` branches on an availability window's status being `held`, and **nothing in the codebase ever writes that status** — `grep "'held'"` across `db/migrations/` finds only the CHECK constraint in migration 001. A Cleaner's time is actually blocked by the booking's own status (migration 028 refuses an overlapping invitation while a booking is `pending-cleaner-acceptance` through `awaiting-review`), which the schedule screen never reads. So a booked window still renders as free. Found while verifying that cancelling an unpaid booking releases the Cleaner — it does, but not by the route that page believes. | TODO |

### P1b — hardening gaps (Phase 4 audit)

RLS is the strongest area in the codebase and needs no work: 60 of 71 tables
carry RLS, and the other 11 are `tideway_private` tables with **zero table
grants**, reachable only through `SECURITY DEFINER` functions — a stronger
control, proven against live Postgres 16 as a non-owner role in CI. Effective
coverage is 71/71. The real gaps are narrower:

| ID | Task | Status |
|---|---|---|
| H1 | ✅ **DONE** `971373f2` — **Booking and request creation had no rate limit.** `marketplace-http.mjs:475` and `:696` call `security.protect` with no scope. Every auth and AI endpoint is limited; the two money-path writes are not. | TODO |
| H2 | ✅ **DONE** `534fa8b3` — **No cumulative Anthropic spend cap.** Per-call token ceilings, a 30 s timeout, `maxRetries: 1` and a cheap-model-by-default escalation guard all exist, but nothing stops sustained legitimate-looking traffic running a large bill. The brief asks for a spend cap specifically. | TODO |
| H3 | ✅ **DONE** `5d9b2478` — **No 500 HTML page.** `server.mjs:5967` returns JSON only and never consults `wantsHtmlDocument`, so a browser hitting a server fault gets the unstyled-JSON experience the 404 work existed to remove. | TODO |
| H4 | ✅ **DONE** `7a50dd4c` — **No structured request log** — no request id, latency, or method/path/status line. Error events exist with no request trail to correlate against. | TODO |
| H5 | `FORCE ROW LEVEL SECURITY` is absent on all 60 tables. Low risk (the app connects as a non-owner) but cheap to close. | TODO |
| H6 | ✅ **ALREADY CLOSED** — re-audited and the finding was wrong. `tests/verification-coverage.mjs` already asserts that every one of the 256 test files is executed by `pnpm run check` or `pnpm test`, expanding the script graph including `pre`/`post` hooks and then walking the import graph outward from the directly executed suites. `payment-disputes.mjs` and `dispute-parent-identity.mjs` both run. The 43 files not named in a script are reached by import from a suite that is; the original audit counted names in `package.json` and missed that. | ✅ |

### P1c — admin gaps (Phase 3 audit)

| ID | Task | Status |
|---|---|---|
| A-1 | **No user administration at all** — no `/admin/users` route, no API. No way to list, search, suspend or delete an account. | TODO |
| A-2 | **Cleaner approval is made blind.** The vetting queue shows a name and two status strings; the submitted application is AES-encrypted per-cleaner with no administrator read path. An admin approves without seeing the evidence. | TODO |
| A-3 | ✅ **DONE** `pending` — a case resolution can now issue a refund against the booking's own payment, through the same guarded `refund` command the payments desk uses. The payment is resolved server-side from the case's own booking, never from a client-supplied id; the amount needs its own explicit authorisation; the key is stable per case and amount so a retry cannot refund twice; and the decision is recorded before the money moves, so a failed refund leaves a retryable case rather than money returned with no decision behind it. The handling standard moved to `tideway-case-response-v2` because v1's promise that the screen performs no payment action stopped being true — a v1 client is refused, not reinterpreted. **Was: dispute resolution moves no money.** | ✅ |
| A-4 | **No revenue metrics.** The funnel report deliberately excludes money; per-booking economics exist but are never summed. | TODO |
| A-5 | No manual job assignment in the marketplace — inviting a cleaner is landlord-only. | TODO |

---

## Done this session

- `268d63ac` Verified remaining-work queue replacing the stale August audit
- `04db97fa` Ignore `artifacts/` and `test-artifacts/`
- `b6947338` Retire the Cleaner Dashboard freeze; add `CLAUDE.md`, `DECISIONS.md`, `HUMAN_TODO.md`
- `a5822711` Remove invented example jobs from the empty Cleaner calendar
- `d824ab39` Report whether settlement is actually running, not just enabled
- `75ac9006` **G4 analytics** — the funnel, counted without following anybody
  along it (see D11 and D12)

## Next step

**Q4 — Landlord/Cleaner design convergence.** The largest remaining item and
the last one that is neither blocked on a founder decision nor already done.

Blocked on a decision only the founder can make, and therefore not next:

* **M5 no-shows** — what a no-show *is* (how long after the slot, who reports
  it, what it costs whom) is a decision about somebody's money. `HUMAN_TODO.md`
  §6 asks the questions; the mechanism waits on the answers.
* **L1 erasure automation** — `HUMAN_TODO.md` §5 and
  `docs/DATA_RETENTION_AND_ERASURE.md`. A hard delete is impossible anyway (27
  of 40 foreign keys refuse it), so this is anonymise-in-place against a
  retention policy that has to be approved first.
* **L3 legal documents** — needs a solicitor.
* **Q6 closing 40 dead pull requests** — outward-facing, so it waits for the
  founder's word (`HUMAN_TODO.md` §8).

## Note on reviews

M1 was implemented, tested green, committed — and was then found by review to
have never released a card hold at all, because it read a field the payment
projection does not carry. The tests passed because they asserted a substring
against code that never ran. Two lessons now encoded in the suite: assert call
**order** where ordering is a correctness property, and assert against the
**shape the projection actually returns**, not against source text.
