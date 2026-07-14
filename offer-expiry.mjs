export function offerDeadline(sentAt, validityHours, scheduledStartMs) {
  const sentMs = Date.parse(sentAt);
  const hours = Number(validityHours);
  const visitStartMs = Number(scheduledStartMs);
  if (!Number.isFinite(sentMs) || !Number.isFinite(hours) || hours <= 0 || !Number.isFinite(visitStartMs)) return "";
  const deadlineMs = Math.min(sentMs + hours * 60 * 60 * 1000, visitStartMs);
  return deadlineMs > sentMs ? new Date(deadlineMs).toISOString() : "";
}

export function offerIsOpen(expiresAt, now = Date.now()) {
  const deadlineMs = Date.parse(expiresAt);
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  return Number.isFinite(deadlineMs) && Number.isFinite(nowMs) && nowMs < deadlineMs;
}

export function decisionWasInTime(decidedAt, expiresAt) {
  const decidedMs = Date.parse(decidedAt);
  const deadlineMs = Date.parse(expiresAt);
  return Number.isFinite(decidedMs) && Number.isFinite(deadlineMs) && decidedMs < deadlineMs;
}
