import assert from "node:assert/strict";
import { mergeSavedDetections, mergeInventoryIntoSavedDetections, mergeRoomInventory } from "../public/room-scan-model.js";

const first = { label: "Microwave", x: 10, y: 10, width: 30, height: 30,
  confidence: .9, condition: "light", conditionConfidence: .9 };
const duplicate = { ...first, label: "Microwave oven", x: 11 };
const separate = { ...first, x: 60 };
for (const batch of [[first, duplicate], [duplicate, first]]) {
  assert.equal(mergeSavedDetections([], batch)[0].quantity, 1,
    "Whole-room confirmation counted overlapping appliance aliases twice");
  assert.equal(mergeSavedDetections(batch, [first])[0].quantity, 1);
  assert.equal(mergeInventoryIntoSavedDetections(batch, mergeRoomInventory([], batch))[0].quantity, 1);
  assert.equal(mergeSavedDetections([], [...batch, separate])[0].quantity, 2,
    "Removing duplicate boxes removed a separate appliance");
}
const grouped = { ...first, quantity: 3 };
assert.equal(mergeSavedDetections([], [grouped, duplicate])[0].quantity, 3);
assert.equal(mergeSavedDetections([], [grouped, separate])[0].quantity, 4);
assert.equal(mergeSavedDetections([], [first, { ...first, inventoryKey: "manual-second" }]).length, 2,
  "Explicit separate identities were combined");
assert.equal(mergeSavedDetections([{ ...grouped, quantityConfirmed: true }], [first, separate])[0].quantity, 3);
console.log("Saved scan duplicate and quantity checks passed.");
