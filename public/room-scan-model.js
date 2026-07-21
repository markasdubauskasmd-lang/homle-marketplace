// Pure logic for the guided room scan. Kept free of DOM and network access so
// the sequencing, bounds and result shaping can be tested directly.

// The guided walkthrough follows the order a person actually walks a home in.
// It is a suggestion, not a limit: the scan can end early or add rooms.
export const guidedRooms = Object.freeze(["Living room", "Kitchen", "Bathroom", "Bedroom"]);

export const maximumShots = 12;
export const minimumShots = 1;

// Wording matches what is genuinely happening. Nothing here claims a
// measurement the phone cannot take.
export const processingSteps = Object.freeze([
  "Preparing your photos",
  "Reading each room",
  "Identifying fixtures",
  "Judging condition",
  "Adding your spoken notes",
  "Scoping the work"
]);

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
      note: String(detection.note || "").trim().slice(0, 28)
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
      score: Number.isFinite(box.score) ? box.score : 0
    }));
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

  const dropped = [];
  const body = () => ({
    roomName: String(request?.roomName || "").slice(0, 60),
    transcript: String(request?.transcript || "").slice(0, 1200),
    image: roomFrame,
    items: items.map(({ id, kind, label, box, crop }) => (crop ? { id, kind, label, box, crop } : { id, kind, label, box }))
  });
  // Base64 and JSON are ASCII, so string length is byte length here.
  const measure = () => JSON.stringify(body()).length;

  // The room frame is never dropped: it is what the condition grade is read
  // from, and condition changes what the customer is charged. Bytes come off the
  // crops instead — a detected item is already visible in the room frame, and a
  // manual box is the one case the model genuinely cannot infer without help, so
  // detected crops go first and the least confident go before the rest.
  const droppableOrder = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.crop)
    .sort((a, b) => (a.item.kind === b.item.kind ? a.item.score - b.item.score : a.item.kind === "detected" ? -1 : 1));

  let bytes = measure();
  for (const { item } of droppableOrder) {
    if (bytes <= budget) break;
    item.crop = "";
    dropped.push(item.id);
    bytes = measure();
  }

  return Object.freeze({
    body: body(),
    bytes,
    // False means even the room frame alone exceeds the budget; the caller must
    // re-encode it smaller rather than send a request that will 413.
    withinLimit: bytes <= budget,
    droppedCropIds: Object.freeze(dropped)
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
      const label = String(reading.label || item?.label || "").trim().slice(0, 28);
      if (!label) return null;
      return Object.freeze({
        id: String(item?.id || ""),
        x: item.x, y: item.y, width: item.width, height: item.height,
        label,
        note: String(reading.note || "").trim().slice(0, 28)
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

export function trackDetections(previousTracks, rawDetections, {
  iouThreshold = 0.35, holdFrames = 6, smoothing = 0.4, minScore = 0.5, nextId = 1
} = {}) {
  const previous = Array.isArray(previousTracks) ? previousTracks : [];
  const raw = (Array.isArray(rawDetections) ? rawDetections : [])
    .filter((detection) => detection
      && Number.isFinite(detection.x) && Number.isFinite(detection.y)
      && Number.isFinite(detection.width) && Number.isFinite(detection.height)
      && detection.width > 0 && detection.height > 0
      && (Number.isFinite(detection.score) ? detection.score : 0) >= minScore);

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
export function nextDetectionDelay(lastDurationMs, { targetFps = 5, minIntervalMs = 120, maxIntervalMs = 700 } = {}) {
  const duration = Number.isFinite(lastDurationMs) && lastDurationMs > 0 ? lastDurationMs : 0;
  const target = 1000 / Math.max(1, targetFps);
  return Math.max(minIntervalMs, Math.min(maxIntervalMs, Math.max(target, duration * 1.5)));
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
