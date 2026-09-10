import assert from "node:assert/strict";
import {
  conditionReviewAdvice, correctInventoryItem, walkingReadingItems, inventoryDisplayLabel,
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
// Use the live overlay's conversion function so replay cannot drift from production.

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
  const found = walkingReadingItems({ detections }, roomName, dismissed);
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

// A better view clears obsolete dirt notes together with the superseded grade.
{
  const dirty = [{ label: "Sink", confidence: .9, condition: "heavy", conditionConfidence: .6, note: "Thick limescale", soiling: ["limescale"] }];
  const clean = [{ label: "Sink", confidence: .9, condition: "clean", conditionConfidence: .95, note: "", soiling: [] }];
  const first = compose("Kitchen", [], dirty, 1000);
  const revisited = compose("Kitchen", first, clean, 2000);
  assert.equal(revisited[0].condition, "clean");
  assert.equal(revisited[0].note, "", "The better view retained obsolete dirt evidence");
  assert.deepEqual(revisited[0].soiling, []);
  const saved = mergeInventoryIntoSavedDetections([], revisited);
  assert.equal(saved[0].condition, "clean");
  assert.ok(!saved[0].note.includes("limescale"), "Saving resurrected the old dirt note");
  const confirmation = dirty.map(item => ({ ...item, x: 10, y: 10, width: 20, height: 20 }));
  const combined = mergeInventoryIntoSavedDetections(confirmation, revisited);
  assert.equal(combined[0].condition, "clean");
  assert.ok(!combined[0].note.includes("limescale"), "Confirmation geometry resurrected weaker dirt evidence");
  assert.equal(combined[0].width, 20, "Replacing evidence lost the confirmation box");
}

{
  const clean = { label: "Chair", confidence: .9, condition: "clean", conditionConfidence: .99, x: 5, y: 5, width: 20, height: 20 };
  const stained = { ...clean, condition: "heavy", conditionConfidence: .95, soiling: ["stain"], x: 70 };
  for (const detections of [[clean, stained], [stained, clean]]) {
    const inventory = compose("Living room", [], detections, 1);
    assert.equal(inventory[0].quantity, 2);
    assert.equal(inventory[0].condition, "", "One chair's grade was assigned to both chairs");
    assert.equal(inventory[0].conditionConfidence, null);
    assert.ok(conditionReviewAdvice(inventory), "Mixed-condition chairs were not flagged for review");
    const partial = compose("Living room", inventory, [clean], 2);
    assert.equal(partial[0].condition, "", "A partial view cleared the other chair's uncertainty");
    const saved = mergeInventoryIntoSavedDetections([clean], partial);
    assert.equal(saved[0].condition, "", "Confirmation of one chair cleared a mixed group");
    assert.equal(saved[0].quantity, 2);
    assert.ok(conditionReviewAdvice(saved));
    const corrected = correctInventoryItem(partial, partial[0].key, { condition: "medium" });
    const reread = compose("Living room", corrected, detections, 3);
    assert.equal(reread[0].condition, "medium");
    assert.equal(conditionReviewAdvice(reread), null, "Mixed evidence overrode explicit customer correction");
  }
  const matching = compose("Living room", [], [clean, { ...clean, x: 70 }], 1);
  assert.equal(matching[0].condition, "clean", "Matching simultaneous conditions became uncertain");
  const overlapping = compose("Living room", [], [clean, { ...stained, x: 5 }], 1);
  assert.equal(overlapping[0].quantity, 1);
  assert.equal(overlapping[0].condition, "clean", "A single object's duplicate was treated as two conditions");
}

// Corrected names keep one identity during walking and final confirmation.
{
  const reading = label => ({ label, confidence: .9, condition: "light", conditionConfidence: .8 });
  const boxed = label => ({ ...reading(label), x: 10, y: 10, width: 30, height: 30 });
  for (const original of ["Worktop", "Tap", "Table"]) {
    for (const condition of ["clean", "light", "medium", "heavy"]) {
      const first = mergeRoomInventory([], [{ ...reading(original), score: .9 }]);
      const renamed = correctInventoryItem(first, first[0].key, { label: "My " + original, condition });
      for (const name of [original, "My " + original]) {
        const reread = mergeRoomInventory(renamed, walkingReadingItems({ detections: [reading(name)] }, "Kitchen"));
        assert.equal(reread.length, 1, "A corrected name created a second walking item");
        assert.equal(reread[0].key, first[0].key);
        const saved = mergeInventoryIntoSavedDetections([boxed(name)], reread);
        assert.equal(saved.length, 1, "A corrected name created a second saved item");
        assert.equal(saved[0].inventoryKey, first[0].key);
        assert.equal(saved[0].label, "My " + original);
        assert.equal(saved[0].condition, condition);
        assert.equal(saved[0].conditionConfirmed, true);
        assert.equal(saved[0].width, 30, "Identity reconciliation lost the real photo box");
      }
    }
  }
  let pair = mergeRoomInventory([], ["Table", "Desk"].map(label => ({ ...reading(label), score: .9 })));
  for (const item of pair) pair = correctInventoryItem(pair, item.key, { label: "Surface" });
  const saved = mergeInventoryIntoSavedDetections([boxed("Surface")], pair);
  assert.equal(saved.length, 3, "An ambiguous name was assigned to an arbitrary item");
  const reread = mergeRoomInventory(pair, [{ ...reading("Surface"), score: .9 }]);
  for (const item of pair) assert.equal(reread.find(row => row.key === item.key).sightings, item.sightings);
  assert.deepEqual(mergeInventoryIntoSavedDetections([], [null, undefined]), []);
}

// Removing a renamed item must survive both later walking reads and final save.
{
  const dismissed = new Set([inventoryKey("Worktop"), inventoryKey("Marble worktop")]);
  const detections = ["Worktop", "Marble worktop", "Sink"].map(label => ({ label, confidence: .9, condition: "light", conditionConfidence: .8, x: 10, y: 10, width: 20, height: 20 }));
  const walking = walkingReadingItems({ detections }, "Kitchen", dismissed);
  assert.deepEqual(walking.map(item => item.label), ["Sink"]);
  const saved = mergeInventoryIntoSavedDetections(detections, [], dismissed);
  assert.deepEqual(saved.map(item => item.label), ["Sink"], "Removed findings returned when the walking inventory was empty");
  assert.equal(saved[0].width, 20);
  const onlyRemoved = mergeInventoryIntoSavedDetections(detections.slice(0, 2), [], dismissed);
  assert.deepEqual(onlyRemoved, []);
}
