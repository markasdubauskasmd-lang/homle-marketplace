import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { supportCategoryLabels, supportRequestPage, supportRequestPayload, supportStatusLabels } from "../public/landlord-help-model.js";
import { supportQueueFilter, supportReviewPayload } from "../public/admin-support-model.js";

const clientRequestId = "acacacac-acac-4cac-8cac-acacacacacac";
assert.deepEqual(supportRequestPayload({
  category: " ROOM-SCAN ",
  subject: " Room scan did not save ",
  description: " The scan stopped before a checklist appeared. ",
  confirmNoSensitiveData: true
}, clientRequestId), {
  category: "room-scan",
  subject: "Room scan did not save",
  description: "The scan stopped before a checklist appeared.",
  confirmNoSensitiveData: true,
  clientRequestId
});
const page = supportRequestPage({ supportRequests: [{ supportRequestId: "abababab-abab-4bab-8bab-abababababab", category: "room-scan", subject: "Room scan did not save", description: "The scan stopped before a checklist appeared.", status: "open", resolutionSummary: null, createdAt: "2026-07-15T19:06:00.000Z", updatedAt: "2026-07-15T19:06:00.000Z", resolvedAt: null, exactAddress: "must not project" }], limit: 25, offset: 0 });
assert.equal(page.supportRequests.length, 1);
assert.equal(page.supportRequests[0].exactAddress, undefined, "The safe UI projection exposed an unrelated property field.");
assert.equal(supportCategoryLabels["room-scan"], "Room scan");
assert.equal(supportStatusLabels.resolved, "Answered");
assert.deepEqual(supportQueueFilter({ status: "OPEN", category: "property" }), { status: "open", category: "property" });
assert.deepEqual(supportReviewPayload({ status: "reviewing" }), { status: "reviewing" });
assert.deepEqual(supportReviewPayload({ status: "resolved", resolutionSummary: "Refresh the dashboard and reopen the saved draft.", privacyConfirmed: true, noExternalActionConfirmed: true }), { status: "resolved", resolutionSummary: "Refresh the dashboard and reopen the saved draft.", privacyConfirmed: true, noExternalActionConfirmed: true });
for (const invalid of [
  () => supportRequestPayload({ category: "invented", subject: "A useful subject", description: "A sufficiently detailed description.", confirmNoSensitiveData: true }, clientRequestId),
  () => supportRequestPayload({ category: "other", subject: "A useful subject", description: "A sufficiently detailed description.", confirmNoSensitiveData: false }, clientRequestId),
  () => supportQueueFilter({ status: "pending" }),
  () => supportReviewPayload({ status: "resolved", resolutionSummary: "Too short", privacyConfirmed: true, noExternalActionConfirmed: true }),
  () => supportReviewPayload({ status: "resolved", resolutionSummary: "A response long enough to save safely.", privacyConfirmed: false, noExternalActionConfirmed: true })
]) assert.throws(invalid);

const [landlordPage, landlordScript, adminPage, adminScript, styles, server, dashboard, admin] = await Promise.all([
  readFile(new URL("../public/landlord-help.html", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-help.js", import.meta.url), "utf8"),
  readFile(new URL("../public/admin-support.html", import.meta.url), "utf8"),
  readFile(new URL("../public/admin-support.js", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-help.css", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-dashboard.html", import.meta.url), "utf8"),
  readFile(new URL("../public/admin.html", import.meta.url), "utf8")
]);
assert(landlordPage.includes("data-support-workspace hidden") && landlordPage.includes("Do not include door or alarm codes") && landlordPage.includes('name="confirmNoSensitiveData"'), "The Landlord help screen lost its fail-closed gate or privacy warning.");
assert(landlordScript.includes('roles?.includes("landlord")') && landlordScript.includes("/api/marketplace/landlord/support-requests") && landlordScript.includes('"X-CSRF-Token": csrf'), "The Landlord help screen lost authenticated role or CSRF binding.");
assert(landlordScript.includes("crypto.randomUUID()") && landlordScript.includes("sent ?") && !landlordScript.includes("innerHTML") && !landlordScript.includes("localStorage"), "Support retries can duplicate a request or private text enters unsafe browser storage/rendering.");
assert(adminPage.includes("This queue cannot change payments, bookings, accounts or external systems") && adminPage.includes('name="privacyConfirmed"') && adminPage.includes('name="noExternalActionConfirmed"'), "The Administrator queue lost its no-external-action boundary.");
assert(adminScript.includes('roles?.includes("administrator")') && adminScript.includes("/api/marketplace/admin/support-requests") && adminScript.includes('method: "PATCH"') && !adminScript.includes("innerHTML"), "The Administrator support queue lost role, API or safe-rendering boundaries.");
assert(styles.includes("@media(max-width:760px)") && styles.includes(".support-layout") && styles.includes(".support-feedback"), "The support journey lacks mobile, loading or feedback styling.");
assert(server.includes('"/landlord/help": "landlord-help.html"') && server.includes('"/admin/support": "admin-support.html"') && dashboard.includes('href="/landlord/help"') && admin.includes('href="/admin/support"'), "The private support pages are not served or reachable from the correct role workspaces.");

console.log("Support-request UI checks passed: Landlord-only intake, Administrator-only queue, safe retries, explicit privacy/no-action confirmations, safe rendering and mobile navigation.");
