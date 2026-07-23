import { readFile } from "node:fs/promises";
import {
  activeBookingId,
  activeJobAction,
  activeJobMessagingOpen,
  activeJobRole,
  activeJobStage,
  bookingReviewPayload,
  bookingReviewView,
  bookingDisputePayload,
  bookingDisputeView,
  cleanerReviewResponse,
  createClientMessageId,
  elapsedLabel,
  jobPhotoFileCheck,
  jobPhotoMimeType,
  jobPhotoSha256,
  jobPhotoUploadAllowed,
  mergeBookingMessages,
  progressSummary,
  taskCanBeDecided,
  taskCanBeQuickCompleted,
  taskNeedsCleanerTermsConfirmation,
  taskCanBeUpdated,
  journeyProgress,
  journeyDistanceLabel
} from "../public/active-job-model.js";

function assert(condition, message) { if (!condition) throw new Error(message); }

const bookingId = "55555555-5555-4555-8555-555555555555";
assert(activeBookingId(`/bookings/${bookingId}`) === bookingId, "The canonical active-booking route did not recover its booking reference.");
assert(activeBookingId(`/bookings/${bookingId}/tracking`) === bookingId && activeBookingId(`/bookings/${bookingId}/cleaning-progress`) === bookingId, "Tracking or progress aliases lost the booking reference.");
assert(activeBookingId("/bookings/not-a-booking") === "", "An invalid booking reference was accepted by the active-job screen.");
assert(activeJobRole({ selectedRole: "cleaner", roles: ["cleaner", "landlord"] }) === "cleaner", "A multi-role account lost its selected Cleaner workspace.");
assert(activeJobRole({ selectedRole: "landlord", roles: ["landlord"] }) === "landlord" && activeJobRole({ roles: ["administrator"] }) === "", "Role selection exposed active bookings to an unsupported account.");
assert(activeJobStage("cleaner-en-route") < activeJobStage("cleaning-in-progress"), "Booking stage ordering is not monotonic.");

assert(activeJobAction("cleaner", { status: "confirmed" }, {}).kind === "journey-readiness" && activeJobAction("cleaner", { status: "confirmed" }, {}).enabled, "A confirmed Cleaner cannot safely retry a failed authorization check.");
assert(activeJobAction("cleaner", { status: "confirmed" }, {}, { checked: true, canStartJourney: false }).kind === "waiting-authorization" && activeJobAction("cleaner", { status: "confirmed" }, {}, { checked: true, canStartJourney: false }).enabled, "An unpaid confirmed booking did not offer a non-location authorization recheck.");
assert(activeJobAction("cleaner", { status: "confirmed" }, {}, { checked: true, canStartJourney: true }).kind === "start-journey", "A ready confirmed Cleaner did not receive Start journey.");
assert(activeJobAction("cleaner", { status: "cleaner-en-route", sharingState: "stopped" }, {}).kind === "resume-location", "A re-opened en-route job did not require deliberate location resumption.");
assert(activeJobAction("cleaner", { status: "cleaner-en-route", sharingState: "live" }, {}).kind === "arrive", "A live journey did not offer arrival.");
assert(activeJobAction("cleaner", { status: "cleaner-arrived" }, {}).kind === "start-cleaning", "An arrived Cleaner did not receive Start cleaning.");
assert(activeJobAction("cleaner", {}, { status: "cleaning-in-progress", totalTasks: 3, resolvedTasks: 2 }).enabled === false, "A Cleaner could finish with an unresolved checklist.");
assert(activeJobAction("cleaner", {}, { status: "cleaning-in-progress", totalTasks: 3, resolvedTasks: 3 }).kind === "finish-cleaning", "A resolved checklist did not offer Finish cleaning.");
assert(activeJobAction("landlord", { status: "cleaner-en-route" }, {}).enabled === false, "A Landlord received a Cleaner lifecycle mutation.");
assert(taskCanBeUpdated("cleaner", "cleaning-in-progress") && !taskCanBeUpdated("landlord", "cleaning-in-progress"), "Cleaning task ownership is not role-safe.");
assert(taskCanBeQuickCompleted("cleaner", "cleaning-in-progress", { status: "not-started", unexpected: false }) && !taskCanBeQuickCompleted("cleaner", "cleaning-in-progress", { status: "completed", unexpected: false }) && !taskCanBeQuickCompleted("cleaner", "cleaning-in-progress", { status: "not-started", unexpected: true, landlordApprovalStatus: "pending" }) && taskCanBeQuickCompleted("cleaner", "cleaning-in-progress", { status: "not-started", unexpected: true, landlordApprovalStatus: "approved" }), "One-tap completion is not limited to eligible unresolved Cleaner tasks.");
assert(taskCanBeDecided("landlord", { unexpected: true, cleanerFrozenTermsConfirmed: true, landlordApprovalStatus: "pending" }) && !taskCanBeDecided("landlord", { unexpected: true, cleanerFrozenTermsConfirmed: false, landlordApprovalStatus: "pending" }) && !taskCanBeDecided("cleaner", { unexpected: true, cleanerFrozenTermsConfirmed: true, landlordApprovalStatus: "pending" }), "Unexpected-task decisions are not Landlord-only or became available before explicit Cleaner terms confirmation.");
assert(taskNeedsCleanerTermsConfirmation("cleaner", "cleaning-in-progress", { unexpected: true, cleanerFrozenTermsConfirmed: false, landlordApprovalStatus: "pending" }) && !taskNeedsCleanerTermsConfirmation("landlord", "cleaning-in-progress", { unexpected: true, cleanerFrozenTermsConfirmed: false, landlordApprovalStatus: "pending" }), "Legacy unexpected work cannot be explicitly reconciled by its Cleaner.");
assert(activeJobMessagingOpen("confirmed") && activeJobMessagingOpen("completed") && !activeJobMessagingOpen("cancelled"), "Booking chat did not follow the server-owned messaging lifecycle.");
assert(bookingDisputeView("confirmed").canOpen && bookingDisputeView("disputed", { status: "open" }).visible && !bookingDisputeView("cancelled").visible, "Booking-case visibility did not follow the participant lifecycle.");
const disputePayload = bookingDisputePayload({ requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", category: "damage", description: "  A kitchen cabinet door was damaged during the visit.  ", confirmed: true });
assert(disputePayload.category === "damage" && disputePayload.description === "A kitchen cabinet door was damaged during the visit.", "Booking-case input was not normalized into a bounded private report.");
for (const invalid of [{ requestId: "bad", category: "damage", description: disputePayload.description, confirmed: true }, { requestId: disputePayload.requestId, category: "invented", description: disputePayload.description, confirmed: true }, { requestId: disputePayload.requestId, category: "damage", description: "Too short", confirmed: true }, { ...disputePayload, confirmed: false }]) {
  let rejected = false; try { bookingDisputePayload(invalid); } catch { rejected = true; }
  assert(rejected, "Invalid or unconfirmed booking-case input passed the browser boundary.");
}
const approvedReview = { rating: 5, moderationStatus: "approved", writtenReview: "Excellent clean." };
assert(bookingReviewView("landlord", "awaiting-review").mode === "confirm-completion" && bookingReviewView("landlord", "completed").mode === "submit-review", "The Landlord could not confirm finished work before submitting a completed-booking review.");
assert(bookingReviewView("cleaner", "completed", approvedReview).mode === "respond" && bookingReviewView("cleaner", "completed", { ...approvedReview, cleanerResponse: "Thank you." }).mode === "responded", "The Cleaner approved-review response lifecycle is not final and role-safe.");
assert(bookingReviewView("cleaner", "completed").mode === "review-unavailable" && !bookingReviewView("landlord", "cleaning-in-progress").visible, "The UI exposed a pending/unsubmitted review or allowed an early review.");
const reviewPayload = bookingReviewPayload({ rating: "5", qualityRating: "4", writtenReview: "  Careful and professional.  " });
assert(reviewPayload.rating === 5 && reviewPayload.qualityRating === 4 && reviewPayload.punctualityRating === null && reviewPayload.writtenReview === "Careful and professional.", "Review input did not normalize bounded required and optional scores.");
assert(cleanerReviewResponse("  Thank you for the feedback.  ") === "Thank you for the feedback.", "Cleaner review response was not normalized.");
for (const invalid of [{ rating: "" }, { rating: 0 }, { rating: 6 }, { rating: 5, qualityRating: 2.5 }, { rating: 5, writtenReview: "x".repeat(3001) }]) {
  let rejected = false;
  try { bookingReviewPayload(invalid); } catch { rejected = true; }
  assert(rejected, "Invalid review input passed the browser boundary.");
}
const messageA = { messageId: "88888888-8888-4888-8888-888888888888", senderRole: "cleaner", body: "I have arrived at reception.", createdAt: "2026-07-16T10:01:00.000Z", senderUserId: "private" };
const messageB = { messageId: "99999999-9999-4999-8999-999999999999", senderRole: "landlord", body: "Thank you. Please start upstairs.", createdAt: "2026-07-16T10:02:00.000Z" };
const mergedMessages = mergeBookingMessages([messageB], [messageA, messageB, { messageId: "bad", senderRole: "landlord", body: "Invalid", createdAt: messageA.createdAt }]);
assert(mergedMessages.length === 2 && mergedMessages[0].messageId === messageA.messageId && !Object.hasOwn(mergedMessages[0], "senderUserId"), "Live chat merging lost chronological deduplication or retained a private account identifier.");
const fallbackId = createClientMessageId({ getRandomValues(bytes) { bytes.fill(7); return bytes; } });
assert(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(fallbackId), "The browser message retry key was not a secure UUID shape.");
const photoFile = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/jpeg" });
assert(jobPhotoFileCheck(photoFile).ok && jobPhotoMimeType({ name: "evidence.heif", type: "" }) === "image/heic", "Supported mobile job-photo formats were not normalized safely.");
assert(!jobPhotoFileCheck(new Blob([], { type: "image/jpeg" })).ok && !jobPhotoFileCheck({ size: 1, type: "image/gif", arrayBuffer() {} }).ok, "Empty or unsupported job-photo input passed browser validation.");
assert(jobPhotoUploadAllowed("cleaner", "cleaner-arrived", "before") && jobPhotoUploadAllowed("cleaner", "awaiting-review", "after") && !jobPhotoUploadAllowed("cleaner", "awaiting-review", "before") && !jobPhotoUploadAllowed("landlord", "cleaning-in-progress", "after"), "Photo controls did not follow the Cleaner-only server lifecycle.");
const photoHash = await jobPhotoSha256(photoFile);
assert(/^[0-9a-f]{64}$/.test(photoHash) && photoHash === await jobPhotoSha256(photoFile), "Browser photo hashing was not deterministic SHA-256 evidence.");
assert(progressSummary({ totalTasks: 4, completedTasks: 2, resolvedTasks: 3, overallPercentage: 75 }).unresolved === 1, "Progress summary lost unresolved work.");
assert(elapsedLabel(7_500) === "2h 5m", "Elapsed cleaning time was formatted incorrectly.");

const [html, script, styles, server, config, packageFile] = await Promise.all([
  readFile(new URL("../public/active-job.html", import.meta.url), "utf8"),
  readFile(new URL("../public/active-job.js", import.meta.url), "utf8"),
  readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/marketplace/config.mjs", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8")
]);

for (const copy of ["Start journey", "I have arrived", "Start cleaning", "Finish cleaning", "Private live journey", "Live room checklist", "Booking participants only", "Private booking chat", "No personal contact details", "Send privately", "Private cleaning evidence", "Take a job photo", "Choose existing photo", "Before cleaning", "After cleaning", "Issue or damage", "Verified booking review", "Confirm job complete", "Submit verified review", "Publish response", "Only one review is allowed", "Private help and safety", "Open a Homle case", "Open private case", "Administrator resolution"]) assert(html.includes(copy), `The active-job interface omitted ${copy}.`);
assert(html.includes("data-task-list") && html.includes("data-pause-dialog") && html.includes("data-task-dialog") && html.includes("role=\"progressbar\"") && html.includes("role=\"log\"") && html.includes("maxlength=\"2000\"") && html.includes('capture="environment"') && html.includes("data-photo-viewer-image"), "The active-job interface omitted task, pause, unexpected-work, accessible progress, bounded chat, rear-camera capture or private photo viewing controls.");
assert(html.includes("remaining booked time") && html.includes("my agreed pay") && html.includes('name="withinBookedTermsConfirmed"') && script.includes("terms-confirmation") && script.includes("Not approved work"), "Unexpected work can be presented as approved without explicit Cleaner consent to the remaining-time and frozen-pay boundary.");
assert(script.includes('complete.textContent = "Mark task complete"') && script.includes("function taskControls(task)") && script.includes("More options or add note") && script.includes('saveTaskUpdate(task, "completed"') && script.includes('complete.dataset.pendingLabel = "Saving task…"') && script.includes("complete.setAttribute(\"aria-label\"") && styles.includes(".active-task-complete"), "The Cleaner cannot complete an eligible checklist task in one accessible mobile tap with a loading state while retaining detailed status/note controls.");
assert(!/sample cleaner|preview state|stylised map preview/i.test(html), "The authenticated screen could be mistaken for the design preview.");
for (const source of ["/tracking", "/cleaning-progress", "/property", "/events", "/messages", "/photos/intents", "/complete", "/access", "/journey/readiness", "/journey/start", "/journey/location", "/journey/arrive", "/cleaning-progress/start", "/cleaning-progress/pause", "/cleaning-progress/finish", "/decision", "/completion", "/reviews", "/reviews/response", "/dispute"]) assert(script.includes(source), `The active-job controller omitted the secured ${source} interface.`);
assert(html.includes("/active-job.js?v=20260723-4") && script.includes("./active-job-model.js?v=20260723-2") && script.includes('action === "journey-readiness" || action === "waiting-authorization"') && script.includes("No location permission was requested") && script.includes("await refreshJourneyReadiness({ required: true })") && script.indexOf('action === "journey-readiness" || action === "waiting-authorization"') < script.indexOf('action === "start-journey" || action === "resume-location"'), "The confirmed Cleaner cannot safely recheck authorization without first granting location or can see a stale Start journey action.");
assert(script.includes("navigator.geolocation.getCurrentPosition") && script.includes("navigator.geolocation.watchPosition") && script.includes("navigator.geolocation.clearWatch"), "Foreground location consent, updates or automatic browser cleanup are missing.");
assert(script.includes("new EventSource") && script.includes('addEventListener("booking-snapshot"') && script.includes("pagehide"), "Durable live events or page cleanup are missing.");
assert(script.includes("state.dispute || currentStatus() === \"disputed\"") && !script.includes('["completed", "cancelled", "disputed"].includes(snapshot.status)'), "An open case stopped live resolution updates or failed to refresh its private outcome.");
assert(script.includes("clientMessageId") && script.includes("state.messageRetry") && script.includes("applyMessagePage(snapshot.messages") && script.includes("Load earlier messages"), "Private chat lost retry-safe sends, live delivery or stable history pagination.");
assert(script.includes("jobPhotoSha256") && script.includes("requiredHeaders") && script.includes('headers["X-Amz-Meta-Tideway-Sha256"] !== expected.checksumSha256') && script.includes('headers["X-Amz-Server-Side-Encryption"] !== "AES256"') && script.includes('credentials: "omit"') && script.includes('redirect: "error"') && script.includes('referrerPolicy: "no-referrer"') && script.includes("URL.revokeObjectURL") && script.includes("state.photoRetry"), "Private photo capture lost local checksum verification, exact signed headers, credential/referrer isolation, preview cleanup or retry state.");
assert(script.includes('"X-CSRF-Token"') && script.includes("credentials: \"same-origin\"") && !script.includes("innerHTML"), "Active-job mutations lost CSRF/session protection or introduced unsafe HTML rendering.");
assert(!/(google|mapbox|openstreetmap|leaflet)/i.test(`${html}\n${script}`), "The private current location could leak to an unapproved external map provider.");
assert(server.includes('activeJobPage') && server.includes('camera=(self), microphone=(), geolocation=(self)') && server.includes("activeJobStorage") && server.includes("objectStorageOrigins") && server.includes("OBJECT_STORAGE_FORCE_PATH_STYLE") && server.includes('activeJobRoute ? "active-job.html"'), "Canonical booking routes or their narrowly scoped camera/geolocation/private-storage policy are missing.");
assert(config.includes("OBJECT_STORAGE_ENDPOINT must be an exact HTTPS origin") && server.includes("connect-src 'self'${activeJobStorage}") && server.includes("img-src 'self' data: blob:${activeJobStorage}"), "The active-job storage allowlist could accept an unvalidated or wildcard origin.");
assert(styles.includes(".active-primary-action") && styles.includes(".active-message-list") && styles.includes(".active-photo-list") && styles.includes(".active-photo-viewer") && styles.includes(".active-review-stars") && styles.includes(".active-review-response-form") && styles.includes(".active-dispute-form") && styles.includes(".active-dispute-summary") && styles.includes("@media (max-width: 680px)") && styles.includes("prefers-reduced-motion"), "The active-job experience omitted one-hand mobile chat/photo/review/case controls or reduced-motion styling.");
assert(html.includes("data-review-workspace") && script.includes('"/cleaner/dashboard#jobs"') && script.includes('"/landlord/dashboard#landlord-bookings"') && script.includes('"Return to Cleaner jobs"') && script.includes('"Return to Landlord bookings"') && styles.includes(".active-review-workspace"), "A completed verified-review flow can strand either participant without a role-specific mobile return action.");
assert(html.includes("data-connection-refresh") && html.includes("Refresh booking") && script.includes("async function refreshParticipantSnapshot") && script.includes("async function refreshBooking") && script.includes("await refreshParticipantSnapshot({ quiet: true })") && script.includes("No booking action, payment or location update was sent") && script.includes('connectionRefresh.addEventListener("click", refreshBooking)') && styles.includes(".active-connection-card .button") && styles.includes("grid-column: 1 / -1"), "An interrupted live booking cannot be refreshed safely without repeating a booking, payment or location mutation.");
{
  const refreshStart = script.indexOf("async function refreshParticipantSnapshot");
  const refreshEnd = script.indexOf("async function load()", refreshStart);
  const refreshFlow = script.slice(refreshStart, refreshEnd);
  assert(refreshStart >= 0 && refreshEnd > refreshStart && !refreshFlow.includes("mutate(") && !refreshFlow.includes("geolocation") && !refreshFlow.includes("watchPosition"), "The manual booking refresh can mutate booking state or request location instead of remaining read-only.");
}
assert(packageFile.includes("tests/active-job-ui.mjs"), "The active-job checks are not included in the project gate.");

{
  const journeyNow = Date.parse("2026-07-20T12:00:00.000Z");
  const enRoute = (minutes) => ({ status: "cleaner-en-route", sharingState: "live", location: { estimatedArrivalAt: new Date(journeyNow + minutes * 60000).toISOString() } });
  const carry = (progress) => ({ baselineMinutes: progress.baselineMinutes, achievedPercent: progress.achievedPercent });
  const started = journeyProgress(enRoute(30), {}, journeyNow);
  const halfway = journeyProgress(enRoute(15), carry(started), journeyNow);
  assert(started.percent === 0 && started.baselineMinutes === 30 && halfway.percent === 0.5, "Journey approach progress is not derived proportionally from the remaining estimated arrival time.");

  // A journey that deteriorates after real progress must hold its position and
  // say so, never animate the Cleaner back down the road towards the start.
  const delayed = journeyProgress(enRoute(35), carry(halfway), journeyNow);
  assert(delayed.percent === halfway.percent && delayed.delayed === true && delayed.remainingMinutes === 35 && delayed.baselineMinutes === 35, "A journey that slowed after visible progress moved the Cleaner backwards instead of holding and reporting the delay.");
  assert(journeyDistanceLabel(delayed) === "About 35 min away — running later than expected", "A delayed journey did not tell the customer the truth about the longer wait.");
  assert(journeyProgress(enRoute(10), carry(delayed), journeyNow).percent > delayed.percent, "A recovering journey did not resume forward progress.");

  // Only a recorded arrival may place the Cleaner on the home. An elapsed
  // estimate must not imply the Cleaner is already at the door.
  const elapsedEstimate = journeyProgress(enRoute(0), carry(halfway), journeyNow);
  assert(elapsedEstimate.percent < 1 && elapsedEstimate.arrived === false && journeyProgress({ status: "cleaner-arrived" }, {}, journeyNow).percent === 1, "An elapsed estimate claimed arrival before the Cleaner actually arrived.");
  assert(journeyProgress({ status: "cleaning-in-progress" }, {}, journeyNow).arrived === true && journeyProgress({ status: "cleaner-en-route", sharingState: "off" }, {}, journeyNow).known === false && journeyProgress({ status: "cleaner-en-route", sharingState: "live", location: { estimatedArrivalAt: "not-a-date" } }, {}, journeyNow).known === false, "Arrived, sharing-off or unusable-estimate journeys did not fall back to a safe approach state.");
  assert(journeyDistanceLabel(halfway) === "About 15 min away" && journeyDistanceLabel(elapsedEstimate) === "Arriving now" && journeyDistanceLabel({ known: false }) === "Not available", "The approach readout did not describe remaining travel time safely.");

  assert(html.includes("data-journey-approach") && html.includes('data-journey-approach role="status" aria-live="polite"') && script.includes("function renderJourneyApproach(tracking)") && script.includes("--journey-progress") && script.includes("homle:journey-baseline:") && styles.includes("var(--journey-progress, 0)") && styles.includes("transition: none; animation: none;"), "The live approach indicator is not rendered from journey progress, is not announced to assistive technology, or ignores reduced-motion preferences.");
  // The estimate keeps counting down between snapshots, storage can be refused,
  // and a finished booking must not leave a breadcrumb behind.
  assert(script.includes("function scheduleJourneyTick(progress)") && script.includes("function stopJourneyTicks()") && script.includes("state.journeyMemory") && script.includes("function clearJourneyMemory()") && script.includes("localStorage.removeItem(journeyMemoryKey())") && script.includes('document.querySelector("[data-location-marker]").hidden = !progress.known || progress.arrived'), "The approach indicator does not re-derive on a timer, survive refused storage in memory, clear finished journeys, or withhold the marker when the Cleaner cannot be placed honestly.");
  assert(!script.includes("destinationLatitude") && !script.includes("mapbox") && !script.includes("leaflet") && html.includes("not a street map"), "The journey view started plotting a street position or depended on a third-party map provider.");
}

console.log("Active-job UI tests passed: canonical participant route, role-safe journey/task actions, explicit foreground location, durable live snapshots, private retry-safe chat, secure before/after evidence, verified completion/reviews, mobile controls and privacy-first map boundary.");
