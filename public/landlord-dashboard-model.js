import { cleanerTaskGuidance, cleanerTaskQuality } from "./task-quality.js?v=20260716-1";

const naturalTaskRooms = Object.freeze([
  ["Kitchen", /\bkitchen\b/i],
  ["Bathroom", /\bbathroom\b|\bshower room\b|\ben[ -]?suite\b|\btoilet\b|\bwc\b/i],
  ["Bedroom", /\bbed ?room\b/i],
  ["Living Room", /\bliving room\b|\blounge\b|\bsitting room\b/i],
  ["Hallway", /\bhallway\b|\bcorridor\b|\blanding\b|\bentrance hall\b/i]
]);

function inferredTaskRoom(description, fallbackRoomName = "Other") {
  return naturalTaskRooms.find(([, pattern]) => pattern.test(description))?.[0]
    || String(fallbackRoomName || "Other").trim().slice(0, 120)
    || "Other";
}

export function requestTasksFromLines(value, options = {}) {
  const lines = String(value || "").split(/\r?\n/).map((line) => line.trim().replace(/^[-*•\d.)\s]+/, "")).filter(Boolean);
  if (!lines.length || lines.length > 200) throw new TypeError("Add between 1 and 200 cleaning tasks.");
  const seen = new Set();
  return lines.map((line, index) => {
    const separator = line.indexOf(":");
    const explicitRoom = separator > 0 ? line.slice(0, separator).trim() : "";
    const description = separator > 0 ? line.slice(separator + 1).trim() : line;
    const roomName = explicitRoom || inferredTaskRoom(description, options.defaultRoomName);
    if (!roomName || roomName.length > 120 || !description || description.length > 1000) throw new TypeError(`Task ${index + 1} is incomplete or too long.`);
    if (!cleanerTaskQuality(description).clear) throw new TypeError(`Task ${index + 1} needs a specific Cleaner action. ${cleanerTaskGuidance}`);
    const key = `${roomName.toLowerCase()}\0${description.toLowerCase()}`;
    if (seen.has(key)) throw new TypeError("Room tasks must be unique.");
    seen.add(key);
    return { roomName, description };
  });
}

export function tasksToLines(tasks) {
  return (Array.isArray(tasks) ? tasks : []).filter((task) => task?.roomName && task?.description).map((task) => `${task.roomName}: ${task.description}`).join("\n");
}

export function landlordStartFromSearch(search = "") {
  const values = new URLSearchParams(String(search || "")).getAll("start");
  return values.length === 1 && values[0] === "booking" ? "booking" : "";
}

export function suggestedCleaningType(propertyType) {
  const suggestions = {
    house: "regular-domestic",
    flat: "regular-domestic",
    studio: "regular-domestic",
    office: "workplaces",
    retail: "workplaces",
    clinic: "workplaces",
    communal: "communal-areas"
  };
  return suggestions[String(propertyType || "").trim().toLowerCase()] || "";
}

export function requestedWindow(date, startTime, durationMinutes, now = new Date()) {
  const start = new Date(`${date}T${startTime}`);
  const duration = Number(durationMinutes);
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError("The current time is unavailable.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) || !/^\d{2}:\d{2}$/.test(String(startTime || "")) || Number.isNaN(start.getTime())) throw new TypeError("Choose a valid cleaning date and start time.");
  if (!Number.isInteger(duration) || duration < 30 || duration > 960) throw new TypeError("Estimated duration must be between 30 minutes and 16 hours.");
  if (start <= now) throw new TypeError("Requested cleaning time must be in the future.");
  if (start.getTime() > now.getTime() + 366 * 24 * 60 * 60 * 1000) throw new TypeError("Requested cleaning time must be within the next year.");
  return { requestedStartAt: start.toISOString(), requestedEndAt: new Date(start.getTime() + duration * 60_000).toISOString() };
}

export function moneyToPence(value) {
  const selected = String(value ?? "").trim();
  if (!selected) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(selected)) throw new TypeError("Budget must use pounds and no more than two decimal places.");
  const pence = Math.round(Number(selected) * 100);
  if (!Number.isSafeInteger(pence) || pence < 1 || pence > 10_000_000) throw new TypeError("Budget must be between £0.01 and £100,000.");
  return pence;
}

const pricingServiceTypeByCleaningType = Object.freeze({
  "regular-domestic": "standard",
  "rental-turnovers": "rental-turnover",
  "end-of-tenancy": "end-of-tenancy",
  workplaces: "commercial",
  "communal-areas": "commercial",
  "deep-cleans": "deep"
});

function manualRoomType(roomName) {
  const name = String(roomName || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (/^(kitchen|kitchens)$/.test(name)) return "kitchen";
  if (/^(bathroom|bathrooms|toilet|toilets|wc|shower-room|ensuite|en-suite)$/.test(name)) return "bathroom";
  if (/^(living-room|lounge|sitting-room)$/.test(name)) return "living-room";
  if (/^(bedroom|bedrooms|master-bedroom|guest-bedroom)$/.test(name)) return "bedroom";
  if (/^(office|study|workspace|work-room)$/.test(name)) return "office";
  if (/^(dining-room|dining-area)$/.test(name)) return "dining-room";
  if (/^(hall|hallway|landing|corridor|entrance)$/.test(name)) return "hallway";
  if (/^(utility|utility-room|laundry|laundry-room)$/.test(name)) return "utility-room";
  return "other";
}

function manualTaskPriceCode(description, index) {
  const task = String(description || "").toLowerCase();
  // These are the premium jobs already defined by Homle's public price list.
  // Everything else remains an ordinary task; the server still owns the price.
  if (/\boven\b/.test(task)) return "oven";
  if (/\bfridge\b|\brefrigerator\b/.test(task)) return "fridge";
  if (/\bfreezer\b/.test(task)) return "freezer";
  if (/\bcarpet\b/.test(task)) return "carpet-room";
  if (/\bwindow/.test(task) && /\binside\b|\binterior\b|\binternal\b/.test(task)) return "windows-interior";
  if (/\bsofa\b|\bsettee\b|\bupholster/.test(task)) return "upholstery-item";
  if (/\bmould\b|\bmold\b/.test(task)) return "mould-treatment";
  if (/\blimescale\b/.test(task)) return "limescale";
  if (/\bcupboard/.test(task) && /\binside\b|\binterior\b|\binternal\b/.test(task)) return "cupboards-interior";
  if (/\bbalcony\b|\bpatio\b/.test(task)) return "balcony-patio";
  return `manual-task-${index + 1}`;
}

// Manual requests use the same authoritative pricing boundary as scans. The
// customer supplies only confirmed rooms/tasks; the server applies its active
// price list and freezes the result on the private request.
export function pricingRequestFromManualTasks(tasks, options = {}) {
  if (!Array.isArray(tasks) || !tasks.length) throw new TypeError("Add at least one cleaning task before pricing.");
  const grouped = new Map();
  tasks.forEach((task, index) => {
    const roomName = String(task?.roomName || "").trim();
    const description = String(task?.description || "").trim();
    const key = roomName.toLowerCase();
    if (!grouped.has(key)) grouped.set(key, { roomType: manualRoomType(roomName), label: roomName, items: [] });
    grouped.get(key).items.push({ code: manualTaskPriceCode(description, index), label: description.slice(0, 80) });
  });
  return Object.freeze({
    serviceType: pricingServiceTypeByCleaningType[String(options.cleaningType || "")] || "standard",
    frequency: String(options.frequency || "one-time"),
    rooms: [...grouped.values()],
    addOns: []
  });
}

export function requestStatusLabel(status) {
  const labels = { draft: "Draft — scan not submitted", "searching-for-cleaner": "Searching for Cleaner", "cleaner-invited": "Cleaner invited", "pending-cleaner-acceptance": "Waiting for Cleaner", matched: "Matched", cancelled: "Cancelled" };
  return labels[status] || "Status unavailable";
}

export function landlordDispatchAction(request) {
  if (request?.status !== "searching-for-cleaner") return Object.freeze({ kind: "none", attemptLimit: null });
  const dispatch = request.automaticDispatch && typeof request.automaticDispatch === "object" ? request.automaticDispatch : {};
  const attemptCount = Number.isInteger(dispatch.attemptCount) && dispatch.attemptCount >= 0 ? dispatch.attemptCount : 0;
  const attemptLimit = Number.isInteger(dispatch.attemptLimit) && dispatch.attemptLimit >= 1 && dispatch.attemptLimit <= 5 ? dispatch.attemptLimit : 0;
  if (dispatch.enabled !== true) return Object.freeze({ kind: attemptCount >= 5 ? "exhausted" : "authorize", attemptLimit: Math.min(attemptCount + 1, 5), attemptCount });
  if (attemptCount < attemptLimit) return Object.freeze({ kind: "waiting", attemptLimit, attemptCount });
  if (attemptCount < 5) return Object.freeze({ kind: "retry", attemptLimit: attemptCount + 1, attemptCount });
  return Object.freeze({ kind: "exhausted", attemptLimit: 5, attemptCount });
}

export function landlordMarketplaceCapabilityState(input = {}) {
  const mediaReady = input.mediaReady === true;
  const pricingReady = input.pricingReady === true;
  const geocodingReady = input.geocodingReady === true;
  const matchingReady = pricingReady && geocodingReady;
  // Direct invitations and automatic dispatch are different capabilities.
  // Pricing plus distance evidence can make a direct invitation safe while the
  // background worker is absent. Combining them made the dashboard offer an
  // automatic action that no process would ever perform.
  const automaticDispatchReady = matchingReady && input.automaticDispatchReady === true;
  let notice = null;
  if (!mediaReady) {
    notice = Object.freeze({
      key: "private-media",
      title: "Private room-photo storage is being connected.",
      copy: "You can save the property, speak naturally and review the concise room checklist now. Camera upload and matching submission stay locked until Homle can store every photo privately."
    });
  } else if (!pricingReady) {
    notice = Object.freeze({
      key: "private-pricing",
      title: "Private pricing and Cleaner matching are being connected.",
      copy: "You can complete and submit the private room scan now. Homle will keep it safely saved and will not invite a Cleaner or create a booking until the approved pricing checks are ready."
    });
  } else if (!geocodingReady) {
    notice = Object.freeze({
      key: "postcode-geocoding",
      title: "Postcode distance matching is being connected.",
      copy: "You can complete and submit the private room scan now. Homle will keep it safely saved and will not invite a Cleaner until property and service-area postcodes can be checked by real distance."
    });
  } else if (!automaticDispatchReady) {
    notice = Object.freeze({
      key: "automatic-dispatch",
      title: "Automatic Cleaner matching is temporarily paused.",
      copy: "You can still submit the reviewed room scan. It will stay safely open for Homle review, and no Cleaner will be contacted automatically while the background matching service is unavailable."
    });
  }
  return Object.freeze({ mediaReady, pricingReady, geocodingReady, matchingReady, automaticDispatchReady, notice });
}
