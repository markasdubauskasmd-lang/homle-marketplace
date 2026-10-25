import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { landlordGettingStarted } from "../public/landlord-dashboard-model.js";

// Day 4 (DECISIONS D33): a first step for a Landlord with nothing in motion,
// and nothing more. Once a request or booking exists the existing cards own
// the action, so this must step aside: a banner that duplicated them was
// removed on 21 July and tests/landlord-dashboard-ui.mjs keeps it out.
const property = { propertyId: "44444444-4444-4444-8444-444444444444" };

assert.equal(landlordGettingStarted({}).kind, "add-property");
assert.equal(landlordGettingStarted({}).action.opens, "property");
assert.equal(landlordGettingStarted({ properties: [property] }).kind, "book");
assert.equal(landlordGettingStarted({ properties: [property] }).action.href, "/landlord/book");
// A draft or a cancelled request is not something in motion.
for (const status of ["draft", "cancelled"]) assert.equal(landlordGettingStarted({ properties: [property], cleaningRequests: [{ status }] }).kind, "book");
// Anything live belongs to the cards that already carry its action.
for (const status of ["searching-for-cleaner", "cleaner-invited", "pending-cleaner-acceptance", "matched"]) {
  assert.equal(landlordGettingStarted({ properties: [property], cleaningRequests: [{ status }] }).kind, "none", `A ${status} request would be announced twice.`);
}
for (const status of ["pending-cleaner-acceptance", "confirmed", "cleaning-in-progress", "awaiting-review"]) {
  assert.equal(landlordGettingStarted({ properties: [property], bookings: [{ status, paymentStepAvailable: true }] }).kind, "none", `A ${status} booking would be announced twice.`);
}
assert.equal(landlordGettingStarted({ properties: [property], bookings: [{ status: "completed" }, { status: "cancelled" }] }).kind, "book");
assert.equal(landlordGettingStarted({ properties: null, cleaningRequests: "x", bookings: [null] }).kind, "add-property");
for (const step of [landlordGettingStarted({}), landlordGettingStarted({ properties: [property] })]) {
  assert(!/insured|vetted|DBS|guarantee|within \d|minutes|rated/i.test(`${step.title} ${step.body}`), `"${step.title}" promises something the records do not hold.`);
}

const dashboard = readFileSync(new URL("../public/landlord-dashboard.js", import.meta.url), "utf8");
const page = readFileSync(new URL("../public/landlord-dashboard.html", import.meta.url), "utf8");
assert(page.indexOf("data-ld-getting-started") > 0 && page.indexOf("data-ld-getting-started") < page.indexOf('id="ld-home-title"'), "Getting started is not first on the home view.");
assert(/function renderHomeView\(\) \{\s*renderGettingStarted\(\);/.test(dashboard), "The home view does not draw getting started.");
const renderer = dashboard.slice(dashboard.indexOf("function renderGettingStarted"), dashboard.indexOf("const clockTime"));
assert(!/innerHTML|paymentStep|checkout/.test(renderer), "Getting started writes markup or reaches into booking actions.");
console.log("Landlord getting started passed: add a property, then book a first clean; steps aside for any live request or booking; no invented promises; text-only, first on the home view.");
