import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { activeBookingChangeRequestFor, supportCategoryLabels, supportRequestPage, supportRequestPayload, supportStatusLabels } from "../public/landlord-help-model.js";
import { supportQueueFilter, supportReviewPayload } from "../public/admin-support-model.js";

const clientRequestId = "acacacac-acac-4cac-8cac-acacacacacac";
const bookingId = "bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc";
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
assert.deepEqual(supportRequestPayload({
  category: "booking-change",
  bookingId,
  bookingChangeKind: "reschedule",
  proposedStartAt: "2026-08-12T09:00:00.000Z",
  description: "Please move this booking to the proposed morning because the property will be available then.",
  confirmNoSensitiveData: true
}, clientRequestId, Date.parse("2026-08-04T09:00:00.000Z")), {
  category: "booking-change",
  bookingId,
  bookingChangeKind: "reschedule",
  proposedStartAt: "2026-08-12T09:00:00.000Z",
  description: "Please move this booking to the proposed morning because the property will be available then.",
  confirmNoSensitiveData: true,
  clientRequestId
});
const page = supportRequestPage({ supportRequests: [{ supportRequestId: "abababab-abab-4bab-8bab-abababababab", category: "room-scan", subject: "Room scan did not save", description: "The scan stopped before a checklist appeared.", status: "open", resolutionSummary: null, createdAt: "2026-07-15T19:06:00.000Z", updatedAt: "2026-07-15T19:06:00.000Z", resolvedAt: null, exactAddress: "must not project" }], limit: 25, offset: 0 });
assert.equal(page.supportRequests.length, 1);
assert.equal(page.supportRequests[0].exactAddress, undefined, "The safe UI projection exposed an unrelated property field.");
assert.equal(supportCategoryLabels["room-scan"], "Room scan");
assert.equal(supportCategoryLabels["booking-change"], "Booking change");
assert.equal(supportStatusLabels.resolved, "Answered");
const activeChange = activeBookingChangeRequestFor(supportRequestPage({ supportRequests: [{ supportRequestId: "acacacac-acac-4cac-8cac-acacacacacac", category: "booking-change", subject: "Reschedule requested", description: "Please move this booking to the proposed time.", status: "reviewing", resolutionSummary: null, bookingId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", bookingChangeKind: "reschedule", proposedStartAt: "2026-08-10T10:00:00.000Z", createdAt: "2026-08-04T10:00:00.000Z", updatedAt: "2026-08-04T11:00:00.000Z", resolvedAt: null }] }).supportRequests, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
assert.equal(activeChange?.status, "reviewing");
assert.equal(activeBookingChangeRequestFor([{ ...activeChange, status: "resolved" }], "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"), null, "A resolved booking-change request remained active on the dashboard.");
assert.deepEqual(supportQueueFilter({ status: "OPEN", category: "property" }), { status: "open", category: "property" });
assert.deepEqual(supportQueueFilter({ status: "open", category: "booking-change" }), { status: "open", category: "booking-change" });
assert.deepEqual(supportReviewPayload({ status: "reviewing" }), { status: "reviewing" });
assert.deepEqual(supportReviewPayload({ status: "resolved", resolutionSummary: "Refresh the dashboard and reopen the saved draft.", privacyConfirmed: true, noExternalActionConfirmed: true }), { status: "resolved", resolutionSummary: "Refresh the dashboard and reopen the saved draft.", privacyConfirmed: true, noExternalActionConfirmed: true });
for (const invalid of [
  () => supportRequestPayload({ category: "invented", subject: "A useful subject", description: "A sufficiently detailed description.", confirmNoSensitiveData: true }, clientRequestId),
  () => supportRequestPayload({ category: "other", subject: "A useful subject", description: "A sufficiently detailed description.", confirmNoSensitiveData: false }, clientRequestId),
  () => supportQueueFilter({ status: "pending" }),
  () => supportReviewPayload({ status: "resolved", resolutionSummary: "Too short", privacyConfirmed: true, noExternalActionConfirmed: true }),
  () => supportReviewPayload({ status: "resolved", resolutionSummary: "A response long enough to save safely.", privacyConfirmed: false, noExternalActionConfirmed: true })
]) assert.throws(invalid);

const [landlordPage, landlordScript, adminPage, adminScript, styles, server, dashboard, dashboardScript, admin] = await Promise.all([
  readFile(new URL("../public/landlord-help.html", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-help.js", import.meta.url), "utf8"),
  readFile(new URL("../public/admin-support.html", import.meta.url), "utf8"),
  readFile(new URL("../public/admin-support.js", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-help.css", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-dashboard.html", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-dashboard.js", import.meta.url), "utf8"),
  readFile(new URL("../public/admin.html", import.meta.url), "utf8")
]);
assert(landlordPage.includes("data-support-workspace hidden") && landlordPage.includes("Do not include door or alarm codes") && landlordPage.includes('name="confirmNoSensitiveData"') && landlordPage.includes('value="booking-change"') && landlordPage.includes("payment stay unchanged"), "The Landlord help screen lost its fail-closed gate, booking-change boundary or privacy warning.");
assert(landlordScript.includes('roles?.includes("landlord")') && landlordScript.includes("/api/marketplace/landlord/support-requests") && landlordScript.includes('"X-CSRF-Token": csrf'), "The Landlord help screen lost authenticated role or CSRF binding.");
assert(
  landlordPage.includes('data-workspace-main')
    && !landlordPage.includes("data-support-private-navigation")
    && landlordScript.includes('import { renderWorkspaceShell } from "./workspace-shell.js?v=20260830-1"')
    && landlordScript.includes("await renderWorkspaceShell({")
    && landlordScript.indexOf("await renderWorkspaceShell({") < landlordScript.indexOf('roles?.includes("landlord")'),
  "Landlord Help no longer mounts the account-derived, fail-closed workspace shell before its private role gate."
);
assert(dashboardScript.includes('/api/marketplace/landlord/bootstrap') && dashboardScript.includes('!unavailable.has("supportRequests")') && dashboardScript.includes('activeBookingChangeRequestFor(supportRequests, booking.bookingId)') && dashboardScript.includes('"View change request"') && dashboardScript.includes('Cleaner commitment and payment remain unchanged'), "The Landlord dashboard does not securely load and reconcile an open booking-change request with its confirmed booking card.");
assert(landlordScript.includes("crypto.randomUUID()") && landlordScript.includes("sent ?") && !landlordScript.includes("innerHTML") && !landlordScript.includes("localStorage"), "Support retries can duplicate a request or private text enters unsafe browser storage/rendering.");
assert(adminPage.includes("Recording a response never changes a booking or payment") && adminPage.includes('value="booking-change"') && adminPage.includes('name="privacyConfirmed"') && adminPage.includes('name="noExternalActionConfirmed"'), "The Administrator queue lost its booking-change or no-external-action boundary.");
assert(adminScript.includes('roles?.includes("administrator")') && adminScript.includes("/api/marketplace/admin/support-requests") && adminScript.includes('method: "PATCH"') && !adminScript.includes("innerHTML"), "The Administrator support queue lost role, API or safe-rendering boundaries.");
assert(adminPage.includes("data-admin-support-private-navigation hidden") && adminPage.includes('<a class="brand" href="/">') && adminScript.includes('const privateNavigation = document.querySelector("[data-admin-support-private-navigation]")') && adminScript.includes("privateNavigation.hidden = true") && adminScript.includes("privateNavigation.hidden = false") && adminScript.indexOf("privateNavigation.hidden = false") > adminScript.indexOf('roles?.includes("administrator")'), "Signed-out, loading or wrong-role visitors can see private Administrator Support navigation, or the Homle brand no longer returns to the public home page.");
assert(styles.includes("@media(max-width:760px)") && styles.includes(".support-layout") && styles.includes(".support-feedback"), "The support journey lacks mobile, loading or feedback styling.");
assert(server.includes('"/landlord/help": "landlord-help.html"') && server.includes('"/admin/support": "admin-support.html"') && dashboard.includes('href="/landlord/help"') && admin.includes('href="/admin/support"'), "The private support pages are not served or reachable from the correct role workspaces.");

console.log("Support-request UI checks passed: Landlord-only intake, Administrator-only queue, safe retries, explicit privacy/no-action confirmations, safe rendering and mobile navigation.");
