# Cleaner Dashboard no-change boundary — RETIRED

**Status: retired on 20 September 2026.** This document is kept because the
boundary is referenced from `LAUNCH_READINESS.md` and from commit messages
throughout the history, and a reader who follows one of those references needs to
know the rule no longer applies.

## What it was

While the active product objective made the Cleaner workspace a strict no-change
area, `tests/cleaner-dashboard-freeze.mjs` pinned it byte for byte: 98 files
(every `public/cleaner-*` page and script, `public/homle-cleaner.css`, the shared
browser modules the workspace loads, and every `src/marketplace/cleaner-*`
module) against one SHA-256 digest, plus a second digest over nine shared modules
that decide Cleaner matching, job terms, payout and automatic dispatch.

It ran first in `pretest`, so any change to those files failed the whole suite
before a single test executed. That was the point: it made an accidental
cross-boundary edit fail in CI rather than in production.

## Why it is retired

The founder explicitly replaced the no-change objective on 20 September 2026 and
directed that the Cleaner side be completed — sign-up, profile, service area,
availability, Stripe Connect onboarding, job offers, checklist completion and
earnings. That work cannot be delivered while the files it must change are pinned
byte for byte, so the gate was removed rather than repeatedly overridden.

Removing it was the honest option. The alternative — refreshing the digest on
each change — was already failing: the retired test carried twenty-four
consecutive identical `User authorised the database-backed safety exam` comments,
one per refresh. A guard that is re-blessed on every commit records history
rather than preventing anything, which is precisely the failure its own change
protocol warned about.

## What protects the Cleaner surface now

The second layer the original boundary relied on, which was always the stronger
one:

- behavioural and UI tests — `tests/cleaner-profile-ui.mjs`,
  `tests/cleaner-profile.mjs`, `tests/cleaner-onboarding.mjs`,
  `tests/cleaner-work-zones.mjs`, `tests/active-job-ui.mjs`;
- Cleaner-outcome tests over the shared modules — `tests/matching-service.mjs`,
  `tests/booking-workflow.mjs`, `tests/automatic-dispatch-worker.mjs`,
  `tests/platform-priced-booking.mjs`, `tests/proposal-economics.mjs`;
- `tests/noncleaner-link-integrity.mjs`, still first in `pretest`;
- `tests/verification-coverage.mjs`, which derives from disk and fails if any
  test file stops being executed — so a Cleaner test cannot be quietly dropped.

The money-safety invariants that the shared-module digest was really protecting
— pay floors, margin checks, frozen booking terms, the one-live-invitation
constraint — are asserted behaviourally by those tests. Behaviour is the thing
worth pinning; bytes were only ever a proxy for it.

## If a no-change boundary is wanted again

Do not restore a whole-file digest. Pin the behaviour instead: assert the
invariant that matters (a Cleaner is never offered work below the pay floor; the
accepted total cannot move after acceptance) in a test that explains itself when
it fails. A digest can only ever say "something changed", which is why it ends up
being refreshed unread.
