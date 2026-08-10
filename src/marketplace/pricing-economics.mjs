// What a booking does to the business — and the refusal when the answer is bad.
//
// SERVER ONLY, DELIBERATELY.
//
// public/pricing-engine.js is served to the browser so the scanner can price
// instantly without a round trip. That makes everything in it readable by
// anyone with developer tools open. What a cleaner is paid, what the processor
// takes and where the margin floor sits are commercial facts that do not belong
// on a customer's machine, so they live here and never move.
//
// The split costs nothing in correctness: the CUSTOMER price is computed by the
// same module on both sides, so the number on the scanner and the number the
// server authorises come from identical arithmetic. This file only decides
// whether that number is one Homle is willing to sell at.
//
// TARGET MARGIN, AND WHY 20% IS THE FLOOR RATHER THAN THE GOAL
//
// The configured cleaner share is 70%, which leaves 30% gross before the
// processor. Stripe UK domestic takes 1.5% + 20p, so a realistic booking lands
// near 28% — that is the goal, and it is what every scenario in the test suite
// actually produces. The floor is set at 20% so that a discount, a small
// booking or an operator's edit has somewhere to move before the booking stops
// being worth taking. A floor set at the goal would refuse ordinary bookings.
//
// For comparison: TaskRabbit takes 15% and several cleaning platforms take
// around 20%. Homle sits above both because it sets and guarantees the price
// rather than passing through a rate the cleaner chose, and it carries the
// refund risk when a clean is not right.

const basisPointDivisor = 10000;

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

function formatPounds(value) {
  return `£${(value / 100).toFixed(2)}`;
}

// Stripe UK domestic card pricing is 1.5% + 20p at the time of writing.
// Configured rather than assumed, so a change of processor or of terms is one
// edit here.
//
// VAT is deliberately absent. Homle is below the registration threshold, and
// adding a VAT line before registering would overcharge every customer. When
// that changes it belongs here as its own field, not folded into the margin.
export const defaultPricingEconomics = Object.freeze({
  cleanerShareBasisPoints: 7000,
  paymentFeeBasisPoints: 150,
  paymentFeeFixedPence: 20,
  targetGrossMarginBasisPoints: 2000,
  minimumContributionPence: 600,
  // What a cleaner must clear per hour for the work to be worth accepting. The
  // National Living Wage is £12.71 from April 2026; these cleaners are
  // self-employed so it does not bind them, but a platform paying under it will
  // not hold supply. This is the guard that catches a room base edited down
  // without its minutes — a change that looks harmless and quietly turns a
  // £45 visit into ninety minutes of work.
  cleanerHourlyFloorPence: 1500
});

export function normalizedPricingEconomics(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const economics = Object.freeze({
    cleanerShareBasisPoints: count(source.cleanerShareBasisPoints ?? defaultPricingEconomics.cleanerShareBasisPoints, 3000, 9500, "Cleaner share"),
    paymentFeeBasisPoints: count(source.paymentFeeBasisPoints ?? defaultPricingEconomics.paymentFeeBasisPoints, 0, 1000, "Payment fee"),
    paymentFeeFixedPence: pence(source.paymentFeeFixedPence ?? defaultPricingEconomics.paymentFeeFixedPence, 0, 10000, "Fixed payment fee"),
    targetGrossMarginBasisPoints: count(source.targetGrossMarginBasisPoints ?? defaultPricingEconomics.targetGrossMarginBasisPoints, 0, 8000, "Target gross margin"),
    minimumContributionPence: pence(source.minimumContributionPence ?? defaultPricingEconomics.minimumContributionPence, 0, 100000, "Minimum contribution"),
    cleanerHourlyFloorPence: pence(source.cleanerHourlyFloorPence ?? defaultPricingEconomics.cleanerHourlyFloorPence, 0, 20000, "Cleaner hourly floor")
  });
  // The one cross-field rule worth refusing on: if the cleaner's share plus the
  // processor's cut leaves less than the target margin, every booking priced
  // under this configuration loses money. Better to reject the configuration
  // than to discover it one settlement at a time.
  if (economics.cleanerShareBasisPoints + economics.paymentFeeBasisPoints + economics.targetGrossMarginBasisPoints > basisPointDivisor) {
    throw new TypeError("Cleaner share, payment fee and target margin exceed the whole booking value.");
  }
  return economics;
}

/**
 * The unit economics of one booking.
 *
 * Computed per quote rather than in a reporting job afterwards, because a
 * margin that is only visible in a monthly report is a margin nobody defends at
 * the moment it is given away.
 */
export function quoteEconomics(totalPence, estimatedMinutes, economicsInput = defaultPricingEconomics) {
  const economics = normalizedPricingEconomics(economicsInput);

  const customerPaysPence = Math.max(0, Math.round(Number(totalPence) || 0));
  const cleanerPayoutPence = Math.round(customerPaysPence * economics.cleanerShareBasisPoints / basisPointDivisor);
  const paymentFeePence = economics.paymentFeeFixedPence + Math.ceil(customerPaysPence * economics.paymentFeeBasisPoints / basisPointDivisor);
  const platformRevenuePence = customerPaysPence - cleanerPayoutPence;
  const grossMarginPence = platformRevenuePence - paymentFeePence;
  const grossMarginBasisPoints = customerPaysPence > 0
    ? Math.round((grossMarginPence / customerPaysPence) * basisPointDivisor)
    : 0;

  const minutes = Math.max(Number(estimatedMinutes) || 0, 1);
  const effectiveCleanerHourlyPence = Math.round(cleanerPayoutPence / (minutes / 60));

  let reason = "";
  if (grossMarginPence < economics.minimumContributionPence) {
    reason = `it contributes ${formatPounds(grossMarginPence)} against a ${formatPounds(economics.minimumContributionPence)} minimum`;
  } else if (grossMarginBasisPoints < economics.targetGrossMarginBasisPoints) {
    reason = `its margin is ${(grossMarginBasisPoints / 100).toFixed(1)}% against a ${(economics.targetGrossMarginBasisPoints / 100).toFixed(1)}% target`;
  } else if (effectiveCleanerHourlyPence < economics.cleanerHourlyFloorPence) {
    // Not a margin failure — the opposite. The booking is profitable but pays
    // the cleaner too little per hour to be accepted, which surfaces as jobs
    // nobody takes rather than as money lost.
    reason = `it would pay the cleaner ${formatPounds(effectiveCleanerHourlyPence)}/hour against a ${formatPounds(economics.cleanerHourlyFloorPence)}/hour floor`;
  }

  return Object.freeze({
    customerPaysPence,
    cleanerPayoutPence,
    paymentFeePence,
    platformRevenuePence,
    grossMarginPence,
    grossMarginBasisPoints,
    estimatedMinutes: Math.round(Number(estimatedMinutes) || 0),
    effectiveCleanerHourlyPence,
    cleanerShareBasisPoints: economics.cleanerShareBasisPoints,
    healthy: reason === "",
    reason
  });
}

/**
 * A quote, checked.
 *
 * Returns the customer-facing quote unchanged when it is one Homle is willing
 * to sell, and an unpriceable result when it is not. The economics never travel
 * with the customer-facing payload — callers that need them (the admin preview,
 * the booking record) ask for them separately.
 */
export function reviewedQuote(quote, economicsInput = defaultPricingEconomics) {
  if (!quote?.priceable) return { quote, economics: null };
  const economics = quoteEconomics(quote.totalPence, quote.estimatedMinutes, economicsInput);
  if (economics.healthy) return { quote, economics };
  return {
    quote: Object.freeze({
      priceable: false,
      code: "margin-floor",
      // Deliberately not the operator-facing reason: a customer does not need
      // to be told what Homle's margin is, only that this selection needs a
      // person. The detailed reason stays in `economics` for the admin view.
      reason: "This selection needs a quick check by our team before we can price it.",
      currency: "GBP",
      configId: quote.configId,
      configVersion: quote.configVersion,
      totalPence: 0,
      estimatedMinutes: quote.estimatedMinutes,
      rooms: Object.freeze([]),
      lines: Object.freeze([])
    }),
    economics
  };
}
