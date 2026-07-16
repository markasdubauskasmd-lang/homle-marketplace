import { readFile } from "node:fs/promises";
import {
  activeBookingId,
  activeJobAction,
  activeJobRole,
  activeJobStage,
  elapsedLabel,
  progressSummary,
  taskCanBeDecided,
  taskCanBeUpdated
} from "../public/active-job-model.js";

function assert(condition, message) { if (!condition) throw new Error(message); }

const bookingId = "55555555-5555-4555-8555-555555555555";
assert(activeBookingId(`/bookings/${bookingId}`) === bookingId, "The canonical active-booking route did not recover its booking reference.");
assert(activeBookingId(`/bookings/${bookingId}/tracking`) === bookingId && activeBookingId(`/bookings/${bookingId}/cleaning-progress`) === bookingId, "Tracking or progress aliases lost the booking reference.");
assert(activeBookingId("/bookings/not-a-booking") === "", "An invalid booking reference was accepted by the active-job screen.");
assert(activeJobRole({ selectedRole: "cleaner", roles: ["cleaner", "landlord"] }) === "cleaner", "A multi-role account lost its selected Cleaner workspace.");
assert(activeJobRole({ selectedRole: "landlord", roles: ["landlord"] }) === "landlord" && activeJobRole({ roles: ["administrator"] }) === "", "Role selection exposed active bookings to an unsupported account.");
assert(activeJobStage("cleaner-en-route") < activeJobStage("cleaning-in-progress"), "Booking stage ordering is not monotonic.");

assert(activeJobAction("cleaner", { status: "confirmed" }, {}).kind === "start-journey", "A confirmed Cleaner did not receive Start journey.");
assert(activeJobAction("cleaner", { status: "cleaner-en-route", sharingState: "stopped" }, {}).kind === "resume-location", "A re-opened en-route job did not require deliberate location resumption.");
assert(activeJobAction("cleaner", { status: "cleaner-en-route", sharingState: "live" }, {}).kind === "arrive", "A live journey did not offer arrival.");
assert(activeJobAction("cleaner", { status: "cleaner-arrived" }, {}).kind === "start-cleaning", "An arrived Cleaner did not receive Start cleaning.");
assert(activeJobAction("cleaner", {}, { status: "cleaning-in-progress", totalTasks: 3, resolvedTasks: 2 }).enabled === false, "A Cleaner could finish with an unresolved checklist.");
assert(activeJobAction("cleaner", {}, { status: "cleaning-in-progress", totalTasks: 3, resolvedTasks: 3 }).kind === "finish-cleaning", "A resolved checklist did not offer Finish cleaning.");
assert(activeJobAction("landlord", { status: "cleaner-en-route" }, {}).enabled === false, "A Landlord received a Cleaner lifecycle mutation.");
assert(taskCanBeUpdated("cleaner", "cleaning-in-progress") && !taskCanBeUpdated("landlord", "cleaning-in-progress"), "Cleaning task ownership is not role-safe.");
assert(taskCanBeDecided("landlord", { unexpected: true, landlordApprovalStatus: "pending" }) && !taskCanBeDecided("cleaner", { unexpected: true, landlordApprovalStatus: "pending" }), "Unexpected-task decisions are not Landlord-only.");
assert(progressSummary({ totalTasks: 4, completedTasks: 2, resolvedTasks: 3, overallPercentage: 75 }).unresolved === 1, "Progress summary lost unresolved work.");
assert(elapsedLabel(7_500) === "2h 5m", "Elapsed cleaning time was formatted incorrectly.");

const [html, script, styles, server, packageFile] = await Promise.all([
  readFile(new URL("../public/active-job.html", import.meta.url), "utf8"),
  readFile(new URL("../public/active-job.js", import.meta.url), "utf8"),
  readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8")
]);

for (const copy of ["Start journey", "I have arrived", "Start cleaning", "Finish cleaning", "Private live journey", "Live room checklist", "Booking participants only"]) assert(html.includes(copy), `The active-job interface omitted ${copy}.`);
assert(html.includes("data-task-list") && html.includes("data-pause-dialog") && html.includes("data-task-dialog") && html.includes("role=\"progressbar\""), "The active-job interface omitted task, pause, unexpected-work or accessible progress controls.");
assert(!/sample cleaner|preview state|stylised map preview/i.test(html), "The authenticated screen could be mistaken for the design preview.");
for (const source of ["/tracking", "/cleaning-progress", "/property", "/events", "/journey/start", "/journey/location", "/journey/arrive", "/cleaning-progress/start", "/cleaning-progress/pause", "/cleaning-progress/finish", "/decision"]) assert(script.includes(source), `The active-job controller omitted the secured ${source} interface.`);
assert(script.includes("navigator.geolocation.getCurrentPosition") && script.includes("navigator.geolocation.watchPosition") && script.includes("navigator.geolocation.clearWatch"), "Foreground location consent, updates or automatic browser cleanup are missing.");
assert(script.includes("new EventSource") && script.includes('addEventListener("booking-snapshot"') && script.includes("pagehide"), "Durable live events or page cleanup are missing.");
assert(script.includes('"X-CSRF-Token"') && script.includes("credentials: \"same-origin\"") && !script.includes("innerHTML"), "Active-job mutations lost CSRF/session protection or introduced unsafe HTML rendering.");
assert(!/(google|mapbox|openstreetmap|leaflet)/i.test(`${html}\n${script}`), "The private current location could leak to an unapproved external map provider.");
assert(server.includes('activeJobPage') && server.includes('geolocation=(self)') && server.includes('activeJobRoute ? "active-job.html"'), "Canonical booking routes or their scoped geolocation policy are missing.");
assert(styles.includes(".active-primary-action") && styles.includes("@media (max-width: 680px)") && styles.includes("prefers-reduced-motion"), "The active-job experience omitted one-hand mobile or reduced-motion styling.");
assert(packageFile.includes("tests/active-job-ui.mjs"), "The active-job checks are not included in the project gate.");

console.log("Active-job UI tests passed: canonical participant route, role-safe journey/task actions, explicit foreground location, durable live snapshots, mobile controls and privacy-first map boundary.");
