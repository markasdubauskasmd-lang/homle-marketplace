# Progress

**Resume here after a context reset.** Read `CLAUDE.md` first (rules + hard
limits + the real stack), then this file, then `DECISIONS.md` and
`HUMAN_TODO.md`. `LAUNCH_CHECKLIST.md` is the founder's ordered go-live list.

**Branch of record:** `main`. **Last updated:** 25 October 2026.

---

## 25 October 2026 — 7-day "open to customers" programme (branch `local/public-api`, after the integration PR)

Where each day stands. Every item has a test that fails before and passes after;
`pnpm run check` and the full `pnpm test` were run on the heads named.

| Day | Item | Status | Where |
|---|---|---|---|
| 1 | Visitor API: `/api/public/pricing`, `/quote`, `/coverage`, `/launch-interest` (migration 137, real-DB integration file) | ✅ | D28 |
| 1 | `--hs-*` tokens, icon sprite, `homle-ui.css` components, shared header/footer on document pages | ✅ | `tests/site-chrome.mjs` |
| 2 | Landing: postcode → clean → rooms → estimate (`#quote`), honest not-yet with consented launch news, landlords card, FAQ, JSON-LD | ✅ | D29, `tests/browser-home-quick-quote.mjs` |
| 3 | Guest's choice carried through sign-in (incl. the email tab); checkout explains the hold; "Book cleaning" role wording | ✅ | `tests/guest-quote-handoff.mjs` |
| 4 | Landlord "Getting started"; Cleaner "profile not published" alert; admin on tokens | ✅ | D33, `tests/landlord-getting-started.mjs`, `tests/cleaner-ready-alerts.mjs` |
| 5 | robots AI policy, `llms.txt`, `/openapi.json`, `/mcp` (off by default) | ✅ | D30, D31, D32 |
| 6 | Trust page `/how-homle-works`; 404/500 already branded; 265 KB of dead landing CSS removed | ✅ | — |
| 6 | Service pages `/services/{regular-clean,deep-clean,end-of-tenancy,rental-turnover}` with live from-prices | ✅ | `tests/browser-home-quick-quote.mjs` |
| 6 | Area pages | ⏸ only for real coverage, and there is none in the database yet; build them from `public_cleaner_coverage` once the first Cleaner is live | HUMAN_TODO §0.3 |
| 6 | Keyboard pass on the price form; accessible-name scan of 12 public and Landlord pages | ✅ one tab stop per radio group, visible focus, Enter submits; four unnamed Landlord fields named | — |
| 6 | CSS under 400 KB | ◐ 1.48 MB → 1.17 MB. The rest is `styles.css` (343 KB) and the Cleaner/Landlord sheets; needs a selector-by-selector audit against the computed-style baselines, not a guess. Chromium CSS coverage of the 56 pages that load `styles.css` (first render, 390/1280, API answered 404) touches only 12.6% of it; that is a ceiling on proven use, not a dead list, because most states come from API data. Next: run the same coverage inside the browser suites that do supply data, then remove only what no state uses | next |
| 6 | Funnel: a price shown on the landing page | ✅ `funnel.price.shown` / `landing`, already in migration 134's vocabulary, so no migration; no postcode, email or price is sent | `tests/browser-home-quick-quote.mjs` |
| 6 | Support email on the site | ⏸ founder: HUMAN_TODO §0.7 | — |
| 7 | Founder rehearsal | ⏸ founder | LAUNCH_CHECKLIST |

Measured locally (Chromium, intercepted assets, so optimistic): landing LCP 0.4 s, CLS ≤ 0.015 at 390 and 1280 px.

## 25 October 2026 — launch integration (verified)

What was checked against reality, and where it differed from the brief:

| Claim in the brief | Verified |
|---|---|
| `main` head `6bbb9a99` (#564), 116 migrations | ✅ true at session start |
| great-mendel 54 ahead / 6 behind, no PR | ✅ true |
| #559 CI green on `36a7e05a` | ✅ both jobs green on that exact head, which already contained `main`; squash-merged as `a71fff36` |
| Live `/api/health` values | ❌ **not verifiable from this container**: the network policy refuses `CONNECT homlle.com:443` (403). Render is not reachable either. Phase C stops at "ready to deploy". |
| 31 no-op PRs, 7 conflicting, 3 small deltas | ✅ re-verified with `git merge-tree` against `a71fff36` (after unshallowing the clone; a shallow clone reports every PR as unrelated history) |
| `/cleaner/apply` (old HUMAN_TODO) | ❌ no route serves it. The real entry is `/cleaner/registration`, which continues at `/cleaner/onboarding` (`server.mjs` route table). Corrected in `HUMAN_TODO.md`. |
| C2: `/cleaner/availability` 308s to `/cleaner/jobs-map` | ✅ still true, and harmless: great-mendel fixed C2 on the **Schedule** page, which now creates and withdraws real availability windows. |

Done in the integration PR:

- great-mendel merged onto `main`; its 17 migrations renumbered 115–131 → **118–134**; every file reference and every prose reference in lines it added updated; lock entries appended for the renamed files only (`main`'s 117 entries byte-identical).
- Cleaner Dashboard freeze gate retired (`tests/cleaner-dashboard-freeze.mjs` deleted; D2). #564's behavioural browser regression stays.
- **Review against 117 found four money defects great-mendel could not have seen** (it was written at 114). All fixed with tests that fail before and pass after:
  - **F1** Landlord cancellation discarded the hold-release result, so a refused, unknown or unsent cancel still cancelled the booking and stranded the hold. Extracted to `src/marketplace/booking-hold-release.mjs`; only an accepted cancel releases. `tests/booking-hold-release.mjs`.
  - **F2** Unpaid-booking expiry only refused `recoveryRequired`; a refused or unsent cancel still ended the booking. Same rule now. `tests/unpaid-booking-expiry.mjs` (fakes now return the real result shape).
  - **F3** After 117 **no refund notified the customer** — 117's history rows carry `eventId` but not `eventKind`, and 126's trigger needs the kind. Migration **135** resolves it from the signed event. `db/integration/refund-notice-verification.sql`.
  - **F4** Settlement reconciliation (124) ignored a partially refunded payment whose Cleaner was never paid (117 blocks that transfer). Fixed in 124 directly — 118–134 have never been deployed — and executed by the same integration file.
- GM's account-status integration test assumed no other Administrator existed; the runner commits one, so the guard was never reached. Fixture fixed (parks other Administrators inside the rolled-back transaction).
- `tests/customer-journey-recovery.mjs` hard-coded 8–9 October 2026 as "future" dates and began failing on `main` on 9 October. Now relative to today.
- Upgrade proof: CI's real-upgrade step now continues the live-shaped 116 database through 117–135 and runs `db/integration/launch-work-upgrade-verify.sql` (live rate-limit rows survive the replaced CHECKs, a pre-upgrade booking cancels with history, a pre-117 refund is summed once, the expiry sweep runs).
- `#559` × great-mendel: `admin-payments.js`'s revenue block sat between the two functions #559's recovery test slices out; moved below `load()`.
- Q10 (text into enum) re-reviewed: none remain. M1 order re-reviewed: JS releases first, then cancels; now also refuses on any unconfirmed release.

PR hygiene: 41 PRs closed with a reason each. #439's intent (real-DB proof that the saved quote is the price the invitation carries) is missing on `main` and is queued as a fresh PR.

## Phase 0 — Audit · DONE

| Check | Result |
|---|---|
| `pnpm install --frozen-lockfile` | Passes; 57 packages, lock verified by SHA-256 |
| `pnpm run check` (lint/typecheck equivalent, see D3) | **Green**, 608 files |
| `pnpm test` main chain | **Green**, 180 suites |
| `pnpm test` post-hooks | **Green**, 40 suites, except the two browser timeouts below |
| CI on base commit | Green (Actions run 1489) |
| Migrations | 114 at audit; 135 after integration (25 Oct), all locked in `db/migration-lock.json` |
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
| M8 | ✅ **DONE** `pending` — migration 128 ends a booking nobody paid for twelve hours before its slot, releasing any live hold first, cancelling the request, and telling both sides so the Cleaner gets their day back. Re-audited: the dunning half already existed (migrations 041, 043, 120, 126 — two staged reminders and a failed-payment email). The missing piece was the ending. See D13. **Was: failed payments have no dunning**, no retry schedule, no auto-cancel, no notification. | ✅ |

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
| G2 | ✅ **DONE** `pending` — `/for-cleaners`, indexable, in the sitemap and linked from the homepage. Grounded in what is actually true: cleaners set their own prices, areas, hours and work types; they see the confirmed room-by-room scope and the exact pay before accepting; the required onboarding sections are listed by name. It states plainly that **Homle cannot promise work yet**, that **Homle does not insure them**, and that they are **not employed by Homle** — and a smoke test refuses any hourly-earnings figure, volume or guarantee claim by pattern, because that is the whole failure mode of a recruitment page. **Was: two links and no pitch.** | ✅ |
| G3 | 🟡 **PARTLY DONE** `455ede5e` + `pending` — three indexable pages now, both with canonical and OG tags, sitemap updated. The remaining 48 are private or deliberately `noindex`, so the real gap is the absence of service and area landing pages rather than missing tags. **SEO: was one indexable page.** 49 of 50 pages have no canonical or OG tag; sitemap has a single URL, test-locked; Terms and Privacy are `noindex`. No service or area landing pages. | TODO |
| G4 | ✅ **DONE** `75ac9006` — migration 127 `public_funnel_hourly`, an anonymous origin-checked rate-limited beacon, instrumentation on the landing pages, signup, property, scan, price, slot and payment authorization, and a visitor lane beside the account-derived lanes on `/admin/funnel`. The vocabulary is stated in the browser, the server and the database, and a test asserts the three agree. D12 records why it stops at the authorized payment. **Was: no analytics of any kind** and no funnel conversion events. | ✅ |
| G5 | Cookie consent banner — **not needed** given D11: a cookieless first-party endpoint sets nothing requiring consent. It becomes required only if analytics ever gains a visitor identifier, and the cookie policy must change before it does. | N/A under D11 |

### P3 — quality, now unblocked

| ID | Task | Status |
|---|---|---|
| Q1 | Retire the Cleaner Dashboard freeze gate | **DONE** — `b6947338` |
| Q2 | Ignore test screenshot output | **DONE** — `04db97fa` |
| Q3 | Remove invented example jobs from the empty Cleaner calendar | **DONE** — `a5822711` |
| Q4 | P1-6: converge Landlord and Cleaner dashboards onto one design system | TODO — large |
| Q5 | ✅ **DONE** `2d79d573` — Property / Place / Booking vocabulary settled; "place" is gone from visible copy |
| Q6 | Close the dead PRs | ✅ **DONE** 25 Oct — 41 closed, founder-authorised |
| Q7 | `.scan-hero` CSS — not dead, see D6; retire with `.hub-cta` together | DEFERRED |
| Q8 | Publication guard: 6 false positives + 122 MB tracked vs 100 MiB limit | TODO |
| Q11 | **`tests/customer-tracking-style.mjs` cannot run in this container, and the reason is not the timeout.** It hangs at a 300-second ceiling on an idle box, so the configurable `HOMLE_BROWSER_TIMEOUT_MS` added alongside it does not help. The snapshot returns every CSS property of every element plus both pseudo-elements in a single `Runtime.evaluate`, at two viewports — hundreds of thousands of key/value pairs in one CDP response. Paging that snapshot would fix it without weakening a single assertion. Not attempted, because the rewrite cannot be validated against the GitHub CI baseline the test exists to protect and CI does not run on this branch. **Every other suite in the tree passes.** | TODO |
| Q10 | **Review of M8 found a shipped defect in M1.** `cancel_booking_as_landlord` (migration 118) inserted a `text` value into the `booking_status` enum column `booking_status_history.from_status`, so every Landlord cancellation released the customer's card hold and then threw, leaving the booking `confirmed` and the Cleaner's slot blocked. `expire_unpaid_booking` copied the pattern. Repaired in migration 129 and now executed against a real PostgreSQL by `db/integration/booking-cancellation-verification.sql`, which fails against the pre-126 schema. See D14. | ✅ |
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
| H5 | ❌ **REJECTED with evidence (D25)** — FORCE would subject the 219 owner-run `SECURITY DEFINER` functions to policies; verified the owner then reads 0 rows. Was: `FORCE ROW LEVEL SECURITY` is absent on all 60 tables. | CLOSED |
| H6 | ✅ **ALREADY CLOSED** — re-audited and the finding was wrong. `tests/verification-coverage.mjs` already asserts that every one of the 256 test files is executed by `pnpm run check` or `pnpm test`, expanding the script graph including `pre`/`post` hooks and then walking the import graph outward from the directly executed suites. `payment-disputes.mjs` and `dispute-parent-identity.mjs` both run. The 43 files not named in a script are reached by import from a suite that is; the original audit counted names in `package.json` and missed that. | ✅ |

### P1c — admin gaps (Phase 3 audit)

| ID | Task | Status |
|---|---|---|
| A-1 | 🟡 **SUSPENSION DONE** `pending` — migration 132 plus `/admin/accounts`. `users.account_status` had been enforced in 45 places since migration 001 and settable from nowhere: the lock was fitted and there was no key, so a Cleaner who behaved badly in a customer's home could not be stopped. Now an exact-email/id lookup and a reversible suspend/restore that revokes live sessions, requires a recorded reason, refuses to suspend yourself or the last active Administrator, and audits every change. **Deletion is deliberately not offered** — it is the reviewed erasure path (L1) and is founder-blocked. **Was: no user administration at all.** | 🟡 |
| A-2 | ✅ **DONE** `pending` — migration 131 adds an administrator read of a submitted application, and `/admin/verifications` shows it behind an explicit per-cleaner button. Refused for an application nobody has submitted, audited at the database on every read (a second look is a second row), returns ciphertext the function itself cannot read, and reports a section it cannot decrypt as unreadable rather than omitting it. Document metadata only, and the screen says plainly that file contents were not shown. **Was: cleaner approval is made blind.** | ✅ |
| A-3 | ✅ **DONE** `pending` — a case resolution can now issue a refund against the booking's own payment, through the same guarded `refund` command the payments desk uses. The payment is resolved server-side from the case's own booking, never from a client-supplied id; the amount needs its own explicit authorisation; the key is the case alone, so an identical replay is idempotent and a changed amount is refused by the command ledger; and the refund is sent before the decision is recorded, because resolving with `completed` lets settlement transfer the Cleaner's pay within minutes and a transferred payment can never be refunded again. Review found three real defects in the first version of this — a refund on a review-start with no attestation, a replay that refunded twice under a changed amount, and that closing window — all fixed and covered by tests that fail without the fix. The handling standard moved to `tideway-case-response-v2` because v1's promise that the screen performs no payment action stopped being true — a v1 client is refused, not reinterpreted. **Was: dispute resolution moves no money.** | ✅ |
| A-4 | ✅ **DONE** `pending` — migration 133 sums the ledger and `/admin/payments` shows it. Same definitions migration 124 uses per payment, so there is one answer rather than two; only provider-confirmed transfers count, so money still in flight is never reported as paid; the window applies to when the money was taken. Labelled **contribution, not profit**, with the contribution pricing intended alongside it, and a warning when Cleaners are still owed. The funnel report still carries no money, which is what its own published scope says. **Was: per-booking economics exist but are never summed.** | ✅ |
| A-5 | **Re-scoped — the original finding was wrong.** `invite_cleaner` (migration 028:31,38) has *always* permitted an administrator on any request; only the HTTP route is `roles: ["landlord"]`. But opening that route is **not** the work, and would be unsafe: the landlord-approved price cap is enforced in `complete_automatic_dispatch` (058), not in `invite_cleaner`, so an administrator inviting through it would commit a customer's money at a price the customer never approved. The real task is a guarded `assign_cleaner_as_administrator` that requires `automatic_dispatch_authorized_at` set and not revoked — the landlord's own "Homle may choose a cleaner for me, up to £X" — and re-checks `budget_pence`. Deferred below G2 on the brief's own rule: this only matters once cleaners exist to assign. | TODO — re-scoped |

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
