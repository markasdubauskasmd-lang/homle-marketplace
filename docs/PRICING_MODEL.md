# Homle pricing model

Research, decisions and the resulting architecture for dynamic pricing.
Written August 2026.

This document is the reasoning. The numbers themselves live in
`public/pricing-config.js` (customer-facing) and
`src/marketplace/pricing-economics.mjs` (commercial, server-only), and an
operator changes them through `/admin/pricing` without a deployment.

---

## 1. What the audit found

Homle did not lack a pricing engine. It had **three**, running at the same time,
and they could not be reconciled with each other.

| # | System | Where | Drives | Editable by |
|---|--------|-------|--------|-------------|
| 1 | `quoteRooms` | `public/pricing-engine.js` | The price a customer is shown and charged | `/admin/pricing` → `pricing_configurations` |
| 2 | `estimateScanPrice` | `src/marketplace/scan-pricing.mjs` | The scanner's estimate range | `/admin/scan-pricing` → `scan_pricing_rulesets` |
| 3 | `createBookingPricingPolicy` | `src/marketplace/booking-workflow.mjs` | Cost-up quote from the invited cleaner's own rate card | 12 `BOOKING_*` environment variables, deploy-time only |

Systems 1 and 2 each held their own `£28.00/hour` and their own `£45.00`
minimum, on two different admin screens backed by two different tables. Nothing
compared them. An operator raising the rate on one screen moved half the product
and silently left the other half behind.

### The eleven concrete defects

**P1 — Three rate tables.** As above. Two are operator-editable and independently
so.

**P2 — The manual booking path produced no price at all.** In
`public/landlord-journey.js`, the request payload sent
`pricingRequest: state.scanRooms.length ? currentPricingRequest() : null`. A
customer who tapped *Skip scan* reached checkout with no price on screen, saved a
request with `quoted_total_pence = NULL`, and was then priced by system 3 from
whichever cleaner happened to be invited. Two customers with identical jobs paid
different amounts depending on whether they used the camera.

**P3 — Property condition was computed, shown, and then thrown away.**
`cleaning-complexity.mjs` grades every scanned room 1–5 on soiling, clutter,
mould and limescale. That grade reaches the customer's screen and feeds system
2's estimate. System 1 — the one that actually charges — has no condition input
at all. A filthy three-bedroom flat and a spotless one quoted identically.

**P4 — Measured room size was thrown away the same way.** The photo-measurement
feature produces real floor areas. System 2 charges £0.90/m² for them. System 1
ignores them.

**P5 — No location, urgency, or time-of-day pricing anywhere.** Homle covers
every UK postcode area, and charged one flat national rate — priced at the top
of the *London* agency band. See §2.

**P6 — No cancellation fee.** A cancellation was a support ticket. A cleaner who
held a slot and lost it at 7am got nothing.

**P7 — No promotions or discount codes.** No mechanism existed at all.

**P8 — The advertised guide prices were wrong in both directions.** The three
"Recommended for you" cards in `landlord-dashboard.js` were hand-typed strings:

| Card | Advertised | Engine actually charges | Gap |
|------|-----------|------------------------|-----|
| Standard clean | From £68 | £56.00 | 21% too high |
| Deep clean | From £112 | £120.00 | **7% too low** |
| End of tenancy | From £185 | £150.00 | 23% too high |

Advertising *below* the real price is the dangerous one.

**P9 — CI never ran the pricing tests.** `test:pricing` exists and covers the
engine, reconciliation and the platform-priced booking path. `pnpm test` — the
only thing `.github/workflows/ci.yml` runs — does not include it.

**P10 — The scan-review screen showed a stale panel on refusal.** When the engine
refused to price, `renderReviewPrice()` unhid the estimate panel without
populating it.

**P11 — The engine could not price a property description.** It accepts a list of
rooms and nothing else. "Three bed, two bath flat" — the way every competitor
takes a booking — had no path in.

### What was already right, and is kept

Credit where due. The existing design got the hard parts correct and this work
builds on them rather than replacing them:

- **One module, both sides.** `pricing-engine.js` is imported by the browser
  *and* by the server, so the number that animates on screen and the number the
  server authorises come from identical arithmetic.
- **The server is the authority.** `/api/marketplace/pricing/quote` recomputes
  from the active price list. The browser sends scope, never money.
- **Stripe cannot be talked down.** `begin_booking_payment` takes its amount from
  `bookings.customer_price_pence` inside PostgreSQL. No client value reaches the
  card.
- **The breakdown reconciles exactly.** The engine sums its own line items and
  returns `breakdown-mismatch` rather than showing a breakdown that does not add
  up.
- **Margin is checked per quote, not in a monthly report.** `reviewedQuote()`
  refuses a booking that cannot pay the cleaner, the processor and the floor.
- **Commercial figures never reach the browser.** The cleaner's share and the
  margin floors live server-side and are served only to administrators.

---

## 2. Market research

Sources are listed at the end. Figures are August 2026.

**Hourly rates.** The UK national average for domestic cleaning is about
**£19/hour**, with a normal band of £13–£25. London and the South East run
**£22–£28/hour** through an agency; central-London premium agencies exceed £30.
Independent cleaners sit £15–£20 nationally.

**Platform economics.** Wecasa advertises housekeeping from **£17.90/hour** to the
customer and pays cleaners **£12–£13/hour** for regular cleaning and **£15–£16**
for deep cleaning — an effective take rate around **28–33%**. TaskRabbit takes
15% but does not set the price or guarantee the work. Housekeep's own cost guide
puts the national average at £19/hour.

**Minimum booking.** Housekeep enforces a **2.0 hour minimum**, explicitly so
that cleaners can cover their costs. Every serious UK platform sells a minimum
*duration*, not a minimum price.

**End of tenancy.** UK-wide **£180–£420**; London **£220–£500+**. A two-bed
averages about £260 (from ~£140 in normal condition); a three-bed in London
averages £320–£420. End-of-tenancy is sold as a fixed price against a guarantee,
never by the hour.

**Cancellation.** Housekeep allows free cancellation until midday the day before
and then charges tiered fees, in the region of £5 / £10 / £20 as the clean gets
closer. Tiered-by-notice is the market norm; percentage-of-booking is the norm in
adjacent service marketplaces.

**Deep vs standard.** Across UK quote guides the same property quoted standard,
deep and end-of-tenancy lands near **1 : 1.7–1.9 : 2.0** once add-ons are removed
from the comparison.

### The finding that matters most

Homle charged **£28.00/hour everywhere in the UK**. That is the top of the
*London agency* band applied to a platform that lists every postcode area from
Aberdeen to Truro. Against a £19 national average it is **47% above market**
outside the South East.

This is almost certainly the single largest suppressor of conversion in the
product, and no amount of form polish fixes it.

---

## 3. Recommended model

### Architecture

```
Booking selections ─┐
Scanner output ─────┼─→ PricingRequest ─→ quoteRooms() ─→ Quote (lines + total)
Property shape ─────┘                          │
                                               ├─→ reviewedQuote()  → margin floors, server-only
                                               ├─→ cleaning_requests.quoted_total_pence  (frozen)
                                               ├─→ bookings.customer_price_pence / cleaner_pay_pence
                                               └─→ booking_payments.amount_pence (derived in SQL)
```

One function. Three input shapes that all normalise to the same
`PricingRequest`, so the scanner, the manual form and a three-tap property
description cannot disagree.

### The formula

```
per room:
  roomBase      = baseMinutes × hourlyRate        (explicit basePence overrides)
  extraTasks    = max(0, tasks − includedPerRoom) × additionalItemPence
  roomSubtotal  = roomBase + extraTasks
  premiums      = Σ specialist item prices        ← never multiplied, never discounted

labour = Σ roomSubtotal
       × serviceMultiplier        standard 1.00 · deep 1.75 · EOT 2.00 · turnover 1.30 · commercial 1.20
       × conditionMultiplier      L1 0.95 · L2 1.00 · L3 1.15 · L4 1.30 · L5 unpriceable
       × locationMultiplier       London 1.15 · high-cost 1.06 · standard 1.00
       + sizeAdjustment           max(0, measured m² − expected m²) × perSqMetrePence
       + urgencyFee               <24h +20% · 24–48h +10% · else 0
       + unsocialHoursFee         Sun/bank-hol +15% · Sat or before 08:00 / after 18:00 +10%
       − multiRoomDiscount        3 rooms 3% · 4 rooms 5% · 5 rooms 7% · 6+ rooms 9%
       − recurringDiscount        weekly 15% · fortnightly 10% · four-weekly 5%

total  = labour + premiums + addOns
       − promotion                (capped; platform absorbs it, see §4)
       ↑ floor at max(minimumVisitMinutes × hourlyRate × serviceMultiplier, serviceMinimum)
       ± rounding                 to the nearest 50p, emitted as its own line
```

Every step is a named line item, and the lines sum to the total in integer
pence. A combined multiplier above **3.5×** returns *unpriceable* rather than
clamping — that is a configuration error, not a quote.

### Base prices

| | Recommended | Today | Why |
|---|---|---|---|
| Customer hourly rate | **£24.00** | £28.00 | The national standard. London reaches £27.60 via the multiplier — within 1.5% of today, so London is effectively unchanged. Everywhere else falls ~14% to land at the top of its local band rather than 47% above it. |
| Included tasks per room | 3 | 3 | Unchanged. |
| Additional task | £3.00 | £3.00 | 7.5 minutes at the base rate. Unchanged. |

Room bases now **derive** from `baseMinutes × hourlyRate` unless an operator sets
an explicit override, so a rate change moves every room with it. That closes the
drift the old file warned about in its own comments.

| Room | Minutes | At £24/hour |
|---|---|---|
| Kitchen | 40 | £16.00 |
| Bathroom | 35 | £14.00 |
| Living room | 30 | £12.00 |
| Bedroom / office | 25 | £10.00 |
| Dining room | 20 | £8.00 |
| Hallway / utility | 15 | £6.00 |

### Minimum booking value

**Two hours, expressed in minutes, not a cash floor** — matching Housekeep and
every UK agency. The constraint is real: a cleaner gives up a travel slot for the
visit whatever it contains. In minutes it also stays correct when the rate moves;
a cash floor silently becomes 1.6 hours the first time the rate rises.

At £24/hour that is **£48** standard, **£84** deep, **£96** end-of-tenancy, before
the per-service cash floors below take over.

Per-service floors, from the market data in §2: standard £45, deep £120,
end-of-tenancy £150, rental turnover £80, commercial £90.

### Cleaner payout and platform margin

**Keep 70 / 30.** Evidence: Wecasa's effective take is 28–33%; TaskRabbit's 15%
buys a lead, not a guaranteed price. Homle sets the price, guarantees the work
and carries the refund risk, which is a 30% product.

At £24/hour that pays a cleaner **£16.80/hour** nationally and **£19.32** in
London — well above Wecasa's £12–13 and above the £15.00/hour floor the code
already enforces. Supply stays reachable.

After Stripe (1.5% + 20p) a typical booking nets about **28%**. The refusal floor
stays at 20%, so a discount or an operator edit has somewhere to move before a
booking stops being worth taking.

### Add-on pricing

Specialist items keep their own market rates and are **never** multiplied by the
service or condition multiplier and never discounted — an oven does not get
dirtier because the booking is a deep clean, and the work in it does not shrink
because you booked four of them.

| Item | Price | Minutes | Market |
|---|---|---|---|
| Oven deep clean | £55 | 45 | £55–85 |
| Carpet (per room) | £45 | 30 | £40–80 |
| Upholstery (per item) | £35 | 25 | £30–50 |
| Mould treatment | £30 | 25 | — |
| Fridge / freezer | £25 | 20 | £25–45 |
| Interior windows | £22 | 18 | £25–45 |
| Inside cupboards | £20 | 18 | — |
| Balcony / patio | £25 | 20 | — |
| Heavy limescale | £20 | 15 | — |

Whole-visit add-ons: ironing £24/hour, laundry £12/load, bed linen £8, eco
products £4, key collection £8.

### How each factor affects price

**Room size.** Only where genuinely measured, and only **above** the room type's
expected area. The base price already pays for a typical room; charging
£0.90/m² from zero double-charges it. An unmeasured room contributes no size
adjustment at all rather than an assumed one.

**Number of rooms.** Each room carries its own base plus its extra tasks, then a
multi-room discount from 3 rooms up (3/5/7/9%). The cleaner is already there and
setup is paid once — a five-room booking must not read as five one-room
bookings shouted together.

**Number of tasks.** First three per room are what the base pays for; each one
after is £3.00 and 7.5 minutes. Named individually in the breakdown, so "why is
this £3 more" always has an answer on screen.

**Location — yes.** Three bands by postcode area, defaulting to 1.00 for anything
unrecognised (fails cheap and safe, never expensive). This is the correction for
the finding in §2.

**Time and day — yes, modestly.** +10% Saturday or outside 08:00–18:00, +15%
Sunday and bank holidays. 70% of it flows to the cleaner, which is what makes
those slots fillable at all.

**Urgency — yes.** +10% inside 48 hours, +20% inside 24. A last-minute booking
must be filled from a cleaner's remaining free slot; the premium both rations the
demand and funds the payout that gets it accepted.

**Condition — yes, and this is the biggest accuracy win.** The scanner already
grades it. Levels 1–4 map to 0.95 / 1.00 / 1.15 / 1.30; level 5 stays
unpriceable and goes to a human, exactly as it does today. For manual bookings
the customer answers **one** question, and only on deep and end-of-tenancy where
it materially moves the price.

**Surge — no.** Not recommended, and deliberately not built. Homle's promise is a
firm price the customer can trust; demand-responsive pricing on top of that reads
as opportunism in a home-services context and there is no evidence UK cleaning
customers tolerate it. Urgency and unsocial-hours pricing already capture the
genuine scarcity, and they are *predictable* — the customer can see why. If
supply pressure needs a lever later, raise the location band for that area rather
than surging individuals.

### Cancellation fees

| Notice | Customer pays | Cleaner receives |
|---|---|---|
| More than 48 hours | £0 | £0 |
| 24–48 hours | 25% of total, capped £25 | 70% of the fee |
| Under 24 hours | 50% of total, capped £50 | 70% of the fee |
| No access on arrival | 100% of the 2-hour minimum | 70% of the fee |

The cleaner share on cancellations is the point of the policy. A fee that only
the platform collects does not compensate the person who lost the slot, and
supply notices.

### Discounts and bundles

- **Recurring**: weekly 15%, fortnightly 10%, four-weekly 5%. A fortnightly
  customer is worth several one-offs and every UK platform discounts them.
- **Multi-room**: 3/5/7/9% from three rooms up.
- **Promotional codes**: percentage or fixed, with a maximum discount, a minimum
  spend, an expiry and a first-booking-only flag. One code per booking — codes
  never stack, and no discount can take a booking below the minimum floor.

Discounts apply to labour only, never to specialist items or add-ons.

### Rounding and display

All arithmetic is integer pence; there is no floating-point money anywhere. Every
division is rounded exactly once, at the point it becomes a line item, and
nothing is re-derived from an already-rounded number.

The **final total rounds to the nearest 50p**, emitted as its own `rounding`
line so the breakdown still sums exactly. Whole pounds display as `£45`, not
`£45.00`.

No charm pricing (£49.99). For a trust-led service where a stranger is given a
key, round numbers read as honest and £X9.99 reads as a tactic.

---

## 4. Why this is better than the current system

1. **One engine instead of three.** The scanner, the manual form and the quick
   property quote normalise into one `PricingRequest` and one `quoteRooms()`.
   There is no second rate table left to drift.
2. **It prices what the job actually costs.** Condition and measured size were
   already being captured, shown to the customer, and then discarded by the
   thing that charges. A heavily soiled property now costs more than a clean one,
   which protects against exactly the underpriced jobs cleaners refuse.
3. **It is competitive where it was not.** The regional correction takes Homle
   from 47% above the national average to the top of each local band, while
   leaving London where it is.
4. **Nobody can reach checkout without a price.** The manual path prices like
   every other path.
5. **Promotions cost the platform, not the cleaner.** Payout is computed on the
   pre-promotion total. A growth decision must not quietly become a pay cut —
   that is how a marketplace loses supply while congratulating itself on CAC.
6. **Every number is one config edit.** Base rate, room minutes, task price,
   add-on price, every multiplier, the payout share, the margin floors and the
   promo codes are all operator-editable without a deployment.
7. **It refuses rather than guessing.** Unpriceable configurations, unpriceable
   conditions and margin-floor failures return a reason and a human, not a
   number nobody chose.

---

## Sources

- [Checkatrade — House cleaning costs UK 2026](https://www.checkatrade.com/blog/cost-guides/house-cleaning-cost/)
- [Housekeep — How much does a cleaner cost?](https://housekeep.com/cost-guide/cleaner/regular-cleaner/)
- [Housekeep Support — What is the minimum clean time?](https://housekeep.zendesk.com/hc/en-gb/articles/115000899912-What-is-the-minimum-clean-time)
- [Housekeep Support — What are the fees for cancelling jobs?](https://housekeep.zendesk.com/hc/en-gb/articles/4404791652369-What-are-the-fees-for-cancelling-jobs)
- [Wecasa — How much would I get paid as a cleaner?](https://help.wecasa.co.uk/en/articles/10539670-how-much-would-i-get-paid-as-a-cleaner-at-wecasa)
- [Wecasa — Housekeeping from £17.90/h](https://www.wecasa.co.uk/domestic-cleaning/cat/housekeeping)
- [TidySpaces — UK cleaner cost per hour 2026](https://tidyspaces.uk/cleaner-cost-per-hour-uk)
- [MyJobQuote — End of tenancy cleaning costs](https://www.myjobquote.co.uk/costs/end-of-tenancy-cleaning-costs)
- [Checkatrade — End of tenancy cleaning prices](https://www.checkatrade.com/blog/cost-guides/end-of-tenancy-cleaning-prices/)
- [St Anne's Housekeeping — London cleaning price index 2026](https://stanneshousekeeping.com/blog/london-cleaning-price-index-2026)
- [Fantastic Services — Regular cleaning cost guide](https://www.fantasticservices.com/cost-guides/cleaning/regular-cleaning/)

---

# Implementation report

What was built, what changed, and what is deliberately still open.

## 1. Files changed

**The engine and its configuration**

| File | Change |
|---|---|
| `public/pricing-config.js` | Rewritten. Base rate £28 → £24 national; room bases derived from minutes; condition levels, location bands, urgency bands, schedule surcharges, bank holidays, cancellation bands, property shapes, promotions, per-m² rate, rounding increment and multiplier ceiling added. `publicPricingConfig()`, `locationBandFor()`, `postcodeArea()`, `roomsFromPropertyShape()`, `resolvePromotion()` added. |
| `public/pricing-engine.js` | Condition, location, size, urgency, schedule, promotion, rounding line and multiplier ceiling added to `quoteRooms`. Accepts a property shape in place of a room list. `quoteInputFromScan` carries the scan's condition grade and measurements. |
| `src/marketplace/pricing-economics.mjs` | `quoteEconomics` takes a payout basis so a promotion cannot reduce cleaner pay. Platform revenue is left signed. Cancellation cleaner share added. |
| `src/marketplace/pricing-request-boundary.mjs` | **New.** Replaces the browser's clock, promotion, claimed postcode and claimed start time before anything is priced. |
| `public/cancellation-policy.js` | **New.** Tiered cancellation fees, the published policy table, and the cleaner/platform split. |

**Retiring the duplicates**

| File | Change |
|---|---|
| `src/marketplace/scan-pricing.mjs` | No longer a pricing system. Delegates every figure to `quoteRooms`; keeps only the range that expresses scan uncertainty. Rate fields retained but dead so stored rulesets keep loading. |
| `src/marketplace/scan-service.mjs` | Reads the operator's live price list; resolves add-ons against it instead of the scan-only catalogue; passes service, area and requested time into the estimate. |
| `src/marketplace/booking-workflow.mjs` | Cost-up path marked legacy with the query that says when it can be deleted. It is no longer a hard requirement — a platform-priced request books without the twelve `BOOKING_*` variables. |

**Surfaces**

| File | Change |
|---|---|
| `public/landlord-journey.js` / `.html` | Manual path now prices. Live total on the checklist step, total and breakdown at checkout, refusal no longer shows a stale panel. |
| `public/landlord-dashboard.js` | Guide prices derived from the engine instead of three hand-typed strings. |
| `public/admin-pricing.js` / `.html` | Condition, location, urgency, unsocial hours, cancellation, per-m², rounding and ceiling fields. Saving no longer resets the configuration to shipped defaults. |
| `src/marketplace/marketplace-http.mjs` | Quote endpoint applies the trust boundary; config endpoint strips promotions; new promotion-redemption endpoint. |
| `src/marketplace/cleaning-request-service.mjs`, `runtime.mjs` | The freeze prices against the property's real postcode and the request's real start time. |
| `public/landlord-journey-v2.css` | Styling for the new totals. Scoped here, not in `styles.css`, which is frozen by `tests/cleaner-dashboard-freeze.mjs`. |

## 2. Database changes

**None.** No migration was needed:

- `pricing_configurations.config` is JSONB, so every new field stores without a schema change. The denormalised CHECK columns (`customer_hourly_rate_pence`, `additional_item_pence`, `included_items_per_room`, `minimum_booking_minutes`, `cleaner_share_basis_points`) all still hold.
- `cleaning_requests.quoted_total_pence` / `quoted_minutes` / `pricing_config_version` (migration 095) already carried the frozen quote.
- `bookings.customer_price_pence` / `cleaner_pay_pence` and the payment ledger were already correct.

Two tables are now **dead but not dropped**: the rate columns inside `scan_pricing_rulesets`, and `scan_pricing_addons`. Dropping them is a separate, reversible migration and is listed under remaining work.

## 3. Payment changes

None to the payment path itself, because it was already right: `tideway_private.begin_booking_payment` takes its amount from `bookings.customer_price_pence` inside PostgreSQL, so no client-supplied figure has ever reached Stripe. `tests/pricing-lifecycle.mjs` now asserts that structurally, so a future change that starts accepting a caller amount fails CI.

What changed is *upstream* of it: the number written to `bookings.customer_price_pence` is now computed from data the server owns rather than from four fields the browser could choose.

## 4. Tests

| File | Covers |
|---|---|
| `tests/pricing-dynamics.mjs` | **New**, ~400 lines. Condition ordering and the unpriceable level 5; location bands and the cheap-side default; size charged only above expectation; urgency bands; Saturday, Sunday, bank holiday and out-of-hours in London time; promotions including caps, minimum spend, expiry, first-booking, four forgeries and one Homle cannot afford; 50p rounding; the multiplier ceiling; the property-shape adaptor; cancellation tiers and the split; and the brief's edge cases — £0, empty, negative, duplicate add-ons, unknown add-ons, going backwards, changing service mid-flow, very small and 30-room properties. |
| `tests/pricing-request-boundary.mjs` | **New.** Every field a browser could profit from claiming, asserted replaced. |
| `tests/pricing-lifecycle.mjs` | **New.** One booking from form to both dashboards; the summary adds up; the server re-derives the same figure; the split accounts for the whole; Stripe's amount comes from SQL. |
| `tests/pricing-engine.mjs`, `pricing-reconciliation.mjs` | Baselines now **derived** from the price list, so a rate change no longer fails a test that was never wrong. |
| `tests/landlord-guide-prices.mjs` | Rewritten: asserts the cards declare a basket rather than a price, and that a guide price can never sit below the real one. |
| `tests/scan-pricing.mjs` | Asserts editing a retired scan rate changes nothing, and that the estimate equals the engine for the same rooms. |
| `tests/scan-service.mjs` | Add-ons priced from the price list; the live config is consulted; an unreadable config still quotes. |
| `tests/booking-workflow.mjs` | A platform-priced request books without the cost-up policy. |

`test:pricing` existed and CI never ran it. It runs inside `pnpm test` now.

**Result: 158 suites, 154 pass.** The four failures — `browser-landing-motion`, `browser-mobile-entry`, `data-relocation`, `landlord-computed-styles` — fail identically on an unmodified tree in this container and are environmental (a browser version against a committed style baseline, and a missing database). `landlord-computed-styles` was deliberately **not** regenerated: `--update` would bake this container's rendering into a baseline that guards everyone else.

## 5. Old pricing logic removed

- **The scan rate table** — hourly rate, per-room charge, condition multipliers, square-metre rate and minimum charge — no longer prices anything.
- **The scan add-on catalogue** no longer prices anything.
- **The cost-up policy** is no longer required to book and is marked for deletion.
- **Three hand-typed guide prices** are gone.
- **`landlord-journey.js`'s `guideRange()`** is now only a fallback for a checklist with no priceable rooms; the real number comes from the engine.

## 6. Remaining risks

Everything below the line in the first draft of this report has since been
closed except where noted. What remains:

1. **The regional price cut is a commercial decision, not a technical one.**
   Outside London and the South East, prices fall about 14%. That is the
   recommendation and the reasoning is in §2, but it is revenue. To revert: set
   all three `locationBands` multipliers to `10000` and
   `customerHourlyRatePence` back to `2800`, in the admin screen, no
   deployment.
2. **The cleaner never sees why they are paid what they are paid.** Every
   surface that shows a cleaner money — `cleaner-dashboard`, `cleaner-job`,
   `cleaner-schedule`, `cleaner-payouts`, `cleaner-jobs-map` and `active-job` —
   is inside the byte-for-byte freeze in `tests/cleaner-dashboard-freeze.mjs`,
   which says in terms: *do not refresh this digest unless the user explicitly
   replaces the no-change objective.* Building the breakdown means lifting that
   objective first, which is not a decision this work can make.
3. **Cancellation fees are computed and disclosed but not collected.** A
   booking's payment is only authorised within five days of the visit, so most
   cancellations happen when there is no hold on a card to capture against.
   Charging those needs a payment-method-on-file decision this product has not
   taken.
4. **The location bands are a judgement.** Twenty-nine postcode areas are in the
   high-cost band on general knowledge of UK regional pricing, not on Homle's
   own conversion data. Revisit once there is any.
5. **Two tables are dead but not dropped** — the rate columns in
   `scan_pricing_rulesets`, and `scan_pricing_addons`. Dropping them is
   destructive and the retirement has not been live for a day yet.
6. **The cost-up path still exists** for `cleaning_requests` written before the
   quote was frozen up front. The query that says when it can go is in
   `booking-workflow.mjs`.
7. **Bank holidays now run to 26 December 2029**, and the admin screen warns a
   year before that runs out. It still has to be extended by a person.

## 7. What was closed after the first report

| Gap | How |
|---|---|
| A published price list would have kept its old room prices and gained a 15% London rise | `upgradeStoredPricingConfig()` brings version 1 forward on read: room bases re-derive, and the hourly rate is re-expressed so the dearest band lands back on the old flat rate. Nobody's price goes up. |
| Saving through the admin form would have frozen every derived room price | `publishablePricingConfig()` drops a base price that matches its own minutes, keeps one that does not. |
| Cancellation policy called by nothing | A compute-only quote endpoint; the fee shown to the customer before they ask; the terms rendered on the confirm step; the fee and the cleaner's share shown to the operator reviewing it. |
| No three-tap quote | Property type, bedrooms and bathrooms on the checklist step, expanding to the same room list the engine already prices. Seeded checklist lines are asserted to survive the server's own quality gate. |
| Promotions could only be added through the API | An admin editor covering every term the engine honours, and a code box at checkout. The code list still never reaches a browser. |
| Bank holidays ran out end of 2027 | Extended to 2029, with a warning in the admin screen a year before it lapses. |

## 8. Further improvements worth making

1. **Price against real conversion data.** Everything here is calibrated to
   market rates. Within a few hundred bookings the platform will know its own
   price elasticity per band, which beats any external guide.
2. **Show the cleaner what they earn and why** — blocked on the freeze above.
   Supply trusts a platform whose maths it can read.
3. **Collect cancellation fees**, once there is a payment method on file.
4. **Drop the dead tables** and **delete the cost-up path** once each has been
   quiet long enough to be sure.
5. **A/B the multi-room and recurring discounts.** Both are set from market
   convention and are the two cheapest levers to test.
6. **Watch the effective cleaner hourly rate per band.** The floor refuses a bad
   booking one at a time; a report would show a band drifting toward it before
   jobs start going unaccepted.
