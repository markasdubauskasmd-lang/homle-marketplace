// Turns a scan into an explained price estimate, using business rules only.
//
// Phase 6 of docs/ROOM_SCAN_ARCHITECTURE_AUDIT.md. Two hard constraints shape
// everything below, and both come from the brief rather than from taste:
//
//   * **No generative model is the pricing authority.** The vision reader
//     produces observations — what is in the room and what state it is in.
//     Money is produced here, by arithmetic over a stored ruleset, and every
//     line of it can be recomputed and argued with afterwards.
//
//   * **This does not replace the existing quote.** booking-workflow.mjs
//     `quote()` remains the only thing that prices a real booking: it is
//     margin-safe, binary-searched against the cleaner's own rates, and it
//     refuses to price rather than guessing. What this adds is a customer-facing
//     *estimate* from the scan, and a labour-minutes figure that can be compared
//     against reviewed quotes before anything is allowed to depend on it.
//
// The estimate is always an estimate. `isEstimate` is true on every result this
// module can produce, and there is no argument that clears it.

import { levelDescriptor } from "./cleaning-complexity.mjs";

export const pricingRulesetVersion = 1;

// The shipped defaults. Every one of these is meant to be changed by an
// operator through the administrator interface without a deployment, which is
// why they live in a stored ruleset rather than in this file — these are the
// values used when nothing has been configured yet.
export const defaultPricingRuleset = Object.freeze({
  rulesetId: "default",
  version: pricingRulesetVersion,
  // Below this a visit does not cover getting there.
  minimumChargePence: 4500,
  // What the customer pays per hour of cleaning labour.
  hourlyRatePence: 2800,
  // Charged once per room, for the fixed cost of setting up and moving between
  // rooms that hourly time alone under-counts.
  roomBasePence: 400,
  // Applied to the labour subtotal. Level 5 is zero because it is not
  // priceable: it means a person must look first.
  levelMultiplierBasisPoints: Object.freeze({ 1: 9000, 2: 10000, 3: 12500, 4: 15000, 5: 0 }),
  // Only ever applied when a room has a usable floor-area measurement. With no
  // measurement this contributes nothing at all rather than assuming a size.
  perSquareMetrePence: 90,
  // How wide the quoted range is, before the scan's own uncertainty widens it.
  baseRangeBasisPoints: 1500,
  // Added to the range for every unresolved reading, so a scan full of
  // questions produces a visibly vaguer price rather than a falsely precise one.
  unresolvedRangeBasisPointsEach: 200,
  maximumRangeBasisPoints: 6000
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
 * Deliberately strict. This is the object an administrator edits through a web
 * form, and a typo in it changes what every customer is charged. Anything
 * outside a reviewed range is refused rather than clamped, because a clamped
 * rate would quietly price at a number nobody chose.
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

// Floor area only where a measurement genuinely supports it.
//
// A room with no usable measurement contributes no size adjustment at all. The
// alternative — assuming an average room size — would put a number in the price
// that nothing observed, which is the failure this whole feature exists to
// avoid. A room that was not measured is priced on its contents alone, and the
// breakdown says so.
function measuredSquareMetres(rooms) {
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

function money(pence) {
  return Math.max(0, Math.round(pence));
}

/**
 * The estimate.
 *
 * @param scan        the projected scan, including its complexity assessment
 * @param ruleset     a normalised pricing ruleset
 * @param addOns      [{ code, label, pence }] chosen by the customer
 */
export function estimateScanPrice(scan = {}, ruleset = defaultPricingRuleset, addOns = []) {
  const rules = normalizedPricingRuleset(ruleset);
  const complexity = scan?.complexity;
  const rooms = Array.isArray(scan?.rooms) ? scan.rooms : [];

  const refusal = (code, reason) => Object.freeze({
    priceable: false, code, reason, isEstimate: true,
    rulesetId: rules.rulesetId, rulesetVersion: rules.version,
    totalPence: 0, lowPence: 0, highPence: 0, labourMinutes: 0,
    lines: Object.freeze([]), requiresConfirmation: Object.freeze([])
  });

  // Refusing to price is a real answer, and the existing quote engine already
  // takes it seriously. An estimate produced from nothing would be the most
  // damaging output this module could make.
  if (!complexity?.assessed) return refusal("scan-not-assessed", "This scan has not been assessed yet, so it cannot be estimated.");
  if (complexity.level === 5) {
    return refusal("specialist-review-required",
      `${complexity.explanation} A person needs to look at this before a price can be given.`);
  }

  const labourMinutes = integer(complexity.estimatedMinutes, 0);
  if (labourMinutes <= 0) return refusal("no-labour-estimate", "This scan does not support a cleaning-time estimate.");

  const lines = [];

  // 1. Labour, from the complexity model's duration.
  const labourPence = money((labourMinutes / 60) * rules.hourlyRatePence);
  lines.push({
    code: "labour", label: `Cleaning time — ${Math.round(labourMinutes / 6) / 10} hours at £${(rules.hourlyRatePence / 100).toFixed(2)}/hour`,
    pence: labourPence
  });

  // 2. Per-room setup.
  const roomBasePence = money(rooms.length * rules.roomBasePence);
  if (roomBasePence) {
    lines.push({ code: "rooms", label: `${rooms.length} ${rooms.length === 1 ? "room" : "rooms"} at £${(rules.roomBasePence / 100).toFixed(2)} each`, pence: roomBasePence });
  }

  // 3. Condition. Stated as an adjustment against the standard rate so the
  //    customer can see what their home's condition actually cost them.
  const multiplier = rules.levelMultiplierBasisPoints[complexity.level] ?? basisPointDivisor;
  const subtotalBeforeCondition = labourPence + roomBasePence;
  const conditionPence = Math.round((subtotalBeforeCondition * multiplier) / basisPointDivisor) - subtotalBeforeCondition;
  if (conditionPence !== 0) {
    lines.push({
      code: "condition",
      label: `${levelDescriptor(complexity.level).label} — ${conditionPence > 0 ? "adds" : "reduces by"} ${Math.abs(Math.round((multiplier - basisPointDivisor) / 100))}%`,
      pence: conditionPence
    });
  }

  // 4. Size, only where something was measured.
  const { squareMetres, measuredRooms } = measuredSquareMetres(rooms);
  const sizePence = money(squareMetres * rules.perSquareMetrePence);
  if (measuredRooms && sizePence) {
    lines.push({
      code: "size",
      label: `${squareMetres}m² measured across ${measuredRooms} ${measuredRooms === 1 ? "room" : "rooms"} at £${(rules.perSquareMetrePence / 100).toFixed(2)}/m²`,
      pence: sizePence
    });
  }

  // 5. Chosen add-ons.
  let addOnPence = 0;
  for (const addOn of Array.isArray(addOns) ? addOns.slice(0, 10) : []) {
    const pence = integer(addOn?.pence, 0);
    if (pence <= 0 || pence > 100000) continue;
    addOnPence += pence;
    lines.push({ code: `add-on:${String(addOn?.code || "").slice(0, 40)}`, label: String(addOn?.label || "Extra").slice(0, 80), pence });
  }

  const beforeMinimum = labourPence + roomBasePence + conditionPence + sizePence + addOnPence;
  const totalPence = Math.max(rules.minimumChargePence, beforeMinimum);
  if (totalPence > beforeMinimum) {
    lines.push({ code: "minimum", label: `Minimum visit charge of £${(rules.minimumChargePence / 100).toFixed(2)}`, pence: totalPence - beforeMinimum });
  }

  // The range widens with the number of unanswered questions, so a scan the
  // customer has not finished checking produces a visibly vaguer price rather
  // than a falsely precise one.
  const questionCount = Array.isArray(complexity.questions) ? complexity.questions.length : 0;
  const rangeBasisPoints = Math.min(
    rules.maximumRangeBasisPoints,
    rules.baseRangeBasisPoints + questionCount * rules.unresolvedRangeBasisPointsEach
  );

  return Object.freeze({
    priceable: true,
    code: "",
    reason: "",
    // No argument clears this. A scan-derived figure is an estimate until a
    // cleaner has accepted the exact scope, which is what booking-workflow's
    // quote() exists to price.
    isEstimate: true,
    rulesetId: rules.rulesetId,
    rulesetVersion: rules.version,
    complexityLevel: complexity.level,
    complexityModelVersion: complexity.modelVersion,
    labourMinutes,
    // Carried through so nothing downstream mistakes an uncalibrated duration
    // for a measured one.
    labourCalibrated: complexity.durationCalibrated === true,
    totalPence,
    lowPence: money(totalPence * (1 - rangeBasisPoints / basisPointDivisor)),
    highPence: money(totalPence * (1 + rangeBasisPoints / basisPointDivisor)),
    rangeBasisPoints,
    measuredSquareMetres: squareMetres,
    measuredRooms,
    lines: Object.freeze(lines.map((line) => Object.freeze(line))),
    // The explanation the customer is owed: what was assumed, and what would
    // move the number.
    explanation: complexity.explanation,
    requiresConfirmation: Object.freeze((Array.isArray(complexity.questions) ? complexity.questions : []).map((question) => Object.freeze({
      code: question.code, roomName: question.roomName, question: question.question
    })))
  });
}

/**
 * Shadow comparison against a reviewed figure.
 *
 * The scan-derived estimate is not allowed to influence anything until the
 * error against human-reviewed quotes has been measured. This produces that
 * measurement in a form that can be aggregated, and deliberately returns no
 * verdict: whether 18% error is acceptable is a business decision, not one this
 * module should encode.
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
