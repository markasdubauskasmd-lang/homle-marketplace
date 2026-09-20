# Homle — working rules for Claude

Read this first, every session. Then read `PROGRESS.md` for where the work has
reached, `DECISIONS.md` for what has already been settled, and `HUMAN_TODO.md`
for what is waiting on the founder.

---

## THE ACTUAL STACK — read before planning anything

The project brief describes the stack as "Next.js, Supabase, Stripe Connect,
Anthropic API, hosted on Render." Three of those five are wrong. Verified
against this repository:

| Brief says | Reality |
|---|---|
| Next.js | **No framework.** `server.mjs` is a ~402 KB native Node HTTP server. The front end is hand-written ES modules and CSS in `public/`. No React, no JSX, no bundler. |
| Supabase | **No Supabase.** PostgreSQL 16 driven directly through `pg` 8.22.0, with 114 hand-written locked migrations in `db/migrations/`. RLS is real but is declared in those migrations, not in Supabase. |
| Stripe Connect | Correct. `stripe` 22.1.1, pinned to API `2026-06-24.dahlia`. |
| Anthropic API | Correct. `@anthropic-ai/sdk` for room-scan vision. |
| Render | Correct. `render.yaml`, Docker runtime, `autoDeployTrigger: "off"`. |

**Do not migrate to Next.js or Supabase.** Doing so would discard 114 locked
migrations, 255 test files and a green CI for no revenue gain. Treat any brief
instruction phrased in Next.js or Supabase terms as describing the *outcome*
wanted, and implement it the way this codebase already does it. See DECISIONS.md
D1.

---

## HOW TO WORK

1. Do not ask questions and do not stop to check in. At a decision, choose the
   option that reaches revenue fastest with the least risk, write one line in
   `DECISIONS.md` (decision + why), and carry on.
2. If something needs the founder (live API keys, paid accounts, DNS, legal
   sign-off), do not wait. Build it behind an env var or flag, use test/sandbox
   mode, add exact steps to `HUMAN_TODO.md`, and move to the next task.
3. Keep state in files so work resumes after a context reset: `PROGRESS.md`
   (every task, status, next step), `DECISIONS.md`, `HUMAN_TODO.md`. Update
   `PROGRESS.md` after every task and re-read it whenever context is lost.
4. These rules live here so they persist across sessions.
5. Never end a turn with a question, a summary, or "shall I continue". If a task
   is done, start the next one. If a task is blocked, log it and take another.
6. Stuck on a bug after 3 attempts: try a different approach, then the simplest
   workaround that still works. Log it and move on.
7. Use subagents for independent work and to review each finished task before
   marking it done.

---

## HARD LIMITS — these override the autonomy rules above

These are not style preferences. Each one exists because crossing it causes
real-world harm to real people or breaks the law.

1. **Never set a launch attestation to true.** `src/marketplace/config.mjs`
   defines seven: `PUBLIC_MARKETPLACE_APPROVED`, `LEGAL_BUSINESS_READY`,
   `INSURANCE_READY`, `CLEANER_SUPPLY_READY`, `PRICING_POLICY_APPROVED`,
   `CUSTOMER_SUPPORT_READY`, `CUSTOMER_TERMS_READY`, plus the payment trio
   `PUBLIC_PAYMENTS_APPROVED`, `PAYMENT_ACCOUNT_VERIFIED`,
   `REFUND_PROCESS_READY`. Each asserts a fact about the world — that insurance
   exists, that a real cleaner was vetted — which only the founder can know.
   Code may never assert them. Build up to the gate; never through it.
2. **Never take real money.** Stripe stays in test mode. The adapter already
   rejects live keys; do not weaken that. "Ready to take real money" means the
   path is complete and proven in test mode, not that live charging is switched
   on.
3. **Never invent trust claims.** No ratings, review counts, "DBS-checked",
   "insured", "10,000+ cleans", or coverage areas that do not exist in the
   database. Empty means empty; say so.
4. **Never contact a real person.** No email, SMS or push to a real applicant,
   customer or cleaner. Test mailboxes and synthetic fixtures only.
5. **Never commit secrets.** `.env` stays local; only `.env.example` is tracked.
6. **Never weaken a security control to make a check pass.** Not RLS, not CSRF,
   not origin checks, not webhook signature verification, not the publication
   guard. Narrowing a guard is a deliberate, logged change with a reason — never
   a way to get to green.
7. **Never skip, disable or quarantine a test to get CI green.** Fix the cause.
8. **Never refresh a freeze digest to silence it.** Move the change out of the
   frozen area, or retire the freeze deliberately and say so.
9. **No destructive database work.** No production or customer database, ever.
   Integration runs use a disposable database whose name ends `_tideway_test`.
10. **Respect the money-safety invariants already in the code**: authorization
    is frozen to the accepted booking total, capture/refund/transfer are
    role-bound, webhooks are signature-verified and exactly-once, and a
    payment command that was interrupted is recovered rather than repeated.
    Do not route around these.

---

## Validate every change

```
pnpm run check    # syntax + safety across 607 files (this is the lint/typecheck)
pnpm test         # full suite; pretest runs the freeze and publication gates first
```

There is no separate build, lint or typecheck step — the project is plain ES
modules, and `node --check` over every file on disk is the equivalent.

For auth, payment or database changes, add a test that **fails before** and
**passes after**. Keep commits small and name them by outcome, matching the
existing history.

### Known environment quirks

Two heavy Chromium suites fail on a small container and pass in GitHub CI.
Confirm against CI before chasing either; a failure here on a 4-core box is
slowness, not a defect.

- `tests/customer-tracking-style.mjs` — reproducible. The harness caps every CDP
  call at 30 s (`tools/browser-harness.mjs`) and this test snapshots every CSS
  property of every element at two viewports.
- `tests/shared-customer-motion.mjs` — intermittent, roughly one run in two.
  Fails as `TimeoutError: Transition was aborted because of timeout in DOM
  update` while measuring view-transition fades.

Do not "fix" either by loosening the assertion. If local flakiness becomes
costly, make the harness timeout configurable so a slow machine reports
slowness instead of a false failure.
