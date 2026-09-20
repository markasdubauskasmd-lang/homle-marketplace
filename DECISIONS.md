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
implementations able to drift. The cost is that the worker needs a real administrator account to act as:
`PLATFORM_SETTLEMENT_USER_ID`.

**Corrected 20 September 2026.** This decision originally claimed the database
resolves the role from the account, so a wrong id would fail safely. That is
backwards. `tideway_private.has_role` reads `app.user_roles`, which
`database.mjs` sets verbatim from the actor the application supplies — the
database trusts the caller. Any user's id in that variable would have granted
that identity authority to capture and transfer every payment and stamped them
on the audit record. Migration 122 adds `account_holds_role`, and the attachment
verifies the configured account against `user_roles` before scheduling
anything, which is what makes the original sentence true.

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

**D11 — Analytics will be first-party and cookieless, not a third-party tag.**
The brief asks for analytics with conversion events on the booking funnel. Three
things constrain how: the CSP is `script-src 'self'` and `connect-src 'self'`,
so a vendor tag is blocked without weakening it; an analytics cookie needs PECR
consent, which means a banner; and the cookie policy published in `75c50e9a`
states plainly that there is no advertising, tracking or analytics cookie and
that the page changes before one appears.

A first-party, cookieless event endpoint satisfies the brief and all three:
no CSP change, no consent banner, no cross-site identifier, and the published
promise stays true. It is also better data — server-side events cannot be
blocked by an ad blocker, which is a large share of exactly the audience Homle
is selling to.

The pattern already exists and is proven: `tideway_private.scan_telemetry_hourly`
(migration 101) is an hourly aggregate with a fixed metric vocabulary, bounded
dimensions, no account, session or request key, and 90-day deletion on write. A
sibling table with a funnel vocabulary is the shape to copy — not an extension
of that table, whose dimensions and admin page are scanner-specific.

Scope for whoever picks this up: a `public_funnel_hourly` aggregate; a
rate-limited `POST` accepting only an allowlisted event name and no identifier;
client calls at the landing CTAs, signup, property added, scan completed, price
shown, slot chosen, payment authorised and booking confirmed; and a read on the
existing `/admin/funnel` page beside the account-derived lanes already there.
Do not add a visitor identifier, and do not make this a "session" — the moment
it can follow one person it needs consent, and the cookie policy has to change
first.

**D12 — The funnel stops at the authorised payment, not at the confirmed
booking.**
D11 listed "booking confirmed" among the client calls. It was dropped while
building D11, because no browser can count it honestly: a booking becomes
confirmed when a Cleaner accepts, which happens after the customer has closed
the page. Counting it from a later dashboard render would either double-count
on every reload or need a per-visitor store to deduplicate — and a per-visitor
store is exactly the identifier D11 forbids.

Nothing is lost. The account-derived lane on the same Administrator screen
already counts confirmed bookings exactly, from the bookings themselves, and
has since before any of this existed. A visitor stage that could only ever read
zero would have been worse than no stage at all.

The two lanes are rendered side by side and deliberately not merged: the
account lane begins at somebody who already has an account, the visitor lane
begins at somebody who merely arrived, and presenting them as one funnel would
claim they count the same population.

**D13 — An unpaid booking is cancelled twelve hours before its slot, behind the
same gate as settlement.**
The brief requires failed payments to be handled with no manual step. The
reminders already existed — one when the five-day authorization window opens
(migration 043), one twenty-four hours before the slot, and an outcome email
when an authorization fails (117/123). What did not exist was an ending. A
booking nobody paid for stayed `confirmed` indefinitely, and migration 025
would never have let the job start.

The cost of that falls on the Cleaner, not on the platform: their calendar is
held for a job that cannot legally begin, and nobody tells them. With almost no
supply in the pilot, that is the most expensive silent failure in the system.

**Twelve hours** before the slot, because the customer has already had two
notices and twelve more hours after the last one is a real chance to pay, while
leaving the Cleaner half a day's notice rather than a doorstep. Bookings already
past their start with nothing authorized are ended too; they were never going to
happen.

**No cancellation fee.** Nothing was ever authorized, so there is nothing to
charge and no approved customer terms to charge it under. That stays a founder
decision in `HUMAN_TODO.md`, exactly as it does for a Landlord cancellation.

**Behind the settlement gate, not a flag of its own.** It needs the same
verified platform administrator, and — decisively — it must never run where
payments are switched off. There, no booking has an authorization because none
can, and migration 025 deliberately lets jobs start without one; an expiry loop
in that world would cancel every confirmed booking in the system. One condition
is safer than two that can disagree.

**The hold is released before the booking is cancelled**, which is the ordering
migration 115 settled: `begin_payment_command` will not cancel a hold on a
booking that has already left `confirmed`. If the release fails the booking is
left alive and the failure reported, because a booking still holding somebody's
money is safer alive than cancelled with the money stranded.

**D14 — A database function is not covered until something has executed it.**
Review found that `cancel_booking_as_landlord` (migration 115) and
`expire_unpaid_booking` (migration 125) both declared the previous booking
status as `text` and inserted it into an enum column. PostgreSQL has no
assignment cast from text to an enum, so both threw on the one path where they
would act. Reproduced against PostgreSQL 16 with every migration applied.

The consequence was the exact failure both functions were written to prevent.
Both callers release the customer's card hold first, because
`begin_payment_command` will not cancel a hold on a booking that has already
left `confirmed`. So the live sequence was: return the money, fail to cancel
the booking, leave the Cleaner's slot blocked. For the expiry loop it would
have repeated every fifteen minutes, for ever.

Every test covering those functions passed throughout, because every one of
them was either a JavaScript fake or a string match against the migration
source, and neither can see a type error. That is the actual lesson, and it is
now a rule: **a migration that adds a function gets an entry in
`db/integration/` that executes it.** `booking-cancellation-verification.sql`
does that for both, runs inside the existing PostgreSQL integration runner, and
fails against the pre-126 schema with the original error — verified in both
directions rather than assumed.

Two related repairs came from the same review. The expiry queue had no lower
bound, so a same-day booking was eligible for cancellation the moment it was
confirmed, before either reminder could fire — the twelve-hour deadline's whole
justification is that the customer has already been warned, and that was untrue
for any booking made inside the window. Expiry now requires a payment reminder
sent at least two hours earlier, read from the reminders themselves so it
cannot drift out of step with the schedule that sends them. And a cancel whose
provider outcome is *unknown* resolves rather than throwing; the worker counted
that as a release. It no longer does, because a booking that leaves `confirmed`
on an uncertain release has its ordinary route back to the money closed.

**D15 — The case desk issues its own refund, and the attestation changed with
it.**
Resolving a dispute and refunding the customer it decided for were two screens
on two desks. The second was easy to forget, and a decision that implies money
should not be separated from the money by an act of memory.

A resolution may now carry a refund, sent through the existing guarded `refund`
command — every ledger guard, the idempotency record and the administrator
role-binding are unchanged, because money movement is the last place to grow a
second implementation.

Three choices worth stating:

**The money moves before the decision is recorded.** This started out the
other way round, on the reasoning that nothing about resolving closes the door
on a later refund. Review proved that wrong, and for the common outcome.
Resolving with `completed` moves the booking out of `disputed`, which makes
`can_transfer` true; the settlement loop then pays the Cleaner within about
five minutes, and migration 113 refuses every refund on a transferred payment
for good. So a refund that failed at the moment of resolution could not be
retried afterwards either — while the screen was telling the Administrator to
send it from the payments desk, where it would also be refused. The window was
five minutes wide and closed silently.

Refunding first inverts the failure mode into a benign one: a refund that
succeeds and a resolution that then fails leaves the money returned, the case
open and the booking still `disputed` — a state an Administrator can simply
finish. A refund that fails stops the request, so no case is ever marked final
claiming money moved when it did not. Reading the case before acting is why
migration 127 exists.

**The payment is resolved server-side from the case's own booking.** The client
never says which payment to refund; if it could, an Administrator could be
induced to refund a different booking entirely.

**The idempotency key is the case, not the case and the amount.** With the
amount in it, a changed amount was a different key, a different command and a
second real refund — and `review_booking_dispute` returns success when a case
is replayed with an identical note and outcome, so a resubmitted form reaches
the refund a second time. An earlier version of this entry claimed the ledger
refused a changed amount; that was the one case it could not refuse, because
its conflict check fires on key *reuse*. Keyed on the case alone, an identical
replay is idempotent and a changed amount is refused, which is what this always
claimed to do.

**A refund only ever accompanies a final decision.** It was parsed from the
body independently of the status, and the handling standard is only checked
when resolving — so `{status:"reviewing", refundAmountPence, refundAuthorised}`
refunded a customer with no attestation of any kind and no decision recorded.
Merely starting a review could move money.

**The attestation is version 2, with a new field name.** Version 1 asked the
Administrator to confirm the decision performed "no payment or external
action". That stops being true the moment this screen can refund, and an
attestation that is routinely untrue is worse than none because people learn to
tick it. It is now `noUnrecordedActionConfirmed` — nothing happened beyond what
is written down — and a refund additionally needs `refundAuthorised` for that
exact amount. The rename is deliberate: someone reading an old audit record
should be able to tell which promise was actually made. A client still sending
v1 is refused rather than silently reinterpreted.

What is still a founder decision: *when* to refund and *how much*. That is
operating policy, it is in `HUMAN_TODO.md`, and no code here decides it — the
Administrator types the amount.
