import { assessCleaningComplexity, complexityModelVersion } from "./cleaning-complexity.mjs";
import { defaultPricingRuleset, estimateScanPrice, shadowComparison } from "./scan-pricing.mjs";
import { itemConditions, soilingKinds } from "./room-condition-vocabulary.mjs";

// Measures the scanner against labelled ground truth.
//
// The audit set acceptance criteria in §10 and then observed that none of them
// could be measured, because nothing recorded them and no dataset existed. This
// is the measurement. It is deliberately the last piece rather than the first:
// a metric computed before the thing it measures exists is a number nobody has
// to earn.
//
// WHAT A PASS HERE DOES AND DOES NOT MEAN
//
// This harness computes real statistics over whatever cases it is given. Run
// against synthetic fixtures it proves the harness works and locks in
// regression behaviour — it says nothing whatsoever about accuracy on real
// homes. Only cases collected from consented real scans can support an accuracy
// claim, and `datasetIsSynthetic` is carried through every report so that a
// number from a fixture run can never be quoted as one.
//
// Pure and deterministic: no clock, no network, no database. A benchmark that
// cannot be re-run to the same figure is not a benchmark.

export const benchmarkVersion = 1;

// The targets from §10 of the audit. Kept here so a report states what it was
// measured against, rather than leaving the reader to look them up and trust
// that they match.
export const benchmarkTargets = Object.freeze({
  objectPrecision: 0.85,
  objectRecall: 0.75,
  duplicateRate: 0.02,
  conditionAgreementKappa: 0.6,
  complexityWithinOne: 0.9,
  measurementErrorGuidedWeb: 0.2,
  priceErrorWithin: 0.15,
  priceErrorCoverage: 0.9
});

// Comparison is on the identity key, not the display label, for the same reason
// storage merges on it: "Tap" and "Bathroom tap" are one object, and counting
// them as a miss and a false positive would report a rename as two errors.
function key(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(?:the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function objectKeys(objects) {
  return (Array.isArray(objects) ? objects : [])
    .map((object) => key(object?.inventoryKey || object?.label))
    .filter(Boolean);
}

/**
 * Object detection, per case and then pooled.
 *
 * Pooled by summing the confusion matrix rather than by averaging per-room
 * rates. A macro average over rooms gives a one-object bathroom the same weight
 * as a twenty-object kitchen, which flatters a model that is good at small
 * rooms and hides where the work actually is.
 */
function detectionCounts(expected, observed) {
  const expectedCounts = new Map();
  for (const entry of expected) expectedCounts.set(entry, (expectedCounts.get(entry) || 0) + 1);
  const observedCounts = new Map();
  for (const entry of observed) observedCounts.set(entry, (observedCounts.get(entry) || 0) + 1);

  let truePositives = 0;
  let duplicates = 0;
  for (const [entry, observedCount] of observedCounts) {
    const expectedCount = expectedCounts.get(entry) || 0;
    truePositives += Math.min(expectedCount, observedCount);
    // More of the same object than the room contains is the duplicate-object
    // failure the tracker exists to prevent, counted separately from a wrong
    // label because it has a different cause and a different fix.
    if (observedCount > expectedCount) duplicates += observedCount - expectedCount;
  }
  return {
    truePositives,
    falsePositives: observed.length - truePositives,
    falseNegatives: expected.length - truePositives,
    duplicates,
    observed: observed.length,
    expected: expected.length
  };
}

/**
 * Cohen's kappa for per-object condition.
 *
 * Raw agreement is the wrong statistic here and the audit was right to specify
 * kappa. Most objects in most homes are clean or light, so a grader that always
 * answered "light" would score high raw agreement while being useless. Kappa
 * subtracts the agreement you would get by chance from the marginals, which is
 * exactly the flattery that needs removing.
 */
export function conditionAgreement(pairs) {
  const usable = (Array.isArray(pairs) ? pairs : []).filter((pair) =>
    itemConditions.includes(pair?.expected) && itemConditions.includes(pair?.observed));
  if (usable.length < 2) return { kappa: null, observedAgreement: null, pairs: usable.length };

  let agreed = 0;
  const expectedTotals = new Map();
  const observedTotals = new Map();
  for (const pair of usable) {
    if (pair.expected === pair.observed) agreed += 1;
    expectedTotals.set(pair.expected, (expectedTotals.get(pair.expected) || 0) + 1);
    observedTotals.set(pair.observed, (observedTotals.get(pair.observed) || 0) + 1);
  }
  const observedAgreement = agreed / usable.length;
  let chanceAgreement = 0;
  for (const condition of itemConditions) {
    chanceAgreement += ((expectedTotals.get(condition) || 0) / usable.length)
      * ((observedTotals.get(condition) || 0) / usable.length);
  }
  // Perfect chance agreement means one grade was used for everything by both
  // graders. Kappa is undefined there, and reporting 1 would claim agreement
  // that carries no information.
  if (chanceAgreement >= 1) return { kappa: null, observedAgreement, pairs: usable.length };
  return {
    kappa: Math.round(((observedAgreement - chanceAgreement) / (1 - chanceAgreement)) * 10000) / 10000,
    observedAgreement: Math.round(observedAgreement * 10000) / 10000,
    pairs: usable.length
  };
}

/**
 * Confidence calibration, as a Brier score over the condition readings.
 *
 * Asks whether a stated confidence means anything: when the reader says 0.9,
 * is it right about nine times in ten? A model can be accurate and badly
 * calibrated, and a badly calibrated confidence is worse than none because the
 * product acts on it — the review threshold, the price range and the cleaner's
 * "check this on arrival" all read it as if it meant something.
 */
export function calibration(readings) {
  const usable = (Array.isArray(readings) ? readings : []).filter((reading) =>
    Number.isFinite(Number(reading?.confidence)) && typeof reading?.correct === "boolean");
  if (!usable.length) return { brier: null, readings: 0 };
  const total = usable.reduce((sum, reading) => {
    const confidence = Math.max(0, Math.min(1, Number(reading.confidence)));
    return sum + (confidence - (reading.correct ? 1 : 0)) ** 2;
  }, 0);
  return { brier: Math.round((total / usable.length) * 10000) / 10000, readings: usable.length };
}

function normalizedCase(entry, index) {
  const rooms = (Array.isArray(entry?.rooms) ? entry.rooms : []).map((room) => ({
    roomName: String(room?.roomName || ""),
    condition: room?.condition ?? "",
    note: String(room?.note || ""),
    measurements: Array.isArray(room?.measurements) ? room.measurements : [],
    objects: Array.isArray(room?.objects) ? room.objects : []
  }));
  return {
    caseId: String(entry?.caseId || `case-${index + 1}`),
    synthetic: entry?.synthetic !== false,
    deviceClass: String(entry?.deviceClass || "unknown"),
    lighting: String(entry?.lighting || "unstated"),
    propertyType: String(entry?.propertyType || "unstated"),
    rooms,
    truth: entry?.truth || {}
  };
}

/**
 * Runs one case and reports what it got right.
 *
 * Returns per-case detail as well as counts, because an aggregate that cannot
 * be traced back to the case that moved it is a number nobody can act on.
 */
export function runBenchmarkCase(entry, index = 0, ruleset = defaultPricingRuleset) {
  const scanCase = normalizedCase(entry, index);
  const complexity = assessCleaningComplexity({ rooms: scanCase.rooms });
  const estimate = estimateScanPrice({ rooms: scanCase.rooms, complexity }, ruleset);

  const expectedObjects = [];
  const observedObjects = [];
  const conditionPairs = [];
  const calibrationReadings = [];
  for (const room of scanCase.rooms) {
    const truthRoom = (Array.isArray(scanCase.truth?.rooms) ? scanCase.truth.rooms : [])
      .find((candidate) => key(candidate?.roomName) === key(room.roomName));
    const truthObjects = Array.isArray(truthRoom?.objects) ? truthRoom.objects : [];
    expectedObjects.push(...objectKeys(truthObjects));
    observedObjects.push(...objectKeys(room.objects));

    for (const object of room.objects) {
      const match = truthObjects.find((candidate) => key(candidate?.inventoryKey || candidate?.label) === key(object?.inventoryKey || object?.label));
      if (!match) continue;
      if (itemConditions.includes(match.condition) && itemConditions.includes(object.condition)) {
        conditionPairs.push({ expected: match.condition, observed: object.condition });
      }
      if (Number.isFinite(Number(object?.confidenceCondition))) {
        calibrationReadings.push({ confidence: Number(object.confidenceCondition), correct: match.condition === object.condition });
      }
    }
  }

  const counts = detectionCounts(expectedObjects, observedObjects);
  const truthLevel = Number(scanCase.truth?.complexityLevel);
  const truthPricePence = Number(scanCase.truth?.reviewedTotalPence);

  return Object.freeze({
    caseId: scanCase.caseId,
    synthetic: scanCase.synthetic,
    deviceClass: scanCase.deviceClass,
    lighting: scanCase.lighting,
    counts: Object.freeze(counts),
    conditionPairs: Object.freeze(conditionPairs),
    calibrationReadings: Object.freeze(calibrationReadings),
    observedLevel: complexity.assessed ? complexity.level : 0,
    expectedLevel: Number.isInteger(truthLevel) ? truthLevel : null,
    levelWithinOne: Number.isInteger(truthLevel) && complexity.assessed
      ? Math.abs(complexity.level - truthLevel) <= 1
      : null,
    levelExact: Number.isInteger(truthLevel) && complexity.assessed ? complexity.level === truthLevel : null,
    price: Number.isInteger(truthPricePence) && truthPricePence > 0
      ? shadowComparison(estimate, truthPricePence)
      : null,
    priceable: estimate.priceable,
    // A refusal is a correct answer when the truth says specialist review, and
    // must not be scored as a price miss. Conflating the two would push the
    // model toward pricing things it should refuse.
    refusalCorrect: estimate.priceable === false && truthLevel === 5
  });
}

function ratio(numerator, denominator) {
  return denominator > 0 ? Math.round((numerator / denominator) * 10000) / 10000 : null;
}

function median(values) {
  const sorted = [...values].filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return Math.round(value * 10000) / 10000;
}

/**
 * The report.
 *
 * Every metric may be null, and null means "not measured" rather than zero. A
 * dataset with no measured rooms genuinely has no measurement error, and
 * reporting 0 there would look like perfect accuracy.
 */
export function runScanBenchmark(cases, { ruleset = defaultPricingRuleset } = {}) {
  const list = Array.isArray(cases) ? cases : [];
  const results = list.map((entry, index) => runBenchmarkCase(entry, index, ruleset));

  const pooled = results.reduce((totals, result) => ({
    truePositives: totals.truePositives + result.counts.truePositives,
    falsePositives: totals.falsePositives + result.counts.falsePositives,
    falseNegatives: totals.falseNegatives + result.counts.falseNegatives,
    duplicates: totals.duplicates + result.counts.duplicates,
    observed: totals.observed + result.counts.observed,
    expected: totals.expected + result.counts.expected
  }), { truePositives: 0, falsePositives: 0, falseNegatives: 0, duplicates: 0, observed: 0, expected: 0 });

  const agreement = conditionAgreement(results.flatMap((result) => result.conditionPairs));
  const calibrated = calibration(results.flatMap((result) => result.calibrationReadings));
  const levelJudged = results.filter((result) => result.levelWithinOne !== null);
  const priced = results.map((result) => result.price).filter((price) => price?.comparable);
  const priceErrors = priced.map((price) => Math.abs(price.relativeError));

  const metrics = Object.freeze({
    objectPrecision: ratio(pooled.truePositives, pooled.truePositives + pooled.falsePositives),
    objectRecall: ratio(pooled.truePositives, pooled.truePositives + pooled.falseNegatives),
    duplicateRate: ratio(pooled.duplicates, pooled.observed),
    conditionAgreementKappa: agreement.kappa,
    conditionRawAgreement: agreement.observedAgreement,
    calibrationBrier: calibrated.brier,
    complexityWithinOne: ratio(levelJudged.filter((result) => result.levelWithinOne).length, levelJudged.length),
    complexityExact: ratio(levelJudged.filter((result) => result.levelExact).length, levelJudged.length),
    medianPriceError: median(priceErrors),
    priceErrorCoverage: ratio(priceErrors.filter((error) => error <= benchmarkTargets.priceErrorWithin).length, priceErrors.length),
    priceWithinQuotedRange: ratio(priced.filter((price) => price.withinQuotedRange).length, priced.length)
  });

  // Compared only where a metric was actually measured. A target reported as
  // failed because the dataset could not test it would send someone to fix
  // something that is not broken.
  const comparisons = Object.entries(benchmarkTargets)
    .filter(([name]) => Object.hasOwn(metrics, name) && metrics[name] !== null)
    .map(([name, target]) => {
      // Lower is better for these two; everything else is a floor.
      const lowerIsBetter = name === "duplicateRate";
      const value = metrics[name];
      return Object.freeze({ metric: name, target, value, met: lowerIsBetter ? value <= target : value >= target });
    });

  const syntheticCases = results.filter((result) => result.synthetic).length;
  return Object.freeze({
    benchmarkVersion,
    complexityModelVersion,
    rulesetId: ruleset?.rulesetId ?? "default",
    caseCount: results.length,
    syntheticCases,
    realCases: results.length - syntheticCases,
    // The single most important field in this object. A run over fixtures
    // proves the harness; only real consented scans can support an accuracy
    // claim, and this is what stops a fixture figure being quoted as one.
    datasetIsSynthetic: syntheticCases > 0,
    // The audit asks for coverage across room type, condition, lighting and
    // device. Reported so a suspiciously good result can be checked against
    // whether the dataset actually contained anything hard.
    coverage: Object.freeze({
      deviceClasses: Object.freeze([...new Set(results.map((result) => result.deviceClass))].sort()),
      lighting: Object.freeze([...new Set(results.map((result) => result.lighting))].sort()),
      levelsSeen: Object.freeze([...new Set(results.map((result) => result.observedLevel))].sort())
    }),
    metrics,
    targets: benchmarkTargets,
    comparisons: Object.freeze(comparisons),
    // True only when every measured target is met AND the dataset is real.
    // A fixture run can never report a pass, whatever the numbers say.
    acceptable: comparisons.length > 0 && comparisons.every((comparison) => comparison.met) && syntheticCases === 0,
    cases: Object.freeze(results)
  });
}

/**
 * Validates a benchmark case before it joins the dataset.
 *
 * Consent and PII are checked here rather than trusted, because a dataset is
 * where an unconsented scan does the most damage: it gets copied, shared and
 * trained on long after anyone remembers where it came from.
 */
export function benchmarkCaseErrors(entry) {
  const errors = [];
  if (!entry || typeof entry !== "object") return ["A benchmark case must be an object."];
  if (!String(entry.caseId || "").trim()) errors.push("A benchmark case needs a caseId.");
  if (!Array.isArray(entry.rooms) || !entry.rooms.length) errors.push("A benchmark case needs at least one room.");
  if (!entry.truth || typeof entry.truth !== "object") errors.push("A benchmark case needs a truth block to measure against.");

  // A real case must carry explicit consent and a reviewer. A synthetic one
  // must say it is synthetic. There is no third state, because "unlabelled" is
  // how a real scan ends up quoted as a fixture or the reverse.
  if (entry.synthetic === false) {
    if (entry.consent?.recordedAt === undefined || !String(entry.consent?.recordedAt || "").trim()) {
      errors.push(`${entry.caseId}: a real case needs a recorded consent timestamp.`);
    }
    if (!String(entry.consent?.reference || "").trim()) {
      errors.push(`${entry.caseId}: a real case needs a consent reference so it can be withdrawn later.`);
    }
    if (!String(entry.truth?.labelledBy || "").trim()) {
      errors.push(`${entry.caseId}: a real case needs a named human labeller.`);
    }
  } else if (entry.synthetic !== true) {
    errors.push(`${entry.caseId || "case"}: state whether this case is synthetic.`);
  }

  // No image data in a dataset file. Benchmark cases are structured readings,
  // and a data URL in a repository is a photograph of somebody's home in a
  // repository.
  const serialised = JSON.stringify(entry);
  if (/data:image\//.test(serialised)) errors.push(`${entry.caseId}: a benchmark case must not contain image data.`);

  for (const room of Array.isArray(entry.rooms) ? entry.rooms : []) {
    for (const object of Array.isArray(room?.objects) ? room.objects : []) {
      const kinds = Array.isArray(object?.soiling) ? object.soiling : [];
      const unknown = kinds.filter((kind) => !soilingKinds.includes(kind));
      if (unknown.length) errors.push(`${entry.caseId}: unrecognised soiling ${unknown.join(", ")}.`);
    }
  }
  return errors;
}
