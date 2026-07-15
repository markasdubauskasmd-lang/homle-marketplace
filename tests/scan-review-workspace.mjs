import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
await import(`${pathToFileURL(path.join(root, "public", "scan-review-workspace.js")).href}?test=${Date.now()}`);
const { scanReviewSummary, nextScanRecord, scanReviewReadiness } = globalThis.TidewayScanReviewWorkspace;

const records = [
  { kind: "cleaner", id: "CLN-1", createdAt: "2026-07-01T00:00:00.000Z" },
  { kind: "request", id: "REQ-NEW", createdAt: "2026-07-03T00:00:00.000Z", briefs: [] },
  { kind: "request", id: "REQ-LATER", createdAt: "2026-07-02T00:00:00.000Z", briefs: [{ id: "BRF-LATER", status: "landlord-draft", createdAt: "2026-07-02T00:00:00.000Z", photos: [], checklist: [] }] },
  { kind: "request", id: "REQ-FIRST", createdAt: "2026-07-01T00:00:00.000Z", briefs: [{ id: "BRF-FIRST", status: "landlord-draft", createdAt: "2026-07-01T00:00:00.000Z", photos: [], checklist: [] }] },
  { kind: "request", id: "REQ-REVIEWED", briefs: [{ id: "BRF-REVIEWED", status: "reviewed", reviewEvidenceConfirmed: true }] },
  { kind: "request", id: "REQ-REVISION", briefs: [{ id: "BRF-REVISION", status: "needs-revision" }] }
];

assert.deepEqual(scanReviewSummary(records), { submitted: 4, awaiting: 2, reviewed: 1, revisionRequested: 1 });
assert.equal(nextScanRecord(records)?.id, "REQ-FIRST", "The oldest submitted scope must be reviewed first.");
assert.equal(nextScanRecord(records.filter((record) => record.id !== "REQ-FIRST"))?.id, "REQ-LATER");

const completeInput = {
  decision: "reviewed",
  customerScopeConfirmed: true,
  visualIds: ["IMG-ONE", "VID-TWO"],
  reviewedVisualIds: ["VID-TWO", "IMG-ONE"],
  visualsReviewed: true,
  checklistReviewed: true,
  scopeSignalCodes: ["oven-interior"],
  confirmedScopeSignalCodes: ["oven-interior"],
  timeBreakdownValid: true,
  hours: "3.5",
  confidence: "medium",
  note: "Every room and task was reconciled against the supplied evidence."
};
const complete = scanReviewReadiness(completeInput);
assert.equal(complete.ready, true);
assert.equal(complete.completed, complete.total);
assert.equal(scanReviewReadiness({ ...completeInput, reviewedVisualIds: ["IMG-ONE"] }).ready, false, "Missing per-visual evidence must block approval.");
assert.equal(scanReviewReadiness({ ...completeInput, confirmedScopeSignalCodes: [] }).ready, false, "An unconfirmed price-sensitive item must block approval.");
assert.equal(scanReviewReadiness({ ...completeInput, timeBreakdownValid: false }).ready, false, "An incomplete room-time worksheet must block approval.");
assert.equal(scanReviewReadiness({ ...completeInput, hours: "0.25" }).ready, false, "An unsafe duration must block approval.");
assert.equal(scanReviewReadiness({ ...completeInput, hours: "16.25" }).ready, false, "A duration above the supported visit limit must require a split scope.");
assert.equal(scanReviewReadiness({ ...completeInput, confidence: "low" }).ready, false, "Low confidence must require a revised scan.");
assert.equal(scanReviewReadiness({ ...completeInput, note: "Too short" }).ready, false, "A weak evidence note must block approval.");
assert.equal(scanReviewReadiness({ decision: "needs-revision", note: "Please rescan the kitchen in daylight." }).ready, true);
assert.equal(scanReviewReadiness({ decision: "needs-revision", note: "Unclear" }).ready, false);

const [adminHtml, adminJs] = await Promise.all([
  readFile(path.join(root, "public", "admin.html"), "utf8"),
  readFile(path.join(root, "public", "admin.js"), "utf8")
]);
assert(adminHtml.includes("scan-review-workspace.js") && adminHtml.includes("scope-time-breakdown.js") && adminHtml.includes("Submitted-scan review"));
assert(!adminHtml.includes("/api/admin/job-brief-image?"), "The initial admin HTML must not preload private room media.");
assert(adminJs.includes('loadPhotos.addEventListener("click", () => loadBriefPhotos'), "Private room media must remain behind an explicit click.");
assert(adminJs.includes("save.disabled = !result.ready"), "Incomplete evidence must disable the review decision button.");
assert(adminJs.includes("readReviewTimeBreakdown") && adminJs.includes("Room-by-room cleaning time"), "The human room-time worksheet is not connected to review approval.");
assert(!adminJs.includes("visualsReviewed.checked = true"), "The control desk must never auto-confirm private visual review.");

console.log("scan review workspace tests passed");
