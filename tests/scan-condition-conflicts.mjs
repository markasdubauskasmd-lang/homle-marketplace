import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as model from "../public/room-scan-model.js";
import { mergeReviewedRoomRescan } from "../public/scan-review-edit.js";
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

// The actual Done handoff and a saved booking draft must retain the uncertainty
// and explicit quantity; otherwise returning to review silently resets them.
{
  const source = readFileSync(new URL("../public/room-scan-overlay.js", import.meta.url), "utf8");
  const start = source.indexOf("function finishScan()");
  const end = source.indexOf("/* ── Teardown", start);
  const inventory = mergeRoomInventory(mergeRoomInventory([], [clean]), [dirty]);
  const detections = mergeInventoryIntoSavedDetections([], inventory).map(item => ({ ...item,
    quantity: 3, quantityConfirmed: true }));
  const state = { rooms: [{ name: "Kitchen", detections, tasks: [], readingStatus: "ready" }], dismissed: new Map() };
  let result;
  const context = vm.createContext({ ...model, state, toast(){}, renderHub(){}, stopVoice(){}, forgetRoomNotes(){},
    inventoryFor: () => [], localRoomTasks: () => [], roomTranscript: () => "", transcriptKey: name => name.toLowerCase(),
    scanEvents: { record(){}, flush(){} }, elapsedSince: () => 0, stopCamera(){}, close: value => { result = value; } });
  vm.runInContext(source.slice(start, end), context);
  context.finishScan(); if (!result) context.finishScan();
  const room = JSON.parse(JSON.stringify(result.rooms[0]));
  assert.equal(room.objects[0].conditionMixed, true, "Done lost the conflict before booking review");
  assert.equal(room.objects[0].quantityConfirmed, true, "Done lost the customer's quantity decision");
  const reread = mergeReviewedRoomRescan(room, { objects: [{ ...clean, inventoryKey: "oven", quantity: 1,
    confidenceCondition: .99 }], tasks: [] });
  assert.equal(reread.objects[0].condition, "");
  assert.equal(reread.objects[0].quantity, 3);
  const unconfirmedQuantity = { ...room, objects: room.objects.map(item => ({ ...item, quantityConfirmed: false })) };
  assert.equal(mergeReviewedRoomRescan(unconfirmedQuantity, { objects: [{ ...clean, inventoryKey: "oven", quantity: 3,
    confidenceCondition: .99 }], tasks: [] }).objects[0].condition, "",
    "A booking-review rescan discarded the persisted conflict");
}
