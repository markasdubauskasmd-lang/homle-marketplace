import { readFile } from "node:fs/promises";
import {
  benchmarkCaseErrors, benchmarkTargets, calibration, conditionAgreement,
  runBenchmarkCase, runScanBenchmark
} from "../src/marketplace/scan-benchmark.mjs";
import { formatBenchmarkReport, loadBenchmarkCases } from "../tools/run-scan-benchmark.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }
async function rejects(run, fragment) {
  try { await run(); } catch (error) { return String(error?.message || "").includes(fragment); }
  return false;
}

const object = (inventoryKey, condition, extra = {}) => ({
  objectId: `${inventoryKey}-o`, inventoryKey, label: inventoryKey, quantity: 1, condition,
  soiling: [], confidenceLabel: 0.9, confidenceCondition: 0.9, conditionConfirmed: false, origin: "vision", ...extra
});
const singleCase = (overrides = {}) => ({
  caseId: "t-1", synthetic: true, deviceClass: "guided-web", lighting: "daylight",
  rooms: [{ roomName: "Kitchen", condition: "light", measurements: [], objects: [object("worktop", "light")] }],
  truth: { complexityLevel: 1, rooms: [{ roomName: "Kitchen", objects: [{ inventoryKey: "worktop", condition: "light" }] }] },
  ...overrides
});

/* ── A fixture run can never be quoted as evidence ─────────────────────── */

// The most damaging thing this harness could do is print a precision figure
// somebody quotes without noticing it came from hand-written fixtures.
{
  const report = runScanBenchmark([singleCase()]);
  assert(report.datasetIsSynthetic === true, "A synthetic dataset did not declare itself synthetic.");
  assert(report.acceptable === false, "A synthetic dataset was reported as acceptable evidence.");
  assert(report.syntheticCases === 1 && report.realCases === 0, "The case provenance was miscounted.");
  const printed = formatBenchmarkReport(report);
  assert(/SYNTHETIC DATASET/.test(printed), "The printed report does not warn that the dataset is synthetic.");
  assert(/may be quoted/i.test(printed), "The printed report does not say the figures cannot be quoted.");
}

// Even a perfect real dataset only becomes acceptable when every measured target
// is met — and a real one can.
{
  const real = {
    ...singleCase({ synthetic: false }),
    consent: { recordedAt: "2026-07-01T09:00:00.000Z", reference: "consent-0001" },
    truth: { complexityLevel: 1, labelledBy: "A. Assessor", rooms: [{ roomName: "Kitchen", objects: [{ inventoryKey: "worktop", condition: "light" }] }] }
  };
  const report = runScanBenchmark([real]);
  assert(report.datasetIsSynthetic === false && report.realCases === 1, "A real case was treated as synthetic.");
  assert(report.acceptable === true, `A perfect real dataset was not acceptable: ${JSON.stringify(report.comparisons)}`);
}

/* ── A dataset is where an unconsented scan does the most damage ────────── */

// It gets copied, shared and trained on long after anyone remembers where it
// came from, so consent is checked rather than trusted.
{
  const missingConsent = { ...singleCase({ synthetic: false }), truth: { complexityLevel: 1, labelledBy: "A", rooms: [] } };
  const errors = benchmarkCaseErrors(missingConsent);
  assert(errors.some((error) => /consent timestamp/.test(error)), "A real case with no consent timestamp was accepted.");
  assert(errors.some((error) => /withdrawn later/.test(error)), "A real case with no consent reference was accepted.");
}
{
  const unlabelled = { ...singleCase({ synthetic: false }), consent: { recordedAt: "2026-07-01T09:00:00.000Z", reference: "c-1" } };
  assert(benchmarkCaseErrors(unlabelled).some((error) => /human labeller/.test(error)),
    "A real case with no named labeller was accepted.");
}
// There is no third state. "Unlabelled" is how a real customer's scan ends up
// quoted as a fixture, or the reverse.
{
  const entry = singleCase();
  delete entry.synthetic;
  assert(benchmarkCaseErrors(entry).some((error) => /whether this case is synthetic/.test(error)),
    "A case that did not state its provenance was accepted.");
}
// A data URL in this directory is a photograph of somebody's home in a git
// repository.
{
  const withImage = singleCase();
  withImage.rooms[0].objects[0].evidence = "data:image/jpeg;base64,AAAA";
  assert(benchmarkCaseErrors(withImage).some((error) => /must not contain image data/.test(error)),
    "A benchmark case carrying image data was accepted.");
}
{
  const badSoiling = singleCase();
  badSoiling.rooms[0].objects[0].soiling = ["glitter"];
  assert(benchmarkCaseErrors(badSoiling).some((error) => /unrecognised soiling/.test(error)),
    "A case using a soiling kind outside the taxonomy was accepted.");
}
assert(benchmarkCaseErrors(null).length === 1, "A non-object case did not produce exactly one error.");
assert(benchmarkCaseErrors(singleCase()).length === 0, "A valid synthetic case produced errors.");

/* ── Detection is pooled, not averaged over rooms ──────────────────────── */

// A macro average gives a one-object bathroom the same weight as a twenty-object
// kitchen, which flatters a model good at small rooms and hides where the work is.
{
  const bigRoomPerfect = singleCase({
    caseId: "big",
    rooms: [{ roomName: "Kitchen", measurements: [], objects: Array.from({ length: 20 }, (unused, index) => object(`item-${index}`, "light")) }],
    truth: { rooms: [{ roomName: "Kitchen", objects: Array.from({ length: 20 }, (unused, index) => ({ inventoryKey: `item-${index}`, condition: "light" })) }] }
  });
  const smallRoomWrong = singleCase({
    caseId: "small",
    rooms: [{ roomName: "Bathroom", measurements: [], objects: [object("wrong", "light")] }],
    truth: { rooms: [{ roomName: "Bathroom", objects: [{ inventoryKey: "right", condition: "light" }] }] }
  });
  const report = runScanBenchmark([bigRoomPerfect, smallRoomWrong]);
  // 20 of 21 observed are right, so pooled precision is ~0.952. A macro average
  // over the two cases would be 0.5.
  assert(report.metrics.objectPrecision > 0.9, `Detection was averaged per case rather than pooled: ${report.metrics.objectPrecision}`);
}

// A rename must not score as a miss and a false positive. Comparison is on the
// identity key for the same reason storage merges on it.
{
  const renamed = singleCase({
    rooms: [{ roomName: "Bathroom", measurements: [], objects: [object("tap", "light", { label: "Bathroom tap" })] }],
    truth: { rooms: [{ roomName: "Bathroom", objects: [{ inventoryKey: "tap", label: "Tap", condition: "light" }] }] }
  });
  const report = runScanBenchmark([renamed]);
  assert(report.metrics.objectPrecision === 1 && report.metrics.objectRecall === 1,
    "A customer rename was scored as two errors.");
}

// More of one object than the room holds is the duplicate failure the tracker
// exists to prevent, counted separately because it has a different cause.
{
  const duplicated = singleCase({
    rooms: [{ roomName: "Dining room", measurements: [], objects: [
      { ...object("chair", "light"), objectId: "c1" }, { ...object("chair", "light"), objectId: "c2" },
      { ...object("chair", "light"), objectId: "c3" }
    ] }],
    truth: { rooms: [{ roomName: "Dining room", objects: [{ inventoryKey: "chair", condition: "light" }] }] }
  });
  const result = runBenchmarkCase(duplicated);
  assert(result.counts.duplicates === 2, `Duplicate objects were not counted: ${result.counts.duplicates}`);
  assert(runScanBenchmark([duplicated]).metrics.duplicateRate > 0.5, "The duplicate rate did not reflect duplicated rows.");
}

/* ── Kappa, not raw agreement ──────────────────────────────────────────── */

// Most objects in most homes are clean or light, so a grader that always
// answered "light" would score high raw agreement while being useless. Kappa
// subtracts the agreement you would get by chance.
{
  const pairs = Array.from({ length: 100 }, (unused, index) => ({
    expected: index < 90 ? "light" : "heavy", observed: "light"
  }));
  const agreement = conditionAgreement(pairs);
  assert(agreement.observedAgreement === 0.9, "Raw agreement was computed wrongly.");
  assert(agreement.kappa === 0, `A grader that always says "light" scored kappa ${agreement.kappa} rather than 0.`);
}
{
  const perfect = conditionAgreement([
    { expected: "clean", observed: "clean" }, { expected: "heavy", observed: "heavy" },
    { expected: "light", observed: "light" }, { expected: "medium", observed: "medium" }
  ]);
  assert(perfect.kappa === 1, `Perfect varied agreement scored kappa ${perfect.kappa}.`);
}
// Both graders using one grade for everything makes kappa undefined; reporting 1
// would claim agreement carrying no information.
{
  const degenerate = conditionAgreement([{ expected: "light", observed: "light" }, { expected: "light", observed: "light" }]);
  assert(degenerate.kappa === null, "A single-grade dataset reported a kappa.");
}
assert(conditionAgreement([]).kappa === null && conditionAgreement(null).kappa === null,
  "An empty agreement set produced a score.");
// Grades outside the scale cannot contribute.
assert(conditionAgreement([{ expected: "filthy", observed: "light" }]).pairs === 0,
  "An invented grade was included in the agreement calculation.");

/* ── Calibration ───────────────────────────────────────────────────────── */

// A model can be accurate and badly calibrated, and a badly calibrated
// confidence is worse than none, because the product acts on it.
{
  assert(calibration([{ confidence: 1, correct: true }, { confidence: 0, correct: false }]).brier === 0,
    "A perfectly calibrated set did not score zero.");
  assert(calibration([{ confidence: 1, correct: false }]).brier === 1, "A confidently wrong reading did not score one.");
  assert(calibration([]).brier === null, "An empty calibration set produced a score.");
  assert(calibration([{ confidence: "very", correct: true }]).brier === null, "A non-numeric confidence was scored.");
}

/* ── A refusal is a correct answer, not a price miss ───────────────────── */

// Conflating the two would push the model toward pricing things it should refuse.
{
  const specialist = singleCase({
    rooms: [{ roomName: "Bathroom", condition: "heavy", measurements: [], objects: [
      object("sealant", "heavy", { soiling: ["mould"], confidenceCondition: 0.92 })
    ] }],
    truth: { complexityLevel: 5, rooms: [{ roomName: "Bathroom", objects: [{ inventoryKey: "sealant", condition: "heavy" }] }] }
  });
  const result = runBenchmarkCase(specialist);
  assert(result.priceable === false, "A specialist-review case was priced.");
  assert(result.refusalCorrect === true, "A correct refusal was not credited as correct.");
  assert(result.price === null, "A refused estimate produced a price comparison.");
}

/* ── Price error, which the seed dataset deliberately cannot exercise ───── */

// A reviewed total is a human's judgement of a real job. Inventing one would
// measure this project's arithmetic against its own guess, so the seed carries
// none — and the metric is proven here instead.
{
  const withReviewed = singleCase({
    truth: { complexityLevel: 1, reviewedTotalPence: 4500, rooms: [{ roomName: "Kitchen", objects: [{ inventoryKey: "worktop", condition: "light" }] }] }
  });
  const result = runBenchmarkCase(withReviewed);
  assert(result.price?.comparable === true, "A case with a reviewed total was not compared.");
  const report = runScanBenchmark([withReviewed]);
  assert(report.metrics.medianPriceError !== null, "A comparable price produced no error figure.");
  assert(report.metrics.priceErrorCoverage !== null, "A comparable price produced no coverage figure.");

  // A wildly wrong estimate must be reported as wrong.
  const wayOff = singleCase({
    caseId: "way-off",
    truth: { complexityLevel: 1, reviewedTotalPence: 100000, rooms: [{ roomName: "Kitchen", objects: [{ inventoryKey: "worktop", condition: "light" }] }] }
  });
  const offReport = runScanBenchmark([wayOff]);
  assert(offReport.metrics.medianPriceError > 0.5, `A tenfold price error measured ${offReport.metrics.medianPriceError}.`);
  assert(offReport.metrics.priceErrorCoverage === 0, "A tenfold price error was counted as within target.");
}

/* ── Not measured is not zero ──────────────────────────────────────────── */

// A dataset with no reviewed totals genuinely has no price error, and reporting
// 0 there would look like perfect accuracy.
{
  const report = runScanBenchmark([singleCase()]);
  assert(report.metrics.medianPriceError === null, "An unmeasured price error was reported as zero.");
  assert(!report.comparisons.some((entry) => entry.metric === "priceErrorCoverage"),
    "A target that could not be measured was compared anyway.");
  assert(formatBenchmarkReport(report).includes("not measured"), "The report did not distinguish unmeasured from zero.");
}
{
  const empty = runScanBenchmark([]);
  assert(empty.caseCount === 0 && empty.acceptable === false, "An empty benchmark reported a pass.");
  assert(formatBenchmarkReport(empty).includes("No target could be measured"), "An empty benchmark did not say so.");
}

/* ── Determinism ───────────────────────────────────────────────────────── */

// A benchmark that cannot be re-run to the same figure is not a benchmark.
{
  const cases = [singleCase(), singleCase({ caseId: "t-2" })];
  const first = JSON.stringify(runScanBenchmark(cases));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    assert(JSON.stringify(runScanBenchmark(cases)) === first, "The benchmark was not deterministic.");
  }
}

/* ── The committed seed dataset ────────────────────────────────────────── */

{
  const datasetPath = new URL("../data/scan-benchmark/synthetic-seed.json", import.meta.url);
  const raw = JSON.parse(await readFile(datasetPath, "utf8"));
  assert(raw.synthetic === true && /not real rooms/i.test(raw.warning), "The seed dataset does not declare itself synthetic.");
  // A reviewed total cannot be synthesised honestly, so no case may carry one.
  // Checked against the cases rather than the whole file, because the file's own
  // warning names the field in order to explain its absence.
  assert(!JSON.stringify(raw.cases).includes("reviewedTotalPence"), "The seed dataset invented a reviewed total.");
  assert(!/data:image\//.test(JSON.stringify(raw)), "The seed dataset contains image data.");

  const cases = await loadBenchmarkCases(new URL(datasetPath).pathname);
  assert(cases.length >= 10, `The seed dataset has only ${cases.length} cases.`);
  const report = runScanBenchmark(cases);
  assert(report.datasetIsSynthetic === true && report.acceptable === false, "The seed dataset reported a pass.");

  // Regression locks. These are the behaviours the fixtures exist to hold, and
  // they are asserted as ranges rather than exact figures so an unrelated model
  // improvement does not fail the build.
  assert(report.metrics.objectPrecision > 0.85, `Seed object precision fell to ${report.metrics.objectPrecision}.`);
  assert(report.metrics.objectRecall > 0.85, `Seed object recall fell to ${report.metrics.objectRecall}.`);
  assert(report.metrics.conditionAgreementKappa > 0.6, `Seed condition agreement fell to ${report.metrics.conditionAgreementKappa}.`);
  assert(report.metrics.complexityWithinOne === 1, `Seed complexity drifted more than one level: ${report.metrics.complexityWithinOne}`);
  // The coverage the fixtures deliberately span, so a later edit cannot quietly
  // drop the hard cases and make everything look better.
  assert(report.coverage.levelsSeen.includes(1) && report.coverage.levelsSeen.includes(5),
    `The seed no longer spans light maintenance to specialist review: ${report.coverage.levelsSeen}`);
  assert(report.coverage.lighting.includes("low-light"), "The seed no longer contains a low-light case.");
  assert(report.coverage.deviceClasses.includes("camera-fallback"), "The seed no longer contains a camera-fallback case.");
  // syn-10 deliberately duplicates, so this target is expected to miss. Asserted
  // so nobody "fixes" it by tuning the model.
  assert(raw.expectedTargetMisses?.duplicateRate, "The seed does not explain its expected target miss.");
  assert(report.comparisons.find((entry) => entry.metric === "duplicateRate")?.met === false,
    "The deliberate duplicate fixture stopped exercising the duplicate rate.");
}

assert(await rejects(() => loadBenchmarkCases("/nonexistent/dataset.json"), "ENOENT"), "A missing dataset did not fail.");
assert(benchmarkTargets.objectPrecision > 0 && benchmarkTargets.conditionAgreementKappa > 0, "The targets are not set.");

console.log("Scan benchmark checks passed.");
