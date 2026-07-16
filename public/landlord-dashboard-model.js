import { cleanerTaskGuidance, cleanerTaskQuality } from "./task-quality.js?v=20260716-1";

export function requestTasksFromLines(value) {
  const lines = String(value || "").split(/\r?\n/).map((line) => line.trim().replace(/^[-*•\d.)\s]+/, "")).filter(Boolean);
  if (!lines.length || lines.length > 200) throw new TypeError("Add between 1 and 200 room-labelled cleaning tasks.");
  const seen = new Set();
  return lines.map((line, index) => {
    const separator = line.indexOf(":");
    if (separator < 1) throw new TypeError(`Task ${index + 1} must start with a room, for example “Kitchen: Wipe the worktops”.`);
    const roomName = line.slice(0, separator).trim();
    const description = line.slice(separator + 1).trim();
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

export function requestStatusLabel(status) {
  const labels = { draft: "Draft — scan not submitted", "searching-for-cleaner": "Searching for Cleaner", "cleaner-invited": "Cleaner invited", "pending-cleaner-acceptance": "Waiting for Cleaner", matched: "Matched", cancelled: "Cancelled" };
  return labels[status] || "Status unavailable";
}
