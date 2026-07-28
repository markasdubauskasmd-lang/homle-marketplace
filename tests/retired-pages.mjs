import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const retiredFiles = [
  "index.html",
  "app.js",
  "marketplace-preview.html",
  "marketplace-preview.js",
  "marketplace-preview-model.js",
  "brief.html",
  "brief.js",
  "brief-complete.html",
  "brief-complete.js",
  "quote.html",
  "quote.js",
  "booking-payment.html",
  "booking-payment.js",
  "booking-payment-model.js",
  "booking-pack.html",
  "booking-pack.js",
  "request-status.html",
  "request-status.js",
  "request-status-model.js",
  "cleaner-availability.html",
  "cleaner-availability.js",
  "cleaner-status.html",
  "cleaner-status.js",
  "cleaners.html",
  "cleaners.js"
];

for (const filename of retiredFiles) {
  await assert.rejects(access(new URL(`../public/${filename}`, import.meta.url)), undefined, `${filename} still exists.`);
}

const [server, home, landlord, cleaner, notifications] = await Promise.all([
  readFile(new URL("../server.mjs", import.meta.url), "utf8"),
  readFile(new URL("../public/home.html", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-dashboard.html", import.meta.url), "utf8"),
  readFile(new URL("../public/cleaner-dashboard.html", import.meta.url), "utf8"),
  readFile(new URL("../public/notifications.html", import.meta.url), "utf8")
]);

for (const route of [
  "/request",
  "/join",
  "/cleaners",
  "/marketplace-preview",
  "/brief",
  "/brief-complete",
  "/quote",
  "/booking-payment",
  "/booking-confirmation",
  "/assignment",
  "/request-status",
  "/cleaner/availability",
  "/cleaner-status"
]) {
  assert.equal(server.includes(`"${route}":`), false, `${route} is still registered as a page.`);
}

const publicSurfaces = [home, landlord, cleaner, notifications].join("\n");
for (const route of ["/request", "/join", "/cleaners", "/marketplace-preview", "/brief", "/quote", "/booking-payment", "/request-status", "/cleaner/availability", "/cleaner-status"]) {
  assert.equal(publicSurfaces.includes(`href="${route}`), false, `A visible navigation link still opens ${route}.`);
}

assert(server.includes('"/landlord/dashboard": "landlord-dashboard.html"'), "Landlord dashboard was removed.");
assert(server.includes('"/cleaner/dashboard": "cleaner-dashboard.html"'), "Cleaner dashboard was removed.");

console.log(`Retired-page tests passed: ${retiredFiles.length} obsolete assets and 13 routes are permanently absent.`);
