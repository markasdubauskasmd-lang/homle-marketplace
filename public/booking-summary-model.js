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

function deadlineNow(value) {
  if (value instanceof Date) {
    const milliseconds = value.getTime();
    return Number.isFinite(milliseconds) ? milliseconds : Date.now();
  }
  const milliseconds = Number(value);
  return Number.isFinite(milliseconds) ? milliseconds : Date.now();
}

export function bookingInvitationDeadlineState(booking, now = Date.now()) {
  if (booking?.status !== "pending-cleaner-acceptance") return Object.freeze({ kind: "closed", remainingMs: 0 });
  const deadline = Date.parse(booking.responseDeadline || "");
  if (!Number.isFinite(deadline)) return Object.freeze({ kind: "unavailable", remainingMs: 0 });
  const remainingMs = deadline - deadlineNow(now);
  if (remainingMs <= 0) return Object.freeze({ kind: "expired", remainingMs: 0 });
  return Object.freeze({ kind: remainingMs <= 60 * 60_000 ? "urgent" : "open", remainingMs });
}

export function cleanerInvitationDeadlineState(booking, now = Date.now()) {
  if (booking?.canRespond !== true) return Object.freeze({ kind: "closed", remainingMs: 0 });
  return bookingInvitationDeadlineState(booking, now);
}

export function formatInvitationTimeRemaining(milliseconds) {
  const value = Number(milliseconds);
  if (!Number.isFinite(value) || value <= 0) return "less than 1 minute";
  const minutes = Math.max(1, Math.ceil(value / 60_000));
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours} ${hours === 1 ? "hour" : "hours"}${remainder ? ` ${remainder} min` : ""}`;
}

export function bookingSummaryBuckets(bookings, role, now = Date.now()) {
  const records = Array.isArray(bookings) ? bookings.filter((booking) => booking?.participantRole === role) : [];
  const invitationOpen = (booking) => ["open", "urgent"].includes(cleanerInvitationDeadlineState(booking, now).kind);
  return Object.freeze({
    pending: Object.freeze(records.filter((booking) => role === "cleaner" && invitationOpen(booking))),
    waiting: Object.freeze(records.filter((booking) => role === "landlord" && booking.status === "pending-cleaner-acceptance")),
    active: Object.freeze(records.filter((booking) => activeStatuses.has(booking.status))),
    upcoming: Object.freeze(records.filter((booking) => upcomingStatuses.has(booking.status))),
    history: Object.freeze(records.filter((booking) => historyStatuses.has(booking.status) || role === "cleaner" && booking.status === "pending-cleaner-acceptance" && !invitationOpen(booking)))
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

export function bookingSummaryPrimaryAction(booking, role, now = Date.now()) {
  if (role === "cleaner" && ["open", "urgent"].includes(cleanerInvitationDeadlineState(booking, now).kind)) return Object.freeze({ kind: "respond", label: "Review request" });
  if (role === "landlord" && booking?.paymentStepAvailable === true) return Object.freeze({ kind: "payment", label: "Authorize booking total" });
  if (booking?.activeJobAvailable === true) return Object.freeze({ kind: "active-job", label: ["awaiting-review", "completed"].includes(booking.status) ? "View job record" : "Open active job" });
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

export function cleanerMarketplaceCapabilityState(input = {}) {
  const checked = input.checked === true;
  const pricingReady = checked && input.pricingReady === true;
  const geocodingReady = checked && input.geocodingReady === true;
  const matchingReady = pricingReady && geocodingReady;
  let notice = null;
  if (!checked) {
    notice = Object.freeze({
      key: "checking",
      title: "Matching status could not be checked",
      copy: "Your profile and availability remain saved. Refresh before relying on new cleaning-request availability."
    });
  } else if (!pricingReady) {
    notice = Object.freeze({
      key: "private-pricing",
      title: "Cleaner matching prices are being connected",
      copy: "Your profile and availability remain saved. Homle will not send you new cleaning requests until the approved booking pricing checks are ready."
    });
  } else if (!geocodingReady) {
    notice = Object.freeze({
      key: "postcode-geocoding",
      title: "Postcode distance matching is being connected",
      copy: "Your profile and availability remain saved. Homle will not send you distance-priced requests until service-area and property postcodes can be checked by real distance."
    });
  }
  return Object.freeze({ checked, pricingReady, geocodingReady, matchingReady, notice });
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

export function cleanerInvitationDecisionState(booking, decision, now = Date.now()) {
  const status = String(booking?.status || "");
  if (["open", "urgent"].includes(cleanerInvitationDeadlineState(booking, now).kind)) return "pending";
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

export function bookingSummaryMoneyBoundary(booking, role) {
  if (role !== "cleaner" && role !== "landlord") throw new TypeError("Choose a booking participant role.");
  const status = String(booking?.status || "");
  if (role === "cleaner") {
    if (status === "pending-cleaner-acceptance") return "This is the offered Cleaner pay. Nothing is earned or transferred unless you accept and complete the booking.";
    if (status === "completed") return "This is completed job value, not proof of transfer. Payout evidence is verified separately.";
    if (status === "cancelled") return "This cancelled booking is not earned pay and is not proof of a transfer.";
    if (status === "disputed") return "This agreed pay is under review. It is not proof of a transfer.";
    return "This is your agreed Cleaner pay, not a payout receipt. Transfer status is verified separately after completion.";
  }
  if (status === "pending-cleaner-acceptance") return "This is the frozen booking total. No payment has been taken while the Cleaner decides.";
  if (status === "completed") return "This completed booking total is not a receipt or refund record. Final payment evidence is verified separately.";
  if (status === "cancelled") return "This cancelled booking total is not proof that a charge was made.";
  if (status === "disputed") return "This booking total is under review and is not proof of a final charge or refund.";
  if (booking?.paymentAuthorizationReady === true) return "This total is authorized for this booking. Authorization is not a completed charge or Cleaner payout.";
  if (booking?.paymentStepAvailable === true) return "This total still needs authorization. No charge or Cleaner payout has been completed.";
  if (booking?.paymentStepOpensAt) return "Authorization is not open yet. No payment action is required.";
  return "This is your agreed booking total. Final payment and payout evidence is verified separately.";
}
