import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { cleanerOffersRequestedService, cleanerServiceFields, requestServices, requiredCleanerService } from "../pilot-service.mjs";

assert(requestServices.includes("Regular home clean"), "Ordinary household cleaning is not a supported pilot request.");
assert.equal(requiredCleanerService("Regular home clean"), cleanerServiceFields.serviceDomestic);
assert.equal(requiredCleanerService("Rental turnover clean"), cleanerServiceFields.serviceTurnovers);
assert.equal(requiredCleanerService("Not sure yet"), null, "An uncategorised request was silently treated as a matchable service.");
assert.equal(requiredCleanerService("invented service"), null);
assert.equal(cleanerOffersRequestedService([cleanerServiceFields.serviceDomestic], "Regular home clean"), true);
assert.equal(cleanerOffersRequestedService([cleanerServiceFields.serviceTurnovers], "Regular home clean"), false);
assert.equal(cleanerOffersRequestedService(Object.values(cleanerServiceFields), "Not sure yet"), false, "An uncategorised legacy request matched every Cleaner.");

const root = fileURLToPath(new URL("..", import.meta.url));
const [server, admin, page] = await Promise.all([
  readFile(path.join(root, "server.mjs"), "utf8"),
  readFile(path.join(root, "public", "admin.js"), "utf8"),
  readFile(path.join(root, "public", "index.html"), "utf8")
]);
const serviceSelect = page.match(/<select name="service"[\s\S]*?<\/select>/)?.[0] || "";
assert(serviceSelect.includes("Regular home clean") && !serviceSelect.includes("Not sure yet"), "Public intake still permits an unmatchable service choice.");
assert(server.includes('reason: "specific-service-required"') && server.includes("Choose a specific supported cleaning service before preparing a proposal."), "Legacy uncategorised requests do not fail closed in matching and proposal creation.");
assert(admin.includes('result.matchGate?.reason === "specific-service-required"') && admin.includes("Do not invite a Cleaner for an uncategorised legacy request"), "The operator cannot understand or safely resolve the service gate.");

console.log("Pilot service tests passed: one service policy, complete domestic support and fail-closed uncategorised matching.");
