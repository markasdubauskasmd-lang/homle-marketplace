import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { launchBrowser, resolveChromiumPath, serveStatic } from "../tools/browser-harness.mjs";
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

const [landlordPage, landlordScript, workspaceShell, workspaceShellModel, adminPage, adminScript, styles, server, dashboard, dashboardScript, admin] = await Promise.all([
  readFile(new URL("../public/landlord-help.html", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-help.js", import.meta.url), "utf8"),
  readFile(new URL("../public/workspace-shell.js", import.meta.url), "utf8"),
  readFile(new URL("../public/workspace-shell-model.js", import.meta.url), "utf8"),
  readFile(new URL("../public/admin-support.html", import.meta.url), "utf8"),
  readFile(new URL("../public/admin-support.js", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-help.css", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-dashboard.html", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-dashboard.js", import.meta.url), "utf8"),
  readFile(new URL("../public/admin.html", import.meta.url), "utf8")
]);
// Reachability now comes from the one shared list in admin-navigation.js, not
// from markup copied into each desk. Asserting it there is stronger: it means
// this desk is reachable from ALL ELEVEN desks rather than from the control
// desk alone, which is the fault that left /admin/scan-operations linked from
// exactly one page and reachable nowhere else.
const adminNavigation = await readFile(new URL("../public/admin-navigation.js", import.meta.url), "utf8");

assert(landlordPage.includes("data-support-workspace hidden") && landlordPage.includes("Do not include door or alarm codes") && landlordPage.includes('name="confirmNoSensitiveData"') && landlordPage.includes('value="booking-change"') && landlordPage.includes("payment stay unchanged"), "The Landlord help screen lost its fail-closed gate, booking-change boundary or privacy warning.");
assert(landlordScript.includes('roles?.includes("landlord")') && landlordScript.includes("/api/marketplace/landlord/support-requests") && landlordScript.includes('"X-CSRF-Token": csrf'), "The Landlord help screen lost authenticated role or CSRF binding.");
// The page used to carry its own header with the private navigation inside it,
// hidden until the role check passed. It now renders the shared workspace shell,
// which never builds navigation at all unless the account resolves to a role it
// is entitled to — so a signed-out or wrong-role visitor gets no sidebar, no tab
// bar and no account menu, rather than hidden markup that one missed line would
// reveal. Verified in a browser with no session: 0 nav links on every workspace
// page.
assert(!landlordPage.includes("data-support-private-navigation") && !landlordPage.includes("support-header"), "The Landlord Help page has grown its own private navigation again instead of using the shared shell.");
assert(landlordScript.includes("renderWorkspaceShell(") && workspaceShell.includes("if (shell.showNavigation)") && workspaceShell.includes("if (account) renderAccountAvatar(account)"), "The shared shell no longer withholds navigation and the account control from a visitor without a usable role.");
assert(workspaceShellModel.includes("roles.includes(selected)") && workspaceShellModel.includes("showNavigation: items.length > 0"), "The shell can build navigation for a role the account is not entitled to.");
assert(dashboardScript.includes('/api/marketplace/landlord/bootstrap') && dashboardScript.includes('!unavailable.has("supportRequests")') && dashboardScript.includes('activeBookingChangeRequestFor(supportRequests, booking.bookingId)') && dashboardScript.includes('"View change request"') && dashboardScript.includes('Cleaner commitment and payment remain unchanged'), "The Landlord dashboard does not securely load and reconcile an open booking-change request with its confirmed booking card.");
assert(landlordScript.includes("crypto.randomUUID()") && landlordScript.includes("sent ?") && !landlordScript.includes("innerHTML") && !landlordScript.includes("localStorage"), "Support retries can duplicate a request or private text enters unsafe browser storage/rendering.");
assert(adminPage.includes("Recording a response never changes a booking or payment") && adminPage.includes('value="booking-change"') && adminPage.includes('name="privacyConfirmed"') && adminPage.includes('name="noExternalActionConfirmed"'), "The Administrator queue lost its booking-change or no-external-action boundary.");
assert(adminScript.includes('roles?.includes("administrator")') && adminScript.includes("/api/marketplace/admin/support-requests") && adminScript.includes('method: "PATCH"') && !adminScript.includes("innerHTML"), "The Administrator support queue lost role, API or safe-rendering boundaries.");
assert(adminPage.includes("data-admin-support-private-navigation hidden") && adminPage.includes('<a class="brand" href="/">') && adminScript.includes('const privateNavigation = document.querySelector("[data-admin-support-private-navigation]")') && adminScript.includes("privateNavigation.hidden = true") && adminScript.includes("privateNavigation.hidden = false") && adminScript.indexOf("privateNavigation.hidden = false") > adminScript.indexOf('roles?.includes("administrator")'), "Signed-out, loading or wrong-role visitors can see private Administrator Support navigation, or the Homle brand no longer returns to the public home page.");
assert(styles.includes("@media(max-width:760px)") && styles.includes(".support-layout") && styles.includes(".support-feedback"), "The support journey lacks mobile, loading or feedback styling.");
assert(server.includes('"/landlord/help": "landlord-help.html"') && server.includes('"/admin/support": "admin-support.html"') && dashboard.includes('href="/landlord/help"') && adminNavigation.includes('{ href: "/admin/support", label: ') && admin.includes("/admin-navigation.js?v="), "The private support pages are not served or reachable from the correct role workspaces.");

console.log("Support-request UI checks passed: Landlord-only intake, Administrator-only queue, safe retries, explicit privacy/no-action confirmations, safe rendering and mobile navigation.");

if (resolveChromiumPath()) {
  const records = Array.from({ length: 26 }, (_, index) => ({
    supportRequestId: `abababab-abab-4bab-8bab-${String(index).padStart(12, "0")}`,
    category: "property", subject: `Saved request ${index + 1}`, description: "Please help with this saved property request.",
    status: "resolved", resolutionSummary: `Answer for request ${index + 1}`,
    createdAt: "2026-08-01T10:00:00Z", updatedAt: "2026-08-01T11:00:00Z"
  }));
  let failOlder = true;
  let olderReads = 0;
  let writes = 0;
  const server = await serveStatic({ extraFiles: {
    "/api/marketplace/account": () => ({ body: { ok: true, account: { roles: ["landlord"], selectedRole: "landlord" } } }),
    "/api/marketplace/bookings": () => ({ body: { ok: true, bookings: [] } }),
    "/api/marketplace/auth/session": () => ({ body: { ok: true, csrfToken: "support-test-token" } }),
    "/api/marketplace/landlord/support-requests": async ({ method, url, body }) => {
      if (method === "POST") {
        writes += 1;
        const payload = JSON.parse(body);
        records.unshift({ ...records[0], ...payload, supportRequestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", status: "open", resolutionSummary: null });
        return { body: { ok: true, supportRequest: records[0] } };
      }
      const offset = Number(url.searchParams.get("offset") || 0);
      if (offset) {
        olderReads += 1;
        await new Promise(resolve => setTimeout(resolve, 250));
        if (failOlder) return { status: 503, body: { error: "History temporarily unavailable" } };
      }
      // Include a duplicate at the page boundary to model another tab inserting
      // a request between offset reads. The last original answer must survive.
      return { body: { ok: true, supportRequests: offset ? records.slice(24) : records.slice(0, 25), limit: 25, offset } };
    }
  } });
  const browser = await launchBrowser();
  const waitFor = async (condition) => browser.evaluate(`
    const deadline = Date.now() + 5000;
    while (!(${condition})) {
      if (Date.now() > deadline) throw new Error('Support state did not settle: ' + ${JSON.stringify(condition)});
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    return null;
  `);
  try {
    for (const width of [390, 1280]) {
      failOlder = true;
      await browser.setViewport({ width, height: 844, mobile: width === 390 });
      await browser.goto(`${server.origin}/landlord-help.html`);
      await waitFor(`document.querySelectorAll('.support-request-card').length === 25 && !document.querySelector('[data-support-more]').hidden`);
      await browser.evaluate(`
        document.querySelector('[name="subject"]').value = 'Unsent property question';
        document.querySelector('[name="description"]').value = 'Please preserve this unsent detailed support question.';
        const more = document.querySelector('[data-support-more]'); more.click(); more.click(); more.click();
        return null;
      `);
      await waitFor(`!document.querySelector('[data-support-history-feedback]').hidden && !document.querySelector('[data-support-more]').disabled`);
      const failed = await browser.evaluate(`return {
        count: document.querySelectorAll('.support-request-card').length,
        busy: document.querySelector('[data-support-list]').getAttribute('aria-busy'),
        draft: document.querySelector('[name="description"]').value,
        feedback: document.querySelector('[data-support-history-feedback]').checkVisibility()
      };`);
      assert.equal(failed.count, 25); assert.equal(failed.busy, "false"); assert(failed.feedback);
      assert.equal(failed.draft, "Please preserve this unsent detailed support question.");
      failOlder = false;
      await browser.evaluate(`document.querySelector('[data-support-more]').click(); return null;`);
      await waitFor(`document.querySelectorAll('.support-request-card').length === 26 && document.querySelector('[data-support-more]').hidden`);
      assert.equal(olderReads, width === 390 ? 2 : 4, "Repeated clicks launched overlapping history reads");
      const history = await browser.evaluate(`return {
        answer: document.querySelector('[data-support-list]').textContent.includes('Answer for request 26'),
        subject: document.querySelector('[name="subject"]').value,
        overflow: document.documentElement.scrollWidth > innerWidth
      };`);
      assert(history.answer, "The older answer stayed unreachable");
      assert.equal(history.subject, "Unsent property question");
      assert.equal(history.overflow, false, `${width}px history overflowed the viewport`);
      await browser.evaluate(`document.querySelector('[data-support-refresh]').click(); return null;`);
      await waitFor(`document.querySelectorAll('.support-request-card').length === 25 && !document.querySelector('[data-support-more]').hidden`);
      assert.equal(await browser.evaluate(`document.querySelector('[name="subject"]').value`), "Unsent property question");
    }
    assert.equal(writes, 0, "Reading history created a support request");
    await browser.evaluate(`
      const form = document.querySelector('[data-support-form]');
      form.elements.category.value = 'property';
      form.elements.confirmNoSensitiveData.checked = true;
      document.querySelector('[data-support-more]').click();
      form.requestSubmit();
      return null;
    `);
    await waitFor(`document.querySelector('[data-support-form-feedback]').dataset.kind === 'success'`);
    assert.equal(writes, 1, "Submission while history was loading was lost or duplicated");
    assert(await browser.evaluate(`document.querySelector('.support-request-card').textContent.includes('Unsent property question')`), "History after sending omitted the newly created request");
    assert.deepEqual(browser.pageErrors, []);
  } finally { await browser.close(); await server.close(); }
  console.log("Support history browser journey passed at 390px and 1280px: older answers, failure/retry, duplicate prevention, draft preservation, refresh and submission during a pending read.");
} else console.log("Support history browser journey SKIPPED: Chromium unavailable.");
