// One owner for every number that decides what a customer pays and what a
// cleaner earns.
//
// WHY THIS FILE EXISTS
//
// Prices were spread across three systems that could not be reconciled: the
// scan ruleset in scan-pricing.mjs (admin-editable, time-derived, and always an
// *estimate*), the BOOKING_* environment variables consumed by
// booking-workflow.mjs (deploy-time only), and this price list. Two of them
// held their own hourly rate and their own minimum charge, on two different
// admin screens backed by two different tables, and nothing compared them.
//
// Everything below is one object. An operator changes the additional-item price
// from £3.00 to £3.50 in exactly one place, and every quote, every breakdown and
// every margin calculation moves with it.
//
// THE MODEL, AND WHY IT IS THIS ONE
//
// Homle prices the job, not the hour. The customer scans, sees a firm number,
// and books — so the number has to be computable before any cleaner is
// involved. That is the opposite of the cost-up quote in booking-workflow.mjs,
// which derives the customer price from whichever cleaner is being invited.
// Both models are legitimate; they cannot both be the authority. This one is,
// because "Scan → See price → Book" is not possible under the other.
//
// The safety that model gives up is bought back in pricing-economics.mjs terms:
// every quote carries its own unit economics, and a quote that cannot pay the
// cleaner, the processor and the minimum contribution is refused rather than
// sold.
//
// CALIBRATION
//
// Nothing here is a round number someone liked. The research and its sources are
// in docs/PRICING_MODEL.md. In summary, UK market, August 2026:
//
//   * Domestic cleaning averages about £19/hour nationally, in a £13–£25 band,
//     and £22–£28/hour in London and the South East through an agency.
//   * £24.00/hour is the NATIONAL base here, not a London rate. London reaches
//     £27.60 through the location band below. The previous flat £28 everywhere
//     was the top of the London agency band applied to a platform that lists
//     every UK postcode area — 47% above market outside the South East, and the
//     single largest suppressor of conversion in the product.
//   * At a 70% cleaner share that is £16.80/hour nationally and £19.32 in
//     London, against the £12–£13/hour Wecasa pays its cleaners for regular
//     work. Supply stays reachable.
//   * Room base prices are minutes × the hourly rate, DERIVED rather than
//     stored, so a rate change moves every room with it. A bathroom costs more
//     than a bedroom because it takes 35 minutes rather than 25, and that ratio
//     is what every UK cleaning price guide reports.
//   * £3 per additional task is 7.5 minutes at the customer rate — a mirror, a
//     desk, a set of skirting boards. It is deliberately NOT what an oven or a
//     carpet costs; those are premium items below, priced from their own market
//     rates (oven £55–£85, carpet £40–£80/room).
//   * The minimum visit is TWO HOURS, not a cash floor. Housekeep enforces
//     exactly two hours and says why: so cleaners can cover their costs. Every
//     UK agency sells a minimum duration rather than a minimum price, because
//     the constraint is real — a cleaner gives up a travel slot for the visit
//     whatever it contains. Expressed in minutes it also stays correct when the
//     hourly rate moves; a cash floor silently becomes 1.6 hours the first time
//     the rate rises.
//
// Every value is integer pence. No floating-point money anywhere.

export const pricingConfigVersion = 2;

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function pence(value, minimum, maximum, label) {
  const supplied = Number(value);
  if (!Number.isInteger(supplied) || supplied < minimum || supplied > maximum) {
    throw new TypeError(`${label} must be a whole number of pence between ${minimum} and ${maximum}.`);
  }
  return supplied;
}

function count(value, minimum, maximum, label) {
  const supplied = Number(value);
  if (!Number.isInteger(supplied) || supplied < minimum || supplied > maximum) {
    throw new TypeError(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return supplied;
}

function label(value, fallback, maximumLength = 60) {
  const supplied = String(value ?? "").trim();
  return (supplied || fallback).slice(0, maximumLength);
}

/** A postcode area is the leading letters: "SW1A 1AA" → "SW", "E17" → "E". */
export function postcodeArea(value) {
  const match = /^([A-Z]{1,2})[0-9]/.exec(String(value || "").trim().toUpperCase());
  return match ? match[1] : "";
}

/* ── Rooms ───────────────────────────────────────────────────────────────── */

// `baseMinutes` is the number that matters: it is what a cleaner is actually
// being asked to commit to, it is what the payout is checked against, and the
// base PRICE is derived from it at normalisation time. An operator who wants a
// room to cost something other than its minutes can still set an explicit
// `basePence`, and stored configurations from before this change carry one — but
// nothing ships with an override, so the whole price list tracks the hourly
// rate by default.
//
// `expectedSquareMetres` is what the base price already assumes it is paying
// for. Measured area is charged only ABOVE this, because charging per square
// metre from zero double-charges a room the base already covers.
export const defaultRooms = Object.freeze({
  kitchen: Object.freeze({ label: "Kitchen", baseMinutes: 40, includedItems: 3, expectedSquareMetres: 12 }),
  bathroom: Object.freeze({ label: "Bathroom", baseMinutes: 35, includedItems: 3, expectedSquareMetres: 6 }),
  "living-room": Object.freeze({ label: "Living room", baseMinutes: 30, includedItems: 3, expectedSquareMetres: 20 }),
  bedroom: Object.freeze({ label: "Bedroom", baseMinutes: 25, includedItems: 3, expectedSquareMetres: 14 }),
  office: Object.freeze({ label: "Office", baseMinutes: 25, includedItems: 3, expectedSquareMetres: 10 }),
  "dining-room": Object.freeze({ label: "Dining room", baseMinutes: 20, includedItems: 3, expectedSquareMetres: 14 }),
  hallway: Object.freeze({ label: "Hallway", baseMinutes: 15, includedItems: 3, expectedSquareMetres: 8 }),
  "utility-room": Object.freeze({ label: "Utility room", baseMinutes: 15, includedItems: 3, expectedSquareMetres: 6 }),
  other: Object.freeze({ label: "Other room", baseMinutes: 25, includedItems: 3, expectedSquareMetres: 12 })
});

/* ── Premium items ───────────────────────────────────────────────────────── */

// The £3 rule is for ordinary extra tasks. These are not ordinary: each is a
// recognised standalone job with its own market price, and charging £3 for an
// oven would mean paying a cleaner roughly a pound to spend forty minutes on it.
// Priced from UK add-on rates (oven £55–£85, carpet £40–£80 per room, interior
// windows and fridges commonly £25–£45).
//
// `minutes` is not decoration: it is what keeps the cleaner's effective hourly
// rate honest when a job is mostly premium work.
export const defaultPremiumItems = Object.freeze({
  oven: Object.freeze({ label: "Oven deep clean", pence: 5500, minutes: 45 }),
  fridge: Object.freeze({ label: "Fridge deep clean", pence: 2500, minutes: 20 }),
  freezer: Object.freeze({ label: "Freezer clean", pence: 2500, minutes: 20 }),
  "carpet-room": Object.freeze({ label: "Carpet clean (per room)", pence: 4500, minutes: 30 }),
  "windows-interior": Object.freeze({ label: "Interior windows", pence: 2200, minutes: 18 }),
  "upholstery-item": Object.freeze({ label: "Upholstery (per item)", pence: 3500, minutes: 25 }),
  "mould-treatment": Object.freeze({ label: "Mould treatment", pence: 3000, minutes: 25 }),
  limescale: Object.freeze({ label: "Heavy limescale removal", pence: 2000, minutes: 15 }),
  "cupboards-interior": Object.freeze({ label: "Inside cupboards", pence: 2000, minutes: 18 }),
  "balcony-patio": Object.freeze({ label: "Balcony or patio", pence: 2500, minutes: 20 })
});

/* ── Whole-visit add-ons ─────────────────────────────────────────────────── */

export const defaultAddOns = Object.freeze({
  ironing: Object.freeze({ label: "Ironing (per hour)", pence: 2400, minutes: 60 }),
  "laundry-load": Object.freeze({ label: "Laundry (per load)", pence: 1200, minutes: 15 }),
  "bed-linen": Object.freeze({ label: "Change bed linen", pence: 800, minutes: 10 }),
  "eco-products": Object.freeze({ label: "Eco products only", pence: 400, minutes: 0 }),
  "keys-collection": Object.freeze({ label: "Key collection", pence: 800, minutes: 15 })
});

/* ── Service types ───────────────────────────────────────────────────────── */

// Multipliers on the room subtotal, from the spread the market reports for the
// same property: quoted standard / deep / end-of-tenancy lands near 1 : 1.7–1.9
// : 2.0 once add-ons are taken out of the comparison. End of tenancy carries a
// guarantee and an inventory check, which is why it is higher again and has its
// own floor.
//
// The cash floors come from the market data: a two-bed end-of-tenancy starts
// around £140 and averages £260, so a £150 floor is the bottom of a real
// quote rather than a number that would undercut the guarantee.
export const defaultServiceTypes = Object.freeze({
  standard: Object.freeze({ label: "Standard clean", multiplierBasisPoints: 10000, minimumPence: 4500 }),
  deep: Object.freeze({ label: "Deep clean", multiplierBasisPoints: 17500, minimumPence: 12000 }),
  "end-of-tenancy": Object.freeze({ label: "End of tenancy", multiplierBasisPoints: 20000, minimumPence: 15000 }),
  "rental-turnover": Object.freeze({ label: "Rental turnover", multiplierBasisPoints: 13000, minimumPence: 8000 }),
  commercial: Object.freeze({ label: "Commercial", multiplierBasisPoints: 12000, minimumPence: 9000 })
});

/* ── Property condition ──────────────────────────────────────────────────── */

// The levels are cleaning-complexity.mjs's, unchanged — the scanner already
// grades every room 1–5 on soiling, clutter, mould and limescale, already shows
// that grade to the customer, and until now the result was discarded by the only
// system that charges. A filthy three-bed and a spotless one quoted identically.
//
// Level 5 stays UNPRICEABLE and must remain so. It means "a person needs to look
// at this first", and a multiplier on it would put a price on the one answer
// that is not a price.
//
// Level 2 is the neutral case and the assumption for any booking with no
// assessment, so an unscanned booking is priced exactly as it is today.
// The labels are cleaning-complexity.mjs's `complexityLevels`, word for word.
// Two vocabularies for the same five states is how a customer ends up reading
// "Heavy clean" on the scan result and "Needs extra work" on the price beside
// it and wondering which one they are being charged for.
export const defaultConditionLevels = Object.freeze({
  1: Object.freeze({ label: "Light maintenance clean", multiplierBasisPoints: 9500 }),
  2: Object.freeze({ label: "Standard clean", multiplierBasisPoints: 10000 }),
  3: Object.freeze({ label: "Heavy clean", multiplierBasisPoints: 11500 }),
  4: Object.freeze({ label: "Deep-clean conditions", multiplierBasisPoints: 13000 }),
  5: Object.freeze({ label: "Specialist review required", multiplierBasisPoints: 0 })
});

/* ── Location ────────────────────────────────────────────────────────────── */

// Homle lists every UK postcode area. One national rate priced at the London
// agency band is why a Sunderland customer was quoted 47% above their local
// market.
//
// Three bands, keyed on the postcode AREA (the leading letters). An area nobody
// has classified falls to `standard` at 1.00 — this fails cheap and safe. A
// default of "London" would silently overcharge every unrecognised postcode,
// which is the expensive direction to be wrong in.
export const defaultLocationBands = Object.freeze({
  london: Object.freeze({
    label: "London",
    multiplierBasisPoints: 11500,
    areas: Object.freeze(["E", "EC", "N", "NW", "SE", "SW", "W", "WC"])
  }),
  "high-cost": Object.freeze({
    label: "South East and major cities",
    multiplierBasisPoints: 10600,
    areas: Object.freeze([
      "AL", "BA", "BN", "BR", "BS", "CB", "CM", "CR", "DA", "EN", "GU", "HA", "HP",
      "IG", "KT", "LU", "MK", "OX", "PO", "RG", "RH", "RM", "SG", "SL", "SM", "SO",
      "TW", "UB", "WD"
    ])
  }),
  standard: Object.freeze({ label: "Standard", multiplierBasisPoints: 10000, areas: Object.freeze([]) })
});

export const defaultLocationBandCode = "standard";

/* ── Urgency and unsocial hours ──────────────────────────────────────────── */

// A booking inside 24 hours has to be filled from whatever slot a cleaner has
// left, which is the scarcest thing on the platform. The premium rations the
// demand and — because the cleaner's share is a percentage of the total — funds
// the higher payout that gets it accepted. That flow-through is the point: an
// urgency fee the platform kept would raise the price of the jobs cleaners are
// least willing to take, which is exactly backwards.
//
// Bands are checked longest-notice-first, so the first match wins.
export const defaultUrgencyBands = Object.freeze([
  Object.freeze({ code: "same-day", label: "Within 24 hours", withinHours: 24, surchargeBasisPoints: 2000 }),
  Object.freeze({ code: "next-day", label: "Within 48 hours", withinHours: 48, surchargeBasisPoints: 1000 })
]);

// Saturday and out-of-hours weekdays carry the same logic and the same
// flow-through. Sunday and bank holidays are the hardest slots to fill and are
// priced accordingly.
export const defaultScheduleSurcharges = Object.freeze({
  sunday: Object.freeze({ label: "Sunday or bank holiday", surchargeBasisPoints: 1500 }),
  saturday: Object.freeze({ label: "Saturday", surchargeBasisPoints: 1000 }),
  outsideHours: Object.freeze({ label: "Outside 8am–6pm", surchargeBasisPoints: 1000 })
});

// England and Wales, published dates. Held here rather than computed because
// substitute days are a policy decision rather than an algorithm, and an
// operator can extend the list without a deployment when the next year is
// announced.
export const defaultBankHolidays = Object.freeze([
  "2026-01-01", "2026-04-03", "2026-04-06", "2026-05-04", "2026-05-25", "2026-08-31", "2026-12-25", "2026-12-28",
  "2027-01-01", "2027-03-26", "2027-03-29", "2027-05-03", "2027-05-31", "2027-08-30", "2027-12-27", "2027-12-28",
  "2028-01-03", "2028-04-14", "2028-04-17", "2028-05-01", "2028-05-29", "2028-08-28", "2028-12-25", "2028-12-26",
  "2029-01-01", "2029-03-30", "2029-04-02", "2029-05-07", "2029-05-28", "2029-08-27", "2029-12-25", "2029-12-26"
]);

// A list that runs out does not fail loudly — Sundays keep their surcharge and
// Boxing Day quietly stops having one, which is the kind of thing nobody
// notices until a cleaner is asked to work it at the ordinary rate. This is the
// last date covered, so an operator can be told before it matters.
export const bankHolidayCoverageEndsAt = "2029-12-26";

/* ── Discounts ───────────────────────────────────────────────────────────── */

// A whole-property scan should not price as the sum of its rooms shouted
// together — the cleaner is already there, and setup is paid once. The bands
// below keep a five-room booking from reading as punitive without giving away
// the margin that makes the visit worth taking.
//
// Recurring discounts buy retention: a fortnightly customer is worth several
// one-offs, and every UK platform discounts them. These are applied to the room
// subtotal only, never to premium items or add-ons, because the work in an oven
// does not shrink because you booked four of them.
export const defaultDiscounts = Object.freeze({
  multiRoomBasisPoints: Object.freeze({ 3: 300, 4: 500, 5: 700, 6: 900 }),
  recurringBasisPoints: Object.freeze({
    "one-time": 0,
    weekly: 1500,
    fortnightly: 1000,
    "every-four-weeks": 500
  })
});

/* ── Promotions ──────────────────────────────────────────────────────────── */

// NOT SERVED TO THE BROWSER. See the note at the foot of this file: the public
// config endpoint strips this key. A customer who could read the whole code list
// would never pay full price again.
//
// A promotion is resolved server-side from a code the customer typed, and the
// resolved grant travels back as a single object the browser can total with.
// The authoritative quote re-resolves the code itself and ignores whatever the
// browser claims it was given.
//
// Ships empty. There is no such thing as a sensible default discount.
export const defaultPromotions = Object.freeze({});

/* ── Cancellation ────────────────────────────────────────────────────────── */

// Tiered by notice, which is what the UK market does — Housekeep allows free
// cancellation until midday the day before and charges rising fees after that.
//
// What the CUSTOMER pays is here, because a customer is entitled to read the
// policy before they book. What the CLEANER receives out of it is a commercial
// position and lives in pricing-economics.mjs with the rest of them.
//
// Bands are checked tightest-window-first; the first match wins. Anything with
// more notice than the widest band is free.
export const defaultCancellationBands = Object.freeze([
  Object.freeze({
    code: "no-access", label: "No access on arrival", withinHours: 0,
    // Charged against the minimum visit rather than the booking total: the
    // cleaner travelled and lost the slot, but did not do the work.
    basisPoints: 10000, maximumPence: 100000, chargeMinimumVisitOnly: true
  }),
  Object.freeze({ code: "under-24", label: "Less than 24 hours", withinHours: 24, basisPoints: 5000, maximumPence: 5000, chargeMinimumVisitOnly: false }),
  Object.freeze({ code: "under-48", label: "24 to 48 hours", withinHours: 48, basisPoints: 2500, maximumPence: 2500, chargeMinimumVisitOnly: false })
]);

/* ── Property shapes ─────────────────────────────────────────────────────── */

// The three-tap quote: "two bed, one bath, flat" becomes a room list and goes
// through the same engine as everything else.
//
// This exists because the engine could previously only price an enumerated list
// of rooms, which is not how anybody books a cleaner. It is NOT a second pricing
// model — it is an input adaptor, and the rooms it produces are the same rooms
// the scanner produces.
export const defaultPropertyShapes = Object.freeze({
  flat: Object.freeze({ label: "Flat", alwaysRooms: Object.freeze(["kitchen", "living-room", "hallway"]) }),
  house: Object.freeze({ label: "House", alwaysRooms: Object.freeze(["kitchen", "living-room", "hallway", "hallway"]) }),
  bungalow: Object.freeze({ label: "Bungalow", alwaysRooms: Object.freeze(["kitchen", "living-room", "hallway"]) }),
  studio: Object.freeze({ label: "Studio", alwaysRooms: Object.freeze(["kitchen", "living-room"]) }),
  hmo: Object.freeze({ label: "House share", alwaysRooms: Object.freeze(["kitchen", "living-room", "hallway", "hallway"]) }),
  office: Object.freeze({ label: "Workplace", alwaysRooms: Object.freeze(["kitchen", "hallway"]) })
});

/* ── The whole config ────────────────────────────────────────────────────── */
//
// WHAT IS DELIBERATELY NOT IN THE BROWSER'S COPY
//
// The cleaner's share, the processor's fee and the margin floors are NOT here,
// and must never be added. This module is served to the browser so the scanner
// can price instantly without a round trip — which means everything in it is
// readable by anyone who opens developer tools. What a cleaner is paid and what
// Homle keeps is commercial information; it lives in
// src/marketplace/pricing-economics.mjs, server-side only, and the customer
// price is computed identically on both sides so the two can never disagree.
//
// `promotions` is the one key in this object with the same problem, and
// publicPricingConfig() below is what removes it.

export const defaultPricingConfig = Object.freeze({
  configId: "default",
  version: pricingConfigVersion,
  currency: "GBP",

  customerHourlyRatePence: 2400,

  // The included-tasks rule, and the two knobs that drive it.
  includedItemsPerRoom: 3,
  additionalItemPence: 300,
  additionalItemMinutes: 7,

  // The minimum billable visit. Two hours, in minutes so it tracks the rate.
  minimumBookingMinutes: 120,

  // Charged only on measured area ABOVE a room's expected size.
  perSquareMetrePence: 90,

  // The final total lands on a 50p boundary. Emitted as its own line item so the
  // breakdown still sums exactly — a rounding that hides inside another number
  // is how breakdowns stop reconciling.
  //
  // No charm pricing (£49.99). For a service where a stranger is given a key,
  // round numbers read as honest and £X9.99 reads as a tactic.
  roundingIncrementPence: 50,

  // Multipliers compound: deep × heavy condition × London is already 2.62×.
  // That is a real quote. Six times the base is not — it is a configuration
  // error, and the engine refuses it rather than clamping, because a clamped
  // quote transacts at a number nobody chose.
  maximumCombinedMultiplierBasisPoints: 35000,

  rooms: defaultRooms,
  premiumItems: defaultPremiumItems,
  addOns: defaultAddOns,
  serviceTypes: defaultServiceTypes,
  conditionLevels: defaultConditionLevels,
  locationBands: defaultLocationBands,
  defaultLocationBand: defaultLocationBandCode,
  urgencyBands: defaultUrgencyBands,
  scheduleSurcharges: defaultScheduleSurcharges,
  bankHolidays: defaultBankHolidays,
  cancellationBands: defaultCancellationBands,
  propertyShapes: defaultPropertyShapes,
  promotions: defaultPromotions,
  discounts: defaultDiscounts
});

/* ── Validation ──────────────────────────────────────────────────────────── */

/**
 * Validates an operator-supplied configuration.
 *
 * Deliberately strict, and deliberately refusing rather than clamping. This is
 * the object an administrator edits in a web form, and a typo in it changes what
 * every customer is charged and what every cleaner is paid. A clamped value
 * would quietly transact at a number nobody chose — the failure mode that is
 * hardest to notice and most expensive to unwind.
 */
export function normalizedPricingConfig(input = {}) {
  const source = input && typeof input === "object" ? input : {};

  const customerHourlyRatePence = pence(
    source.customerHourlyRatePence ?? defaultPricingConfig.customerHourlyRatePence,
    500, 30000, "Customer hourly rate"
  );

  const rooms = {};
  for (const [code, shipped] of Object.entries(defaultRooms)) {
    const supplied = source.rooms?.[code] ?? {};
    const baseMinutes = count(supplied.baseMinutes ?? shipped.baseMinutes, 1, 600, `${shipped.label} base minutes`);
    // Derived unless an operator has deliberately overridden it. Configurations
    // stored before this change always carry an explicit basePence, so they keep
    // the prices they were published with.
    const derivedBasePence = Math.round((baseMinutes / 60) * customerHourlyRatePence);
    rooms[code] = Object.freeze({
      label: label(supplied.label, shipped.label),
      basePence: pence(supplied.basePence ?? derivedBasePence, 0, 50000, `${shipped.label} base price`),
      baseMinutes,
      includedItems: count(supplied.includedItems ?? shipped.includedItems ?? source.includedItemsPerRoom ?? defaultPricingConfig.includedItemsPerRoom, 0, 50, `${shipped.label} included items`),
      expectedSquareMetres: count(supplied.expectedSquareMetres ?? shipped.expectedSquareMetres ?? 0, 0, 500, `${shipped.label} expected size`)
    });
  }

  const premiumItems = {};
  for (const [code, shipped] of Object.entries({ ...defaultPremiumItems, ...(source.premiumItems || {}) })) {
    const supplied = source.premiumItems?.[code] ?? shipped;
    premiumItems[code] = Object.freeze({
      label: label(supplied.label, shipped.label ?? code),
      pence: pence(supplied.pence ?? shipped.pence, 0, 100000, `${code} price`),
      minutes: count(supplied.minutes ?? shipped.minutes ?? 0, 0, 600, `${code} minutes`)
    });
  }

  const addOns = {};
  for (const [code, shipped] of Object.entries({ ...defaultAddOns, ...(source.addOns || {}) })) {
    const supplied = source.addOns?.[code] ?? shipped;
    addOns[code] = Object.freeze({
      label: label(supplied.label, shipped.label ?? code),
      pence: pence(supplied.pence ?? shipped.pence, 0, 100000, `${code} price`),
      minutes: count(supplied.minutes ?? shipped.minutes ?? 0, 0, 600, `${code} minutes`)
    });
  }

  const serviceTypes = {};
  for (const [code, shipped] of Object.entries(defaultServiceTypes)) {
    const supplied = source.serviceTypes?.[code] ?? {};
    serviceTypes[code] = Object.freeze({
      label: label(supplied.label, shipped.label),
      multiplierBasisPoints: count(supplied.multiplierBasisPoints ?? shipped.multiplierBasisPoints, 5000, 50000, `${shipped.label} multiplier`),
      minimumPence: pence(supplied.minimumPence ?? shipped.minimumPence, 0, 200000, `${shipped.label} minimum`)
    });
  }

  const conditionLevels = {};
  for (const [level, shipped] of Object.entries(defaultConditionLevels)) {
    const supplied = source.conditionLevels?.[level] ?? {};
    // Level 5 must stay unpriceable. An operator who could set a multiplier on
    // it could put a price on "a person needs to look at this first".
    const multiplierBasisPoints = level === "5"
      ? 0
      : count(supplied.multiplierBasisPoints ?? shipped.multiplierBasisPoints, 5000, 30000, `Condition level ${level} multiplier`);
    conditionLevels[level] = Object.freeze({
      label: label(supplied.label, shipped.label),
      multiplierBasisPoints
    });
  }

  const locationBands = {};
  for (const [code, shipped] of Object.entries({ ...defaultLocationBands, ...(source.locationBands || {}) })) {
    const supplied = source.locationBands?.[code] ?? shipped;
    const areas = Array.isArray(supplied.areas) ? supplied.areas : shipped.areas ?? [];
    locationBands[code] = Object.freeze({
      label: label(supplied.label, shipped.label ?? code),
      multiplierBasisPoints: count(supplied.multiplierBasisPoints ?? shipped.multiplierBasisPoints, 5000, 30000, `${code} location multiplier`),
      areas: Object.freeze([...new Set(areas.map((area) => String(area || "").trim().toUpperCase()).filter((area) => /^[A-Z]{1,2}$/.test(area)))].slice(0, 200))
    });
  }
  const defaultLocationBandChoice = label(source.defaultLocationBand, defaultPricingConfig.defaultLocationBand, 40);
  if (!locationBands[defaultLocationBandChoice]) {
    throw new TypeError("The default location band must name a band that exists.");
  }

  const urgencyBands = (Array.isArray(source.urgencyBands) ? source.urgencyBands : defaultUrgencyBands)
    .slice(0, 10)
    .map((band, index) => Object.freeze({
      code: label(band?.code, `urgency-${index}`, 40),
      label: label(band?.label, "Short notice"),
      withinHours: count(band?.withinHours, 1, 8760, "Urgency notice window"),
      surchargeBasisPoints: count(band?.surchargeBasisPoints, 0, 10000, "Urgency surcharge")
    }))
    // Tightest window first, so the first match is the most urgent one that
    // applies. An operator listing them in any order still gets this behaviour.
    .sort((first, second) => first.withinHours - second.withinHours);

  const scheduleSource = source.scheduleSurcharges ?? {};
  const scheduleSurcharges = {};
  for (const [code, shipped] of Object.entries(defaultScheduleSurcharges)) {
    const supplied = scheduleSource[code] ?? {};
    scheduleSurcharges[code] = Object.freeze({
      label: label(supplied.label, shipped.label),
      surchargeBasisPoints: count(supplied.surchargeBasisPoints ?? shipped.surchargeBasisPoints, 0, 10000, `${code} surcharge`)
    });
  }

  const bankHolidays = Object.freeze([...new Set(
    (Array.isArray(source.bankHolidays) ? source.bankHolidays : defaultBankHolidays)
      .map((day) => String(day || "").trim())
      .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day))
  )].slice(0, 200));

  const cancellationBands = (Array.isArray(source.cancellationBands) ? source.cancellationBands : defaultCancellationBands)
    .slice(0, 10)
    .map((band, index) => Object.freeze({
      code: label(band?.code, `cancellation-${index}`, 40),
      label: label(band?.label, "Late cancellation"),
      withinHours: count(band?.withinHours, 0, 8760, "Cancellation notice window"),
      basisPoints: count(band?.basisPoints, 0, 10000, "Cancellation fee share"),
      maximumPence: pence(band?.maximumPence, 0, 1000000, "Cancellation fee cap"),
      chargeMinimumVisitOnly: band?.chargeMinimumVisitOnly === true
    }))
    .sort((first, second) => first.withinHours - second.withinHours);

  const propertyShapes = {};
  for (const [code, shipped] of Object.entries({ ...defaultPropertyShapes, ...(source.propertyShapes || {}) })) {
    const supplied = source.propertyShapes?.[code] ?? shipped;
    const alwaysRooms = Array.isArray(supplied.alwaysRooms) ? supplied.alwaysRooms : shipped.alwaysRooms ?? [];
    propertyShapes[code] = Object.freeze({
      label: label(supplied.label, shipped.label ?? code),
      alwaysRooms: Object.freeze(alwaysRooms
        .map((room) => String(room || "").trim().toLowerCase())
        .filter((room) => Object.hasOwn(rooms, room))
        .slice(0, 20))
    });
  }

  const promotions = {};
  for (const [rawCode, supplied] of Object.entries(source.promotions || {})) {
    const code = String(rawCode || "").trim().toUpperCase();
    if (!/^[A-Z0-9]{3,24}$/.test(code)) throw new TypeError("A promotion code must be 3 to 24 letters or digits.");
    const kind = String(supplied?.kind || "percentage");
    if (kind !== "percentage" && kind !== "fixed") throw new TypeError(`Promotion ${code} must be a percentage or a fixed amount.`);
    promotions[code] = Object.freeze({
      code,
      label: label(supplied?.label, `${code} discount`),
      kind,
      // A percentage is basis points; a fixed amount is pence. One field, read
      // according to `kind`, so a percentage can never be mistaken for pence.
      value: kind === "percentage"
        ? count(supplied?.value, 1, 5000, `Promotion ${code} percentage`)
        : pence(supplied?.value, 1, 100000, `Promotion ${code} amount`),
      maximumDiscountPence: pence(supplied?.maximumDiscountPence ?? 100000, 1, 100000, `Promotion ${code} cap`),
      minimumSpendPence: pence(supplied?.minimumSpendPence ?? 0, 0, 1000000, `Promotion ${code} minimum spend`),
      firstBookingOnly: supplied?.firstBookingOnly === true,
      expiresAt: supplied?.expiresAt ? String(supplied.expiresAt).slice(0, 40) : ""
    });
  }

  const multiRoom = {};
  for (const [rooms_, shipped] of Object.entries(defaultDiscounts.multiRoomBasisPoints)) {
    const supplied = source.discounts?.multiRoomBasisPoints?.[rooms_] ?? shipped;
    multiRoom[rooms_] = count(supplied, 0, 5000, `${rooms_}-room discount`);
  }
  const recurring = {};
  for (const [frequency, shipped] of Object.entries(defaultDiscounts.recurringBasisPoints)) {
    const supplied = source.discounts?.recurringBasisPoints?.[frequency] ?? shipped;
    recurring[frequency] = count(supplied, 0, 5000, `${frequency} discount`);
  }

  return Object.freeze({
    configId: label(source.configId, defaultPricingConfig.configId, 40),
    version: count(source.version ?? pricingConfigVersion, 1, 10000, "Config version"),
    currency: "GBP",
    customerHourlyRatePence,
    includedItemsPerRoom: count(source.includedItemsPerRoom ?? defaultPricingConfig.includedItemsPerRoom, 0, 50, "Included items per room"),
    additionalItemPence: pence(source.additionalItemPence ?? defaultPricingConfig.additionalItemPence, 0, 10000, "Additional item price"),
    additionalItemMinutes: count(source.additionalItemMinutes ?? defaultPricingConfig.additionalItemMinutes, 0, 120, "Additional item minutes"),
    minimumBookingMinutes: count(source.minimumBookingMinutes ?? defaultPricingConfig.minimumBookingMinutes, 0, 1440, "Minimum booking minutes"),
    perSquareMetrePence: pence(source.perSquareMetrePence ?? defaultPricingConfig.perSquareMetrePence, 0, 2000, "Square-metre rate"),
    roundingIncrementPence: pence(source.roundingIncrementPence ?? defaultPricingConfig.roundingIncrementPence, 1, 500, "Rounding increment"),
    maximumCombinedMultiplierBasisPoints: count(source.maximumCombinedMultiplierBasisPoints ?? defaultPricingConfig.maximumCombinedMultiplierBasisPoints, 10000, 100000, "Maximum combined multiplier"),
    rooms: Object.freeze(rooms),
    premiumItems: Object.freeze(premiumItems),
    addOns: Object.freeze(addOns),
    serviceTypes: Object.freeze(serviceTypes),
    conditionLevels: Object.freeze(conditionLevels),
    locationBands: Object.freeze(locationBands),
    defaultLocationBand: defaultLocationBandChoice,
    urgencyBands: Object.freeze(urgencyBands),
    scheduleSurcharges: Object.freeze(scheduleSurcharges),
    bankHolidays,
    cancellationBands: Object.freeze(cancellationBands),
    propertyShapes: Object.freeze(propertyShapes),
    promotions: Object.freeze(promotions),
    discounts: Object.freeze({
      multiRoomBasisPoints: Object.freeze(multiRoom),
      recurringBasisPoints: Object.freeze(recurring)
    })
  });
}

/**
 * Brings a stored price list forward to the current model.
 *
 * VERSION 1 → 2, AND WHY IT IS NOT A PRICE RISE
 *
 * A version-1 configuration stores an explicit `basePence` on every room. It was
 * never an override — version 1 had no such concept, and those numbers were just
 * how the rate was serialised. Loading them under the current rules would treat
 * them as deliberate, and the room prices would stop tracking the hourly rate
 * for good. So they are dropped and re-derived.
 *
 * The hourly rate is different: whatever an operator published there IS
 * deliberate, and must not be discarded. But version 1 had no location bands, so
 * that rate was charged everywhere — it was, in effect, the DEAREST price the
 * operator was willing to ask. Carrying it across unchanged while the new bands
 * multiply on top would raise every London price by 15%.
 *
 * So it is re-expressed rather than kept: the national base is set so that the
 * dearest band lands back on the old flat rate. The most expensive area pays
 * what it paid before, every other area comes down, and nobody's price goes up.
 * That holds whatever rate the operator had chosen, which blind rescaling to a
 * fixed number would not.
 *
 * Returns the input untouched when it is already current, so this is safe to
 * call on every read.
 */
export function upgradeStoredPricingConfig(stored) {
  if (!stored || typeof stored !== "object") return stored;
  const version = Number(stored.version);
  if (!Number.isInteger(version) || version >= pricingConfigVersion) return stored;

  const bands = stored.locationBands ?? defaultLocationBands;
  const dearestBasisPoints = Math.max(
    10000,
    ...Object.values(bands).map((band) => Number(band?.multiplierBasisPoints) || 10000)
  );
  const publishedRate = Number(stored.customerHourlyRatePence) || defaultPricingConfig.customerHourlyRatePence;
  const nationalRatePence = Math.round(publishedRate * 10000 / dearestBasisPoints);

  const rooms = {};
  for (const [code, room] of Object.entries(stored.rooms ?? {})) {
    // basePence deliberately absent: it re-derives from the minutes below.
    const { basePence, ...rest } = room ?? {};
    rooms[code] = rest;
  }

  return {
    ...stored,
    version: pricingConfigVersion,
    customerHourlyRatePence: nationalRatePence,
    rooms
  };
}

/**
 * A configuration as it should be STORED.
 *
 * normalizedPricingConfig always emits a `basePence` for every room, because
 * every room needs one to be priced with. Writing that back would turn a derived
 * price into a permanent override the first time an operator saved anything at
 * all — the hourly rate would move and the rooms would not follow it.
 *
 * So a base price that matches what its own minutes imply is dropped before
 * storing. An operator who genuinely wants a room priced away from its minutes
 * still gets an override; an operator who only changed the rate keeps a price
 * list that tracks it.
 */
export function publishablePricingConfig(config) {
  const rules = normalizedPricingConfig(config);
  const rooms = {};
  for (const [code, room] of Object.entries(rules.rooms)) {
    const derived = Math.round((room.baseMinutes / 60) * rules.customerHourlyRatePence);
    const { basePence, ...rest } = room;
    rooms[code] = basePence === derived ? rest : room;
  }
  return Object.freeze({ ...rules, rooms: Object.freeze(rooms) });
}

/**
 * The configuration as it is allowed to reach a customer's browser.
 *
 * Identical to the full one except that the promotion list is removed. The
 * scanner needs every rate in order to total instantly without a round trip per
 * tap, and there is nothing to hide in a rate a customer is about to be quoted.
 * A code list is different: it is the one part of the price list whose value
 * depends on not being readable.
 */
export function publicPricingConfig(config) {
  const { promotions, ...visible } = normalizedPricingConfig(config);
  return Object.freeze({ ...visible, promotions: Object.freeze({}) });
}

/** The room definition to price against, falling back to "other". */
export function roomDefinition(config, roomType) {
  const rooms = config?.rooms ?? defaultRooms;
  const key = String(roomType || "").trim().toLowerCase().replace(/\s+/g, "-");
  return rooms[key] ?? rooms.other ?? defaultRooms.other;
}

/**
 * The location band a postcode falls in.
 *
 * An unrecognised area falls to the configured default, which ships as
 * `standard` at 1.00. Failing cheap is deliberate — see the note on
 * defaultLocationBands.
 */
export function locationBandFor(config, postcode) {
  const bands = config?.locationBands ?? defaultLocationBands;
  const area = postcodeArea(postcode);
  if (area) {
    for (const [code, band] of Object.entries(bands)) {
      if (band.areas?.includes(area)) return Object.freeze({ code, ...band });
    }
  }
  const fallbackCode = config?.defaultLocationBand ?? defaultLocationBandCode;
  const fallback = bands[fallbackCode] ?? defaultLocationBands.standard;
  return Object.freeze({ code: fallbackCode, ...fallback });
}

/**
 * Turns "two bed, one bath, flat" into the room list the engine prices.
 *
 * An input adaptor, not a pricing model: the rooms it returns are the same
 * rooms the scanner returns, and they go through the same arithmetic.
 */
export function roomsFromPropertyShape(config, shape = {}) {
  const rules = config?.propertyShapes ? config : normalizedPricingConfig(config);
  // Nothing described means nothing to expand. Returning the shape's standing
  // rooms for an empty object would price a kitchen and a hallway for a caller
  // who simply sent no shape at all.
  if (!shape || typeof shape !== "object" || !Object.keys(shape).length) return [];
  const chosen = rules.propertyShapes[String(shape?.propertyType || "").trim().toLowerCase()]
    ?? rules.propertyShapes.flat;
  const bedrooms = Math.min(Math.max(Number(shape?.bedrooms) || 0, 0), 12);
  const bathrooms = Math.min(Math.max(Number(shape?.bathrooms) || 0, 0), 8);
  const receptions = Math.min(Math.max(Number(shape?.receptionRooms) || 0, 0), 6);

  const rooms = [];
  for (const roomType of chosen.alwaysRooms) {
    rooms.push({ roomType, label: rules.rooms[roomType]?.label ?? roomType, items: [] });
  }
  for (let index = 0; index < bedrooms; index += 1) {
    rooms.push({ roomType: "bedroom", label: bedrooms > 1 ? `Bedroom ${index + 1}` : "Bedroom", items: [] });
  }
  for (let index = 0; index < bathrooms; index += 1) {
    rooms.push({ roomType: "bathroom", label: bathrooms > 1 ? `Bathroom ${index + 1}` : "Bathroom", items: [] });
  }
  // Extra reception rooms beyond the one every shape already includes.
  for (let index = 1; index < receptions; index += 1) {
    rooms.push({ roomType: "living-room", label: `Reception room ${index + 1}`, items: [] });
  }
  return rooms;
}

/**
 * Resolves a customer-typed promotion code against the configured list.
 *
 * Server-side only in practice: the browser never holds the list, so it calls
 * the endpoint that calls this. Returns null for anything that does not apply,
 * with no distinction between "no such code" and "expired" — a caller that
 * reported the difference would turn this into a code oracle.
 */
export function resolvePromotion(config, code, context = {}) {
  const rules = config?.promotions ? config : normalizedPricingConfig(config);
  const wanted = String(code || "").trim().toUpperCase();
  const promotion = rules.promotions[wanted];
  if (!promotion) return null;
  if (promotion.expiresAt) {
    const expiry = Date.parse(promotion.expiresAt);
    const now = context.now instanceof Date ? context.now.getTime() : Date.now();
    if (Number.isFinite(expiry) && expiry <= now) return null;
  }
  if (promotion.firstBookingOnly && context.previousBookingCount > 0) return null;
  return promotion;
}
