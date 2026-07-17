const copy = Object.freeze({
  "new-booking-request": ["New cleaning request", "A cleaning request is waiting for your response.", "Review request"],
  "cleaner-declined": ["Cleaner response received", "The invited Cleaner declined. Homle can continue matching.", "View request"],
  "booking-confirmed": ["Booking confirmed", "The Cleaner accepted the date, scope and agreed price.", "View booking"],
  "cleaner-invitation-expired": ["Invitation expired", "The Cleaner invitation expired without a response.", "View request"],
  "payment-action-required": ["Payment step needed", "Confirm payment authorisation before the clean so the Cleaner can start on time.", "Complete payment step"],
  "cleaner-started-travelling": ["Cleaner is on the way", "Live journey updates are now available for this booking.", "Track arrival"],
  "cleaner-nearby": ["Cleaner is nearby", "The Cleaner is close to the property.", "Track arrival"],
  "cleaner-arrived": ["Cleaner arrived", "The Cleaner recorded their arrival at the property.", "Open live job"],
  "cleaning-started": ["Cleaning started", "The Cleaner started the room-by-room checklist.", "View progress"],
  "cleaning-paused": ["Cleaning paused", "The Cleaner paused the active cleaning job.", "View update"],
  "cleaning-resumed": ["Cleaning resumed", "The Cleaner resumed the active cleaning job.", "View progress"],
  "cleaning-progress-update": ["Cleaning progress updated", "A room or task was updated on the live checklist.", "View progress"],
  "issue-reported": ["Issue reported", "The Cleaner reported an issue that needs attention.", "Review issue"],
  "job-photo-added": ["Cleaning photo added", "A private before-or-after photo was added to the job.", "View photo"],
  "issue-photo-added": ["Issue photo added", "A private photo was added to a reported issue.", "Review issue"],
  "unexpected-task-approval-requested": ["Extra task needs your decision", "The Cleaner proposed an unexpected task. No price changes automatically.", "Review task"],
  "unexpected-task-decision": ["Extra-task decision received", "The Landlord recorded a decision on the proposed task.", "View decision"],
  "cleaning-completed": ["Checklist completed", "The Cleaner finished the cleaning checklist. Review the visit.", "Review clean"],
  "booking-completed": ["Cleaning visit completed", "The completed booking is ready for its final record and review.", "View booking"],
  "review-requested": ["Share your review", "The clean is complete. A verified review takes less than a minute.", "Review Cleaner"],
  "review-submitted": ["Review submitted", "Your review was received and is awaiting moderation.", "View booking"],
  "booking-message": ["New booking message", "A booking participant sent you a private message.", "Read message"],
  "dispute-opened": ["Private booking case opened", "A participant opened a private case. The booking is paused while Homle reviews it.", "Review case"],
  "dispute-reviewing": ["Booking case under review", "Homle started reviewing the private case for this booking.", "View case"],
  "dispute-resolved": ["Booking case resolved", "Homle recorded the case outcome. Review the private booking update.", "Review outcome"]
});

export function notificationPresentation(eventType) {
  const selected = copy[eventType] || ["Booking updated", "There is a new private update on this booking.", "Open booking"];
  return Object.freeze({ title: selected[0], description: selected[1], action: selected[2] });
}

export function notificationBookingPath(bookingId) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(bookingId || "")
    ? `/bookings/${bookingId.toLowerCase()}`
    : null;
}

export function notificationActionPath(eventType, bookingId, payload = {}) {
  const bookingPath = notificationBookingPath(bookingId);
  if (!bookingPath) return null;
  if (eventType === "new-booking-request") return "/cleaner/dashboard";
  if (eventType === "cleaner-declined") return "/landlord/dashboard";
  if (eventType === "cleaner-invitation-expired") return payload?.matchingReopened === true ? "/landlord/dashboard" : "/cleaner/dashboard";
  if (eventType === "payment-action-required") return `/booking-payment?bookingId=${bookingId.toLowerCase()}`;
  return bookingPath;
}

export function notificationWorkspacePath(account) {
  if (account?.selectedRole === "cleaner" && account?.roles?.includes("cleaner")) return "/cleaner/dashboard";
  if (account?.selectedRole === "landlord" && account?.roles?.includes("landlord")) return "/landlord/dashboard";
  return "/login";
}

export function notificationUnreadBadge(value) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count <= 0) return Object.freeze({ count: 0, visible: false, label: "" });
  return Object.freeze({ count, visible: true, label: count > 99 ? "99+" : String(count) });
}
