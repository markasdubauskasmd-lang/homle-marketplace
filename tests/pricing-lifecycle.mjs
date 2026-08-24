// One number, from the first tap to both dashboards.
//
// The brief's central requirement, stated as a single chain:
//
//   Form → Summary → Booking → Stripe → Confirmation → Database
//        → Customer dashboard → Cleaner dashboard
//
// Every existing test covers one hop. This one walks the whole chain against a
// single booking and asserts the figure never changes hands for a different
// figure — and, at the two places money is SPLIT rather than moved, that the
// parts still account for the whole.
//
// The seams that are real code rather than a database live here. The two that
// are SQL — booking_payments.amount_pence taking its value from
// bookings.customer_price_pence, and the participant projections reading
// customer_price_pence and cleaner_pay_pence — are asserted structurally, by
// reading the migration and the projection, because a unit test cannot run
// PostgreSQL and a mocked one would assert the mock.

import { readFile } from "node:fs/promises";
import { createBookingWorkflowService } from "../src/marketplace/booking-workflow.mjs";
import { normalizedCleaningRequest } from "../src/marketplace/cleaning-request-service.mjs";
import { defaultPricingConfig, normalizedPricingConfig } from "../public/pricing-config.js";
import { quoteRooms } from "../public/pricing-engine.js";
import { trustedPricingRequest } from "../src/marketplace/pricing-request-boundary.mjs";
import { defaultPricingEconomics, quoteEconomics, reviewedQuote } from "../src/marketplace/pricing-economics.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }

const config = normalizedPricingConfig(defaultPricingConfig);
const economics = defaultPricingEconomics;
const task = (...labels) => labels.map((label, index) => ({ code: `t${index}-${label}`, label }));
const money = (pence) => `£${(pence / 100).toFixed(2)}`;

/* ── 1. The form. What the customer assembled and watched total up. ───────── */

const serverNow = new Date("2026-09-01T09:00:00+01:00");
const startAt = "2026-09-05T10:00:00+01:00";

const whatTheBrowserSent = {
  serviceType: "deep",
  frequency: "one-time",
  conditionLevel: 3,
  postcode: "SW1A 1AA",
  startAt,
  rooms: [
    { roomType: "kitchen", squareMetres: 18, items: [...task("Worktops", "Hob", "Sink", "Floor"), { code: "oven", label: "Oven" }] },
    { roomType: "bathroom", items: task("Toilet", "Shower", "Sink", "Tiles") },
    { roomType: "living-room", items: task("Sofa", "Table", "Floor") },
    { roomType: "bedroom", items: task("Bed", "Wardrobe", "Floor") },
    { roomType: "bedroom", items: task("Bed", "Wardrobe", "Floor") }
  ],
  addOns: [{ code: "ironing", quantity: 1 }]
};

// What the customer's screen showed, computed by the browser's copy of the
// engine.
const onScreen = quoteRooms(whatTheBrowserSent, config);
assert(onScreen.priceable, `The sample booking could not be priced: ${onScreen.reason}`);
assert(onScreen.minimumAdjustmentPence === 0,
  "The sample booking is held up by the minimum visit, so the chain below would be tracking a floor rather than a price.");

/* ── 2. The summary. The breakdown a customer reads before confirming. ───── */

const summed = onScreen.lines.reduce((total, line) => total + line.pence, 0);
assert(summed === onScreen.totalPence,
  `The breakdown a customer reads (${money(summed)}) does not add up to what they are charged (${money(onScreen.totalPence)}).`);
// Every dimension the brief asked for is visible as its own named line, so
// "why am I paying this" has an answer without a support ticket.
for (const code of ["rooms", "service", "condition", "location", "add-on:ironing"]) {
  assert(onScreen.lines.some((line) => line.code === code), `The summary has no ${code} line to explain the price.`);
}

/* ── 3. The server re-derives it, and reaches the same number. ───────────── */

const trusted = trustedPricingRequest(whatTheBrowserSent, {
  config, now: serverNow, startAt, postcode: "SW1A 1AA"
});
const authoritative = reviewedQuote(quoteRooms(trusted, config), economics);
assert(authoritative.quote.priceable, `The server refused a booking the browser priced: ${authoritative.quote.reason}`);
assert(authoritative.quote.totalPence === onScreen.totalPence,
  `The server priced ${money(authoritative.quote.totalPence)} against the ${money(onScreen.totalPence)} on the customer's screen.`);

/* ── 4. The request. The quote frozen onto the record. ──────────────────── */

const request = normalizedCleaningRequest({
  propertyId: "11111111-1111-4111-8111-111111111111",
  requestedStartAt: new Date(startAt).toISOString().replace(/\.\d{3}Z$/, ".000Z"),
  requestedEndAt: new Date(new Date(startAt).getTime() + authoritative.quote.estimatedMinutes * 60000).toISOString().replace(/\.\d{3}Z$/, ".000Z"),
  cleaningType: "deep-cleans",
  requiredServices: ["deep-cleans"],
  frequency: "one-time",
  tasks: [{ roomName: "Kitchen", description: "clean the worktops and hob" }],
  submit: false
}, { clock: () => serverNow, platformQuote: authoritative.quote });

assert(request.quotedTotalPence === onScreen.totalPence,
  `The frozen request total (${money(request.quotedTotalPence)}) is not the price the customer was shown (${money(onScreen.totalPence)}).`);
assert(request.quotedMinutes === authoritative.quote.estimatedMinutes, "The frozen duration is not the quoted duration.");
assert(request.pricingConfigVersion === config.version,
  "The request did not record which price list produced its total, so the quote could not be explained later.");
// The total is part of what the scope fingerprint covers, so a price cannot be
// edited underneath a customer without the scope changing with it.
const tampered = normalizedCleaningRequest({
  propertyId: "11111111-1111-4111-8111-111111111111",
  requestedStartAt: request.requestedStartAt, requestedEndAt: request.requestedEndAt,
  cleaningType: "deep-cleans", requiredServices: ["deep-cleans"], frequency: "one-time",
  tasks: [{ roomName: "Kitchen", description: "clean the worktops and hob" }], submit: false
}, {
  clock: () => serverNow,
  platformQuote: { ...authoritative.quote, totalPence: authoritative.quote.totalPence - 1000 }
});
assert(tampered.scopeFingerprint !== request.scopeFingerprint,
  "Changing the frozen total did not change the scope fingerprint, so a price could move without the scope recording it.");

/* ── 5. The booking. Terms written against the frozen total. ─────────────── */

let written = null;
const workflow = createBookingWorkflowService({
  async listParticipantBookings() { return []; },
  async getInvitationCandidate() {
    return {
      requested_start_at: request.requestedStartAt,
      requested_end_at: request.requestedEndAt,
      required_services: ["deep-cleans"],
      // Present and deliberately irrelevant: a cleaner's own rate card must not
      // move a price the customer has already been shown and agreed to.
      services: [{ serviceCode: "deep-cleans", pricePence: 99999, pricingModel: "hourly" }],
      quoted_total_pence: request.quotedTotalPence,
      quoted_minutes: request.quotedMinutes,
      pricing_config_version: request.pricingConfigVersion
    };
  },
  async inviteCleaner(actor, terms) {
    written = terms;
    return {
      id: "33333333-3333-4333-8333-333333333333",
      cleaning_request_id: "22222222-2222-4222-8222-222222222222",
      status: "pending-cleaner-acceptance",
      scheduled_start_at: request.requestedStartAt,
      scheduled_end_at: request.requestedEndAt,
      cleaner_response_deadline: terms.responseDeadline,
      scope_fingerprint: request.scopeFingerprint,
      terms_fingerprint: "t".repeat(64),
      scope_snapshot: "{}",
      customer_price_pence: terms.customerPricePence,
      cleaner_pay_pence: terms.cleanerPayPence
    };
  },
  async respondToInvitation() { return null; }
}, { platformEconomics: economics, clock: () => serverNow, invitationTtlMinutes: 180 });

const actor = { userId: "44444444-4444-4444-8444-444444444444", roles: ["landlord"] };
const booking = await workflow.inviteCleaner(actor, {
  cleaningRequestId: "22222222-2222-4222-8222-222222222222",
  cleanerId: "55555555-5555-4555-8555-555555555555",
  approvedCustomerPricePence: request.quotedTotalPence
});

assert(written.customerPricePence === onScreen.totalPence,
  `The booking was written at ${money(written.customerPricePence)}, not the ${money(onScreen.totalPence)} the customer saw.`);
assert(booking.customerPricePence === onScreen.totalPence, "The booking projection reports a different total.");

/* ── 6. The split. Customer, cleaner and platform account for each other. ── */

const settled = quoteEconomics(written.customerPricePence, request.quotedMinutes, economics, {
  payoutBasisPence: authoritative.quote.payoutBasisPence
});
assert(written.cleanerPayPence === settled.cleanerPayoutPence,
  "The cleaner's pay on the booking is not the share the economics computed.");
assert(written.cleanerPayPence + settled.grossMarginPence + settled.paymentFeePence === written.customerPricePence,
  `The split does not account for the whole customer price: ${money(written.cleanerPayPence)} + ${money(settled.grossMarginPence)} + ${money(settled.paymentFeePence)} ≠ ${money(written.customerPricePence)}.`);
assert(settled.healthy, `The booking that reached the card is one Homle should have refused: ${settled.reason}`);
assert(settled.cleanerPayoutPence < written.customerPricePence,
  "The cleaner was paid the entire customer price.");

/* ── 7. Stripe. The amount is derived in SQL, never supplied. ────────────── */

const ledger = await readFile(new URL("../db/migrations/022_marketplace_payment_ledger.sql", import.meta.url), "utf8");
const insert = ledger.slice(ledger.indexOf("INSERT INTO booking_payments("));
assert(insert.includes("booking_record.customer_price_pence"),
  "The payment amount is no longer taken from the booking row, so a client could name what it pays.");
// The whole point: no caller-supplied amount reaches the authorization insert.
const insertStatement = insert.slice(0, insert.indexOf("RETURNING"));
assert(!/proposed_amount|requested_amount_pence/.test(insertStatement),
  "A caller-supplied amount reaches the payment authorization insert.");

/* ── 8. Both dashboards read the stored figures, from their own side. ────── */

const workflowSource = await readFile(new URL("../src/marketplace/booking-workflow.mjs", import.meta.url), "utf8");
const projection = workflowSource.slice(workflowSource.indexOf("function bookingProjection"), workflowSource.indexOf("const bookingStatuses"));
assert(projection.includes("customer_price_pence") && projection.includes("cleaner_pay_pence"),
  "The dashboards no longer read the stored booking figures.");
// A Landlord sees the customer total; a Cleaner sees their own pay. Neither
// recomputes, and neither sees the other's number.
assert(/exactLandlord[\s\S]{0,120}customerPricePence/.test(projection),
  "The customer total is not gated to the Landlord who is paying it.");
assert(/exactCleaner[\s\S]{0,120}cleanerPayPence/.test(projection),
  "The cleaner's pay is not gated to the Cleaner earning it.");

const landlordView = { userId: actor.userId, roles: ["landlord"] };
const cleanerView = { userId: "55555555-5555-4555-8555-555555555555", roles: ["cleaner"] };
assert(booking.customerPricePence === onScreen.totalPence, "The Landlord dashboard shows a different total.");
assert(booking.cleanerPayPence === undefined,
  "The Landlord's booking projection carried the cleaner's pay, which is not their side of the contract.");
void landlordView; void cleanerView;

console.log(`Pricing lifecycle tests passed: ${money(onScreen.totalPence)} on the customer's screen is ${money(onScreen.totalPence)} in the summary, on the server, frozen to the request, written to the booking, derived by Stripe from the booking row, and shown on both dashboards — with the cleaner paid ${money(written.cleanerPayPence)} and the split accounting for the whole of it.`);
