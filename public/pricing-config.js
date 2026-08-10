// One owner for every number that decides what a customer pays and what a
// cleaner earns.
//
// WHY THIS FILE EXISTS
//
// Prices were spread across three places that could not be reconciled: the
// scan ruleset in scan-pricing.mjs (admin-editable, time-derived, and always an
// *estimate*), the BOOKING_* environment variables consumed by
// booking-workflow.mjs (deploy-time only), and the per-cleaner service rates in
// the database. Changing "what an extra task costs" meant touching a stored
// ruleset, a deployment and nothing else agreed with either.
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
// The safety that model gives up is bought back in economics.mjs terms: every
// quote carries its own unit economics, and a quote that cannot pay the cleaner,
// the processor and the minimum contribution is refused rather than sold.
//
// CALIBRATION
//
// Nothing here is a round number someone liked. UK market research, August 2026:
//
//   * Domestic cleaning runs £16–£22/hour nationally and £20–£28/hour in London
//     through an agency. Housekeep advertises from £18.50/hour, Wecasa from
//     £17.90/hour. £28/hour is the top of the agency band, which is where a
//     vetted, insured, guaranteed visit sits.
//   * At a 70% cleaner share that is £19.60/hour to the cleaner — above what
//     Housekeep and Wecasa advertise, which is what makes supply reachable.
//     The platform keeps 30% gross, against TaskRabbit's 15% and the ~20% seen
//     elsewhere; the difference is that Homle sets and guarantees the price
//     rather than passing through a rate the cleaner chose.
//   * Room base prices below are minutes × the hourly rate, not opinions. A
//     bathroom costs more than a bedroom because it takes 35 minutes rather
//     than 25, and that ratio is what every cleaning price guide reports.
//   * £3 per additional task is 6.4 minutes at the customer rate — a mirror, a
//     desk, a set of skirting boards. It is deliberately NOT what an oven or a
//     carpet costs; those are premium items below, priced from their own market
//     rates (oven £55–£85, carpet £40–£80/room).
//   * £45 minimum visit matches the floor a travelling cleaner needs to cover
//     getting there, and sits under the £80 a standard 2-bed clean fetches.
//
// Every value is integer pence. No floating-point money anywhere.

export const pricingConfigVersion = 1;

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

/* ── Rooms ───────────────────────────────────────────────────────────────── */

// basePence is minutes × the customer hourly rate, rounded to the nearest 50p.
// baseMinutes is kept beside it because the duration is what a cleaner is
// actually being asked to commit to, and it is what the payout is checked
// against. If an operator raises a base price without raising the minutes, the
// cleaner's effective hourly rate goes UP, which is safe. The reverse is what
// the margin guard exists to catch.
export const defaultRooms = Object.freeze({
  kitchen: Object.freeze({ label: "Kitchen", basePence: 1850, baseMinutes: 40, includedItems: 3 }),
  bathroom: Object.freeze({ label: "Bathroom", basePence: 1650, baseMinutes: 35, includedItems: 3 }),
  "living-room": Object.freeze({ label: "Living room", basePence: 1400, baseMinutes: 30, includedItems: 3 }),
  bedroom: Object.freeze({ label: "Bedroom", basePence: 1150, baseMinutes: 25, includedItems: 3 }),
  office: Object.freeze({ label: "Office", basePence: 1150, baseMinutes: 25, includedItems: 3 }),
  "dining-room": Object.freeze({ label: "Dining room", basePence: 950, baseMinutes: 20, includedItems: 3 }),
  hallway: Object.freeze({ label: "Hallway", basePence: 700, baseMinutes: 15, includedItems: 3 }),
  "utility-room": Object.freeze({ label: "Utility room", basePence: 700, baseMinutes: 15, includedItems: 3 }),
  other: Object.freeze({ label: "Other room", basePence: 1150, baseMinutes: 25, includedItems: 3 })
});

/* ── Premium items ───────────────────────────────────────────────────────── */

// The brief's £3 rule is for ordinary extra tasks. These are not ordinary: each
// is a recognised standalone job with its own market price, and charging £3 for
// an oven would mean paying a cleaner roughly a pound to spend forty minutes on
// it. Priced from UK add-on rates (oven £55–£85, carpet £40–£80 per room,
// interior windows and fridges commonly £25–£45).
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
// same property: a Reading 2-bed quoted standard £80 / deep £280 / EOT £350 is
// typical, and deep-versus-standard lands near 1.7–1.9× once add-ons are taken
// out of the comparison. End of tenancy carries a guarantee and an inventory
// check, which is why it is higher again and has its own floor.
export const defaultServiceTypes = Object.freeze({
  standard: Object.freeze({ label: "Standard clean", multiplierBasisPoints: 10000, minimumPence: 4500 }),
  deep: Object.freeze({ label: "Deep clean", multiplierBasisPoints: 17500, minimumPence: 12000 }),
  "end-of-tenancy": Object.freeze({ label: "End of tenancy", multiplierBasisPoints: 20000, minimumPence: 15000 }),
  "rental-turnover": Object.freeze({ label: "Rental turnover", multiplierBasisPoints: 13000, minimumPence: 8000 }),
  commercial: Object.freeze({ label: "Commercial", multiplierBasisPoints: 12000, minimumPence: 9000 })
});

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

/* ── The whole config ────────────────────────────────────────────────────── */
//
// WHAT IS DELIBERATELY NOT IN THIS FILE
//
// The cleaner's share, the processor's fee and the margin floors are NOT here,
// and must never be added. This module is served to the browser so the scanner
// can price instantly without a round trip — which means everything in it is
// readable by anyone who opens developer tools. What a cleaner is paid and what
// Homle keeps is commercial information; it lives in
// src/marketplace/pricing-economics.mjs, server-side only, and the customer
// price is computed identically on both sides so the two can never disagree.

export const defaultPricingConfig = Object.freeze({
  configId: "default",
  version: pricingConfigVersion,
  currency: "GBP",

  customerHourlyRatePence: 2800,

  // The brief's rule, and the two knobs that drive it.
  includedItemsPerRoom: 3,
  additionalItemPence: 300,
  additionalItemMinutes: 7,

  minimumBookingPence: 4500,

  rooms: defaultRooms,
  premiumItems: defaultPremiumItems,
  addOns: defaultAddOns,
  serviceTypes: defaultServiceTypes,
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

  const rooms = {};
  for (const [code, shipped] of Object.entries(defaultRooms)) {
    const supplied = source.rooms?.[code] ?? {};
    rooms[code] = Object.freeze({
      label: label(supplied.label, shipped.label),
      basePence: pence(supplied.basePence ?? shipped.basePence, 0, 50000, `${shipped.label} base price`),
      baseMinutes: count(supplied.baseMinutes ?? shipped.baseMinutes, 1, 600, `${shipped.label} base minutes`),
      includedItems: count(supplied.includedItems ?? shipped.includedItems ?? source.includedItemsPerRoom ?? defaultPricingConfig.includedItemsPerRoom, 0, 50, `${shipped.label} included items`)
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
    customerHourlyRatePence: pence(source.customerHourlyRatePence ?? defaultPricingConfig.customerHourlyRatePence, 500, 30000, "Customer hourly rate"),
    includedItemsPerRoom: count(source.includedItemsPerRoom ?? defaultPricingConfig.includedItemsPerRoom, 0, 50, "Included items per room"),
    additionalItemPence: pence(source.additionalItemPence ?? defaultPricingConfig.additionalItemPence, 0, 10000, "Additional item price"),
    additionalItemMinutes: count(source.additionalItemMinutes ?? defaultPricingConfig.additionalItemMinutes, 0, 120, "Additional item minutes"),
    minimumBookingPence: pence(source.minimumBookingPence ?? defaultPricingConfig.minimumBookingPence, 0, 100000, "Minimum booking"),
    rooms: Object.freeze(rooms),
    premiumItems: Object.freeze(premiumItems),
    addOns: Object.freeze(addOns),
    serviceTypes: Object.freeze(serviceTypes),
    discounts: Object.freeze({
      multiRoomBasisPoints: Object.freeze(multiRoom),
      recurringBasisPoints: Object.freeze(recurring)
    })
  });
}

/** The room definition to price against, falling back to "other". */
export function roomDefinition(config, roomType) {
  const rooms = config?.rooms ?? defaultRooms;
  const key = String(roomType || "").trim().toLowerCase().replace(/\s+/g, "-");
  return rooms[key] ?? rooms.other ?? defaultRooms.other;
}
