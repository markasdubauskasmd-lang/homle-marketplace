import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
await import(`${pathToFileURL(path.join(root, "public", "scan-review-draft.js")).href}?test=${Date.now()}`);
const draftApi = globalThis.TidewayScanReviewDraft;
assert(draftApi);

const values = new Map();
const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) };
const context = { briefId: "BRF-43B460D1", areas: ["Kitchen", "Bathroom"], visualIds: ["IMG-ONE", "IMG-TWO"], signalCodes: ["oven-interior"] };
const now = Date.UTC(2026, 6, 15, 20, 0, 0);

const saved = draftApi.saveScanReviewDraft(storage, context, {
  decision: "reviewed",
  areaMinutes: [{ area: "Kitchen", minutes: "45" }, { area: "Bathroom", minutes: "30" }],
  overheadMinutes: "15",
  confidence: "medium",
  note: "Reviewed each room against the supplied evidence.",
  reviewedVisualIds: ["IMG-ONE", "IMG-TWO"],
  visualsReviewed: true,
  checklistReviewed: true,
  scopeSignalConfirmations: ["oven-interior"],
  scopeEstimateHours: "1.5"
}, now);
assert(saved);
const storedText = [...values.values()][0];
for (const forbidden of ["reviewedVisualIds", "visualsReviewed", "checklistReviewed", "scopeSignalConfirmations", "scopeEstimateHours"]) {
  assert(!storedText.includes(forbidden), `${forbidden} must never enter review recovery storage.`);
}
const restored = draftApi.readScanReviewDraft(storage, context, now + 10_000);
assert.deepEqual(restored.values.areaMinutes, [{ area: "Kitchen", minutes: "45" }, { area: "Bathroom", minutes: "30" }]);
assert.equal(restored.values.confidence, "medium");
assert.equal(draftApi.readScanReviewDraft(storage, { ...context, visualIds: ["IMG-CHANGED"] }, now + 10_000), null, "A changed visual set must invalidate exact-scan recovery.");
assert.equal(values.size, 0);

draftApi.saveScanReviewDraft(storage, context, { note: "Temporary review note" }, now);
assert.equal(draftApi.readScanReviewDraft(storage, context, now + draftApi.lifetimeMs), null, "Expired review drafts must be removed.");
assert.equal(values.size, 0);
draftApi.saveScanReviewDraft(storage, context, {}, now);
assert.equal(values.size, 0, "An untouched review must not create a draft.");
draftApi.saveScanReviewDraft(storage, context, { decision: "needs-revision" }, now);
assert.equal(draftApi.readScanReviewDraft(storage, context, now).values.decision, "needs-revision");
draftApi.clearScanReviewDraft(storage, context);
assert.equal(values.size, 0);
storage.setItem("tidewayScanReviewDraftV1:BRF-43B460D1", "broken-json");
assert.equal(draftApi.readScanReviewDraft(storage, context, now), null);
assert.equal(values.size, 0);

const [adminHtml, adminJs, privacy] = await Promise.all([
  readFile(path.join(root, "public", "admin.html"), "utf8"),
  readFile(path.join(root, "public", "admin.js"), "utf8"),
  readFile(path.join(root, "public", "privacy.html"), "utf8")
]);
assert(adminHtml.includes("scan-review-draft.js"));
assert(adminJs.includes("enhanceScanReviewDraft") && adminJs.includes("readScanReviewDraft(window.sessionStorage"));
assert(adminJs.includes("scanReviewDraftControls.get(form)?.complete()") && adminJs.includes("Evidence confirmations are never restored"));
assert(!adminJs.includes("draft.values.reviewedVisualIds") && !adminJs.includes("draft.values.checklistReviewed"));
assert(privacy.includes("manual room-time review"));

console.log("scan review draft tests passed");
