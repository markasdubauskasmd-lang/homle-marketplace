function boundedCount(value) {
  const count = Number(value);
  return Number.isInteger(count) && count >= 0 ? count : 0;
}

function countLabel(value, singular, plural = `${singular}s`) {
  const count = boundedCount(value);
  return `${count} ${count === 1 ? singular : plural}`;
}

const scanStatusLabels = Object.freeze({
  "landlord-draft": "Waiting for Homle review",
  "needs-revision": "Changes requested",
  "review-pending": "Review checks in progress"
});

export function roomScanSummary(roomScan) {
  if (!roomScan || typeof roomScan !== "object") return "";
  const scope = [
    countLabel(roomScan.photoCount, "room photo/video", "room photos/videos"),
    countLabel(roomScan.taskCount, "cleaner task")
  ];
  if (roomScan.status === "reviewed") {
    const hours = Number(roomScan.reviewedHours);
    if (Number.isFinite(hours) && hours > 0) scope.push(`${hours} reviewed ${hours === 1 ? "hour" : "hours"}`);
    const confidence = String(roomScan.confidence || "").trim().toLowerCase();
    if (["low", "medium", "high"].includes(confidence)) scope.push(`${confidence[0].toUpperCase()}${confidence.slice(1)} confidence`);
  } else {
    scope.push(scanStatusLabels[roomScan.status] || "Review status updating");
  }
  return scope.join(" · ");
}
