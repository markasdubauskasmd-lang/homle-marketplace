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

Capture and payout used to need you to open `/admin/payments` and click twice
for **every single job**. That does not scale, and it is worse than slow: Stripe
releases an uncaptured authorization after about a week, so a missed click does
not delay the money, it loses it.

A settlement worker now does both on a five-minute schedule. It is off by
default and needs two settings:

1. `PLATFORM_SETTLEMENT_USER_ID` — the account id of an administrator the
   platform acts as. Use the administrator created by
   `pnpm run provision:administrator`; the database resolves the role from the
   account, so this cannot be faked with a config value.
2. `WORKER_PAYMENT_SETTLEMENT_ENABLED=true`.

**Rehearse before switching it on.** Run one full test-mode booking to
completion and confirm on `/admin/payments` that the capture and the transfer
both appear, with the cleaner receiving the expected share and the platform
keeping the rest. The administrator queue stays authoritative and still works by
hand, so you can leave settlement off indefinitely if you would rather approve
each one yourself while volume is low.

The worker will not touch a payment flagged for reconciliation or dispute
review — those stay for a human, which is the whole point of the flag.

---

## 3. Recruit the first real cleaner — ⚠️ DO NOT START YET

**Read this before you contact anybody.** An earlier version of this file told
you to go and recruit a cleaner now. That was wrong, and acting on it would have
wasted a real person's time and your credibility with them.

A cleaner currently **cannot be onboarded to the point of being bookable**, for
two reasons found in the 20 September audit, both in code and both mine to fix:

1. **A cleaner can never publish their profile.** Publishing requires 100%
   completion, but four of the nine required fields — biography, price,
   languages, and the residential/commercial preference — are not written by any
   page in the product. The ceiling is about 56%. The publish control itself is
   inert: it is marked read-only and has no handler behind it.
2. **A cleaner cannot create a bookable availability window.** The API exists and
   is correct, but no page calls it, and the page built for it is redirected
   away. What the schedule screen saves goes into a different store that the
   matcher never reads.

So the live directory returning zero cleaners is **not** purely a recruitment
problem, which is what this file previously implied. It is a product gap sitting
behind a recruitment problem. Recruiting first would produce a vetted, willing
cleaner who then cannot be matched to any job.

These are tracked as C1 and C2 in `PROGRESS.md` and are now the top of the queue.
**This section unblocks once they ship** — you will be told.

When it does unblock, the steps are:
1. Find and vet one cleaner: right to work, references, DBS if you are claiming
   it (do not claim it until it is done), and public liability cover.
2. Have them complete the real application at `/cleaner/apply` on the live site.
3. Approve them in the Administrator desk once screening is genuinely complete.
4. Have them add real future availability and complete Stripe Connect Express
   onboarding.
5. Only then set `CLEANER_SUPPLY_READY` = `true`.

The Administrator funnel already separates applications from complete screenings
from approved cleaners with confirmed availability, so it will tell you exactly
which gate you are on.

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

Until those are settled, a request is tracked with its statutory deadline on the
administrator desk and the erasure itself is done by hand. That answers a request
inside the month, which is what the law requires, but it does not scale.

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

## 6. Social sign-in providers (optional, not blocking)

Google is configured and working. To add the others:

- **Apple:** `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`,
  `APPLE_PRIVATE_KEY` (PKCS#8 PEM). Requires a paid Apple Developer account.
- **Facebook:** `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`,
  `FACEBOOK_GRAPH_API_VERSION`, plus Meta's operational review and a working
  data-deletion callback.

Their buttons stay hidden until configured, so nothing is broken meanwhile — the
journey is simply Google-only plus email/password.

---

## 7. Repository housekeeping needing your word

- **40 open pull requests are all dead.** Every one is from 9–10 September and
  contains no change that is not already in `main` (verified: `git diff
  main...<head>` is empty for all 40). They should be closed. Outward-facing, so
  say the word and they will be.
- **Tracked files total 122 MB against the publication guard's 100 MiB limit,**
  mostly training videos under `public/training-safety-v04/` and
  `public/training-working-guide-v04/`. Decide whether those belong in git or in
  object storage.
