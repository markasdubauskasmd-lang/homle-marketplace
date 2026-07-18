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
    upcoming: Object.freeze(records.filter((booking) => upcomingStatuses.has(booking.status))),
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

export function formatBookingMoment(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }).format(date);
}

export function bookingSummaryPrimaryAction(booking, role) {
  if (role === "cleaner" && booking?.canRespond === true && booking.status === "pending-cleaner-acceptance") return Object.freeze({ kind: "respond", label: "Review request" });
  if (booking?.activeJobAvailable === true) return Object.freeze({ kind: "active-job", label: ["awaiting-review", "completed"].includes(booking.status) ? "View job record" : "Open active job" });
  if (role === "landlord" && booking?.paymentStepAvailable === true) return Object.freeze({ kind: "payment", label: "Authorize booking total" });
  return Object.freeze({ kind: "none", label: "No action required" });
}

const cleanerAcceptedStatuses = new Set(["confirmed", "cleaner-en-route", "cleaner-arrived", "cleaning-in-progress", "awaiting-review", "completed", "disputed"]);

function safeCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function safeMoney(value) {
  return Number.isInteger(value) && value > 0 ? value : 0;
}

export function cleanerDashboardSummary(profile, availability, bookings, payout) {
  if (!Array.isArray(availability) || !Array.isArray(bookings)) throw new TypeError("Cleaner dashboard records are unavailable.");
  const completedBookings = bookings.filter((booking) => booking?.participantRole === "cleaner" && booking.status === "completed");
  const committedBookings = bookings.filter((booking) => booking?.participantRole === "cleaner" && cleanerAcceptedStatuses.has(booking.status) && booking.status !== "completed" && booking.status !== "disputed");
  const reviewCount = safeCount(profile?.reviewCount);
  const averageRating = reviewCount > 0 && Number.isFinite(profile?.averageRating) && profile.averageRating >= 0 && profile.averageRating <= 5 ? profile.averageRating : 0;
  return Object.freeze({
    profileCompletionPercent: Number.isInteger(profile?.profileCompletionPercent) && profile.profileCompletionPercent >= 0 && profile.profileCompletionPercent <= 100 ? profile.profileCompletionPercent : 0,
    profilePublished: profile?.isPublic === true,
    availableWindowCount: availability.filter((window) => window?.status === "available").length,
    averageRating,
    reviewCount,
    completedJobCount: safeCount(profile?.completedJobCount),
    completedJobValuePence: completedBookings.reduce((total, booking) => total + safeMoney(booking.pricePence), 0),
    committedJobValuePence: committedBookings.reduce((total, booking) => total + safeMoney(booking.pricePence), 0),
    payoutState: payout == null ? "unavailable" : payout.ready === true ? "ready" : payout.status === "action-required" ? "action-required" : "not-started"
  });
}

export function landlordDashboardSummary(bookings) {
  if (!Array.isArray(bookings)) throw new TypeError("Landlord dashboard records are unavailable.");
  const records = bookings.filter((booking) => booking?.participantRole === "landlord");
  const completed = records.filter((booking) => booking.status === "completed");
  const awaitingConfirmation = records.filter((booking) => booking.status === "awaiting-review");
  const previousCleanerVisits = completed.map((booking) => ({
    displayName: typeof booking.counterpartyName === "string" ? booking.counterpartyName.trim() : "",
    bookingId: booking.bookingId,
    cleanerId: booking.cleanerId,
    propertyId: booking.propertyId,
    scheduledStartAt: booking.scheduledStartAt,
    scheduledAt: Date.parse(booking.scheduledStartAt || "")
  })).filter((visit) => visit.displayName && visit.displayName !== "Assigned Cleaner" && Number.isFinite(visit.scheduledAt))
    .sort((left, right) => right.scheduledAt - left.scheduledAt)
    .map(({ scheduledAt: _scheduledAt, ...visit }) => Object.freeze(visit));
  return Object.freeze({
    completedCleanCount: completed.length,
    awaitingConfirmationCount: awaitingConfirmation.length,
    completedBookingValuePence: completed.reduce((total, booking) => total + safeMoney(booking.pricePence), 0),
    previousCleanerVisitCount: previousCleanerVisits.length,
    previousCleanerVisits: Object.freeze(previousCleanerVisits)
  });
}

export function cleanerInvitationDecisionState(booking, decision) {
  const status = String(booking?.status || "");
  if (status === "pending-cleaner-acceptance") return "pending";
  if (decision === "accept" && cleanerAcceptedStatuses.has(status)) return "recorded";
  if (decision === "decline" && status === "cancelled") return "recorded";
  return "different-outcome";
}

export function landlordBookingNextAction(bookings) {
  const buckets = bookingSummaryBuckets(bookings, "landlord");
  const live = buckets.active.find((booking) => booking.activeJobAvailable === true);
  if (live) return Object.freeze({ kind: "active-job", booking: live, active: true });
  const payment = buckets.upcoming.find((booking) => booking.paymentStepAvailable === true);
  if (payment) return Object.freeze({ kind: "payment", booking: payment, active: false });
  const paymentWaiting = buckets.upcoming.find((booking) => Boolean(booking.paymentStepOpensAt));
  if (paymentWaiting) return Object.freeze({ kind: "payment-waiting", booking: paymentWaiting, active: false });
  const confirmed = buckets.upcoming.find((booking) => booking.activeJobAvailable === true);
  if (confirmed) return Object.freeze({ kind: "active-job", booking: confirmed, active: false });
  return Object.freeze({ kind: "none", booking: null, active: false });
}

export function bookingSummaryPriceLabel(role) {
  return role === "cleaner" ? "Your agreed pay" : "Your booking total";
}
