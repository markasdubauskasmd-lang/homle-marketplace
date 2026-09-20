# Data retention and erasure

**Status: analysis complete, fulfilment not automated. Needs a founder decision
and a solicitor's sign-off before it can be.** Written 20 September 2026 from a
full read of all 118 migrations.

This document exists because "delete my account" cannot be implemented the
obvious way, and building it the obvious way would destroy records the business
is legally required to keep.

---

## The finding that decides the design

**A hard `DELETE FROM users` is impossible for any account that has done
anything.** Of the 40 foreign keys referencing `users(id)`:

| Behaviour | Count | Effect on a delete |
|---|---|---|
| `CASCADE` | 10 | Row is removed with the account |
| `SET NULL` | 3 | Reference is cleared, row survives |
| `RESTRICT` | 3 | **Delete is refused** |
| `NO ACTION` | 24 | **Delete is refused** |

The three `RESTRICT` constraints are all in the payment layer —
`booking_payments.landlord_user_id`, `booking_payments.cleaner_user_id` and
`payment_commands.created_by` — plus two more reaching the payout tables through
`cleaner_profiles`. So any account that has ever paid, been paid, or cancelled a
payment cannot be deleted. The 24 `NO ACTION` constraints add everyone who has
sent a message, uploaded a photo, appeared in a status history, or created a
booking or request.

`cleaner_profiles` and `landlord_profiles` cascade from `users`, so the cascade
reaches the payment `RESTRICT` constraints and aborts. There is no ordering that
makes it work.

The repository already encodes this conclusion elsewhere:
`tools/purge-staging-account.mjs` runs a 26-way activity count and refuses to
delete if any count is non-zero. It is staging-only and additionally requires a
staging database name. **It must not be repurposed for production erasure** — it
issues a real `DELETE FROM users`, gated only by a database-name pattern.

---

## What UK law requires us to keep

Retention here is not caution, it is obligation. UK GDPR Art. 17(3)(b) and (e)
exempt data needed for a legal obligation or for legal claims.

| Data | Retain | Basis |
|---|---|---|
| `booking_payments`, `payment_commands`, `payment_status_history` | 6 years from the end of the accounting period | Companies Act 2006 s.388; VAT Regs reg.31 |
| Provider event and dispute records (`tideway_private.payment_provider_events`, `payment_disputes`) | 6 years | Chargeback evidence — a lost dispute is a live liability |
| `bookings.customer_price_pence`, `cleaner_pay_pence` and the planned-cost columns | 6 years | The invoice basis; cleaner pay is a contractor payment, so tax-adjacent |
| Payout records (`cleaner_payout_accounts`, `cleaner_payout_onboarding`) | 6 years | Evidence of who was paid |
| Right-to-work onboarding sections | 2 years after the working relationship ends | Immigration, Asylum and Nationality Act 2006 statutory excuse |
| Tax and identity onboarding sections | 6 years | Tax record-keeping |

Also relevant: the Limitation Act 1980 s.5 gives six years to bring a contract
claim, which supports keeping the booking record for the same period.

---

## What is not the requester's to erase

A booking is a bilateral contract. Erasing one party must not destroy the
other's record of work performed and paid for.

- **`bookings`** — held about both parties; a constraint guarantees they are
  different people.
- **`messages`** — each message is the sender's data *and* the recipient's
  received correspondence.
- **`reviews`** — a review is the landlord's expression *about the cleaner*,
  and the cleaner has an interest in their own rating record. Note a trigger
  recomputes `cleaner_profiles.average_rating` on delete, so removing reviews
  silently rewrites another person's public reputation.
- **`job_photos`** — the cleaner's evidence of work done, taken inside the
  landlord's property. Both have an interest.
- **`disputes`**, **`support_requests`** with a related booking — the
  counterparty's complaint record.

---

## The design this points to

**Anonymise in place; do not delete.** The schema was built for it:
`users.account_status` already has `'deletion-pending'` and `'deleted'`, and
`users.deleted_at` already exists, both since migration 001.

1. Tombstone the identity: null or replace `email`, `display_name`,
   `avatar_url`; set `account_status = 'deleted'` and `deleted_at = now()`.
2. Hard-delete the `CASCADE` set, which is genuinely safe: roles, authentication
   identities, password credentials, verification and reset tokens, sessions,
   notifications, privacy requests, support requests, the cleaner profile tree
   (services, service areas, availability, onboarding sections and documents,
   profile photo), the landlord profile tree (properties, property photos), and
   favourite cleaners.
3. Destroy the sensitive ciphertext explicitly: onboarding payloads and
   documents, and `properties.access_instructions_ciphertext`.
4. Delete `room_scan_object_corrections` explicitly by `room_scan_id` — it has
   **no foreign key** to the scan object by design, so no cascade reaches it, and
   it holds descriptions of the inside of somebody's home.
5. Retain the financial and bilateral rows with their foreign keys intact,
   pointing at the tombstoned account.
6. Clear `audit_logs` rows for the subject, except security events retainable
   under Art. 17(3). Note `audit_logs.resource_id` is a plain `text` column with
   **no foreign key**, so rows keyed on the user's id are invisible to any
   cascade and must be removed by an explicit query.

There is an ordering trap worth stating: `landlord_profiles` cascades to
`properties`, but `cleaning_requests.property_id` and `bookings.property_id` are
`NO ACTION`, so deleting a property is itself blocked by any request or booking
against it. That is why migrations 082 and 083 exist — properties are archived,
never deleted.

---

## What the founder has to decide before this ships

1. **Confirm the retention periods above with a solicitor.** The ones here are
   the standard UK positions, not advice.
2. **Decide the tombstone's display name.** A deleted landlord still appears in a
   cleaner's booking history; it has to say something. "Deleted account" is the
   usual answer.
3. **Decide whether a deletion request from an account with an in-flight booking
   is refused or queued.** Erasing mid-job leaves the other party without a
   counterparty.
4. **Register with the ICO** as a data controller if not already (£40–£60/year
   for most small businesses).
5. **Decide on the room scans.** Photographs of the inside of a home can be more
   revealing than the schema suggests, and the retention policy for them should
   be explicit rather than inherited from the booking record.

Until those are settled, the administrator queue added in migration 118 records
the request, its statutory deadline and what was decided, and the erasure itself
is performed by a reviewed operation. That is a defensible position — a request
is tracked and answered within the month — but it is not a finished one, and it
does not scale past low volume.
