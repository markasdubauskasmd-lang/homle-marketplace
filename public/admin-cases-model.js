const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedStatuses = Object.freeze(["open", "reviewing", "resolved", "closed"]);
const allowedCategories = Object.freeze(["quality", "damage", "access", "safety", "conduct", "payment", "other"]);
const controlCharacters = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} is unavailable.`);
  return value;
}

function uuid(value, label) {
  if (!uuidPattern.test(String(value || ""))) throw new TypeError(`${label} is unavailable.`);
  return String(value).toLowerCase();
}

function boundedText(value, minimum, maximum, label, optional = false) {
  const selected = typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : "";
  if (optional && !selected) return null;
  if (selected.length < minimum || selected.length > maximum || controlCharacters.test(selected)) throw new TypeError(`${label} is unavailable.`);
  return selected;
}

function timestamp(value, label, optional = false) {
  if (optional && value == null) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new TypeError(`${label} is unavailable.`);
  return new Date(value).toISOString();
}

function pageInteger(value, minimum, maximum, label) {
  const selected = Number(value);
  if (!Number.isInteger(selected) || selected < minimum || selected > maximum) throw new TypeError(`${label} is unavailable.`);
  return selected;
}

function projectCase(value) {
  const record = object(value, "Booking case");
  if (!allowedCategories.includes(record.category) || !allowedStatuses.includes(record.status)) throw new TypeError("Booking case classification is unavailable.");
  if (!["landlord", "cleaner"].includes(record.openedByRole)) throw new TypeError("Booking case participant role is unavailable.");
  const outcome = record.resolutionOutcome == null ? null : String(record.resolutionOutcome);
  if (outcome !== null && !["completed", "cancelled"].includes(outcome)) throw new TypeError("Booking case outcome is unavailable.");
  return Object.freeze({
    disputeId: uuid(record.disputeId, "Booking case reference"),
    bookingId: uuid(record.bookingId, "Booking reference"),
    category: record.category,
    description: boundedText(record.description, 20, 5000, "Booking case description"),
    status: record.status,
    openedByRole: record.openedByRole,
    resolutionNote: boundedText(record.resolutionNote, 20, 5000, "Booking case resolution", true),
    resolutionOutcome: outcome,
    createdAt: timestamp(record.createdAt, "Booking case creation time"),
    resolvedAt: timestamp(record.resolvedAt, "Booking case resolution time", true)
  });
}

export function adminCaseQueue(value) {
  const result = object(value, "Booking case queue");
  if (!Array.isArray(result.disputes)) throw new TypeError("Booking case queue is unavailable.");
  return Object.freeze({
    disputes: Object.freeze(result.disputes.map(projectCase)),
    limit: pageInteger(result.limit, 1, 100, "Booking case page size"),
    offset: pageInteger(result.offset, 0, 10000, "Booking case page offset")
  });
}

export function adminCaseFilter(value) {
  const selected = String(value || "").trim().toLowerCase();
  if (!selected) return "";
  if (!allowedStatuses.includes(selected)) throw new TypeError("Choose a valid case status.");
  return selected;
}

export function adminCaseReviewPayload() {
  return Object.freeze({ status: "reviewing" });
}

export function adminCaseResolutionPayload(value) {
  const input = object(value, "Booking case resolution");
  const resolutionOutcome = String(input.resolutionOutcome || "").trim().toLowerCase();
  if (!["completed", "cancelled"].includes(resolutionOutcome)) throw new TypeError("Choose the final booking outcome.");
  if (input.confirmed !== true) throw new TypeError("Confirm that you understand what this decision changes.");
  return Object.freeze({
    status: "resolved",
    resolutionOutcome,
    resolutionNote: boundedText(input.resolutionNote, 20, 5000, "Resolution note")
  });
}

export function shortBookingReference(value) {
  return `BKG-${uuid(value, "Booking reference").slice(0, 8).toUpperCase()}`;
}

export function caseStatusLabel(value) {
  return Object.freeze({ open: "Open", reviewing: "Under review", resolved: "Resolved", closed: "Closed" })[value] || "Status unavailable";
}

export function caseCategoryLabel(value) {
  return Object.freeze({ quality: "Quality", damage: "Damage", access: "Access", safety: "Safety", conduct: "Conduct", payment: "Payment record", other: "Other" })[value] || "Case";
}
