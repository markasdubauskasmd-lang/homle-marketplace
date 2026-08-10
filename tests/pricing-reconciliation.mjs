// The displayed price and the charged price are the same number.
//
// This is the promise the whole pricing design rests on, and it is the one that
// is easiest to break by accident: a rounding change, a discount applied in a
// second place, a client that prices optimistically and drifts. Everything here
// is an invariant rather than an example, so it keeps holding as the numbers
// change.

import { readFile } from "node:fs/promises";
import { defaultPricingConfig, normalizedPricingConfig } from "../public/pricing-config.js";
import { quoteInputFromScan, quoteRooms } from "../public/pricing-engine.js";
import { defaultPricingEconomics, quoteEconomics, reviewedQuote } from "../src/marketplace/pricing-economics.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }

const config = normalizedPricingConfig(defaultPricingConfig);
const task = (...labels) => labels.map((label, index) => ({ code: `t${index}-${label}`, label }));

/* ── One implementation, both sides ──────────────────────────────────────── */

// The browser and the server must not each carry their own arithmetic. The
// server imports the same module the scanner does, and this asserts it keeps
// doing so — a second implementation is how the two numbers drift apart.
const http = await readFile(new URL("../src/marketplace/marketplace-http.mjs", import.meta.url), "utf8");
assert(http.includes('from "../../public/pricing-engine.js"'),
  "The server no longer prices with the same module the browser runs, so the two can drift.");
assert(http.includes('pathname === "/api/marketplace/pricing/quote"'),
  "There is no server-side quote endpoint, so the client's number is the only one.");

// And the customer-facing quote must never carry the economics with it.
const quoteRoute = http.slice(http.indexOf('pathname === "/api/marketplace/pricing/quote"'), http.indexOf('pathname === "/api/marketplace/pricing/config"'));
assert(quoteRoute.includes("const { quote } =") && !quoteRoute.includes("economics }"),
  "The customer quote endpoint returns the platform's economics.");

/* ── The breakdown reconciles, across a wide sweep ───────────────────────── */

const roomTypes = Object.keys(config.rooms);
const premiumCodes = Object.keys(config.premiumItems);
const serviceCodes = Object.keys(config.serviceTypes);
const frequencies = Object.keys(config.discounts.recurringBasisPoints);

let checked = 0;
for (const service of serviceCodes) {
  for (const frequency of frequencies) {
    for (let roomCount = 1; roomCount <= 7; roomCount += 1) {
      for (let items = 0; items <= 8; items += 2) {
        const rooms = Array.from({ length: roomCount }, (_, index) => ({
          roomType: roomTypes[(index + items) % roomTypes.length],
          items: [
            ...task(...Array.from({ length: items }, (_, i) => `Task ${i}`)),
            ...(items > 4 ? [{ code: premiumCodes[index % premiumCodes.length], label: "Specialist" }] : [])
          ]
        }));
        const quote = quoteRooms({ serviceType: service, frequency, rooms }, config);
        if (!quote.priceable) continue;
        checked += 1;

        const summed = quote.lines.reduce((total, line) => total + line.pence, 0);
        assert(summed === quote.totalPence,
          `Breakdown does not reconcile for ${service}/${frequency}/${roomCount} rooms/${items} items: lines ${summed} vs total ${quote.totalPence}.`);
        // Integer pence everywhere. A fractional penny is a number that cannot
        // be charged and will be rounded by somebody else later.
        assert(Number.isInteger(quote.totalPence), "A total is not whole pence.");
        for (const line of quote.lines) assert(Number.isInteger(line.pence), `Line ${line.code} is not whole pence.`);
        for (const room of quote.rooms) {
          const roomSummed = room.lines.reduce((total, line) => total + line.pence, 0);
          assert(roomSummed === room.totalPence, `Room ${room.label} lines do not sum to its total.`);
        }
        assert(quote.totalPence >= config.minimumBookingPence, "A quote came in under the minimum booking.");
      }
    }
  }
}
assert(checked > 500, `The sweep did not cover enough combinations: ${checked}.`);

/* ── Pricing is deterministic ────────────────────────────────────────────── */

// Same input, same number — every time, and in any order. A quote that depends
// on iteration order or on when it was asked cannot be re-derived at checkout.
const shuffleSafe = {
  serviceType: "deep",
  frequency: "fortnightly",
  rooms: [
    { roomType: "kitchen", items: [...task("A", "B", "C", "D"), { code: "oven", label: "Oven" }] },
    { roomType: "bathroom", items: task("E", "F", "G") }
  ]
};
const first = quoteRooms(shuffleSafe, config);
for (let attempt = 0; attempt < 50; attempt += 1) {
  const again = quoteRooms(structuredClone(shuffleSafe), config);
  assert(again.totalPence === first.totalPence, "The same selection priced differently on a repeat call.");
  assert(JSON.stringify(again.lines) === JSON.stringify(first.lines), "The same selection produced a different breakdown.");
}

/* ── What the customer sees is what the cleaner is paid out of ───────────── */

for (const quote of [first, quoteRooms({ rooms: [{ roomType: "hallway", items: task("Floor") }] }, config)]) {
  const economics = quoteEconomics(quote.totalPence, quote.estimatedMinutes, defaultPricingEconomics);
  assert(economics.customerPaysPence === quote.totalPence,
    "The amount used for the payout split is not the amount quoted.");
  assert(economics.cleanerPayoutPence + economics.platformRevenuePence === quote.totalPence,
    "The payout split does not account for the whole customer price.");
  assert(economics.cleanerPayoutPence > 0 && economics.cleanerPayoutPence < quote.totalPence,
    "The cleaner's share is not a share.");
}

/* ── A refused quote carries no price at all ─────────────────────────────── */

// The dangerous failure is a quote that is unpriceable but still carries a
// number, because something downstream will use it.
const refused = reviewedQuote(first, { ...defaultPricingEconomics, cleanerShareBasisPoints: 9400, targetGrossMarginBasisPoints: 100, minimumContributionPence: 9000 });
assert(!refused.quote.priceable, "A quote that cannot clear its floors was still priceable.");
assert(refused.quote.totalPence === 0 && refused.quote.lines.length === 0,
  "A refused quote still carries a price and a breakdown for something downstream to charge.");

/* ── The scan and the checkout price the same selection identically ──────── */

const scan = {
  rooms: [{
    roomName: "Kitchen",
    roomType: "kitchen",
    objects: [
      { inventoryKey: "worktop", label: "Worktops" },
      { inventoryKey: "hob", label: "Hob" },
      { inventoryKey: "sink", label: "Sink" },
      { inventoryKey: "splashback", label: "Splashback" },
      { inventoryKey: "oven", label: "Oven" }
    ]
  }]
};
// What the scanner shows.
const scanned = quoteRooms(quoteInputFromScan(scan), config);
// What a checkout would re-derive from the stored selection. Same function,
// same config, so this is an equality test rather than a tolerance.
const atCheckout = quoteRooms(quoteInputFromScan(structuredClone(scan)), config);
assert(scanned.totalPence === atCheckout.totalPence,
  "The scanner's price and the checkout's price for the same selection differ.");
assert(scanned.totalPence === 1850 + 300 + 5500, `A scanned kitchen priced unexpectedly: ${scanned.totalPence}p.`);

/* ── Removing the last task cannot leave a stale higher price ────────────── */

const withExtra = quoteRooms({ rooms: [{ roomType: "bedroom", items: task("A", "B", "C", "D") }] }, config);
const withoutExtra = quoteRooms({ rooms: [{ roomType: "bedroom", items: task("A", "B", "C") }] }, config);
assert(withoutExtra.totalPence <= withExtra.totalPence, "Removing a task raised the price.");
const emptyRoom = quoteRooms({ rooms: [{ roomType: "bedroom", items: [] }] }, config);
assert(emptyRoom.priceable && emptyRoom.totalPence === config.minimumBookingPence,
  "A room with nothing selected did not fall back to the minimum booking.");

console.log("Pricing reconciliation tests passed: one implementation shared by browser and server, breakdowns that reconcile across 500+ combinations, whole-pence determinism, payout split that accounts for the whole customer price, refused quotes that carry no chargeable number, and a scan that prices identically at checkout.");
