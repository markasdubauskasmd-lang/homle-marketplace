// A quoted request books at the price it was quoted.
//
// This is the join between the pricing engine and the booking workflow, and it
// is the seam where "displayed equals charged" is either kept or lost. The
// customer price must survive from the scanner, through the invitation terms,
// to the payment amount without being recomputed by anything.

import { createBookingPricingPolicy, createBookingWorkflowService } from "../src/marketplace/booking-workflow.mjs";
import { defaultPricingConfig, normalizedPricingConfig } from "../public/pricing-config.js";
import { quoteRooms } from "../public/pricing-engine.js";
import { defaultPricingEconomics, quoteEconomics } from "../src/marketplace/pricing-economics.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }

const config = normalizedPricingConfig(defaultPricingConfig);
const task = (...labels) => labels.map((label, index) => ({ code: `t${index}-${label}`, label }));

/* The quote a customer would have been shown. */
const quote = quoteRooms({
  rooms: [
    { roomType: "kitchen", items: [...task("Worktops", "Hob", "Sink", "Floor"), { code: "oven", label: "Oven" }] },
    { roomType: "bathroom", items: task("Toilet", "Shower", "Sink") },
    { roomType: "bedroom", items: task("Bed", "Wardrobe", "Floor") }
  ]
}, config);
assert(quote.priceable, "The sample quote could not be priced.");

const start = new Date(Date.now() + 3 * 3600 * 1000);
const end = new Date(start.getTime() + quote.estimatedMinutes * 60000);

/* A request candidate carrying that quote, as migration 095 stores it. */
const quotedCandidate = {
  requested_start_at: start.toISOString(),
  requested_end_at: end.toISOString(),
  required_services: ["regular-domestic"],
  // Deliberately present AND deliberately irrelevant: the cleaner's own rate
  // must not move a price the customer has already been shown.
  services: [{ serviceCode: "regular-domestic", pricePence: 9999, pricingModel: "hourly" }],
  quoted_total_pence: quote.totalPence,
  quoted_minutes: quote.estimatedMinutes,
  pricing_config_version: config.version
};

const policy = createBookingPricingPolicy({
  targetMarginBasisPoints: 2000,
  minimumContributionPence: 600,
  paymentFeeBasisPoints: 150,
  paymentFeeFixedPence: 20,
  invitationTtlMinutes: 180
});

// invitationQuote is internal, so the terms are captured where they actually
// matter: at the repository boundary, which is what gets written onto the
// booking and later becomes the payment amount.
function serviceWith(options, candidate = quotedCandidate) {
  const captured = {};
  const service = createBookingWorkflowService({
    listParticipantBookings: async () => [],
    getInvitationCandidate: async () => candidate,
    inviteCleaner: async (_actor, record) => { Object.assign(captured, record); return bookingRow(record); },
    respondToInvitation: async () => ({})
  }, { pricingPolicy: policy, ...options });
  return { service, captured };
}

// The shape bookingProjection() expects back from a successful invitation.
function bookingRow(record) {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    cleaning_request_id: record.requestId,
    status: "pending-cleaner-acceptance",
    scheduled_start_at: start.toISOString(),
    scheduled_end_at: end.toISOString(),
    cleaner_response_deadline: record.responseDeadline,
    scope_fingerprint: "f".repeat(64),
    terms_fingerprint: "e".repeat(64),
    scope_snapshot: {},
    customer_price_pence: record.customerPricePence,
    cleaner_pay_pence: record.cleanerPayPence
  };
}

/** Prices a request and returns the terms that reached the repository. */
async function termsFor(options, candidate = quotedCandidate) {
  const { service, captured } = serviceWith(options, candidate);
  const preview = await service.previewInvitation(actor, { cleaningRequestId: requestId, cleanerId });
  await service.inviteCleaner(actor, {
    cleaningRequestId: requestId, cleanerId,
    approvedCustomerPricePence: preview.customerPricePence
  });
  return captured;
}

const actor = { userId: "11111111-1111-4111-8111-111111111111", roles: ["landlord"] };
const requestId = "22222222-2222-4222-8222-222222222222";
const cleanerId = "33333333-3333-4333-8333-333333333333";

/* ── The quoted price is the booked price ────────────────────────────────── */

const terms = await termsFor({ platformEconomics: defaultPricingEconomics });

assert(terms.customerPricePence === quote.totalPence,
  `The booking priced at ${terms.customerPricePence}p against a quote of ${quote.totalPence}p.`);

// And the cleaner is paid the configured share OF THAT, not of something the
// binary search arrived at.
const expected = quoteEconomics(quote.totalPence, quote.estimatedMinutes, defaultPricingEconomics);
assert(terms.cleanerPayPence === expected.cleanerPayoutPence,
  `The cleaner payout ${terms.cleanerPayPence}p is not the configured share ${expected.cleanerPayoutPence}p.`);
assert(terms.paymentFeePence === expected.paymentFeePence, "The payment fee does not match the economics.");
assert(terms.cleanerPayPence + terms.paymentFeePence + terms.targetContributionPence === terms.customerPricePence,
  "Payout, processor fee and contribution do not account for the whole customer price.");
assert(terms.quotedMinutes === quote.estimatedMinutes,
  "The cleaner is not told the visit length the customer paid for.");
assert(terms.pricingConfigVersion === config.version,
  "The booking does not record which price list produced its total.");

/* ── The cleaner's own rate cannot move it ───────────────────────────────── */

// Same request, a cleaner charging ten times as much. Under the cost-up path
// that would raise the customer price; under platform pricing it must not.
const dear = await termsFor({ platformEconomics: defaultPricingEconomics },
  { ...quotedCandidate, services: [{ serviceCode: "regular-domestic", pricePence: 99999, pricingModel: "hourly" }] });
assert(dear.customerPricePence === quote.totalPence,
  "A more expensive cleaner changed the price the customer had already been shown.");

/* ── A request with no quote still prices the old way ────────────────────── */

// The cost-up path must stay live: a bespoke job quoted against a cleaner's own
// rate card has no platform price to freeze, and every request that predates
// migration 095 is in exactly that position.
const legacyTerms = await termsFor({ platformEconomics: defaultPricingEconomics }, {
  requested_start_at: start.toISOString(),
  requested_end_at: end.toISOString(),
  required_services: ["regular-domestic"],
  services: [{ serviceCode: "regular-domestic", pricePence: 4000, pricingModel: "fixed" }]
});
assert(legacyTerms.customerPricePence > 4000,
  "A request without a platform quote was not priced cost-up from the cleaner's rate.");
assert(legacyTerms.quotedMinutes === undefined,
  "A cost-up booking claimed a quoted duration it never had.");

/* A stored quote must never fall back to the legacy cleaner-rate calculation.
   That would let the displayed scanner price differ from the booked total. */
let missingEconomicsRejected = false;
try {
  await termsFor({});
} catch (error) {
  missingEconomicsRejected = error.code === "pricing-not-configured";
}
assert(missingEconomicsRejected,
  "A stored customer quote silently fell back to a different pricing model.");

const dynamic = await termsFor({ getPlatformEconomics: async () => defaultPricingEconomics });
assert(dynamic.customerPricePence === quote.totalPence,
  "The runtime economics reader did not carry the stored scanner quote into booking terms.");

/* ── A quote that cannot pay everyone is refused at booking too ──────────── */

let refused = false;
try {
  await termsFor({ platformEconomics: { ...defaultPricingEconomics, minimumContributionPence: 100000 } });
} catch (error) {
  refused = error.code === "request-not-priceable";
}
assert(refused, "A booking that cannot clear its contribution floor was still allowed to be invited.");

console.log("Platform-priced booking tests passed: the quoted total survives to the invitation terms unchanged, the cleaner is paid the configured share of it, a dearer cleaner cannot move it, requests without a quote still price cost-up, and a quote that cannot pay everyone is refused.");
