/* Presentation-only grouping for the redesigned account Updates page.
 *
 * Tones live here rather than in notification-inbox-model.js so the shared
 * model stays a plain copy table. That separation began as a way to leave the
 * then-frozen Cleaner workspace untouched; the freeze was retired on
 * 20 September 2026, and the split is kept because it is the better shape, not
 * because it is still required.
 */

const tones = Object.freeze({
  action: new Set(["payment-window-opened", "payment-action-required", "payment-failed", "unexpected-task-approval-requested", "review-requested", "new-booking-request"]),
  alert: new Set(["issue-reported", "issue-photo-added", "dispute-opened", "dispute-reviewing", "cleaner-declined", "cleaner-invitation-expired", "booking-cancelled"]),
  success: new Set(["payment-captured", "payment-refunded", "booking-confirmed", "cleaning-completed", "booking-completed", "review-submitted", "dispute-resolved"]),
  journey: new Set(["cleaner-start-journey", "cleaner-started-travelling", "cleaner-nearby", "cleaner-arrived"]),
  progress: new Set(["cleaning-started", "cleaning-paused", "cleaning-resumed", "cleaning-progress-update", "job-photo-added", "unexpected-task-decision"]),
  message: new Set(["booking-message"])
});

export function notificationTone(eventType) {
  for (const [tone, members] of Object.entries(tones)) {
    if (members.has(eventType)) return Object.freeze({ tone, glyph: tone });
  }
  return Object.freeze({ tone: "neutral", glyph: "neutral" });
}

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
