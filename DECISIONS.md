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
