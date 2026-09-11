import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import {
  conditionReviewAdvice, correctInventoryItem, walkingReadingItems, inventoryDisplayLabel,
  inventoryKey, keyframeDefaults, mergeInventoryIntoSavedDetections, mergeRoomInventory, mergeSavedDetections,
  resolveRoomCondition, shouldCaptureKeyframe, walkingReadIsBlocked, findRoom, upsertRoom,
  readingTaskRecords, mergeScanTaskRecords, scanTaskRecordsFor, reconcileScanTaskRecords, scanChecklistLines, scanSummary, mergeItemReadings
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

// The room is saved optimistically before its confirmation response arrives.
{
  const first = mergeRoomInventory([], [{ label: "Worktop", score: .9, condition: "light", conditionConfidence: .8 }]);
  const corrected = correctInventoryItem(first, first[0].key, { label: "Marble worktop", condition: "medium" });
  const optimistic = mergeInventoryIntoSavedDetections([], corrected);
  const late = [{ label: "Marble worktop", confidence: .99, condition: "clean", conditionConfidence: .99, x: 10, y: 10, width: 30, height: 30 }];
  const reconcile = (inventory, dismissed = new Set()) => mergeSavedDetections(
    mergeInventoryIntoSavedDetections(optimistic, [], dismissed),
    mergeInventoryIntoSavedDetections(late, inventory, dismissed)
  );
  const saved = reconcile(corrected);
  assert.equal(saved.length, 1, "Late confirmation duplicated the optimistically saved item");
  assert.equal(saved[0].quantity, 1, "Two views were counted as two objects");
  assert.equal(saved[0].label, "Marble worktop");
  assert.equal(saved[0].condition, "medium");
  assert.equal(saved[0].width, 30);
  assert.deepEqual(reconcile([], new Set(["worktop", "marble worktop"])), [], "A removed finding returned in the late response");
}

// Execute the actual walking callback with controlled response ordering.
{
  const source = readFileSync(new URL("../public/room-scan-overlay.js", import.meta.url), "utf8");
  const start = source.indexOf('readRoom(image, roomName, [], roomTranscript(roomName), "walking")');
  assert.ok(start > 0);
  const callback = source.slice(start).match(/\.then\(\(reading\) => \{([\s\S]*?)\n        \}\)/)?.[1];
  assert.ok(callback);
  const receive = new Function("reading", "state", "keyframeBudget", "generation", "roomName", "readStartedAt",
    "transcriptKey", "walkingReadingItems", "rememberWalkEvidence", "setInventory", "mergeRoomInventory", "inventoryFor",
    "findRoom", "upsertRoom", "mergeInventoryIntoSavedDetections", "mergeSavedTasks", "resolveRoomCondition", "renderHub", "capturedSignature", "keyframeDefaults", "mergeScanTaskRecords", "scanTaskRecordsFor", callback);
  for (const scenario of ["saved", "dismissed", "removed-room", "stale", "closed"]) {
    const state = {
      closed: scenario === "closed", diagnostics: {},
      dismissed: new Map([["kitchen", new Set(scenario === "dismissed" ? ["radiator"] : [])]]),
      rooms: scenario === "removed-room" ? [] : [{ name: "Kitchen", condition: "light", readingStatus: "ready", tasks: [], detections: [{ label: "Sink" }] }]
    };
    const budget = { generation: scenario === "stale" ? 1 : 0, capturedCount: 1, completedCount: 0, completedSignatures: [] };
    let inventory = [];
    receive({ detections: [{ label: "Radiator", confidence: .9, condition: "heavy", conditionConfidence: .9 }], condition: "heavy", tasks: [] },
      state, () => budget, 0, "Kitchen", Date.now(), name => name.toLowerCase(), walkingReadingItems, () => {},
      (_name, items) => { inventory = items; }, mergeRoomInventory, () => inventory,
      (rooms, name) => rooms.find(room => room.name === name),
      (rooms, next) => rooms.map(room => room.name === next.name ? next : room),
      mergeInventoryIntoSavedDetections, (first, second) => [...new Set([...first, ...second])], resolveRoomCondition, () => {}, Array(48).fill(.2), {maxPerRoom:4}, mergeScanTaskRecords, scanTaskRecordsFor);
    if (scenario === "removed-room") {
      assert.deepEqual(state.rooms, [], "A late view recreated a removed saved room");
    } else {
      assert.equal(state.rooms[0].detections.some(item => item.label === "Radiator"), scenario === "saved", "Late walking coverage or its guards failed: " + scenario);
      assert.equal(state.rooms[0].condition, "light", "Walking evidence overrode the confirmed room grade");
    }
  }
}


// Execute readRoom and its walking callback together for provider success/fallback.
{
  const source = readFileSync(new URL("../public/room-scan-overlay.js", import.meta.url), "utf8");
  const readStart = source.indexOf("async function readRoom(image,");
  const readEnd = source.indexOf("function localRoomTasks(", readStart);
  const start = source.indexOf('readRoom(image, roomName, [], roomTranscript(roomName), "walking")');
  const callback = source.slice(start).match(/\.then\(\(reading\) => \{([\s\S]*?)\n        \}\)/)?.[1];
  assert.ok(callback && readStart >= 0 && readEnd > readStart);
  for (const status of [503, 200]) {
    const state = {closed:false,readingAllowed:true,visionAvailable:true,roomReadControllers:new Set(),
      diagnostics:{keyframesRead:0},dismissed:new Map(),rooms:[]};
    const tasks = ["Kitchen: Wipe the table"];
    let requests = 0, remembered = [];
    const read = new Function("state","roomReadingPayload","recoverCsrf","window","fetch","localRoomTasks","usableDetections","readingTaskRecords","mergeScanTaskRecords",
      source.slice(readStart, readEnd) + ";return readRoom;")(
      state, () => ({withinLimit:true,body:{synthetic:true}}), async()=>"synthetic-csrf",
      {setTimeout,clearTimeout}, async()=>{requests++;return {status,ok:status===200,json:async()=>({detections:[],tasks,condition:""})};},
      ()=>tasks, ()=>[], readingTaskRecords, mergeScanTaskRecords);
    const reading = await read("synthetic-frame","Kitchen",[],"Wipe the table","walking");
    assert.equal(reading.taskRecords[0].origin,status===503?"customer":"vision","Reading lost task origin");
    const budget = {generation:0,capturedCount:1,completedCount:0,completedSignatures:[]};
    const receive = new Function("reading","state","keyframeBudget","generation","roomName","readStartedAt",
      "transcriptKey","walkingReadingItems","rememberWalkEvidence","findRoom","capturedSignature","keyframeDefaults",callback);
    receive(reading,state,()=>budget,0,"Kitchen",Date.now(),name=>name.toLowerCase(),()=>[],
      (_room,result)=>{remembered=result.tasks;},()=>null,Array(48).fill(.2),{maxPerRoom:4});
    const analysed = status === 200 ? 1 : 0;
    assert.equal(requests,1);
    assert.equal(state.roomReadControllers.size,0,"Read controller leaked");
    assert.equal(budget.capturedCount,1,"Fallback refunded the spent attempt");
    assert.equal(budget.completedCount,analysed,"Fallback was counted as analysed coverage");
    assert.equal(budget.completedSignatures.length,analysed,"Fallback marked a view as already analysed");
    assert.equal(state.diagnostics.keyframesRead,analysed,"Fallback inflated successful-read diagnostics");
    assert.deepEqual(remembered,tasks,"Manual fallback lost the customer's task");
    assert.equal(state.diagnostics.lastReadFailure,status===200?"":"reading-unavailable");
  }
}


// Edits in a revisited live list must reach Finish without another photograph.
{
  const source = readFileSync(new URL("../public/room-scan-overlay.js", import.meta.url), "utf8");
  const start = source.indexOf("function setInventory(roomName, items)");
  const end = source.indexOf("// Each room keeps its own budget", start);
  assert.ok(start >= 0 && end > start);
  const original = {key:"hob",label:"Hob",condition:"heavy",conditionConfidence:.9,score:.9,soiling:["grease"],quantity:1};
  for (const change of [{condition:"clean"},{label:"Induction hob"},{quantity:3},{remove:true}]) {
    const saved = {name:"Kitchen",image:"synthetic-photo",transcript:"Do not move the vase",
      tasks:["Kitchen: Do not move the vase"],condition:"heavy",readingStatus:"reading",readingRevision:7,
      detections:mergeInventoryIntoSavedDetections([],[original])};
    const untouched = {name:"Bedroom",detections:[{label:"Bed"}],tasks:[]};
    const state = {rooms:[saved,untouched],inventories:new Map(),dismissed:new Map([["kitchen",new Set(change.remove?["hob"]:[])]])};
    let hubRenders = 0;
    const noop = () => {};
    const setter = new Function("state","transcriptKey","renderInventory","renderDetectorState",
      "findRoom","upsertRoom","mergeInventoryIntoSavedDetections","renderHub",
      source.slice(start,end) + ";return setInventory;")(state,name=>name.toLowerCase(),noop,noop,
      findRoom,upsertRoom,mergeInventoryIntoSavedDetections,()=>hubRenders++);
    const edited = change.quantity ? [{...original,quantity:change.quantity}] : correctInventoryItem([original],"hob",change);
    setter("Kitchen",edited);
    const final = findRoom(state.rooms,"Kitchen");
    const expected = mergeInventoryIntoSavedDetections(saved.detections,edited,state.dismissed.get("kitchen"));
    assert.deepEqual(final.detections,expected,"Saved handoff did not match the visible correction");
    if (change.remove) assert.equal(final.detections.length,0,"Removed item survived in saved room");
    if (change.condition) assert.equal(final.detections[0].condition,"clean","Saved room retained old dirty grade");
    if (change.label) assert.equal(final.detections[0].label,"Induction hob","Saved room retained old label");
    if (change.quantity) assert.equal(final.detections[0].quantity,3,"Saved room retained old quantity");
    for (const field of ["image","transcript","tasks","condition","readingStatus","readingRevision"])
      assert.deepEqual(final[field],saved[field],"Item correction changed unrelated saved field " + field);
    assert.deepEqual(findRoom(state.rooms,"Bedroom"),untouched,"Correction changed another room");
    assert.equal(hubRenders,1,"Room summary did not refresh");
    setter("Bathroom",edited);
    assert.equal(state.rooms.length,2,"Editing an unsaved room created a saved room");
  }
}


// Task records keep explicit references and origins through walking accumulation.
{
  const source = readFileSync(new URL("../public/room-scan-overlay.js", import.meta.url), "utf8");
  const response = {detections:[{label:"Hob"},{label:"Sink"}],tasks:["Wipe the hob"],taskLinks:[{taskIndex:0,itemRefs:["0"]}]};
  const vision = readingTaskRecords(response);
  assert.deepEqual(vision[0].inventoryKeys,["hob"]);
  const selected = readingTaskRecords({items:[{id:"d2",label:"Sink"}],tasks:["Clean the sink"],taskLinks:[{taskIndex:0,itemRefs:["d2"]}]},{selected:true});
  assert.deepEqual(selected[0].inventoryKeys,["sink"]);
  const invalid = readingTaskRecords({...response,taskLinks:[{taskIndex:0,itemRefs:["missing"]}]});
  assert.deepEqual(invalid[0].inventoryKeys,[],"Unknown ref was guessed from task text");
  const customer = readingTaskRecords({tasks:["Wipe the hob"]},{customer:true});
  assert.equal(mergeScanTaskRecords(vision,customer).length,2,"Customer instruction was collapsed into automatic proposal");
  assert.equal(mergeScanTaskRecords(vision,vision).length,1,"Repeated read duplicated identical evidence");
  const state = {walkEvidence:new Map()};
  const start = source.indexOf("function rememberWalkEvidence(roomName, reading)");
  const end = source.indexOf("const conditionRank =",start);
  assert.ok(start >= 0 && end > start);
  const remember = new Function("state","transcriptKey","worseCondition","mergeScanTaskRecords","scanTaskRecordsFor",
    source.slice(start,end)+";return rememberWalkEvidence;")(state,name=>name.toLowerCase(),resolveRoomCondition,mergeScanTaskRecords,scanTaskRecordsFor);
  remember("Kitchen",{tasks:response.tasks,taskRecords:vision,condition:"light"});
  remember("Kitchen",{tasks:response.tasks,taskRecords:customer,condition:""});
  const evidence = state.walkEvidence.get("kitchen");
  assert.equal(evidence.tasks.length,1);
  assert.deepEqual(evidence.taskRecords.map(record=>record.origin),["vision","customer"]);
  assert.deepEqual(evidence.taskRecords[0].inventoryKeys,["hob"]);
  const saved = {tasks:["Old unlinked task",...evidence.tasks],taskRecords:evidence.taskRecords};
  const records = scanTaskRecordsFor(saved);
  assert.equal(records.filter(record=>record.origin==="legacy").length,1,"Legacy tasks were discarded or new linked records lost their origin");
}

{
  const vision = {text:"Wipe the hob", origin:"vision", inventoryKeys:["hob"]};
  const customer = {...vision, origin:"customer", inventoryKeys:[]};
  const heavy = {key:"hob", label:"Hob", condition:"heavy", conditionConfidence:.9};
  const clean = {...heavy, condition:"clean", conditionConfirmed:true};
  const resolve = (records, items, options) => reconcileScanTaskRecords(records, items, options);
  assert.equal(resolve([vision], [clean])[0].decision, "remove");
  assert.equal(resolve([vision], [], {removedKeys:["hob"]})[0].decision, "remove");
  assert.equal(resolve([vision], [heavy])[0].decision, "keep");
  assert.equal(resolve([vision], [{...clean, conditionConfirmed:false}])[0].decision, "keep",
    "An automatic clean grade cannot delete a task.");
  const missing = resolve([vision], [])[0];
  assert.equal(missing.decision, "keep");
  assert.equal(missing.reviewRequired, true, "A missing detection needs review, not deletion.");
  for (const items of [[clean], []]) {
    assert.equal(resolve([customer], items, {removedKeys:["hob"]})[0].decision, "keep");
  }
  const sameText = resolve([vision, customer], [clean]);
  assert.deepEqual(sameText.map(task => task.decision), ["remove", "keep"]);
  for (const origin of ["legacy", "vision"]) {
    const unlinked = resolve([{...vision, origin, inventoryKeys:[]}], [clean], {changedKeys:["hob"]})[0];
    assert.equal(unlinked.decision, "keep");
    assert.equal(unlinked.reviewRequired, true);
  }
  const grouped = {...vision, text:"Wipe the hob and sink", inventoryKeys:["hob","sink"]};
  const partial = resolve([grouped], [clean, {key:"sink",condition:"heavy",conditionConfidence:.9}])[0];
  assert.equal(partial.decision, "keep");
  assert.equal(partial.reviewRequired, true);
  assert.equal(resolve([grouped], [clean], {removedKeys:["sink"]})[0].decision, "remove");
  const renamed = resolve([vision], [heavy], {changedKeys:["hob"]})[0];
  assert.equal(renamed.decision, "keep");
  assert.equal(renamed.reviewRequired, true);
  const ambiguous = resolve([vision], [clean,heavy])[0];
  assert.equal(ambiguous.decision, "keep");
  assert.equal(ambiguous.reviewRequired, true);
  assert.equal(resolve([vision], [heavy], {removedKeys:["hob"]})[0].decision, "keep",
    "A re-added item must not be deleted by an old dismissal.");
  const saved = mergeInventoryIntoSavedDetections([], [clean]);
  assert.equal(resolve([vision], saved)[0].decision, "remove",
    "Saved inventory identities retain customer clean confirmation.");
  const before = JSON.stringify({vision, customer, heavy, clean, grouped, saved});
  resolve([vision, customer, grouped], [clean,heavy], {removedKeys:["sink"]});
  assert.equal(JSON.stringify({vision, customer, heavy, clean, grouped, saved}), before);
}

{
  const reading = {items:[{id:"d1",label:"Cooktop",condition:"heavy",confidence:.9,conditionConfidence:.9}],
    tasks:["Degrease the hob"],taskLinks:[{taskIndex:0,itemRefs:["d1"]}]};
  const selected = [{id:"d1",inventoryKey:"hob",label:"Kitchen hob",x:.1,y:.1,width:.2,height:.2}];
  const taskRecords = readingTaskRecords(reading,{selected:true,selectedItems:selected});
  const detections = mergeItemReadings(selected,reading);
  assert.equal(detections[0].inventoryKey,"hob");
  assert.deepEqual(taskRecords[0].inventoryKeys,["hob"]);
  const room = {name:"Kitchen",tasks:reading.tasks,taskRecords,detections};
  assert.deepEqual(scanChecklistLines([room]),["Kitchen: Degrease the hob"]);
  const cleared = {...room,detections:detections.map(item=>({...item,condition:"clean",conditionConfirmed:true}))};
  assert.deepEqual(scanChecklistLines([cleared]),[]);
  assert.equal(scanSummary([cleared]).minutes,0);
  assert.equal(scanSummary([cleared]).roomCount,0);
  const removed = {...room,detections:[],removedInventoryKeys:["hob"]};
  assert.deepEqual(scanChecklistLines([removed]),[]);
  assert.deepEqual(scanChecklistLines([{...removed,removedInventoryKeys:[]}]),["Kitchen: Degrease the hob"]);
  const customer = readingTaskRecords({tasks:reading.tasks},{customer:true});
  const instructed = {...cleared,taskRecords:mergeScanTaskRecords(taskRecords,customer)};
  assert.deepEqual(scanChecklistLines([instructed]),["Kitchen: Degrease the hob"]);
  assert.equal(scanSummary([instructed]).roomCount,1);
  assert.deepEqual(scanChecklistLines([{name:"Kitchen",tasks:reading.tasks}]),["Kitchen: Degrease the hob"]);
}

{
  const tasks = Array.from({length:8}, (_,i)=>"Clean surface "+i);
  const records = tasks.map(text=>({text,origin:"vision",inventoryKeys:[]}));
  const customer = tasks.map(text=>({text:"Kitchen: "+text,origin:"customer",inventoryKeys:[]}));
  const room = {name:"Kitchen",tasks,taskRecords:records};
  assert.deepEqual(scanSummary([{...room,taskRecords:mergeScanTaskRecords(records,customer)}]),
    scanSummary([room]), "Repeated customer/vision wording must not inflate the displayed duration.");
}

{
  const {applyCorrection} = await import("../public/scan-review-render.js");
  const {premiumBaseTasks,premiumScope} = await import("../public/scan-premium-selection.js");
  const {scanTaskReview,withCurrentRoomInstructions,roomInstructionTasks} = await import("../public/room-scan-model.js");
  const {checklistFromTranscript} = await import("../public/checklist.js");
  const source = readFileSync(new URL("../public/landlord-journey.js", import.meta.url),"utf8");
  const start = source.indexOf("function correctedScanRooms()");
  const end = source.indexOf("// Sends each customer correction",start);
  assert.ok(start > 0 && end > start);
  function fixture(edited = false) {
    const room = name => ({name,objects:[{inventoryKey:"sink",label:"Sink",condition:"heavy",conditionConfirmed:true}],
      taskRecords:[{text:"Clean the sink",origin:"vision",inventoryKeys:["sink"]}]});
    const state = {scanRooms:[room("Kitchen"),room("Bathroom")],scanCorrections:[],scanPremiumSelected:[],
      scanPremiumPlan:{options:[],groups:[],baseTasks:[]},draft:{scanChecklistEdited:edited}};
    const el = {tasks:{value:"Kitchen: Clean the sink\nBathroom: Clean the sink",after(){},setCustomValidity(){},addEventListener(event,handler){this.onInput=handler}}};
    let host, saves = 0;
    const textNode = (tag,cls,text) => ({tag,cls,text,children:[],dataset:{},setAttribute(){},
      append(...nodes){this.children.push(...nodes)},replaceChildren(...nodes){this.children=nodes}});
    const document = {querySelector(){return host || null}};
    el.tasks.after = node => {host=node};
    const build = new Function("state","el","applyCorrection","scanChecklistLines","scanTaskReview",
      "premiumBaseTasks","premiumScope","document","textNode","invalidateScanRequest","premiumChoiceId",
      "renderPremiumChoices","editableTaskLines","eligiblePremiumSelections","updateResultTotals","saveDraft","refreshScanReview","setChecklistError","withCurrentRoomInstructions","roomInstructionTasks","checklistFromTranscript",
      source.slice(source.indexOf('el.tasks.addEventListener("input"'), source.indexOf('function editableTaskLines()')) + source.slice(start,end)+";return {correctScanObject,reconcileReviewedChecklist};");
    const api = build(state,el,applyCorrection,scanChecklistLines,scanTaskReview,premiumBaseTasks,premiumScope,
      document,textNode,()=>{},()=>"",()=>{},()=>el.tasks.value.split("\n").filter(Boolean),()=>[],()=>{},()=>{saves++},()=>{},()=>{},withCurrentRoomInstructions,roomInstructionTasks,checklistFromTranscript);
    return {state,el,api,host:()=>host,saves:()=>saves};
  }
  const untouched = fixture();
  untouched.api.correctScanObject("Kitchen","sink","condition","clean");
  assert.equal(untouched.el.tasks.value,"Bathroom: Clean the sink");
  assert.deepEqual(untouched.state.draft.tasks,["Bathroom: Clean the sink"]);
  assert.equal(untouched.saves(),1);
  untouched.api.correctScanObject("Bathroom","sink","removed",true);
  assert.equal(untouched.el.tasks.value,"");
  const edited = fixture(false);
  edited.el.tasks.value = "Kitchen: Clean the sink\nKeep my exact instruction";
  edited.el.tasks.onInput();
  assert.equal(edited.state.draft.scanChecklistEdited,true);
  edited.api.correctScanObject("Kitchen","sink","condition","clean");
  assert.equal(edited.el.tasks.value,"Kitchen: Clean the sink\nKeep my exact instruction");
  assert.equal(edited.host().hidden,false);
  assert.ok(edited.host().children.some(node=>node.text==="Kitchen: Clean the sink"));
  edited.el.tasks.value = "Kitchen: My own unrelated instruction";
  edited.api.reconcileReviewedChecklist();
  assert.equal(edited.host().hidden,true,"Deleted suggestions remained in the review notice.");
  assert.equal(edited.el.tasks.value,"Kitchen: My own unrelated instruction");
  edited.el.tasks.value = "kitchen:  Clean the sink";
  edited.api.reconcileReviewedChecklist();
  assert.equal(edited.host().hidden,false,"Whitespace/case differences hid a current conflicting suggestion.");
  const prefixed = fixture();
  prefixed.state.scanRooms[0].taskRecords[0].text = "Kitchen: Clean the sink";
  prefixed.api.correctScanObject("Kitchen","sink","label","Counter");
  assert.ok(prefixed.host().children.some(node=>node.text==="Kitchen: Clean the sink"),
    "An existing room prefix was doubled in the notice.");
  const legacy = fixture();
  delete legacy.state.draft.scanChecklistEdited;
  legacy.api.correctScanObject("Kitchen","sink","removed",true);
  assert.equal(legacy.el.tasks.value,"Kitchen: Clean the sink\nBathroom: Clean the sink");
  const noteEdit = fixture();
  noteEdit.state.scanRooms[0].taskRecords.push({text:"Kitchen: Clean the oven",origin:"customer",inventoryKeys:[]});
  noteEdit.state.scanNoteEdits = {kitchen:"Leave the oven alone"};
  noteEdit.api.reconcileReviewedChecklist();
  assert.ok(!noteEdit.el.tasks.value.includes("Clean the oven"));
  assert.ok(noteEdit.el.tasks.value.includes("Leave the oven alone"));
  assert.ok(noteEdit.el.tasks.value.includes("Bathroom: Clean the sink"));
  noteEdit.state.scanNoteEdits.kitchen = "";
  noteEdit.api.reconcileReviewedChecklist();
  assert.ok(!noteEdit.el.tasks.value.includes("oven"));
  const protectedNote = fixture(true);
  protectedNote.el.tasks.value = "Kitchen: Clean the oven";
  protectedNote.state.scanNoteEdits = {kitchen:"Leave the oven alone"};
  protectedNote.api.reconcileReviewedChecklist();
  assert.equal(protectedNote.el.tasks.value,"Kitchen: Clean the oven");
  const renamed = fixture();
  renamed.api.correctScanObject("Kitchen","sink","label","Counter");
  assert.ok(renamed.el.tasks.value.includes("Kitchen: Clean the sink"));
  assert.equal(renamed.host().hidden,false);
}

{
  const {withCurrentRoomInstructions,scanTaskReview} = await import("../public/room-scan-model.js");
  const old = {name:"Kitchen",transcript:"Clean inside the oven",tasks:["Kitchen: Clean inside the oven","Wipe the hob"],
    taskRecords:[{text:"Kitchen: Clean inside the oven",origin:"customer",inventoryKeys:[]},
      {text:"Wipe the hob",origin:"vision",inventoryKeys:["hob"]}],
    detections:[{inventoryKey:"hob",label:"Hob",condition:"heavy",conditionConfirmed:true}]};
  const before = JSON.stringify(old);
  const deleted = withCurrentRoomInstructions(old,[]);
  assert.deepEqual(deleted.tasks,["Wipe the hob"]);
  assert.ok(!scanChecklistLines([deleted]).some(line=>line.includes("oven")));
  assert.equal(scanTaskReview(deleted)[0].reviewRequired,true);
  const replaced = withCurrentRoomInstructions(old,["Kitchen: Leave the oven alone"]);
  assert.deepEqual(replaced.tasks,["Wipe the hob","Kitchen: Leave the oven alone"]);
  assert.equal(withCurrentRoomInstructions(old,["Kitchen: Clean inside the oven"]).taskInstructionsChanged,false);
  const dual = {...old,taskRecords:[...old.taskRecords,{text:"Kitchen: Clean inside the oven",origin:"vision",inventoryKeys:[]}]};
  const ambiguous = withCurrentRoomInstructions(dual,[]);
  assert.ok(ambiguous.tasks.includes("Kitchen: Clean inside the oven"),
    "An independent automatic suggestion cannot be deleted by guessing its source.");
  assert.equal(scanTaskReview(ambiguous).find(record=>record.text.includes("oven")).reviewRequired,true);
  assert.equal(JSON.stringify(old),before);

  const source = readFileSync(new URL("../public/room-scan-overlay.js",import.meta.url),"utf8");
  const start = source.indexOf("const checklistRooms =");
  const end = source.indexOf('scanEvents.record("scan.session.duration_ms"',start);
  assert.ok(start>0 && end>start);
  const finish = new Function("state","withCurrentRoomInstructions","localRoomTasks","roomTranscript",
    "transcriptKey","inventoryFor","scanSummary",source.slice(start,end)+";return {checklistRooms,summary};");
  const result = finish({rooms:[old],dismissed:new Map()},withCurrentRoomInstructions,
    (name,note)=>note?[name+": "+note]:[],()=>"Leave the oven alone",name=>name.toLowerCase(),()=>[],scanSummary);
  assert.equal(result.checklistRooms[0].transcript,"Leave the oven alone");
  assert.ok(result.summary.tasks.includes("Kitchen: Leave the oven alone"));
  assert.ok(!result.summary.tasks.includes("Kitchen: Clean inside the oven"));
  assert.ok(source.includes("transcript: scanTranscript(checklistRooms)"));
  assert.ok(source.includes("photos: checklistRooms.filter"));
}

{
  const source = readFileSync(new URL("../public/room-scan-overlay.js",import.meta.url),"utf8");
  const start = source.indexOf("photos: checklistRooms.filter");
  const end = source.indexOf("rooms: checklistRooms.map",start);
  assert.ok(start>0 && end>start);
  const handoff = new Function("checklistRooms","return ({"+source.slice(start,end)+"});");
  const rooms = [{name:"Kitchen",transcript:"Leave the oven alone",image:"data:image/jpeg;base64,TEST"},
    {name:"Bathroom",transcript:"No photo"}];
  const before = JSON.stringify(rooms);
  assert.deepEqual(handoff(rooms).photos,[{roomName:"Kitchen",note:"Leave the oven alone",dataUrl:rooms[0].image}]);
  assert.equal(JSON.stringify(rooms),before);
}

{
  const {usableLiveBoxes,mergeItemReadings,mergeSavedDetections,scanChecklistLines} = await import("../public/room-scan-model.js");
  const {applyCorrection} = await import("../public/scan-review-render.js");
  const selected = usableLiveBoxes([
    {id:"m1",inventoryKey:"manual:1",kind:"manual",x:10,y:10,width:20,height:20},
    {id:"m2",inventoryKey:"manual:2",kind:"manual",x:60,y:60,width:20,height:20}]);
  const missing = mergeItemReadings(selected,{items:[],tasks:[]});
  const saved = mergeSavedDetections([],missing);
  assert.equal(saved.length,2,"Two unnamed customer selections were collapsed into one row.");
  assert.ok(saved.every(item=>item.quantity===1));
  const corrected = applyCorrection([{name:"Kitchen",objects:saved}],{roomName:"Kitchen",inventoryKey:"manual:1",field:"label",value:"Extractor"});
  assert.deepEqual(corrected.rooms[0].objects.map(item=>item.label),["Extractor","Needs a name"]);
  assert.equal(corrected.rooms[0].objects[0].needsName,false);
  assert.equal(mergeSavedDetections(corrected.rooms[0].objects,[{...saved[0],label:"Wrong",needsName:false}])[0].label,"Extractor");
  const reopened = usableLiveBoxes(saved.map((item,index)=>({...item,id:"s"+index,kind:"detected"})));
  assert.deepEqual(reopened.map(item=>item.inventoryKey),["manual:1","manual:2"]);
  const named = mergeItemReadings(reopened,{items:[{id:"s0",label:"Extractor"},{id:"s1",label:"Worktop"}]});
  const merged = mergeSavedDetections(saved,named);
  assert.equal(merged.length,2,"Naming an existing manual item added a phantom placeholder.");
  assert.deepEqual(merged.map(item=>item.inventoryKey),["manual:1","manual:2"]);
  assert.deepEqual(merged.map(item=>item.label),["Extractor","Worktop"]);
  const graded = mergeSavedDetections([{...saved[0],condition:"clean",conditionConfirmed:true}],
    [{...named[0],condition:"heavy"}]);
  assert.equal(graded[0].label,"Extractor");
  assert.equal(graded[0].condition,"clean");
  assert.equal(graded[0].conditionConfirmed,true);
  const provisional = selected.map(item=>({...item,label:"Marked item",needsName:true}));
  assert.deepEqual(mergeSavedDetections(provisional,named).map(item=>item.label),["Extractor","Worktop"]);
  assert.deepEqual(scanChecklistLines([{name:"Kitchen",detections:merged,tasks:[]}]),[]);
}

{
  const source = readFileSync(new URL("../public/room-scan-overlay.js",import.meta.url),"utf8");
  const start = source.indexOf("async function onViewfinderTap(event)");
  const end = source.indexOf("function toggleDetectedItem",start);
  assert.ok(start > 0 && end > start);
  const {usableLiveBoxes,boxAtPoint} = await import("../public/room-scan-model.js");
  const state = {frozen:true,manualCount:0,nextManualIdentity:1,candidates:[],selectedIds:new Set()};
  const pick = new Function("state","el","tapPoint","boxAtPoint","atSelectionLimit","usableLiveBoxes",
    "manualBoxSize","refreshSelection",source.slice(start,end)+";return onViewfinderTap;");
  const tap = pick(state,{blocked:{hidden:true}},event=>event,boxAtPoint,()=>false,usableLiveBoxes,20,()=>{});
  await tap({x:20,y:20});
  const first = state.candidates[0];
  state.manualCount = 0;
  state.candidates = [];
  state.selectedIds.clear();
  await tap({x:70,y:70});
  assert.equal(first.id,state.candidates[0].id,"Fixture must exercise reused frame-local ids.");
  assert.notEqual(first.inventoryKey,state.candidates[0].inventoryKey,
    "Selections from separate frozen views must remain independently editable.");
}

{
  const source = readFileSync(new URL("../public/room-scan-overlay.js",import.meta.url),"utf8");
  const start = source.indexOf("async function readRoom(image,");
  const end = source.indexOf("function localRoomTasks",start);
  assert.ok(start>0 && end>start);
  const {inventoryKey,mergeSavedDetections} = await import("../public/room-scan-model.js");
  const read = new Function("state","inventoryKey","localRoomTasks","readingTaskRecords","itemQuantity",
    source.slice(start,end)+";return readRoom;")({readingAllowed:false},inventoryKey,()=>[],()=>[],(await import("../public/room-scan-model.js")).itemQuantity);
  const selections = [{id:"m1",inventoryKey:"manual:1",label:"",x:10,y:10,width:20,height:20},
    {id:"m2",inventoryKey:"manual:2",label:"",x:60,y:60,width:20,height:20}];
  const fallback = await read("frame","Kitchen",selections);
  assert.deepEqual(fallback.detections.map(item=>item.inventoryKey),["manual:1","manual:2"]);
  const provisional=selections.map(item=>({...item,label:"Marked item",needsName:true}));
  assert.equal(mergeSavedDetections(provisional,fallback.detections).length,2);
}

// Saving a deselected object must not restore it from earlier walking evidence.
{
  const {default:vm} = await import("node:vm");
  const model = await import("../public/room-scan-model.js");
  const source = readFileSync(new URL("../public/room-scan-overlay.js",import.meta.url),"utf8");
  const start = source.indexOf("async function saveRoom(");
  const end = source.indexOf("// The shutter freezes first",start);
  assert.ok(start>0 && end>start);
  for (const cleared of [false,true]) for (const offscreen of [false,true]) {
    const boxes = ["Hob","Tap"].map((label,index)=>({id:"s"+index,inventoryKey:label.toLowerCase(),label,
      kind:"detected",x:10+index*50,y:10,width:20,height:20}));
    const records = [{text:"Clean the hob",origin:"vision",inventoryKeys:["hob"]},
      {text:"Descale the tap",origin:"vision",inventoryKeys:["tap"]},
      {text:"Leave the oven alone",origin:"customer",inventoryKeys:[]},
      {text:"Check the handles",origin:"legacy",inventoryKeys:[]}];
    if(offscreen) records.push({text:"Wipe the fridge",origin:"vision",inventoryKeys:["fridge"]});
    const existing = {name:"Kitchen",transcript:"",detections:boxes,tasks:records.map(t=>t.text),
      taskRecords:records,readingStatus:"ready"};
    const state = {rooms:[existing],candidates:boxes,currentRoom:"Kitchen",roomSession:1,consentAsked:true,
      nextReadingRevision:1,pendingReads:0,dismissed:new Map(),
      walkEvidence:new Map([["kitchen",{tasks:records.map(t=>t.text),taskRecords:records}]])};
    let background;
    const context = vm.createContext({...model,state,el:{note:{value:""},readRoom:{},retake:{}},
      setRoomTranscript(){},roomTranscript:()=>"",scanEvents:{record(){}},elapsedSince:()=>0,renderScanProgress(){},
      transcriptKey:name=>name.toLowerCase(),
      inventoryFor:()=>[...boxes.map(box=>({key:box.inventoryKey,label:box.label})),...(offscreen?[{key:"fridge",label:"Fridge"}]:[])],
      localRoomTasks:()=>[],toHub(){},nextRoomSuggestion:()=>null,toast(){},announceGuidance(){},
      window:{setTimeout:fn=>fn()},readRoomInBackground:args=>{background=args}});
    vm.runInContext(source.slice(start,end),context);
    await context.saveRoom("synthetic-image",cleared?[]:[boxes[1]],{revisit:true});
    const verify = () => {
      const saved = state.rooms[0];
      assert.deepEqual(Array.from(saved.detections,item=>item.label),[...(cleared?[]:["Tap"]),...(offscreen?["Fridge"]:[])]);
      const lines = model.scanChecklistLines([saved]);
      assert.ok(!lines.includes("Kitchen: Clean the hob"));
      assert.equal(lines.includes("Kitchen: Descale the tap"),!cleared);
      assert.equal(lines.includes("Kitchen: Wipe the fridge"),offscreen);
      assert.ok(lines.includes("Kitchen: Leave the oven alone"),"Customer instructions must remain customer-owned.");
      assert.ok(lines.includes("Kitchen: Check the handles"),"An unlinked instruction cannot be deleted by guessing.");
      assert.equal(model.scanTaskReview(saved).find(t=>t.text==="Check the handles").reviewRequired,true);
    };
    verify();
    assert.equal(Boolean(background),!cleared,"Removal must not add any new provider calls.");
    if(background) {
      const backgroundStart = source.indexOf("function mergeSavedTasks(");
      const backgroundEnd = source.indexOf("function resumeDeferredRoomReads()",backgroundStart);
      assert.ok(backgroundStart>0 && backgroundEnd>backgroundStart);
      context.renderHub=()=>{};
      context.navigator={onLine:true};
      context.readRoom=async()=>({detections:boxes,tasks:records.map(t=>t.text),taskRecords:records,readingStatus:"ready"});
      vm.runInContext(source.slice(backgroundStart,backgroundEnd),context);
      context.readRoomInBackground(background);
      await new Promise(resolve=>setImmediate(resolve));
      assert.equal(state.pendingReads,0);
      verify();
    }
    state.candidates=state.rooms[0].detections.filter(item=>item.width>0)
      .map((item,index)=>({...item,id:"s"+index,kind:"detected"}));
    await context.saveRoom("synthetic-image",state.candidates,{revisit:true});
    verify();
    state.candidates=boxes;
    await context.saveRoom("synthetic-image",[boxes[0]],{revisit:false});
    assert.ok(state.rooms[0].detections.some(item=>item.inventoryKey==="hob"),
      "Explicitly selecting the hob again must restore it.");
    assert.equal(state.dismissed.get("kitchen").has("hob"),false);
    await new Promise(resolve=>setImmediate(resolve));
    assert.ok(state.rooms[0].detections.some(item=>item.inventoryKey==="hob"));

  }
}

{
  const {mergeInventoryIntoSavedDetections:merge} = await import("../public/room-scan-model.js");
  const old = {inventoryKey:"hob",label:"Hob"};
  const selected = {inventoryKey:"manual:9",label:"Hob",x:10,y:10,width:20,height:20};
  const dismissed = new Set(["hob"]);
  assert.deepEqual(merge([old,selected],[],dismissed).map(item=>item.inventoryKey),["manual:9"],
    "A different explicitly selected object must not inherit a shared name's dismissal.");
  assert.equal(merge([{label:"Hob"}],[],dismissed).length,0,"Legacy items still use their label identity.");
  assert.equal(merge([{inventoryKey:"tap",label:"Kitchen tap"}],[],new Set(["tap","kitchen tap"])).length,0,
    "The actual removed identity stays removed after a rename.");
}

// An unchanged revisit must not turn an unnamed placeholder into a fixed name.
{
  const {default:vm} = await import("node:vm");
  const model = await import("../public/room-scan-model.js");
  const source = readFileSync(new URL("../public/room-scan-overlay.js",import.meta.url),"utf8");
  const start = source.indexOf("async function saveRoom(");
  const end = source.indexOf("// The shutter freezes first",start);
  assert.ok(start>0 && end>start);
  for (const readingStatus of ["manual","ready"]) {
    const boxes = [
      {id:"s0",inventoryKey:"manual:1",label:"Marked item",needsName:true,
        condition:"clean",conditionConfirmed:true,x:10,y:10,width:20,height:20},
      {id:"s1",inventoryKey:"manual:2",label:"Customer shelf",needsName:false,
        x:60,y:60,width:20,height:20}
    ];
    const state = {rooms:[{name:"Kitchen",transcript:"",detections:boxes,tasks:[],readingStatus}],
      candidates:boxes,currentRoom:"Kitchen",roomSession:1,consentAsked:true,nextReadingRevision:1,
      walkEvidence:new Map(),dismissed:new Map()};
    let reads=0;
    const context = vm.createContext({...model,state,el:{note:{value:""},readRoom:{},retake:{}},
      setRoomTranscript(){},roomTranscript:()=>"",scanEvents:{record(){}},elapsedSince:()=>0,renderScanProgress(){},
      transcriptKey:name=>name.toLowerCase(),inventoryFor:()=>[],localRoomTasks:()=>[],toHub(){},
      nextRoomSuggestion:()=>null,toast(){},announceGuidance(){},
      window:{setTimeout:fn=>fn()},readRoomInBackground:()=>{reads+=1}});
    vm.runInContext(source.slice(start,end),context);
    for (let revisit=0;revisit<2;revisit+=1) {
      await context.saveRoom("synthetic-image",state.candidates,{revisit:true});
      const saved=state.rooms[0].detections;
      assert.equal(saved[0].needsName,true);
      assert.equal(saved[1].needsName,false);
      const identified=model.mergeSavedDetections(saved,[
        {...boxes[0],label:"Extractor",needsName:false,condition:"heavy",conditionConfirmed:false},
        {...boxes[1],label:"Wrong shelf"}
      ]);
      assert.equal(identified.length,2);
      assert.equal(identified[0].inventoryKey,"manual:1");
      assert.equal(identified[0].label,"Extractor");
      assert.equal(identified[0].condition,"clean");
      assert.equal(identified[0].conditionConfirmed,true);
      assert.equal(identified[1].label,"Customer shelf");
      state.candidates=saved;
    }
    assert.equal(reads,0,"Unchanged saves must not request additional provider reads.");
  }
}

// Reopening one saved group must retain its observed count across every save path.
{
  const {default:vm} = await import("node:vm");
  const model = await import("../public/room-scan-model.js");
  const source = readFileSync(new URL("../public/room-scan-overlay.js",import.meta.url),"utf8");
  const saveStart=source.indexOf("async function saveRoom("),saveEnd=source.indexOf("// The shutter freezes first",saveStart);
  const openStart=source.indexOf("function openRevisit("),openEnd=source.indexOf("/* ── Camera",openStart);
  const readStart=source.indexOf("async function readRoom(image,"),readEnd=source.indexOf("function localRoomTasks",readStart);
  assert.ok(saveStart>0&&saveEnd>saveStart&&openStart>0&&openEnd>openStart&&readStart>0&&readEnd>readStart);
  for (const mixed of [false,true]) for (const retry of [false,true]) {
    const detections=model.mergeSavedDetections([], [10,60].map((x,i)=>({
      id:"c"+i,inventoryKey:"chair",label:"Chair",x,y:10,width:20,height:20,
      condition:mixed&&i===1?"heavy":"clean",conditionConfidence:.9
    })));
    assert.equal(detections[0].quantity,2);
    assert.equal(detections[0].conditionMixed===true,mixed);
    const existing={name:"Kitchen",image:"synthetic-image",transcript:"",detections,tasks:[],
      readingStatus:retry?"needs-retry":"ready"};
    const state={rooms:[existing],currentRoom:"Kitchen",roomSession:1,consentAsked:true,nextReadingRevision:1,
      walkEvidence:new Map(),dismissed:new Map()};
    const el={note:{value:""},readRoom:{},retake:{},canvas:{getContext:()=>({drawImage(){}})},
      still:{},selection:{},viewfinder:{classList:{add(){}}}};
    let reads=0;
    const context=vm.createContext({...model,state,el,
      Image:class {naturalWidth=100;naturalHeight=100;set src(value){this.onload();}},
      prepareLiveRoom(){throw Error("Unexpected fresh capture");},stopDetection(){},layoutFrozen(){},refreshSelection(){},
      setRoomTranscript(){},roomTranscript:()=>"",scanEvents:{record(){}},elapsedSince:()=>0,renderScanProgress(){},
      transcriptKey:name=>name.toLowerCase(),inventoryFor:()=>[],localRoomTasks:()=>[],toHub(){},
      nextRoomSuggestion:()=>null,toast(){},announceGuidance(){},
      window:{setTimeout:fn=>fn()},readRoomInBackground:()=>{reads+=1}});
    vm.runInContext(source.slice(openStart,openEnd)+"\n"+source.slice(saveStart,saveEnd)+"\n"+source.slice(readStart,readEnd),context);
    for(let revisit=0;revisit<2;revisit+=1) {
      context.openRevisit(state.rooms[0],1);
      assert.equal(model.itemQuantity(state.candidates[0]),2);
      assert.equal(state.candidates[0].conditionMixed===true,mixed);
      const offline=await context.readRoom(existing.image,"Kitchen",state.candidates);
      const identified=model.mergeItemReadings(state.candidates,{items:[{id:"s0",label:"Chair",condition:"clean",conditionConfidence:.99}]});
      for(const batch of [offline.detections,identified]) {
        assert.equal(model.itemQuantity(batch[0]),2);
        assert.equal(batch[0].conditionMixed===true,mixed);
        assert.equal(model.mergeSavedDetections(state.rooms[0].detections,batch)[0].quantity,2,
          "Another view must not add the same group twice.");
      }
      await context.saveRoom(existing.image,state.candidates,{revisit:true});
      const saved=state.rooms[0].detections[0];
      assert.equal(model.itemQuantity(saved),2);
      assert.equal(saved.conditionMixed===true,mixed);
      if(mixed) assert.equal(model.conditionNeedsReview(saved),true);
    }
    assert.equal(reads,retry?1:0,"Unchanged saves must not add provider calls.");
  }
}

// Customer review exposes the supported quantity correction and preserves its ownership.
{
  const {default:vm}=await import("node:vm");
  const {applyCorrection}=await import("../public/scan-review-render.js");
  const source=readFileSync(new URL("../public/landlord-journey.js",import.meta.url),"utf8");
  const controls=source.slice(source.indexOf("function objectControls("),source.indexOf("function renderReviewRooms("));
  const corrected=source.slice(source.indexOf("function correctedScanRooms("),source.indexOf("// Task links are scoped"));
  const correction=source.slice(source.indexOf("function correctScanObject("),source.indexOf("// Sends each customer correction"));
  assert.ok(controls&&corrected&&correction);
  class Node {
    children=[];events={};attrs={};
    append(...items){this.children.push(...items);}
    setAttribute(key,value){this.attrs[key]=value;}
    addEventListener(key,fn){this.events[key]=fn;}
  }
  const object={inventoryKey:"chair",label:"Chair",displayLabel:"3 × Chair",quantity:3,condition:"clean",conditionConfirmed:true};
  const state={scanRooms:[{name:"Kitchen",objects:[object]},{name:"Bedroom",objects:[{...object,quantity:2}]}],
    scanCorrections:[],scanPremiumPlan:{options:[]},scanPremiumSelected:[],draft:{}};
  const effects={invalidations:0,saves:0,refreshes:0};
  const context=vm.createContext({state,applyCorrection,document:{createElement:()=>new Node()},
    textNode:()=>new Node(),premiumChoiceId:()=>"",renderPremiumChoices(){},reconcileReviewedChecklist(){},
    premiumScope:()=>[],editableTaskLines:()=>[],eligiblePremiumSelections:()=>[],updateResultTotals(){},
    invalidateScanRequest(){effects.invalidations++;},saveDraft(){effects.saves++;},refreshScanReview(){effects.refreshes++;}});
  vm.runInContext(controls+"\n"+corrected+"\n"+correction,context);
  const row=context.objectControls("Kitchen",object);
  const actions=row.children.at(-1);
  const select=actions.children.find(node=>node.attrs["aria-label"]==="Quantity of Chair");
  assert.ok(select,"Customer cannot correct a scanner quantity from the review screen.");
  assert.equal(select.children.find(option=>option.selected).value,"3");
  for(const value of ["1","3","2"]) {select.value=value;select.events.change();}
  assert.equal(state.scanCorrections.length,3,"Rapid changes before a review response must all remain effective.");
  assert.equal(context.correctedScanRooms()[0].objects[0].quantity,2);
  assert.equal(context.correctedScanRooms()[1].objects[0].quantity,2);
  assert.equal(state.scanRooms[0].objects[0].quantity,3,"The original observation must remain intact.");
  assert.equal(context.correctedScanRooms()[0].objects[0].conditionConfirmed,true);
  assert.deepEqual(effects,{invalidations:3,saves:3,refreshes:3});
  for(const value of ["0","21","1.5","bad",""]) {select.value=value;select.events.change();}
  assert.equal(state.scanCorrections.length,3,"Invalid quantities must not enter the correction log.");
  state.scanRooms=[{name:"Kitchen",objects:[{...object,quantity:4}]},state.scanRooms[1]];
  assert.equal(context.correctedScanRooms()[0].objects[0].quantity,2,"A later reading must not replace the customer's count.");
}
