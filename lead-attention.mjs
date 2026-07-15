export const scanAttentionHours = 24;

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
