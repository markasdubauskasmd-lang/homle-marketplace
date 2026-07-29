import {
  assessCleaningComplexity, complexityLevels, complexityModelVersion, complexityWeights, levelDescriptor
} from "../src/marketplace/cleaning-complexity.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }

function object(overrides = {}) {
  return {
    objectId: overrides.objectId || "obj", label: "Worktop", quantity: 1, condition: "light",
    soiling: [], confidenceLabel: 0.9, confidenceCondition: 0.9, conditionConfirmed: false, ...overrides
  };
}
function room(name, objects, overrides = {}) {
  return { roomName: name, condition: "", note: "", objects, ...overrides };
}
const assess = (rooms) => assessCleaningComplexity({ rooms });

/* ── No scan is not level 1 ────────────────────────────────────────────── */

// The failure this module exists to prevent, in its purest form: an empty scan
// reported as a light clean is a confident answer built on nothing.
for (const empty of [{}, { rooms: [] }, { rooms: [room("Kitchen", [])] }]) {
  const result = assessCleaningComplexity(empty);
  assert(result.assessed === false, "An empty scan produced an assessment.");
  assert(result.level === 0 && result.levelLabel === "Not assessed", "An empty scan was graded rather than reported as unassessed.");
  assert(result.recommendedService === "" && result.recommendedCleaners === 0, "An empty scan recommended a service.");
  assert(result.provisional === true, "An empty scan was reported as settled.");
}

/* ── The scale means something ─────────────────────────────────────────── */

assert(complexityLevels.length === 5, "The complexity scale is not five levels.");
assert(levelDescriptor(5).code === "specialist-review", "Level 5 is not specialist review.");
assert(Number.isInteger(complexityModelVersion), "The complexity model has no version.");

// A well-kept home is light maintenance, and reporting it as anything more to
// seem useful is what makes an assessment untrustworthy.
{
  const result = assess([room("Living room", [
    object({ objectId: "a", label: "Sofa", condition: "clean" }),
    object({ objectId: "b", label: "Table", condition: "clean" }),
    object({ objectId: "c", label: "Floor", condition: "light" })
  ])]);
  assert(result.level === 1, `A clean room scored level ${result.level} rather than light maintenance.`);
  assert(result.recommendedService === "regular-domestic", "A light clean did not recommend the regular service.");
  assert(result.recommendedCleaners === 1, "A light clean recommended more than one cleaner.");
}

// A normal lived-in kitchen is a standard clean.
{
  const result = assess([room("Kitchen", [
    object({ objectId: "a", label: "Hob", condition: "light", soiling: ["grease"] }),
    object({ objectId: "b", label: "Worktop", condition: "light" }),
    object({ objectId: "c", label: "Sink", condition: "light", soiling: ["limescale"] }),
    object({ objectId: "d", label: "Floor", condition: "light" })
  ])]);
  assert(result.level === 2, `A lived-in kitchen scored level ${result.level} rather than standard.`);
}

// Built-up grease and heavy soiling is deep-clean territory.
{
  const result = assess([room("Kitchen", [
    object({ objectId: "a", label: "Hob", condition: "heavy", soiling: ["grease"] }),
    object({ objectId: "b", label: "Extractor hood", condition: "heavy", soiling: ["grease"] }),
    object({ objectId: "c", label: "Worktop", condition: "medium", soiling: ["grease", "food-debris"] }),
    object({ objectId: "d", label: "Bin", condition: "heavy", soiling: ["food-debris"] }),
    object({ objectId: "e", label: "Floor", condition: "medium", soiling: ["food-debris"] })
  ])]);
  assert(result.level === 4, `A heavily soiled kitchen scored level ${result.level} rather than deep-clean.`);
  assert(result.recommendedService === "deep-cleans", "A deep-clean condition did not recommend the deep-clean service.");
}

/* ── The explanation names the evidence that produced the level ────────── */

{
  const result = assess([room("Kitchen", [
    object({ objectId: "a", label: "Hob", condition: "heavy", soiling: ["grease"] }),
    object({ objectId: "b", label: "Extractor hood", condition: "heavy", soiling: ["grease"] }),
    object({ objectId: "c", label: "Worktop", condition: "medium", soiling: ["grease"] }),
    object({ objectId: "d", label: "Bin", condition: "heavy" })
  ])]);
  assert(result.explanation.startsWith("Deep-clean conditions because "), `The explanation did not state the level and its cause: ${result.explanation}`);
  assert(result.explanation.includes("grease") && result.explanation.includes("Hob"),
    `The explanation did not name the evidence: ${result.explanation}`);
  assert(result.reasons.length > 0, "A level was assigned with no recorded reason.");
  // Every indicator has to be checkable against something stored.
  assert(result.indicators.some((indicator) => indicator.code === "soiling:grease" && indicator.value === 3),
    "Grease was not counted as an independent indicator.");
  assert(result.indicators.some((indicator) => indicator.code === "item-count" && indicator.value === 4),
    "The item count indicator was wrong.");
  assert(result.equipment.some((entry) => entry.toLowerCase().includes("degreaser")), "Grease did not recommend a degreaser.");
}

// Quantity counts proven items, not detection rows: three dirty chairs are
// three things to clean.
{
  const single = assess([room("Dining room", [object({ objectId: "a", label: "Chair", condition: "medium", quantity: 1 })])]);
  const several = assess([room("Dining room", [object({ objectId: "a", label: "Chair", condition: "medium", quantity: 4 })])]);
  assert(several.maximumRoomLoad === single.maximumRoomLoad * 4, "Proven quantity did not affect the load.");
  assert(several.itemCount === 4, "The item count ignored proven quantity.");
  assert(several.rooms[0].reason.includes("4 × Chair"), `A grouped quantity was not named in the reason: ${several.rooms[0].reason}`);
}

/* ── Dust and damage are deliberately not double-counted ───────────────── */

// Dust is the default soiling and its severity IS the condition grade. Scoring
// it again would inflate the most common finding in every home.
{
  const plain = assess([room("Bedroom", [object({ objectId: "a", condition: "medium" })])]);
  const dusty = assess([room("Bedroom", [object({ objectId: "a", condition: "medium", soiling: ["dust"] })])]);
  assert(plain.maximumRoomLoad === dusty.maximumRoomLoad, "Dust was scored on top of the condition grade it already describes.");
}

// A cracked tile is not cleanable, so it must not be priced as cleaning work —
// but the cleaner still has to be told.
{
  const result = assess([room("Bathroom", [object({ objectId: "a", label: "Tiles", condition: "light", soiling: ["damage"] })])]);
  const plain = assess([room("Bathroom", [object({ objectId: "a", label: "Tiles", condition: "light" })])]);
  assert(result.maximumRoomLoad === plain.maximumRoomLoad, "Damage was scored as cleaning work.");
  assert(result.questions.some((question) => question.code === "damage-noted"), "Damage was not raised with the customer.");
}

/* ── A whole property in heavy condition is more than one heavy room ───── */

{
  const heavyRoom = (name, id) => room(name, [
    object({ objectId: `${id}1`, label: "Floor", condition: "heavy", soiling: ["stain"] }),
    object({ objectId: `${id}2`, label: "Worktop", condition: "medium", soiling: ["grease"] }),
    object({ objectId: `${id}3`, label: "Window", condition: "medium" })
  ]);
  const one = assess([heavyRoom("Kitchen", "a")]);
  const three = assess([heavyRoom("Kitchen", "a"), heavyRoom("Bathroom", "b"), heavyRoom("Bedroom", "c")]);
  assert(one.level === 3, `One heavy room scored level ${one.level} rather than heavy.`);
  assert(three.level === 4, `Three heavy rooms scored level ${three.level} rather than escalating.`);
  assert(three.reasons.some((reason) => reason.includes("3 rooms are in heavy condition")),
    "The escalation to deep-clean did not state why.");
}

/* ── Level 5 is "someone must look", not "very dirty" ──────────────────── */

{
  const result = assess([room("Bathroom", [
    object({ objectId: "a", label: "Sealant", condition: "heavy", soiling: ["mould"], confidenceCondition: 0.9 })
  ])]);
  assert(result.level === 5, `Confirmed mould scored level ${result.level} rather than specialist review.`);
  assert(result.explanation.includes("mould"), "A specialist referral did not name mould as the cause.");
  // Sending someone to choose a bookable service for a property that needs
  // looking at first is the failure this level exists to prevent.
  assert(result.recommendedService === "" && result.recommendedCleaners === 0,
    "A specialist referral still recommended a bookable service.");
  assert(result.equipment.some((entry) => entry.toLowerCase().includes("mould")), "Mould did not recommend a treatment and protection.");
}

// Mould the reader itself called unreliable must not escalate a customer to
// specialist review. It becomes a question.
{
  const result = assess([room("Bathroom", [
    object({ objectId: "a", label: "Sealant", condition: "heavy", soiling: ["mould"], confidenceCondition: 0.2 })
  ])]);
  assert(result.level !== 5, "Uncertain mould escalated a customer to specialist review.");
  assert(result.questions.some((question) => question.code === "possible-mould"), "Uncertain mould was neither asserted nor asked about.");
  assert(result.questions.some((question) => question.question.includes("Sealant")), "The mould question did not name the object.");
}

// A grade the customer has already confirmed is evidence, whatever the model
// scored it.
{
  const result = assess([room("Bathroom", [
    object({ objectId: "a", label: "Sealant", condition: "heavy", soiling: ["mould"], confidenceCondition: 0.1, conditionConfirmed: true })
  ])]);
  assert(result.level === 5, "A customer-confirmed mould reading was ignored.");
}

/* ── Low confidence asks rather than invents ───────────────────────────── */

{
  const result = assess([room("Kitchen", [
    object({ objectId: "a", label: "Hob", condition: "", confidenceCondition: 0 }),
    object({ objectId: "b", label: "Worktop", condition: "medium", confidenceCondition: 0.1 }),
    object({ objectId: "c", label: "Sink", condition: "light", confidenceCondition: 0.2 })
  ])]);
  assert(result.confidence === "low", `An unresolved scan reported ${result.confidence} confidence.`);
  assert(result.provisional === true, "An unresolved scan was reported as settled.");
  const question = result.questions.find((entry) => entry.code === "condition-unclear");
  assert(question, "An unresolved scan asked the customer nothing.");
  assert(question.roomName === "Kitchen" && question.objectIds.length === 3, "The question did not point at the unresolved objects.");
  assert(question.question.includes("Hob"), `The question did not name an object: ${question.question}`);
  // A level is still reported — withholding it leaves the customer with
  // nothing — but never as settled.
  assert(result.assessed === true && result.level >= 1, "A low-confidence scan withheld its level entirely.");
}

// A confident scan is not made provisional for no reason.
{
  const result = assess([room("Bedroom", [
    object({ objectId: "a", label: "Bed", condition: "light", confidenceCondition: 0.9 }),
    object({ objectId: "b", label: "Floor", condition: "clean", confidenceCondition: 0.95 })
  ])]);
  assert(result.confidence === "high", `A confident scan reported ${result.confidence} confidence.`);
  assert(result.provisional === false, "A confident scan with nothing to ask was still marked provisional.");
  assert(result.questions.length === 0, "A confident scan invented a question.");
  assert(result.indicators.find((indicator) => indicator.code === "evidence-quality").value === 100,
    "Evidence quality was not reported as a percentage of settled readings.");
}

/* ── Duration is produced but honestly labelled ────────────────────────── */

{
  const result = assess([room("Kitchen", [object({ objectId: "a", label: "Hob", condition: "heavy", soiling: ["grease"] })])]);
  assert(result.durationCalibrated === false, "An uncalibrated duration was presented as calibrated.");
  assert(result.estimatedMinutes >= complexityWeights.minimumJobMinutes, "A duration fell below the minimum job length.");
  // A small job sits on the minimum, so its lower bound cannot go under it —
  // the floor is a real constraint, not a rounding artefact to widen past.
  assert(result.estimatedMinutesLow === complexityWeights.minimumJobMinutes,
    "The lower bound of a small job fell below the minimum job length.");
  assert(result.estimatedMinutes < result.estimatedMinutesHigh, "The duration estimate had no upper allowance.");
}

// Away from the floor the estimate carries a real band in both directions,
// because a single number would claim a precision this cannot have.
{
  const result = assess([
    room("Kitchen", [object({ objectId: "a", label: "Hob", condition: "heavy", soiling: ["grease"] }), object({ objectId: "b", label: "Worktop", condition: "medium", soiling: ["grease"] })]),
    room("Bathroom", [object({ objectId: "c", label: "Shower screen", condition: "heavy", soiling: ["limescale", "soap-scum"] })]),
    room("Bedroom", [object({ objectId: "d", label: "Carpet", condition: "medium", soiling: ["stain", "pet-hair"] })])
  ]);
  assert(result.estimatedMinutesLow < result.estimatedMinutes && result.estimatedMinutes < result.estimatedMinutesHigh,
    "A larger job's duration estimate carried no range.");
}

// A job one person cannot finish inside a normal visit needs two people, and
// saying so is more useful than quietly producing an impossible schedule.
{
  const heavy = Array.from({ length: 8 }, (unused, index) => room(`Room ${index}`, [
    object({ objectId: `${index}a`, label: "Floor", condition: "heavy", soiling: ["stain", "food-debris"] }),
    object({ objectId: `${index}b`, label: "Worktop", condition: "heavy", soiling: ["grease"] })
  ]));
  const result = assess(heavy);
  assert(result.estimatedMinutes > complexityWeights.twoCleanerMinutes, "The large-property fixture did not produce a long job.");
  assert(result.recommendedCleaners === 2, "A job beyond one visit window still recommended a single cleaner.");
}

/* ── Determinism ───────────────────────────────────────────────────────── */

// The same scan must always produce the same level. A disputed assessment is
// only answerable if it is reproducible.
{
  const fixture = [
    room("Kitchen", [object({ objectId: "a", label: "Hob", condition: "medium", soiling: ["grease"] })]),
    room("Bathroom", [object({ objectId: "b", label: "Shower screen", condition: "light", soiling: ["soap-scum", "limescale"] })])
  ];
  const first = JSON.stringify(assess(fixture));
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert(JSON.stringify(assess(fixture)) === first, "The complexity assessment was not deterministic.");
  }
}

// Malformed input degrades rather than throwing: this runs inside a read that
// must not fail because one stored row is odd.
{
  const result = assess([
    room("Kitchen", [{ label: "Hob", condition: "filthy", soiling: ["glitter", null], quantity: -4, confidenceCondition: "many" }]),
    { roomName: "Bathroom", objects: null },
    null
  ]);
  assert(result.assessed === true, "A partly malformed scan produced no assessment at all.");
  assert(result.maximumRoomLoad === 0, "An unrecognised condition and soiling kind contributed to the load.");
  assert(result.itemCount === 1, "A malformed quantity was not treated as a single item.");
}

console.log("Cleaning-complexity checks passed.");
