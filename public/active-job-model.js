const bookingIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const messagingStatuses = new Set(["pending-cleaner-acceptance", "confirmed", "cleaner-en-route", "cleaner-arrived", "cleaning-in-progress", "awaiting-review", "completed", "disputed"]);

export const activeJobStages = Object.freeze([
  "confirmed",
  "cleaner-en-route",
  "cleaner-arrived",
  "cleaning-in-progress",
  "awaiting-review",
  "completed"
]);

export const activeJobStatusLabels = Object.freeze({
  confirmed: "Booking confirmed",
  "cleaner-en-route": "Cleaner en route",
  "cleaner-arrived": "Cleaner arrived",
  "cleaning-in-progress": "Cleaning in progress",
  "awaiting-review": "Cleaning finished",
  completed: "Booking completed",
  cancelled: "Booking cancelled",
  disputed: "Booking disputed"
});

export function activeBookingId(pathname, search = "") {
  const pathMatch = String(pathname || "").match(/^\/bookings\/([0-9a-f-]{36})(?:\/(?:tracking|cleaning-progress))?\/?$/i);
  const supplied = pathMatch?.[1] || new URLSearchParams(String(search || "")).get("bookingId") || "";
  return bookingIdPattern.test(supplied) ? supplied.toLowerCase() : "";
}

export function activeJobRole(account) {
  const roles = Array.isArray(account?.roles) ? account.roles : [];
  if ((account?.selectedRole === "cleaner" || account?.selectedRole === "landlord") && roles.includes(account.selectedRole)) return account.selectedRole;
  if (roles.includes("cleaner") && !roles.includes("landlord")) return "cleaner";
  if (roles.includes("landlord") && !roles.includes("cleaner")) return "landlord";
  return "";
}

export function activeJobStage(status) {
  const index = activeJobStages.indexOf(status);
  if (index >= 0) return index;
  return status === "cancelled" || status === "disputed" ? activeJobStages.length : 0;
}

export function activeJobAction(role, tracking = {}, progress = {}) {
  if (role !== "cleaner") return Object.freeze({ kind: "none", label: "Live booking updates", enabled: false });
  const candidates = [tracking.status, progress.status].filter(Boolean);
  const status = candidates.sort((left, right) => activeJobStage(right) - activeJobStage(left))[0] || "";
  if (status === "confirmed") return Object.freeze({ kind: "start-journey", label: "Start journey", enabled: true });
  if (status === "cleaner-en-route") {
    if (tracking.sharingState !== "live") return Object.freeze({ kind: "resume-location", label: "Resume location sharing", enabled: true });
    return Object.freeze({ kind: "arrive", label: "I have arrived", enabled: true });
  }
  if (status === "cleaner-arrived") return Object.freeze({ kind: "start-cleaning", label: "Start cleaning", enabled: true });
  if (status === "cleaning-in-progress") {
    const resolved = Number(progress.resolvedTasks) || 0;
    const total = Number(progress.totalTasks) || 0;
    const ready = total > 0 && resolved === total;
    return Object.freeze({ kind: "finish-cleaning", label: ready ? "Finish cleaning" : `Resolve ${Math.max(0, total - resolved)} task${total - resolved === 1 ? "" : "s"} first`, enabled: ready });
  }
  return Object.freeze({ kind: "none", label: status === "awaiting-review" || status === "completed" ? "Cleaning complete" : "No action available", enabled: false });
}

export function taskCanBeDecided(role, task) {
  return role === "landlord" && task?.unexpected === true && task?.landlordApprovalStatus === "pending";
}

export function taskCanBeUpdated(role, status) {
  return role === "cleaner" && status === "cleaning-in-progress";
}

export function activeJobMessagingOpen(status) {
  return messagingStatuses.has(status);
}

export function mergeBookingMessages(current, incoming, maximum = 500) {
  const records = new Map();
  for (const value of [...(Array.isArray(current) ? current : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    if (!bookingIdPattern.test(value?.messageId || "") || !["cleaner", "landlord"].includes(value?.senderRole) || typeof value?.body !== "string" || value.body.length < 1 || value.body.length > 2000 || !Number.isFinite(Date.parse(value?.createdAt || ""))) continue;
    records.set(value.messageId.toLowerCase(), Object.freeze({ messageId: value.messageId.toLowerCase(), senderRole: value.senderRole, body: value.body, createdAt: new Date(value.createdAt).toISOString() }));
  }
  const ordered = [...records.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.messageId.localeCompare(right.messageId));
  return Object.freeze(ordered.slice(-Math.max(1, Math.min(1000, Number(maximum) || 500))));
}

export function createClientMessageId(cryptography = globalThis.crypto) {
  if (typeof cryptography?.randomUUID === "function") return cryptography.randomUUID();
  if (typeof cryptography?.getRandomValues !== "function") throw new Error("Secure message retry protection is unavailable in this browser.");
  const bytes = cryptography.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

export function progressSummary(progress = {}) {
  const total = Math.max(0, Number(progress.totalTasks) || 0);
  const completed = Math.min(total, Math.max(0, Number(progress.completedTasks) || 0));
  const resolved = Math.min(total, Math.max(0, Number(progress.resolvedTasks) || 0));
  const suppliedPercent = Number(progress.overallPercentage);
  const percentage = Number.isFinite(suppliedPercent) ? Math.min(100, Math.max(0, Math.round(suppliedPercent))) : total ? Math.round((resolved / total) * 100) : 0;
  return Object.freeze({ total, completed, resolved, percentage, unresolved: Math.max(0, total - resolved) });
}

export function safeDateTime(value, options = {}) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: options.date === false ? undefined : "medium", timeStyle: "short" }).format(date);
}

export function elapsedLabel(seconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
