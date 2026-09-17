import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { inventoryKey, mergeSavedDetections, mergeInventoryIntoSavedDetections, correctInventoryItem } from "../public/room-scan-model.js";

const source = readFileSync(new URL("../public/room-scan-overlay.js", import.meta.url), "utf8");
const start = source.indexOf("    function seedSavedInventory(");
const seedSource = source.slice(start, source.indexOf("    function setInventory(", start));
function harness() {
  const state = { inventories: new Map(), dismissed: new Map() };
  const context = vm.createContext({ state, inventoryKey, mergeInventoryIntoSavedDetections,
    transcriptKey: name => name.toLowerCase(), inventoryFor: name => state.inventories.get(name.toLowerCase()) || [], renderInventory() {} });
  vm.runInContext(seedSource, context);
  return { state, seed: room => context.seedSavedInventory(room), inventory: () => state.inventories.get("kitchen") };
}

// Reopening a saved room before its async confirmation finishes creates an
// inventory from the provisional detections. Completion must replace missing
// or weaker automatic evidence in that list without changing user corrections.
for (const priorCondition of ["", "light"]) {
  const { seed, inventory } = harness();
  const provisional = { inventoryKey: "oven", label: "Oven", quantity: 1,
    condition: priorCondition, conditionConfidence: priorCondition ? .3 : null,
    confidence: .7, note: "Distant view", soiling: [] };
  seed({ name: "Kitchen", detections: [provisional] });
  const final = { ...provisional, condition: "heavy", conditionConfidence: .95,
    confidence: .98, note: "Visible grease on oven door", soiling: ["grease"] };
  const saved = mergeSavedDetections([provisional], [final]);
  assert.equal(saved[0].condition, "heavy");
  seed({ name: "Kitchen", detections: saved });
  assert.equal(inventory()[0].condition, "heavy", "The final condition never replaces the provisional inventory row");
  assert.equal(inventory()[0].conditionConfidence, .95);
  assert.equal(inventory()[0].note, "Visible grease on oven door");
  assert.deepEqual(Array.from(inventory()[0].soiling), ["grease"]);
  seed({ name: "Kitchen", detections: saved });
  assert.equal(inventory().length, 1);
  assert.equal(inventory()[0].quantity, 1, "Reopening the same room must not duplicate quantity");
}

// The same synchronization must retain explicit identity, quantity and grade,
// manually added work, other-room state, and deliberate dismissals.
{
  const { state, seed, inventory } = harness();
  state.inventories.set("kitchen", correctInventoryItem([
    { key: "oven", label: "Oven", quantity: 4, score: .9, sightings: 1, source: "read" }
  ], "oven", { label: "Cabinet", quantity: 2, condition: "light", confirmed: true }));
  const manual = { key: "air fryer", label: "Air fryer", quantity: 1, score: 1, sightings: 1, source: "manual", confirmed: true };
  state.inventories.set("kitchen", [...inventory(), manual]);
  const bathroom = [{ key: "sink", label: "Sink", quantity: 1 }];
  state.inventories.set("bathroom", bathroom);
  state.dismissed.set("kitchen", new Set(["fridge"]));
  seed({ name: "Kitchen", detections: [
    { inventoryKey: "oven", label: "Oven", quantity: 4, condition: "heavy", conditionConfidence: .99 },
    { inventoryKey: "fridge", label: "Fridge", quantity: 1 }
  ] });
  const edited = inventory().find(item => item.key === "oven");
  assert.equal(edited.label, "Cabinet");
  assert.equal(edited.quantity, 2);
  assert.equal(edited.quantityConfirmed, true);
  assert.equal(edited.condition, "light");
  assert.equal(edited.conditionConfirmed, true);
  assert.equal(edited.confirmed, true);
  assert.equal(inventory().find(item => item.key === "air fryer").source, "manual");
  assert.equal(inventory().some(item => item.key === "fridge"), false);
  assert.equal(state.inventories.get("bathroom"), bathroom);
}
console.log("Scanner inventory refresh passed: completed evidence replaces provisional grades; explicit edits, manual work and dismissals persist.");
