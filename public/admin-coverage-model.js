const windows = new Set([7, 30, 90]);

export function coverageWindow(value) {
  const selected = Number(value);
  if (!Number.isInteger(selected) || !windows.has(selected)) throw new TypeError("Choose a 7, 30 or 90 day window.");
  return selected;
}

export function serviceLabel(value) {
  return String(value || "").split("-").filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}

export function eligibleLabel(area) {
  if (area.minimumEligibleCleanerCount == null) return "No future unmatched request";
  if (area.minimumEligibleCleanerCount === area.maximumEligibleCleanerCount) {
    return `${area.minimumEligibleCleanerCount}${area.eligibleCountCapped ? "+" : ""} eligible`;
  }
  return `${area.minimumEligibleCleanerCount}–${area.maximumEligibleCleanerCount}${area.eligibleCountCapped ? "+" : ""} eligible`;
}

export function areaPriority(area) {
  if (area.zeroMatchRequestCount > 0) return "No eligible Cleaner";
  if (area.expiredUnmatchedRequestCount > 0) return "Requested time passed";
  if (area.atRiskRequestCount > 0) return "Thin coverage";
  if (area.openUnmatchedRequestCount > 0) return "Coverage available";
  return "Demand history";
}
