// The pricing policies are REACHABLE, not merely implemented.
//
// The arithmetic is covered in tests/pricing-dynamics.mjs. What this file
// guards is the thing that was actually wrong for a whole release: the
// cancellation policy and the promotion machinery both existed, were both
// correct, and nothing called either of them. A fee nobody can see is not a
// policy, and a code no operator can create is not an offer.
//
// Structural rather than behavioural on purpose. These are five separate
// surfaces — an HTTP route, three browser screens and an operator queue — and a
// unit test that mounted all five would be asserting its own scaffolding. What
// matters is that each one reaches the shared module rather than restating the
// rule in its own words, which is how the guide prices drifted.

import { readFile } from "node:fs/promises";
import { defaultPricingConfig, normalizedPricingConfig } from "../public/pricing-config.js";
import { cancellationFee, cancellationPolicySummary, cancellationSettlement } from "../public/cancellation-policy.js";
import { defaultPricingEconomics } from "../src/marketplace/pricing-economics.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }
const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

const config = normalizedPricingConfig(defaultPricingConfig);

/* ── 1. The server computes it, and gates the split ──────────────────────── */

const http = await source("../src/marketplace/marketplace-http.mjs");
assert(http.includes('from "../../public/cancellation-policy.js"'),
  "The server no longer computes cancellation fees from the shared policy module.");
assert(http.includes("cancellation-quote"),
  "There is no endpoint a customer or an operator can ask what cancelling would cost.");

const route = http.slice(http.indexOf("const cancellationQuoteMatch"), http.indexOf('if (pathname === "/api/marketplace/bookings")'));
assert(route.includes('roles: ["landlord", "administrator"]'), "The cancellation quote is not gated to the people entitled to it.");
// The cleaner's share of a fee is a commercial position and follows the same
// rule as the rest of the economics: administrators only.
assert(/administrator[\s\S]{0,200}cancellationSettlement/.test(route),
  "The cleaner's share of a cancellation fee is returned without an administrator check.");
assert(route.includes('request.method !== "GET"'), "The cancellation quote is not compute-only.");

/* ── 2. The customer is told before they ask, not after ──────────────────── */

const help = await source("../public/landlord-help.js");
const helpMarkup = await source("../public/landlord-help.html");
assert(help.includes("cancellation-quote"), "The cancellation form does not ask what cancelling would cost.");
assert(helpMarkup.includes("data-support-cancellation"), "The cancellation form has nowhere to show the cost.");
assert(/bookingId.*addEventListener|addEventListener[\s\S]{0,80}bookingId/.test(help),
  "Changing the chosen booking does not re-ask, so the fee shown could belong to a different booking.");
// Disclosure must never become a gate. Somebody who genuinely has to cancel
// cannot be blocked because a quote endpoint was slow.
const disclosure = help.slice(help.indexOf("async function syncCancellationCost"), help.indexOf("function formatMoney"));
assert(/catch\s*\{[\s\S]{0,200}hidden = true/.test(disclosure),
  "A failed cancellation quote does not fall back to hiding the panel, so it could block a cancellation.");

/* ── 3. The terms are shown before booking, and rendered not written ─────── */

const journey = await source("../public/landlord-journey.js");
const journeyMarkup = await source("../public/landlord-journey.html");
assert(journey.includes("cancellationPolicySummary"),
  "The confirm step does not render the cancellation policy from the price list.");
assert(journeyMarkup.includes("data-checkout-policy"), "The confirm step has nowhere to show the cancellation terms.");
// The failure this exists to prevent: terms typed into markup, drifting away
// from the arithmetic that charges — exactly what happened to the guide prices.
assert(!/25% of the booking|50% of the booking|£25|£50/.test(journeyMarkup),
  "Cancellation terms are hard-coded into the confirm step markup instead of rendered from the price list.");

/* ── 4. The operator sees it at the moment of the decision ───────────────── */

const adminSupport = await source("../public/admin-support.js");
assert(adminSupport.includes("cancellation-quote"),
  "An operator reviewing a cancellation is not shown what the published policy says about it.");
assert(adminSupport.includes("cleanerPence") || adminSupport.includes("split"),
  "The operator is not shown what the cleaner receives out of a cancellation fee.");

/* ── 5. The words on screen come from the same object as the money ───────── */

// A policy summary that could disagree with the fee is the whole failure mode.
// Both are derived here from one configuration, so a changed band moves both.
const dearBands = normalizedPricingConfig({
  ...defaultPricingConfig,
  cancellationBands: [
    { code: "no-access", label: "No access on arrival", withinHours: 0, basisPoints: 10000, maximumPence: 100000, chargeMinimumVisitOnly: true },
    { code: "under-24", label: "Less than 24 hours", withinHours: 24, basisPoints: 9000, maximumPence: 20000, chargeMinimumVisitOnly: false },
    { code: "under-48", label: "24 to 48 hours", withinHours: 48, basisPoints: 5000, maximumPence: 20000, chargeMinimumVisitOnly: false }
  ]
});
const booking = { totalPence: 10000, serviceType: "standard", scheduledStartAt: "2026-09-10T10:00:00+01:00" };
const charged = cancellationFee(booking, dearBands, { now: new Date("2026-09-10T02:00:00+01:00") });
const published = cancellationPolicySummary(dearBands).find((row) => row.code === "under-24");
assert(charged.feePence === 9000, `An edited band did not change the fee: ${charged.feePence}p.`);
assert(published.charge.includes("90%"), `The published policy did not follow the edited band: ${published.charge}`);
// And the split follows the economics, not the price list.
const generous = cancellationSettlement(charged.feePence, { ...defaultPricingEconomics, cancellationCleanerShareBasisPoints: 9000 });
assert(generous.cleanerPence === 8100 && generous.platformPence === 900,
  `The cancellation split did not follow the configured share: ${generous.cleanerPence}p / ${generous.platformPence}p.`);
assert(cancellationSettlement(charged.feePence, defaultPricingEconomics).cleanerPence === 6300,
  "The default cancellation split is not the configured 70%.");
void config;


/* ── 6. Promotions are reachable, and the code list still is not ─────────── */

// The engine, the endpoint and the payout rule were all done; codes could only
// be added through the API. An offer an operator cannot create is an offer
// nobody runs.
const adminPricing = await source("../public/admin-pricing.js");
const adminMarkup = await source("../public/admin-pricing.html");
assert(adminMarkup.includes("data-fields-promotions") && adminMarkup.includes("data-add-promotion"),
  "There is no way for an operator to create a promotion code.");
assert(adminPricing.includes("promotionsFromDrafts") && adminPricing.includes("next.promotions"),
  "The promotion editor does not reach the configuration that is saved.");
// Every term the engine honours has to be editable, or it is decided by a
// default nobody chose.
for (const term of ["maximumDiscountPence", "minimumSpendPence", "firstBookingOnly", "expiresAt"]) {
  assert(adminPricing.includes(term), `A promotion's ${term} cannot be set by an operator.`);
}

const journeySource = await source("../public/landlord-journey.js");
const journeyPage = await source("../public/landlord-journey.html");
assert(journeyPage.includes("data-promo-form"), "A customer has nowhere to enter a promotion code.");
assert(journeySource.includes("/api/marketplace/pricing/promotion"),
  "The journey does not ask the server to check a typed code.");
// The whole reason the endpoint exists: the list must not ship to the browser.
assert(http.includes("publicPricingConfig(await pricingConfiguration"),
  "The public price-list endpoint no longer strips the promotion codes.");
// The grant is deliberately not persisted — a stale tab must not resurrect a
// discount the server may no longer honour.
assert(/saveDraft\(\) serialises `state\.draft`|Held in memory\s*\n\s*\/\/ only/.test(journeySource),
  "The resolved promotion grant is no longer documented as memory-only.");
assert(!/state\.draft\.promotion\b\s*=/.test(journeySource),
  "The resolved promotion grant is written into the saved draft, where a stale one could reappear.");

console.log("Promotion wiring tests passed: an operator can create a code with every term the engine honours, a customer can redeem one, the code list still never reaches a browser, and the resolved grant is never persisted.");
console.log("Cancellation wiring tests passed: the server computes the fee and gates the cleaner's share to operators, the customer sees it before asking and is never blocked by it, the terms are rendered from the price list rather than typed, and the operator sees the fee and the split at the decision.");
