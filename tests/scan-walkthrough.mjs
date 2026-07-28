import assert from "node:assert/strict";
import {
  conditionReviewAdvice, correctInventoryItem, implausibleForRoom, inventoryDisplayLabel,
  inventoryKey, keyframeDefaults, mergeInventoryIntoSavedDetections, mergeRoomInventory,
  resolveRoomCondition, shouldCaptureKeyframe, walkingReadIsBlocked
} from "../public/room-scan-model.js";

// One complete room, walked end to end through the real pipeline.
//
// The scanner's pure layer is now the work of three parallel sessions and more
// than twenty rapid pull requests. Each function has its own tests; what nothing
// tested is the SEAMS — a reading flowing through the implausibility filter, the
// dismissal tombstones, the merge, a customer's corrections and the final save as
// one story. Every serious defect review has found this month lived in a seam,
// not a unit. This suite walks a kitchen the way a customer does and asserts the
// story ends correctly, so a regression in any joint fails loudly here even when
// every unit test still passes.
//
// The composition below mirrors public/room-scan-overlay.js deliberately: filter
// implausible labels, filter dismissed keys, then merge. If the overlay's order
// changes, this file should change with it — that is the point of it.

/* ── The walk begins: which frames cost money ── */

const budget = { capturedCount: 0, lastCaptureAt: 0, lastReadSignature: null };
const still = { signature: [0.5, 0.5], previousSignature: [0.5, 0.5] };
let now = 100_000;

function tryCapture(view, options = {}) {
  const decision = shouldCaptureKeyframe({
    ...view, now,
    lastCaptureAt: budget.lastCaptureAt,
    capturedCount: budget.capturedCount,
    lastReadSignature: budget.lastReadSignature,
    busy: false, ...options
  });
  if (decision) {
    budget.capturedCount += 1;
    budget.lastCaptureAt = now;
    budget.lastReadSignature = view.signature;
  }
  now += 2000;
  return decision;
}

assert.ok(tryCapture(still), "The first steady view of the kitchen was not read.");
assert.ok(!tryCapture(still), "Standing still bought a second read of the same view.");
assert.ok(!tryCapture({ signature: [0.9, 0.9], previousSignature: [0.5, 0.5] }), "A mid-swing frame was read; motion blur is where recognition invents things.");
assert.ok(!tryCapture({ signature: [0.9, 0.9], previousSignature: [0.9, 0.9] }, { qualityKind: "dark" }), "A frame the scanner itself called too dark still cost a paid read.");
assert.ok(tryCapture({ signature: [0.9, 0.9], previousSignature: [0.9, 0.9] }), "Turning to a new wall, settled and well-lit, did not trigger a read — the whole point of walking.");
// Each subsequent wall is a genuinely different view. A first draft of this walk
// stepped the signature by 0.10 per turn and was refused — correctly: that is
// under the 0.12 scene-change threshold, meaning the view had barely moved and a
// paid read of it would teach the room nothing. The fixture turns further; the
// gate was right.
const walls = [[0.1, 0.1], [0.9, 0.9], [0.05, 0.6]];
for (const wall of walls) {
  if (budget.capturedCount >= keyframeDefaults.maxPerRoom) break;
  assert.ok(tryCapture({ signature: wall, previousSignature: wall }), `The wall at ${JSON.stringify(wall)} was refused despite being settled, well-lit and clearly new.`);
}
assert.equal(budget.capturedCount, keyframeDefaults.maxPerRoom, "Walking every wall did not fill the room's read budget.");
assert.ok(!tryCapture({ signature: [0.3, 0.1], previousSignature: [0.3, 0.1] }), `The kitchen exceeded its ${keyframeDefaults.maxPerRoom}-read budget, which is the bound the consent screen promises.`);

// Concurrency: one in-flight read per room, two rooms at once overall. The
// first draft of this test asserted a room could "continue" its own in-flight
// read — misreading the semantics: a room with a read in flight must not START
// a second one, which is exactly the double-spend the per-room flag prevents.
assert.ok(!walkingReadIsBlocked(new Set(["kitchen"]), "bathroom"), "A second room's read was blocked with only one in flight.");
assert.ok(walkingReadIsBlocked(new Set(["kitchen", "hall"]), "bathroom"), "A third concurrent room read was allowed; the global cap does not hold.");
assert.ok(walkingReadIsBlocked(new Set(["kitchen"]), "kitchen"), "A room started a second read while its first was still in flight — a straight double-spend of the budget.");
assert.ok(walkingReadIsBlocked(new Set(), ""), "A read with no room key was allowed.");

/* ── Three readings arrive, composed exactly as the overlay composes them ── */

const dismissed = new Set();
function compose(roomName, inventory, detections, at) {
  const found = detections
    .filter((detection) => !implausibleForRoom(detection.label, roomName))
    .filter((detection) => !dismissed.has(inventoryKey(detection.label)))
    .map((detection) => ({
      label: detection.label,
      score: Number.isFinite(detection.confidence) ? detection.confidence : 0.5,
      condition: detection.condition || "",
      conditionConfidence: detection.conditionConfidence,
      soiling: detection.soiling || [],
      note: detection.note || "",
      // Geometry rides along, exactly as the overlay passes it. Quantity counting
      // only trusts boxed, non-overlapping detections — two boxless "Chair"
      // strings could be one chair reported twice, and counting them would be
      // inventing furniture. A first draft dropped the boxes here and asserted
      // two chairs anyway; the pipeline refused, and the pipeline was right.
      x: detection.x, y: detection.y, width: detection.width, height: detection.height,
      source: "read"
    }));
  return mergeRoomInventory(inventory, found, { now: at });
}

// Reading one, from the doorway. A hallucinated bed, an aliased tap, two chairs.
let kitchen = compose("Kitchen", [], [
  { label: "Wall", confidence: 0.9, condition: "clean", conditionConfidence: 0.9 },
  { label: "Worktop", confidence: 0.8, condition: "medium", conditionConfidence: 0.7, soiling: ["grease"], note: "Greasy — sheen by the hob" },
  { label: "the taps", confidence: 0.4, condition: "light", conditionConfidence: 0.3, soiling: ["limescale"], note: "Limescale — faint marks" },
  { label: "Bed", confidence: 0.9, condition: "clean", conditionConfidence: 0.9 },
  { label: "Chair", confidence: 0.7, condition: "clean", conditionConfidence: 0.6, x: 10, y: 60, width: 15, height: 25 },
  { label: "Chair", confidence: 0.6, condition: "clean", conditionConfidence: 0.6, x: 70, y: 60, width: 15, height: 25 }
], 1000);

assert.ok(!kitchen.some((item) => item.label === "Bed"), "A bed was inventoried in a kitchen. The implausibility filter is not applied on the walking path.");
const chairs = kitchen.find((item) => item.key === inventoryKey("Chair"));
assert.equal(chairs.quantity, 2, "Two chairs in one frame were not counted as two.");
assert.match(inventoryDisplayLabel(chairs), /2/, "The display label hides the quantity, so the customer cannot see both chairs were counted.");

// Reading two, a close pass. "Tap" and "the taps" are one object; the close-up's
// better condition evidence must win, and the chair count must not inflate.
kitchen = compose("Kitchen", kitchen, [
  { label: "Tap", confidence: 0.9, condition: "heavy", conditionConfidence: 0.9, soiling: ["limescale"], note: "Limescale — thick crust at the base" },
  { label: "Chair", confidence: 0.8, condition: "clean", conditionConfidence: 0.8 }
], 2000);

const tap = kitchen.find((item) => item.key === inventoryKey("Tap"));
assert.ok(tap, "The aliased tap split into two rows — 'Tap' and 'the taps' were not recognised as one object.");
assert.equal(tap.sightings, 2, "The tap's second sighting was not counted.");
assert.equal(tap.condition, "heavy", "The close-up's better condition evidence did not win over the doorway glimpse.");
assert.equal(kitchen.find((item) => item.key === inventoryKey("Chair")).quantity, 2, "Seeing one chair on the second pass changed the proven simultaneous count of two.");

/* ── The customer corrects three things; the pipeline must never undo them ── */

kitchen = correctInventoryItem(kitchen, inventoryKey("Worktop"), { label: "Marble worktop" });
kitchen = correctInventoryItem(kitchen, inventoryKey("Tap"), { condition: "medium" });
dismissed.add(inventoryKey("Wall"));
kitchen = Object.freeze(kitchen.filter((item) => item.key !== inventoryKey("Wall")));

// Reading three arrives late and disagrees with all three corrections.
kitchen = compose("Kitchen", kitchen, [
  { label: "Wall", confidence: 0.95, condition: "clean", conditionConfidence: 0.9 },
  { label: "Tap", confidence: 0.99, condition: "clean", conditionConfidence: 0.99, note: "" },
  { label: "Worktop", confidence: 0.95, condition: "medium", conditionConfidence: 0.9, soiling: ["grease"] }
], 3000);

assert.ok(!kitchen.some((item) => item.key === inventoryKey("Wall")), "A removed item was merged back by a later reading. A correction that does not stick is worse than no correction control at all.");
const correctedTap = kitchen.find((item) => item.key === inventoryKey("Tap"));
assert.equal(correctedTap.condition, "medium", "A 0.99-confidence automatic grade overrode the grade the customer set while standing in front of the tap.");
assert.ok(correctedTap.conditionConfirmed, "The customer's regrade lost its confirmed flag in a later merge.");
assert.equal(kitchen.find((item) => item.key === inventoryKey("Worktop")).label, "Marble worktop", "A later reading renamed an item the customer had already corrected.");

/* ── Uncertainty is surfaced, not buried ── */

const withUnknown = mergeRoomInventory(kitchen, [{ label: "Oven interior", score: 0.6, condition: "", conditionConfidence: null, source: "read" }], { now: 4000 });
const review = conditionReviewAdvice(withUnknown);
assert.ok(review, "An ungraded item produced no review advice, so 'condition unclear — scan closer' can never be said.");

/* ── The red button: everything the walk learned reaches the saved room ── */

const confirmationDetections = [
  // The confirmation frame boxed the tap for real, but its reader returned no
  // grade for it — the customer's correction must land on the real box.
  { id: "c1", inventoryKey: inventoryKey("Tap"), label: "Tap", condition: "", soiling: [], note: "", quantity: 1, x: 10, y: 10, width: 20, height: 20 }
];
const saved = mergeInventoryIntoSavedDetections(confirmationDetections, kitchen);

const savedTap = saved.find((detection) => detection.inventoryKey === inventoryKey("Tap"));
assert.ok(savedTap, "The tap vanished between the walk and the saved room.");
assert.equal(savedTap.condition, "medium", "The customer's grade did not survive the save. This is the number the job is priced from.");
assert.ok(savedTap.width > 0, "Merging the walk's grade onto the confirmation lost the real box geometry.");
const savedWorktop = saved.find((detection) => detection.inventoryKey === inventoryKey("Marble worktop") || detection.label === "Marble worktop");
assert.ok(savedWorktop, "A walking-only item never boxed by the confirmation was dropped from the saved room.");
assert.deepEqual([...savedWorktop.soiling], ["grease"], "The worktop's soiling evidence was lost on save.");
assert.equal(saved.find((detection) => detection.label === "Bed"), undefined, "The hallucinated bed reached the saved room after all.");

// The room's own grade: the confirmation commits, the walk fills gaps only.
assert.equal(resolveRoomCondition("medium", "heavy"), "medium", "A walking glimpse overrode the confirmation's committed room grade.");
assert.equal(resolveRoomCondition("unknown", "heavy"), "heavy", "A confirmation that could not judge discarded the walk's coverage.");

console.log(`Scan walkthrough passed: a kitchen walked end to end through the real pipeline — ${keyframeDefaults.maxPerRoom} bounded reads with quality and motion gates, an alias and a quantity resolved, a hallucinated bed filtered, three customer corrections surviving a contradicting later reading, uncertainty surfaced for review, and every grade, quantity and soiling fact arriving intact in the saved room.`);
