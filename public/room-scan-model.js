// Pure logic for the guided room scan. Kept free of DOM and network access so
// the sequencing, bounds and result shaping can be tested directly.

// The guided walkthrough follows the order a person actually walks a home in.
// It is a suggestion, not a limit: the scan can end early or add rooms.
export const guidedRooms = Object.freeze(["Living room", "Kitchen", "Bathroom", "Bedroom"]);

export const maximumShots = 12;
export const minimumShots = 1;

// Wording matches what is genuinely happening. Nothing here claims a
// measurement the phone cannot take.

export function nextRoomName(shotCount, rooms = guidedRooms) {
  if (shotCount < rooms.length) return rooms[shotCount];
  // Past the guided list the scan keeps going with numbered extra rooms rather
  // than stopping, because homes are not all four rooms.
  return `Room ${shotCount + 1}`;
}

export function scanHint(shotCount, { voiceUsed = false, rooms = guidedRooms } = {}) {
  if (shotCount === 0) return "Point at the room and tap the shutter";
  if (shotCount >= maximumShots) return "That's the maximum for one scan — tap <b>Done</b>";
  if (shotCount === 2 && !voiceUsed) return "Tip: tap the mic to <b>speak your notes</b>";
  if (shotCount >= rooms.length) return `Captured. Add another room, or tap <b>Done</b>`;
  return `Nice. Now walk through to the <b>${nextRoomName(shotCount, rooms).toLowerCase()}</b>`;
}

export function canFinishScan(shotCount) {
  return shotCount >= minimumShots;
}

export function shotLabel(roomName) {
  return String(roomName || "Room").trim().slice(0, 4).toUpperCase();
}

// A detection is only drawn when the model gave a box that actually fits the
// frame. A malformed box would otherwise be painted across the whole photo and
// read as a confident detection of the entire room.
export function usableDetections(detections) {
  if (!Array.isArray(detections)) return [];
  return detections
    .filter((detection) => {
      const { x, y, width, height } = detection || {};
      if (![x, y, width, height].every((value) => Number.isFinite(value))) return false;
      if (width <= 0 || height <= 0) return false;
      return x >= 0 && y >= 0 && x + width <= 100 && y + height <= 100;
    })
    .filter((detection) => String(detection.label || "").trim())
    .slice(0, 12)
    .map((detection) => Object.freeze({
      x: detection.x,
      y: detection.y,
      width: detection.width,
      height: detection.height,
      label: String(detection.label).trim().slice(0, 28),
      // 60, matching what the reader now sends. At 28 the evidence behind a grade
      // — "white deposits around the tap base" — was clipped mid-phrase, which
      // left the customer a verdict they could not check.
      note: String(detection.note || "").trim().slice(0, 60),
      // Carried through rather than dropped. These were being stripped here, so
      // every per-item condition the reader worked out was discarded one step
      // before anything could use it.
      condition: String(detection.condition || "").trim().slice(0, 12),
      soiling: Object.freeze((Array.isArray(detection.soiling) ? detection.soiling : []).map((kind) => String(kind).trim().slice(0, 16)).slice(0, 4)),
      confidence: Number.isFinite(detection.confidence) ? detection.confidence : 0
    }));
}

/* ── On-device detection geometry ───────────────────────────────────────── */

// The detector reports boxes in the video's own pixels; the viewfinder paints
// that video with `object-fit: cover`, which scales it up and crops the
// overflow. Mapping one to the other by naive percentages would place every box
// slightly wrong, and further wrong the more the aspect ratios differ.
//
// `cover` is assumed to be centred (`object-position: 50% 50%`, the default and
// what styles.css relies on). If that ever changes, this maths changes with it.
export function fitBoxToFrame(box, { videoWidth, videoHeight, frameWidth, frameHeight, fit = "cover" } = {}) {
  const measurements = [videoWidth, videoHeight, frameWidth, frameHeight];
  if (!measurements.every((value) => Number.isFinite(value) && value > 0)) return null;
  const { x, y, width, height } = box || {};
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;

  const scale = fit === "contain"
    ? Math.min(frameWidth / videoWidth, frameHeight / videoHeight)
    : Math.max(frameWidth / videoWidth, frameHeight / videoHeight);
  // Negative under `cover` (the video overflows and is cropped), positive under
  // `contain` (the video is letterboxed).
  const offsetX = (frameWidth - videoWidth * scale) / 2;
  const offsetY = (frameHeight - videoHeight * scale) / 2;

  const left = (x * scale + offsetX) / frameWidth * 100;
  const top = (y * scale + offsetY) / frameHeight * 100;
  const boxWidth = (width * scale) / frameWidth * 100;
  const boxHeight = (height * scale) / frameHeight * 100;

  // A box on a real sofa against a real wall routinely runs off the edge of a
  // cropped frame. Unlike a box the model asserts — where falling outside means
  // it hallucinated — a box derived from geometry that falls outside is simply
  // and truthfully clipped, so it is clamped rather than discarded.
  const clampedLeft = Math.max(0, Math.min(100, left));
  const clampedTop = Math.max(0, Math.min(100, top));
  const clampedRight = Math.max(0, Math.min(100, left + boxWidth));
  const clampedBottom = Math.max(0, Math.min(100, top + boxHeight));
  const visibleWidth = clampedRight - clampedLeft;
  const visibleHeight = clampedBottom - clampedTop;
  // Entirely outside the visible crop: there is nothing to draw.
  if (visibleWidth <= 0 || visibleHeight <= 0) return null;

  return Object.freeze({
    x: clampedLeft,
    y: clampedTop,
    width: visibleWidth,
    height: visibleHeight,
    clipped: left < 0 || top < 0 || left + boxWidth > 100 || top + boxHeight > 100
  });
}

// The inverse, used to cut the crop that is sent for naming. Deriving both from
// the same maths is what guarantees the crop contains what the box surrounded.
//
// The padding matters: detector boxes are tight, and a tight crop of a hob loses
// the surrounding worktop that distinguishes it from a radiator.
export function frameBoxToSourceRect(box, { canvasWidth, canvasHeight, padding = 0.08 } = {}) {
  if (![canvasWidth, canvasHeight].every((value) => Number.isFinite(value) && value > 0)) return null;
  const { x, y, width, height } = box || {};
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;

  const padX = (width * padding) / 100 * canvasWidth;
  const padY = (height * padding) / 100 * canvasHeight;
  const left = Math.max(0, (x / 100) * canvasWidth - padX);
  const top = Math.max(0, (y / 100) * canvasHeight - padY);
  const right = Math.min(canvasWidth, ((x + width) / 100) * canvasWidth + padX);
  const bottom = Math.min(canvasHeight, ((y + height) / 100) * canvasHeight + padY);
  const sourceWidth = Math.round(right - left);
  const sourceHeight = Math.round(bottom - top);
  if (sourceWidth < 1 || sourceHeight < 1) return null;
  return Object.freeze({ sx: Math.round(left), sy: Math.round(top), sWidth: sourceWidth, sHeight: sourceHeight });
}

// `usableDetections` rejects a box that does not fit the frame, because a box
// the model asserted outside the image is evidence it invented one. Boxes
// computed here come from `fitBoxToFrame`, which has already clamped them
// honestly, so this only enforces the shape and the drawing limit.
export function usableLiveBoxes(boxes) {
  if (!Array.isArray(boxes)) return [];
  return boxes
    .filter((box) => {
      const { x, y, width, height } = box || {};
      if (![x, y, width, height].every(Number.isFinite)) return false;
      return width > 0 && height > 0 && x >= 0 && y >= 0 && x + width <= 100.001 && y + height <= 100.001;
    })
    .slice(0, 12)
    .map((box) => Object.freeze({
      id: String(box.id || ""),
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      label: String(box.label || "").trim().slice(0, 28),
      kind: box.kind === "manual" ? "manual" : "detected",
      score: Number.isFinite(box.score) ? box.score : 0,
      // What the reader concluded about this object, kept so the review screen
      // can paint it ON the object. The grade lived only in the side list before,
      // which meant the one screen where the customer is looking straight at the
      // thing itself said nothing about it.
      condition: String(box.condition || "").trim().slice(0, 12),
      soiling: Object.freeze((Array.isArray(box.soiling) ? box.soiling : []).map((kind) => String(kind).trim().slice(0, 16)).slice(0, 4)),
      note: String(box.note || "").trim().slice(0, 60)
    }));
}

// The word painted next to a graded object. The soiling type is the most useful
// thing to say — "Limescale" tells the customer what was seen, where "medium"
// alone is a verdict with no subject. Falls back to the grade only when the
// reader named no soiling, and stays silent for clean or ungraded objects so the
// screen highlights what needs attention rather than captioning everything.
const soilingTagWords = Object.freeze({
  dust: "Dust build-up", grease: "Grease", limescale: "Limescale", stain: "Possible stain",
  mould: "Mould", "soap-scum": "Soap scum", "food-debris": "Food debris",
  "pet-hair": "Pet hair", damage: "Damage", clutter: "Needs tidying"
});
const gradeTagWords = Object.freeze({ heavy: "Heavy build-up", medium: "Needs cleaning", light: "Light clean" });
export function conditionTag(box) {
  const condition = String(box?.condition || "").trim().toLowerCase();
  if (!condition || condition === "clean") return "";
  const soiling = Array.isArray(box?.soiling) ? box.soiling : [];
  const named = soilingTagWords[String(soiling[0] || "").toLowerCase()];
  if (named) return soiling.length > 1 ? `${named} +${soiling.length - 1}` : named;
  return gradeTagWords[condition] || "";
}

// Which box did the Landlord tap? The smallest containing box wins, so a tap on
// a tap inside a sink does not select the whole worktop behind it.
export function boxAtPoint(boxes, x, y) {
  if (!Array.isArray(boxes) || ![x, y].every(Number.isFinite)) return null;
  const hits = boxes.filter((box) => box
    && x >= box.x && x <= box.x + box.width
    && y >= box.y && y <= box.y + box.height);
  if (!hits.length) return null;
  return hits.reduce((smallest, box) => (box.width * box.height < smallest.width * smallest.height ? box : smallest));
}

/* ── Naming what the detector already knows ─────────────────────────────── */

// COCO class names are machine names, and several are American or simply not
// what a person cleaning a home would say. Translating them is a lookup, not a
// judgement, so it happens here for free rather than being billed to a language
// model per item.
export const cocoLabels = Object.freeze({
  couch: "Sofa",
  refrigerator: "Fridge",
  tv: "TV",
  "potted plant": "Houseplant",
  "dining table": "Dining table",
  "wine glass": "Glassware",
  cup: "Cups",
  bowl: "Bowls",
  bottle: "Bottles",
  book: "Books",
  vase: "Vase",
  clock: "Clock",
  sink: "Sink",
  toilet: "Toilet",
  oven: "Oven",
  microwave: "Microwave",
  toaster: "Toaster",
  bed: "Bed",
  chair: "Chair",
  "teddy bear": "Soft toys",
  "hair drier": "Hairdryer",
  toothbrush: "Toothbrush"
});

/* ── How sure the detector has to be ────────────────────────────────────── */

// COCO-SSD's own default is 0.5, and `detect()` was called without a third
// argument so that default applied — then `trackDetections` applied 0.5 again.
// 0.5 is a demonstration threshold. On real furniture it is the confidence at
// which a cream chest of drawers is reported as an oven.
//
// The trade here is not symmetric. A missed item costs a tap, because the
// Landlord can draw a box around anything themselves — that path exists precisely
// because COCO cannot see an air fryer or a shower. A wrongly named item costs
// trust, and if it survives to the confirmation it prices work against something
// that is not in the room. So the threshold is set where a false label is rare
// rather than where the most boxes appear.
//
// Exported so the detector call and the tracker cannot drift apart; they were two
// separate 0.5s before, and raising one would have silently done nothing.
export const detectionMinimumScore = 0.62;

/* ── Spoken room notes ──────────────────────────────────────────────────── */

// Joins what was already noted to what has just been recognised.
//
// Kept separate and pure because the bug it exists to prevent was a joining bug.
// The speech handler used to append each newly-final phrase onto the stored note,
// which is only correct if every event reports each phrase exactly once — and
// Android Chrome re-reports segments that are already final, so a Landlord saying
// "tidy up the cupboards" got back "tidy tidy up tidy up the tidy up the cupboards
// tidy up the cupboards". The handler now recomputes the whole session from
// `event.results` and joins it here, so replaying an event changes nothing.
//
// Deliberately does NOT rewrite the words. Room names, item names, quantities and
// "do not" instructions all have to survive verbatim — the checklist downstream is
// where filler is stripped, and it can only do that honestly if what reaches it is
// what was said.
// A PLAIN JOIN, and deliberately nothing more.
//
// An earlier version tried to be clever here: it detected an overlapping phrase at
// the seam and dropped it, on the theory that a repeat was the browser
// re-recognising the tail of a restarted session. Review showed that theory
// deleting real speech — "wipe the sink" followed by "wipe the sink again" came
// back as just "wipe the sink again", and an intentional repeat vanished entirely.
//
// The judgement: a duplicated phrase is untidy, and a missing one changes what the
// Cleaner is asked to do and what the Landlord is charged for. This codebase has
// already been bitten once by a helper that quietly rewrote a customer's words —
// the clause-boundary bug that turned "do not clean inside the oven" into a
// request for oven cleaning. Preserving what was said, exactly, is the only
// defensible default.
//
// The repeated-text bug this whole change exists to fix is not solved here anyway.
// It is solved by the handler recomputing the session from `event.results` instead
// of appending a delta to it, which makes a replayed event a no-op at source.
export function joinSpokenText(existing, spoken) {
  const before = String(existing || "").replace(/\s+/g, " ").trim();
  const after = String(spoken || "").replace(/\s+/g, " ").trim();
  if (!before) return after;
  if (!after) return before;
  return `${before} ${after}`;
}

/* ── Which detections are plausible in this room ────────────────────────── */

// COCO-SSD has eighty classes and no idea which room it is looking at. On a cream
// chest of drawers with a horizontal seam its nearest class is "oven", and at the
// default 0.5 confidence it says so — which is how a Bedroom came back labelled
// OVEN three times over.
//
// The scanner always knows the room, because the Landlord chose it. Using that is
// the cheapest accuracy win available: an oven in a bedroom is not a low-confidence
// oven, it is not an oven.
//
// FAILS OPEN. A room name that is not recognised, or a label not listed here,
// is always allowed through. Suppressing a real item a Landlord can see on their
// screen is a worse failure than showing one they can simply ignore.
const roomImplausibleLabels = Object.freeze({
  bedroom: ["Oven", "Toilet", "Sink", "Microwave", "Toaster", "Fridge", "Dining table"],
  bathroom: ["Oven", "Microwave", "Toaster", "Fridge", "Bed", "Sofa", "Dining table", "TV"],
  kitchen: ["Bed", "Toilet", "Sofa"],
  "living room": ["Oven", "Toilet", "Bed", "Microwave", "Toaster"],
  lounge: ["Oven", "Toilet", "Bed", "Microwave", "Toaster"],
  hallway: ["Oven", "Toilet", "Bed", "Microwave", "Toaster", "Fridge"],
  landing: ["Oven", "Toilet", "Bed", "Microwave", "Toaster", "Fridge"],
  office: ["Oven", "Toilet", "Bed", "Microwave", "Toaster", "Fridge"],
  study: ["Oven", "Toilet", "Bed", "Microwave", "Toaster", "Fridge"],
  garage: ["Toilet", "Bed", "Sofa"],
  toilet: ["Oven", "Microwave", "Toaster", "Fridge", "Bed", "Sofa", "Dining table"],
  ensuite: ["Oven", "Microwave", "Toaster", "Fridge", "Bed", "Sofa", "Dining table"],
  "en suite": ["Oven", "Microwave", "Toaster", "Fridge", "Bed", "Sofa", "Dining table"]
});

export function implausibleForRoom(label, roomName) {
  const room = String(roomName || "").trim().toLowerCase();
  if (!room) return false;
  let banned = roomImplausibleLabels[room];
  if (!banned) {
    // "Main bedroom", "Bedroom 2" and "Upstairs bathroom" are all normal things to
    // call a room, so a contained match counts rather than only an exact one.
    const matches = Object.entries(roomImplausibleLabels).filter(([name]) => room.includes(name));
    // A name naming two rooms — "Kitchen / living room", "Bedroom with ensuite" —
    // must fail open. Taking the first match would suppress by declaration order:
    // the kitchen entry would remove the sofa from a kitchen-diner, and the bedroom
    // entry would remove the toilet from a room that has one. A room that is two
    // rooms plausibly contains the items of both.
    if (matches.length !== 1) return false;
    banned = matches[0][1];
  }
  const candidate = String(label || "").trim().toLowerCase();
  return banned.some((entry) => entry.toLowerCase() === candidate);
}

export function cocoLabel(className) {
  const key = String(className || "").trim().toLowerCase();
  if (!key) return "Item";
  if (cocoLabels[key]) return cocoLabels[key];
  // An unmapped class is still better shown than hidden — title-cased so it
  // reads as a label rather than as a machine name.
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/* ── The reading request ────────────────────────────────────────────────── */

// The route that receives this has a 900 KB body limit. Going over it produces a
// 413 that the Landlord only ever sees as a generic failure, so the budget is
// enforced here, before the request is made, rather than discovered afterwards.
export const roomReadingLimitBytes = 900 * 1024;

export function roomReadingPayload(request, { limitBytes = roomReadingLimitBytes, safetyMargin = 0.9 } = {}) {
  const budget = Math.max(0, Math.floor(limitBytes * safetyMargin));
  const roomFrame = typeof request?.roomFrame === "string" ? request.roomFrame : "";
  const items = (Array.isArray(request?.items) ? request.items : []).map((item) => ({
    id: String(item?.id || ""),
    kind: item?.kind === "manual" ? "manual" : "detected",
    label: String(item?.label || "").trim().slice(0, 28),
    box: {
      x: Number(item?.box?.x), y: Number(item?.box?.y),
      width: Number(item?.box?.width), height: Number(item?.box?.height)
    },
    score: Number.isFinite(item?.score) ? item.score : 0,
    crop: typeof item?.crop === "string" ? item.crop : ""
  })).filter((item) => item.id);

  const dropped = new Set();
  // Coordinates are deliberately not sent. The device owns the geometry, the
  // reader never returns any, and a box it cannot see is a box it cannot place
  // over the wrong thing.
  const body = () => ({
    roomName: String(request?.roomName || "").slice(0, 60),
    transcript: String(request?.transcript || "").slice(0, 1200),
    // Which read this is. A walking frame only needs its objects named; a
    // confirmation produces the condition and the checklist the job is priced and
    // timed from, so it can be answered by a stronger model. Normalised here and
    // re-checked on the server, which never lets an unrecognised value escalate.
    purpose: request?.purpose === "confirmation" ? "confirmation" : "walking",
    image: roomFrame,
    items: items
      .filter((item) => !dropped.has(item.id))
      .map(({ id, kind, label, crop }) => (crop ? { id, kind, label, crop } : { id, kind, label }))
  });
  // The room name and the transcript are whatever the customer typed or said,
  // so they can hold characters that take more than one byte. Measuring
  // characters would put the request over a limit that is counted in bytes.
  const encoder = new TextEncoder();
  const measure = () => encoder.encode(JSON.stringify(body())).length;

  // The room frame is never dropped: it is what the condition grade is read
  // from, and condition changes what the customer is charged. Bytes come off the
  // hand-picked items instead, least confident first.
  //
  // Such an item is removed from the request outright rather than sent without
  // its crop. No coordinates cross the wire, so an unnamed id with no close-up
  // gives the reader nothing to identify — in a kitchen holding a kettle, a
  // toaster and an air fryer it would not be unsure, it would confidently name
  // the wrong one. Left out of the request, the item keeps its local placeholder
  // and is shown as needing a name, which is true.
  const droppableOrder = items
    .filter((item) => item.crop)
    .sort((a, b) => a.score - b.score);

  let bytes = measure();
  for (const item of droppableOrder) {
    if (bytes <= budget) break;
    dropped.add(item.id);
    bytes = measure();
  }

  return Object.freeze({
    body: body(),
    bytes,
    // False means even the room frame alone exceeds the budget; the caller must
    // re-encode it smaller rather than send a request that will 413.
    withinLimit: bytes <= budget,
    droppedItemIds: Object.freeze([...dropped])
  });
}

// The client owns the geometry; the reader only names and annotates. Joining by
// id and discarding anything unrecognised is what stops a reply inventing an
// item that was never selected and having it drawn as if the Landlord chose it.
export function mergeItemReadings(selected, response) {
  const named = new Map();
  for (const item of Array.isArray(response?.items) ? response.items : []) {
    const id = String(item?.id || "");
    if (id) named.set(id, item);
  }
  return (Array.isArray(selected) ? selected : [])
    .map((item) => {
      const reading = named.get(String(item?.id || "")) || {};
      // A hand-picked box has no label of its own — naming it is the whole
      // reason it was sent. If the reader does not come back with one, the box
      // still stands: the Landlord chose it deliberately, and silently dropping
      // it would lose that choice with nothing said.
      const fallback = item?.kind === "manual" ? "Needs a name" : "";
      const label = String(reading.label || item?.label || fallback).trim().slice(0, 28);
      if (!label) return null;
      return Object.freeze({
        id: String(item?.id || ""),
        x: item.x, y: item.y, width: item.width, height: item.height,
        label,
        // 60, matching what the reader now sends. At 28 the evidence behind a
        // grade was clipped mid-phrase, leaving a verdict nobody could check.
        note: String(reading.note || "").trim().slice(0, 60),
        // The condition this item was actually given. Dropped here before, which
        // meant the chosen-items path — the one a normal confirmation takes, and
        // the one that sets the price — threw away every per-item grade it had
        // just paid a vision model to work out.
        condition: String(reading.condition || "").trim().slice(0, 12),
        soiling: Object.freeze((Array.isArray(reading.soiling) ? reading.soiling : []).slice(0, 4)),
        confidence: Number.isFinite(reading.confidence) ? reading.confidence : 0
      });
    })
    .filter(Boolean)
    .slice(0, 12);
}

/* ── Keeping live boxes steady ──────────────────────────────────────────── */

// Raw per-frame detector output jitters and flickers: boxes appear for a single
// frame, vanish, and shift by several pixels while nothing has moved. Drawn
// directly it reads as broken. Matching detections across frames and holding
// them briefly is what turns it into something worth looking at.
function intersectionOverUnion(a, b) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= left || bottom <= top) return 0;
  const overlap = (right - left) * (bottom - top);
  const union = a.width * a.height + b.width * b.height - overlap;
  return union > 0 ? overlap / union : 0;
}

// A detector can report the same object twice in one frame (usually two nearly
// identical boxes with the same class and slightly different confidence). If
// both become tracks they look like two separate choices and can produce a
// duplicate checklist item. Suppress only very heavy same-class overlaps so
// neighbouring chairs, cushions or monitors remain separate objects.
export function deduplicateDetections(detections, { iouThreshold = 0.68, containmentThreshold = 0.6 } = {}) {
  const source = (Array.isArray(detections) ? detections : [])
    .filter((detection) => detection
      && Number.isFinite(detection.x) && Number.isFinite(detection.y)
      && Number.isFinite(detection.width) && Number.isFinite(detection.height)
      && detection.width > 0 && detection.height > 0)
    .map((detection, index) => ({ detection, index }))
    .sort((a, b) => {
      const scoreDifference = (Number(b.detection.score) || 0) - (Number(a.detection.score) || 0);
      return scoreDifference || a.index - b.index;
    });
  const kept = [];
  for (const { detection } of source) {
    const duplicate = kept.some((existing) => existing.className === detection.className
      && (intersectionOverUnion(existing, detection) >= iouThreshold
        // IoU alone could not merge the boxes that made a single chest of drawers
        // come back as three separate OVENs. They were the same class stacked
        // vertically, so each pair's union was large and its IoU stayed under the
        // threshold — while one box sat almost entirely inside the other.
        //
        // Containment catches that: if most of this box's area is inside a box of
        // the same class that already scored higher, it is another reading of the
        // same object, not a second object. Measured against the smaller box's own
        // area, which is what makes it independent of how different the two sizes
        // are — the exact case IoU handles badly.
        || containmentRatio(existing, detection) >= containmentThreshold));
    if (!duplicate) kept.push(detection);
  }
  return kept;
}

// Overlap as a fraction of the smaller box's area.
export function containmentRatio(first, second) {
  const overlapWidth = Math.max(0, Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x));
  const overlapHeight = Math.max(0, Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y));
  const overlap = overlapWidth * overlapHeight;
  if (overlap <= 0) return 0;
  const smallest = Math.min(first.width * first.height, second.width * second.height);
  return smallest > 0 ? overlap / smallest : 0;
}

export function trackDetections(previousTracks, rawDetections, {
  iouThreshold = 0.35, duplicateIouThreshold = 0.68, holdFrames = 6, smoothing = 0.4, minScore = detectionMinimumScore, nextId = 1
} = {}) {
  const previous = Array.isArray(previousTracks) ? previousTracks : [];
  const raw = deduplicateDetections((Array.isArray(rawDetections) ? rawDetections : [])
    .filter((detection) => detection
      && Number.isFinite(detection.x) && Number.isFinite(detection.y)
      && Number.isFinite(detection.width) && Number.isFinite(detection.height)
      && detection.width > 0 && detection.height > 0
      && (Number.isFinite(detection.score) ? detection.score : 0) >= minScore), { iouThreshold: duplicateIouThreshold });

  // Every candidate pair is scored and then consumed best-first. Matching each
  // track against the first raw box that clears the threshold would make the
  // result depend on array order, which is exactly the kind of thing that makes
  // a test pass once and fail the next time the detector reorders its output.
  const pairs = [];
  for (const [trackIndex, track] of previous.entries()) {
    for (const [rawIndex, detection] of raw.entries()) {
      // Same class only: without this a chair track quietly adopts the sofa
      // beside it and the label follows the wrong object across the frame.
      if (track.className !== detection.className) continue;
      const iou = intersectionOverUnion(track, detection);
      if (iou >= iouThreshold) pairs.push({ trackIndex, rawIndex, iou });
    }
  }
  pairs.sort((a, b) => b.iou - a.iou);

  const takenTracks = new Set();
  const takenRaw = new Set();
  const matches = new Map();
  for (const pair of pairs) {
    if (takenTracks.has(pair.trackIndex) || takenRaw.has(pair.rawIndex)) continue;
    takenTracks.add(pair.trackIndex);
    takenRaw.add(pair.rawIndex);
    matches.set(pair.trackIndex, pair.rawIndex);
  }

  const blend = (from, to) => from + (to - from) * smoothing;
  const tracks = [];
  let identifier = nextId;

  for (const [trackIndex, track] of previous.entries()) {
    if (matches.has(trackIndex)) {
      const detection = raw[matches.get(trackIndex)];
      tracks.push(Object.freeze({
        id: track.id, className: track.className, label: track.label,
        x: blend(track.x, detection.x), y: blend(track.y, detection.y),
        width: blend(track.width, detection.width), height: blend(track.height, detection.height),
        score: detection.score, missedFrames: 0, seenFrames: track.seenFrames + 1
      }));
      continue;
    }
    // Held, not moved: a box that has briefly dropped out should stay where it
    // was last actually seen rather than drift.
    const missedFrames = track.missedFrames + 1;
    if (missedFrames > holdFrames) continue;
    tracks.push(Object.freeze({ ...track, missedFrames }));
  }

  for (const [rawIndex, detection] of raw.entries()) {
    if (takenRaw.has(rawIndex)) continue;
    tracks.push(Object.freeze({
      id: identifier, className: detection.className, label: cocoLabel(detection.className),
      x: detection.x, y: detection.y, width: detection.width, height: detection.height,
      score: detection.score, missedFrames: 0, seenFrames: 1
    }));
    identifier += 1;
  }

  return Object.freeze({ tracks: Object.freeze(tracks), nextId: identifier });
}

// Only tracks that have survived a second frame are drawn. A single-frame
// detection is usually noise, and drawing it is what produces the flicker that
// makes an otherwise good detector look unreliable.
export function drawableTracks(tracks) {
  return (Array.isArray(tracks) ? tracks : []).filter((track) => track && track.seenFrames >= 2);
}

// Inference is throttled to what the phone can actually sustain. A cheap device
// that needs 400ms per frame must not be asked for one every 200ms — it would
// pin the main thread and make the viewfinder itself stutter, which is worse
// than fewer boxes.
// What a frame looks like, judged from cheap statistics the overlay samples off
// the small frame it already draws for the detector. Deliberately conservative:
// a cue that fires on a frame that is merely a bit dim trains the Landlord to
// ignore it, so only clearly unusable frames are called out, one thing at a time,
// worst first. `null` means "say nothing", which is the common case.
//
// `luma` is mean brightness 0-255. `detail` is the mean absolute difference
// between neighbouring samples — high on a crisp room, near zero on a frame that
// is blurred, smeared by motion, or pointed at a blank wall.
export function frameQualityAdvice({ luma, detail } = {}) {
  if (![luma, detail].every((value) => Number.isFinite(value))) return null;
  if (luma < 42) return Object.freeze({ kind: "dark", message: "Too dark to read the room — turn a light on." });
  if (luma > 218) return Object.freeze({ kind: "bright", message: "Too bright to make out detail — try facing away from the window." });
  // Only trusted once the frame is bright enough for low detail to mean blur
  // rather than simply a dark picture.
  if (detail < 4.5) return Object.freeze({ kind: "soft", message: "Hold still, or step back to get the whole room in frame." });
  return null;
}

// Inference runs on a downscaled copy of the frame, so a capable phone finishes in
// tens of milliseconds and can be asked for more passes than the old five a second
// — which is what makes boxes track an object instead of stepping after it.
//
// The interval is start-to-start, so the `duration * 2` term is also a duty-cycle
// ceiling: the detector is never asked to work more than about half the time. That
// matters more than raw frame rate. A phone is held in a warm hand, and a scan that
// pins the GPU wins smoother boxes for a minute and then loses them to thermal
// throttling — as well as spending battery a Landlord walking round a flat needs.
export function nextDetectionDelay(lastDurationMs, { targetFps = 8, minIntervalMs = 90, maxIntervalMs = 700 } = {}) {
  const duration = Number.isFinite(lastDurationMs) && lastDurationMs > 0 ? lastDurationMs : 0;
  const target = 1000 / Math.max(1, targetFps);
  return Math.max(minIntervalMs, Math.min(maxIntervalMs, Math.max(target, duration * 2)));
}

// Time is counted from the tasks that were actually scoped. A photograph cannot
// tell us how long a task takes, so this is shown as a guide range rather than a
// single confident figure — presenting "3h 15m" from a task count would be the
// same invented precision as claiming a floor area.
const minutesPerTask = 12;
const minimumJobMinutes = 60;
const rangeSpread = 0.35;

export function estimatedMinutes(rooms) {
  if (!Array.isArray(rooms) || !rooms.length) return 0;
  const total = rooms.reduce((sum, room) => sum + (Array.isArray(room?.tasks) ? room.tasks.length : 0), 0);
  if (!total) return 0;
  return Math.max(minimumJobMinutes, Math.round((total * minutesPerTask) / 5) * 5);
}

function clockLabel(minutes) {
  const safeMinutes = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(safeMinutes / 60);
  const remainder = safeMinutes % 60;
  if (!hours) return `${remainder}m`;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

export function durationLabel(minutes) {
  const safeMinutes = Math.max(0, Math.round(Number(minutes) || 0));
  if (!safeMinutes) return "Not scoped yet";
  const low = Math.max(minimumJobMinutes, Math.round((safeMinutes * (1 - rangeSpread)) / 15) * 15);
  const high = Math.round((safeMinutes * (1 + rangeSpread)) / 15) * 15;
  if (low >= high) return clockLabel(safeMinutes);
  return `${clockLabel(low)}–${clockLabel(high)}`;
}

// The condition shown is the worst any room reported, because the heaviest room
// is what decides whether a visit runs long.
const conditionOrder = ["light", "medium", "heavy"];

export function overallCondition(rooms) {
  const reported = (Array.isArray(rooms) ? rooms : [])
    .map((room) => String(room?.condition || "").toLowerCase())
    .filter((condition) => conditionOrder.includes(condition));
  if (!reported.length) return "";
  return reported.reduce((worst, condition) => (conditionOrder.indexOf(condition) > conditionOrder.indexOf(worst) ? condition : worst), "light");
}

export function conditionLabel(condition) {
  const value = String(condition || "").toLowerCase();
  if (value === "light") return "Light";
  if (value === "medium") return "Medium";
  if (value === "heavy") return "Heavy";
  return "Not assessed";
}

// The scan produces the same task lines the typed and spoken paths produce, so
// everything downstream — pricing, the Cleaner's checklist — is unchanged.
export function scanChecklistLines(rooms) {
  const lines = [];
  const seen = new Set();
  for (const room of Array.isArray(rooms) ? rooms : []) {
    const roomName = String(room?.name || "").trim();
    for (const task of Array.isArray(room?.tasks) ? room.tasks : []) {
      const text = String(task || "").replace(/\s+/g, " ").trim().slice(0, 300);
      if (text.length < 3) continue;
      const line = roomName ? `${roomName}: ${text}` : text;
      const key = line.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      lines.push(line);
      if (lines.length === 40) return lines;
    }
  }
  return lines;
}

// Spoken notes belong to the room in which they were recorded. Keeping those
// labels in the handoff prevents a Kitchen instruction from becoming an
// unscoped note that a Cleaner could reasonably apply to the Bathroom.
export function scanTranscript(rooms, maximumCharacters = 5000) {
  const lines = [];
  for (const room of Array.isArray(rooms) ? rooms : []) {
    const note = String(room?.transcript || "").replace(/\s+/g, " ").trim();
    if (!note) continue;
    const roomName = normaliseRoomName(room?.name);
    lines.push(roomName ? `${roomName}: ${note}` : note);
  }
  return lines.join("\n").slice(0, Math.max(0, Number(maximumCharacters) || 0)).trim();
}

export function scanSummary(rooms) {
  const scoped = (Array.isArray(rooms) ? rooms : []).filter((room) => Array.isArray(room?.tasks) && room.tasks.length);
  const fixtures = scoped.reduce((sum, room) => sum + (Array.isArray(room.detections) ? room.detections.length : 0), 0);
  const minutes = estimatedMinutes(scoped);
  return Object.freeze({
    roomCount: scoped.length,
    fixtureCount: fixtures,
    condition: overallCondition(scoped),
    minutes,
    durationLabel: durationLabel(minutes),
    conditionLabel: conditionLabel(overallCondition(scoped)),
    tasks: scanChecklistLines(scoped)
  });
}

/* ── Rooms the Landlord chooses, not rooms counted off in order ─────────── */

// The rooms offered up front. "such as the kitchen, bedroom, bathroom, living
// room" — a starting set, not a limit; any other room is typed in.
export const roomPresets = Object.freeze(["Kitchen", "Living room", "Bathroom", "Bedroom"]);

export function normaliseRoomName(raw) {
  const text = String(raw || "").replace(/\s+/g, " ").trim().slice(0, 40);
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function roomKey(name) {
  return normaliseRoomName(name).toLowerCase();
}

// A room is matched by name, case-insensitively, so "kitchen" and "Kitchen" are
// the same room to return to rather than two.
export function findRoom(rooms, name) {
  const key = roomKey(name);
  if (!key) return null;
  return (Array.isArray(rooms) ? rooms : []).find((room) => roomKey(room?.name) === key) || null;
}

// Returning to a room already scanned is always allowed; the limit only stops a
// scan sprawling into a new room beyond what one booking can carry.
export function canAddRoom(rooms, name, { limit = maximumShots } = {}) {
  if (findRoom(rooms, name)) return true;
  return (Array.isArray(rooms) ? rooms.length : 0) < limit;
}

// Replace the room of the same name, or add it. This is what lets a revisit
// overwrite a room's objects in place instead of stacking a duplicate.
export function upsertRoom(rooms, room) {
  const list = Array.isArray(rooms) ? rooms.slice() : [];
  const name = normaliseRoomName(room?.name);
  if (!name) return list;
  const record = { ...room, name };
  const index = list.findIndex((existing) => roomKey(existing?.name) === roomKey(name));
  if (index >= 0) list[index] = record;
  else list.push(record);
  return list;
}

// Remove exactly the chosen room without mutating the roster. A mistaken room
// must leave no image, note, detection or task behind in the final aggregation.
export function removeRoom(rooms, name) {
  const list = Array.isArray(rooms) ? rooms : [];
  const key = roomKey(name);
  if (!key) return list.slice();
  return list.filter((room) => roomKey(room?.name) !== key);
}

// One line per scanned room for the hub: what it is, how much was found, how
// dirty it read. The hub is where the Landlord picks, reviews and returns, so it
// must show all three at a glance without opening anything.
export function rosterSummary(rooms) {
  return (Array.isArray(rooms) ? rooms : []).map((room) => {
    const items = Array.isArray(room?.detections) ? room.detections : [];
    return Object.freeze({
      name: normaliseRoomName(room?.name),
      itemCount: items.length,
      taskCount: Array.isArray(room?.tasks) ? room.tasks.length : 0,
      conditionLabel: conditionLabel(room?.condition),
      // What was actually picked, so the review reads "Sofa, TV, Rug" rather than
      // "3 objects" and a Landlord can spot a wrong room without reopening it.
      // Unnamed items are left out rather than padding the line with placeholders.
      itemLabels: Object.freeze(items.map((item) => String(item?.label || "").trim()).filter(Boolean)),
      hasNote: Boolean(String(room?.transcript || "").trim()),
      // "reading" belongs here too. Coerced to "ready" it was invisible, so the
      // hub could not say a room was still being read and Finish could not tell
      // that anything was outstanding.
      readingStatus: ["ready", "manual", "needs-retry", "reading"].includes(room?.readingStatus) ? room.readingStatus : "ready"
    });
  });
}

/* ── Walking the room: choosing which frames are worth reading ──────────── */

// The scan used to need a shutter press per room, so one frame was read and
// whatever was not in shot was never found. Walking around instead means deciding,
// continuously and on-device, which frames are worth the round trip.
//
// Three things have to be true at once, and each rules out a different waste:
//
//   * the view has genuinely CHANGED since the last frame that was read — else
//     the same wall is read four times and the inventory learns nothing;
//   * the view is currently STILL — a frame grabbed mid-swing is motion-blurred,
//     and a blurred frame is exactly where a recogniser invents things;
//   * a minimum interval has passed and the per-room cap is not spent — the cap
//     is what keeps a walk around a big room from becoming twenty paid reads.
//
// Deliberately not a timer. A Landlord who stands still in a doorway for a minute
// should cost one read, and one who walks a large kitchen should cost several.

export const keyframeDefaults = Object.freeze({
  // Distance, 0-1, between the current view and the last one read. Tuned so
  // turning to a new wall counts and breathing does not.
  sceneChangeThreshold: 0.12,
  // Distance between consecutive frames. Below this the phone is being held
  // still rather than swung.
  stillnessThreshold: 0.045,
  minIntervalMs: 1200,
  // The bound on what one room can cost. Reached only by genuinely covering a
  // room from several angles; most rooms settle in two or three.
  maxPerRoom: 4
});

// One slow read from the room just left must not stop the room now in front of
// the camera from being read. Two concurrent walking reads are enough to cover
// that hand-off without turning a fast walk through several rooms into an
// unbounded burst of provider calls.
export const maxConcurrentWalkingReads = 2;

export function walkingReadIsBlocked(activeRoomKeys, roomKey, { maximum = maxConcurrentWalkingReads } = {}) {
  const key = String(roomKey || "").trim();
  if (!key) return true;
  const active = activeRoomKeys && typeof activeRoomKeys[Symbol.iterator] === "function"
    ? new Set(activeRoomKeys)
    : new Set();
  if (active.has(key)) return true;
  const limit = Number.isInteger(maximum) && maximum > 0 ? maximum : maxConcurrentWalkingReads;
  return active.size >= limit;
}

// A coarse grid of average brightness. Deliberately tiny: this is compared many
// times a second, and the question is "is this a different view of the room", not
// "what is in it". A 4x4 grid survives a hand tremor and changes when the phone
// turns, which is exactly the sensitivity wanted.
export function frameSignature(pixels, width, height, { grid = 4 } = {}) {
  if (!pixels || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const cells = new Array(grid * grid).fill(0);
  const counts = new Array(grid * grid).fill(0);
  for (let y = 0; y < height; y += 1) {
    const row = Math.min(grid - 1, Math.floor((y / height) * grid));
    for (let x = 0; x < width; x += 1) {
      const column = Math.min(grid - 1, Math.floor((x / width) * grid));
      const index = (y * width + x) * 4;
      const cell = row * grid + column;
      cells[cell] += pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
      counts[cell] += 1;
    }
  }
  for (let cell = 0; cell < cells.length; cell += 1) cells[cell] = counts[cell] ? cells[cell] / counts[cell] / 255 : 0;
  return Object.freeze(cells);
}

// Mean absolute difference, 0 (identical) to 1 (opposite).
export function signatureDistance(first, second) {
  if (!Array.isArray(first) || !Array.isArray(second) || first.length !== second.length || !first.length) return 1;
  let total = 0;
  for (let index = 0; index < first.length; index += 1) total += Math.abs(first[index] - second[index]);
  return total / first.length;
}

export function shouldCaptureKeyframe({
  signature, previousSignature, lastReadSignature,
  now = 0, lastCaptureAt = 0, capturedCount = 0, busy = false,
  qualityKind = "", online = true
} = {}, options = {}) {
  const { sceneChangeThreshold, stillnessThreshold, minIntervalMs, maxPerRoom } = { ...keyframeDefaults, ...options };
  if (busy || !Array.isArray(signature)) return false;
  // `navigator.onLine === false` is a strong signal that no request can leave
  // the phone. Do not reserve a frame, signature or paid-read slot while that is
  // true. The same settled view becomes eligible as soon as connectivity returns.
  //
  // A true value is not treated as proof of Internet access; normal request
  // failures remain bounded and non-refundable because the provider may already
  // have received them.
  if (online === false) return false;
  // The guidance pass has already established that this frame cannot support a
  // reliable condition judgement. Sending it anyway used one of the room's four
  // paid reads on the exact dark, blown-out or motion-soft image we had just told
  // the Landlord to correct. It also made hallucinated labels more likely.
  //
  // Do not consume the read or update the last-read signature: once the lighting
  // or framing improves, the same view remains eligible and can be captured well.
  if (String(qualityKind || "").trim()) return false;
  if (capturedCount >= maxPerRoom) return false;
  if (now - lastCaptureAt < minIntervalMs) return false;
  // Nothing read yet: the first steady frame of a room is always worth reading.
  if (!Array.isArray(lastReadSignature)) {
    return Array.isArray(previousSignature) ? signatureDistance(previousSignature, signature) <= stillnessThreshold : true;
  }
  if (signatureDistance(lastReadSignature, signature) < sceneChangeThreshold) return false;
  // A new view, but only once the phone has settled on it.
  if (Array.isArray(previousSignature) && signatureDistance(previousSignature, signature) > stillnessThreshold) return false;
  return true;
}

/* ── The room inventory ─────────────────────────────────────────────────── */

// Items accumulate as the Landlord walks, rather than being replaced by whatever
// the last frame happened to show. Read four times from four angles, a kitchen
// ends up with the union of what was visible, not the contents of the final photo.

// Deduplication happens on the label, because that is what a Landlord sees and
// what the checklist prices. Two frames of the same radiator produce "Radiator"
// twice, and one item is the honest answer. Plurals and articles are folded so
// "the blinds" and "Blind" do not become two rows.
export function inventoryKey(label) {
  return String(label || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(?:the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(?:es|s)$/, "");
}

export const inventoryLimit = 40;

// Merges a fresh reading into what the room already holds. Returns a new array;
// nothing is mutated, so the caller can render from the result directly.

// How much a row earns its place on a phone screen.
//
// Dirt outranks everything: it is the thing being priced. Below that, an item the
// reader was confident about outranks a guess. Anything already clean goes last —
// still listed, because "we looked and it was fine" is worth something, just not
// worth the top of the list.
const conditionWeight = Object.freeze({ heavy: 400, medium: 300, light: 200, "": 100, clean: 0 });
// Generic catch-alls the reader emits for almost any room. Real, cleanable, and
// nearly always less interesting than the specific thing in front of the camera.
const genericLabels = new Set(["wall", "walls", "floor", "floors", "ceiling", "surface", "surfaces", "clothing and textiles", "textiles", "furniture", "general"]);
function usefulness(item) {
  const weight = conditionWeight[String(item?.condition || "")] ?? 100;
  const generic = genericLabels.has(String(item?.label || "").toLowerCase().trim()) ? -60 : 0;
  // A correction is the strongest signal in the list: the customer looked at this
  // one and told us what it is.
  const corrected = item?.confirmed ? 50 : 0;
  const sure = Math.round((Number(item?.score) || 0) * 40);
  return weight + generic + corrected + sure;
}

export function mergeRoomInventory(existing, incoming, { now = 0, limit = inventoryLimit } = {}) {
  const merged = new Map();
  for (const item of Array.isArray(existing) ? existing : []) {
    // The key an item was FIRST filed under, not one recomputed from its current
    // label. Identity has to survive a rename: a Landlord who corrects "Radiator"
    // to "Towel radiator" has told us what that thing is, and if the key moved
    // with the label the next reading would file "Radiator" as a new item and put
    // the row they just fixed straight back on the list.
    const key = item?.key || inventoryKey(item?.label);
    if (key) merged.set(key, { ...item, key });
  }
  for (const item of Array.isArray(incoming) ? incoming : []) {
    const label = String(item?.label || "").trim().slice(0, 40);
    const key = inventoryKey(label);
    if (!key) continue;
    const score = Number.isFinite(item?.score) ? item.score : 0;
    const current = merged.get(key);
    if (!current) {
      merged.set(key, {
        key, label, score, sightings: 1, firstSeenAt: now, lastSeenAt: now, confirmed: false,
        condition: String(item?.condition || ""), note: String(item?.note || ""),
        source: item?.source || "read"
      });
      continue;
    }
    // A Landlord's correction is final. A later reading that disagrees must not
    // quietly rename an item they have already put right.
    merged.set(key, {
      ...current,
      label: current.confirmed ? current.label : (score > current.score ? label : current.label),
      score: Math.max(current.score, score),
      // Seeing the same item from a second angle is the strongest signal available
      // on-device that it is really there, so it is counted rather than discarded.
      sightings: current.sightings + 1,
      lastSeenAt: now,
      // The better-evidenced look at the same object wins its condition too. A
      // glimpse from the doorway should not overwrite a close pass that actually
      // showed the limescale — and a condition the customer set themselves is
      // never overwritten at all.
      condition: current.conditionConfirmed
        ? current.condition
        : (score > current.score ? String(item?.condition || "") : current.condition) || current.condition,
      note: score > current.score && item?.note ? String(item.note) : current.note
    });
  }
  return Object.freeze([...merged.values()]
    // Ordered by USEFULNESS, not by how often it was seen.
    //
    // Sightings-first was a mistake with a very visible symptom. "Wall", "Floor"
    // and "Bed" get named in every single frame, so they accumulated the most
    // sightings and pinned themselves to the top of the list — while the printer,
    // the laptops and the radiator appeared in one or two frames each, scored one
    // sighting, and sank below the fold. A customer pointing their phone at a
    // printer saw a list containing Wall, Floor and Bed, and concluded the
    // scanner could not see. It could; the rows worth reading were at position 9.
    //
    // What a cleaning quote is actually about is what needs cleaning, so that
    // sorts first. "Wall CLEAN" is the least useful row it is possible to show:
    // true, unactionable, and occupying a slot on a phone screen.
    .sort((a, b) => (usefulness(b) - usefulness(a)) || (b.sightings - a.sightings) || a.label.localeCompare(b.label, "en"))
    .slice(0, limit)
    .map((item) => Object.freeze(item)));
}

// Rename, remove and confirm, as one operation so the correction UI has a single
// pure entry point rather than three ways to get the shape wrong.
export function correctInventoryItem(items, key, change = {}) {
  const list = Array.isArray(items) ? items : [];
  if (change.remove) return Object.freeze(list.filter((item) => item.key !== key));
  return Object.freeze(list.map((item) => {
    if (item.key !== key) return item;
    const renamed = typeof change.label === "string" ? change.label.trim().slice(0, 40) : "";
    // A customer standing in the room can see whether their worktop is greasy
    // better than any photograph can. Their answer is final.
    const regraded = ["clean", "light", "medium", "heavy"].includes(change.condition) ? change.condition : "";
    return Object.freeze({
      ...item,
      label: renamed || item.label,
      condition: regraded || item.condition,
      conditionConfirmed: Boolean(regraded) || item.conditionConfirmed === true,
      // Renaming is itself a confirmation: the Landlord has looked at it and said
      // what it is, so a later automatic reading must not overwrite them.
      confirmed: change.confirmed === true || Boolean(renamed) || item.confirmed
    });
  }));
}

/* ── Which condition grade wins ─────────────────────────────────────────── */

// A room is graded by up to five reads: several opportunistic ones taken while
// the customer walked, and one taken on the frame they deliberately framed and
// confirmed. `condition` is what the job is priced from, so which of those wins
// is a pricing decision, not a formatting one.
//
// The walking reads used to be merged worst-wins with the confirmation. That was
// defensible when every read used the same model. It stops being defensible the
// moment the confirmation runs on a stronger tier: a single jumpy "heavy" from a
// passing glance would override the calibrated grade that was paid for — and
// because worst-wins is one-directional, the error only ever runs one way,
// towards over-charging a customer.
//
// So the confirmation is authoritative WHEN IT COMMITTED to a grade. Walking
// reads fill in only when it returned "unknown", where their coverage genuinely
// is the better evidence: a photograph framed from a doorway can fail to show
// what a walk around the room saw.
export function resolveRoomCondition(confirmed, observed) {
  const authoritative = String(confirmed || "").toLowerCase();
  if (authoritative && authoritative !== "unknown") return authoritative;
  const fallback = String(observed || "").toLowerCase();
  return fallback && fallback !== "unknown" ? fallback : "";
}

/* ── Movement guidance ──────────────────────────────────────────────────── */

// "Move slowly around the room" — said only when the phone is actually being
// swept, and silent again the moment it settles.
//
// Sustained fast motion is the one problem the quality pass cannot see: a
// swept frame is often bright enough and, sampled at an instant, can still show
// detail. But every downstream consumer suffers — the on-device tracker loses
// its locks, the keyframe picker refuses to spend a read (correctly), and the
// customer walks a whole room wondering why nothing is being found. Telling
// them to slow down fixes all three at once, which is why it earns a prompt.
//
// Two consecutive fast samples, not one. The sample gap is ~900ms, so a single
// spike is just the customer turning to the next wall — exactly the motion the
// scan is FOR — and nagging on every turn would teach them to ignore the hint.
export function movementAdvice(distances, { fastThreshold = 0.09, streak = 2 } = {}) {
  const recent = (Array.isArray(distances) ? distances : [])
    .filter((value) => Number.isFinite(value));
  if (recent.length < streak) return null;
  const fast = recent.slice(-streak).every((value) => value > fastThreshold);
  if (!fast) return null;
  return Object.freeze({ kind: "moving", message: "Moving fast — slow down a little so items can be read." });
}
