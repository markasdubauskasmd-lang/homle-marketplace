import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  correctInventoryItem, frameSignature, inventoryKey, keyframeDefaults,
  inventoryDisplayLabel, itemQuantity, maxConcurrentWalkingReads,
  mergeInventoryIntoSavedDetections, mergeRoomInventory, mergeSavedDetections,
  roomCoverageProgress, rosterSummary, scanSummary, shouldCaptureKeyframe,
  signatureDistance, walkingReadIsBlocked, conditionTag, movementAdvice,
  savedDetectionFromInventoryItem, usableLiveBoxes
} from "../public/room-scan-model.js";

// The scan used to be one shutter press per room, so whatever was not in that one
// shot was never found. Walking around instead means the phone decides which frames
// are worth reading — and the decision has to be tight, because each read costs
// money and a blurred frame is where a recogniser invents things.

/* ── Frame signatures ── */

// A flat grey frame and a flat white frame are different views; two identical
// frames are not. Signatures are compared many times a second, so the only
// question they answer is "has the view changed", not "what is in it".
function flatFrame(value, width = 8, height = 8) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = pixels[index + 1] = pixels[index + 2] = value;
    pixels[index + 3] = 255;
  }
  return { pixels, width, height };
}
// Half dark, half light — turning to face a window looks like this.
function colourFrame(red, green, blue, width = 8, height = 8) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = red;
    pixels[index + 1] = green;
    pixels[index + 2] = blue;
    pixels[index + 3] = 255;
  }
  return { pixels, width, height };
}

function splitFrame(left, right, width = 8, height = 8) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const value = x < width / 2 ? left : right;
      pixels[index] = pixels[index + 1] = pixels[index + 2] = value;
      pixels[index + 3] = 255;
    }
  }
  return { pixels, width, height };
}

const grey = frameSignature(...Object.values(flatFrame(128)));
const greyAgain = frameSignature(...Object.values(flatFrame(128)));
const bright = frameSignature(...Object.values(flatFrame(230)));
const split = frameSignature(...Object.values(splitFrame(40, 220)));
// These have almost exactly the same perceived luminance:
// 255 * .299 ~= 130 * .587. A brightness-only signature calls them the same
// view even though a red sofa and green wall can contain entirely different
// cleaning objects and condition evidence.
const redView = frameSignature(...Object.values(colourFrame(255, 0, 0)));
const equalLuminanceGreenView = frameSignature(...Object.values(colourFrame(0, 130, 0)));

assert.equal(grey.length, 48, "The default room-view signature does not retain all three colour channels in its 4 × 4 grid.");
assert.equal(signatureDistance(grey, greyAgain), 0, "Two identical frames were reported as different views, so a Landlord standing still would be charged for repeated reads.");
assert.ok(signatureDistance(grey, bright) > keyframeDefaults.sceneChangeThreshold, "Turning from a wall to a window was not detected as a change of view.");
assert.ok(signatureDistance(grey, split) > keyframeDefaults.sceneChangeThreshold, "A wholly different composition was not detected as a change of view.");
assert.ok(signatureDistance(redView, equalLuminanceGreenView) > keyframeDefaults.sceneChangeThreshold, "Two differently coloured room areas with equal brightness were treated as the same view, so one could be skipped entirely.");
assert.equal(signatureDistance(null, grey), 1, "A missing signature was not treated as maximally different.");
assert.equal(signatureDistance(grey, [1, 2]), 1, "Mismatched signature sizes were compared rather than rejected.");
assert.equal(frameSignature(null, 8, 8), null, "Missing pixels did not produce a null signature.");
assert.equal(frameSignature(new Uint8ClampedArray(4), 0, 0), null, "A zero-sized frame did not produce a null signature.");
assert.equal(frameSignature(new Uint8ClampedArray(4), 8, 8), null, "A truncated camera sample invented a usable room-view signature.");

/* ── Which frames get read ── */

const base = { now: 100_000, lastCaptureAt: 0, capturedCount: 0, busy: false };

// The first settled view of a room is worth reading, but a lone first sample
// cannot prove the phone is steady. Accepting it spends one of four bounded AI
// reads while the Landlord may still be turning through the doorway.
assert.ok(shouldCaptureKeyframe({ ...base, signature: grey, previousSignature: grey }), "The first steady frame of a room was not read, so a room the Landlord never moved in would be read never.");
assert.ok(!shouldCaptureKeyframe({ ...base, signature: grey }), "The first camera sample was read without any earlier frame proving the phone was steady.");

// Standing still, having already read this view: nothing new to learn.
assert.ok(!shouldCaptureKeyframe({ ...base, signature: grey, previousSignature: grey, lastReadSignature: greyAgain }), "The same wall was read twice. Standing still must not cost repeated reads.");

// A new view, settled: read it.
assert.ok(shouldCaptureKeyframe({ ...base, signature: bright, previousSignature: bright, lastReadSignature: grey }), "Turning to a new part of the room did not trigger a read, which is the whole point of walking around.");

// A new view, but mid-swing: a blurred frame is where a recogniser invents things.
assert.ok(!shouldCaptureKeyframe({ ...base, signature: bright, previousSignature: grey, lastReadSignature: split }), "A frame was read mid-swing. Motion blur is exactly where recognition goes wrong.");

// Framing advice must be a gate, not decoration. These are the exact three
// conditions the live quality pass reports. Each one would make object and dirt
// assessment unreliable, and each rejected frame must leave the room's read
// budget untouched so the corrected view can still be captured.
for (const qualityKind of ["dark", "bright", "uneven", "soft"]) {
  assert.ok(
    !shouldCaptureKeyframe({ ...base, signature: bright, previousSignature: bright, lastReadSignature: grey, qualityKind }),
    `A ${qualityKind} frame consumed a paid room read even though the scanner had already told the Landlord to correct it.`
  );
}
assert.ok(
  shouldCaptureKeyframe({ ...base, signature: bright, previousSignature: bright, lastReadSignature: grey, qualityKind: "" }),
  "A corrected frame remained blocked after its quality warning cleared."
);
assert.ok(
  !shouldCaptureKeyframe({ ...base, signature: bright, previousSignature: bright, lastReadSignature: grey, online: false }),
  "A known-offline phone consumed a room-read slot even though no request could leave the device."
);
assert.ok(
  shouldCaptureKeyframe({ ...base, signature: bright, previousSignature: bright, lastReadSignature: grey, online: true }),
  "A settled view did not become eligible again after the phone reconnected."
);

/* ── The bounds that keep a walk from becoming a bill ── */

assert.ok(!shouldCaptureKeyframe({ ...base, signature: bright, previousSignature: bright, lastReadSignature: grey, capturedCount: keyframeDefaults.maxPerRoom }), `More than ${keyframeDefaults.maxPerRoom} reads were allowed for one room. The cap is what bounds what a scan can cost.`);
assert.ok(!shouldCaptureKeyframe({ ...base, signature: bright, previousSignature: bright, lastReadSignature: grey, lastCaptureAt: base.now - 10 }), "A second read fired immediately after the first, ignoring the minimum interval.");
assert.ok(!shouldCaptureKeyframe({ ...base, signature: bright, previousSignature: bright, lastReadSignature: grey, busy: true }), "A read was started while one was already in flight.");
assert.ok(!shouldCaptureKeyframe({ ...base, signature: null }), "A missing signature did not stop the read.");

// A slow response from the room just left may overlap the room now being
// scanned, but never another read for itself and never an unbounded third room.
assert.equal(maxConcurrentWalkingReads, 2, "The cross-room walking-read bound changed without updating its load and responsiveness evidence.");
assert.ok(!walkingReadIsBlocked(new Set(["kitchen"]), "bathroom"), "A Kitchen read blocked automatic scanning after the Landlord moved into the Bathroom.");
assert.ok(walkingReadIsBlocked(new Set(["kitchen"]), "kitchen"), "A room started a second walking read while its first was still in flight.");
assert.ok(walkingReadIsBlocked(new Set(["kitchen", "bathroom"]), "bedroom"), "A third room exceeded the global walking-read concurrency bound.");
assert.ok(!walkingReadIsBlocked(new Set(), "bedroom"), "An idle scanner reported no walking-read capacity.");
assert.ok(walkingReadIsBlocked(null, ""), "An unnamed room was allowed to consume a walking read.");

/* ── Room coverage reports accepted views, not elapsed time ── */

assert.deepEqual(
  roomCoverageProgress(0),
  { count: 0, total: 4, percent: 0, complete: false, copy: "Hold steady to begin" },
  "A room with no accepted view reported progress."
);
assert.equal(roomCoverageProgress(1).percent, 25, "The first distinct accepted view did not advance room coverage by one bounded step.");
assert.equal(roomCoverageProgress(2).copy, "Show one more angle", "Half-room guidance does not tell the customer what to do next.");
assert.equal(roomCoverageProgress(3).complete, false, "Good coverage was misreported as full coverage before the final distinct view.");
assert.equal(roomCoverageProgress(3).copy, "Good coverage — confirm", "Three distinct views do not give the customer a clear, honest finish option.");
assert.deepEqual(
  roomCoverageProgress(4),
  { count: 4, total: 4, percent: 100, complete: true, copy: "Room covered — confirm" },
  "The bounded final view did not report complete room coverage."
);
assert.equal(roomCoverageProgress(99).count, 4, "Coverage exceeded the same four-view bound enforced for provider reads.");
assert.equal(roomCoverageProgress(-5).count, 0, "Invalid negative coverage escaped into the UI.");

/* ── The inventory accumulates rather than replaces ── */

// Read from four angles, a room should end up with the union of what was visible —
// not the contents of whichever frame happened to be last.
let inventory = mergeRoomInventory([], [{ label: "Radiator", score: 0.8 }, { label: "Bed", score: 0.9 }], { now: 1 });
assert.equal(inventory.length, 2, "The first reading did not populate the inventory.");
inventory = mergeRoomInventory(inventory, [{ label: "Blinds", score: 0.7 }], { now: 2 });
assert.deepEqual([...inventory].map((item) => item.label).sort(), ["Bed", "Blinds", "Radiator"], "A later reading replaced the inventory instead of adding to it — the reason a single shutter press missed most of a room.");

/* ── ...and does not repeat itself ── */

inventory = mergeRoomInventory(inventory, [{ label: "radiator", score: 0.75 }, { label: "The Blinds", score: 0.6 }], { now: 3 });
assert.equal(inventory.length, 3, `Seeing the same items again added duplicate rows: ${inventory.map((item) => item.label).join(", ")}`);
const radiator = inventory.find((item) => item.key === inventoryKey("Radiator"));
assert.equal(radiator.sightings, 2, "Seeing an item from a second angle was not counted, so nothing distinguishes a confident item from a one-off glimpse.");
assert.equal(radiator.score, 0.8, "A lower-confidence second sighting overwrote the better one.");

// Casing, articles and plurals are the same item to a Landlord reading a checklist.
assert.equal(inventoryKey("The Blinds"), inventoryKey("blind"), "Article and plural differences created two rows for one item.");
assert.equal(inventoryKey("  Chest of Drawers "), inventoryKey("chest of drawers"), "Whitespace and casing created two rows for one item.");
assert.equal(inventoryKey("Faucet"), inventoryKey("Tap"), "UK/US names for one tap created duplicate room items.");
assert.equal(inventoryKey("Countertops"), inventoryKey("Worktop"), "Countertop and worktop readings created duplicate room items.");
assert.equal(inventoryKey("Couch"), inventoryKey("Sofa"), "Couch and sofa readings created duplicate room items.");
assert.equal(inventoryKey("Refrigerator"), inventoryKey("Fridge"), "Refrigerator and fridge readings created duplicate room items.");
assert.equal(inventoryKey("Shower glass"), inventoryKey("Shower screen"), "Shower glass and shower screen readings created duplicate room items.");
assert.equal(inventoryKey("Glasses"), inventoryKey("Glass"), "Pluralising a word ending in -ss changed its object identity.");
assert.notEqual(inventoryKey("Sink"), inventoryKey("Tap"), "Alias matching collapsed a sink and its tap into one object.");
assert.notEqual(inventoryKey("Dining table"), inventoryKey("Worktop"), "Alias matching collapsed two different cleanable surfaces.");
assert.equal(inventoryKey(""), "", "An empty label produced a key.");
assert.equal(mergeRoomInventory([], [{ label: "   ", score: 1 }], { now: 1 }).length, 0, "A blank label was added to the inventory.");

let aliasInventory = mergeRoomInventory([], [{ label: "Faucet", score: 0.71, condition: "light" }], { now: 1 });
aliasInventory = mergeRoomInventory(aliasInventory, [{ label: "Tap", score: 0.84, condition: "medium" }], { now: 2 });
assert.equal(aliasInventory.length, 1, "Independent views using faucet and tap stored the same real object twice.");
assert.equal(aliasInventory[0].label, "Tap", "The stronger reading did not supply the grouped object's visible label.");
assert.equal(aliasInventory[0].sightings, 2, "Alias deduplication discarded the second view instead of strengthening the object evidence.");

const sameTapTwice = mergeRoomInventory([], [
  { label: "Faucet", score: 0.78, x: 20, y: 25, width: 18, height: 25 },
  { label: "Tap", score: 0.82, x: 21, y: 26, width: 17, height: 24 }
], { now: 1 });
assert.equal(sameTapTwice.length, 1, "Two names for one overlapping tap created two inventory rows.");
assert.equal(sameTapTwice[0].quantity, 1, "One overlapping tap was presented as a quantity of two after alias normalisation.");

const twoRealTaps = mergeRoomInventory([], [
  { label: "Faucet", score: 0.78, x: 5, y: 25, width: 15, height: 25 },
  { label: "Tap", score: 0.82, x: 70, y: 25, width: 15, height: 25 }
], { now: 1 });
assert.equal(twoRealTaps[0].quantity, 2, "Two visibly separate taps were incorrectly collapsed into one.");

/* ── The list is ordered by usefulness, not by repetition ── */

// Reproduces a real scan. The customer walked a bedroom pointing at a printer,
// two laptops and a PC tower. Every one of those appeared in one or two frames.
// "Wall", "Floor" and "Bed" appear in EVERY frame, so under a sightings-first
// sort they took every visible row, and the customer — looking at a list of Wall
// CLEAN, Floor CLEAN, Bed MEDIUM while pointing at a printer — concluded the
// scanner could not see. It could. The useful rows were below the fold.
const walked = mergeRoomInventory([], [
  { label: "Wall", score: 0.9, condition: "clean" },
  { label: "Floor", score: 0.9, condition: "clean" },
  { label: "Printer", score: 0.7, condition: "medium" }
], { now: 1 });
// The generic pair get seen again and again; the printer does not.
let repeated = walked;
for (let frame = 2; frame <= 6; frame += 1) {
  repeated = mergeRoomInventory(repeated, [
    { label: "Wall", score: 0.9, condition: "clean" },
    { label: "Floor", score: 0.9, condition: "clean" }
  ], { now: frame });
}
const wall = repeated.find((item) => item.label === "Wall");
const printer = repeated.find((item) => item.label === "Printer");
assert.ok(wall.sightings > printer.sightings, "This test no longer reproduces the situation it exists for — the generic items must be seen more often than the specific one.");
assert.equal(
  repeated[0].label, "Printer",
  `The one thing needing cleaning was pushed below items seen more often: ${repeated.map((item) => `${item.label}/${item.condition}`).join(", ")}. A row reading "Wall CLEAN" is true, unactionable, and occupying a slot on a phone screen.`
);
assert.ok(
  repeated.findIndex((item) => item.label === "Wall") > repeated.findIndex((item) => item.label === "Printer"),
  "A clean generic surface still outranks a dirty specific object."
);

// A correction outranks the reader's own opinion: the customer looked at it.
const regraded = correctInventoryItem(repeated, inventoryKey("Floor"), { condition: "heavy" });
assert.equal(mergeRoomInventory(regraded, [], { now: 9 })[0].label, "Floor", "An item the customer graded themselves did not rise to the top.");
assert.ok(mergeRoomInventory([], Array.from({ length: 60 }, (_, index) => ({ label: `Item ${index}`, score: 0.5 })), { now: 1 }).length <= 40, "The inventory is unbounded, so a long walk could render hundreds of rows on a phone.");

/* ── A Landlord's correction is final ── */

const key = inventoryKey("Radiator");
let corrected = correctInventoryItem(inventory, key, { label: "Towel radiator" });
assert.equal(corrected.find((item) => item.key === key).label, "Towel radiator", "Renaming an item did not take effect.");
assert.ok(corrected.find((item) => item.key === key).confirmed, "Renaming did not mark the item confirmed, so an automatic reading could rename it back.");

// The point of confirming: a later reading must not undo it.
const afterAnotherRead = mergeRoomInventory(corrected, [{ label: "Radiator", score: 0.99 }], { now: 9 });
assert.equal(afterAnotherRead.find((item) => item.key === key).label, "Towel radiator", "A later automatic reading overwrote a name the Landlord had corrected, which is the fastest way to lose their trust in the whole scan.");

assert.equal(correctInventoryItem(inventory, key, { remove: true }).some((item) => item.key === key), false, "Removing an item did not take effect.");
assert.equal(correctInventoryItem(inventory, "not-a-key", { remove: true }).length, inventory.length, "Removing an unknown key changed the inventory.");
assert.ok(correctInventoryItem(inventory, key, { confirmed: true }).find((item) => item.key === key).confirmed, "Confirming an item without renaming it did not mark it confirmed.");
assert.equal(correctInventoryItem(inventory, key, { label: "   " }).find((item) => item.key === key).label, "Radiator", "A blank rename erased the label.");

const customerGraded = correctInventoryItem([{
  key: inventoryKey("Tap"), label: "Tap", score: 0.82, condition: "medium",
  conditionConfirmed: false, confirmed: false, quantity: 1
}], inventoryKey("Tap"), {
  label: "Bathroom tap", condition: "heavy", confirmed: true
});
assert.equal(customerGraded[0].condition, "heavy", "The customer could not replace the automatic condition grade.");
assert.equal(customerGraded[0].conditionConfirmed, true, "The customer's condition choice was not marked final.");
const customerGradedSaved = mergeInventoryIntoSavedDetections([
  { id: "tap-box", label: "Tap", condition: "medium", x: 20, y: 20, width: 30, height: 30 }
], customerGraded);
assert.equal(customerGradedSaved[0].condition, "heavy", "The red room-save action replaced a customer-confirmed grade with automatic evidence.");
assert.equal(customerGradedSaved[0].conditionConfirmed, true, "The red room-save action forgot that the grade was customer-confirmed.");
const afterAutomaticRevisit = mergeSavedDetections(customerGradedSaved, [
  { id: "tap-read", label: "Tap", condition: "light", x: 18, y: 18, width: 34, height: 34 }
]);
assert.equal(afterAutomaticRevisit[0].condition, "heavy", "A later automatic revisit overrode a grade the customer had confirmed.");

/* ── Walking evidence survives the red save button ── */

const limescaleInventory = mergeRoomInventory([], [{
  label: "Tap", score: 0.82, condition: "medium",
  soiling: ["limescale"], note: "Limescale — white deposits around the tap base"
}], { now: 10 });
assert.deepEqual(limescaleInventory[0].soiling, ["limescale"], "The walking inventory discarded the named cleaning issue before the room could be saved.");
const storedTap = savedDetectionFromInventoryItem(limescaleInventory[0]);
assert.equal(storedTap.condition, "medium", "The saved walking object lost its condition grade.");
assert.deepEqual(storedTap.soiling, ["limescale"], "The saved walking object lost its structured soiling type.");
assert.equal(storedTap.note, "Limescale — white deposits around the tap base", "The saved walking object replaced visible evidence with a generic provenance note.");

const closerTap = mergeRoomInventory(limescaleInventory, [{
  label: "Tap", score: 0.91, condition: "heavy",
  soiling: ["limescale", "damage"], note: "Heavy crust and a chipped finish"
}], { now: 11 });
assert.equal(closerTap[0].condition, "heavy", "A better-evidenced walking view did not update the object's grade.");
assert.deepEqual(closerTap[0].soiling, ["limescale", "damage"], "A better-evidenced walking view updated the grade but left stale soiling evidence.");
assert.equal(savedDetectionFromInventoryItem({ label: "   " }), null, "A blank inventory row became a stored room detection.");

/* ── Several real objects are not mistaken for repeated sightings ── */

let furnitureInventory = mergeRoomInventory([], [
  { label: "Chair", score: 0.82, x: 4, y: 25, width: 20, height: 50 },
  // A second almost-identical box around the first chair is detector duplication,
  // not proof of another chair.
  { label: "Chair", score: 0.79, x: 5, y: 26, width: 20, height: 49 },
  { label: "Chair", score: 0.88, x: 58, y: 24, width: 20, height: 51 },
  { label: "Table", score: 0.9, x: 25, y: 30, width: 38, height: 40 }
], { now: 20 });
const chairGroup = furnitureInventory.find((item) => item.key === inventoryKey("Chair"));
assert.equal(furnitureInventory.length, 2, "Separate chairs created duplicate list rows instead of one grouped item.");
assert.equal(chairGroup.quantity, 2, "Two separate chair boxes were collapsed, or one overlapping duplicate box was counted as a third chair.");
assert.equal(chairGroup.sightings, 1, "Several same-label boxes in one view were misreported as several camera-angle sightings.");
assert.equal(inventoryDisplayLabel(chairGroup), "2 × Chair", "The grouped quantity is not visible in the compact review list.");

// A later angle showing one chair is the same room evidence, not a third chair.
furnitureInventory = mergeRoomInventory(furnitureInventory, [
  { label: "Chair", score: 0.9, x: 30, y: 20, width: 25, height: 60 }
], { now: 21 });
assert.equal(furnitureInventory.find((item) => item.key === inventoryKey("Chair")).quantity, 2, "Quantities were added across camera angles, so the same chair was stored repeatedly.");
assert.equal(furnitureInventory.find((item) => item.key === inventoryKey("Chair")).sightings, 2, "A later view did not strengthen the grouped chair evidence.");

// One later frame genuinely proves that a third chair exists.
furnitureInventory = mergeRoomInventory(furnitureInventory, [
  { label: "Chair", score: 0.9, x: 2, y: 20, width: 18, height: 60 },
  { label: "Chair", score: 0.86, x: 40, y: 20, width: 18, height: 60 },
  { label: "Chair", score: 0.84, x: 78, y: 20, width: 18, height: 60 }
], { now: 22 });
const threeChairs = furnitureInventory.find((item) => item.key === inventoryKey("Chair"));
assert.equal(threeChairs.quantity, 3, "A larger simultaneous same-object count did not update the room inventory.");
assert.equal(itemQuantity({ quantity: 99 }), 20, "An unbounded model quantity could inflate the room summary.");

const groupedSaved = mergeInventoryIntoSavedDetections([
  { id: "box-chair", label: "Chair", x: 2, y: 20, width: 18, height: 60 }
], [threeChairs]);
assert.equal(groupedSaved.length, 1, "Walking and confirmation evidence created two saved Chair rows.");
assert.equal(groupedSaved[0].quantity, 3, "The red save action lost the maximum simultaneous Chair count.");
assert.equal(groupedSaved[0].width, 18, "Grouping the saved Chair quantity discarded its confirmation-frame geometry.");
assert.equal(mergeSavedDetections(groupedSaved, [{ label: "Chair", x: 4, y: 22, width: 17, height: 58 }])[0].quantity, 3, "A later confirmation response reduced the proven Chair count.");

const groupedRoom = [{ name: "Dining room", tasks: ["Wipe the chairs"], detections: groupedSaved }];
assert.equal(scanSummary(groupedRoom).fixtureCount, 3, "The scan summary counted one grouped row rather than the three objects it represents.");
assert.equal(rosterSummary(groupedRoom)[0].itemCount, 3, "The room roster hid the grouped object quantity.");
assert.deepEqual(rosterSummary(groupedRoom)[0].itemLabels, ["3 × Chair"], "The room roster did not expose the grouped quantity clearly.");

console.log("Continuous scan tests passed: frames are read only when the view has genuinely changed, the phone has settled and image quality is usable; reads are bounded per room and never overlap; the inventory accumulates across angles without repeating itself; and a Landlord's correction survives every later reading.");

/* ── The overlay actually walks the room ── */

const model = readFileSync(new URL("../public/room-scan-model.js", import.meta.url), "utf8");
const overlay = readFileSync(new URL("../public/room-scan-overlay.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

// The whole point: reads happen while walking, not on a shutter press, and the
// optional local glow model is not allowed to gate that core behaviour.
assert.match(overlay, /maybeReadKeyframe\(video\)/, "The camera loop no longer triggers keyframe reads, so the scan is back to needing a shutter press per room.");
assert.match(overlay, /shouldCaptureKeyframe\(decision\)/, "Keyframe capture no longer goes through the bounded decision, so a walk could fire an unbounded number of paid reads.");
assert.match(
  overlay,
  /if \(state\.detectorState !== "ready"\) \{[\s\S]{0,180}runKeyframePass\(generation\)/,
  "Automatic walking reads stop while the local object detector loads or after it becomes unavailable."
);
assert.match(
  overlay,
  /function runKeyframePass\(generation\)[\s\S]{0,600}sampleFrameQuality\(video\)[\s\S]{0,180}maybeReadKeyframe\(video\)/,
  "The detector-independent fallback does not measure a fresh frame and send it through the bounded keyframe decision."
);
assert.doesNotMatch(
  overlay.slice(overlay.indexOf("function startDetection()"), overlay.indexOf("function scheduleDetectionFrame")),
  /if \(!state\.liveDetectionAvailable/,
  "Restarting the camera after a detector failure disables the automatic walking-read loop."
);
assert.match(overlay, /keyframeActiveRooms: new Set\(\)/, "Walking reads are still represented by one global busy flag, so changing rooms can stall the scanner.");
assert.match(overlay, /busy: walkingReadIsBlocked\(state\.keyframeActiveRooms, roomKey\)/, "The walking-read scheduler does not enforce per-room overlap and bounded cross-room capacity.");
assert.doesNotMatch(overlay, /keyframeBusy/, "The old global walking-read busy flag can still block a new room.");

// Its own canvas. Sharing `el.canvas` would let a read taken mid-walk replace the
// frame the confirmation is graded from.
assert.match(overlay, /state\.keyframeCanvas/, "Keyframes are drawn on the shared capture canvas, which would overwrite the frame a room confirmation is about to be graded from.");

// The inventory has to reach the saved room, or it is a display that vanishes.
assert.match(overlay, /mergeInventoryIntoSavedDetections\(room\.detections, walked\)/, "Items found while walking are not folded into the saved room, so the checklist would still only know what was in the single confirmation frame.");
assert.match(overlay, /soiling: Array\.isArray\(detection\.soiling\) \? detection\.soiling : \[\]/, "Walking reads discard structured soiling before it reaches the inventory.");

// Labels come back from a reader looking at photographs of a stranger's home.
const inventoryRender = overlay.slice(overlay.indexOf("function renderInventory"), overlay.indexOf("function inventoryFor"));
assert.ok(inventoryRender, "The inventory renderer could not be found to check it.");
assert.doesNotMatch(inventoryRender, /innerHTML/, "The found-items list is rendered with innerHTML. Item labels are model output about a stranger's home and must never be treated as markup.");
assert.match(inventoryRender, /textContent/, "The found-items list does not render its labels as text.");
assert.match(overlay, /data-item-editor-form/, "Tapping a detected item has no compact editor for correcting its name and condition.");
assert.match(overlay, /openItemEditor\(key, rename\)/, "The found-item button still bypasses the item editor.");
assert.doesNotMatch(overlay, /window\.prompt\(/, "The scanner still uses a blocking browser prompt instead of its one-handed item editor.");
assert.match(overlay, /change\.condition = condition/, "The item editor does not send the customer's cleaning-level correction to the model.");
assert.match(styles, /\.scan-item-condition-options\{[^}]*grid-template-columns:repeat\(2/, "The cleaning-level choices are not presented as large mobile-friendly controls.");

/* ── Detected objects glow rather than being boxed ── */

assert.match(styles, /\.det-box\{[^}]*border:none/, "Detections still draw a hard rectangle. A box edge is exactly where the object is not.");
assert.match(styles, /\.det-box\{[^}]*box-shadow:/, "The detection highlight has no glow.");
// `filter: blur()` on a moving element repaints everything beneath it, which is
// what makes this effect stutter while the detector is already using the GPU.
// Comments are stripped first: the block deliberately EXPLAINS why there is no
// blur here, and that prose must not be mistaken for a declaration.
const scanStyles = styles.replace(/\/\*[\s\S]*?\*\//g, "");
// The two rules that sit over the live camera feed.
const overCamera = [...scanStyles.matchAll(/(?:\.det-box|\.found)\{[^}]*\}/g)].map((match) => match[0]).join(" ");
assert.ok(overCamera, "The detection and found-list rules could not be located to check them.");
assert.doesNotMatch(overCamera, /filter:\s*blur\(/, "A rule over the live camera uses a blur filter. Both `filter: blur()` on a moving element and `backdrop-filter` on a panel over the feed recomposite the camera every frame, on a phone already running inference.");
const glowBlock = scanStyles.slice(scanStyles.lastIndexOf(".det-box{"));
assert.match(glowBlock, /prefers-reduced-motion/, "The glow animations are not disabled for reduced motion.");

/* ── The consent has to describe what now actually happens ── */

// It used to say "the photo of each room is sent". Several frames per room are
// sent now, automatically, and a consent that understates that is not consent.
assert.match(overlay, /a few still frames from each room are sent/, "The consent copy still describes a single photo per room, which is no longer what happens.");
assert.match(overlay, /up to four while you walk, plus one when you confirm the room/, "The consent copy does not state the real per-room total. The confirmation read is a fifth frame, and a bound that omits it is not the bound a Landlord agreed to.");
assert.equal(
  keyframeDefaults.maxPerRoom, 4,
  `The walking cap is ${keyframeDefaults.maxPerRoom} but the consent copy promises four while walking. The number a Landlord agreed to and the number the code enforces must be the same.`
);
// The budget is looked up per room, not reset on entry. Resetting it meant a lap
// of the hallway bought another four reads of the same kitchen.
assert.match(overlay, /function keyframeBudget/, "The keyframe budget is no longer looked up per room.");
assert.doesNotMatch(overlay, /resetKeyframeBudget/, "The per-room budget is reset again on room entry, so walking out and back in buys a fresh set of paid reads.");
assert.match(overlay, /data-live-progress-meter[^>]*role="progressbar"/, "The live scanner has no accessible current-room coverage indicator.");
assert.match(overlay, /roomCoverageProgress\(budget\.capturedCount\)/, "Room coverage is not derived from the accepted distinct-view budget.");
assert.match(overlay, /busy \? "Checking this view…" : progress\.copy/, "The coverage indicator cannot distinguish a view being analysed from one already accepted.");
assert.ok(
  overlay.indexOf("budget.capturedCount += 1") < overlay.indexOf("budget.capturedCount += 1") + overlay.slice(overlay.indexOf("budget.capturedCount += 1")).indexOf("renderScanProgress()"),
  "Accepting a distinct room view does not immediately redraw coverage."
);
assert.match(styles, /\.scan-progress-meter\[data-level="4"\] i\{[^}]*scaleX\(1\)[^}]*var\(--scan-ok\)/, "Full room coverage has no settled visual completion state.");
// A refund on failure is a re-entry hole: the next steady view spends it again,
// and a timeout can arrive after the provider has already been billed.
const keyframeBody = overlay.slice(overlay.indexOf("function maybeReadKeyframe"), overlay.indexOf("function inventoryFor"));
assert.doesNotMatch(keyframeBody, /capturedCount = Math\.max\(0, /, "A failed keyframe read refunds its attempt, which lets a failing room retry without bound.");
assert.match(overlay, /async function maybeReadKeyframe\(video\)[\s\S]*await encodeCanvasJpeg\(canvas, 0\.72\)/, "Walking frames are not encoded asynchronously, so automatic reads can still pause the live camera.");
assert.doesNotMatch(keyframeBody, /canvas\.toDataURL\("image\/jpeg", 0\.72\)/, "The walking path still performs synchronous JPEG compression on the camera thread.");
assert.ok(
  keyframeBody.indexOf("state.keyframeActiveRooms.add(roomKey)") < keyframeBody.indexOf("await encodeCanvasJpeg(canvas, 0.72)"),
  "The room is reserved only after asynchronous encoding, so consecutive video callbacks can encode and send the same view twice."
);
assert.ok(
  keyframeBody.indexOf("await encodeCanvasJpeg(canvas, 0.72)") < keyframeBody.indexOf("budget.capturedCount += 1"),
  "A local JPEG failure consumes the paid room-read allowance before any provider request begins."
);
// Consent has to be asked on the way in, or the first room is walked with nothing
// being read while the hint promises otherwise.
assert.match(overlay, /if \(!state\.consentAsked\) void askConsent\(\);/, "Consent is not requested when entering a room, so the first room reads nothing while telling the Landlord items save themselves.");
// A removed room takes its findings and its spent budget with it.
assert.match(overlay, /state\.inventories\.delete\(key\)/, "Removing a room leaves its found items behind, so re-adding the name resurrects them.");

/* ── A walk has to change the job, not just the screen ── */

// The failure this pins is the whole feature being decorative: items shown as
// "saved" that produce no checklist line, no minutes and no effect on the grade
// the job is priced from. A reading returns tasks and a condition as well as
// object names, and discarding those was exactly that.
assert.match(overlay, /function rememberWalkEvidence/, "Walking reads discard their tasks and condition, so an item the Landlord watched save itself contributes nothing to what the Cleaner is asked to do.");
assert.match(overlay, /tasks: \[\.\.\.existingTasks, \.\.\.evidence\.tasks/, "The tasks a walk gathered never reach the saved room.");
// Deliberately no longer worst-wins. The confirmation grade is authoritative when
// it committed to one — see resolveRoomCondition — because once the confirmation
// read runs on a stronger model, merging it with the walking grades would let the
// cheaper model override the dearer one, and only ever upwards towards
// over-charging. Walking grades still fill in when the confirmation could not judge.
assert.match(overlay, /condition: resolveRoomCondition\(room\.condition, evidence\.condition\)/, "The condition a walk observed never reaches the saved room, or a walking glance can override the confirmation grade that sets the price.");

// The worst grade any angle saw wins. Taking the last reading would let a final
// glance from the doorway undercharge a room that is heavy behind the bin.
assert.match(overlay, /const conditionRank = \{ light: 1, medium: 2, heavy: 3 \}/, "Room condition is no longer ranked, so angles cannot be compared.");

/* ── Corrections survive the reads that follow them ── */

assert.match(overlay, /state\.dismissed/, "Removing an item leaves no record, so the next reading merges it straight back and the removal looks broken.");
assert.match(overlay, /dismissed\.has\(inventoryKey\(detection\?\.label\)\)/, "A reading in flight can re-add an item the Landlord has just removed.");

/* ── A read that outlives its room lands nowhere ── */

assert.match(overlay, /keyframeBudget\(roomName\)\.generation !== generation/, "A keyframe result is applied without checking its room still exists, so a late response can recreate an inventory that was deleted.");

console.log("Continuous scan overlay tests passed: reads are driven by walking rather than a shutter, poor-quality frames are withheld, reads are bounded per room and drawn on their own canvas, findings reach the saved room, detections glow without misleading live labels, and the consent copy states the same per-room bound the code enforces.");

/* ── The verdict is painted on the object, not only listed beside it ── */

// The reader has known each object's condition since the per-item schema landed,
// but the review screen painted every box in the same neutral state. The one
// screen where the customer is looking straight at their own tap said nothing
// about the tap. `conditionTag` is the word placed next to the object.
assert.equal(conditionTag({ condition: "medium", soiling: ["limescale"] }), "Limescale", "A limescaled item is not captioned with what was actually seen.");
assert.equal(conditionTag({ condition: "heavy", soiling: ["grease", "food-debris"] }), "Grease +1", "Multiple soiling types are not summarised; every extra word covers more camera.");
assert.equal(conditionTag({ condition: "heavy", soiling: [] }), "Heavy build-up", "A graded item with no named soiling says nothing at all.");
assert.equal(conditionTag({ condition: "clean", soiling: [] }), "", "A clean object is captioned, which buries the items needing attention under congratulations.");
assert.equal(conditionTag({ condition: "", soiling: ["grease"] }), "", "An ungraded object claims a condition.");
assert.equal(conditionTag(null), "", "A missing box produced a caption.");

// The fields have to survive the box pipeline, or the paint stage has nothing
// to paint. They were being stripped by usableLiveBoxes before.
{
  const [kept] = usableLiveBoxes([{ id: "a", x: 1, y: 1, width: 10, height: 10, label: "Tap", condition: "medium", soiling: ["limescale"], note: "white crust at the base" }]);
  assert.equal(kept.condition, "medium", "usableLiveBoxes strips the condition, so the review paints every object the same neutral state again.");
  assert.deepEqual([...kept.soiling], ["limescale"], "usableLiveBoxes strips the soiling, so the tag cannot say what was seen.");
}
assert.match(overlay, /node\.box\.dataset\.grade = grade/, "The review boxes never receive their grade, so the glow cannot carry the verdict.");
assert.match(overlay, /condition: detection\.condition \|\| ""/, "Revisit drops each detection's condition before painting, so saved rooms review as all-neutral.");
for (const grade of ["heavy", "medium", "light", "clean"]) {
  assert.ok(styles.includes(`.det-box[data-grade="${grade}"]`), `No glow state exists for a ${grade} object, so its verdict is invisible on the object itself.`);
}

/* ── "Slow down" is said when it helps, and only then ── */

// Sustained sweeping is the one problem the quality pass cannot see: a swept
// frame can be bright and, at an instant, sharp. But the tracker loses its
// locks and the keyframe picker (rightly) refuses to spend a read, so a whole
// room can be walked with nothing found and no explanation.
assert.ok(movementAdvice([0.2, 0.2]), "Two consecutive fast samples — a deliberate sweep — produced no guidance.");
assert.equal(movementAdvice([0.01, 0.2]), null, "A single fast sample triggered the hint. That is just the customer turning to the next wall, which the scan exists to encourage.");
assert.equal(movementAdvice([0.2, 0.01]), null, "The hint persists after the phone has settled.");
assert.equal(movementAdvice([]), null, "No samples produced advice.");
assert.equal(movementAdvice([0.2]), null, "One sample is not a streak.");
assert.equal(movementAdvice([NaN, 0.5, 0.5]) === null, false, "Garbage samples poisoned real ones.");
// Lighting outranks movement: a dark room stays dark however slowly you move.
assert.match(
  overlay,
  /const quality = frameQualityStats\(pixels, width, height\);[\s\S]{0,4000}frameQualityAdvice\(quality\)\s*\|\| movementAdvice\(state\.motionDistances\)/,
  "The quality gate either ignores clipped shadows/highlights or lets movement advice pre-empt the lighting problem."
);
assert.equal((overlay.match(/getImageData\(/g) || []).length, 1, "Uneven exposure added another synchronous camera readback.");
assert.match(model, /const previousRow = new Float32Array\(columns\);[\s\S]{0,2000}Math\.abs\(luma - previousRow\[x\]\)/, "Frame sharpness still depends on edge direction because vertical neighbours are not measured.");

/* ── Review-caught regressions, pinned ── */

// Saving an unchanged revisit deliberately buys no new reading — which only works
// if it KEEPS the old one. Both save branches used to rebuild detections with
// label and geometry only, so open-then-save silently erased every grade.
const saveBranches = overlay.split("detections: chosen.map((box) => ({").length - 1;
assert.equal(saveBranches, 2, "The save paths changed shape; re-check that every branch still preserves per-item condition.");
assert.equal((overlay.match(/condition: box\.condition \|\| "", conditionConfirmed: box\.conditionConfirmed === true,\s*soiling: box\.soiling \|\| \[\]/g) || []).length, 2, "A save branch rebuilds detections without its condition or the customer's confirmation, so saving an unchanged room erases the final grading.");

// The first sample of a session must not count as fast motion: distance-from-null
// is defined as 1, which would halve the streak the hint requires.
assert.match(overlay, /if \(Array\.isArray\(state\.previousSignature\) && Array\.isArray\(state\.signature\)\) \{\s*state\.motionDistances\.push/, "Motion is measured against a missing signature, so the first sample of every room counts as a sweep.");
// And the history dies with the room, or a doorway walk blocks the next room's first read.
assert.match(overlay, /state\.motionDistances = \[\];\s*state\.signature = null;\s*state\.previousSignature = null;/, "Motion history survives a room change, so a fast sample from the hallway can hold back the new room's first paid read.");

// Removing a graded item from the selection must look different from keeping it.
// The grade rules share specificity with `.picked` and come later, so without
// this the two states rendered almost identically and a wrong selection saved.
assert.ok(styles.includes(".det-box.pickable[data-grade]:not(.picked)"), "A deselected graded box renders the same as a kept one, so the review cannot show what is about to be saved.");

console.log("Condition-on-object and movement guidance tests passed: graded objects carry their verdict and its colour on the object itself, clean objects stay quiet, the box pipeline preserves condition, and sustained sweeping earns one clearing hint that lighting problems outrank.");
