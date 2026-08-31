import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { funnelWindow, percentLabel, stagePercent } from "../public/admin-funnel-model.js";

assert.equal(funnelWindow("7"), 7);
assert.equal(funnelWindow("90"), 90);
assert.throws(() => funnelWindow("365"), /7, 30 or 90/);
assert.equal(stagePercent(3, 4), 75);
assert.equal(stagePercent(0, 0), null);
assert.equal(percentLabel(0, 0), "No matured cohort yet");
assert.throws(() => stagePercent(5, 4), /unavailable/);

const [html, script, css, server, admin] = await Promise.all([
  readFile(new URL("../public/admin-funnel.html", import.meta.url), "utf8"),
  readFile(new URL("../public/admin-funnel.js", import.meta.url), "utf8"),
  readFile(new URL("../public/admin-funnel.css", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8"),
  readFile(new URL("../public/admin.html", import.meta.url), "utf8")
]);
// Reachability now comes from the one shared list in admin-navigation.js, not
// from markup copied into each desk. Asserting it there is stronger: it means
// this desk is reachable from ALL ELEVEN desks rather than from the control
// desk alone, which is the fault that left /admin/scan-operations linked from
// exactly one page and reachable nowhere else.
const adminNavigation = await readFile(new URL("../public/admin-navigation.js", import.meta.url), "utf8");

assert(html.includes("Three honest cohorts—not one misleading funnel") && html.includes("Fresh records are excluded for 24 hours") && html.includes("data-funnel-window"), "The report does not explain its maturity, privacy and independent-cohort limits.");
assert(script.includes("/api/marketplace/admin/funnel") && script.includes("/api/marketplace/account") && script.includes('roles?.includes("administrator")'), "The report lost its secure Administrator gate or protected endpoint.");
assert(!script.includes("innerHTML") && script.includes("textContent"), "The aggregate report is not rendered through a safe text-only boundary.");
for (const privateField of ["addressLine", "exactPostcode", "emailAddress", "landlordId", "cleanerId", "requestId", "propertyId", "roomNote", "photoUrl", "amountPence", "providerPaymentId"]) {
  assert(!html.includes(privateField) && !script.includes(privateField), `The funnel UI references private field ${privateField}.`);
}
assert(css.includes("@media(max-width:520px)") && css.includes("grid-template-columns:1fr"), "The report is missing its one-column mobile layout.");
assert(server.includes('"/admin/funnel": "admin-funnel.html"') && adminNavigation.includes('{ href: "/admin/funnel", label: ') && admin.includes("/admin-navigation.js?v="), "The protected report is not served or reachable from the Administrator control desk.");

console.log("Administrator funnel UI tests passed: truthful cohorts, privacy copy, role gate, safe rendering, navigation and mobile layout.");
