# Homle release readiness

The verdict on each area, and the evidence behind it. Findings live in
`HOMLE_MASTER_AUDIT.md`; per-route coverage lives in `HOMLE_ROUTE_MATRIX.md`.

**VERIFIED** — exercised against a running system, evidence named.
**PARTIALLY VERIFIED** — some paths exercised, others not, and the gap is stated.
**UNVERIFIED** — not exercised here.
**BLOCKED** — cannot be exercised in this environment, reason named.

Three independent reviewers — QA, code and security — were each asked to
**disprove** that this is complete rather than to approve it. Every row below
reflects what survived that, and the rows they moved are marked.

> **This is not a statement that Homle is production-ready.** Six areas are
> BLOCKED on unconfigured integrations, three are UNVERIFIED, and three audit
> findings remain open — two of them deliberate decisions rather than defects,
> and one a policy question for the product owner. What this is: an honest
> account of what was run, what happened, and what nobody has checked.

| # | Area | Verdict | Evidence / reason |
|---|---|---|---|
| 1 | Route coverage | VERIFIED | 57 routes × 3 viewports, signed out and signed in; `HOMLE_ROUTE_MATRIX.md` |
| 2 | Registration | VERIFIED | 3 accounts registered through the real HTTP API against a real database |
| 3 | Email verification | VERIFIED | TLS SMTP sink; token parsed from the URL fragment; confirm returns `verified:true` |
| 4 | Sign-in | VERIFIED | Real sessions; rotation on each sign-in observed |
| 5 | Sign-in throttling and lockout | VERIFIED | `429 rate-limited`, then a separate `429 temporarily-locked`; both had to be cleared to continue testing |
| 6 | Password reset | PARTIALLY VERIFIED | Session revocation asserted by the suite; the mail round trip was not walked end to end this session |
| 7 | Onboarding / workspace selection | VERIFIED | Landlord and Cleaner onboarded; `administrator` self-assignment refused `422` |
| 8 | Role boundary (Landlord ↔ Cleaner) | VERIFIED | Cross-role browser probe both directions, after the F-2 fix |
| 9 | Property creation | VERIFIED | Created through the API and the journey |
| 10 | Booking journey (manual) | VERIFIED | Walked to `searching-for-cleaner`, including the photo chain |
| 11 | Booking journey (scan) | BLOCKED | No vision model configured |
| 12 | Room photo upload | VERIFIED | intent → presigned PUT → sanitise → completion → signed read, against a real object store |
| 13 | Photo abuse resistance | VERIFIED | 5 cases: non-image, wrong size, wrong checksum, second Landlord, uninvited Cleaner |
| 14 | Pricing consistency | VERIFIED | The server imports the browser's `pricing-engine.js`; one arithmetic, no divergence possible |
| 15 | Payments | BLOCKED | No Stripe test keys configured |
| 16 | Payouts | BLOCKED | Same |
| 17 | Matching | BLOCKED | No geocoding provider; every candidate is unpriceable without a distance |
| 18 | Automatic dispatch | PARTIALLY VERIFIED | Two-worker lease covered by the PostgreSQL integration suite; not exercised in a browser |
| 19 | Messaging | **PARTIALLY VERIFIED** | Non-participant refused `404`. **No booking exists in this database**, so no real conversation was ever exercised — only empty and gated states. A QA reviewer moved this row. The panel also announced itself ready while its thread was still loading (Q-8), found through the 1-in-3 flake it caused and now fixed and tested |
| 20 | Notifications | VERIFIED | Seeded, rendered, grouped; another account's rows refused. **Live delivery was dead in Chrome on all nineteen Cleaner pages** until F-7 — measured `403`, now `[]` |
| 21 | Cross-tenant isolation | VERIFIED | RLS at the database plus actor scoping; cross-tenant reads and writes attempted and refused |
| 22 | CSRF / origin | VERIFIED | Missing token, wrong origin and absent origin all refused `403` |
| 23 | Authenticated write abuse | VERIFIED | 400-write flood: 300 allowed, 100 refused `429`. **Sign-out was blocked at the allowance** until S-4 — re-measured `200` |
| 24 | Secrets | VERIFIED | No real credentials in the tree or its history |
| 25 | Design consistency | VERIFIED | One canvas and one font across the signed-in workspace; landing palette guarded out. **The eleven administrator desks were on four canvases at once** until D-1 — re-measured signed in as a real administrator at 1440px and 390px: one canvas, one font, 11/11 shared navigation, no sideways scroll |
| 26 | Accessibility | **PARTIALLY VERIFIED** | Contrast, focus and naming checked. Three of the four reported touch targets did not survive re-measurement of their *effective* hit area; the one real case was fixed, and `/landlord/book` now carries a visually-hidden `h1` (verified rendering 1×1 and clipped). No assistive-technology trial, no device trial |
| 27 | Console / network cleanliness | VERIFIED | Zero page errors, zero console errors, zero unexpected 4xx — **after F-7. The first measurement was wrong**: it swept Cleaner routes with a Landlord session, which the role gate refuses before the badge runs |
| 28 | Responsive layout | VERIFIED | Zero horizontal overflow at 1440 / 834 / 390 — **after F-9, and after correcting the instrument.** Under mobile emulation Chrome expands the layout viewport to fit overflow, so the original check reported zero exactly when overflow was worst |
| 29 | Physical devices | UNVERIFIED | Desktop Chromium emulating sizes is not a device trial |
| 30 | Load and concurrency | UNVERIFIED | No load testing performed |
| 31 | Test gate integrity | VERIFIED | All 202 files reached; guarded against recurrence by `tools/check-test-gate.mjs` |
| 32 | `/cleaner/jobs-map` | **PARTIALLY VERIFIED** | Was BLOCKED: a `location.hostname` branch meant every local and CI run exercised a fake path and the role gate never ran. Branch removed; gate now refuses a signed-out visitor and a Landlord-only account and opens for a Cleaner, measured at both viewports. **Map tiles and the outcode lookup stay UNVERIFIED** — this sandbox's egress policy rejects CONNECT to `tile.openstreetmap.org` and `api.postcodes.io` |
| 33 | Third-party processor disclosure | VERIFIED | `public/privacy.html` names OpenStreetMap and Postcodes.io and what each receives. **My audit claimed it did not; that claim was wrong** — the paragraph dates to 16 August 2026 |
| 34 | Second full QA pass | VERIFIED | 70 rendered states, 3 roles × 2 viewports. **9 findings on the first run, 0 product defects on the last.** The 4 entries that remain are proven artifacts, not assumed: the sandbox rejects CONNECT to `tile.openstreetmap.org`, and the harness injects a session cookie without the CSRF token a real sign-in stores — `/admin/pricing/preview` answers 200 with it and 403 without |
| 35 | `/cleaner/dashboard` | VERIFIED | Was **crashing on every load** and the error was hidden by a stylesheet — the route matrix had it as PASS because it renders a calendar (F-10, a regression from my own sidebar consolidation). Re-rendered as each reader: signed out 273 chars with a sign-in route, Landlord-only 300 with its own refusal, Cleaner 4002 with the workspace open. Was 142 / 157 / 1571 |

## Open findings

Three remain open in `HOMLE_MASTER_AUDIT.md`, and none of them is an unfixed
defect sitting where a fix was simply not attempted:

- **Unreferenced CSS selectors** (D-19) — measured per sheet against the pages
  that load it: `landlord-dashboard.css` 65 of 211, `landlord-dashboard-v2.css`
  46 of 332, `styles.css` 352 of 1151, `homle-cleaner.css` 75 of 803. Not
  deleted, deliberately: a visual-regression risk with no user-visible gain, and
  the sweep has known false positives for classes composed at runtime. The
  measurements are recorded for whoever does it with a screenshot harness.
- **The legacy `/api/admin/*` local exemption** (S-2) — a documented
  development convenience behind a flag that production refuses to boot without.
  Left in place; its four conditions are now pinned by
  `tests/admin-key-exemption.mjs`, confirmed to fail when one is removed.
- **Unbounded concurrent sessions** — 30-day sessions, no idle timeout, no
  per-account cap, no per-session revocation. A product decision, recorded so it
  is a decision rather than an accident.

Two more are marked `[!]` because they need an answer this work cannot supply:

- **S-6** — every IP-keyed limit rests on an assumption about the platform that
  needs one measurement against the real deployment.
- **S-7** — the matching recommender gates on `is_public`, profile completion,
  availability and an active account, **not on identity verification**, which is
  a `+5` score bonus and a displayed badge. So an unverified self-listed Cleaner
  can be automatically dispatched a job. Not changed: that would alter who gets
  offered work, which is the surface the Cleaner freeze protects. It is a
  marketplace-policy question and **needs an explicit answer before launch**.

Everything else recorded during this work has been fixed with named evidence.

## What would change these verdicts

Configure Stripe test keys, a geocoding provider and the vision model, and rows
11, 15, 16, 17 become testable. Run the room-photo chain against real S3 and row
12 stops resting on a double I wrote. Put the application on physical handsets
and row 29 stops being UNVERIFIED. Allow outbound access to
`tile.openstreetmap.org` and `api.postcodes.io` and row 32's remaining half
becomes measurable. Create one confirmed booking and row 19 stops being about
empty states. Answer the S-7 verification-gate question and it stops being a
policy unknown. Nothing else here substitutes for those.
