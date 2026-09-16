import assert from "node:assert/strict";
import {
  mergeRoomInventory, mergeSavedDetections, mergeInventoryIntoSavedDetections,
  conditionNeedsReview, correctInventoryItem, recommendedAction
} from "../public/room-scan-model.js";

const clean = { label: "Oven", score: .99, confidence: .99, condition: "clean",
  conditionConfidence: .96, note: "No visible residue on the door", soiling: [],
  x: 10, y: 10, width: 30, height: 50 };
const dirty = { ...clean, condition: "heavy", conditionConfidence: .91,
  note: "Baked-on grease around the handle", soiling: ["grease"] };

// Either angle may miss evidence from the other. Self-reported confidence cannot
// decide that a clean front disproves visible dirt on another surface.
for (const [first, second] of [[clean, dirty], [dirty, clean]]) {
  const walking = mergeRoomInventory(mergeRoomInventory([], [first]), [second]);
  const saved = mergeSavedDetections([first], [second]);
  const combined = mergeInventoryIntoSavedDetections([first], mergeRoomInventory([], [second]));
  const duplicateBoxes = mergeRoomInventory([], [first, second]);
  for (const result of [walking, saved, combined, duplicateBoxes]) {
    assert.equal(result.length, 1);
    assert.equal(result[0].quantity, 1);
    assert.equal(conditionNeedsReview(result[0]), true, "Conflicting clean/dirty views silently settled a grade");
    assert.equal(result[0].condition, "");
    assert.equal(recommendedAction(result[0]), "");
    assert.equal(conditionNeedsReview(mergeSavedDetections(result, [first])[0]), true,
      "A repeated view erased the unresolved conflict");
  }
  const corrected = correctInventoryItem(walking, "oven", { condition: "medium" });
  assert.equal(mergeRoomInventory(corrected, [first, second])[0].condition, "medium");
  const savedCorrection = mergeInventoryIntoSavedDetections(saved, corrected);
  assert.equal(savedCorrection[0].condition, "medium");
  assert.equal(conditionNeedsReview(savedCorrection[0]), false);
}

// A weak initial guess can still be improved; matching grades do not create a conflict.
for (const first of [{ ...clean, conditionConfidence: .2 }, { ...dirty, conditionConfidence: .6 }]) {
  assert.equal(mergeRoomInventory(mergeRoomInventory([], [first]), [dirty])[0].condition, "heavy");
  assert.equal(mergeSavedDetections([first], [dirty])[0].condition, "heavy");
}
console.log("Conflicting room-condition review checks passed.");
