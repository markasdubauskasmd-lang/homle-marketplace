const views = new Set(["attention", "active", "finished"]);
const statuses = new Set(["searching-for-cleaner", "cleaner-invited", "pending-cleaner-acceptance", "matched", "confirmed", "cleaner-en-route", "cleaner-arrived", "cleaning-in-progress", "awaiting-review", "completed", "cancelled", "disputed"]);

export function adminBookingView(value) {
  const selected = String(value || "").trim().toLowerCase();
  if (!selected) return null;
  if (!views.has(selected)) throw new TypeError("Choose a valid booking operations view.");
  return selected;
}

export function shortOperationReference(record) {
  const id = record?.bookingId || record?.requestId || "";
  return `${record?.bookingId ? "BKG" : "REQ"}-${id.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

export function operationStatusLabel(value) {
  if (!statuses.has(value)) return "Unavailable";
  return value.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}

export function plannedMarginPercent(record) {
  if (!Number.isInteger(record?.customerPricePence) || !Number.isInteger(record?.plannedContributionPence) || record.customerPricePence <= 0) return null;
  return Math.round(record.plannedContributionPence * 1000 / record.customerPricePence) / 10;
}

export function adminBookingQueue(value) {
  if (!value || !Array.isArray(value.operations) || !Number.isInteger(value.limit) || !Number.isInteger(value.offset)) throw new Error("The booking operations queue is unavailable.");
  return { operations: value.operations, limit: value.limit, offset: value.offset };
}
