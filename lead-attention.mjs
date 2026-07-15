import { businessDateToday } from "./business-clock.mjs";

export const scanAttentionHours = 24;
export const requestDateAttentionDays = 7;

function hoursSince(timestamp, nowMs) {
  const startedAt = Date.parse(timestamp || "");
  if (!Number.isFinite(startedAt) || !Number.isFinite(nowMs) || nowMs < startedAt) return null;
  return (nowMs - startedAt) / (60 * 60 * 1000);
}

export function scanAttentionAction({ requestCreatedAt = "", latestBrief = null }, nowMs = Date.now()) {
  if (!latestBrief) {
    const pendingHours = hoursSince(requestCreatedAt, nowMs);
    if (pendingHours === null || pendingHours < scanAttentionHours) return null;
    return {
      code: "scan-stalled",
      severity: "high",
      group: "scan",
      title: "Required room scan has been pending for at least 24 hours",
      detail: "Review the private tracker handoff and recorded activity before any founder-approved follow-up. Do not infer the scope or promise a quote without the customer's scan."
    };
  }

  if (latestBrief.status !== "needs-revision") return null;
  const revisionHours = hoursSince(latestBrief.reviewedAt || latestBrief.createdAt, nowMs);
  if (revisionHours === null || revisionHours < scanAttentionHours) return null;
  return {
    code: "scan-revision-stalled",
    severity: "high",
    group: "scan",
    title: "Revised room scan has been pending for at least 24 hours",
    detail: "Review the recorded revision issue and private tracker route before any founder-approved follow-up. Do not change the customer's scope or create a cleaner checklist on their behalf."
  };
}

function calendarDayNumber(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return null;
  const [year, month, day] = String(value).split("-").map(Number);
  const dayNumber = Date.UTC(year, month - 1, day) / (24 * 60 * 60 * 1000);
  const parsed = new Date(dayNumber * 24 * 60 * 60 * 1000);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return dayNumber;
}

export function requestDateAttentionAction({ preferredDate = "" }, nowMs = Date.now()) {
  const requestedDay = calendarDayNumber(preferredDate);
  const today = calendarDayNumber(businessDateToday(nowMs));
  if (requestedDay === null || today === null) return null;
  const daysUntil = requestedDay - today;
  if (daysUntil > requestDateAttentionDays) return null;

  if (daysUntil < 0) {
    return {
      code: "requested-date-passed",
      severity: "high",
      group: "schedule",
      dueDate: preferredDate,
      title: "Requested cleaning date has passed",
      detail: `The customer requested ${preferredDate}, but no booking was confirmed. Review the recorded scope and activity before any founder-approved follow-up; never substitute a new date without the customer's agreement.`
    };
  }

  const timing = daysUntil === 0 ? "today" : daysUntil === 1 ? "tomorrow" : `in ${daysUntil} days`;
  return {
    code: "requested-date-near",
    severity: "high",
    group: "schedule",
    dueDate: preferredDate,
    title: `Requested cleaning date is ${timing}`,
    detail: `The customer requested ${preferredDate}. Prioritise the outstanding scan, scope review, cleaner availability and economics checks; never promise or substitute a date without explicit customer agreement.`
  };
}
