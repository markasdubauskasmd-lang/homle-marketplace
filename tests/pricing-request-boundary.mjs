// What a browser can and cannot talk Homle into charging.
//
// The browser runs the same engine the server does, so the request reaching the
// server is shaped by code the customer controls. Three of its fields are worth
// money, and this file is the assertion that none of them survive the boundary.

import { defaultPricingConfig, normalizedPricingConfig } from "../public/pricing-config.js";
import { quoteRooms } from "../public/pricing-engine.js";
import { trustedPricingRequest } from "../src/marketplace/pricing-request-boundary.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }

const config = normalizedPricingConfig({
  ...defaultPricingConfig,
  promotions: {
    REAL10: { kind: "percentage", value: 1000, maximumDiscountPence: 5000, label: "10% off" },
    EXPIRED: { kind: "percentage", value: 4000, maximumDiscountPence: 100000, expiresAt: "2020-01-01T00:00:00.000Z" }
  }
});
const ordinary = (...labels) => labels.map((label, index) => ({ code: `t${index}-${label}`, label }));
const rooms = [
  { roomType: "kitchen", items: ordinary("Worktops", "Hob", "Sink", "Floor") },
  { roomType: "bathroom", items: ordinary("Toilet", "Shower", "Sink") },
  { roomType: "living-room", items: ordinary("Sofa", "Table", "Floor") },
  { roomType: "bedroom", items: ordinary("Bed", "Wardrobe", "Floor") }
];

const serverNow = new Date("2026-09-01T09:00:00+01:00");
const soon = "2026-09-01T15:00:00+01:00"; // six hours out: same-day band.

/* ── The clock ───────────────────────────────────────────────────────────── */

// A browser claiming it is next week turns a same-day booking into an ordinary
// one and takes 20% off.
{
  const lying = {
    rooms, startAt: soon,
    now: "2026-08-01T09:00:00+01:00"
  };
  const asClaimed = quoteRooms(lying, config);
  const asPriced = quoteRooms(trustedPricingRequest(lying, { config, now: serverNow }), config);
  assert(asClaimed.urgencyPence === 0, "The fixture does not actually exercise the clock; the claimed time already charged urgency.");
  assert(asPriced.urgencyPence > 0, "A browser's clock was believed, so a same-day booking escaped the urgency charge.");
  assert(asPriced.totalPence > asClaimed.totalPence, "Replacing the clock did not change what is charged.");
  assert(asPriced.urgencyCode === "same-day", `The server clock did not select the same-day band: ${asPriced.urgencyCode}`);
}

// And a browser omitting the clock entirely must not escape it either.
{
  const trusted = trustedPricingRequest({ rooms, startAt: soon }, { config, now: serverNow });
  assert(quoteRooms(trusted, config).urgencyPence > 0, "A request with no clock at all escaped the urgency charge.");
}

/* ── The promotion ───────────────────────────────────────────────────────── */

// An invented promotion is not honoured, whatever it claims about itself.
{
  const forged = {
    rooms,
    promotion: { code: "FREEBIE", kind: "percentage", value: 9900, maximumDiscountPence: 100000, label: "Nice try" }
  };
  assert(quoteRooms(forged, config).promotionDiscountPence < 0,
    "The fixture does not exercise the boundary; the engine already refused this promotion on its own.");
  const trusted = trustedPricingRequest(forged, { config, now: serverNow });
  assert(quoteRooms(trusted, config).promotionDiscountPence === 0,
    "A promotion the browser invented was honoured.");
}

// A real code attached by the browser is re-resolved rather than believed: the
// browser's terms are discarded and the price list's terms apply.
{
  const inflated = {
    rooms,
    promotionCode: "REAL10",
    promotion: { code: "REAL10", kind: "percentage", value: 9000, maximumDiscountPence: 100000, label: "10% off" }
  };
  const trusted = trustedPricingRequest(inflated, { config, now: serverNow });
  const quote = quoteRooms(trusted, config);
  assert(quote.promotionCode === "REAL10", "A real code did not resolve at the boundary.");
  const honest = quoteRooms(trustedPricingRequest({ rooms, promotionCode: "REAL10" }, { config, now: serverNow }), config);
  assert(quote.promotionDiscountPence === honest.promotionDiscountPence,
    "A browser rewrote a real promotion's terms and the rewrite was honoured.");
  assert(quote.totalPence < quoteRooms({ rooms }, config).totalPence, "A valid code produced no discount at all.");
}

// An expired code is not resurrected by attaching it.
{
  const trusted = trustedPricingRequest({ rooms, promotionCode: "EXPIRED" }, { config, now: serverNow });
  assert(quoteRooms(trusted, config).promotionDiscountPence === 0, "An expired promotion was honoured.");
}

// First-booking codes respect the count the SERVER holds, not the browser.
{
  const firstOnly = normalizedPricingConfig({
    ...defaultPricingConfig,
    promotions: { WELCOME: { kind: "fixed", value: 1000, maximumDiscountPence: 1000, firstBookingOnly: true } }
  });
  const returning = trustedPricingRequest({ rooms, promotionCode: "WELCOME" }, { config: firstOnly, now: serverNow, previousBookingCount: 4 });
  const brandNew = trustedPricingRequest({ rooms, promotionCode: "WELCOME" }, { config: firstOnly, now: serverNow, previousBookingCount: 0 });
  assert(quoteRooms(returning, firstOnly).promotionDiscountPence === 0, "A returning customer redeemed a first-booking code.");
  assert(quoteRooms(brandNew, firstOnly).promotionDiscountPence < 0, "A new customer could not redeem a first-booking code.");
}

/* ── The postcode ────────────────────────────────────────────────────────── */

// Claiming a cheap area for a London property is a 15% discount for typing.
// At freeze time the caller supplies the property's own postcode and the
// claim is discarded.
{
  const claiming = { rooms, postcode: "SR1 1AA" };
  const asClaimed = quoteRooms(trustedPricingRequest(claiming, { config, now: serverNow }), config);
  const asFrozen = quoteRooms(trustedPricingRequest(claiming, { config, now: serverNow, postcode: "SW1A 1AA" }), config);
  assert(asClaimed.locationBand === "standard", "The claimed postcode did not select the cheap band, so the fixture proves nothing.");
  assert(asFrozen.locationBand === "london", "The property's real postcode did not override the browser's claim.");
  assert(asFrozen.totalPence > asClaimed.totalPence, "Overriding the postcode did not change what is charged.");
}

/* ── The start time ──────────────────────────────────────────────────────── */

// The unsocial-hours charge belongs to the slot actually being booked.
{
  const claiming = { rooms, startAt: "2026-09-02T10:00:00+01:00" }; // an ordinary Wednesday
  const asFrozen = quoteRooms(trustedPricingRequest(claiming, {
    config, now: serverNow, startAt: "2026-08-30T10:00:00+01:00" // the Sunday actually requested
  }), config);
  assert(asFrozen.scheduleCode === "sunday", "The request's real start time did not override the browser's claim.");
}

/* ── Everything else is scope, and passes through ────────────────────────── */

// The boundary must not quietly change what was ORDERED. A request that lost
// its rooms or its service type at the boundary would be a different booking.
{
  const scope = {
    rooms, serviceType: "deep", frequency: "fortnightly", conditionLevel: 3,
    addOns: [{ code: "ironing", quantity: 2 }]
  };
  const trusted = trustedPricingRequest(scope, { config, now: serverNow });
  const quote = quoteRooms(trusted, config);
  assert(quote.serviceType === "deep" && quote.frequency === "fortnightly" && quote.conditionLevel === 3,
    "The boundary altered the scope of the booking.");
  assert(quote.rooms.length === rooms.length, "The boundary lost rooms.");
  assert(quote.addOnPence === config.addOns.ironing.pence * 2, "The boundary lost an add-on.");
}

// Nonsense in, no crash out. This is the first thing an untrusted body reaches.
for (const hostile of [null, undefined, "a string", 42, [], { rooms: "not an array" }, { promotion: "not an object" }, { now: {} }]) {
  const trusted = trustedPricingRequest(hostile, { config, now: serverNow });
  assert(typeof trusted === "object" && typeof trusted.now === "string",
    `The boundary did not survive a hostile body: ${JSON.stringify(hostile)}`);
  quoteRooms(trusted, config);
}

console.log("Pricing request boundary tests passed: the browser's clock, promotion, claimed area and claimed start time are all replaced before anything is priced, and the scope of the booking passes through untouched.");
