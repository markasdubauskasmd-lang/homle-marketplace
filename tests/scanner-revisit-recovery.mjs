import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as model from "../public/room-scan-model.js";

const source = readFileSync(new URL("../public/room-scan-overlay.js", import.meta.url), "utf8");
const start = source.indexOf("function openRevisit(room, session)");
const handler = source.slice(start, source.indexOf("/* ── Camera ── */", start));
function harness() {
  const timers = new Set(), images = [], messages = [];
  const oven = { inventoryKey: "oven", label: "Oven", x: 10, y: 10, width: 30, height: 30, quantity: 1 };
  const room = { name: "Kitchen", image: "stored-photo", detections: [oven] };
  const state = { roomSession: 1, rooms: [room], dismissed: new Map(), candidates: [] };
  let inventory = [], recovered = 0, refreshes = 0;
  const image = class { constructor() { images.push(this); this.naturalWidth = 1280; this.naturalHeight = 720; } };
  const context = vm.createContext({ ...model, state, Image: image,
    window: { setTimeout: fn => { timers.add(fn); return fn; }, clearTimeout: fn => timers.delete(fn) },
    el: { canvas: { getContext: () => ({ drawImage() {} }) }, still: {}, selection: {}, viewfinder: { classList: { add() {} } } },
    seedSavedInventory() {}, inventoryFor: () => inventory,
    transcriptKey: value => value.toLowerCase(),
    prepareLiveRoom: () => { state.loadingRoom = false; recovered++; },
    toast: value => messages.push(value), stopDetection() {}, layoutFrozen() {}, refreshSelection: () => refreshes++
  });
  vm.runInContext(handler, context);
  return { room, state, images, timers, messages, context, setInventory: value => { inventory = value; },
    recovered: () => recovered, refreshes: () => refreshes };
}

// Editing remains available while a saved image decodes. The eventual picture
// must use those latest corrections, not the room captured when opening began.
{
  const h = harness();
  h.context.openRevisit(h.room, 1);
  h.setInventory([{ key: "oven", label: "Cabinet", quantity: 2, quantityConfirmed: true,
    confirmed: true, condition: "light", conditionConfirmed: true, source: "manual" }]);
  h.images[0].onload();
  assert.equal(h.state.candidates[0].label, "Cabinet", "Saved photo decode restored the old item name");
  assert.equal(h.state.candidates[0].quantity, 2);
  assert.equal(h.state.candidates[0].condition, "light");
  assert.equal(h.state.loadingRoom, false);
  assert.equal(h.timers.size, 0);
}
{
  const h = harness();
  h.context.openRevisit(h.room, 1);
  h.state.dismissed.set("kitchen", new Set(["oven"]));
  h.images[0].onload();
  assert.equal(h.state.candidates.length, 0, "A removed object reappeared after image decode");
}
{
  const h = harness();
  h.context.openRevisit(h.room, 1);
  h.state.rooms[0] = { ...h.room, detections: [{ ...h.room.detections[0], condition: "heavy", conditionConfidence: .95 }] };
  h.images[0].onload();
  assert.equal(h.state.candidates[0].condition, "heavy", "Completed analysis was lost during photo decode");
}
for (const outcome of ["timeout", "error", "empty", "cancel", "superseded"]) {
  const h = harness();
  h.context.openRevisit(h.room, 1);
  const lateLoad = h.images[0].onload;
  if (outcome === "timeout") {
    assert.equal(h.timers.size, 1, "Saved photo has no loading deadline");
    [...h.timers][0]();
  } else if (outcome === "error") h.images[0].onerror();
  else if (outcome === "empty") { h.images[0].naturalWidth = 0; lateLoad(); }
  else if (outcome === "cancel") { h.state.cancelRevisit?.(); h.state.loadingRoom = false; }
  else { h.state.roomSession++; h.context.openRevisit(h.room, 2); }
  lateLoad();
  assert.equal(h.refreshes(), 0, `${outcome}: late image changed the selection`);
  assert.equal(h.recovered(), ["timeout", "error", "empty"].includes(outcome) ? 1 : 0);
  assert.equal(h.state.rooms[0], h.room, "Image failure discarded saved room data");
  if (outcome === "superseded") { h.images[1].onload(); assert.equal(h.refreshes(), 1); }
  assert.equal(h.timers.size, 0);
}
console.log("Saved room photo recovery: current corrections, final evidence, removals, deadlines and stale completion passed.");
