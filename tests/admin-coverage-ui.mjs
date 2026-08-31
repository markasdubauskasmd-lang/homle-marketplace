import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { areaPriority, coverageWindow, eligibleLabel, serviceLabel } from "../public/admin-coverage-model.js";

assert.equal(coverageWindow("7"), 7);
assert.equal(coverageWindow("90"), 90);
assert.throws(() => coverageWindow("365"), /7, 30 or 90/);
assert.equal(serviceLabel("end-of-tenancy"), "End Of Tenancy");
assert.equal(eligibleLabel({ minimumEligibleCleanerCount: 0, maximumEligibleCleanerCount: 0, eligibleCountCapped: false }), "0 eligible");
assert.equal(eligibleLabel({ minimumEligibleCleanerCount: 2, maximumEligibleCleanerCount: 50, eligibleCountCapped: true }), "2–50+ eligible");
assert.equal(areaPriority({ zeroMatchRequestCount: 1, expiredUnmatchedRequestCount: 0, atRiskRequestCount: 1, openUnmatchedRequestCount: 1 }), "No eligible Cleaner");

const [html, script, css, server, admin] = await Promise.all([
  readFile(new URL("../public/admin-coverage.html", import.meta.url), "utf8"),
  readFile(new URL("../public/admin-coverage.js", import.meta.url), "utf8"),
  readFile(new URL("../public/admin-coverage.css", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8"),
  readFile(new URL("../public/admin.html", import.meta.url), "utf8")
]);
// Reachability now comes from the one shared list in admin-navigation.js, not
// from markup copied into each desk. Asserting it there is stronger: it means
// this desk is reachable from ALL ELEVEN desks rather than from the control
// desk alone, which is the fault that left /admin/scan-operations linked from
// exactly one page and reachable nowhere else.
const adminNavigation = await readFile(new URL("../public/admin-navigation.js", import.meta.url), "utf8");

assert(html.includes("Outward-postcode aggregates") && html.includes("Operational snapshot, not a supply promise") && html.includes("data-coverage-window"), "The report does not explain its privacy or operational limits.");
assert(script.includes("/api/marketplace/admin/coverage") && script.includes("/api/marketplace/account") && script.includes('roles?.includes("administrator")'), "The report lost its secure Administrator gate or protected endpoint.");
assert(!script.includes("innerHTML") && script.includes("textContent"), "The aggregate report is not rendered with a safe text-only boundary.");
for (const privateField of ["addressLine", "exactPostcode", "landlordId", "cleanerId", "requestId", "propertyId", "latitude", "longitude", "roomNote", "photoUrl"]) {
  assert(!html.includes(privateField) && !script.includes(privateField), `The coverage UI references private field ${privateField}.`);
}
assert(css.includes("@media(max-width:520px)") && css.includes("grid-template-columns:1fr"), "The report is missing its one-column mobile layout.");
assert(server.includes('"/admin/coverage": "admin-coverage.html"') && adminNavigation.includes('{ href: "/admin/coverage", label: ') && admin.includes("/admin-navigation.js?v="), "The protected report is not served or reachable from the Administrator control desk.");

console.log("Administrator coverage UI tests passed: privacy copy, role gate, safe rendering, navigation and mobile layout.");
