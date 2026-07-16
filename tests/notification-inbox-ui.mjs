import { readFile } from "node:fs/promises";
import { notificationBookingPath, notificationPresentation, notificationWorkspacePath } from "../public/notification-inbox-model.js";

function assert(condition, message) { if (!condition) throw new Error(message); }

const bookingId = "55555555-5555-4555-8555-555555555555";
assert(notificationPresentation("cleaner-started-travelling").action === "Track arrival", "Journey updates do not lead to tracking.");
assert(notificationPresentation("unexpected-task-approval-requested").description.includes("No price changes automatically"), "Unexpected tasks lost their no-automatic-price promise.");
assert(notificationPresentation("not-yet-known").title === "Booking updated", "Unknown events do not fail safely.");
assert(notificationBookingPath(bookingId) === `/bookings/${bookingId}` && notificationBookingPath("../admin") === null, "Notification booking paths accept an unsafe identifier.");
assert(notificationWorkspacePath({ selectedRole: "landlord", roles: ["landlord"] }) === "/landlord/dashboard", "Landlords do not return to their workspace.");
assert(notificationWorkspacePath({ selectedRole: "cleaner", roles: ["cleaner"] }) === "/cleaner/dashboard", "Cleaners do not return to their workspace.");
assert(notificationWorkspacePath({ selectedRole: "cleaner", roles: ["landlord"] }) === "/login", "A role mismatch does not fail closed.");

const [page, script, model, styles, server, cleanerDashboard, landlordDashboard, packageFile] = await Promise.all([
  readFile(new URL("../public/notifications.html", import.meta.url), "utf8"),
  readFile(new URL("../public/notifications.js", import.meta.url), "utf8"),
  readFile(new URL("../public/notification-inbox-model.js", import.meta.url), "utf8"),
  readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8"),
  readFile(new URL("../public/cleaner-dashboard.html", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-dashboard.html", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8")
]);

for (const selectedCopy of ["Updates", "Mark all read", "You are all caught up.", "Load earlier updates"]) assert(page.includes(selectedCopy), `The inbox omitted ${selectedCopy}.`);
assert(page.includes('role="status"') && page.includes('aria-live="polite"') && page.includes('data-notification-retry'), "The inbox lacks accessible loading, retry or update states.");
assert(script.includes('/api/marketplace/notifications?') && script.includes('/api/marketplace/notifications/read-all') && script.includes('/read`'), "The inbox is not connected to list and read APIs.");
assert(script.includes('"X-CSRF-Token"') && script.includes('credentials: "same-origin"') && script.includes("keepalive: true"), "Read mutations lost session, CSRF or navigation-safe delivery.");
assert(script.includes("replaceChildren") && script.includes("textContent") && !script.includes("innerHTML"), "Notification content is not rendered with safe DOM operations.");
assert(script.includes("inboxCutoff") && script.includes("cutoffCreatedAt"), "Mark-all-read is not protected by a race-safe cutoff.");
assert(model.includes("No price changes automatically") && model.includes("private message") && !model.includes("address"), "Public update copy leaks details or misstates price changes.");
assert(server.includes('"/notifications": "notifications.html"') && cleanerDashboard.includes('href="/notifications"') && landlordDashboard.includes('href="/notifications"'), "The private inbox is not reachable from both workspaces.");
assert(styles.includes(".cleaner-dashboard-page .directory-nav a:first-child") && styles.includes(".landlord-dashboard-page .directory-nav a:first-child") && styles.includes(".notifications-page .directory-nav a"), "Mobile navigation can hide the Updates or workspace return action.");
assert(packageFile.includes("tests/notification-inbox-ui.mjs"), "Notification inbox verification is not part of the project gate.");

console.log("Notification inbox UI tests passed: private role return, safe event copy, pagination, read controls, mobile states and booking actions.");
