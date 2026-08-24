// The dimensions the dynamic-pricing brief added: condition, size, location,
// urgency, unsocial hours, promotions, rounding and the property-shape adaptor.
//
// The invariant every one of these has to respect is the same one the engine
// has always promised — the breakdown sums to the total, exactly, in integer
// pence — so it is asserted again on every scenario below rather than trusted.

import {
  defaultPricingConfig,
  locationBandFor,
  normalizedPricingConfig,
  postcodeArea,
  publicPricingConfig,
  publishablePricingConfig,
  resolvePromotion,
  roomsFromPropertyShape,
  upgradeStoredPricingConfig
} from "../public/pricing-config.js";
import { quoteInputFromScan, quoteRooms } from "../public/pricing-engine.js";
import { cancellationFee, cancellationPolicySummary, cancellationSettlement } from "../public/cancellation-policy.js";
import { defaultPricingEconomics, quoteEconomics, reviewedQuote } from "../src/marketplace/pricing-economics.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }
function throws(operation, expected) {
  try { operation(); } catch (error) { return String(error.message).includes(expected); }
  return false;
}

const config = normalizedPricingConfig(defaultPricingConfig);
const ordinary = (...labels) => labels.map((label, index) => ({ code: `task-${index}-${label}`, label }));

function reconciles(quote) {
  if (!quote.priceable) return false;
  return quote.lines.reduce((total, line) => total + line.pence, 0) === quote.totalPence;
}

/* A basket big enough that the two-hour floor is not what is being measured.
   Every comparison below would read as "no change" if the floor were doing the
   work, which is the easiest way to write a passing test that proves nothing. */
const house = [
  { roomType: "kitchen", items: ordinary("Worktops", "Hob", "Sink", "Floor") },
  { roomType: "bathroom", items: ordinary("Toilet", "Shower", "Sink", "Tiles") },
  { roomType: "living-room", items: ordinary("Sofa", "Table", "Floor") },
  { roomType: "bedroom", items: ordinary("Bed", "Wardrobe", "Floor") },
  { roomType: "bedroom", items: ordinary("Bed", "Wardrobe", "Floor") }
];
const baseline = quoteRooms({ rooms: house }, config);
assert(baseline.priceable && baseline.minimumAdjustmentPence === 0,
  "The comparison basket is being held up by the minimum visit, so nothing below would be measuring what it claims.");

/* ── Condition ────────────────────────────────────────────────────────────── */

const conditions = [1, 2, 3, 4].map((level) => quoteRooms({ rooms: house, conditionLevel: level }, config));
for (const quote of conditions) assert(reconciles(quote), "A condition-adjusted breakdown does not sum to its total.");
assert(conditions[0].totalPence < conditions[1].totalPence, "A well-kept property is not cheaper than a normal one.");
assert(conditions[1].totalPence < conditions[2].totalPence, "A property needing extra work is not dearer than a normal one.");
assert(conditions[2].totalPence < conditions[3].totalPence, "A heavy clean is not dearer than one needing extra work.");
// Level 2 is the neutral case, so a booking that was never assessed is priced
// exactly as it was before condition existed.
assert(conditions[1].totalPence === baseline.totalPence, "An unassessed booking is not priced as normal condition.");
assert(conditions[1].lines.every((line) => line.code !== "condition"), "Normal condition produced a zero adjustment line.");
const heavy = conditions[3].lines.find((line) => line.code === "condition");
assert(heavy && heavy.pence > 0 && heavy.label.includes("30%"), "The heavy-cleaning adjustment does not state its own percentage.");

// Level 5 is not a price. It is "a person needs to look at this first", and the
// engine must keep refusing rather than acquiring an opinion about it.
const specialist = quoteRooms({ rooms: house, conditionLevel: 5 }, config);
assert(!specialist.priceable && specialist.code === "specialist-review-required",
  "A property needing specialist review was given a price.");
assert(throws(() => {
  const forced = normalizedPricingConfig({ ...defaultPricingConfig, conditionLevels: { ...defaultPricingConfig.conditionLevels, 4: { multiplierBasisPoints: 40000 } } });
  if (forced) throw new TypeError("Condition level 4 multiplier accepted");
}, "Condition level 4 multiplier"), "An out-of-range condition multiplier was accepted.");
// An operator cannot put a price on level 5 by editing it either.
const tamperedLevels = normalizedPricingConfig({ ...defaultPricingConfig, conditionLevels: { 5: { multiplierBasisPoints: 20000 } } });
assert(tamperedLevels.conditionLevels[5].multiplierBasisPoints === 0, "Level 5 was made priceable by configuration.");

/* ── Location ─────────────────────────────────────────────────────────────── */

assert(postcodeArea("SW1A 1AA") === "SW" && postcodeArea("E17 4QR") === "E" && postcodeArea("EC1A 1BB") === "EC",
  "A postcode area was not read from the leading letters.");
assert(postcodeArea("not a postcode") === "", "A malformed postcode produced an area.");

const london = quoteRooms({ rooms: house, postcode: "SW1A 1AA" }, config);
const reading = quoteRooms({ rooms: house, postcode: "RG1 1AA" }, config);
const sunderland = quoteRooms({ rooms: house, postcode: "SR1 1AA" }, config);
for (const quote of [london, reading, sunderland]) assert(reconciles(quote), "A location-adjusted breakdown does not sum to its total.");
assert(london.totalPence > reading.totalPence && reading.totalPence > sunderland.totalPence,
  "London, the South East and the rest of the country are not priced in descending order.");
assert(sunderland.totalPence === baseline.totalPence, "The standard band is not the unadjusted price.");
// The correction this whole band exists for: the old flat rate charged a
// Sunderland customer the London number.
assert(london.totalPence - sunderland.totalPence > 0 && london.locationBand === "london", "The London band did not apply to a London postcode.");
// Unrecognised postcodes must fall to the CHEAP side. A default of "London"
// would silently overcharge every address nobody had classified.
const unknown = quoteRooms({ rooms: house, postcode: "ZZ99 9ZZ" }, config);
assert(unknown.totalPence === sunderland.totalPence && unknown.locationBand === "standard",
  "An unrecognised postcode was not priced at the standard band.");
assert(quoteRooms({ rooms: house }, config).locationBand === "standard", "A missing postcode was not priced at the standard band.");
assert(locationBandFor(config, "N1 9GU").code === "london", "locationBandFor disagrees with the engine.");

/* ── Size ─────────────────────────────────────────────────────────────────── */

// A bedroom the base already assumes is 14m². Measuring it at 14 must change
// nothing; measuring it at 30 must charge for the extra 16.
const typical = quoteRooms({ rooms: [{ roomType: "bedroom", squareMetres: 14, items: ordinary("Bed") }] }, config);
const large = quoteRooms({ rooms: [{ roomType: "bedroom", squareMetres: 30, items: ordinary("Bed") }] }, config);
const unmeasured = quoteRooms({ rooms: [{ roomType: "bedroom", items: ordinary("Bed") }] }, config);
assert(typical.rooms[0].sizePence === 0, "A typically sized room was charged a size adjustment.");
assert(unmeasured.rooms[0].sizePence === 0, "An unmeasured room was charged for an assumed size.");
assert(large.rooms[0].sizePence === 16 * config.perSquareMetrePence,
  `A 30m² bedroom should be charged for 16m² above expectation, was ${large.rooms[0].sizePence}p.`);
// Extra floor area is extra time as well as extra money, or the cleaner is
// booked for the wrong length of visit.
assert(large.rooms[0].minutes > unmeasured.rooms[0].minutes, "A larger room did not add any working time.");
assert(reconciles(large), "A size-adjusted breakdown does not sum to its total.");
// A measurement the scan could not trust is not a measurement.
const unusable = quoteInputFromScan({
  rooms: [{ roomName: "Bedroom", roomType: "bedroom", objects: [], measurements: [{ subject: "floor-area", confidence: "unusable", valueMm: 30_000_000 }] }]
});
assert(unusable.rooms[0].squareMetres === 0, "An unusable measurement was priced as floor area.");

/* ── Urgency ──────────────────────────────────────────────────────────────── */

const now = new Date("2026-09-01T09:00:00+01:00");
const urgencyAt = (startAt) => quoteRooms({ rooms: house, startAt, now: now.toISOString() }, config);
const inTwoWeeks = urgencyAt("2026-09-15T10:00:00+01:00");
const inThreeDays = urgencyAt("2026-09-04T10:00:00+01:00");
const inThirtyHours = urgencyAt("2026-09-02T15:00:00+01:00");
const inSixHours = urgencyAt("2026-09-01T15:00:00+01:00");
for (const quote of [inTwoWeeks, inThreeDays, inThirtyHours, inSixHours]) assert(reconciles(quote), "An urgency breakdown does not sum to its total.");
assert(inTwoWeeks.urgencyPence === 0 && inThreeDays.urgencyPence === 0, "A booking with plenty of notice was charged an urgency fee.");
assert(inThirtyHours.urgencyCode === "next-day" && inThirtyHours.urgencyPence > 0, "A booking 30 hours out was not charged the 48-hour band.");
assert(inSixHours.urgencyCode === "same-day" && inSixHours.urgencyPence > inThirtyHours.urgencyPence,
  "A same-day booking was not dearer than a next-day one.");
// The point of the surcharge is that it reaches the cleaner. It is part of the
// total, and the share is a percentage of the total, so it does.
const urgentEconomics = reviewedQuote(inSixHours).economics;
const calmEconomics = reviewedQuote(inTwoWeeks).economics;
assert(urgentEconomics.cleanerPayoutPence > calmEconomics.cleanerPayoutPence,
  "An urgency surcharge did not raise what the cleaner is paid, so it would not make the slot worth filling.");
// No start time means no urgency: a quote for an unscheduled job is the base
// price, and it goes UP when a time is chosen.
assert(quoteRooms({ rooms: house }, config).urgencyPence === 0, "An unscheduled quote was charged for urgency.");

/* ── Unsocial hours ───────────────────────────────────────────────────────── */

const scheduleAt = (startAt) => quoteRooms({ rooms: house, startAt }, config);
const weekdayMorning = scheduleAt("2026-09-02T10:00:00+01:00");
const saturday = scheduleAt("2026-08-29T10:00:00+01:00");
const sunday = scheduleAt("2026-08-30T10:00:00+01:00");
const bankHoliday = scheduleAt("2026-08-31T10:00:00+01:00");
const weekdayEvening = scheduleAt("2026-09-02T19:00:00+01:00");
const weekdayEarly = scheduleAt("2026-09-02T07:00:00+01:00");
for (const quote of [saturday, sunday, bankHoliday, weekdayEvening]) assert(reconciles(quote), "A schedule breakdown does not sum to its total.");
assert(weekdayMorning.schedulePence === 0, "An ordinary weekday morning was surcharged.");
assert(saturday.scheduleCode === "saturday" && saturday.schedulePence > 0, "A Saturday was not surcharged.");
assert(sunday.scheduleCode === "sunday" && sunday.schedulePence > saturday.schedulePence, "A Sunday is not dearer than a Saturday.");
assert(bankHoliday.scheduleCode === "sunday" && bankHoliday.schedulePence === sunday.schedulePence,
  "A bank holiday was not priced like a Sunday.");
assert(weekdayEvening.scheduleCode === "outside-hours" && weekdayEvening.schedulePence > 0, "A 7pm start was not surcharged.");
assert(weekdayEarly.scheduleCode === "outside-hours" && weekdayEarly.schedulePence > 0, "A 7am start was not surcharged.");
// London time, not UTC. In August these differ by an hour, which is exactly the
// hour that decides whether an 8am booking is unsocial.
assert(scheduleAt("2026-09-02T08:30:00+01:00").schedulePence === 0,
  "An 8:30am London booking was treated as out of hours, which means the arithmetic is running in UTC.");

/* ── Promotions ───────────────────────────────────────────────────────────── */

const promotional = normalizedPricingConfig({
  ...defaultPricingConfig,
  promotions: {
    WELCOME20: { kind: "percentage", value: 2000, maximumDiscountPence: 2000, label: "Welcome offer", firstBookingOnly: true },
    FIVER: { kind: "fixed", value: 500, maximumDiscountPence: 500, minimumSpendPence: 6000, label: "£5 off" },
    GONE: { kind: "percentage", value: 1000, maximumDiscountPence: 5000, expiresAt: "2020-01-01T00:00:00.000Z" }
  }
});

const welcome = resolvePromotion(promotional, "welcome20", { previousBookingCount: 0 });
assert(welcome && welcome.code === "WELCOME20", "A valid promotion code did not resolve, or is case-sensitive.");
assert(!resolvePromotion(promotional, "WELCOME20", { previousBookingCount: 3 }), "A first-booking-only code resolved for a returning customer.");
assert(!resolvePromotion(promotional, "GONE", {}), "An expired promotion resolved.");
assert(!resolvePromotion(promotional, "NOSUCHCODE", {}), "An unknown promotion resolved.");

const discounted = quoteRooms({ rooms: house, promotion: welcome }, promotional);
assert(reconciles(discounted), "A promotional breakdown does not sum to its total.");
assert(discounted.promotionDiscountPence < 0 && discounted.totalPence < baseline.totalPence, "A promotion did not reduce the total.");
// 20% of the LABOUR subtotal, not of the whole basket — the same rule every
// other discount follows, so a booking that is mostly oven cleaning cannot have
// its specialist work discounted by a code aimed at the cleaning.
assert(Math.abs(discounted.promotionDiscountPence) < 2000, "The uncapped discount already exceeds its own cap, so the cap below proves nothing.");
// The cap bites on a bigger basket.
const cappedQuote = quoteRooms({
  rooms: [...house, ...house], serviceType: "end-of-tenancy", promotion: welcome
}, promotional);
assert(Math.abs(cappedQuote.promotionDiscountPence) === 2000,
  `The £20 promotion cap was not applied to a large basket: ${cappedQuote.promotionDiscountPence}p.`);
assert(reconciles(cappedQuote), "A capped promotional breakdown does not sum to its total.");

// THE COMMERCIAL RULE: a promotion is Homle's growth decision and comes out of
// Homle's margin. The cleaner is paid on what the booking would have cost.
const discountedEconomics = reviewedQuote(discounted).economics;
const baselineEconomics = reviewedQuote(baseline).economics;
assert(discounted.payoutBasisPence === baseline.totalPence,
  "The payout basis is not the undiscounted price of the same booking.");
assert(discountedEconomics.cleanerPayoutPence === baselineEconomics.cleanerPayoutPence,
  "A promotional discount reduced the cleaner's pay, which makes a growth decision into a pay cut.");
assert(discountedEconomics.grossMarginPence < baselineEconomics.grossMarginPence,
  "A promotional discount did not come out of the platform's margin.");

// Minimum spend is enforced, and a code that does not apply is silently absent
// rather than an error the customer has to clear.
const smallBasket = { rooms: [{ roomType: "hallway", items: ordinary("Floor") }] };
const fiver = resolvePromotion(promotional, "FIVER", {});
assert(quoteRooms({ ...smallBasket, promotion: fiver }, promotional).promotionDiscountPence === 0,
  "A promotion was applied below its minimum spend.");
assert(quoteRooms({ rooms: house, promotion: fiver }, promotional).promotionDiscountPence === -500,
  "A fixed-amount promotion did not take its own value off.");

// A forged promotion object must not survive shape-checking.
for (const forged of [
  { code: "X", kind: "percentage", value: 5000, maximumDiscountPence: 100000 },
  { code: "HACK", kind: "percentage", value: -1, maximumDiscountPence: 100000 },
  { code: "HACK", kind: "percentage", value: 5000, maximumDiscountPence: 0 },
  { code: "DROP TABLE", kind: "fixed", value: 100, maximumDiscountPence: 100 }
]) {
  assert(quoteRooms({ rooms: house, promotion: forged }, config).promotionDiscountPence === 0,
    `A malformed promotion was honoured: ${JSON.stringify(forged)}`);
}
// A discount deep enough that the cleaner's undiscounted share exceeds what the
// customer paid must be REFUSED, not quietly sold at a loss.
const reckless = normalizedPricingConfig({ ...defaultPricingConfig, promotions: { HALFOFF: { kind: "percentage", value: 5000, maximumDiscountPence: 100000 } } });
const recklessQuote = quoteRooms({ rooms: house, promotion: resolvePromotion(reckless, "HALFOFF", {}) }, reckless);
assert(!reviewedQuote(recklessQuote).quote.priceable, "A promotion Homle cannot afford was still offered to a customer.");

// The code list is the one part of the price list whose value depends on not
// being readable, so the browser's copy must not carry it.
assert(Object.keys(publicPricingConfig(promotional).promotions).length === 0,
  "The public price list carries the promotion code list.");

/* ── Rounding ─────────────────────────────────────────────────────────────── */

// Every quote in this file lands on a 50p boundary, and the rounding is a named
// line rather than a silent adjustment to another one.
for (const quote of [baseline, london, sunderland, inSixHours, saturday, discounted, large, conditions[3]]) {
  assert(quote.totalPence % config.roundingIncrementPence === 0,
    `A total did not land on the rounding increment: ${quote.totalPence}p.`);
  const rounding = quote.lines.filter((line) => line.code === "rounding");
  assert(rounding.length <= 1, "More than one rounding line appeared on a quote.");
  assert(Math.abs(quote.roundingPence) <= config.roundingIncrementPence / 2,
    `A rounding line moved the price by more than half an increment: ${quote.roundingPence}p.`);
}
// The floor is on the increment too, so rounding and the minimum can never fight.
assert(quoteRooms(smallBasket, config).totalPence % config.roundingIncrementPence === 0,
  "A minimum-charge booking did not land on the rounding increment.");

/* ── The combined-multiplier ceiling ──────────────────────────────────────── */

// Deep × heavy × London is a real quote and must still price.
const worstRealCase = quoteRooms({ serviceType: "end-of-tenancy", conditionLevel: 4, postcode: "SW1A 1AA", rooms: house }, config);
assert(worstRealCase.priceable, `The dearest legitimate combination was refused: ${worstRealCase.reason}`);
assert(reconciles(worstRealCase), "The dearest legitimate combination does not reconcile.");
// A configuration that stacks past the ceiling is refused, not clamped.
const absurd = normalizedPricingConfig({
  ...defaultPricingConfig,
  serviceTypes: { ...defaultPricingConfig.serviceTypes, deep: { multiplierBasisPoints: 30000, minimumPence: 12000 } },
  conditionLevels: { ...defaultPricingConfig.conditionLevels, 4: { multiplierBasisPoints: 15000 } },
  locationBands: { ...defaultPricingConfig.locationBands, london: { multiplierBasisPoints: 12000, areas: ["SW"] } }
});
const ceilinged = quoteRooms({ serviceType: "deep", conditionLevel: 4, postcode: "SW1A 1AA", rooms: house }, absurd);
assert(!ceilinged.priceable && ceilinged.code === "multiplier-ceiling",
  "A combined multiplier past the ceiling produced a price instead of a refusal.");

/* ── The property-shape adaptor ───────────────────────────────────────────── */

const twoBedFlat = roomsFromPropertyShape(config, { propertyType: "flat", bedrooms: 2, bathrooms: 1 });
assert(twoBedFlat.length === 6, `A 2-bed 1-bath flat should expand to 6 rooms, got ${twoBedFlat.length}.`);
assert(twoBedFlat.filter((room) => room.roomType === "bedroom").length === 2, "The bedrooms were not expanded.");
assert(twoBedFlat.filter((room) => room.roomType === "bathroom").length === 1, "The bathrooms were not expanded.");
const shapeQuote = quoteRooms({ rooms: twoBedFlat, serviceType: "end-of-tenancy", postcode: "M1 1AA" }, config);
assert(shapeQuote.priceable && reconciles(shapeQuote), "A property-shape quote did not price or did not reconcile.");
// Against the market: a two-bed end-of-tenancy starts near £140 and averages
// £260. Outside that band the adaptor is producing the wrong room list.
assert(shapeQuote.totalPence >= 14000 && shapeQuote.totalPence <= 32000,
  `A 2-bed end-of-tenancy clean is outside the UK market band: ${shapeQuote.totalPence}p.`);
// The adaptor is an INPUT, not a second pricing model: the same rooms priced
// directly must give the same number.
assert(quoteRooms({ rooms: twoBedFlat, serviceType: "end-of-tenancy", postcode: "M1 1AA" }, config).totalPence === shapeQuote.totalPence,
  "The property-shape path and the room-list path disagree.");
// More bedrooms costs more; a bigger property is never cheaper.
let previous = 0;
for (const bedrooms of [1, 2, 3, 4, 5]) {
  const quote = quoteRooms({ rooms: roomsFromPropertyShape(config, { propertyType: "house", bedrooms, bathrooms: 1 }) }, config);
  assert(quote.totalPence > previous, `A ${bedrooms}-bed house was not dearer than a ${bedrooms - 1}-bed one.`);
  previous = quote.totalPence;
}
// Nonsense shapes are bounded rather than fatal.
assert(roomsFromPropertyShape(config, { propertyType: "flat", bedrooms: 999, bathrooms: -4 }).length <= 40,
  "An absurd property shape was not bounded.");
// An empty shape expands to nothing, deliberately. Returning a shape's standing
// rooms for `{}` would price a kitchen and a hallway for a caller who simply
// sent no shape, which the engine would then happily charge the minimum for.
assert(roomsFromPropertyShape(config, {}).length === 0, "An empty property shape invented rooms.");
assert(!quoteRooms({ propertyShape: {} }, config).priceable, "A quote with no rooms and an empty shape produced a price.");

// The engine accepts a shape in place of a room list, so the three-tap quote
// needs no separate path to reach a price.
const throughEngine = quoteRooms({ propertyShape: { propertyType: "flat", bedrooms: 2, bathrooms: 1 }, serviceType: "end-of-tenancy", postcode: "M1 1AA" }, config);
assert(throughEngine.priceable && throughEngine.totalPence === shapeQuote.totalPence,
  "Passing a property shape to the engine did not produce the same price as expanding it first.");
// An explicit room list always wins over a shape.
assert(quoteRooms({ rooms: [{ roomType: "hallway", items: [] }], propertyShape: { propertyType: "house", bedrooms: 6 } }, config).rooms.length === 1,
  "A property shape overrode an explicit room list.");

/* ── Bringing an old price list forward ──────────────────────────────────── */

// A version-1 configuration is not wrong, it is expressed in terms that no
// longer mean what they meant. Loading one unchanged would do two damaging
// things: freeze every room price as a permanent override, and multiply a rate
// that was already the dearest one by the new London band.
{
  const v1 = {
    configId: "default", version: 1, customerHourlyRatePence: 2800,
    includedItemsPerRoom: 3, additionalItemPence: 300, minimumBookingMinutes: 120,
    rooms: {
      kitchen: { label: "Kitchen", basePence: 1850, baseMinutes: 40, includedItems: 3 },
      bathroom: { label: "Bathroom", basePence: 1650, baseMinutes: 35, includedItems: 3 },
      bedroom: { label: "Bedroom", basePence: 1150, baseMinutes: 25, includedItems: 3 }
    },
    premiumItems: { oven: { label: "Oven deep clean", pence: 6000, minutes: 45 } }
  };
  const upgraded = normalizedPricingConfig(upgradeStoredPricingConfig(v1));

  // NOBODY'S PRICE GOES UP. The dearest band lands back on the old flat rate.
  const dearest = Math.max(...Object.values(upgraded.locationBands).map((band) => band.multiplierBasisPoints));
  const dearestHourly = Math.round(upgraded.customerHourlyRatePence * dearest / 10000);
  assert(Math.abs(dearestHourly - 2800) <= 1,
    `Upgrading a v1 price list moved the dearest hourly rate from £28.00 to ${(dearestHourly / 100).toFixed(2)}.`);
  assert(upgraded.customerHourlyRatePence < 2800, "The upgrade did not bring the regional rate below the old flat rate.");

  // Room prices track the rate again instead of being frozen at v1's numbers.
  assert(upgraded.rooms.kitchen.basePence === Math.round((40 / 60) * upgraded.customerHourlyRatePence),
    `A v1 room price was kept as an override instead of re-deriving: ${upgraded.rooms.kitchen.basePence}p.`);
  assert(upgraded.rooms.kitchen.basePence !== 1850, "The v1 kitchen price survived the upgrade.");

  // Deliberate operator choices SURVIVE. The oven was £60, not the shipped £55.
  assert(upgraded.premiumItems.oven.pence === 6000, "The upgrade discarded an operator's premium-item price.");
  // And a London booking costs what it did before the upgrade.
  const roomsPriced = [{ roomType: "kitchen", items: ordinary("A", "B", "C") }, { roomType: "bathroom", items: ordinary("D", "E", "F") }];
  const oldWorld = quoteRooms({ rooms: roomsPriced }, normalizedPricingConfig({ ...v1, version: 2, locationBands: { london: { label: "London", multiplierBasisPoints: 10000, areas: ["SW"] }, "high-cost": { label: "High", multiplierBasisPoints: 10000, areas: [] }, standard: { label: "Standard", multiplierBasisPoints: 10000, areas: [] } } }));
  const newWorldLondon = quoteRooms({ rooms: roomsPriced, postcode: "SW1A 1AA" }, upgraded);
  assert(newWorldLondon.totalPence <= oldWorld.totalPence + 100,
    `A London booking got dearer across the upgrade: ${oldWorld.totalPence}p → ${newWorldLondon.totalPence}p.`);

  // Idempotent, because it runs on every read.
  assert(upgradeStoredPricingConfig(upgradeStoredPricingConfig(v1)).customerHourlyRatePence
    === upgradeStoredPricingConfig(v1).customerHourlyRatePence, "The upgrade is not idempotent.");
  // A current configuration is returned untouched.
  const current = { ...defaultPricingConfig, version: 2 };
  assert(upgradeStoredPricingConfig(current) === current, "A current configuration was rewritten by the upgrade.");
}

// Storing a normalized configuration would freeze every room price as an
// override the first time an operator saved anything at all.
{
  const stored = publishablePricingConfig(normalizedPricingConfig(defaultPricingConfig));
  for (const [code, room] of Object.entries(stored.rooms)) {
    assert(!Object.hasOwn(room, "basePence"),
      `Room ${code} would be stored with a base price that just matches its own minutes, freezing it against the hourly rate.`);
  }
  // A deliberate override is still a deliberate override.
  const overridden = publishablePricingConfig(normalizedPricingConfig({ ...defaultPricingConfig, rooms: { kitchen: { basePence: 9999 } } }));
  assert(overridden.rooms.kitchen.basePence === 9999, "A deliberate room-price override was discarded on the way to storage.");
  // Round-tripping through storage does not change any price.
  assert(quoteRooms({ rooms: house }, normalizedPricingConfig(stored)).totalPence === baseline.totalPence,
    "A configuration changed price by being stored and read back.");
}

/* ── Cancellation ─────────────────────────────────────────────────────────── */

const booking = { totalPence: 12000, serviceType: "standard", scheduledStartAt: "2026-09-10T10:00:00+01:00" };
const cancelEarly = cancellationFee(booking, config, { now: new Date("2026-09-05T10:00:00+01:00") });
const cancelInside48 = cancellationFee(booking, config, { now: new Date("2026-09-08T20:00:00+01:00") });
const cancelInside24 = cancellationFee(booking, config, { now: new Date("2026-09-10T02:00:00+01:00") });
const noAccess = cancellationFee(booking, config, { now: new Date("2026-09-10T10:05:00+01:00"), reason: "no-access" });

assert(!cancelEarly.chargeable && cancelEarly.feePence === 0, "Cancelling five days ahead was charged.");
assert(cancelInside48.bandCode === "under-48" && cancelInside48.feePence === 2500,
  `A 24–48 hour cancellation should be capped at £25, was ${cancelInside48.feePence}p.`);
assert(cancelInside24.bandCode === "under-24" && cancelInside24.feePence === 5000,
  `An under-24-hour cancellation should be capped at £50, was ${cancelInside24.feePence}p.`);
assert(cancelInside24.feePence > cancelInside48.feePence, "Less notice did not cost more.");
assert(noAccess.bandCode === "no-access" && noAccess.feePence > 0, "A no-access visit was not charged.");
// No-access is charged against the minimum visit, not the whole booking: the
// cleaner travelled and lost the slot but did not do the work.
assert(noAccess.feePence < cancelInside24.feePence + 1 && noAccess.feePence <= 4800,
  `A no-access charge exceeded the minimum visit: ${noAccess.feePence}p.`);
// A fee can never exceed what the customer agreed to pay.
assert(cancellationFee({ ...booking, totalPence: 3000 }, config, { now: new Date("2026-09-10T02:00:00+01:00") }).feePence <= 3000,
  "A cancellation fee exceeded the booking total.");
// An unreadable booking must not block a cancellation.
assert(!cancellationFee({ totalPence: 5000, scheduledStartAt: "not a date" }, config, {}).chargeable,
  "An unparseable start time produced a cancellation charge.");
assert(!cancellationFee({}, config, {}).chargeable, "An empty booking produced a cancellation charge.");

// The split is the whole point of the policy.
const settlement = cancellationSettlement(cancelInside24.feePence, defaultPricingEconomics);
assert(settlement.cleanerPence === 3500 && settlement.platformPence === 1500,
  `A £50 cancellation fee should pay the cleaner £35, paid ${settlement.cleanerPence}p.`);
assert(settlement.cleanerPence + settlement.platformPence === settlement.feePence,
  "The cancellation split does not account for the whole fee.");
assert(cancellationPolicySummary(config).length >= 4, "The published cancellation policy is missing bands.");

/* ── Edge cases the brief names ───────────────────────────────────────────── */

assert(!quoteRooms({ rooms: [] }, config).priceable, "An empty booking produced a price.");
assert(!quoteRooms({}, config).priceable, "A booking with no rooms at all produced a price.");
// A room with nothing in it is still a room somebody has to clean.
const emptyRoom = quoteRooms({ rooms: [{ roomType: "bedroom", items: [] }] }, config);
assert(emptyRoom.priceable && emptyRoom.totalPence > 0, "A room with no listed tasks priced at nothing.");
// Nothing can ever be negative, whatever is thrown at it.
for (const quote of [baseline, discounted, london, inSixHours, worstRealCase, emptyRoom, shapeQuote]) {
  assert(quote.totalPence > 0, "A quote priced at zero or below.");
  assert(quote.rooms.every((room) => room.totalPence >= 0), "A room priced below zero.");
}
// Duplicate add-ons accumulate rather than overwrite, and quantities are bounded.
const duplicated = quoteRooms({ rooms: house, addOns: [{ code: "bed-linen" }, { code: "bed-linen" }, { code: "bed-linen", quantity: 999 }] }, config);
assert(duplicated.addOnPence === 800 + 800 + 800 * 20, `Duplicate add-ons did not accumulate correctly: ${duplicated.addOnPence}p.`);
assert(reconciles(duplicated), "A duplicated add-on breakdown does not sum to its total.");
// An unknown add-on is ignored rather than fatal.
assert(quoteRooms({ rooms: house, addOns: [{ code: "not-a-real-add-on" }] }, config).addOnPence === 0,
  "An unknown add-on changed the price.");
// Removing everything returns the price exactly to where it started — the
// "deselect and the charge disappears" promise, asserted rather than assumed.
const withEverything = quoteRooms({
  rooms: house, addOns: [{ code: "ironing" }], conditionLevel: 4, postcode: "SW1A 1AA", startAt: "2026-08-30T10:00:00+01:00", now: now.toISOString()
}, config);
const strippedBackAgain = quoteRooms({ rooms: house }, config);
assert(withEverything.totalPence > baseline.totalPence, "Adding every dimension did not raise the price.");
assert(strippedBackAgain.totalPence === baseline.totalPence, "Removing every dimension did not return the original price.");
// Changing service type mid-flow re-prices from scratch, carrying nothing over.
const asDeep = quoteRooms({ rooms: house, serviceType: "deep" }, config);
const backToStandard = quoteRooms({ rooms: house, serviceType: "standard" }, config);
assert(asDeep.totalPence > backToStandard.totalPence && backToStandard.totalPence === baseline.totalPence,
  "Switching cleaning type and back did not return the original price.");
// Very large properties stay inside the safe integer range and stay profitable.
const mansion = quoteRooms({
  serviceType: "end-of-tenancy", conditionLevel: 4, postcode: "SW1A 1AA",
  rooms: Array.from({ length: 30 }, (unused, index) => ({ roomType: index % 3 === 0 ? "bedroom" : index % 3 === 1 ? "bathroom" : "living-room", squareMetres: 40, items: ordinary("A", "B", "C", "D", "E") }))
}, config);
assert(mansion.priceable && Number.isSafeInteger(mansion.totalPence), "A very large property could not be priced safely.");
assert(reconciles(mansion), "A very large property's breakdown does not sum to its total.");
assert(reviewedQuote(mansion).economics.healthy, "A very large property fell outside the margin floors.");

/* ── Economics still balance with the new dimensions in play ──────────────── */

for (const quote of [london, inSixHours, saturday, worstRealCase, shapeQuote, mansion]) {
  const settled = quoteEconomics(quote.totalPence, quote.estimatedMinutes, defaultPricingEconomics, { payoutBasisPence: quote.payoutBasisPence });
  assert(settled.cleanerPayoutPence + settled.platformRevenuePence === settled.customerPaysPence,
    "Cleaner payout and platform revenue do not account for the whole customer price.");
  assert(settled.effectiveCleanerHourlyPence >= defaultPricingEconomics.cleanerHourlyFloorPence,
    `A quote pays the cleaner under the hourly floor: ${settled.effectiveCleanerHourlyPence}p/hour.`);
}

console.log("Pricing dynamics tests passed: condition, measured size, location bands, urgency, unsocial hours, capped promotions that cost the platform rather than the cleaner, 50p rounding, the multiplier ceiling, the property-shape adaptor, cancellation tiers and the brief's edge cases.");
