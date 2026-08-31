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
> BLOCKED on unconfigured integrations, two are UNVERIFIED, and seven findings
> in the audit are open. What it is: an honest account of what was run, what
> happened, and what nobody has checked.

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
| 19 | Messaging | **PARTIALLY VERIFIED** | Non-participant refused `404`. **No booking exists in this database**, so no real conversation was ever exercised — only empty and gated states. A QA reviewer moved this row |
| 20 | Notifications | VERIFIED | Seeded, rendered, grouped; another account's rows refused. **Live delivery was dead in Chrome on all nineteen Cleaner pages** until F-7 — measured `403`, now `[]` |
| 21 | Cross-tenant isolation | VERIFIED | RLS at the database plus actor scoping; cross-tenant reads and writes attempted and refused |
| 22 | CSRF / origin | VERIFIED | Missing token, wrong origin and absent origin all refused `403` |
| 23 | Authenticated write abuse | VERIFIED | 400-write flood: 300 allowed, 100 refused `429`. **Sign-out was blocked at the allowance** until S-4 — re-measured `200` |
| 24 | Secrets | VERIFIED | No real credentials in the tree or its history |
| 25 | Design consistency | VERIFIED | One canvas and one font across the signed-in workspace; landing palette guarded out |
| 26 | Accessibility | **PARTIALLY VERIFIED** | Contrast, focus and naming checked. **Touch targets under 24×24px remain on four routes and `/landlord/book` has no visible `h1`** (Q-5) — recorded, not fixed. No assistive-technology trial, no device trial |
| 27 | Console / network cleanliness | VERIFIED | Zero page errors, zero console errors, zero unexpected 4xx — **after F-7. The first measurement was wrong**: it swept Cleaner routes with a Landlord session, which the role gate refuses before the badge runs |
| 28 | Responsive layout | VERIFIED | Zero horizontal overflow at 1440 / 834 / 390 — **after F-9, and after correcting the instrument.** Under mobile emulation Chrome expands the layout viewport to fit overflow, so the original check reported zero exactly when overflow was worst |
| 29 | Physical devices | UNVERIFIED | Desktop Chromium emulating sizes is not a device trial |
| 30 | Load and concurrency | UNVERIFIED | No load testing performed |
| 31 | Test gate integrity | VERIFIED | All 196 files reached; guarded against recurrence |

## Open findings

Seven, recorded with evidence in `HOMLE_MASTER_AUDIT.md` rather than fixed:
the support-cap concurrency race (Q-3), a dual-role account locked out of the
Landlord dashboard while the booking journey still admits it (Q-2), empty states
sending a signed-in user to `/login` (Q-4), sub-24px touch targets and a missing
`h1` (Q-5), no browser-history entries in the six-step journey (Q-6),
`/cleaner/jobs-map` being unverifiable by a loopback harness plus two
undisclosed third-party processors (Q-7), and the residual "this UUID is in use"
oracle behind F-8. Plus the administrator desks belonging to no design system
(D-1) and two `[ ]` security observations (S-2, S-3).

## What would change these verdicts

Configure Stripe test keys, a geocoding provider and the vision model, and rows
11, 15, 16, 17 become testable. Run the room-photo chain against real S3 and row
12 stops resting on a double I wrote. Put the application on physical handsets
and row 29 stops being UNVERIFIED. Nothing else here substitutes for those.
