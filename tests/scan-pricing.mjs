import { assessCleaningComplexity } from "../src/marketplace/cleaning-complexity.mjs";
import {
  defaultPricingRuleset, estimateScanPrice, normalizedPricingRuleset, shadowComparison
} from "../src/marketplace/scan-pricing.mjs";
import { defaultPricingConfig, normalizedPricingConfig } from "../public/pricing-config.js";
import { quoteInputFromScan, quoteRooms } from "../public/pricing-engine.js";

function assert(condition, message) { if (!condition) throw new Error(message); }
function throwsWith(run, fragment) {
  try { run(); } catch (error) { return String(error?.message || "").includes(fragment); }
  return false;
}

function object(overrides = {}) {
  return {
    objectId: overrides.objectId || "o", label: "Worktop", quantity: 1, condition: "light",
    soiling: [], confidenceLabel: 0.9, confidenceCondition: 0.9, conditionConfirmed: false, ...overrides
  };
}
function scanOf(rooms) {
  return { rooms, complexity: assessCleaningComplexity({ rooms }) };
}
const lineFor = (estimate, code) => estimate.lines.find((line) => line.code === code);

const standardScan = scanOf([
  { roomName: "Kitchen", measurements: [], objects: [
    object({ objectId: "a", label: "Hob", condition: "light", soiling: ["grease"] }),
    object({ objectId: "b", label: "Worktop", condition: "light" }),
    object({ objectId: "c", label: "Sink", condition: "light", soiling: ["limescale"] })
  ] }
]);

/* ── Refusing to price is a real answer ────────────────────────────────── */

// An estimate produced from nothing is the most damaging output this module
// could make.
{
  const nothing = estimateScanPrice({ rooms: [], complexity: assessCleaningComplexity({ rooms: [] }) });
  assert(nothing.priceable === false && nothing.code === "scan-not-assessed", "An unassessed scan was given a price.");
  assert(nothing.totalPence === 0, "A refused estimate still carried a total.");
  assert(nothing.isEstimate === true, "A refused estimate did not declare itself an estimate.");
}

// Level 5 means a person must look first. Putting a number on that is exactly
// what the level exists to prevent.
{
  const mouldy = scanOf([{ roomName: "Bathroom", measurements: [], objects: [
    object({ objectId: "a", label: "Sealant", condition: "heavy", soiling: ["mould"], confidenceCondition: 0.9 })
  ] }]);
  const estimate = estimateScanPrice(mouldy);
  assert(estimate.priceable === false && estimate.code === "specialist-review-required", "A specialist-review scan was priced.");
  assert(estimate.reason.includes("mould"), `The refusal did not say why: ${estimate.reason}`);
  assert(estimate.totalPence === 0, "A specialist-review scan carried a price anyway.");
}

// An operator must not be able to put a price on level 5 by editing a rate.
{
  // Condition multipliers live in the price list now. Level 5 stays unpriceable
  // there, and a ruleset carrying the retired keys is simply ignored.
  const rules = normalizedPricingRuleset({ levelMultiplierBasisPoints: { 1: 9000, 5: 20000 }, hourlyRatePence: 9000 });
  assert(!Object.hasOwn(rules, "levelMultiplierBasisPoints") && !Object.hasOwn(rules, "hourlyRatePence"),
    "The scan ruleset still carries the retired rates, so there are two places a price can be set.");
  const config = normalizedPricingConfig({ ...defaultPricingConfig, conditionLevels: { 5: { multiplierBasisPoints: 20000 } } });
  assert(config.conditionLevels[5].multiplierBasisPoints === 0, "An operator was able to make specialist review priceable.");
}

/* ── Every result is an estimate, and there is no way to clear that ────── */

{
  const estimate = estimateScanPrice(standardScan);
  assert(estimate.priceable === true && estimate.isEstimate === true, "A priceable scan did not declare itself an estimate.");
  assert(estimate.totalPence > 0 && estimate.lowPence < estimate.totalPence && estimate.totalPence < estimate.highPence,
    "A priced estimate carried no range.");
  // Nothing downstream may mistake an uncalibrated duration for a measured one.
  assert(estimate.labourCalibrated === false, "An uncalibrated labour estimate was reported as calibrated.");
  assert(estimate.complexityModelVersion >= 1 && estimate.rulesetVersion >= 1, "The estimate did not record which rules produced it.");
}

/* ── The breakdown explains the number ─────────────────────────────────── */

{
  const estimate = estimateScanPrice(standardScan);
  // The estimate now shows the ENGINE's breakdown, so the words a customer
  // reads on the scan result are the words they read at checkout.
  assert(lineFor(estimate, "rooms"), "The breakdown had no per-room line.");
  assert(estimate.estimatedMinutes > 0, "The estimate did not say how long the visit was priced for.");
  assert(estimate.explanation.length > 0, "A priced estimate carried no explanation of the condition it assumed.");
  // The lines account for the total exactly. A breakdown that does not add up
  // is worse than no breakdown, because it looks checkable and is not.
  const summed = estimate.lines.reduce((total, line) => total + line.pence, 0);
  assert(summed === estimate.totalPence, `The breakdown lines summed to ${summed} but the total was ${estimate.totalPence}.`);
}

/* ── One engine, not two ───────────────────────────────────────────────── */

// The point of the unification: the estimate's number IS the engine's number
// for the same confirmed selection. If these ever diverge there are two pricing
// systems again, which is the failure the whole change exists to end.
{
  const estimate = estimateScanPrice(standardScan);
  const direct = quoteRooms(quoteInputFromScan(standardScan, { conditionLevel: standardScan.complexity.level }), normalizedPricingConfig(defaultPricingConfig));
  assert(direct.priceable, "The engine could not price the scan the estimate priced.");
  assert(estimate.totalPence === direct.totalPence,
    `The scan estimate (${estimate.totalPence}p) and the pricing engine (${direct.totalPence}p) disagree about the same rooms.`);
  assert(estimate.lines === direct.lines || JSON.stringify(estimate.lines) === JSON.stringify(direct.lines),
    "The scan estimate rewrote the engine's breakdown instead of showing it.");
  // The retained rate fields must be genuinely dead. Editing one and getting a
  // different price would mean the second rate table is still live.
  const rewritten = estimateScanPrice(standardScan, {
    ...defaultPricingRuleset, hourlyRatePence: 9000, minimumChargePence: 99000, roomBasePence: 15000, perSquareMetrePence: 1500
  });
  assert(rewritten.totalPence === estimate.totalPence,
    "A retired scan rate sent by an older client changed a price, so the second pricing system is still live.");
}

// Condition is stated as an adjustment against the standard rate, so a customer
// can see what their home's condition actually cost them.
{
  /* Both baskets are a whole property rather than one room, because a
     single-room scan sits under the two-hour minimum and the floor — not the
     condition — would be what decided the price. The comparison would pass or
     fail for the wrong reason. */
  const rooms = (condition, soiling) => [
    { roomName: "Kitchen", measurements: [], objects: [
      object({ objectId: "a", label: "Hob", condition, soiling }),
      object({ objectId: "b", label: "Extractor hood", condition, soiling }),
      object({ objectId: "c", label: "Worktop", condition, soiling }),
      object({ objectId: "d", label: "Bin", condition })
    ] },
    { roomName: "Bathroom", measurements: [], objects: [
      object({ objectId: "e", label: "Shower", condition, soiling }),
      object({ objectId: "f", label: "Sink", condition })
    ] },
    { roomName: "Living room", measurements: [], objects: [
      object({ objectId: "g", label: "Sofa", condition }),
      object({ objectId: "h", label: "Floor", condition })
    ] }
  ];
  const heavy = scanOf(rooms("heavy", ["grease"]));
  const light = scanOf(rooms("light", []));
  const heavyEstimate = estimateScanPrice(heavy);
  const lightEstimate = estimateScanPrice(light);
  assert(heavyEstimate.totalPence > lightEstimate.totalPence,
    `A heavily soiled home was not priced above a lightly soiled one: ${heavyEstimate.totalPence}p vs ${lightEstimate.totalPence}p.`);
  const condition = lineFor(heavyEstimate, "condition");
  assert(condition && condition.pence > 0, "A deep-clean condition produced no visible condition adjustment.");
  assert(condition.label.includes("Deep-clean conditions") && condition.label.includes("%"),
    `The condition line did not state the level and the adjustment: ${condition.label}`);
  // A well-kept home is charged less than the standard rate, not merely the
  // same. A multiplier that only ever adds is a surcharge wearing a discount's
  // name.
  const clean = estimateScanPrice(scanOf([{ roomName: "Bedroom", measurements: [], objects: [
    object({ objectId: "a", label: "Bed", condition: "clean" }), object({ objectId: "b", label: "Floor", condition: "clean" })
  ] }]));
  assert(lineFor(clean, "condition").pence < 0, "A light-maintenance home received no reduction.");
}

/* ── Size only where something was measured ────────────────────────────── */

// A room with no usable measurement contributes no size adjustment at all.
// Assuming an average room size would put a number in the price that nothing
// observed — the failure this whole feature exists to avoid.
{
  const estimate = estimateScanPrice(standardScan);
  assert(estimate.sizePence === 0, "An unmeasured scan was charged for floor area.");
  assert(estimate.measuredRooms === 0 && estimate.measuredSquareMetres === 0, "An unmeasured scan reported an area.");
}
{
  const measured = scanOf([{ roomName: "Kitchen", objects: [object({ objectId: "a" })], measurements: [
    { subject: "floor-area", method: "derived", valueMm: 18_000_000, toleranceMm: 4_000_000, confidence: "low" }
  ] }]);
  const estimate = estimateScanPrice(measured);
  // Charged on the excess only: a kitchen's base price already assumes 12m²,
  // so an 18m² kitchen is charged for 6m², not for 18.
  assert(estimate.sizePence > 0, "A measured room was not charged for its floor area.");
  assert(estimate.measuredSquareMetres === 18, `The measured area was wrong: ${estimate.measuredSquareMetres}`);
  const config = normalizedPricingConfig(defaultPricingConfig);
  assert(estimate.sizePence === (18 - config.rooms.kitchen.expectedSquareMetres) * config.perSquareMetrePence,
    `A measured kitchen was not charged for its excess area alone: ${estimate.sizePence}p.`);
}

// A measurement the module itself called unusable must not reach the price.
{
  const unusable = scanOf([{ roomName: "Kitchen", objects: [object({ objectId: "a" })], measurements: [
    { subject: "floor-area", method: "derived", valueMm: 18_000_000, toleranceMm: 12_000_000, confidence: "unusable" }
  ] }]);
  const estimate = estimateScanPrice(unusable);
  assert(estimate.sizePence === 0, "An unusable measurement was charged for.");
  assert(estimate.measuredRooms === 0, "An unusable measurement was counted as a measured room.");
}

/* ── Unanswered questions widen the range ──────────────────────────────── */

// A scan the customer has not finished checking must produce a visibly vaguer
// price, not a falsely precise one.
{
  const settled = estimateScanPrice(scanOf([{ roomName: "Bedroom", measurements: [], objects: [
    object({ objectId: "a", label: "Bed", condition: "light", confidenceCondition: 0.9 }),
    object({ objectId: "b", label: "Floor", condition: "light", confidenceCondition: 0.9 })
  ] }]));
  const uncertain = estimateScanPrice(scanOf([{ roomName: "Bedroom", measurements: [], objects: [
    object({ objectId: "a", label: "Bed", condition: "", confidenceCondition: 0 }),
    object({ objectId: "b", label: "Floor", condition: "light", confidenceCondition: 0.1 })
  ] }]));
  assert(uncertain.rangeBasisPoints > settled.rangeBasisPoints, "An unresolved scan produced the same price confidence as a settled one.");
  assert(uncertain.requiresConfirmation.length > 0, "An unresolved scan listed nothing needing confirmation.");
  assert(uncertain.requiresConfirmation[0].question.length > 0, "An item needing confirmation carried no question to ask.");
  assert(settled.requiresConfirmation.length === 0, "A settled scan invented something to confirm.");
}

// The range cannot widen without limit: past a point a range stops being a
// price at all.
{
  const rules = normalizedPricingRuleset({ maximumRangeBasisPoints: 3000, unresolvedRangeBasisPointsEach: 2000 });
  const messy = scanOf(Array.from({ length: 6 }, (unused, index) => ({
    roomName: `Room ${index}`, measurements: [],
    objects: [object({ objectId: `${index}a`, condition: "", confidenceCondition: 0 })]
  })));
  const estimate = estimateScanPrice(messy, rules);
  assert(estimate.rangeBasisPoints === 3000, `The price range exceeded its configured maximum: ${estimate.rangeBasisPoints}`);
}

/* ── The minimum charge is visible, not folded in silently ─────────────── */

{
  // The minimum belongs to the price list now, not to this ruleset, which is
  // the whole point of the unification: one owner for one number.
  const dearMinimum = normalizedPricingConfig({
    ...defaultPricingConfig,
    serviceTypes: { ...defaultPricingConfig.serviceTypes, standard: { label: "Standard clean", multiplierBasisPoints: 10000, minimumPence: 9000 } }
  });
  const tiny = estimateScanPrice(
    scanOf([{ roomName: "Cupboard", measurements: [], objects: [object({ objectId: "a", condition: "clean" })] }]),
    defaultPricingRuleset, [], { config: dearMinimum }
  );
  assert(tiny.totalPence === 9000, `The minimum charge was not applied: ${tiny.totalPence}`);
  const minimum = lineFor(tiny, "minimum");
  assert(minimum && minimum.pence > 0, "The minimum charge was folded in without a line explaining it.");
  assert(minimum.label.includes("£90.00"), `The minimum-charge line did not state the minimum: ${minimum.label}`);
}

/* ── Add-ons ───────────────────────────────────────────────────────────── */

// Above the minimum charge an add-on is exactly additive.
{
  /* Big enough that the two-hour floor is not what decides the total, or the
     "exactly additive" claim below would be measuring the floor instead. */
  const bigScan = scanOf([
    { roomName: "Kitchen", measurements: [], objects: [
      object({ objectId: "a", label: "Hob", condition: "heavy", soiling: ["grease"] }),
      object({ objectId: "b", label: "Worktop", condition: "medium", soiling: ["grease"] })
    ] },
    { roomName: "Bathroom", measurements: [], objects: [
      object({ objectId: "c", label: "Shower screen", condition: "heavy", soiling: ["limescale"] })
    ] },
    { roomName: "Living room", measurements: [], objects: [
      object({ objectId: "d", label: "Sofa", condition: "medium" }),
      object({ objectId: "e", label: "Floor", condition: "medium" })
    ] },
    { roomName: "Bedroom", measurements: [], objects: [
      object({ objectId: "f", label: "Bed", condition: "medium" }),
      object({ objectId: "g", label: "Wardrobe", condition: "medium" })
    ] }
  ]);
  const config = normalizedPricingConfig(defaultPricingConfig);
  const base = estimateScanPrice(bigScan);
  /* A client naming its own price for an extra is the attack this resolution
     exists to stop, so the request carries CODES and the price list supplies
     the money. The two forgeries below are ignored entirely. */
  const withAddOn = estimateScanPrice(bigScan, defaultPricingRuleset, [
    { code: "ironing", label: "Ignored", pence: 1 },
    { code: "not-a-real-add-on", label: "Free thing", pence: 0 },
    { code: "absurd", label: "Absurd", pence: 500000 }
  ]);
  assert(!base.lines.some((line) => line.code === "minimum"),
    `The add-on fixture is still held up by the minimum visit (${base.totalPence}p), so "exactly additive" would prove nothing.`);
  assert(withAddOn.totalPence === base.totalPence + config.addOns.ironing.pence,
    `A chosen add-on did not reach the total exactly once at its published price: ${withAddOn.totalPence} vs ${base.totalPence}`);
  assert(withAddOn.lines.filter((line) => line.code.startsWith("add-on:")).length === 1,
    "An add-on the price list does not publish was charged for.");
}

// Below it, the add-on fills toward the floor rather than stacking on top of
// it. The minimum is a floor on the whole visit, not a separate fee: charging
// it on top of chargeable work would bill the customer twice for the same
// journey.
{
  const config = normalizedPricingConfig(defaultPricingConfig);
  const smallScan = scanOf([{ roomName: "Cupboard", measurements: [], objects: [object({ objectId: "a", condition: "clean" })] }]);
  const base = estimateScanPrice(smallScan);
  const withAddOn = estimateScanPrice(smallScan, defaultPricingRuleset, [{ code: "bed-linen" }]);
  assert(base.lines.some((line) => line.code === "minimum"), "The small fixture did not land on the minimum charge.");
  assert(withAddOn.totalPence <= base.totalPence + config.addOns["bed-linen"].pence,
    "An add-on was stacked on top of the minimum charge rather than filling toward it.");
  const summed = withAddOn.lines.reduce((total, line) => total + line.pence, 0);
  assert(summed === withAddOn.totalPence, "The breakdown stopped adding up once the minimum charge and an add-on interacted.");
}

/* ── The ruleset is an operator's form, so it is validated like one ────── */

// A typo in this object changes what every customer is charged. Anything
// outside a reviewed range is refused rather than clamped, because a clamped
// rate would quietly price at a number nobody chose.
assert(throwsWith(() => normalizedPricingRuleset({ baseRangeBasisPoints: 9999 }), "Base range must be between"), "An absurd base range was accepted.");
assert(throwsWith(() => normalizedPricingRuleset({ maximumRangeBasisPoints: 1 }), "Maximum range must be between"), "A meaningless maximum range was accepted.");
assert(throwsWith(() => normalizedPricingRuleset({ baseRangeBasisPoints: 1500.5 }), "Base range must be between"), "A fractional range was accepted.");
// The retired rates are ignored rather than refused, so an older admin client
// that still sends them publishes successfully and simply moves no price.
assert(normalizedPricingRuleset({ hourlyRatePence: 999999, minimumChargePence: 1 }).baseRangeBasisPoints === defaultPricingRuleset.baseRangeBasisPoints,
  "A retired rate sent alongside the range fields was refused instead of ignored.");
{
  const rules = normalizedPricingRuleset({});
  assert(rules.baseRangeBasisPoints === defaultPricingRuleset.baseRangeBasisPoints, "An empty ruleset did not fall back to the shipped defaults.");
}

// An operator changing a rate changes the price, which is the entire point of
// making it configurable without a deployment. The rate now lives in the PRICE
// LIST, so that is where the change has to be made and where this asserts it.
{
  const cheapConfig = normalizedPricingConfig({ ...defaultPricingConfig, customerHourlyRatePence: 1000 });
  const dearConfig = normalizedPricingConfig({ ...defaultPricingConfig, customerHourlyRatePence: 2900 });
  const cheap = estimateScanPrice(standardScan, defaultPricingRuleset, [], { config: cheapConfig });
  const dear = estimateScanPrice(standardScan, defaultPricingRuleset, [], { config: dearConfig });
  assert(dear.totalPence > cheap.totalPence, "Changing the configured hourly rate did not change the estimate.");
}

/* ── Determinism ───────────────────────────────────────────────────────── */

// A quote that cannot be recomputed cannot be argued with.
{
  const first = JSON.stringify(estimateScanPrice(standardScan));
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert(JSON.stringify(estimateScanPrice(standardScan)) === first, "The price estimate was not deterministic.");
  }
}

/* ── Shadow comparison reports, it does not judge ──────────────────────── */

{
  const estimate = estimateScanPrice(standardScan);
  // Deliberately inside the quoted band: a reviewed figure the estimate
  // already bracketed is the case that must not be reported as a miss.
  const comparison = shadowComparison(estimate, estimate.totalPence + 100);
  assert(comparison.comparable === true, "A comparable pair was not compared.");
  // Signed, so systematic over- or under-estimation is visible rather than
  // averaging itself away against the opposite error.
  assert(comparison.relativeError < 0, "The comparison lost the direction of the error.");
  assert(comparison.rulesetVersion >= 1 && comparison.complexityModelVersion >= 1,
    "A comparison did not record which model and ruleset produced the estimate.");
  assert(!Object.hasOwn(comparison, "acceptable") && !Object.hasOwn(comparison, "verdict"),
    "The shadow comparison encoded a business decision about acceptable error.");
  assert(comparison.withinQuotedRange === true, "A reviewed total inside the quoted range was reported as outside it.");

  const outside = shadowComparison(estimate, estimate.highPence + 5000);
  assert(outside.withinQuotedRange === false, "A reviewed total outside the quoted range was reported as inside it.");
  const refused = shadowComparison({ priceable: false, code: "specialist-review-required" }, 5000);
  assert(refused.comparable === false && refused.reason === "specialist-review-required", "A refused estimate was compared anyway.");
  assert(shadowComparison(estimate, 0).comparable === false, "An estimate was compared against no reviewed figure.");
}

console.log("Scan pricing checks passed.");
