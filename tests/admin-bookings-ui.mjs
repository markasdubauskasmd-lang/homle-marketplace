import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { adminBookingQueue, adminBookingView, adminMatchingReadiness, operationStatusLabel, plannedMarginPercent, shortOperationReference } from "../public/admin-bookings-model.js";

assert.equal(adminBookingView("attention"), "attention");
assert.equal(adminBookingView(""), null);
assert.throws(() => adminBookingView("addresses"), /valid booking operations view/);
assert.equal(shortOperationReference({ bookingId: "33333333-3333-4333-8333-333333333333" }), "BKG-33333333");
assert.equal(operationStatusLabel("cleaning-in-progress"), "Cleaning In Progress");
assert.equal(plannedMarginPercent({ customerPricePence: 12000, plannedContributionPence: 3500 }), 29.2);
assert.equal(adminBookingQueue({ operations: [], limit: 50, offset: 0 }).limit, 50);
assert.equal(adminMatchingReadiness({ matchingReadiness: { generatedAt: "2026-07-17T20:00:00.000Z", candidateCount: 2, candidateLimit: 25, moreMayExist: false, lowestCustomerPricePence: 9000, highestCustomerPricePence: 12000 } }).candidateCount, 2);
assert.throws(() => adminMatchingReadiness({ matchingReadiness: { generatedAt: "2026-07-17T20:00:00.000Z", candidateCount: 0, candidateLimit: 25, lowestCustomerPricePence: 9000, highestCustomerPricePence: 12000 } }), /pricing is unavailable/);

const [page, script, migration, grants, server] = await Promise.all([
  readFile(new URL("../public/admin-bookings.html", import.meta.url), "utf8"),
  readFile(new URL("../public/admin-bookings.js", import.meta.url), "utf8"),
  readFile(new URL("../db/migrations/052_administrator_booking_operations.sql", import.meta.url), "utf8"),
  readFile(new URL("../db/runtime-role-grants.sql", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8")
]);
assert(page.includes("No names, addresses, access instructions or provider identifiers") && page.includes('name="referrer" content="no-referrer"'), "The operations page lost its privacy explanation or referrer boundary.");
assert(script.includes("/api/marketplace/admin/bookings") && script.includes("/matching-readiness") && script.includes("No Cleaner was contacted or invited") && script.includes("plannedContributionPence") && !script.includes("innerHTML"), "The operations UI lost the protected APIs, no-contact boundary, frozen economics or safe DOM rendering.");
for (const forbidden of ["access_instructions", "provider_payment_id", "destination_account_id", "display_name", "email", "postcode"]) assert(!migration.includes(forbidden), `Administrator operations exposed forbidden ${forbidden}.`);
assert(migration.includes("planned_contribution_pence") && migration.includes("planned_labour_on_cost_pence") && migration.includes("SECURITY DEFINER") && migration.includes("administrator-required"), "The operations projection omitted full planned economics or Administrator enforcement.");
assert(grants.includes("list_administrator_booking_operations(text,integer,integer)") && server.includes('"/admin/bookings": "admin-bookings.html"'), "The restricted grant or protected page route is missing.");
console.log("Administrator booking UI tests passed: privacy-minimised queue, safe rendering and full planned economics.");
