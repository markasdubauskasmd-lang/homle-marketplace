const activeStatuses = new Set(["cleaner-en-route", "cleaner-arrived", "cleaning-in-progress"]);
const upcomingStatuses = new Set(["confirmed"]);
const historyStatuses = new Set(["awaiting-review", "completed", "cancelled", "disputed"]);

export const bookingSummaryStatusLabels = Object.freeze({
  "pending-cleaner-acceptance": "Awaiting Cleaner response",
  confirmed: "Confirmed",
  "cleaner-en-route": "Cleaner en route",
  "cleaner-arrived": "Cleaner arrived",
  "cleaning-in-progress": "Cleaning in progress",
  "awaiting-review": "Awaiting review",
  completed: "Completed",
  cancelled: "Cancelled",
  disputed: "Under review"
});

export function bookingSummaryBuckets(bookings, role) {
  const records = Array.isArray(bookings) ? bookings.filter((booking) => booking?.participantRole === role) : [];
  return Object.freeze({
    pending: Object.freeze(records.filter((booking) => role === "cleaner" && booking.status === "pending-cleaner-acceptance" && booking.canRespond === true)),
    active: Object.freeze(records.filter((booking) => activeStatuses.has(booking.status))),
    upcoming: Object.freeze(records.filter((booking) => upcomingStatuses.has(booking.status) || role === "landlord" && booking.status === "pending-cleaner-acceptance")),
    history: Object.freeze(records.filter((booking) => historyStatuses.has(booking.status) || role === "cleaner" && booking.status === "pending-cleaner-acceptance" && !booking.canRespond))
  });
}

export function formatBookingMoney(pence) {
  if (!Number.isInteger(pence) || pence < 1 || pence > 10_000_000) return "Price unavailable";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(pence / 100);
}

export function formatBookingWindow(startValue, endValue) {
  const start = new Date(startValue || "");
  const end = new Date(endValue || "");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return "Schedule unavailable";
  const date = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Europe/London" }).format(start);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
  return `${date}, ${time.format(start)}–${time.format(end)}`;
}

export function bookingSummaryPrimaryAction(booking, role) {
  if (role === "cleaner" && booking?.canRespond === true && booking.status === "pending-cleaner-acceptance") return Object.freeze({ kind: "respond", label: "Review request" });
  if (booking?.activeJobAvailable === true) return Object.freeze({ kind: "active-job", label: ["awaiting-review", "completed"].includes(booking.status) ? "View job record" : "Open active job" });
  if (role === "landlord" && booking?.paymentStepAvailable === true) return Object.freeze({ kind: "payment", label: "Authorize booking total" });
  return Object.freeze({ kind: "none", label: "No action required" });
}

export function bookingSummaryPriceLabel(role) {
  return role === "cleaner" ? "Your agreed pay" : "Your booking total";
}
