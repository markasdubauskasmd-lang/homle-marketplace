const copy = Object.freeze({
  "new-booking-request": ["New cleaning request", "A cleaning request is waiting for your response.", "Review request"],
  "cleaner-declined": ["Cleaner response received", "The invited Cleaner declined. Homle can continue matching.", "View request"],
  "booking-confirmed": ["Booking confirmed", "The Cleaner accepted the date, scope and agreed price.", "View booking"],
  "cleaner-invitation-expired": ["Invitation expired", "The Cleaner invitation expired without a response.", "View request"],
  "payment-window-opened": ["Payment is now open", "You can now authorize the exact total for your confirmed clean.", "Authorize booking total"],
  "payment-action-required": ["Payment step needed", "Confirm payment authorisation before the clean so the Cleaner can start on time.", "Complete payment step"],
  "booking-reminder": ["Your clean is coming up", "The confirmed clean starts within 24 hours.", "Review booking"],
  "cleaner-start-journey": ["Your clean starts soon", "Payment is ready. Open the job when you are ready to set off.", "Open active job"],
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
  if (["payment-window-opened", "payment-action-required"].includes(eventType)) return "/landlord/dashboard";
  return bookingPath;
}

export function notificationWorkspace(account) {
  if (account?.selectedRole === "cleaner" && account?.roles?.includes("cleaner")) return Object.freeze({ role: "cleaner", label: "Cleaner", path: "/cleaner/dashboard" });
  if (account?.selectedRole === "landlord" && account?.roles?.includes("landlord")) return Object.freeze({ role: "landlord", label: "Landlord", path: "/landlord/dashboard" });
  return Object.freeze({ role: "", label: "Account", path: "/login" });
}

export function notificationWorkspacePath(account) {
  return notificationWorkspace(account).path;
}

export function notificationUnreadBadge(value) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count <= 0) return Object.freeze({ count: 0, visible: false, label: "" });
  return Object.freeze({ count, visible: true, label: count > 99 ? "99+" : String(count) });
}

/* ── What an update looks like ──────────────────────────────────────────────
 *
 * Until this audit every update in the inbox looked identical: one grey dot,
 * one title, one line, one bare clock time. A payment that needs authorising,
 * a Cleaner two streets away and a review request all read the same, so the
 * list had no shape and nothing in it could be scanned.
 *
 * A tone and a glyph per event give the list that shape. Both are derived from
 * the event type alone — never from payload text — so a hostile payload cannot
 * change how an update presents itself.
 */

const tones = Object.freeze({
  action: new Set(["payment-window-opened", "payment-action-required", "unexpected-task-approval-requested", "review-requested", "new-booking-request"]),
  alert: new Set(["issue-reported", "issue-photo-added", "dispute-opened", "dispute-reviewing", "cleaner-declined", "cleaner-invitation-expired"]),
  success: new Set(["booking-confirmed", "cleaning-completed", "booking-completed", "review-submitted", "dispute-resolved"]),
  journey: new Set(["cleaner-start-journey", "cleaner-started-travelling", "cleaner-nearby", "cleaner-arrived"]),
  progress: new Set(["cleaning-started", "cleaning-paused", "cleaning-resumed", "cleaning-progress-update", "job-photo-added", "unexpected-task-decision"]),
  message: new Set(["booking-message"])
});

const glyphs = Object.freeze({
  action: "action", alert: "alert", success: "success",
  journey: "journey", progress: "progress", message: "message", neutral: "neutral"
});

/**
 * The tone an update carries, and the glyph that states it without colour.
 *
 * Colour alone would not be enough: a tone that is only a hue is invisible to a
 * reader who cannot separate those hues, and this list is how a Landlord learns
 * that money is waiting on them.
 */
export function notificationTone(eventType) {
  for (const [tone, members] of Object.entries(tones)) {
    if (members.has(eventType)) return Object.freeze({ tone, glyph: glyphs[tone] });
  }
  return Object.freeze({ tone: "neutral", glyph: glyphs.neutral });
}

/**
 * The day an update belongs to, as a heading.
 *
 * A bare `18:08` is only meaningful next to other times from the same day. The
 * old inbox printed exactly that for anything from today and a full date for
 * anything else, so a list spanning a week read as a jumble of two formats with
 * no divisions in it.
 */
export function notificationDayGroup(value, now = new Date()) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return Object.freeze({ key: "earlier", label: "Earlier" });
  const startOfDay = (input) => Date.UTC(input.getFullYear(), input.getMonth(), input.getDate());
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days <= 0) return Object.freeze({ key: "today", label: "Today" });
  if (days === 1) return Object.freeze({ key: "yesterday", label: "Yesterday" });
  if (days < 7) return Object.freeze({ key: "week", label: "Earlier this week" });
  return Object.freeze({ key: "earlier", label: "Earlier" });
}

/**
 * Updates in the order given, split into day groups.
 *
 * Grouping happens here rather than in the renderer so it can be tested without
 * a browser, and so the Cleaner inbox can reuse it.
 */
export function notificationGroups(items, now = new Date()) {
  const groups = [];
  for (const item of Array.isArray(items) ? items : []) {
    const group = notificationDayGroup(item?.createdAt, now);
    const last = groups.at(-1);
    if (last && last.key === group.key) last.items.push(item);
    else groups.push({ key: group.key, label: group.label, items: [item] });
  }
  return groups.map((group) => Object.freeze({ ...group, items: Object.freeze(group.items) }));
}
