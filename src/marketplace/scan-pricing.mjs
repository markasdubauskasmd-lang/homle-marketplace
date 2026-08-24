// Turns a scan into an explained price estimate.
//
// WHAT CHANGED, AND WHY IT MATTERS MORE THAN IT LOOKS
//
// This module used to hold a SECOND complete pricing system: its own hourly
// rate, its own per-room charge, its own condition multipliers, its own
// square-metre rate and its own minimum charge — all operator-editable through
// the scan-pricing admin screen, while the price list that actually charged was
// operator-editable through a different admin screen backed by a different
// table. Both shipped £28.00/hour and a £45.00 minimum. Nothing compared them,
// so raising the rate on one screen moved half the product and silently left
// the other half behind.
//
// The money is now computed by public/pricing-engine.js — the same function the
// browser runs, the same function the server authorises a booking with. This
// module's remaining job is the part that is genuinely its own: expressing how
// UNCERTAIN the reading is, as a range around that number, and refusing to
// estimate at all when the scan does not support one.
//
// The rate fields below are still accepted so that rulesets stored before this
// change continue to load, and they are still bounded. They no longer affect
// any price. See docs/PRICING_MODEL.md.
//
// TWO CONSTRAINTS THAT DID NOT CHANGE
//
//   * **No generative model is the pricing authority.** The vision reader
//     produces observations — what is in the room and what state it is in.
//     Money is produced by arithmetic over a reviewed price list, and every
//     line of it can be recomputed and argued with afterwards.
//
//   * **The estimate is always an estimate.** `isEstimate` is true on every
//     result this module can produce and there is no argument that clears it.
//     The range exists to express uncertainty about what is IN the room; once
//     the customer has confirmed the list, quoteRooms() is asked directly and
//     returns the single number there is no uncertainty left to widen.

import { defaultPricingConfig, normalizedPricingConfig } from "../../public/pricing-config.js";
import { quoteInputFromScan, quoteRooms } from "../../public/pricing-engine.js";
import { levelDescriptor } from "./cleaning-complexity.mjs";

export const pricingRulesetVersion = 1;

// The shipped defaults. Only the three range fields are live; the rest are
// retained so stored rulesets keep loading and are marked below.
export const defaultPricingRuleset = Object.freeze({
  rulesetId: "default",
  version: pricingRulesetVersion,

  /* ── Live: how wide the estimate's range is ────────────────────────────── */

  // How wide the quoted range is, before the scan's own uncertainty widens it.
  baseRangeBasisPoints: 1500,
  // Added to the range for every unresolved reading, so a scan full of
  // questions produces a visibly vaguer price rather than a falsely precise one.
  unresolvedRangeBasisPointsEach: 200,
  maximumRangeBasisPoints: 6000,

  /* ── Retained, no longer used ──────────────────────────────────────────── */
  //
  // Every one of these now lives in public/pricing-config.js, where it is the
  // single owner of that number for the whole product. They are kept here so a
  // ruleset published before the change still validates and still loads; they
  // are not read by estimateScanPrice() and changing them changes nothing.
  minimumChargePence: 4500,
  hourlyRatePence: 2800,
  roomBasePence: 400,
  levelMultiplierBasisPoints: Object.freeze({ 1: 9000, 2: 10000, 3: 12500, 4: 15000, 5: 0 }),
  perSquareMetrePence: 90
});

const basisPointDivisor = 10000;

function integer(value, fallback = 0) {
  const supplied = Number(value);
  return Number.isInteger(supplied) ? supplied : fallback;
}

function positiveInteger(value, minimum, maximum, label) {
  const supplied = Number(value);
  if (!Number.isInteger(supplied) || supplied < minimum || supplied > maximum) {
    throw new TypeError(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return supplied;
}

/**
 * Validates a stored or operator-supplied ruleset.
 *
 * Still deliberately strict on the retained rate fields even though nothing
 * reads them. A stored ruleset is data an operator can still edit through the
 * administrator interface, and accepting nonsense into a table because it
 * happens to be unused today is how it becomes a live surprise tomorrow.
 */
export function normalizedPricingRuleset(input = {}) {
  const multipliers = input.levelMultiplierBasisPoints || {};
  const normalizedMultipliers = {};
  for (const level of [1, 2, 3, 4, 5]) {
    const supplied = multipliers[level] ?? multipliers[String(level)] ?? defaultPricingRuleset.levelMultiplierBasisPoints[level];
    // Level 5 must stay unpriceable. An operator who could set a multiplier on
    // it could put a price on "a person needs to look at this first".
    if (level === 5) { normalizedMultipliers[5] = 0; continue; }
    normalizedMultipliers[level] = positiveInteger(supplied, 5000, 30000, `Level ${level} multiplier`);
  }
  return Object.freeze({
    rulesetId: String(input.rulesetId || "default").slice(0, 40),
    version: positiveInteger(input.version ?? pricingRulesetVersion, 1, 1000, "Ruleset version"),
    minimumChargePence: positiveInteger(input.minimumChargePence ?? defaultPricingRuleset.minimumChargePence, 500, 100000, "Minimum charge"),
    hourlyRatePence: positiveInteger(input.hourlyRatePence ?? defaultPricingRuleset.hourlyRatePence, 500, 30000, "Hourly rate"),
    roomBasePence: positiveInteger(input.roomBasePence ?? defaultPricingRuleset.roomBasePence, 0, 20000, "Room base charge"),
    levelMultiplierBasisPoints: Object.freeze(normalizedMultipliers),
    perSquareMetrePence: positiveInteger(input.perSquareMetrePence ?? defaultPricingRuleset.perSquareMetrePence, 0, 2000, "Square-metre rate"),
    baseRangeBasisPoints: positiveInteger(input.baseRangeBasisPoints ?? defaultPricingRuleset.baseRangeBasisPoints, 0, 5000, "Base range"),
    unresolvedRangeBasisPointsEach: positiveInteger(input.unresolvedRangeBasisPointsEach ?? defaultPricingRuleset.unresolvedRangeBasisPointsEach, 0, 2000, "Per-question range"),
    maximumRangeBasisPoints: positiveInteger(input.maximumRangeBasisPoints ?? defaultPricingRuleset.maximumRangeBasisPoints, 500, 9000, "Maximum range")
  });
}

function money(pence) {
  return Math.max(0, Math.round(pence));
}

// Reported rather than charged: the engine prices each room's excess area
// against that room type's expected size. This is the headline figure the
// estimate shows so a customer can see how much of their home was measured.
function measuredSummary(rooms) {
  let squareMetres = 0;
  let measuredRooms = 0;
  for (const room of rooms) {
    const area = (Array.isArray(room?.measurements) ? room.measurements : [])
      .find((measurement) => measurement?.subject === "floor-area"
        && measurement.confidence !== "unusable"
        && Number(measurement.valueMm) > 0);
    if (!area) continue;
    measuredRooms += 1;
    squareMetres += Number(area.valueMm) / 1_000_000;
  }
  return { squareMetres: Math.round(squareMetres * 10) / 10, measuredRooms };
}

/**
 * The estimate.
 *
 * @param scan     the projected scan, including its complexity assessment
 * @param ruleset  a normalised pricing ruleset (range parameters only)
 * @param addOns   [{ code }] chosen by the customer, resolved by the engine
 *                 against the published price list — never priced from the
 *                 request, because a client that could name its own price for
 *                 an extra could name any price
 * @param options  { config, serviceType, frequency, postcode, startAt, now }
 */
export function estimateScanPrice(scan = {}, ruleset = defaultPricingRuleset, addOns = [], options = {}) {
  const rules = normalizedPricingRuleset(ruleset);
  const config = normalizedPricingConfig(options.config ?? defaultPricingConfig);
  const complexity = scan?.complexity;
  const rooms = Array.isArray(scan?.rooms) ? scan.rooms : [];

  const refusal = (code, reason) => Object.freeze({
    priceable: false, code, reason, isEstimate: true,
    rulesetId: rules.rulesetId, rulesetVersion: rules.version,
    configId: config.configId, configVersion: config.version,
    totalPence: 0, lowPence: 0, highPence: 0, labourMinutes: 0,
    lines: Object.freeze([]), requiresConfirmation: Object.freeze([])
  });

  // Refusing to price is a real answer, and the booking path already takes it
  // seriously. An estimate produced from nothing would be the most damaging
  // output this module could make.
  if (!complexity?.assessed) return refusal("scan-not-assessed", "This scan has not been assessed yet, so it cannot be estimated.");
  if (complexity.level === 5) {
    return refusal("specialist-review-required",
      `${complexity.explanation} A person needs to look at this before a price can be given.`);
  }

  // THE UNIFICATION. Same adaptor the browser uses, same engine the server
  // authorises with. The condition grade travels with it rather than being
  // applied by a second set of multipliers that could disagree with the first.
  const quote = quoteRooms(quoteInputFromScan(scan, {
    serviceType: options.serviceType || "standard",
    frequency: options.frequency || "one-time",
    postcode: options.postcode || "",
    startAt: options.startAt || "",
    now: options.now || null,
    conditionLevel: complexity.level,
    addOns: (Array.isArray(addOns) ? addOns.slice(0, 10) : [])
      .map((addOn) => ({ code: String(addOn?.code || "").trim(), quantity: 1 }))
      .filter((addOn) => addOn.code)
  }), config);

  if (!quote.priceable) {
    return refusal(quote.code || "not-priceable", quote.reason || "This scan cannot be estimated.");
  }

  // The labour figure stays the complexity model's, not the engine's, because
  // it is what the accuracy work in scan-benchmark.mjs is calibrated against.
  // The engine's own duration is what a cleaner is booked for.
  const labourMinutes = integer(complexity.estimatedMinutes, 0);
  const { squareMetres, measuredRooms } = measuredSummary(rooms);

  // The range widens with the number of unanswered questions, so a scan the
  // customer has not finished checking produces a visibly vaguer price rather
  // than a falsely precise one. This is the ONLY thing the ruleset still does.
  const questionCount = Array.isArray(complexity.questions) ? complexity.questions.length : 0;
  const rangeBasisPoints = Math.min(
    rules.maximumRangeBasisPoints,
    rules.baseRangeBasisPoints + questionCount * rules.unresolvedRangeBasisPointsEach
  );

  return Object.freeze({
    priceable: true,
    code: "",
    reason: "",
    // No argument clears this. A scan-derived figure is an estimate until the
    // customer has confirmed the list of rooms and tasks it was read from.
    isEstimate: true,
    rulesetId: rules.rulesetId,
    rulesetVersion: rules.version,
    // Which price list produced the money, so an estimate can be explained
    // later by the rates that were actually live when it was given.
    configId: quote.configId,
    configVersion: quote.configVersion,
    complexityLevel: complexity.level,
    complexityModelVersion: complexity.modelVersion,
    conditionLabel: quote.conditionLabel,
    labourMinutes,
    // Carried through so nothing downstream mistakes an uncalibrated duration
    // for a measured one.
    labourCalibrated: complexity.durationCalibrated === true,
    estimatedMinutes: quote.estimatedMinutes,
    totalPence: quote.totalPence,
    lowPence: money(quote.totalPence * (1 - rangeBasisPoints / basisPointDivisor)),
    highPence: money(quote.totalPence * (1 + rangeBasisPoints / basisPointDivisor)),
    rangeBasisPoints,
    measuredSquareMetres: squareMetres,
    measuredRooms,
    // What the measured area actually added, summed across the rooms. The
    // engine charges it per room against that room type's expected size, so
    // there is no single top-level line to point at — but a customer who
    // measured their home is owed the figure.
    sizePence: quote.sizePence,
    conditionAdjustmentPence: quote.conditionAdjustmentPence,
    // The engine's own breakdown, unaltered. One set of lines, so the estimate
    // and the confirmed quote explain themselves in exactly the same words.
    lines: quote.lines,
    // The explanation the customer is owed: what was assumed, and what would
    // move the number.
    explanation: `${complexity.explanation} ${levelDescriptor(complexity.level).label} rates apply.`.trim(),
    requiresConfirmation: Object.freeze((Array.isArray(complexity.questions) ? complexity.questions : []).map((question) => Object.freeze({
      code: question.code, roomName: question.roomName, question: question.question
    })))
  });
}

/**
 * Shadow comparison against a reviewed figure.
 *
 * Kept from the era when the scan estimate ran on its own rates and had to be
 * measured against human-reviewed quotes before anything depended on it. It is
 * still the honest way to watch the COMPLEXITY model, whose room readings still
 * decide the condition multiplier and are still a generative reading of a photo.
 *
 * Deliberately returns no verdict: whether 18% error is acceptable is a business
 * decision, not one this module should encode.
 */
export function shadowComparison(estimate, reviewedTotalPence) {
  const reviewed = integer(reviewedTotalPence, 0);
  if (!estimate?.priceable || reviewed <= 0) {
    return Object.freeze({ comparable: false, reason: estimate?.priceable ? "no-reviewed-total" : estimate?.code || "not-priceable" });
  }
  const differencePence = estimate.totalPence - reviewed;
  return Object.freeze({
    comparable: true,
    estimatedPence: estimate.totalPence,
    reviewedPence: reviewed,
    differencePence,
    // Signed, so systematic over- or under-estimation is visible rather than
    // averaging itself away against the opposite error.
    relativeError: Math.round((differencePence / reviewed) * 10000) / 10000,
    withinQuotedRange: reviewed >= estimate.lowPence && reviewed <= estimate.highPence,
    rulesetId: estimate.rulesetId,
    rulesetVersion: estimate.rulesetVersion,
    complexityModelVersion: estimate.complexityModelVersion
  });
}
