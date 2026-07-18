import { readFile } from "node:fs/promises";
import { notificationActionPath, notificationBookingPath, notificationPresentation, notificationUnreadBadge, notificationWorkspace, notificationWorkspacePath } from "../public/notification-inbox-model.js";

function assert(condition, message) { if (!condition) throw new Error(message); }

const bookingId = "55555555-5555-4555-8555-555555555555";
assert(notificationPresentation("cleaner-started-travelling").action === "Track arrival", "Journey updates do not lead to tracking.");
assert(notificationPresentation("unexpected-task-approval-requested").description.includes("No price changes automatically"), "Unexpected tasks lost their no-automatic-price promise.");
assert(notificationPresentation("payment-action-required").action === "Complete payment step", "Payment readiness does not identify the next action.");
assert(notificationPresentation("payment-window-opened").action === "Authorize booking total", "The calm payment-opening update does not identify the next action.");
assert(notificationPresentation("booking-reminder").action === "Review booking" && notificationPresentation("booking-reminder").description.includes("within 24 hours"), "The confirmed-visit reminder does not identify its private next step.");
assert(notificationPresentation("cleaner-start-journey").action === "Open active job" && notificationPresentation("cleaner-start-journey").description.includes("Payment is ready"), "The Cleaner journey prompt does not state its payment-ready next action.");
assert(notificationPresentation("dispute-opened").action === "Review case" && notificationPresentation("dispute-reviewing").title === "Booking case under review" && notificationPresentation("dispute-resolved").action === "Review outcome", "Private booking-case events do not lead participants to a clear next action.");
assert(notificationPresentation("not-yet-known").title === "Booking updated", "Unknown events do not fail safely.");
assert(notificationBookingPath(bookingId) === `/bookings/${bookingId}` && notificationBookingPath("../admin") === null, "Notification booking paths accept an unsafe identifier.");
assert(notificationActionPath("new-booking-request", bookingId) === "/cleaner/dashboard" && notificationActionPath("cleaner-declined", bookingId) === "/landlord/dashboard", "Invitation and decline updates do not open the role workspace containing the next action.");
assert(notificationActionPath("cleaner-invitation-expired", bookingId, { matchingReopened: true }) === "/landlord/dashboard" && notificationActionPath("cleaner-invitation-expired", bookingId, {}) === "/cleaner/dashboard", "An expired invitation does not return each participant to the correct workspace.");
assert(notificationActionPath("payment-action-required", bookingId) === `/booking-payment?bookingId=${bookingId}`, "Payment readiness does not open the exact private payment step.");
assert(notificationActionPath("payment-window-opened", bookingId) === `/booking-payment?bookingId=${bookingId}`, "Payment opening does not open the exact private payment step.");
assert(notificationActionPath("booking-confirmed", bookingId) === `/bookings/${bookingId}` && notificationActionPath("new-booking-request", "../admin") === null, "Active updates lost their private booking action or a malformed notification created a dashboard link.");
assert(notificationWorkspacePath({ selectedRole: "landlord", roles: ["landlord"] }) === "/landlord/dashboard", "Landlords do not return to their workspace.");
assert(notificationWorkspacePath({ selectedRole: "cleaner", roles: ["cleaner"] }) === "/cleaner/dashboard", "Cleaners do not return to their workspace.");
assert(notificationWorkspacePath({ selectedRole: "cleaner", roles: ["landlord"] }) === "/login", "A role mismatch does not fail closed.");
assert(notificationWorkspace({ selectedRole: "landlord", roles: ["landlord"] }).label === "Landlord" && notificationWorkspace({ selectedRole: "cleaner", roles: ["cleaner"] }).label === "Cleaner", "The inbox cannot present the active role as a distinct workspace.");
assert(notificationUnreadBadge(3).visible && notificationUnreadBadge(3).label === "3" && notificationUnreadBadge(100).label === "99+", "Unread counts are not presented compactly.");
assert(!notificationUnreadBadge(0).visible && !notificationUnreadBadge(-1).visible && !notificationUnreadBadge("not-a-count").visible, "Invalid or empty unread counts create a badge.");

const [page, script, accountMenu, badgeScript, model, styles, server, cleanerDashboard, landlordDashboard, packageFile] = await Promise.all([
  readFile(new URL("../public/notifications.html", import.meta.url), "utf8"),
  readFile(new URL("../public/notifications.js", import.meta.url), "utf8"),
  readFile(new URL("../public/account-menu.js", import.meta.url), "utf8"),
  readFile(new URL("../public/notification-badge.js", import.meta.url), "utf8"),
  readFile(new URL("../public/notification-inbox-model.js", import.meta.url), "utf8"),
  readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8"),
  readFile(new URL("../public/cleaner-dashboard.html", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-dashboard.html", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8")
]);

for (const selectedCopy of ["Updates", "Mark all read", "You are all caught up.", "Load earlier updates"]) assert(page.includes(selectedCopy), `The inbox omitted ${selectedCopy}.`);
assert(page.includes('role="status"') && page.includes('aria-live="polite"') && page.includes('data-notification-retry'), "The inbox lacks accessible loading, retry or update states.");
assert(page.includes('data-workspace-nav="cleaner"') && page.includes('data-workspace-nav="landlord"') && page.includes('aria-label="Cleaner navigation"') && page.includes('aria-label="Landlord navigation"') && page.includes('data-account-menu') && page.includes('data-account-avatar'), "Updates do not retain separate Cleaner and Landlord navigation or the signed-in account picture.");
assert(script.includes('/api/marketplace/notifications?') && script.includes('/api/marketplace/notifications/read-all') && script.includes('/read`'), "The inbox is not connected to list and read APIs.");
assert(script.includes('readSignedInAccount()') && script.includes('showWorkspace(accountResult.account)') && script.includes('workspace.role === "cleaner"') && script.includes('workspace.role === "landlord"'), "The Updates page does not restore the exact signed-in workspace without a second account request.");
assert(accountMenu.includes("export function readSignedInAccount()") && accountMenu.includes("signedInAccountRequest = null") && accountMenu.includes('requestJson("/api/marketplace/account"'), "Shared account hydration cannot recover after a temporary account-read failure.");
assert(script.includes('"X-CSRF-Token"') && script.includes('credentials: "same-origin"') && script.includes("keepalive: true"), "Read mutations lost session, CSRF or navigation-safe delivery.");
assert(script.includes("replaceChildren") && script.includes("textContent") && !script.includes("innerHTML"), "Notification content is not rendered with safe DOM operations.");
assert(script.includes("inboxCutoff") && script.includes("cutoffCreatedAt"), "Mark-all-read is not protected by a race-safe cutoff.");
assert(model.includes("No price changes automatically") && model.includes("private message") && model.includes("Private booking case opened") && !model.includes("address"), "Public update copy leaks details or omits the private booking-case state.");
assert(server.includes('"/notifications": "notifications.html"') && cleanerDashboard.includes('href="/notifications"') && landlordDashboard.includes('href="/notifications"'), "The private inbox is not reachable from both workspaces.");
assert(cleanerDashboard.includes("data-notification-link") && cleanerDashboard.includes("data-notification-count") && cleanerDashboard.includes("notification-badge.js") && landlordDashboard.includes("data-notification-link") && landlordDashboard.includes("data-notification-count") && landlordDashboard.includes("notification-badge.js"), "Unread updates are not visible from both role dashboards.");
assert(badgeScript.includes('/api/marketplace/notifications?limit=1') && badgeScript.includes('credentials: "same-origin"') && badgeScript.includes('cache: "no-store"') && badgeScript.includes("event.persisted") && badgeScript.includes('document.visibilityState === "visible"'), "The dashboard badge is not private, bounded or refreshed after returning to the page.");
assert(badgeScript.includes("textContent") && !badgeScript.includes("innerHTML") && !badgeScript.includes("setInterval"), "The dashboard badge uses unsafe rendering or constant polling.");
assert(styles.includes(".cleaner-workspace-page .directory-nav, .landlord-dashboard-page .directory-nav") && styles.includes(".cleaner-workspace-page .directory-nav a, .landlord-dashboard-page .directory-nav a") && styles.includes(".notifications-page .directory-nav a") && styles.includes(".workspace-role-nav[hidden]"), "Mobile navigation can hide the Updates or workspace return action.");
assert(packageFile.includes("tests/notification-inbox-ui.mjs"), "Notification inbox verification is not part of the project gate.");

console.log("Notification inbox UI tests passed: private role return, safe event copy, pagination, read controls, mobile states and booking actions.");
