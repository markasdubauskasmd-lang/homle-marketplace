# Decisions

One line per decision: what was decided, and why. Newest last.

---

**D1 — Keep the existing stack; do not migrate to Next.js or Supabase.**
The brief names Next.js and Supabase, but the repo is a native Node HTTP server
(`server.mjs`) with hand-written ES modules in `public/`, and PostgreSQL driven
directly through `pg` with 114 locked migrations. Migrating would discard those
migrations, 254 test files and a green CI, and would add weeks before it added a
pound of revenue. Brief instructions phrased in Next.js/Supabase terms are read
as describing the outcome wanted and implemented the way this codebase does it.

**D2 — Retire the Cleaner Dashboard freeze rather than refresh its digest.**
The founder replaced the no-change objective and directed that the Cleaner side
be completed, which cannot happen while those files are pinned byte for byte. The
retired test already carried 24 identical "User authorised…" comments, one per
refresh — a guard re-blessed on every commit records history instead of
preventing anything. Behavioural tests over the same surface remain and are the
stronger protection. `docs/CLEANER_DASHBOARD_FREEZE.md` records what replaced it.

**D3 — `pnpm run check` + `pnpm test` are the build, lint and typecheck.**
The brief asks for build/typecheck/lint. The project is plain ES modules with no
framework, bundler or TypeScript, so there is nothing to build and no types to
check. `node --check` across all 606 source and test files is the equivalent and
already runs in CI. Adding a bundler or TypeScript now would be churn, not
revenue.

**D4 — Ignore the test suite's screenshot output rather than commit it.**
`pnpm test` writes 64 PNGs to `artifacts/` and `test-artifacts/`. Nothing is
tracked under either path and both are rewritten per run, so ignoring them is
lossless and stops a dirty tree tripping the publication guard.

**D5 — Document the publication guard's PEM false positive without quoting the
header.** Quoting the PKCS#8 header in prose makes the guard match the prose,
which is how `LAUNCH_READINESS.md` became a false positive. Describing it avoids
adding another.

**D6 — Do not delete the `.scan-hero` CSS; it is not dead, and it is not urgent.**
My own first pass called these 36 rules dead because no markup carries the class.
That was wrong. `tests/landlord-dashboard-ui.mjs:352` reads `.scan-hero`'s
`min-height` as the reference the manual booking route must match or exceed, so
the two routes read as equals — deleting the rules would drop a design guarantee
while the test still passed on a `null` match, or crash it. The source comment at
`public/landlord-dashboard.css:407` already says this and says both should retire
together. Correct fix is to restate the constraint against `.hub-cta`, which
actually replaced it, then retire both. Deferred: it is cosmetic, and nothing
about it blocks a paid booking.

**D7 — Automatic settlement reuses the administrator command path rather than a
worker-role SQL path.** Every guard that makes capture and transfer safe —
booking completed, payment authorized, no dispute or reconciliation hold,
verified payout destination, one live command per kind — lives in
`begin_payment_command`. A parallel settlement path in SQL would duplicate all of
it, and money movement is the last place in this codebase that should have two
implementations able to drift. The cost is that the worker needs a real
administrator account to act as, because the database resolves the role from the
account; that is `PLATFORM_SETTLEMENT_USER_ID`, and it is a feature rather than a
workaround — no environment variable can assert a role.

**D8 — Cancelling a booking charges nothing.** The money is only ever authorized,
never captured, before a clean happens, so releasing an uncaptured hold costs the
platform nothing and returns the customer's money immediately. A cancellation fee
is a pricing decision needing `PRICING_POLICY_APPROVED` and approved customer
terms; it is recorded in `HUMAN_TODO.md` rather than invented.

**D9 — A failed hold release blocks the cancellation instead of stranding money.**
`begin_payment_command` refuses a cancel unless the booking is still `confirmed`,
so the hold must be released first. If that release fails, cancelling anyway
produces a state with no exit: the payment can then never be cancelled, captured
or refunded by anyone, and no job sweeps it. A provider outage delaying a
cancellation is recoverable; money nobody can move is not.

**D10 — Test guards strip comments before matching source.** Three separate
guards in this session fired on the prose explaining them rather than on code —
the publication guard on a documented PEM header, the example-booking guard on a
comment naming the fixtures, the settlement guard on a comment naming the SQL
function. A guard that matches its own explanation teaches the next person to
delete the explanation. Strip comments, or describe rather than quote.
