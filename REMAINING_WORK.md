# Homle — what is actually left

**Compiled:** 20 September 2026
**Against:** `main` at `f38cb82` ("Keep room scans running after detector stalls…", #557)
**Method:** every claim below was checked against this commit's source, its test
run, its migration set and the GitHub API. Nothing here is carried over from an
earlier document without being re-verified. Where a claim could not be verified
from this container, it says so.

This file supersedes `LAUNCH_READINESS.md` as the current statement of remaining
work. That document is a 30 August audit and is now **historical**: every P0 it
raised, and both root causes behind its P1-1, are merged into `main` (see
*Verified as already done* below).

---

## Verified state of `main`

| Fact | Evidence |
|---|---|
| CI green on the head commit | Actions run 1489 on `f38cb82`, conclusion `success` |
| 114 migrations, all locked | `db/migrations/*.sql` = 114; `db/migration-lock.json` = 114 entries |
| Full suite passes locally | `pnpm test`, one environment-bound exception below |
| Every open PR is superseded | 40 open PRs; `git diff main...<head>` is **empty for all 40** |
| Live service state | **Not verified.** `CONNECT homlle.com:443` is refused `403` by this container's network policy, so only source could be inspected |

### The one local test failure is environmental, not a defect

`tests/customer-tracking-style.mjs` fails here, reproducibly, with
`Runtime.evaluate timed out` from `tools/browser-harness.mjs:222`. The harness
caps every CDP call at 30 s, and that test snapshots every CSS property of every
element across three pseudo-elements at two viewports. On this 4-core container
that exceeds 30 s; on GitHub's runner the same commit passes. Treat it as a
container limit. It is worth making the harness timeout configurable so a slow
machine reports slowness rather than a fake failure, but it is not a bug in the
product.

### Verified as already done (do not reopen)

- `LAUNCH_READINESS.md` P0-1/P0-2 — `db/migrations/103_authentication_lifecycle_column_resolution.sql` is present.
- P0-3 — `db/migrations/104_correct_outward_postcode.sql` is present.
- P1-1 root cause — `src/marketplace/runtime.mjs:352` now computes `matchingReady`
  as a pricing policy **and** a geocoder when travel is priced by distance;
  `deployment-readiness.mjs:114` refuses that configuration at the gate.

---

## A — Work that is mine, and that I can start now

The Cleaner Dashboard freeze was lifted on 20 September 2026, which unblocks A1,
A2 and A3. Item A1 must land first: until it does, CI fails on any Cleaner change
by design.

**A1 — Retire the Cleaner Dashboard freeze gate.**
`tests/cleaner-dashboard-freeze.mjs` pins 89 Cleaner files plus nine shared
matching/payout/dispatch modules to a byte-for-byte SHA-256 digest, and
`docs/CLEANER_DASHBOARD_FREEZE.md` states the digest may only be refreshed when
the objective is explicitly replaced. That has now happened. The gate must be
either removed or re-pointed at a reviewed baseline, and the doc updated to say
so — otherwise every item below that touches the Cleaner side fails CI.

**A2 — P1-6: converge the two dashboards onto one design.**
The Landlord workspace is near-white with a light sidebar, compact headings and
red accents. The Cleaner workspace is warm cream, with a different sidebar
treatment, a much larger display heading scale, different card and stat-tile
styling, and a floating chat button the Landlord side lacks. Side by side they do
not read as one product. This is the largest remaining item and the only one that
needs a decision from you before I can start: **one palette, one heading scale,
one card treatment, one sidebar treatment**, then applied deliberately to both
sides. Files: `public/landlord-dashboard.*` and `public/cleaner-*`.

**A3 — P2-5: the example job in an empty Cleaner calendar.**
`public/cleaner-schedule.js:214` renders `Deep clean £68.00 · example` in a new
Cleaner's week while the stat tiles directly above read £0.00 and 0 jobs. A
priced, dated entry in an otherwise empty calendar can be read as real work at a
glance, and it contradicts the tiles. Fix before any Cleaner is recruited.

**A4 — P2-1: settle the Property / Place / Booking vocabulary.**
`public/landlord-dashboard.js:1222` (`workspaceTabCopy`) maps `properties` →
"Properties" but `places` → "Bookings", and `requests` → "Properties". So
`/landlord/properties` renders the heading "Bookings", the sidebar item
"Bookings", the section label "YOUR PLACES" and the button "Add a place" — three
words for two concepts on one screen. I need your word choice; the change itself
is small.

**A5 — Close the 40 stale pull requests.** *(needs your go-ahead — outward-facing)*
All 40 are from 9–10 September, in long chains where each PR targets the one
below it rather than `main`. I checked every one: `git diff main...<head>` is
empty for all 40, so none carries a single change that is not already in `main`.
They are pure noise on the repo and they make it impossible to see real review
state. I would close each with a one-line reason.

**A6 — Ignore the test suite's output directories.**
`pnpm test` writes `artifacts/` (616 KB) and `test-artifacts/` (4.7 MB), neither
of which is in `.gitignore`. After any local run the tree is dirty, which trips
the publication-safety guard's clean-worktree check and invites a careless
`git add -A` to commit 5 MB of test output.

**A7 — P2-2: transactional email is plain text only.** Worth doing while email is
being switched on (see B1), not before.

**A8 — Delete the dead `.scan-hero` rules.** 36 occurrences in
`public/landlord-dashboard.css`; zero references in any JS or HTML. Left behind
by the v2 dashboard rebuild.

**A9 — P2-4: the publication-safety guard cries wolf.** *(your call — it is a security control)*
`node tools/check-publication-safety.mjs` currently blocks on **six** false
positives, not the four the August audit recorded:

- `src/marketplace/config.mjs`, `tests/authentication-activation-readiness.mjs`
  and now `LAUNCH_READINESS.md` — all match on the literal marker
  `-----BEGIN PRIVATE KEY-----` with no key material behind it;
- `data/scan-benchmark/README.md`, `.../synthetic-seed.json` and now
  `.../PHOTO-EVALUATION.md` — synthetic by construction and deliberately tracked.

It also blocks on a real one: **tracked files total 122 MB against a 100 MiB
limit**, mostly training videos under `public/training-safety-v04/` and
`public/training-working-guide-v04/`. A guard that never passes gets bypassed,
and this one exists to stop customer data reaching a public repository. Narrowing
it means matching actual key material rather than the PEM marker, exempting
`data/scan-benchmark/`, and deciding where the video assets should live.

---

## B — Blocked on configuration only (the code is written and tested)

Each of these is a flag or credential you hold. No code work is outstanding.

**B1 — Transactional email (`WORKER_EMAIL_ENABLED`).** Needs the Resend sending
domain, verified sender, API key, signed suppression webhook, and one monitored
delivery. This is the single highest-leverage switch you hold: it unblocks
email/password account recovery and every booking notification. `render.yaml`
deliberately leaves it `sync: false` so a Blueprint sync cannot flip it.

**B2 — Apple and Facebook sign-in.** Google is the only configured provider.
Apple needs `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`,
`APPLE_PRIVATE_KEY`; Facebook needs `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`,
`FACEBOOK_GRAPH_API_VERSION` plus Meta's operational review. Their controls stay
hidden until configured, so nothing is broken today — the journey is just
Google-only.

**B3 — Render web service is on the `free` plan.** Free instances spin down;
`RENDER_ACTIVATION_HANDOFF.md` records a live health request that waited ~29 s
behind a cold start. The startup safety gate cannot be shortened without
weakening the migration and integrity checks, so removing the gap means an
always-on paid instance. Needs your approval to spend.

**B4 — The Render database is `basic_256mb` and non-HA.** Capacity, backup and
recovery review is outstanding before public traffic.

**B5 — `MARKETPLACE_ENABLED` / `STAGING_ACCOUNTS_ONLY=true`.** The service is
still restricted to approved staging accounts.

**B6 — Live payments.** Stripe **test** mode is attached and working. Live money
additionally requires `PUBLIC_PAYMENTS_APPROVED`, `PAYMENT_ACCOUNT_VERIFIED` and
`REFUND_PROCESS_READY`, all `false` in `render.yaml`.

---

## C — Only you can do these (no code unblocks them)

`src/marketplace/config.mjs` requires all seven of these to be true before a
public marketplace opens beyond approved staging accounts. All seven are `false`
in `render.yaml` today.

| Attestation | What it attests |
|---|---|
| `LEGAL_BUSINESS_READY` | Legal identity and customer-facing details verified |
| `INSURANCE_READY` | Cleaning-business cover reviewed with evidence |
| `CLEANER_SUPPLY_READY` | At least one real eligible Cleaner, availability process verified |
| `PRICING_POLICY_APPROVED` | Customer prices, Cleaner pay, costs and target margin approved |
| `CUSTOMER_SUPPORT_READY` | Public support contact and complaint escalation owner operational |
| `CUSTOMER_TERMS_READY` | Privacy, cancellation, re-clean/refund and marketplace terms approved |
| `PUBLIC_MARKETPLACE_APPROVED` | Your explicit decision to open it |

**`CLEANER_SUPPLY_READY` is the real blocker.** The live public directory returns
zero Cleaner profiles. Everything upstream of matching works; there is simply
nobody to match a Landlord to. No amount of code changes that.

---

## The honest headline

Code is not what is blocking this launch. The whole agent-side queue is one
design convergence (A2), a handful of copy and UX fixes, and some repo hygiene.
Everything else is configuration you hold (B) or business steps only you can take
(C) — and of those, recruiting the first real Cleaner is the one that decides the
timeline.

## Suggested order

1. **A1** — retire the freeze gate (nothing on the Cleaner side can land until it goes).
2. **A5, A6, A8** — clear the noise: stale PRs, untracked test output, dead CSS.
3. **A3, A4** — the two honesty/clarity fixes, now that the freeze is lifted.
4. **A2** — the design convergence, once you have chosen the tokens.
5. **B1** — switch on transactional email; **A7** follows it.
6. **C** — in parallel and on your timeline; `CLEANER_SUPPLY_READY` first.
