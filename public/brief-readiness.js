const labels = {
  connectedRequest: "Request reference and email are complete",
  roomPhotos: "One to six room photos are added",
  photoDetails: "Every photo has a room label and specific note",
  instructions: "Spoken or typed instructions are present",
  conciseTasks: "At least one concise cleaner task is ready",
  roomCoverage: "Every photographed room has a room-labelled task",
  scopeConfirmed: "Final concise checklist confirmed complete",
  privacyConsent: "Property-photo sharing permission confirmed"
};

export const briefRoomOptions = ["Kitchen", "Bathroom", "Bedroom", "Living room", "Hallway", "Stairs", "Office", "Communal area", "Other area"];
const roomOptionSet = new Set(briefRoomOptions);

function hasEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

export function briefReadiness({ requestId = "", email = "", transcript = "", tasks = [], photos = [], scopeCompleteConfirmed = false, consent = false } = {}) {
  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const safePhotos = Array.isArray(photos) ? photos : [];
  const photographedAreas = [...new Set(safePhotos.map((photo) => String(photo?.area || "").trim()).filter((area) => roomOptionSet.has(area)))];
  const uncoveredAreas = photographedAreas.filter((area) => !safeTasks.some((task) => String(task).toLowerCase().startsWith(`${area.toLowerCase()}:`)));
  const checks = {
    connectedRequest: /^REQ-[A-Z0-9]{8}$/i.test(String(requestId || "").trim()) && hasEmail(email),
    roomPhotos: safePhotos.length > 0 && safePhotos.length <= 6,
    photoDetails: safePhotos.length > 0 && safePhotos.every((photo) => roomOptionSet.has(String(photo?.area || "").trim()) && String(photo?.note || "").trim().length >= 3),
    instructions: String(transcript || "").trim().length > 0,
    conciseTasks: safeTasks.length > 0,
    roomCoverage: safePhotos.length > 0 && photographedAreas.length > 0 && uncoveredAreas.length === 0,
    scopeConfirmed: scopeCompleteConfirmed === true,
    privacyConsent: consent === true
  };
  const items = Object.entries(checks).map(([key, complete]) => ({ key, label: labels[key], complete }));
  return { ready: items.every((item) => item.complete), remaining: items.filter((item) => !item.complete).length, checks, items, uncoveredAreas };
}
