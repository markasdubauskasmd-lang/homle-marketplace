import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  correctInventoryItem, frameSignature, inventoryKey, keyframeDefaults,
  mergeRoomInventory, shouldCaptureKeyframe, signatureDistance
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

assert.equal(signatureDistance(grey, greyAgain), 0, "Two identical frames were reported as different views, so a Landlord standing still would be charged for repeated reads.");
assert.ok(signatureDistance(grey, bright) > keyframeDefaults.sceneChangeThreshold, "Turning from a wall to a window was not detected as a change of view.");
assert.ok(signatureDistance(grey, split) > keyframeDefaults.sceneChangeThreshold, "A wholly different composition was not detected as a change of view.");
assert.equal(signatureDistance(null, grey), 1, "A missing signature was not treated as maximally different.");
assert.equal(signatureDistance(grey, [1, 2]), 1, "Mismatched signature sizes were compared rather than rejected.");
assert.equal(frameSignature(null, 8, 8), null, "Missing pixels did not produce a null signature.");
assert.equal(frameSignature(new Uint8ClampedArray(4), 0, 0), null, "A zero-sized frame did not produce a null signature.");

/* ── Which frames get read ── */

const base = { now: 100_000, lastCaptureAt: 0, capturedCount: 0, busy: false };

// The first steady frame of a room is always worth reading.
assert.ok(shouldCaptureKeyframe({ ...base, signature: grey, previousSignature: grey }), "The first steady frame of a room was not read, so a room the Landlord never moved in would be read never.");
assert.ok(shouldCaptureKeyframe({ ...base, signature: grey }), "The very first frame, with nothing to compare against, was not read.");

// Standing still, having already read this view: nothing new to learn.
assert.ok(!shouldCaptureKeyframe({ ...base, signature: grey, previousSignature: grey, lastReadSignature: greyAgain }), "The same wall was read twice. Standing still must not cost repeated reads.");

// A new view, settled: read it.
assert.ok(shouldCaptureKeyframe({ ...base, signature: bright, previousSignature: bright, lastReadSignature: grey }), "Turning to a new part of the room did not trigger a read, which is the whole point of walking around.");

// A new view, but mid-swing: a blurred frame is where a recogniser invents things.
assert.ok(!shouldCaptureKeyframe({ ...base, signature: bright, previousSignature: grey, lastReadSignature: split }), "A frame was read mid-swing. Motion blur is exactly where recognition goes wrong.");

/* ── The bounds that keep a walk from becoming a bill ── */

assert.ok(!shouldCaptureKeyframe({ ...base, signature: bright, previousSignature: bright, lastReadSignature: grey, capturedCount: keyframeDefaults.maxPerRoom }), `More than ${keyframeDefaults.maxPerRoom} reads were allowed for one room. The cap is what bounds what a scan can cost.`);
assert.ok(!shouldCaptureKeyframe({ ...base, signature: bright, previousSignature: bright, lastReadSignature: grey, lastCaptureAt: base.now - 10 }), "A second read fired immediately after the first, ignoring the minimum interval.");
assert.ok(!shouldCaptureKeyframe({ ...base, signature: bright, previousSignature: bright, lastReadSignature: grey, busy: true }), "A read was started while one was already in flight.");
assert.ok(!shouldCaptureKeyframe({ ...base, signature: null }), "A missing signature did not stop the read.");

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
assert.equal(inventoryKey(""), "", "An empty label produced a key.");
assert.equal(mergeRoomInventory([], [{ label: "   ", score: 1 }], { now: 1 }).length, 0, "A blank label was added to the inventory.");

// Most-confirmed first: what the room is surest about is what to check first.
assert.equal(inventory[0].sightings >= inventory.at(-1).sightings, true, "The inventory is not ordered by how well confirmed each item is.");
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

console.log("Continuous scan tests passed: frames are read only when the view has genuinely changed and the phone has settled, reads are bounded per room and never overlap, the inventory accumulates across angles without repeating itself, and a Landlord's correction survives every later reading.");

/* ── The overlay actually walks the room ── */

const overlay = readFileSync(new URL("../public/room-scan-overlay.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

// The whole point: reads happen while walking, not on a shutter press.
assert.match(overlay, /maybeReadKeyframe\(video\)/, "The detection loop no longer triggers keyframe reads, so the scan is back to needing a shutter press per room.");
assert.match(overlay, /shouldCaptureKeyframe\(decision\)/, "Keyframe capture no longer goes through the bounded decision, so a walk could fire an unbounded number of paid reads.");

// Its own canvas. Sharing `el.canvas` would let a read taken mid-walk replace the
// frame the confirmation is graded from.
assert.match(overlay, /state\.keyframeCanvas/, "Keyframes are drawn on the shared capture canvas, which would overwrite the frame a room confirmation is about to be graded from.");

// The inventory has to reach the saved room, or it is a display that vanishes.
assert.match(overlay, /Seen while scanning/, "Items found while walking are not folded into the saved room, so the checklist would still only know what was in the single confirmation frame.");

// Labels come back from a reader looking at photographs of a stranger's home.
const inventoryRender = overlay.slice(overlay.indexOf("function renderInventory"), overlay.indexOf("function inventoryFor"));
assert.ok(inventoryRender, "The inventory renderer could not be found to check it.");
assert.doesNotMatch(inventoryRender, /innerHTML/, "The found-items list is rendered with innerHTML. Item labels are model output about a stranger's home and must never be treated as markup.");
assert.match(inventoryRender, /textContent/, "The found-items list does not render its labels as text.");

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
// A refund on failure is a re-entry hole: the next steady view spends it again,
// and a timeout can arrive after the provider has already been billed.
const keyframeBody = overlay.slice(overlay.indexOf("function maybeReadKeyframe"), overlay.indexOf("function inventoryFor"));
assert.doesNotMatch(keyframeBody, /capturedCount = Math\.max\(0, /, "A failed keyframe read refunds its attempt, which lets a failing room retry without bound.");
// Consent has to be asked on the way in, or the first room is walked with nothing
// being read while the hint promises otherwise.
assert.match(overlay, /if \(!state\.consentAsked\) void askConsent\(\);/, "Consent is not requested when entering a room, so the first room reads nothing while telling the Landlord items save themselves.");
// A removed room takes its findings and its spent budget with it.
assert.match(overlay, /state\.inventories\.delete\(key\)/, "Removing a room leaves its found items behind, so re-adding the name resurrects them.");

console.log("Continuous scan overlay tests passed: reads are driven by walking rather than a shutter, bounded per room and drawn on their own canvas, findings reach the saved room, labels are rendered as text, detections glow without a repaint-forcing blur, and the consent copy states the same per-room bound the code enforces.");
