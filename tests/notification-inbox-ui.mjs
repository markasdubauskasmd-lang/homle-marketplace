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
assert(notificationActionPath("payment-action-required", bookingId) === "/landlord/dashboard", "Payment readiness does not open the private Landlord workspace.");
assert(notificationActionPath("payment-window-opened", bookingId) === "/landlord/dashboard", "Payment opening does not open the private Landlord workspace.");
assert(notificationActionPath("booking-confirmed", bookingId) === `/bookings/${bookingId}` && notificationActionPath("new-booking-request", "../admin") === null, "Active updates lost their private booking action or a malformed notification created a dashboard link.");
assert(notificationWorkspacePath({ selectedRole: "landlord", roles: ["landlord"] }) === "/landlord/dashboard", "Landlords do not return to their workspace.");
assert(notificationWorkspacePath({ selectedRole: "cleaner", roles: ["cleaner"] }) === "/cleaner/dashboard", "Cleaners do not return to their workspace.");
assert(notificationWorkspacePath({ selectedRole: "cleaner", roles: ["landlord"] }) === "/login", "A role mismatch does not fail closed.");
assert(notificationWorkspace({ selectedRole: "landlord", roles: ["landlord"] }).label === "Landlord" && notificationWorkspace({ selectedRole: "cleaner", roles: ["cleaner"] }).label === "Cleaner", "The inbox cannot present the active role as a distinct workspace.");
assert(notificationUnreadBadge(3).visible && notificationUnreadBadge(3).label === "3" && notificationUnreadBadge(100).label === "99+", "Unread counts are not presented compactly.");
assert(!notificationUnreadBadge(0).visible && !notificationUnreadBadge(-1).visible && !notificationUnreadBadge("not-a-count").visible, "Invalid or empty unread counts create a badge.");

const [page, script, shell, shellModel, cleanerPage, cleanerScript, cleanerStyles, accountMenu, badgeScript, landlordBadgeScript, model, styles, workspaceStyles, landlordStyles, server, cleanerDashboard, cleanerDashboardScript, landlordDashboard, landlordDashboardScript, packageFile] = await Promise.all([
  readFile(new URL("../public/notifications.html", import.meta.url), "utf8"),
  readFile(new URL("../public/notifications.js", import.meta.url), "utf8"),
  readFile(new URL("../public/workspace-shell.js", import.meta.url), "utf8"),
  readFile(new URL("../public/workspace-shell-model.js", import.meta.url), "utf8"),
  readFile(new URL("../public/cleaner-notifications.html", import.meta.url), "utf8"),
  readFile(new URL("../public/cleaner-notifications.js", import.meta.url), "utf8"),
  readFile(new URL("../public/homle-cleaner.css", import.meta.url), "utf8"),
  readFile(new URL("../public/account-menu.js", import.meta.url), "utf8"),
  readFile(new URL("../public/notification-badge.js", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-notification-badge.js", import.meta.url), "utf8"),
  readFile(new URL("../public/notification-inbox-model.js", import.meta.url), "utf8"),
  readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../public/homle-workspace.css", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-dashboard.css", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8"),
  readFile(new URL("../public/cleaner-dashboard.html", import.meta.url), "utf8"),
  readFile(new URL("../public/cleaner-dashboard.js", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-dashboard.html", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-dashboard.js", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8")
]);

for (const selectedCopy of ["Updates", "Mark all read", "You are all caught up.", "Load earlier updates"]) assert(page.includes(selectedCopy), `The inbox omitted ${selectedCopy}.`);
assert(page.includes('role="status"') && page.includes('aria-live="polite"') && page.includes('data-notification-retry'), "The inbox lacks accessible loading, retry or update states.");
// The page used to carry BOTH navigations as static markup and pick one at
// runtime — except the Cleaner branch was unreachable, because load() redirects
// a Cleaner to /cleaner/notifications before the picking function ever runs. It
// now renders one shell, from the account, in workspace-shell.js.
assert(page.includes("homle-workspace") && page.includes("homle-workspace.css") && page.includes("data-workspace-main"), "Updates left the shared workspace shell, which is how it became a standalone page with its own header the last time.");
assert(!page.includes("site-header") && !page.includes("account-footer") && !page.includes("directory-nav"), "Updates has grown its own header, footer or navigation again instead of using the shared shell.");
assert(shell.includes("workspaceShell(account") && shell.includes("dataset.accountMenu") && shell.includes("dataset.accountAvatar") && shell.includes("dataset.accountSignOut"), "The shared shell no longer builds the account control from the signed-in account.");
// Its sign-out button is created after account-menu.js has already collected
// the buttons it binds, so the shell has to bind its own or the control does
// nothing at all.
assert(shell.includes("bindAccountSignOut") && accountMenu.includes("export function bindAccountSignOut"), "The rendered shell's Sign out button is not bound, so it would be a control that does nothing.");
assert(shellModel.includes('roles.includes(selected)'), "The shell decides a workspace role without checking the account is entitled to it, which is how a page can offer a workspace that then refuses the visitor.");
assert(script.includes('/api/marketplace/notifications?') && script.includes('/api/marketplace/notifications/read-all') && script.includes('/read`'), "The inbox is not connected to list and read APIs.");
assert(script.includes("renderWorkspaceShell(") && script.includes('shell?.shell.role === "cleaner"') && script.includes('location.replace("/cleaner/notifications")'), "The Updates page does not restore the exact signed-in workspace, or no longer sends a Cleaner to their own inbox.");
// The empty state used to default its action to /login and only rewrite it once
// an account resolved, so a signed-in Landlord with a quiet inbox was offered
// sign-in as the page's primary action.
assert(script.includes("emptyLink.href = shell.shell.home") && !/data-empty-workspace-link[^>]*>\s*(Sign in|Return to workspace)/.test(page) && !/href="\/login[^"]*"[^>]*data-empty-workspace-link/.test(page), "The empty state can offer sign-in to an account that is already signed in.");
// Grouping, tone and a readable timestamp are what make the list scannable.
assert(script.includes("notificationGroups(") && script.includes("notificationTone(") && script.includes("RelativeTimeFormat"), "The inbox lost day grouping, per-event tone or its relative timestamps and is back to an undifferentiated list.");
assert(model.includes("export function notificationTone") && model.includes("export function notificationGroups"), "The shared inbox model no longer supplies tone or grouping, so the Cleaner inbox cannot reuse them.");
// Tone is chosen from the event type alone. Deriving it from the payload would
// let stored text decide how an update presents itself.
assert(!/notificationTone\([^)]*payload/.test(script), "Notification tone is being derived from payload data rather than the event type.");
assert(accountMenu.includes("export function readSignedInAccount()") && accountMenu.includes("signedInAccountRequest = null") && accountMenu.includes('requestJson("/api/marketplace/account"'), "Shared account hydration cannot recover after a temporary account-read failure.");
assert(script.includes('"X-CSRF-Token"') && script.includes("keepalive: true"), "Read mutations lost session, CSRF or navigation-safe delivery.");
assert(script.includes("replaceChildren") && script.includes("textContent") && !script.includes("innerHTML"), "Notification content is not rendered with safe DOM operations.");
assert(script.includes("inboxCutoff") && script.includes("cutoffCreatedAt"), "Mark-all-read is not protected by a race-safe cutoff.");
assert(model.includes("No price changes automatically") && model.includes("private message") && model.includes("Private booking case opened") && !model.includes("address"), "Public update copy leaks details or omits the private booking-case state.");
assert(server.includes('"/notifications": "notifications.html"') && cleanerDashboard.includes('href="/notifications"'), "The private inbox is not reachable from the Cleaner workspace.");
assert(server.includes('"/cleaner/notifications": "cleaner-notifications.html"') && cleanerPage.includes('href="/cleaner/notifications"') && cleanerPage.includes('aria-current="page"'), "The replacement Cleaner Notifications page is not routed or selected in the Account navigation.");
assert(cleanerPage.includes("Notifications") && cleanerPage.includes("Recent") && cleanerPage.includes("Channels") && cleanerPage.includes("Push notification settings") && cleanerPage.includes("Mark all as read"), "The supplied Cleaner Notifications layout is incomplete.");
assert(cleanerScript.includes('createCleanerPage("cleaner-notifications"') && cleanerScript.includes('/api/marketplace/notifications?') && cleanerScript.includes('/api/marketplace/notifications/read-all') && cleanerScript.includes("inboxCutoff") && cleanerScript.includes("cutoffCreatedAt") && cleanerScript.includes("notificationPresentation(item.eventType)"), "The replacement Cleaner Notifications centre is not connected to the private inbox or its race-safe read controls.");
assert(cleanerScript.includes('"X-CSRF-Token"') && cleanerScript.includes("keepalive: true") && cleanerScript.includes("account.email") && cleanerScript.includes("replaceChildren") && !cleanerScript.includes("innerHTML") && !cleanerScript.includes("localStorage"), "The Cleaner Notifications centre lost secure mutations, real account hydration or safe rendering.");
assert(cleanerStyles.includes(".hc-notifications-grid") && cleanerStyles.includes(".hc-notification-row.is-unread") && cleanerStyles.includes(".hc-channel-switch") && cleanerStyles.includes(".hc-notification-push-empty"), "The supplied Cleaner Notifications grid, unread state, channel controls or push settings state is not styled.");
assert(cleanerDashboard.includes("data-notification-link") && cleanerDashboard.includes("data-notification-count") && cleanerDashboard.includes("notification-badge.js"), "Unread updates are not visible from the Cleaner dashboard.");
for (const [workspace, dashboard] of [["Cleaner", cleanerDashboard], ["Landlord", landlordDashboard]]) {
  for (const hook of ['href="/notifications"', "data-notification-link", "data-notification-count", "notification-badge.js"]) {
    assert(dashboard.includes(hook), `${workspace} accounts cannot open the private notification inbox or see its unread count (${hook} is missing).`);
  }
}
assert(landlordDashboard.includes(">Bookings</span>") && !landlordDashboard.includes(">Updates</span>"), "Adding Landlord notifications changed the approved primary navigation instead of keeping Bookings there.");
assert(landlordDashboard.includes('class="landlord-notification-link"') && landlordDashboard.includes("<span>Notifications</span>"), "Landlord notifications are not a compact secondary account action beside the signed-in profile.");
assert(/data-notification-link[^>]*hidden/.test(landlordDashboard) && landlordDashboardScript.includes("notificationLink.hidden = true") && landlordDashboardScript.includes("notificationLink.hidden = false"), "The Landlord notification shortcut appears before the private Landlord workspace is authenticated or never appears after access succeeds.");
assert(landlordStyles.includes(".landlord-notification-link") && landlordStyles.includes("order: 1") && landlordStyles.includes("width: 44px") && landlordStyles.includes(".landlord-notification-link > span:not([data-notification-count])") && landlordStyles.includes(".site-header .account-menu { order: 2"), "The secondary Landlord notification action does not remain a compact bell beside the account picture on a phone.");
assert(badgeScript.includes('/api/marketplace/notifications?limit=1') && badgeScript.includes('credentials: "same-origin"') && badgeScript.includes('cache: "no-store"') && badgeScript.includes("event.persisted") && badgeScript.includes('document.visibilityState === "visible"'), "The dashboard badge is not private, bounded or refreshed after returning to the page.");
assert(badgeScript.includes('link.dataset.notificationLabel || "Notifications"') && badgeScript.includes("`${label}, ${badge.count} unread`"), "The shared unread indicator cannot distinguish Messages from Notifications for assistive technology.");
assert(badgeScript.includes('new EventSource("/api/marketplace/notifications/events"') && badgeScript.includes('"notification-updated"') && badgeScript.includes('"homle:notification-updated"') && cleanerDashboardScript.includes('window.addEventListener("homle:notification-updated"') && cleanerDashboardScript.includes("void loadDashboard()"), "A newly dispatched Cleaner invitation cannot refresh the open Cleaner dashboard through the private account stream.");
assert(cleanerDashboard.includes("/notification-badge.js?v=20260729-1") && landlordDashboard.includes("/landlord-notification-badge.js?v=20260821-3"), "A dashboard can keep an older notification badge after its latest real-time or account-label behavior ships.");
assert(badgeScript.includes("textContent") && !badgeScript.includes("innerHTML") && !badgeScript.includes("setInterval"), "The dashboard badge uses unsafe rendering or constant polling.");
assert(landlordBadgeScript.includes('method: "POST"') && landlordBadgeScript.includes('"X-CSRF-Token": csrf') && landlordBadgeScript.includes("response.body.getReader()") && landlordBadgeScript.includes("parseEventBlock") && !landlordBadgeScript.includes("new EventSource"), "The Landlord badge still relies on an Origin-less native EventSource instead of the CSRF-protected streaming request.");
assert(landlordBadgeScript.includes("closeStream()") && landlordBadgeScript.includes("lastResponseStatus !== 401") && landlordBadgeScript.includes("lastResponseStatus !== 403") && landlordBadgeScript.includes("Math.min(60_000") && landlordBadgeScript.includes('addEventListener("offline", stop)') && landlordBadgeScript.includes('addEventListener("pagehide", stop)'), "A failed or expired Landlord notification stream can keep retrying a private endpoint indefinitely, or survives offline/page exit.");
assert(landlordDashboardScript.includes('new Event("homle:landlord-session-ready")') && landlordBadgeScript.includes("function accessReady()") && landlordBadgeScript.includes('addEventListener("homle:landlord-session-ready"') && !landlordBadgeScript.includes("render(0);\nvoid start();"), "The Landlord badge can start its private read before the secure Landlord bootstrap authorises the session.");
assert(!landlordBadgeScript.includes("setInterval") && landlordBadgeScript.includes("textContent") && !landlordBadgeScript.includes("innerHTML"), "The Landlord notification badge uses constant polling or unsafe rendering.");
assert(styles.includes(".cleaner-workspace-page .directory-nav, .landlord-dashboard-page .directory-nav") && styles.includes(".cleaner-workspace-page .directory-nav a, .landlord-dashboard-page .directory-nav a") && styles.includes(".workspace-role-nav[hidden]"), "Mobile navigation can hide the Updates or workspace return action.");
// On a phone the shell replaces the sidebar with the tab bar. Without it the
// Updates page had no navigation at all below 900px — which is exactly what the
// standalone version shipped.
assert(workspaceStyles.includes(".hw-mobile-nav") && /@media \(max-width: 900px\)[\s\S]*\.hw-mobile-nav \{[\s\S]*position: fixed/.test(workspaceStyles), "The shared shell has no phone tab bar, so a workspace page below 900px would have no navigation.");
// The retired mint-green unread card cannot come back.
assert(!styles.includes("#eaf9f4") && !styles.includes(".notification-card-unread"), "The retired green notification card is back in styles.css, where it silently outranked the page's own styling last time.");
assert(packageFile.includes("tests/notification-inbox-ui.mjs"), "Notification inbox verification is not part of the project gate.");
assert(script.includes('new URLSearchParams(location.search).get("view") === "messages"') && script.includes('location.replace("/cleaner/messages")'), "The old Messages query-string destination does not forward to the dedicated Cleaner inbox.");
assert(script.includes('shell?.shell.role === "cleaner"') && script.includes('location.replace("/cleaner/notifications")'), "The old generic Updates destination does not forward Cleaner accounts to the replacement Notifications centre.");


console.log("Notification inbox UI tests passed: private role return, safe event copy, pagination, read controls, mobile states and booking actions.");
