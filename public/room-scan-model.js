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
    .slice(0, 8)
    .map((detection) => Object.freeze({
      x: detection.x,
      y: detection.y,
      width: detection.width,
      height: detection.height,
      label: String(detection.label).trim().slice(0, 28),
      note: String(detection.note || "").trim().slice(0, 28)
    }));
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
