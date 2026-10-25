# Launch checklist — what only the founder can do

**Compiled:** 25 October 2026, against `main` after the launch integration.
**Order matters.** Each step says where to click, what it sets, and how to
check it worked. Nothing here can be done from code: each step either costs
money, needs an account only you hold, or asserts a fact about the real world.

Code never sets an attestation, never takes real money, and never contacts a
real person. Those rules (CLAUDE.md, "HARD LIMITS") are why this list exists.

---

## 0. Deploy what is merged (every time `main` changes)

`render.yaml` has `autoDeployTrigger: "off"`, so merging publishes nothing.

1. Check that GitHub CI is green on the latest `main` commit (Actions tab).
2. Note the commit: `git rev-parse --short=8 origin/main`, or the first eight
   characters shown on GitHub.
3. **Stop payment commands from being mid-flight** (from #559). Open
   `https://homlle.com/admin/payments`. If any payment shows an action waiting
   on the provider, wait until it clears. Payments are test mode only, so this
   takes minutes, not a maintenance window.
4. Render → `homle-marketplace-preview` → **Environment** → set
   `TIDEWAY_EXPECT_RELEASE` to the eight-character commit → **Save** (do not
   redeploy from the save dialog).
5. **Manual Deploy → Deploy latest commit.** Wait for **Live**. Render then
   stops the old instance; let it finish.
6. From a checkout of `main`:
   ```
   pnpm run verify:live-release https://homlle.com --expect-release=<commit>
   ```
7. Open `https://homlle.com/api/health`. Check `sourceCommit` = the commit,
   `migrationCount` = the number of entries in `db/migration-lock.json` at
   that commit (136 for the launch integration release, 137 once the
   visitor-API release is merged), `dataIntegrity: "healthy"`, and
   `writesAllowed: true`.
8. Render → **Logs**: find `Inline marketplace workers started`.
9. Open `https://homlle.com/api/marketplace/admin/payments/reconciliation` while
   signed in as an Administrator. Expect zero `over-transferred` rows. Rows
   marked `awaiting-transfer` are Cleaners still owed money; act on them.

10. As a visitor, in a private window, on your phone:
    - `https://homlle.com/` → **Get a price** → enter a postcode, a type of clean
      and rooms. Expect a price within a second or two. Until a real Cleaner is
      live it should say "We do not have a Cleaner in … yet" and offer launch news.
    - `https://homlle.com/how-homle-works` reads true to you. If any sentence is
      not true for your business, tell the engineer before anything else.
    - `https://homlle.com/llms.txt` and `https://homlle.com/openapi.json` load.
    - `/mcp` stays off (`MCP_ENABLED` unset). Turn it on only after reading
      DECISIONS D31.

If any check fails, do not flip any switch below. Paste the output to the
engineer.

---

## 1. Transactional email (the highest-leverage switch)

**Unlocks:** password reset and account recovery, every booking and payment
notice, and email sign-up for Cleaners (until this is on, Google sign-in is
the only way in).

1. **Resend** → Domains → **Add domain** → `homlle.com` (region EU).
2. At your DNS host, add exactly the records Resend shows: the SPF `TXT`, the
   DKIM `TXT`/`CNAME`, and the return-path (`send.`) `MX`/`TXT`. Wait until
   Resend shows **Verified** for every record.
3. Choose the sender address, for example `Homle <bookings@homlle.com>`. It
   must be on the verified domain.
4. Resend → API Keys → **Create** → permission **Sending access** only →
   domain `homlle.com`. Copy the key (`re_…`).
5. Resend → Webhooks → **Add endpoint** →
   `https://homlle.com/api/marketplace/email/resend/webhook`. Subscribe to
   `email.bounced` and `email.complained` at least. Copy the signing secret
   (`whsec_…`).
6. Render → Environment, set:
   | Variable | Value |
   |---|---|
   | `EMAIL_DELIVERY_PROVIDER` | `resend` |
   | `RESEND_API_KEY` | the `re_…` key |
   | `RESEND_WEBHOOK_SECRET` | the `whsec_…` secret |
   | `EMAIL_FROM` | the sender, e.g. `Homle <bookings@homlle.com>` |
   | `WORKER_EMAIL_ENABLED` | `true` |

   The app refuses a half-configured setup. Resend without the webhook secret
   is rejected on purpose, so that bounced addresses are suppressed.
7. Deploy (section 0), then check `/api/health` shows `emailReady: true`.
8. **One monitored delivery:** sign up at `https://homlle.com/signup` using a
   mailbox you own. Confirm the verification email arrives, then use
   "Forgot password" and confirm that arrives too. Check Resend → Emails shows
   both as **Delivered**.

---

## 2. Render capacity (spending; your approval)

1. **Always-on web instance.** On the free plan the instance sleeps, and a
   cold start has been measured at about 29 s with 503s while it wakes. A
   customer who taps "Book" during that window sees an error. Render →
   `homle-marketplace-preview` → **Settings → Instance type** → choose the smallest
   paid, always-on instance type → Save. Check: open the
   site after an hour of no traffic; it should answer immediately.
2. **Database review.** The database is `basic_256mb`, non-HA.
   - Render → the Postgres instance → **Recovery**: confirm point-in-time
     recovery or backups exist on the current plan, and how long they are kept.
   - Rehearse a restore into a scratch database, never the live one, following
     `docs/database-restore-rehearsal.md` and
     `tools/postgres-restore-rehearsal.mjs`. Record the date and the result.
   - Decide whether to move to a larger or HA plan before public traffic. At
     pilot volume, `basic_256mb` is enough if the restore works.

---

## 3. Stripe

Stays in **test mode** until every item in section 6 is genuinely true. The
adapter refuses live keys on purpose.

1. **Automatic settlement, after one rehearsal.** Run the section 5 rehearsal
   first. Then:
   - Find your Administrator account id. Run `pnpm run provision:administrator`
     if none exists, or ask the engineer to read it from `/admin/accounts`.
   - Render: `PLATFORM_SETTLEMENT_USER_ID` = that id;
     `WORKER_PAYMENT_SETTLEMENT_ENABLED` = `true`.
   - **This switch also starts unpaid-booking expiry.** A booking that is
     still unpaid twelve hours before its slot is cancelled, and both sides are
     told (HUMAN_TODO.md section 2b).
   - Check: after the next completed test booking, `/admin/payments` shows the
     capture and the transfer without your clicks. The reconciliation link in
     section 0, step 9 shows no drift.
2. **Live account verification.** Stripe Dashboard → leave test mode →
   complete business verification, bank account and Connect platform profile
   (Express). Do **not** put live keys into Render yet.
3. **Refund policy.** Write down when a refund is given, how much is given for
   a partial failure, and who approves it. Publish it in the customer terms
   (section 6).
4. **The payment trio, only after 1–3 and section 6:** set
   `PAYMENT_ACCOUNT_VERIFIED`, `REFUND_PROCESS_READY` and
   `PUBLIC_PAYMENTS_APPROVED` to `true`, in that order, each only when it is
   true. Then swap to live keys (`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`,
   `STRIPE_WEBHOOK_SECRET` from a live-mode webhook endpoint). The adapter's
   live-key refusal must then be lifted by a deliberate engineering change.
   Ask for it; it is not a setting.

---

## 4. The first real Cleaner

The code that makes a Cleaner bookable is now merged: profile completion
reaches 100%, the profile can be published, and the Schedule page creates real
availability windows.

1. **Vet them yourself:** right to work (sight the document), two references,
   and their own public liability cover. A DBS check is only needed if you will
   *claim* one; do not claim it until it is done. Homle does not insure them,
   and `/for-cleaners` says so.
2. They apply on the live site at **`https://homlle.com/cleaner/registration`**,
   which continues at `/cleaner/onboarding`. (`/cleaner/apply` does not exist.)
   Until email is on (section 1), they must sign up with Google.
3. You review and approve them at **`/admin/verifications`**. Use "Review
   submitted application"; each look is audited. Open the identity documents
   themselves before recording the identity decision.
4. They complete **My Profile**: introduction (at least 40 characters), hourly
   rate, languages, and residential/commercial preference are on the
   Experience step. Then they **publish** it.
5. They add **available hours** on **Schedule**. Holiday mode is only a note;
   the hours decide which jobs they are offered.
6. They complete **Stripe Connect Express** onboarding from their payouts page.
   Without it, matching skips them while payments are on.
7. Check: their profile appears in the public directory, and `/admin/funnel`
   shows one "approved with future availability".
8. Only then set **`CLEANER_SUPPLY_READY`** = `true`.

---

## 5. Two-account mobile rehearsal (test mode)

1. Use two phones: one signed in as a Landlord test account you own, one as
   the Cleaner from section 4 (or a second test Cleaner you own). Both accounts
   must be on the staging allow-list while `STAGING_ACCOUNTS_ONLY=true`.
2. Walk the whole journey: book → scan → price → Cleaner accepts → pay with
   Stripe test card `4242 4242 4242 4242` → "on the way" → arrive → progress
   photos → complete → review → refund it from `/admin/payments`.
3. Follow `docs/HOSTED_PARTICIPANT_REHEARSAL.md` to run
   `pnpm run verify:hosted-rehearsal` against the staging database with that
   booking id.
4. Paste its JSON into the **Administrator launch desk** (`/admin`). The desk
   validates it on the server.
5. Clean up the synthetic records as the rehearsal doc describes.

---

## 6. Legal, insurance and support (each maps to an attestation)

| Do this | Then set | Evidence to keep |
|---|---|---|
| Solicitor reviews Terms, Privacy, Cookie Policy and the Cleaner Agreement (worker status matters most); fill in operator identity | `CUSTOMER_TERMS_READY` | the signed-off versions |
| Register the business entity and publish trading details; register with the ICO (£40–£60 a year) | `LEGAL_BUSINESS_READY` | registration numbers |
| Buy public liability cover suitable for a cleaning marketplace | `INSURANCE_READY` | the policy schedule |
| Decide retention periods and the four open questions in `docs/DATA_RETENTION_AND_ERASURE.md` | (part of `CUSTOMER_TERMS_READY`) | written decisions |
| Publish a support contact, and name a complaint owner and response times | `CUSTOMER_SUPPORT_READY` | the published page |
| Sign off customer prices, Cleaner pay, costs and target margin in `/admin/pricing` | `PRICING_POLICY_APPROVED` | the approved figures |
| Answer the no-show questions in `HUMAN_TODO.md` section 6 | (unblocks the no-show feature) | your answers |

---

## 7. A second Administrator

The last-Administrator guard stops you suspending the only one, which also
means a compromised Administrator cannot be locked out. Create a second
Administrator with `pnpm run provision:administrator` (environment variables
`ADMIN_PROVISION_*`; see `tools/bootstrap-administrator.mjs`). Use a different
person or a hardware-key-protected account. Check: `/admin/accounts` finds both.

---

## 8. Go-live flip order

Do these only when everything above is true, one at a time, deploying and
re-checking `/api/health` after each:

1. `LEGAL_BUSINESS_READY`
2. `INSURANCE_READY`
3. `CUSTOMER_TERMS_READY`
4. `CUSTOMER_SUPPORT_READY`
5. `PRICING_POLICY_APPROVED`
6. `CLEANER_SUPPLY_READY`
7. The payment trio (section 3, step 4) and live keys
8. `STAGING_ACCOUNTS_ONLY` = `false`
9. **`PUBLIC_MARKETPLACE_APPROVED` = `true`, last.** This is your decision to
   open to the public.

---

## Optional, not blocking

- **Address search** (`addressLookupReady`): Google Cloud → enable Places API
  (New), create a server key restricted to that API (needs billing). Then set
  `ADDRESS_LOOKUP_PROVIDER=google-maps` and `GOOGLE_MAPS_SERVER_API_KEY` (see
  `docs/GOOGLE_MAPS_SETUP.md`). Until then Cleaners type their address, which
  works.
- **Apple / Facebook sign-in:** see HUMAN_TODO.md section 7.
- **Training videos out of git:** the repository is about 120 MiB, against the
  publication guard's 100 MiB limit, and about 26 MiB of that is the training
  videos under `public/training-*`. Choose either a public object-storage
  bucket or Git LFS (and confirm that Render's build fetches LFS files) before
  they move.
