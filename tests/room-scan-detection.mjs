import {
  fitBoxToFrame,
  frameBoxToSourceRect,
  usableLiveBoxes,
  usableDetections,
  boxAtPoint,
  cocoLabel,
  roomReadingPayload,
  roomReadingLimitBytes,
  mergeItemReadings,
  trackDetections,
  drawableTracks,
  frameQualityAdvice,
  nextDetectionDelay,
  roomPresets,
  normaliseRoomName,
  findRoom,
  canAddRoom,
  upsertRoom,
  rosterSummary,
  maximumShots
} from "../public/room-scan-model.js";

function assert(condition, message) { if (!condition) throw new Error(message); }
const close = (value, expected, tolerance = 0.001) => Math.abs(value - expected) < tolerance;

/* ── Mapping detector pixels onto the viewfinder ────── */

// Same aspect ratio: the box lands exactly where the proportions say it should.
const identity = fitBoxToFrame({ x: 100, y: 100, width: 200, height: 200 }, { videoWidth: 1000, videoHeight: 1000, frameWidth: 500, frameHeight: 500 });
assert(close(identity.x, 10) && close(identity.y, 10) && close(identity.width, 20) && close(identity.height, 20), `A box on a matching aspect ratio was misplaced: ${JSON.stringify(identity)}`);
assert(identity.clipped === false, "A fully visible box was reported as clipped.");

// `object-fit: cover` on a wider-than-tall video shows only the central strip:
// of 2000 video pixels, x 500–1500 is visible. A box straddling that boundary —
// a sofa running off the left edge — must clamp to what is visible and say so.
const cropped = fitBoxToFrame({ x: 400, y: 0, width: 200, height: 200 }, { videoWidth: 2000, videoHeight: 1000, frameWidth: 500, frameHeight: 500 });
assert(close(cropped.x, 0) && close(cropped.width, 10) && cropped.clipped === true, `A box cropped by object-fit: cover was not clamped honestly: ${JSON.stringify(cropped)}`);
// A box wholly inside the cropped-away region has nothing visible to draw.
assert(fitBoxToFrame({ x: 0, y: 0, width: 200, height: 200 }, { videoWidth: 2000, videoHeight: 1000, frameWidth: 500, frameHeight: 500 }) === null, "A box in the cropped-away region was still drawn.");

// `contain` letterboxes instead, offsetting downward rather than cropping.
const letterboxed = fitBoxToFrame({ x: 0, y: 0, width: 200, height: 200 }, { videoWidth: 2000, videoHeight: 1000, frameWidth: 500, frameHeight: 500, fit: "contain" });
assert(close(letterboxed.y, 25), `A letterboxed box ignored the vertical offset: ${JSON.stringify(letterboxed)}`);

// A box entirely inside the cropped-away region has nothing to draw.
assert(fitBoxToFrame({ x: 1900, y: 0, width: 50, height: 50 }, { videoWidth: 2000, videoHeight: 1000, frameWidth: 500, frameHeight: 500 }) === null, "A box outside the visible crop was still drawn.");

// A video that has not reported its dimensions yet must not produce a box.
assert(fitBoxToFrame({ x: 1, y: 1, width: 1, height: 1 }, { videoWidth: 0, videoHeight: 0, frameWidth: 500, frameHeight: 500 }) === null, "A box was computed before the camera reported its size.");
assert(fitBoxToFrame(null, { videoWidth: 100, videoHeight: 100, frameWidth: 100, frameHeight: 100 }) === null, "A missing box was not handled as simply having none.");

/* ── Cutting the crop that gets sent ────────────────── */

// The crop is padded, because a tight crop of a hob loses the worktop around it
// that tells the reader it is a hob and not a radiator.
const rect = frameBoxToSourceRect({ x: 25, y: 25, width: 50, height: 50 }, { canvasWidth: 1000, canvasHeight: 1000, padding: 0.08 });
assert(rect.sx === 210 && rect.sy === 210 && rect.sWidth === 580 && rect.sHeight === 580, `The crop rectangle lost its padding: ${JSON.stringify(rect)}`);
// Padding must never read outside the captured frame.
const edge = frameBoxToSourceRect({ x: 0, y: 0, width: 100, height: 100 }, { canvasWidth: 800, canvasHeight: 600 });
assert(edge.sx === 0 && edge.sy === 0 && edge.sWidth === 800 && edge.sHeight === 600, `A padded crop read outside the frame: ${JSON.stringify(edge)}`);

/* ── Two box rules, deliberately different ──────────── */

// This pair documents the difference. A box the reader *asserted* outside the
// frame is evidence it invented one, so it is discarded. A box *computed* from
// the viewfinder geometry that runs off the edge is simply clipped, and is kept.
const overhanging = { x: 90, y: 10, width: 20, height: 20, label: "Sofa" };
assert(usableDetections([overhanging]).length === 0, "A detection asserted outside the frame was trusted.");
assert(usableLiveBoxes([{ ...overhanging, x: 80, width: 20 }]).length === 1, "A legitimately clipped live box was discarded.");
assert(usableLiveBoxes(null).length === 0, "Missing live boxes were not handled as simply having none.");
assert(usableLiveBoxes(Array.from({ length: 30 }, () => ({ x: 1, y: 1, width: 5, height: 5, label: "Shelf" }))).length === 12, "The live overlay is not bounded.");

/* ── Choosing what was tapped ───────────────────────── */

// The smallest containing box wins, so tapping a tap inside a sink selects the
// tap rather than the worktop behind both.
const boxes = [
  { id: "worktop", x: 0, y: 0, width: 100, height: 100 },
  { id: "sink", x: 40, y: 40, width: 20, height: 20 }
];
assert(boxAtPoint(boxes, 50, 50).id === "sink", "Tapping a small item selected the large one behind it.");
assert(boxAtPoint(boxes, 5, 5).id === "worktop", "Tapping outside the small item did not fall through to the one behind.");
assert(boxAtPoint([], 5, 5) === null && boxAtPoint(boxes, NaN, 5) === null, "An empty or malformed tap was not handled.");

/* ── Naming without paying for it ───────────────────── */

// These are lookups, not judgements, so they must never cost a metered call.
assert(cocoLabel("couch") === "Sofa" && cocoLabel("refrigerator") === "Fridge" && cocoLabel("tv") === "TV", "A known class was not translated into what a person would call it.");
assert(cocoLabel("skateboard") === "Skateboard", "An unmapped class was not shown readably.");
assert(cocoLabel("") === "Item" && cocoLabel(null) === "Item", "An unnamed class produced an empty label.");

/* ── Staying inside the request body limit ──────────── */

// A 413 reaches the Landlord as a generic failure with no way to act on it, so
// the budget is enforced before the request is made.
// Only hand-picked items ever carry a crop: a detected one is already visible
// in the room frame, so sending it twice would be waste.
const bigCrop = `data:image/jpeg;base64,${"A".repeat(40_000)}`;
const budgeted = roomReadingPayload({
  roomName: "Kitchen",
  roomFrame: `data:image/jpeg;base64,${"B".repeat(200_000)}`,
  items: [
    { id: "m1", kind: "manual", label: "", box: { x: 1, y: 1, width: 5, height: 5 }, score: 0.9, crop: bigCrop },
    { id: "m2", kind: "manual", label: "", box: { x: 2, y: 2, width: 5, height: 5 }, score: 0.2, crop: bigCrop },
    { id: "d1", kind: "detected", label: "Sofa", box: { x: 3, y: 3, width: 5, height: 5 }, score: 0.8 }
  ]
}, { limitBytes: 260_000, safetyMargin: 1 });

assert(budgeted.bytes <= 260_000 && budgeted.withinLimit, `The request was allowed to exceed the route's body limit: ${budgeted.bytes}`);
// The room frame is what condition is read from, and condition changes the
// price. It is never what gets dropped.
assert(budgeted.body.image.length > 100_000, "The room frame was dropped to save bytes, taking the condition grade with it.");
// The least confident hand-picked item goes first.
assert(budgeted.droppedItemIds[0] === "m2", `Items were dropped in the wrong order: ${JSON.stringify(budgeted.droppedItemIds)}`);
// It leaves the request entirely rather than travelling without its close-up.
// No coordinates are sent, so an unnamed id with no crop gives the reader
// nothing to identify — in a kitchen holding a kettle, a toaster and an air
// fryer it would not be unsure, it would confidently name the wrong one.
assert(!budgeted.body.items.some((item) => item.id === "m2"), "A hand-picked item was sent with nothing to identify it by.");
assert(budgeted.body.items.every((item) => item.kind !== "manual" || item.crop), "A hand-picked item was sent without its close-up.");
assert(roomReadingLimitBytes === 900 * 1024, "The client budget no longer matches the route's body limit.");

// An oversized room frame on its own must be reported, not silently sent.
const impossible = roomReadingPayload({ roomFrame: `data:image/jpeg;base64,${"C".repeat(400_000)}`, items: [] }, { limitBytes: 100_000, safetyMargin: 1 });
assert(!impossible.withinLimit, "A request too large to send was reported as sendable.");

// The limit is counted in bytes, but a spoken or typed note can hold characters
// that take more than one. Measuring characters would let a request through
// that the route then rejects as too large.
const unicode = roomReadingPayload({ roomName: "Kitchen", transcript: "£".repeat(500), roomFrame: "data:image/jpeg;base64,AAAA", items: [] }, { limitBytes: 900 * 1024 });
assert(unicode.bytes >= 1000, `A multi-byte transcript was measured as if it were ASCII: ${unicode.bytes}`);

// Coordinates never cross the wire. The device owns the geometry, and a reader
// that cannot see a box cannot place one over the wrong thing.
const wire = roomReadingPayload({ roomFrame: "data:image/jpeg;base64,AAAA", items: [{ id: "m1", kind: "manual", label: "", box: { x: 1, y: 2, width: 3, height: 4 }, crop: "data:image/jpeg;base64,BBBB" }] });
assert(!("box" in wire.body.items[0]) && !JSON.stringify(wire.body).includes('"x"'), `Geometry was sent to the reader: ${JSON.stringify(wire.body.items[0])}`);

/* ── Joining the reply back to what was selected ────── */

const selected = [
  { id: "a", x: 1, y: 1, width: 10, height: 10, label: "Sofa" },
  { id: "b", x: 2, y: 2, width: 10, height: 10, label: "Fridge" }
];
const merged = mergeItemReadings(selected, {
  items: [
    { id: "a", label: "Sofa", note: "visible soiling" },
    { id: "ghost", label: "Chandelier", note: "invented" }
  ]
});
// A reply that names something never selected must not be drawn as if it were.
assert(merged.length === 2 && !merged.some((item) => item.id === "ghost"), `An item the client never sent was drawn: ${JSON.stringify(merged)}`);
assert(merged[0].note === "visible soiling", "An observation from the reader was lost.");
// An item the reader did not mention keeps the label the device already knew.
assert(merged[1].label === "Fridge" && merged[1].note === "", "An unmentioned item lost the label the device already had.");
assert(mergeItemReadings(null, null).length === 0, "Missing selections were not handled as simply having none.");

// A hand-picked box has no label of its own — naming it is why it was sent. If
// the reader says nothing about it, the box must survive anyway: the Landlord
// chose it deliberately, and dropping it would lose that choice silently.
const unnamed = mergeItemReadings([{ id: "m1", kind: "manual", x: 1, y: 1, width: 5, height: 5, label: "" }], { items: [] });
assert(unnamed.length === 1 && unnamed[0].label === "Needs a name", `A hand-picked item vanished when the reader did not name it: ${JSON.stringify(unnamed)}`);

/* ── Keeping live boxes steady ──────────────────────── */

const first = trackDetections([], [{ x: 10, y: 10, width: 20, height: 20, className: "couch", score: 0.9 }]);
assert(first.tracks.length === 1 && first.tracks[0].id === 1 && first.nextId === 2, "A first detection did not open a track.");
// One frame is not enough to draw: a single-frame detection is usually noise,
// and drawing it is what makes a good detector look unreliable.
assert(drawableTracks(first.tracks).length === 0, "A single-frame detection was drawn straight away.");

const second = trackDetections(first.tracks, [{ x: 14, y: 10, width: 20, height: 20, className: "couch", score: 0.9 }], { nextId: first.nextId });
assert(second.tracks[0].id === 1 && second.tracks[0].seenFrames === 2, "A moving box was treated as a new object instead of the same one.");
// Smoothed toward the new position, not snapped to it.
assert(second.tracks[0].x > 10 && second.tracks[0].x < 14, `The box was not smoothed between frames: ${second.tracks[0].x}`);
assert(drawableTracks(second.tracks).length === 1, "A box confirmed by a second frame was still not drawn.");

// Beyond roughly half a box width of movement in one frame the overlap is too
// weak to claim it is the same object, and a fresh track is the honest answer.
const jumped = trackDetections(second.tracks, [{ x: 60, y: 10, width: 20, height: 20, className: "couch", score: 0.9 }], { nextId: second.nextId });
assert(jumped.tracks.some((track) => track.id !== 1 && track.seenFrames === 1), "A box that jumped across the frame kept an identity it had not earned.");

// A different class must never adopt an existing track, or the label follows
// the wrong object across the frame.
const swapped = trackDetections(second.tracks, [{ x: 14, y: 10, width: 20, height: 20, className: "chair", score: 0.9 }], { nextId: second.nextId });
assert(swapped.tracks.some((track) => track.className === "chair" && track.id !== 1), "A chair adopted the sofa's identity.");

// A box that drops out is held briefly where it was last seen, then released.
let held = trackDetections(second.tracks, [], { nextId: second.nextId, holdFrames: 2 });
assert(held.tracks.length === 1 && held.tracks[0].missedFrames === 1 && held.tracks[0].x === second.tracks[0].x, "A briefly lost box was dropped immediately or allowed to drift.");
held = trackDetections(held.tracks, [], { nextId: held.nextId, holdFrames: 2 });
held = trackDetections(held.tracks, [], { nextId: held.nextId, holdFrames: 2 });
assert(held.tracks.length === 0, "A box that is genuinely gone was held on screen forever.");

// Low-confidence noise never opens a track at all.
assert(trackDetections([], [{ x: 1, y: 1, width: 5, height: 5, className: "book", score: 0.1 }]).tracks.length === 0, "A low-confidence guess was drawn as a detection.");
assert(trackDetections(null, null).tracks.length === 0, "Missing tracking input was not handled as simply having none.");

/* ── Throttling to what the phone can sustain ───────── */

// A slow device is asked for fewer frames rather than being pinned at 100%,
// because a stuttering viewfinder is worse than fewer boxes.
// Inference runs on a downscaled frame now, so a phone finishing in 80ms is asked
// for ~8 passes a second rather than being held at the old 5-per-second ceiling.
assert(nextDetectionDelay(80) === 120, `A capable phone was throttled unnecessarily: ${nextDetectionDelay(80)}`);
assert(nextDetectionDelay(400) === 600, `A slow phone was asked for frames it cannot deliver: ${nextDetectionDelay(400)}`);
assert(nextDetectionDelay(5000) === 700, "The detection interval is unbounded on a very slow device.");
assert(nextDetectionDelay(0) === 100 && nextDetectionDelay(NaN) === 100, "A missing timing produced an invalid interval.");

/* ── Framing guidance ──────── */
// A usable room gets no cue at all: guidance that fires on an ordinary frame
// teaches the Landlord to ignore it.
assert(frameQualityAdvice({ luma: 120, detail: 22 }) === null, "A perfectly usable frame was nagged about.");
assert(frameQualityAdvice({ luma: 20, detail: 30 })?.kind === "dark", "An unlit room was not called out.");
assert(frameQualityAdvice({ luma: 240, detail: 30 })?.kind === "bright", "A blown-out frame was not called out.");
assert(frameQualityAdvice({ luma: 120, detail: 1.2 })?.kind === "soft", "A blurred or smeared frame was not called out.");
// Darkness outranks softness: a dark frame has low detail *because* it is dark, so
// telling the Landlord to hold still would send them after the wrong problem.
assert(frameQualityAdvice({ luma: 20, detail: 1 })?.kind === "dark", "A dark frame was blamed on camera shake.");
assert(frameQualityAdvice({}) === null && frameQualityAdvice({ luma: NaN, detail: 5 }) === null, "Missing frame statistics invented advice.");
assert(Object.isFrozen(frameQualityAdvice({ luma: 20, detail: 30 })), "Framing advice is mutable.");

/* ── Rooms the Landlord chooses and returns to ──────── */

assert(roomPresets.includes("Kitchen") && roomPresets.includes("Bathroom") && roomPresets.length === 4, "The offered rooms no longer match what the spec asks for.");

// A typed room name is cleaned, bounded and capitalised, never left blank.
assert(normaliseRoomName("  utility  room ") === "Utility room", `A typed room name was not tidied: ${normaliseRoomName("  utility  room ")}`);
assert(normaliseRoomName("") === "" && normaliseRoomName(null) === "", "A blank room name was not handled as simply having none.");

// A room is matched by name case-insensitively, so returning to it edits the
// same room rather than stacking a duplicate.
const oneRoom = [{ name: "Kitchen", detections: [{ label: "Oven" }], tasks: ["Clean the oven"], condition: "heavy" }];
assert(findRoom(oneRoom, "kitchen")?.name === "Kitchen" && !findRoom(oneRoom, "Bathroom"), "A scanned room could not be found again by name.");

const revisited = upsertRoom(oneRoom, { name: "kitchen", detections: [{ label: "Oven" }, { label: "Hob" }], tasks: ["Clean the oven", "Degrease the hob"], condition: "heavy" });
assert(revisited.length === 1 && revisited[0].detections.length === 2, "Editing a room stacked a duplicate instead of replacing it.");
const added = upsertRoom(revisited, { name: "Bathroom", detections: [], tasks: [], condition: "" });
assert(added.length === 2 && added[1].name === "Bathroom", "Adding a new room did not append it.");

// Returning to an existing room is always allowed; the limit only stops a scan
// sprawling into new rooms beyond what one booking can carry.
const full = Array.from({ length: maximumShots }, (_, index) => ({ name: `Room ${index + 1}`, detections: [], tasks: [] }));
assert(!canAddRoom(full, "One more room") && canAddRoom(full, "Room 1"), "The room limit either let a scan sprawl or blocked returning to a room already in it.");

// The hub shows what each room holds without opening it.
const roster = rosterSummary(added);
assert(roster[0].name === "Kitchen" && roster[0].itemCount === 2 && roster[0].conditionLabel === "Heavy", `The room roster is wrong: ${JSON.stringify(roster[0])}`);
assert(roster[1].itemCount === 0 && roster[1].conditionLabel === "Not assessed", "An empty room was summarised as if it had been assessed.");
// The review lists what was actually picked, so a wrong room is visible without
// reopening it — and says when a spoken note is attached.
assert(Array.isArray(roster[0].itemLabels) && roster[0].itemLabels.length === roster[0].itemCount, `The review does not list the objects it counted: ${JSON.stringify(roster[0])}`);
assert(roster[1].itemLabels.length === 0 && roster[1].hasNote === false, "An empty room claimed objects or a note.");
const noted = rosterSummary([{ name: "Bathroom", detections: [{ label: "Sink" }, { label: "" }], tasks: [], transcript: "  limescale on the screen  " }])[0];
assert(noted.itemLabels.length === 1 && noted.itemLabels[0] === "Sink", "An unnamed object padded the review with a placeholder.");
assert(noted.hasNote === true && rosterSummary([{ name: "Hall", detections: [], transcript: "   " }])[0].hasNote === false, "A whitespace-only note was treated as a spoken note.");

console.log("Room scan detection tests passed: viewfinder geometry under object-fit, padded crops inside the frame, clipped live boxes kept where asserted ones are rejected, smallest-box tap selection, free label translation, request budget that never drops the condition frame, replies joined only to selected items, steady bounded live tracking, and chosen rooms that can be found, edited in place and reviewed at a glance.");
