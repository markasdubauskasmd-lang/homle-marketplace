# Human TODO — things only the founder can do

Everything here blocks revenue and cannot be done from code. Each item says
exactly what to do and what it unblocks. Code for every one of these is already
written and gated behind a flag, so switching it on is configuration, not
development.

Ordered by what unblocks the most.

---

## 1. Transactional email — highest leverage switch you hold

**Unblocks:** password reset and account recovery, every booking notification,
receipts, cleaner job offers by email. Until this is on, a customer who forgets
their password cannot get back in, and nobody is told anything by email.

Steps:
1. Create a Resend account and add `homlle.com` as a sending domain.
2. Add the DNS records Resend gives you (SPF, DKIM, and the return-path CNAME) to
   the `homlle.com` zone. Wait for Resend to show the domain verified.
3. Create a verified sender address, e.g. `bookings@homlle.com`.
4. Create an API key with send permission only.
5. In the Render dashboard for `homle-marketplace-preview`, set:
   - `RESEND_API_KEY` = the key
   - `EMAIL_FROM_ADDRESS` = the verified sender
   - `WORKER_EMAIL_ENABLED` = `true`
6. Add the signed suppression webhook Resend provides and set its signing secret.
7. Redeploy, then send one test email to a mailbox you own and confirm receipt.

`WORKER_EMAIL_ENABLED` is `sync: false` in `render.yaml` on purpose — a Blueprint
sync cannot flip it, so your dashboard decision survives.

---

## 2. Stripe — test mode now, live money later

**Test mode is already attached and working.** Do not switch to live keys until
every item in section 5 is genuinely true. The payment adapter rejects live keys
by design; that guard stays.

For the test path (should already be set — verify):
- `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` in
  Render, all test-mode values.
- `PAYMENTS_ENABLED` = `true` in the Render dashboard.

For live money, later, all of these must be true in fact before they are set:
- `PUBLIC_PAYMENTS_APPROVED`, `PAYMENT_ACCOUNT_VERIFIED`, `REFUND_PROCESS_READY`.

### 2a. Automatic settlement — switch on after one rehearsal

Capture and payout otherwise need you to open `/admin/payments` and click twice
for every completed job. A settlement worker now does both on a five-minute
schedule, inside the web process. It is off by default and needs two settings in
the Render dashboard:

1. `PLATFORM_SETTLEMENT_USER_ID` — the account id of an administrator the
   platform acts as. Use the administrator created by
   `pnpm run provision:administrator`.
2. `WORKER_PAYMENT_SETTLEMENT_ENABLED=true`.

**Use the administrator's id and nothing else.** An earlier version of this
section said a wrong id would "fail safely". That was wrong, and it was the most
dangerous sentence in this file. The database does not resolve the role from the
account — it trusts the roles the application hands it — so any user's id would
have given that identity authority to capture and transfer every payment on the
platform, and recorded them as the person who moved the money.

That is now checked: the configured account is verified against the granted
roles before settlement is scheduled, and a non-administrator, suspended or
unknown id stops settlement and reports it rather than borrowing that person's
identity. The instruction is safe now because the check exists, not because it
was ever safe.

**What this does and does not solve.** It removes the administrator's two
clicks. It does **not** remove the click that actually loses money: a payment
can only be captured once the booking reaches `completed`, and only the customer
can do that by confirming the finished clean. A customer who never opens the app
leaves the booking awaiting review, the authorization uncaptured, and Stripe
releases the hold after about a week. Chasing that confirmation — a reminder, a
time limit after which completion is assumed, or an administrator override — is
a policy decision you still need to make, and it is the one that protects the
money.

**Rehearse before relying on it.** Run one full test-mode booking to completion
and confirm on `/admin/payments` that both the capture and the transfer appear,
with the cleaner receiving the expected share and the platform keeping the rest.
Then open `/api/marketplace/admin/payments/reconciliation`, which reports any
booking where a cleaner was paid more than the customer paid, or where money was
captured days ago and never transferred.

It will not touch a payment flagged for reconciliation or dispute review, and
the administrator queue remains authoritative, so you can leave settlement off
and keep approving each one by hand while volume is low.

---

## 3. Recruit the first real cleaner — ✅ NOW UNBLOCKED

**This section was blocked and is not any more.** An earlier version told you to
go and recruit somebody immediately; that was wrong, because a cleaner could not
then be onboarded to the point of being bookable. Two product gaps caused it,
both now fixed:

1. **A cleaner could never publish a profile.** Publishing needs 100%
   completion, and four of the nine required fields were written by no page in
   the product, capping it near 56%. The publish control was inert. Both fixed —
   onboarding now collects all four and the switch performs a real update.
2. **A cleaner could not create a bookable availability window.** The API was
   correct and had no caller anywhere. The schedule page now adds and withdraws
   real windows, which is the only thing matching reads.

Recruiting now produces a cleaner who can actually be matched. The steps:

1. Find and vet one cleaner: right to work, references, DBS if you are claiming
   it (do not claim it until it is done), and public liability cover.
2. Have them complete the real application at `/cleaner/apply` on the live site.
3. Approve them in the Administrator desk once screening is genuinely complete.
4. Have them finish their profile — introduction, hourly rate, languages and
   property types are on the Experience step — and then **publish it** from
   My Profile. An unpublished profile is invisible to matching.
5. Have them add **available hours** on their Schedule. Holiday mode is a note to
   themselves; the hours are the control that decides what they are offered.
6. Have them complete Stripe Connect Express onboarding, or they cannot accept
   paid work.
7. Only then set `CLEANER_SUPPLY_READY` = `true`.

The Administrator funnel separates genuine applications from complete
screenings, from approved cleaners, from approved cleaners with confirmed future
availability — so it will tell you exactly which gate you are on.

One caveat while transactional email is off (section 1): a cleaner can only sign
up with Google, because email verification cannot be sent. Worth knowing before
you ask somebody to register.

---

## 4. Render hosting

- **Web service is on the `free` plan.** Free instances spin down; a live health
  request has already waited ~29 seconds behind a cold start. This cannot be
  fixed by making startup faster without weakening the migration and integrity
  checks. Upgrading to an always-on paid instance needs your approval to spend.
- **Database is `basic_256mb` and not highly available.** Do a capacity, backup
  and restore review before real customer data lands on it. Specifically: prove
  you can restore from a backup into a scratch database.
- `autoDeployTrigger` is `"off"`, so merging never publishes. Deploys are a
  deliberate action in the Render dashboard, followed by
  `pnpm run verify:live-release https://homlle.com --expect-release=<commit>`.

---

## 5. Legal and insurance — required before taking a single real payment

Each of these maps to an attestation in `src/marketplace/config.mjs`. **Code will
never set these to true.** They assert facts about the world that only you can
know, and setting one falsely is the kind of thing that ends a company.

| Attestation | What you must genuinely have |
|---|---|
| `LEGAL_BUSINESS_READY` | Registered legal entity, customer-facing trading details |
| `INSURANCE_READY` | Public liability cover appropriate to cleaning work, evidence on file |
| `CLEANER_SUPPLY_READY` | At least one vetted cleaner, availability process proven (section 3) |
| `PRICING_POLICY_APPROVED` | Signed off customer prices, cleaner pay, costs, target margin |
| `CUSTOMER_SUPPORT_READY` | A real support contact and a named complaint escalation owner |
| `CUSTOMER_TERMS_READY` | Approved privacy, cancellation, re-clean/refund and marketplace terms |
| `PUBLIC_MARKETPLACE_APPROVED` | Your explicit decision to open to the public |

### Data protection — decisions only you can make

`docs/DATA_RETENTION_AND_ERASURE.md` has the full analysis. The short version:

- **A "delete my account" cannot be a delete.** Of the 40 foreign keys pointing
  at an account, 27 refuse the deletion outright, and the ones in the payment
  layer refuse it for anybody who has ever paid or been paid. Erasure has to be
  anonymise-in-place, keeping the financial and two-party records.
- **You must confirm the retention periods with a solicitor** — six years for
  financial records, two years after the working relationship for right-to-work
  evidence. Those are the standard UK positions, not advice.
- **Register with the ICO** as a data controller if you have not (£40–£60/year
  for most small businesses).
- **Decide four things** listed at the end of that document: what a tombstoned
  account is called in the other party's history, what happens to a deletion
  request during a live booking, the retention policy for room-scan photographs
  specifically, and sign-off on the periods.

A subject access request (someone asking for their data) is now answerable
without you: they can download their own record from their settings, and the
administrator desk shows any outstanding request with its one-month deadline.
Erasure is the part still done by hand, and those four decisions are what
unblock automating it. That answers a request inside
the month, which is what the law requires.

### Legal documents needing a solicitor

Drafts will be produced in this repo and marked clearly as drafts. **They are
starting points for a UK solicitor, not legal advice, and must not be published
as-is:**

- Terms of Service
- Privacy Policy (UK GDPR)
- Cookie Policy
- Cleaner Agreement — this one matters most. It determines whether your cleaners
  are self-employed contractors or workers, which drives holiday pay, National
  Minimum Wage and employment-status risk. Marketplace worker-status cases in the
  UK have gone against platforms that got this wrong. Get it reviewed properly
  before a single cleaner signs it.

Also needed: ICO registration as a data controller (£40–£60/year for most small
businesses), and a decision on whether you are handling any special-category data
via the room scans (photos of a home's interior can be more revealing than you
expect).

---

## 6. No-show policy — needed before the code can exist

A no-show is the one part of the money path with no implementation at all, and
it cannot be built until you decide what one *is*. Four questions, all of which
cost somebody money whichever way they go:

1. **How long after the slot start does a cleaner become a no-show?** Fifteen
   minutes is common; too short punishes traffic, too long wastes a customer's
   morning.
2. **Who reports it, and does the other side get to dispute it?** A one-sided
   report is open to abuse in both directions.
3. **What happens to the money?** The authorization is held, not captured. Is
   the customer refunded in full, charged a cancellation fee, or rebooked at no
   cost? Does the cleaner lose anything for a no-show they caused?
4. **What happens if the *customer* is the no-show** — nobody home, no access?
   The cleaner has travelled and lost the slot.

Write the answers down and they become the specification. Until then the
honest position is that Homle has no no-show handling, which is fine at one
cleaner and one customer and stops being fine quickly.

## 7. Social sign-in providers (optional, not blocking)

Google is configured and working. To add the others:

- **Apple:** `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`,
  `APPLE_PRIVATE_KEY` (PKCS#8 PEM). Requires a paid Apple Developer account.
- **Facebook:** `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`,
  `FACEBOOK_GRAPH_API_VERSION`, plus Meta's operational review and a working
  data-deletion callback.

Their buttons stay hidden until configured, so nothing is broken meanwhile — the
journey is simply Google-only plus email/password.

---

## 8. Repository housekeeping needing your word

- **40 open pull requests are all dead.** Every one is from 9–10 September and
  contains no change that is not already in `main` (verified: `git diff
  main...<head>` is empty for all 40). They should be closed. Outward-facing, so
  say the word and they will be.
- **Tracked files total 122 MB against the publication guard's 100 MiB limit,**
  mostly training videos under `public/training-safety-v04/` and
  `public/training-working-guide-v04/`. Decide whether those belong in git or in
  object storage.
- **The publication guard also reports six false positives** and so never
  passes. Three files match on a PKCS#8 header appearing in prose or a test
  placeholder with no key behind it; three are synthetic scanner fixtures that
  are deliberately tracked. It was left alone on purpose: narrowing a guard
  whose job is stopping customer data reaching a public repository is your
  decision, not one to make in passing. The recommended narrowing — match actual
  key material rather than the header alone, and exempt
  `data/scan-benchmark/` — is recorded in `LAUNCH_READINESS.md` under P2-4. It
  matters because a control that always cries wolf is a control people learn to
  bypass, and this one exists for the worst day.

---

## 9. Analytics — nothing for you to do, but here is where to look

Nothing to sign up for, nothing to pay for, nothing to switch on. Homle now
counts its own funnel, first-party and cookieless. There is no vendor account
behind it and no tag to paste anywhere.

**Where to read it:** `/admin/funnel`, signed in as an Administrator. Two sets
of numbers side by side:

* the existing lanes, built from accounts and bookings, which begin at somebody
  who already has an account;
* a new **Visitors** lane, which begins at somebody who merely arrived — page
  views, calls to action pressed, signups opened and finished, properties
  added, scans finished, prices shown, slots chosen, payments authorised.

They are shown separately and not added together, because they count different
populations.

**The question this exists to answer:** the stated growth channel is letting
agents and landlords with several properties. Every count carries an
*audience* label, so `/for-landlords` can be compared with the general landing
page directly. If that channel is not converting, this is where it will show
first.

**Why there is no cookie banner.** Nothing is stored that could identify
anybody: no cookie, no visitor id, no IP address, no referrer, no campaign tag,
no URL, and nothing timed more precisely than the hour. Rows are deleted after
ninety days. That is exactly why no consent is needed, and it is what the
published Cookie Policy already says.

**The one thing to watch for.** If anyone ever proposes adding a visitor id, a
"session", campaign tracking or a third-party tag, the Cookie Policy becomes
untrue and a consent banner becomes legally required. The policy has to change
before the code does — not after. This is written into the code comments, the
migration and the tests, so it should be hard to do by accident.
