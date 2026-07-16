import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { adminCaseFilter, adminCaseQueue, adminCaseResolutionPayload, adminCaseReviewPayload, caseCategoryLabel, caseStatusLabel, shortBookingReference } from "../public/admin-cases-model.js";

const example = {
  disputeId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  bookingId: "55555555-5555-4555-8555-555555555555",
  category: "quality",
  description: "The agreed cleaning scope was not completed.",
  status: "open",
  openedByRole: "landlord",
  resolutionNote: null,
  resolutionOutcome: null,
  createdAt: "2026-07-15T19:05:00.000Z",
  resolvedAt: null,
  privateEmail: "must-not-project@example.invalid",
  exactAddress: "Must not project"
};

const queue = adminCaseQueue({ ok: true, disputes: [example], limit: 50, offset: 0, ignoredSecret: "private" });
assert.equal(queue.disputes.length, 1);
assert.equal(queue.disputes[0].description, example.description);
assert.equal(queue.disputes[0].privateEmail, undefined);
assert.equal(queue.disputes[0].exactAddress, undefined);
assert(Object.isFrozen(queue) && Object.isFrozen(queue.disputes) && Object.isFrozen(queue.disputes[0]), "Projected case records must remain immutable.");
assert.equal(adminCaseFilter(" REVIEWING "), "reviewing");
assert.equal(adminCaseFilter(""), "");
assert.deepEqual(adminCaseReviewPayload(), { status: "reviewing" });
assert.deepEqual(adminCaseResolutionPayload({ resolutionOutcome: "cancelled", resolutionNote: "Evidence reviewed and the booking outcome was cancelled.", confirmed: true }), { status: "resolved", resolutionOutcome: "cancelled", resolutionNote: "Evidence reviewed and the booking outcome was cancelled." });
assert.equal(shortBookingReference(example.bookingId), "BKG-55555555");
assert.equal(caseStatusLabel("reviewing"), "Under review");
assert.equal(caseCategoryLabel("payment"), "Payment record");

for (const invalid of [
  () => adminCaseQueue({ disputes: [{ ...example, disputeId: "bad" }], limit: 50, offset: 0 }),
  () => adminCaseQueue({ disputes: [{ ...example, openedByRole: "administrator" }], limit: 50, offset: 0 }),
  () => adminCaseQueue({ disputes: [{ ...example, description: "short" }], limit: 50, offset: 0 }),
  () => adminCaseQueue({ disputes: [example], limit: 101, offset: 0 }),
  () => adminCaseFilter("pending"),
  () => adminCaseResolutionPayload({ resolutionOutcome: "completed", resolutionNote: "Evidence reviewed and the booking remains completed.", confirmed: false }),
  () => adminCaseResolutionPayload({ resolutionOutcome: "refunded", resolutionNote: "Evidence reviewed and a refund was supposedly recorded.", confirmed: true })
]) assert.throws(invalid);

const [page, script, model, styles, server, pilotAdmin, packageJson] = await Promise.all([
  readFile(new URL("../public/admin-cases.html", import.meta.url), "utf8"),
  readFile(new URL("../public/admin-cases.js", import.meta.url), "utf8"),
  readFile(new URL("../public/admin-cases-model.js", import.meta.url), "utf8"),
  readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8"),
  readFile(new URL("../public/admin.html", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8")
]);

assert(page.includes("Marketplace trust and safety") && page.includes("This screen never refunds, charges or pays anyone") && page.includes("data-admin-cases-workspace hidden"), "The case screen lost its truthful operating boundary or fail-closed workspace.");
assert(page.includes("Property addresses, access instructions and contact details stay out of this queue") && !page.includes("data-dispute-id"), "The queue markup invites unnecessary private record exposure.");
assert(page.includes("data-admin-case-dialog") && page.includes("does not issue a refund, capture payment, pay a Cleaner or contact either participant"), "The audited resolution confirmation is missing its external-action boundary.");
assert(script.includes('requestJson("/api/marketplace/account")') && script.includes("roles?.includes(\"administrator\")") && script.includes("/api/marketplace/admin/disputes?") && script.includes('method: "PATCH"'), "The screen is not bound to the authenticated Administrator case API.");
assert(script.includes('"X-CSRF-Token": csrf') && script.includes('credentials: "same-origin"') && script.includes('cache: "no-store"'), "Case reads or mutations lost their session, CSRF or no-store boundary.");
assert(script.includes("textContent") && script.includes("replaceChildren") && !script.includes("innerHTML") && !script.includes("document.cookie") && !script.includes("localStorage"), "Private case text can enter an unsafe render/storage path.");
assert(script.includes("Secure marketplace administration is not connected yet") && script.includes("Administrator account required") && script.includes("navigator.onLine"), "The case screen lacks unavailable, unauthorized or connection-failure states.");
assert(model.includes("privateEmail") === false && model.includes("exactAddress") === false, "The case projection added unrelated identity or property fields.");
assert(styles.includes(".admin-case-card") && styles.includes("@media (max-width: 620px)") && styles.includes(".admin-case-confirmation"), "The case screen lacks mobile or decision-confirmation styling.");
assert(server.includes('"/admin/cases": "admin-cases.html"') && pilotAdmin.includes('href="/admin/cases"'), "The marketplace case route is not served or linked from private operations.");
assert(packageJson.includes('"check:admin-cases"') && packageJson.includes('"test:admin-cases"') && packageJson.includes("tests/admin-cases-ui.mjs"), "The case UI is not included in repository quality gates.");

console.log("Administrator case UI tests passed: immutable minimum-data projection, role/account gate, CSRF mutation, safe rendering, truthful outcomes, pagination, offline handling and mobile controls.");
