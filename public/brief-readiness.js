import { cleanerHandoffPreview } from "./cleaner-handoff-preview.js";
import { cleanerTaskGuidance, unclearCleanerTasks } from "./task-quality.js?v=20260716-1";

const labels = {
  connectedRequest: "Request reference and email are complete",
  roomPhotos: "One to ten room photos or short videos are added",
  photoDetails: "Every visual has a room label",
  instructions: "Spoken or typed instructions are present",
  conciseTasks: "Concise cleaner tasks reflect the latest notes",
  roomCoverage: "Every shown room has a room-labelled cleaning task",
  scopeConfirmed: "Final concise checklist confirmed complete",
  privacyConsent: "Property-media sharing permission confirmed"
};

export const maxBriefPhotos = 10;
export const maxBriefVideos = 2;
export const briefRoomOptions = [
  "Kitchen",
  "Bathroom", "Bathroom 1", "Bathroom 2", "Bathroom 3",
  "Bedroom", "Bedroom 1", "Bedroom 2", "Bedroom 3", "Bedroom 4", "Bedroom 5",
  "Living room", "Dining room", "Hallway", "Stairs", "Office", "Utility room",
  "Toilet", "Shower room", "Entrance", "Conservatory", "Balcony", "Communal area", "Other area"
];
const roomOptionSet = new Set(briefRoomOptions);

export function normaliseBriefRoom(value) {
  const room = String(value || "").trim();
  return roomOptionSet.has(room) ? room : "";
}

export function roomSpeechMarker(value) {
  const room = normaliseBriefRoom(value);
  return room ? `In the ${room}.` : "";
}

function hasEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function normaliseFingerprintText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function briefScopeFingerprint({ transcript = "", tasks = [], photos = [] } = {}) {
  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const safePhotos = Array.isArray(photos) ? photos : [];
  return JSON.stringify({
    transcript: normaliseFingerprintText(transcript),
    tasks: safeTasks.map(normaliseFingerprintText),
    photos: safePhotos.map((photo) => ({ area: normaliseFingerprintText(photo?.area), note: normaliseFingerprintText(photo?.note) }))
  });
}

export function briefSourceFingerprint({ transcript = "", photos = [] } = {}) {
  const safePhotos = Array.isArray(photos) ? photos : [];
  return JSON.stringify({
    transcript: normaliseFingerprintText(transcript),
    photos: safePhotos.map((photo) => ({ area: normaliseFingerprintText(photo?.area), note: normaliseFingerprintText(photo?.note) }))
  });
}

export function briefScopeConfirmationIsCurrent({ checked = false, confirmedFingerprint = "", currentFingerprint = "" } = {}) {
  return checked === true && confirmedFingerprint.length > 0 && confirmedFingerprint === currentFingerprint;
}

export function briefReadiness({ requestId = "", email = "", requestAuthorised = false, transcript = "", tasks = [], photos = [], checklistCurrent = false, scopeCompleteConfirmed = false, consent = false } = {}) {
  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const safePhotos = Array.isArray(photos) ? photos : [];
  const photographedAreas = [...new Set(safePhotos.map((photo) => normaliseBriefRoom(photo?.area)).filter(Boolean))];
  const handoff = cleanerHandoffPreview({ tasks: safeTasks, photographedAreas, roomOptions: briefRoomOptions });
  const unclearTasks = unclearCleanerTasks(safeTasks);
  const uncoveredAreas = handoff.missingWorkAreas;
  const checks = {
    connectedRequest: /^REQ-[A-Z0-9]{8}$/i.test(String(requestId || "").trim()) && (requestAuthorised === true || hasEmail(email)),
    roomPhotos: safePhotos.length > 0 && safePhotos.length <= maxBriefPhotos,
    photoDetails: safePhotos.length > 0 && safePhotos.every((photo) => Boolean(normaliseBriefRoom(photo?.area))),
    instructions: String(transcript || "").trim().length > 0,
    conciseTasks: handoff.workCount > 0 && unclearTasks.length === 0 && checklistCurrent === true,
    roomCoverage: safePhotos.length > 0 && photographedAreas.length > 0 && uncoveredAreas.length === 0,
    scopeConfirmed: scopeCompleteConfirmed === true,
    privacyConsent: consent === true
  };
  const itemLabels = { ...labels };
  if (requestAuthorised === true) itemLabels.connectedRequest = "Private request tracker securely connected";
  if (unclearTasks.length) {
    itemLabels.conciseTasks = `${unclearTasks.length} checklist ${unclearTasks.length === 1 ? "item needs" : "items need"} a clearer action. ${cleanerTaskGuidance}`;
  } else if (safeTasks.length > 0 && checklistCurrent !== true) {
    itemLabels.conciseTasks = "Summarise again after the latest speech or photo-note changes";
  } else if (safeTasks.length > 0 && handoff.workCount === 0) {
    itemLabels.conciseTasks = "Add at least one cleaning task; exclusions alone are not a cleanable scope";
  }
  if (uncoveredAreas.length) {
    itemLabels.roomCoverage = `Add cleaning ${uncoveredAreas.length === 1 ? "task" : "tasks"} for: ${uncoveredAreas.join(", ")}`;
  }
  const items = Object.entries(checks).map(([key, complete]) => ({ key, label: itemLabels[key], complete }));
  return { ready: items.every((item) => item.complete), remaining: items.filter((item) => !item.complete).length, checks, items, uncoveredAreas, unclearTasks };
}
