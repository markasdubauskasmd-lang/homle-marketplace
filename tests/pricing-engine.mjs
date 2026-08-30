// The pricing engine, against the scenarios the brief specifies and the
// invariants that make a price safe to charge.

import { defaultPricingConfig, normalizedPricingConfig } from "../public/pricing-config.js";
import { quoteInputFromScan, quoteRooms } from "../public/pricing-engine.js";
import { defaultPricingEconomics, normalizedPricingEconomics, quoteEconomics, reviewedQuote } from "../src/marketplace/pricing-economics.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }

function throws(operation, expected) {
  try { operation(); } catch (error) { return String(error.message).includes(expected); }
  return false;
}

const config = normalizedPricingConfig(defaultPricingConfig);
const ordinary = (...labels) => labels.map((label, index) => ({ code: `task-${index}-${label}`, label }));

/* ── The breakdown must reconcile, on every quote ─────────────────────────── */

function reconciles(quote) {
  if (!quote.priceable) return false;
  const summed = quote.lines.reduce((total, line) => total + line.pence, 0);
  return summed === quote.totalPence;
}

/* ── Scenario 1: one bedroom, three ordinary items ────────────────────────── */

const scenario1 = quoteRooms({ rooms: [{ roomType: "bedroom", items: ordinary("Bed", "Bedside table", "Wardrobe") }] }, config);
assert(scenario1.priceable, "A single bedroom with three tasks could not be priced.");
assert(scenario1.rooms[0].additionalCount === 0, "Three tasks consumed an additional-item charge.");
// £11.50 base is under the £45 floor, so the floor is what is charged — and the
// breakdown has to say so rather than silently inflating the base.
assert(scenario1.totalPence === 5600, `A small booking did not reach the two-hour minimum: ${scenario1.totalPence}`);
assert(scenario1.lines.some((line) => line.code === "minimum"), "The minimum charge was applied without appearing in the breakdown.");
assert(reconciles(scenario1), "Scenario 1 breakdown does not sum to its total.");

/* ── Scenario 2: one bedroom, five items → base + £6 ──────────────────────── */

const scenario2 = quoteRooms({ rooms: [{ roomType: "bedroom", items: ordinary("Bed", "Bedside table", "Wardrobe", "Desk", "Mirror") }] }, config);
assert(scenario2.rooms[0].additionalCount === 2, `Five tasks should charge for two, charged for ${scenario2.rooms[0].additionalCount}.`);
assert(scenario2.rooms[0].additionalPence === 600, `Two additional tasks should cost £6.00, cost ${scenario2.rooms[0].additionalPence}p.`);
assert(scenario2.rooms[0].subtotalPence === scenario2.rooms[0].basePence + 600, "The room subtotal is not base + additional items.");
// Each task is named with its own price, so "why did it change" has an answer.
const desk = scenario2.rooms[0].lines.find((line) => line.label === "Desk");
assert(desk && desk.pence === 300 && desk.kind === "additional", "The fourth task is not shown as a £3 addition.");
const bed = scenario2.rooms[0].lines.find((line) => line.label === "Bed");
assert(bed && bed.pence === 0 && bed.included === true, "An included task is not shown as included.");
assert(reconciles(scenario2), "Scenario 2 breakdown does not sum to its total.");

/* ── Scenario 3: bedroom + bathroom, priced independently then combined ───── */

const scenario3 = quoteRooms({
  rooms: [
    { roomType: "bedroom", items: ordinary("Bed", "Wardrobe", "Desk", "Mirror") },
    { roomType: "bathroom", items: ordinary("Toilet", "Shower", "Sink", "Tiles", "Mirror") }
  ]
}, config);
assert(scenario3.priceable && scenario3.rooms.length === 2, "Two rooms did not price.");
assert(scenario3.rooms[0].additionalCount === 1 && scenario3.rooms[1].additionalCount === 2,
  "Rooms were not given their own included-item allowance.");
// A bathroom must cost more than a bedroom: it is 35 minutes against 25.
assert(scenario3.rooms[1].basePence > scenario3.rooms[0].basePence, "A bathroom is not priced above a bedroom.");
assert(scenario3.roomSubtotalPence === scenario3.rooms[0].subtotalPence + scenario3.rooms[1].subtotalPence,
  "The room subtotal is not the sum of the rooms.");
assert(reconciles(scenario3), "Scenario 3 breakdown does not sum to its total.");

/* ── Scenario 4: a whole property ─────────────────────────────────────────── */

const wholeProperty = quoteRooms({
  rooms: [
    { roomType: "kitchen", items: ordinary("Worktops", "Hob", "Sink", "Floor", "Splashback") },
    { roomType: "bathroom", items: ordinary("Toilet", "Shower", "Sink", "Tiles") },
    { roomType: "living-room", items: ordinary("Sofa", "Table", "Floor") },
    { roomType: "bedroom", items: ordinary("Bed", "Wardrobe", "Floor") },
    { roomType: "bedroom", items: ordinary("Bed", "Wardrobe", "Floor") },
    { roomType: "hallway", items: ordinary("Floor", "Bannister") }
  ]
}, config);
assert(wholeProperty.priceable, "A whole-property scan could not be priced.");
// Six rooms earns the deepest multi-room band, so a full property does not read
// as the sum of its rooms shouted together.
const multiRoom = wholeProperty.lines.find((line) => line.code === "multi-room");
assert(multiRoom && multiRoom.pence < 0, "A six-room booking received no multi-room saving.");
assert(wholeProperty.totalPence < wholeProperty.roomSubtotalPence + wholeProperty.premiumPence,
  "The multi-room saving did not reduce the total.");
assert(reconciles(wholeProperty), "Whole-property breakdown does not sum to its total.");

/* ── Scenario 5: a kitchen with premium tasks ─────────────────────────────── */

const kitchen = quoteRooms({
  rooms: [{
    roomType: "kitchen",
    items: [...ordinary("Worktops", "Hob", "Sink"), { code: "oven", label: "Oven" }, { code: "fridge", label: "Fridge" }]
  }]
}, config);
// The whole point of the premium tier: an oven must not be a £3 task.
assert(kitchen.rooms[0].additionalCount === 0, "A premium item consumed an ordinary additional-item charge.");
assert(kitchen.rooms[0].premiumPence === 8000, `Oven + fridge should be £80.00, was ${kitchen.rooms[0].premiumPence}p.`);
assert(kitchen.premiumPence === 8000, "Premium items did not reach the quote total.");
const ovenLine = kitchen.rooms[0].lines.find((line) => line.code === "premium:oven");
assert(ovenLine && ovenLine.pence === 5500, "The oven is not priced at its own rate.");
assert(kitchen.rooms[0].minutes >= 40 + 45 + 20, "Premium tasks did not add their working time.");
assert(reconciles(kitchen), "Kitchen breakdown does not sum to its total.");

/* ── Scenario 6: adding and removing must be exactly reversible ───────────── */

const withoutDesk = quoteRooms({ rooms: [{ roomType: "bedroom", items: ordinary("Bed", "Wardrobe", "Table", "Lamp") }] }, config);
const withDesk = quoteRooms({ rooms: [{ roomType: "bedroom", items: [...ordinary("Bed", "Wardrobe", "Table", "Lamp"), { code: "desk", label: "Desk" }] }] }, config);
const removedAgain = quoteRooms({ rooms: [{ roomType: "bedroom", items: ordinary("Bed", "Wardrobe", "Table", "Lamp") }] }, config);
assert(withDesk.rooms[0].subtotalPence - withoutDesk.rooms[0].subtotalPence === 300,
  "Adding a fifth ordinary task did not cost exactly £3.");
assert(removedAgain.totalPence === withoutDesk.totalPence,
  "Removing a task did not return the price to where it started.");
// Repeated churn must not drift by a penny.
let churn = withoutDesk.totalPence;
for (let round = 0; round < 25; round += 1) {
  const on = quoteRooms({ rooms: [{ roomType: "bedroom", items: [...ordinary("Bed", "Wardrobe", "Table", "Lamp"), { code: "desk", label: "Desk" }] }] }, config);
  const off = quoteRooms({ rooms: [{ roomType: "bedroom", items: ordinary("Bed", "Wardrobe", "Table", "Lamp") }] }, config);
  assert(off.totalPence === churn && on.totalPence >= churn, "Repeated add/remove drifted the price.");
  churn = off.totalPence;
}

/* ── Scenario 7: a very small booking still covers the visit ──────────────── */

const tiny = quoteRooms({ rooms: [{ roomType: "hallway", items: ordinary("Floor") }] }, config);
assert(tiny.priceable && tiny.totalPence === 5600, "A one-task hallway did not reach the two-hour minimum visit.");
assert(reviewedQuote(tiny).economics.grossMarginPence > 0, "The smallest possible booking loses money.");

/* ── A deliberately longer visit changes both price and booked time ──────── */

const endOfTenancyTwoHours = quoteRooms({ serviceType: "end-of-tenancy", requestedMinutes: 120, rooms: [{ roomType: "bedroom", items: ordinary("Floor") }] }, config);
const endOfTenancyThreeHours = quoteRooms({ serviceType: "end-of-tenancy", requestedMinutes: 180, rooms: [{ roomType: "bedroom", items: ordinary("Floor") }] }, config);
assert(endOfTenancyTwoHours.totalPence === 15000 && endOfTenancyThreeHours.totalPence === 16800,
  `Changing an end-of-tenancy visit from two to three hours did not move £150.00 to £168.00 (${endOfTenancyTwoHours.totalPence}p → ${endOfTenancyThreeHours.totalPence}p).`);
assert(endOfTenancyThreeHours.estimatedMinutes === 180 && endOfTenancyThreeHours.requestedMinutes === 180,
  "The selected three-hour visit was priced but not returned as the booked duration.");
assert(throws(() => quoteRooms({ requestedMinutes: 119, rooms: [{ roomType: "bedroom", items: ordinary("Floor") }] }, config), "between 120 and 960"),
  "A duration below the server price list's minimum entered a quote.");

/* ── Scenario 8: a large booking stays profitable and pays properly ───────── */

const large = quoteRooms({
  serviceType: "end-of-tenancy",
  rooms: [
    { roomType: "kitchen", items: [...ordinary("Worktops", "Hob", "Sink", "Floor"), { code: "oven", label: "Oven" }, { code: "cupboards-interior", label: "Inside cupboards" }] },
    { roomType: "bathroom", items: ordinary("Toilet", "Shower", "Sink", "Tiles", "Limescale") },
    { roomType: "bathroom", items: ordinary("Toilet", "Shower", "Sink") },
    { roomType: "living-room", items: [...ordinary("Sofa", "Table", "Floor"), { code: "carpet-room", label: "Carpet" }] },
    { roomType: "bedroom", items: ordinary("Bed", "Wardrobe", "Floor", "Windows") },
    { roomType: "bedroom", items: ordinary("Bed", "Wardrobe", "Floor") },
    { roomType: "hallway", items: ordinary("Floor") }
  ],
  addOns: [{ code: "ironing", quantity: 2 }]
}, config);
assert(large.priceable, `A large end-of-tenancy booking could not be priced: ${large.reason}`);
assert(large.totalPence > 25000, `A seven-room end-of-tenancy clean priced implausibly low: ${large.totalPence}p.`);
const largeEconomics = reviewedQuote(large).economics;
assert(largeEconomics.healthy && largeEconomics.grossMarginBasisPoints >= 2000,
  `A large booking fell under the target margin: ${largeEconomics.grossMarginBasisPoints}bp.`);
assert(reconciles(large), "Large-booking breakdown does not sum to its total.");

/* ── Service types are ordered as the market prices them ──────────────────── */

const sameRooms = [
  { roomType: "kitchen", items: ordinary("Worktops", "Hob", "Sink") },
  { roomType: "bathroom", items: ordinary("Toilet", "Shower", "Sink") },
  { roomType: "bedroom", items: ordinary("Bed", "Wardrobe", "Floor") },
  { roomType: "living-room", items: ordinary("Sofa", "Table", "Floor") }
];
const standard = quoteRooms({ serviceType: "standard", rooms: sameRooms }, config);
const deep = quoteRooms({ serviceType: "deep", rooms: sameRooms }, config);
const endOfTenancy = quoteRooms({ serviceType: "end-of-tenancy", rooms: sameRooms }, config);
assert(standard.totalPence < deep.totalPence && deep.totalPence < endOfTenancy.totalPence,
  "Standard, deep and end-of-tenancy are not priced in ascending order.");
// Against the market: a 2-bed standard clean sits near £80, a deep clean
// £120–£180, end of tenancy £140–£350.
assert(standard.totalPence >= 5600 && standard.totalPence <= 12000, `A standard 4-room clean is outside the UK market band: ${standard.totalPence}p.`);
assert(deep.totalPence >= 10000 && deep.totalPence <= 26000, `A deep 4-room clean is outside the UK market band: ${deep.totalPence}p.`);
assert(endOfTenancy.totalPence >= 15000 && endOfTenancy.totalPence <= 40000, `An end-of-tenancy 4-room clean is outside the UK market band: ${endOfTenancy.totalPence}p.`);

/* ── Recurring bookings are cheaper, and only on the rooms ────────────────── */

const oneOff = quoteRooms({ frequency: "one-time", rooms: sameRooms }, config);
const weekly = quoteRooms({ frequency: "weekly", rooms: sameRooms }, config);
assert(weekly.totalPence < oneOff.totalPence, "A weekly booking is not cheaper than a one-off.");
const withOven = quoteRooms({ frequency: "weekly", rooms: [{ roomType: "kitchen", items: [...ordinary("A", "B", "C"), { code: "oven", label: "Oven" }] }] }, config);
const withOvenOnce = quoteRooms({ frequency: "one-time", rooms: [{ roomType: "kitchen", items: [...ordinary("A", "B", "C"), { code: "oven", label: "Oven" }] }] }, config);
assert(withOven.premiumPence === withOvenOnce.premiumPence,
  "A recurring discount was applied to a premium task, which is the same work every time.");

/* ── Unit economics ───────────────────────────────────────────────────────── */

const economics = largeEconomics;
assert(economics.customerPaysPence === large.totalPence, "The economics priced a different total from the quote.");
assert(economics.cleanerPayoutPence + economics.platformRevenuePence === economics.customerPaysPence,
  "Cleaner payout and platform revenue do not account for the whole customer price.");
assert(economics.grossMarginPence === economics.platformRevenuePence - economics.paymentFeePence,
  "Gross margin is not platform revenue less the payment fee.");
assert(economics.effectiveCleanerHourlyPence >= defaultPricingEconomics.cleanerHourlyFloorPence,
  "A priced booking pays the cleaner under the hourly floor.");
// The share promised to supply is the share actually paid.
assert(Math.abs(economics.cleanerPayoutPence - Math.round(large.totalPence * 0.7)) <= 1,
  "The cleaner did not receive the configured 70% share.");

/* ── A configuration that cannot pay everyone is refused, not sold ────────── */

// Deliberately a configuration that PASSES validation — 90% + 1.5% + 5% still
// leaves room on paper — but cannot clear the minimum contribution once the
// processor's fixed 20p is taken out of a real booking. That gap is exactly
// what the quote-time guard exists for, and why config validation alone is not
// enough to keep a loss-making price off a customer's screen.
const starvedEconomics = { ...defaultPricingEconomics, cleanerShareBasisPoints: 9000, targetGrossMarginBasisPoints: 500 };
const starvedReview = reviewedQuote(quoteRooms({ rooms: sameRooms }, config), starvedEconomics);
assert(!starvedReview.quote.priceable && starvedReview.quote.code === "margin-floor",
  "A booking that cannot clear its margin floor was still offered to a customer.");
assert(!starvedReview.quote.reason.includes("%") && !starvedReview.quote.reason.includes("margin"),
  "The customer-facing refusal leaks the platform's margin position.");
assert(starvedReview.economics.reason.includes("minimum"), "The operator-facing reason does not say what actually failed.");
assert(throws(() => normalizedPricingEconomics({ cleanerShareBasisPoints: 9000, paymentFeeBasisPoints: 200, targetGrossMarginBasisPoints: 2000 }), "exceed the whole booking value"),
  "An economics configuration that spends more than the booking is worth was accepted.");

/* ── Operator edits are validated, not clamped ────────────────────────────── */

assert(throws(() => normalizedPricingConfig({ additionalItemPence: 50000 }), "Additional item price"), "An absurd per-item price was accepted.");
assert(throws(() => normalizedPricingConfig({ customerHourlyRatePence: 10 }), "Customer hourly rate"), "An unworkable hourly rate was accepted.");
assert(throws(() => normalizedPricingConfig({ rooms: { bedroom: { basePence: -1 } } }), "base price"), "A negative room price was accepted.");
// The knob the brief asks for by name: £3.00 → £3.50 in exactly one place.
const raised = normalizedPricingConfig({ ...defaultPricingConfig, additionalItemPence: 350 });
const raisedQuote = quoteRooms({ rooms: [{ roomType: "bedroom", items: ordinary("A", "B", "C", "D", "E") }] }, raised);
assert(raisedQuote.rooms[0].additionalPence === 700, "Changing the additional-item price did not change the quote.");

/* ── The scan adapter feeds the same engine ───────────────────────────────── */

const fromScan = quoteInputFromScan({
  rooms: [{
    roomName: "Kitchen",
    roomType: "kitchen",
    objects: [
      { inventoryKey: "worktop", label: "Worktops" },
      { inventoryKey: "hob", label: "Hob" },
      { inventoryKey: "sink", label: "Sink" },
      { inventoryKey: "oven", label: "Oven" },
      { inventoryKey: "unsure", label: "Something", needsConfirmation: true },
      { inventoryKey: "removed", label: "Removed", selected: false }
    ]
  }]
});
assert(fromScan.rooms[0].items.length === 4, "The scan adapter kept an unconfirmed or deselected object as billable work.");
const scanQuote = quoteRooms(fromScan, config);
assert(scanQuote.priceable && scanQuote.premiumPence === 5500, "A scanned oven was not priced as a premium task.");
assert(reconciles(scanQuote), "A scan-derived breakdown does not sum to its total.");

/* ── Economics helper is usable on its own ────────────────────────────────── */

const standalone = quoteEconomics(10000, 120, defaultPricingEconomics);
assert(standalone.cleanerPayoutPence === 7000 && standalone.paymentFeePence === 170,
  "Standalone economics did not apply the configured share and processor fee.");
assert(standalone.grossMarginPence === 2830, `Gross margin on a £100 booking should be £28.30, was ${standalone.grossMarginPence}p.`);

/* ── The browser half must not carry commercial figures ──────────────────── */

const { readFile } = await import("node:fs/promises");
for (const path of ["../public/pricing-config.js", "../public/pricing-engine.js"]) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const body = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  for (const secret of ["cleanerShareBasisPoints", "targetGrossMarginBasisPoints", "paymentFeeBasisPoints", "cleanerHourlyFloorPence", "minimumContributionPence"]) {
    assert(!body.includes(secret), `${path} is served to the browser and carries ${secret}.`);
  }
}

console.log("Pricing engine tests passed: the eight brief scenarios, breakdowns that reconcile to the penny, room-independent included items, premium tasks priced away from the £3 rule, market-ordered service types, reversible add/remove, validated operator edits, and no quote sold below its margin or cleaner-pay floor.");
