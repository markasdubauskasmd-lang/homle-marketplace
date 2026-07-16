import { spawn } from "node:child_process";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { request as nodeHttpRequest } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checklistFromTranscript } from "../public/checklist.js";
import { clearBriefHandoff, readBriefHandoff, saveBriefHandoff } from "../public/brief-handoff.js";
import { briefReadiness, briefScopeConfirmationIsCurrent, briefScopeFingerprint, briefSourceFingerprint, maxBriefPhotos, maxBriefVideos, normaliseBriefRoom, roomSpeechMarker } from "../public/brief-readiness.js";
import { detectPriceSensitiveScope, normalisePriceSensitiveScopeSignals } from "../public/scope-signals.js";
import { isEmail, isPhone, isUkPostcode } from "../public/contact-validation.js";
import { decisionWasInTime, offerDeadline, offerIsOpen } from "../offer-expiry.mjs";
import { cleanerTravelCoverage, parseCleanerTravelAreas } from "../travel-coverage.mjs";
import { businessDateToday, businessEpochFromWallClock, businessTimeZone, businessWallClockMs, earliestBookableWallClockMs } from "../business-clock.mjs";
import { requestDateAttentionAction, requestDateAttentionDays, scanAttentionAction, scanAttentionHours } from "../lead-attention.mjs";
import { newSubmissionKey } from "../public/submission-key.js";
import "./request-followup-draft.mjs";
import "./spoken-scope.mjs";
import "./task-quality.mjs";
import "./cleaner-handoff-preview.mjs";
import "./checklist-change-review.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testDataDir = await mkdtemp(path.join(tmpdir(), "tideway-smoke-"));
const port = 4279;
const lanPort = 4280;
const base = `http://127.0.0.1:${port}`;
const lanBase = `http://127.0.0.1:${lanPort}`;
const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, init = {}) => {
  const headers = new Headers(init.headers);
  const target = new URL(String(input), base);
  if (target.origin === new URL(base).origin && !headers.has("origin")) headers.set("origin", base);
  return nativeFetch(input, { ...init, headers });
};
const child = spawn(process.execPath, ["server.mjs"], { cwd: root, env: { ...process.env, PORT: String(port), LAN_PORT: String(lanPort), LAN_HOST: "127.0.0.1", ADMIN_KEY: "test-admin-key", DATA_DIR: testDataDir }, stdio: "pipe" });

async function waitForServer() {
  for (let index = 0; index < 50; index += 1) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Server did not start.");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function rawLocalRequest(pathname, hostHeader) {
  return new Promise((resolve, reject) => {
    const request = nodeHttpRequest({ hostname: "127.0.0.1", port, path: pathname, method: "GET", headers: { Host: hostHeader } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
    request.end();
  });
}

function testWallClockSlot(offsetMinutes, durationHours = 4) {
  const start = new Date(businessWallClockMs() + offsetMinutes * 60 * 1000);
  const end = new Date(start.getTime() + durationHours * 60 * 60 * 1000);
  const date = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}-${String(start.getUTCDate()).padStart(2, "0")}`;
  const time = (value) => `${String(value.getUTCHours()).padStart(2, "0")}:${String(value.getUTCMinutes()).padStart(2, "0")}`;
  return { proposedDate: date, proposedStartTime: time(start), proposedEndTime: time(end) };
}

function reviewTimeBreakdown(brief, hours) {
  const areas = [...new Set((brief?.photos || []).map((photo) => String(photo.area || "").trim()).filter(Boolean))];
  const totalMinutes = Math.round(Number(hours) * 60);
  let remaining = totalMinutes;
  const rows = areas.map((area, index) => {
    const minutes = index === areas.length - 1 ? remaining : 5;
    remaining -= minutes;
    return { area, minutes };
  });
  return { version: 1, areas: rows, overheadMinutes: 0, totalMinutes, roundedHours: Math.ceil(totalMinutes / 15) / 4 };
}

async function rewriteTestBookingSchedule(bookingId, schedule) {
  const bookingPath = path.join(testDataDir, "bookings.ndjson");
  const records = (await readFile(bookingPath, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const booking = records.find((record) => record.id === bookingId);
  if (!booking) throw new Error("Test booking was not available for the job-day clock fixture.");
  Object.assign(booking, schedule);
  await writeFile(bookingPath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
}

async function rewriteTestRequestCreatedAt(requestId, createdAt) {
  const requestPath = path.join(testDataDir, "cleaning-requests.ndjson");
  const records = (await readFile(requestPath, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const customerRequest = records.find((record) => record.id === requestId);
  if (!customerRequest) throw new Error("Test request was not available for the stalled-scan fixture.");
  customerRequest.createdAt = createdAt;
  await writeFile(requestPath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
}

try {
  const attentionNow = Date.parse("2026-07-15T12:00:00.000Z");
  assert(scanAttentionHours === 24, "The internal scan-attention threshold changed unexpectedly.");
  assert(scanAttentionAction({ requestCreatedAt: "2026-07-14T12:00:01.000Z" }, attentionNow) === null, "A fresh room scan was escalated before the internal 24-hour attention threshold.");
  assert(scanAttentionAction({ requestCreatedAt: "2026-07-14T12:00:00.000Z" }, attentionNow)?.code === "scan-stalled", "A room scan pending for 24 hours was not escalated.");
  assert(scanAttentionAction({ requestCreatedAt: "invalid" }, attentionNow) === null, "An invalid request timestamp created a false stalled-scan action.");
  assert(scanAttentionAction({ latestBrief: { status: "reviewed", createdAt: "2026-07-13T12:00:00.000Z" } }, attentionNow) === null, "A reviewed room scan was incorrectly escalated as stalled.");
  assert(scanAttentionAction({ latestBrief: { status: "needs-revision", createdAt: "2026-07-14T12:00:00.000Z", reviewedAt: "2026-07-15T11:00:00.000Z" } }, attentionNow) === null, "A recent revision request used the older scan creation time and was escalated too early.");
  assert(scanAttentionAction({ latestBrief: { status: "needs-revision", createdAt: "2026-07-13T12:00:00.000Z", reviewedAt: "2026-07-14T12:00:00.000Z" } }, attentionNow)?.code === "scan-revision-stalled", "A revised room scan pending for 24 hours was not escalated.");
  assert(requestDateAttentionDays === 7, "The approaching-request-date threshold changed unexpectedly.");
  assert(requestDateAttentionAction({ preferredDate: "2026-07-23" }, attentionNow) === null, "A cleaning date more than seven London calendar days away was escalated.");
  assert(requestDateAttentionAction({ preferredDate: "2026-07-22" }, attentionNow)?.code === "requested-date-near" && requestDateAttentionAction({ preferredDate: "2026-07-22" }, attentionNow)?.dueDate === "2026-07-22", "A cleaning date exactly seven London calendar days away was not escalated with its sortable due date.");
  assert(requestDateAttentionAction({ preferredDate: "2026-07-16" }, attentionNow)?.title.includes("tomorrow"), "Tomorrow's requested cleaning date did not receive a clear schedule warning.");
  assert(requestDateAttentionAction({ preferredDate: "2026-07-14" }, attentionNow)?.code === "requested-date-passed", "A passed requested cleaning date was not surfaced for review.");
  assert(requestDateAttentionAction({ preferredDate: "2026-02-30" }, attentionNow) === null, "An invalid calendar date created a false schedule warning.");
  assert(businessTimeZone === "Europe/London", "The booking clock is not fixed to the Homle pilot timezone.");
  assert(businessDateToday("2026-07-14T23:30:00.000Z") === "2026-07-15", "The booking clock did not advance to the next London date during British Summer Time.");
  assert(businessWallClockMs("2026-07-15T09:07:00.000Z") === Date.UTC(2026, 6, 15, 10, 7), "The booking clock lost the summer-time offset.");
  assert(earliestBookableWallClockMs("2026-07-15T09:07:00.000Z") === Date.UTC(2026, 6, 15, 10, 30), "Same-day summer matching could suggest a London time that has already passed.");
  assert(businessEpochFromWallClock("2026-07-15", "10:00") === Date.parse("2026-07-15T09:00:00.000Z"), "A summer visit was not converted to its real offer-deadline instant.");
  assert(offerDeadline("2026-07-15T08:30:00.000Z", 24, businessEpochFromWallClock("2026-07-15", "10:00")) === "2026-07-15T09:00:00.000Z", "A summer offer deadline remained open after the real visit start.");
  assert(businessWallClockMs("2026-12-15T09:07:00.000Z") === Date.UTC(2026, 11, 15, 9, 7), "The booking clock incorrectly applied a summer offset during winter.");
  assert(businessEpochFromWallClock("2026-12-15", "10:00") === Date.parse("2026-12-15T10:00:00.000Z"), "A winter visit was not converted to its real offer-deadline instant.");
  assert(Number.isNaN(businessEpochFromWallClock("2026-03-29", "01:30")), "A nonexistent spring clock-change visit time was accepted.");

  await waitForServer();
  const pastManualProposal = await fetch(`${base}/api/admin/proposals`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: "REQ-CLOCK-TEST", cleanerId: "CLN-CLOCK-TEST", proposedDate: businessDateToday(), proposedStartTime: "00:00", estimatedHours: 2, customerRate: 30, cleanerRate: 18, otherCosts: 0 }) });
  const pastManualProposalBody = await pastManualProposal.json();
  assert(pastManualProposal.status === 422 && pastManualProposalBody.errors?.some((error) => error.includes("15 minutes") && error.includes("UK local time")), "A manually edited proposal could retain a same-day start that had already passed.");
  const lanPreviewHealth = await fetch(`${lanBase}/api/health`);
  const lanPreviewHome = await fetch(lanBase);
  assert(lanPreviewHealth.ok && lanPreviewHome.ok && (await lanPreviewHome.text()).includes("Show us the rooms. Tell us what matters. Book the clean."), "Optional same-process Wi-Fi preview listener did not serve the Homle site.");

  const fixedSentAt = "2026-07-14T10:00:00.000Z";
  const fixedVisitStart = Date.parse("2026-07-16T09:00:00.000Z");
  const fixedDeadline = offerDeadline(fixedSentAt, 24, fixedVisitStart);
  assert(fixedDeadline === "2026-07-15T10:00:00.000Z" && offerIsOpen(fixedDeadline, Date.parse("2026-07-15T09:59:59.999Z")) && !offerIsOpen(fixedDeadline, Date.parse(fixedDeadline)), "Offer response window did not close exactly at its frozen deadline.");
  assert(offerDeadline(fixedSentAt, 72, fixedVisitStart) === "2026-07-16T09:00:00.000Z", "Offer deadline was not capped at the proposed visit start.");
  assert(decisionWasInTime("2026-07-15T09:59:59.999Z", fixedDeadline) && !decisionWasInTime(fixedDeadline, fixedDeadline), "Booking audit did not distinguish timely and stale acceptances.");
  assert(cleanerTravelCoverage("SW1A and South London", "SW1A 1AA").exact === true && cleanerTravelCoverage("SW1A and South London", "SW4 1AA").covered === false, "An exact cleaner postcode district incorrectly expanded to an entire postcode area.");
  assert(cleanerTravelCoverage("SW, SE", "SW4 1AA").area === true && cleanerTravelCoverage("SW, SE", "NE1 1AA").covered === false, "Explicit comma-separated cleaner postcode areas were not enforced correctly.");
  assert(parseCleanerTravelAreas("South London and nearby").valid === false, "Vague cleaner travel prose was treated as verified postcode coverage.");
  assert(isUkPostcode("SW1A 1AA") && isUkPostcode("M1 1AE") && !isUkPostcode("Central London"), "Shared UK postcode validation accepted vague text or rejected supported formats.");
  assert(isPhone("+44 20 7946 0958") && !isPhone("123") && isEmail("hello@tideway.example"), "Shared contact validation rejected a supported phone/email format or accepted an unusable phone number.");
  assert(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(newSubmissionKey()), "Browser submission retry keys were not generated as random UUIDs.");
  assert(normaliseBriefRoom(" Kitchen ") === "Kitchen" && normaliseBriefRoom("Garage") === "", "Current-room capture accepted an unsupported room or lost a supported exact room.");
  const currentRoomVoiceTasks = checklistFromTranscript(`${roomSpeechMarker("Kitchen")} Wipe the worktops and mop the floor. ${roomSpeechMarker("Bathroom")} Remove limescale from the shower screen.`);
  assert(roomSpeechMarker("Garage") === "" && JSON.stringify(currentRoomVoiceTasks) === JSON.stringify(["Kitchen: Wipe the worktops", "Kitchen: Mop the floor", "Bathroom: Remove limescale from the shower screen"]), "Visible current-room voice markers accepted an unsupported room or failed to group multi-room speech.");

  const conciseTasks = checklistFromTranscript("Um, so in the kitchen, please wipe every worktop, degrease the hob, clean inside the microwave and mop the floor. In the bathroom, remove limescale from the shower screen and disinfect the toilet. Finally do not move the locked cupboard.");
  assert(JSON.stringify(conciseTasks) === JSON.stringify([
    "Kitchen: Wipe every worktop",
    "Kitchen: Degrease the hob",
    "Kitchen: Clean inside the microwave",
    "Kitchen: Mop the floor",
    "Bathroom: Remove limescale from the shower screen",
    "Bathroom: Disinfect the toilet",
    "Do not move the locked cupboard"
  ]), "Long spoken instructions were not summarised into concise room-labelled bullets.");
  const numberedRoomTasks = checklistFromTranscript("In bedroom one, change the bed linen and vacuum the floor. In bedroom two, dust the shelves. In the lounge, wipe the coffee table. In the WC, disinfect the toilet.");
  assert(JSON.stringify(numberedRoomTasks) === JSON.stringify([
    "Bedroom 1: Change the bed linen",
    "Bedroom 1: Vacuum the floor",
    "Bedroom 2: Dust the shelves",
    "Living room: Wipe the coffee table",
    "Toilet: Disinfect the toilet"
  ]), "Spoken numbered rooms, lounge or WC did not map to canonical photo-room labels.");
  const carriedRoomTasks = checklistFromTranscript("In the kitchen, wipe the worktops. Mop the floor. Also dust the shelves. Finally do not move the keys.");
  assert(JSON.stringify(carriedRoomTasks) === JSON.stringify([
    "Kitchen: Wipe the worktops",
    "Kitchen: Mop the floor",
    "Kitchen: Dust the shelves",
    "Do not move the keys"
  ]), "Natural follow-on speech lost its room label or incorrectly attached a final global instruction.");
  const passiveRoomTasks = checklistFromTranscript("In the bathroom, the shower screen needs wiping and the floor needs mopping. In the kitchen, the oven is really dirty, and the worktops require attention.");
  assert(JSON.stringify(passiveRoomTasks) === JSON.stringify([
    "Bathroom: Wipe the shower screen",
    "Bathroom: Mop the floor",
    "Kitchen: Clean the oven",
    "Kitchen: Clean the worktops"
  ]), "Passive or condition-based room notes were not converted into direct cleaner actions.");
  const duplicateSpokenTasks = checklistFromTranscript("In the living room, vacuum the rug and hoover the rug. Wipe the coffee table and wipe coffee table.");
  assert(JSON.stringify(duplicateSpokenTasks) === JSON.stringify([
    "Living room: Vacuum the rug",
    "Living room: Wipe the coffee table"
  ]), "Equivalent spoken instructions produced duplicate cleaner bullets.");

  const detectedScopeCodes = detectPriceSensitiveScope({ transcript: "Clean inside the oven and inside the fridge. Clean inside cupboards, wash the windows, change the bed linen, arrange carpet cleaning, rubbish removal, balcony cleaning and wash the walls." }).map((signal) => signal.code);
  assert(JSON.stringify(detectedScopeCodes) === JSON.stringify(["oven-interior", "fridge-freezer-interior", "inside-storage", "window-cleaning", "linen-laundry", "carpet-upholstery", "waste-removal", "outdoor-area", "walls-ceilings"]), "Customer-facing price-sensitive scope detection omitted or reordered a supported extra.");
  assert(detectPriceSensitiveScope({ transcript: "Wipe the oven door, fridge door and kitchen wall tiles." }).length === 0, "Ordinary surface wiping was incorrectly flagged as a price-sensitive extra.");
  assert(JSON.stringify(normalisePriceSensitiveScopeSignals([{ code: "oven-interior", label: "Tampered label" }, { code: "not-supported", label: "Invented" }])) === JSON.stringify([{ code: "oven-interior", label: "Inside oven cleaning" }]), "Stored scope signals were not constrained to Homle's supported labels.");

  const emptyScanReadiness = briefReadiness();
  assert(emptyScanReadiness.ready === false && emptyScanReadiness.remaining === 8 && emptyScanReadiness.items.length === 8, "Empty room scan did not expose every required readiness item.");
  const maximumPhotos = Array.from({ length: maxBriefPhotos }, () => ({ area: "Kitchen", note: "Worktops need cleaning" }));
  const maximumPhotoReadiness = briefReadiness({ requestId: "REQ-1234ABCD", email: "customer@example.com", transcript: "Clean the kitchen.", tasks: ["Kitchen: Clean the worktops"], photos: maximumPhotos, checklistCurrent: true, scopeCompleteConfirmed: true, consent: true });
  assert(maximumPhotoReadiness.ready === true, "Live readiness rejected the supported whole-property photo limit.");
  const excessivePhotos = Array.from({ length: maxBriefPhotos + 1 }, () => ({ area: "Kitchen", note: "Worktops need cleaning" }));
  const excessivePhotoReadiness = briefReadiness({ requestId: "REQ-1234ABCD", email: "customer@example.com", transcript: "Clean the kitchen.", tasks: ["Kitchen: Clean the worktops"], photos: excessivePhotos, checklistCurrent: true, scopeCompleteConfirmed: true, consent: true });
  assert(excessivePhotoReadiness.ready === false && excessivePhotoReadiness.checks.roomPhotos === false, "Live readiness showed more than ten room photos as ready.");
  const invalidRoomReadiness = briefReadiness({ requestId: "REQ-1234ABCD", email: "customer@example.com", transcript: "Clean the garage.", tasks: ["Garage: Clean the floor"], photos: [{ area: "Garage", note: "Floor needs cleaning" }], checklistCurrent: true, scopeCompleteConfirmed: true, consent: true });
  assert(invalidRoomReadiness.ready === false && invalidRoomReadiness.checks.photoDetails === false && invalidRoomReadiness.checks.roomCoverage === false, "Live readiness accepted a room label outside Homle's supported set.");
  const uncoveredScanReadiness = briefReadiness({ requestId: "REQ-1234ABCD", email: "customer@example.com", transcript: "Clean the kitchen.", tasks: ["Bathroom: Clean the sink"], photos: [{ area: "Kitchen", note: "Worktops need cleaning" }], checklistCurrent: true, scopeCompleteConfirmed: true, consent: true });
  assert(uncoveredScanReadiness.ready === false && uncoveredScanReadiness.remaining === 1 && uncoveredScanReadiness.checks.roomCoverage === false && uncoveredScanReadiness.uncoveredAreas[0] === "Kitchen" && uncoveredScanReadiness.items.find((item) => item.key === "roomCoverage")?.label === "Add cleaning task for: Kitchen", "Live readiness missed or failed to name an uncovered photographed room.");
  const multipleUncoveredScanReadiness = briefReadiness({ requestId: "REQ-1234ABCD", email: "customer@example.com", transcript: "Clean the rooms.", tasks: ["Hallway: Vacuum the floor"], photos: [{ area: "Kitchen", note: "Worktops need cleaning" }, { area: "Bathroom", note: "Shower needs cleaning" }], checklistCurrent: true, scopeCompleteConfirmed: true, consent: true });
  assert(multipleUncoveredScanReadiness.items.find((item) => item.key === "roomCoverage")?.label === "Add cleaning tasks for: Kitchen, Bathroom", "Live readiness did not name every photographed room still missing cleaning tasks.");
  const numberedRoomReadiness = briefReadiness({ requestId: "REQ-1234ABCD", email: "customer@example.com", transcript: "Clean bedroom one and bedroom two.", tasks: ["Bedroom 1: Change the bed linen", "Bedroom 2: Dust the shelves"], photos: [{ area: "Bedroom 1", note: "Bed needs changing" }, { area: "Bedroom 2", note: "Shelves need dusting" }], checklistCurrent: true, scopeCompleteConfirmed: true, consent: true });
  assert(numberedRoomReadiness.ready === true, "Canonical numbered bedroom labels did not satisfy photographed-room coverage.");
  const confirmedScopeFingerprint = briefScopeFingerprint({ transcript: "  Clean   the kitchen. ", tasks: ["Kitchen: Wipe the worktops"], photos: [{ area: "Kitchen", note: " Worktops need cleaning " }] });
  const whitespaceOnlyScopeFingerprint = briefScopeFingerprint({ transcript: "Clean the kitchen.", tasks: ["Kitchen: Wipe the worktops"], photos: [{ area: "Kitchen", note: "Worktops need cleaning" }] });
  const changedScopeFingerprint = briefScopeFingerprint({ transcript: "Clean the kitchen.", tasks: ["Kitchen: Wipe the worktops", "Kitchen: Mop the floor"], photos: [{ area: "Kitchen", note: "Worktops and floor need cleaning" }] });
  assert(confirmedScopeFingerprint === whitespaceOnlyScopeFingerprint && confirmedScopeFingerprint !== changedScopeFingerprint, "Scope confirmation fingerprint did not distinguish a real task/note change from harmless whitespace.");
  assert(briefScopeConfirmationIsCurrent({ checked: true, confirmedFingerprint: confirmedScopeFingerprint, currentFingerprint: whitespaceOnlyScopeFingerprint }) === true && briefScopeConfirmationIsCurrent({ checked: true, confirmedFingerprint: confirmedScopeFingerprint, currentFingerprint: changedScopeFingerprint }) === false && briefScopeConfirmationIsCurrent({ checked: false, confirmedFingerprint: confirmedScopeFingerprint, currentFingerprint: confirmedScopeFingerprint }) === false, "Scope confirmation did not become invalid after a material scope change or manual uncheck.");
  const staleChecklistReadiness = briefReadiness({ requestId: "REQ-1234ABCD", email: "customer@example.com", transcript: "Clean the kitchen and mop the floor.", tasks: ["Kitchen: Clean the worktops"], photos: [{ area: "Kitchen", note: "Worktops and floor need cleaning" }], checklistCurrent: false, scopeCompleteConfirmed: true, consent: true });
  assert(staleChecklistReadiness.ready === false && staleChecklistReadiness.remaining === 1 && staleChecklistReadiness.checks.conciseTasks === false && staleChecklistReadiness.items.find((item) => item.key === "conciseTasks")?.label.includes("Summarise again"), "A checklist generated before the latest speech or photo-note change still appeared ready.");
  const vagueChecklistReadiness = briefReadiness({ requestId: "REQ-1234ABCD", email: "customer@example.com", transcript: "The kitchen needs cleaning.", tasks: ["Kitchen: clean everything"], photos: [{ area: "Kitchen", note: "Worktops need cleaning" }], checklistCurrent: true, scopeCompleteConfirmed: true, consent: true });
  assert(vagueChecklistReadiness.ready === false && vagueChecklistReadiness.checks.conciseTasks === false && vagueChecklistReadiness.unclearTasks.length === 1 && vagueChecklistReadiness.items.find((item) => item.key === "conciseTasks")?.label.includes("specific Cleaner action"), "A vague checklist appeared ready or lacked useful correction guidance.");
  const stableSourceFingerprint = briefSourceFingerprint({ transcript: " Clean   the kitchen. ", photos: [{ area: "Kitchen", note: " Worktops need cleaning " }] });
  const whitespaceOnlySourceFingerprint = briefSourceFingerprint({ transcript: "Clean the kitchen.", photos: [{ area: "Kitchen", note: "Worktops need cleaning" }] });
  const changedSourceFingerprint = briefSourceFingerprint({ transcript: "Clean the kitchen and mop the floor.", photos: [{ area: "Kitchen", note: "Worktops and floor need cleaning" }] });
  assert(stableSourceFingerprint === whitespaceOnlySourceFingerprint && stableSourceFingerprint !== changedSourceFingerprint, "Checklist freshness did not distinguish a real source change from harmless whitespace.");
  const completeScanReadiness = briefReadiness({ requestId: "REQ-1234ABCD", email: "customer@example.com", transcript: "Clean the kitchen.", tasks: ["Kitchen: Clean the worktops"], photos: [{ area: "Kitchen", note: "Worktops need cleaning" }], checklistCurrent: true, scopeCompleteConfirmed: true, consent: true });
  assert(completeScanReadiness.ready === true && completeScanReadiness.remaining === 0 && Object.values(completeScanReadiness.checks).every(Boolean), "Complete room scan did not reach its client-side ready state.");
  const trackerAuthorisedReadiness = briefReadiness({ requestId: "REQ-1234ABCD", requestAuthorised: true, transcript: "Clean the kitchen.", tasks: ["Kitchen: Clean the worktops"], photos: [{ area: "Kitchen", note: "Worktops need cleaning" }], checklistCurrent: true, scopeCompleteConfirmed: true, consent: true });
  assert(trackerAuthorisedReadiness.ready === true && trackerAuthorisedReadiness.checks.connectedRequest === true && trackerAuthorisedReadiness.items.find((item) => item.key === "connectedRequest")?.label.includes("Private request tracker"), "A valid private tracker handoff still required the customer email in room-scan readiness.");

  const sessionValues = new Map();
  const testSession = {
    getItem: (key) => sessionValues.get(key) || null,
    setItem: (key, value) => sessionValues.set(key, value),
    removeItem: (key) => sessionValues.delete(key)
  };
  const handoffTime = Date.parse("2026-07-14T10:00:00.000Z");
  assert(saveBriefHandoff(testSession, "req-1234abcd", "Customer@Example.com", handoffTime), "Valid request-to-brief handoff was not stored.");
  assert(readBriefHandoff(testSession, "REQ-1234ABCD", handoffTime + 5 * 60 * 1000)?.email === "customer@example.com", "Matching request-to-brief handoff was not restored.");
  assert(readBriefHandoff(testSession, "REQ-9999ZZZZ", handoffTime + 5 * 60 * 1000) === null && sessionValues.size === 1, "A handoff leaked into a different request.");
  assert(readBriefHandoff(testSession, "REQ-1234ABCD", handoffTime + 31 * 60 * 1000) === null && sessionValues.size === 0, "Expired request-to-brief handoff was retained.");
  assert(saveBriefHandoff(testSession, "REQ-1234ABCD", "not-an-email", handoffTime) === false, "Invalid handoff email was stored.");
  saveBriefHandoff(testSession, "REQ-1234ABCD", "customer@example.com", handoffTime);
  clearBriefHandoff(testSession);
  assert(sessionValues.size === 0, "Completed request-to-brief handoff was not cleared.");

  const home = await fetch(base);
  const homeText = await home.text();
  const requestEntryPage = await fetch(`${base}/request`);
  const joinEntryPage = await fetch(`${base}/join`);
  const requestEntryPageText = await requestEntryPage.text();
  const joinEntryPageText = await joinEntryPage.text();
  const guidedStepCount = (requestEntryPageText.match(/data-guided-step=/g) || []).length;
  const homeAsset = await fetch(`${base}/home.js?v=smoke-test`);
  const homeAssetText = await homeAsset.text();
  assert(home.ok && homeText.includes("Show us the rooms. Tell us what matters. Book the clean.") && homeText.includes("Private pilot preparation · coverage not yet confirmed") && homeText.includes("Homle is accepting guided pilot requests") && homeText.includes('href="/request" data-book-entry>Request a clean</a>') && homeText.includes('href="/join">Work as a cleaner</a>') && homeText.includes('href="/login" data-account-entry hidden>Sign in</a>') && homeText.includes('href="/request" data-cleaner-entry>Find a cleaner</a>') && homeText.includes("Four guided steps") && homeText.includes("Scan and speak") && !homeText.includes('data-guided-kind="customer"') && !homeText.includes('data-guided-kind="cleaner"') && !homeText.includes('/api/cleaning-requests') && !homeText.includes('/app.js') && homeText.length < requestEntryPageText.length, "The public homepage did not preserve a truthful working request fallback or still shipped the long pilot forms and their application script.");
  assert(homeAsset.ok && homeAssetText.includes('mainNav.classList.toggle("open")') && homeAssetText.includes('querySelectorAll("[data-year]")') && homeAssetText.includes('fetch("/api/health"') && homeAssetText.includes('applyEntryMode("concierge")') && !homeAssetText.includes("cleanerApplicationDraft") && !homeAssetText.includes("customerRequestDraft") && !homeAssetText.includes("/api/cleaning-requests"), "The lightweight homepage lost capability-safe entry, pulled form/application logic into the conversion path or omitted its accessible menu/year behaviour.");
  assert(requestEntryPage.ok && joinEntryPage.ok && requestEntryPageText.includes("Book a clean with every room clearly scoped") && requestEntryPageText.includes("Pilot preparation · coverage not yet confirmed") && requestEntryPageText.includes("verify coverage, cleaner availability and a clear quote before any booking") && requestEntryPageText.includes("area checked before quote") && !requestEntryPageText.includes("London pilot") && !requestEntryPageText.includes("Rental property · London") && !requestEntryPageText.includes("applications open") && requestEntryPageText.includes('data-guided-kind="customer"') && requestEntryPageText.includes('data-guided-kind="cleaner"') && requestEntryPageText.includes("data-cleaner-status-link") && requestEntryPageText.includes("Application received. Opening your private tracker") && guidedStepCount === 6 && requestEntryPageText.includes("What needs cleaning?") && requestEntryPageText.includes("When and how can the cleaner enter?") && requestEntryPageText.includes("Where should we send the next step?") && requestEntryPageText.includes("How can Homle reach you?") && requestEntryPageText.includes("What cleaning work suits you?") && requestEntryPageText.includes("When could you first work?") && requestEntryPageText.includes('name="firstAvailableDate"') && requestEntryPageText.includes('name="firstAvailableStartTime"') && requestEntryPageText.includes('name="firstAvailableEndTime"') && !requestEntryPageText.includes('href="/brief">Scan my rooms') && requestEntryPageText.includes("postcode districts or areas") && requestEntryPageText.includes("SW1A, SW4, or broader areas SW, SE"), "Focused pilot entry lost its truthful preparation copy, three-stage journeys, private tracker handoff, first availability, guarded scan entry or structured travel guidance.");
  assert(joinEntryPageText.includes("Your professional profile comes later through your private tracker") && joinEntryPageText.includes("Your profile comes next") && joinEntryPageText.includes("Nothing is published automatically") && joinEntryPageText.includes('class="application-optional-fields"') && joinEntryPageText.includes("Apply and open my tracker") && !joinEntryPageText.includes("Private application preview") && !joinEntryPageText.includes('name="professionalBio"') && !joinEntryPageText.includes('name="languages"') && !joinEntryPageText.includes('name="equipmentPlan"'), "Cleaner onboarding did not keep first contact minimal or failed to explain its private profile follow-up.");
  assert(home.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"), "Security headers were missing.");
  assert(home.headers.get("content-security-policy")?.includes("img-src 'self' data: blob:"), "Secure local photo previews were blocked by the content policy.");
  assert(!homeText.includes('href="/tracking-test"') && !homeText.includes("Test real location locally"), "The public homepage exposed a local real-location test link.");
  const trackingTestPage = await fetch(`${base}/tracking-test`);
  const trackingTestPageText = await trackingTestPage.text();
  assert(trackingTestPage.ok && trackingTestPage.headers.get("permissions-policy")?.includes("geolocation=(self)") && trackingTestPageText.includes("Real journey and cleaning test") && trackingTestPageText.includes("Only the latest point") && trackingTestPageText.includes("I consent") && trackingTestPageText.includes("Live cleaning progress"), "The local tracking-test page did not expose its exact permission, consent, current-only storage and live progress boundaries.");
  const trackingTestCreated = await fetch(`${base}/api/tracking-test/session`, { method: "POST" });
  const trackingTestCreatedBody = await trackingTestCreated.json();
  assert(trackingTestCreated.status === 201 && /^[A-Za-z0-9_-]{43}$/.test(trackingTestCreatedBody.controllerToken) && /^[A-Za-z0-9_-]{43}$/.test(trackingTestCreatedBody.viewerToken) && trackingTestCreatedBody.snapshot?.state === "waiting" && Array.isArray(trackingTestCreatedBody.viewerOrigins) && trackingTestCreatedBody.viewerOrigins.every((origin) => origin.endsWith(`:${lanPort}`)) && !JSON.stringify(trackingTestCreatedBody.snapshot).includes(trackingTestCreatedBody.viewerToken), "A private in-memory tracking test did not create separate opaque role tokens or safe same-Wi-Fi viewer origins.");
  const trackingTestViewerWrite = await fetch(`${base}/api/tracking-test/location`, { method: "PUT", headers: { "content-type": "application/json", "x-tracking-test-token": trackingTestCreatedBody.viewerToken }, body: JSON.stringify({ latitude: 51.5, longitude: -0.1, accuracyMetres: 8 }) });
  assert(trackingTestViewerWrite.status === 403, "A read-only Landlord tracking-test token changed location.");
  const trackingTestStream = await fetch(`${base}/api/tracking-test/events`, { headers: { "accept": "text/event-stream", "x-tracking-test-token": trackingTestCreatedBody.viewerToken } });
  assert(trackingTestStream.ok && trackingTestStream.headers.get("content-type")?.includes("text/event-stream"), "The private Landlord live stream did not open.");
  const trackingTestReader = trackingTestStream.body.getReader();
  const trackingTestDecoder = new TextDecoder();
  const initialTrackingChunk = trackingTestDecoder.decode((await trackingTestReader.read()).value || new Uint8Array());
  assert(initialTrackingChunk.includes('"role":"landlord"') && initialTrackingChunk.includes('"state":"waiting"'), "The live stream did not start with an authorized Landlord snapshot.");
  const trackingTestUpdated = await fetch(`${base}/api/tracking-test/location`, { method: "PUT", headers: { "content-type": "application/json", "x-tracking-test-token": trackingTestCreatedBody.controllerToken }, body: JSON.stringify({ latitude: 51.50123, longitude: -0.14123, accuracyMetres: 9.4 }) });
  const trackingTestUpdatedBody = await trackingTestUpdated.json();
  const liveTrackingChunk = trackingTestDecoder.decode((await trackingTestReader.read()).value || new Uint8Array());
  assert(trackingTestUpdated.ok && trackingTestUpdatedBody.state === "live" && trackingTestUpdatedBody.location?.latitude === 51.50123 && liveTrackingChunk.includes('"state":"live"') && liveTrackingChunk.includes('"latitude":51.50123'), "A real current point did not reach the authorized live viewer stream.");
  const trackingTestArrived = await fetch(`${base}/api/tracking-test/arrive`, { method: "POST", headers: { "x-tracking-test-token": trackingTestCreatedBody.controllerToken } });
  const trackingTestArrivedBody = await trackingTestArrived.json();
  const arrivedTrackingChunk = trackingTestDecoder.decode((await trackingTestReader.read()).value || new Uint8Array());
  assert(trackingTestArrived.ok && trackingTestArrivedBody.state === "arrived" && trackingTestArrivedBody.location === null && arrivedTrackingChunk.includes('"state":"arrived"') && arrivedTrackingChunk.includes('"location":null'), "Arrival did not stop location or reach the authorized Landlord stream.");
  await trackingTestReader.cancel();
  const trackingTestViewerStart = await fetch(`${base}/api/tracking-test/cleaning/start`, { method: "POST", headers: { "x-tracking-test-token": trackingTestCreatedBody.viewerToken } });
  assert(trackingTestViewerStart.status === 403, "A read-only Landlord token started cleaning.");
  const trackingTestCleaningStarted = await fetch(`${base}/api/tracking-test/cleaning/start`, { method: "POST", headers: { "x-tracking-test-token": trackingTestCreatedBody.controllerToken } });
  const trackingTestCleaningStartedBody = await trackingTestCleaningStarted.json();
  assert(trackingTestCleaningStarted.ok && trackingTestCleaningStartedBody.job?.phase === "in-progress", "The Cleaner could not start the sample cleaning checklist after arrival.");
  const trackingTestViewerTask = await fetch(`${base}/api/tracking-test/task`, { method: "PUT", headers: { "content-type": "application/json", "x-tracking-test-token": trackingTestCreatedBody.viewerToken }, body: JSON.stringify({ taskId: "kitchen", status: "completed" }) });
  assert(trackingTestViewerTask.status === 403, "A read-only Landlord token changed a cleaning task.");
  const prematureTrackingFinish = await fetch(`${base}/api/tracking-test/cleaning/finish`, { method: "POST", headers: { "x-tracking-test-token": trackingTestCreatedBody.controllerToken } });
  assert(prematureTrackingFinish.status === 409, "The cleaning test finished with unresolved tasks.");
  for (const taskId of ["kitchen", "bathroom", "main-bedroom", "living-room"]) {
    const taskUpdate = await fetch(`${base}/api/tracking-test/task`, { method: "PUT", headers: { "content-type": "application/json", "x-tracking-test-token": trackingTestCreatedBody.controllerToken }, body: JSON.stringify({ taskId, status: "completed" }) });
    assert(taskUpdate.ok, `The Cleaner could not complete the ${taskId} sample task.`);
  }
  const trackingTestFinished = await fetch(`${base}/api/tracking-test/cleaning/finish`, { method: "POST", headers: { "x-tracking-test-token": trackingTestCreatedBody.controllerToken } });
  const trackingTestFinishedBody = await trackingTestFinished.json();
  const trackingTestViewerFinal = await fetch(`${base}/api/tracking-test/snapshot`, { headers: { "x-tracking-test-token": trackingTestCreatedBody.viewerToken } });
  const trackingTestViewerFinalBody = await trackingTestViewerFinal.json();
  assert(trackingTestFinished.ok && trackingTestFinishedBody.state === "finished" && trackingTestFinishedBody.job?.percent === 100 && trackingTestViewerFinal.ok && trackingTestViewerFinalBody.role === "landlord" && trackingTestViewerFinalBody.job?.phase === "finished", "The guarded 100% finish did not reach the Landlord snapshot.");
  const trackingTestDeleted = await fetch(`${base}/api/tracking-test/session`, { method: "DELETE", headers: { "x-tracking-test-token": trackingTestCreatedBody.controllerToken } });
  const trackingTestDeletedViewer = await fetch(`${base}/api/tracking-test/snapshot`, { headers: { "x-tracking-test-token": trackingTestCreatedBody.viewerToken } });
  assert(trackingTestDeleted.ok && trackingTestDeletedViewer.status === 401, "Deleting a tracking test left its viewer token authorized.");
  const invalidTrackingTest = await fetch(`${base}/api/tracking-test/snapshot`, { headers: { "x-tracking-test-token": "invalid" } });
  assert(invalidTrackingTest.status === 401, "An invalid tracking-test token reached a snapshot.");
  const marketplaceHealth = await fetch(`${base}/api/health`);
  const marketplaceHealthBody = await marketplaceHealth.json();
  const disabledMarketplaceRoute = await fetch(`${base}/api/marketplace/cleaners`);
  assert(marketplaceHealth.ok && marketplaceHealthBody.marketplace?.enabled === false && marketplaceHealthBody.marketplace?.ready === false && marketplaceHealthBody.marketplace?.authenticationReady === false && disabledMarketplaceRoute.status === 404, "The default-off marketplace attachment exposed a partial route or misreported readiness.");
  const cleanerDirectoryPage = await fetch(`${base}/cleaners`);
  const cleanerEditorPage = await fetch(`${base}/cleaner/profile`);
  const cleanerPayoutPage = await fetch(`${base}/cleaner/payouts`);
  const landlordDashboardPage = await fetch(`${base}/landlord/dashboard`);
  const adminCasesPage = await fetch(`${base}/admin/cases`);
  const cleanerDirectoryText = await cleanerDirectoryPage.text();
  const cleanerEditorText = await cleanerEditorPage.text();
  const cleanerPayoutText = await cleanerPayoutPage.text();
  const landlordDashboardText = await landlordDashboardPage.text();
  const adminCasesText = await adminCasesPage.text();
  assert(cleanerDirectoryPage.ok && cleanerEditorPage.ok && cleanerPayoutPage.ok && landlordDashboardPage.ok && adminCasesPage.ok && cleanerPayoutPage.headers.get("cache-control") === "no-store" && adminCasesPage.headers.get("cache-control") === "no-store" && homeText.includes('href="/request" data-cleaner-entry>Find a cleaner</a>') && cleanerDirectoryText.includes("Find the right Cleaner for the job") && cleanerDirectoryText.includes("data-directory-state") && cleanerEditorText.includes("Build a profile landlords can trust") && cleanerEditorText.includes("data-cleaner-profile-form hidden") && cleanerEditorText.includes("data-profile-controls disabled") && cleanerPayoutText.includes("Get paid without sharing bank details with Homle") && cleanerPayoutText.includes("connect.stripe.com") && landlordDashboardText.includes("Checking secure Landlord access") && landlordDashboardText.includes("data-landlord-workspace hidden") && landlordDashboardText.includes("Save private draft") && landlordDashboardText.includes("Thank you. Your cleaning request is ready for matching.") && landlordDashboardText.includes("No payment was taken here.") && adminCasesText.includes("Marketplace trust and safety") && adminCasesText.includes("data-admin-cases-workspace hidden") && adminCasesText.includes("This screen never refunds, charges or pays anyone"), "The real Cleaner/Landlord/Administrator routes, payout handoff, homepage entry point, private completion or fail-closed controls are not served by the pilot runtime.");
  const paymentPage = await fetch(`${base}/booking-payment?bookingId=55555555-5555-4555-8555-555555555555`);
  const paymentPageText = await paymentPage.text();
  const paymentPageScript = await fetch(`${base}/booking-payment.js?v=smoke-test`);
  const paymentPageScriptText = await paymentPageScript.text();
  assert(paymentPage.ok && paymentPageText.includes("Test mode only") && paymentPageText.includes("data-payment-card hidden") && !paymentPageText.includes("js.stripe.com") && paymentPage.headers.get("content-security-policy")?.includes("https://js.stripe.com") && paymentPage.headers.get("cache-control") === "no-store" && paymentPageScript.ok && paymentPageScriptText.includes('requestJson("/api/marketplace/account")') && paymentPageScriptText.includes('document.createElement("script")'), "The test checkout route, fail-closed controls, dynamic Stripe boundary or private response policy is missing.");
  const authProviders = await fetch(`${base}/api/auth/providers`);
  const authProvidersBody = await authProviders.json();
  const serialisedAuthProviders = JSON.stringify(authProvidersBody);
  assert(authProviders.ok && authProvidersBody.providers?.roles?.join(",") === "cleaner,landlord" && ["emailPassword", "passwordReset", "emailVerification", "google", "apple", "facebook"].every((provider) => authProvidersBody.providers[provider] === false) && !serialisedAuthProviders.includes("CLIENT_SECRET") && !serialisedAuthProviders.includes("SESSION_SECRET") && !serialisedAuthProviders.includes("DATABASE_URL"), "Public authentication provider discovery exposed an uncomposed runtime, missed roles or leaked secret configuration.");
  const loginPage = await fetch(`${base}/login`);
  const signupPage = await fetch(`${base}/signup`);
  const verificationPage = await fetch(`${base}/verify-email`);
  const facebookVerificationPage = await fetch(`${base}/verify-facebook`);
  const resetPage = await fetch(`${base}/reset-password`);
  const onboardingPage = await fetch(`${base}/onboarding`);
  const settingsPage = await fetch(`${base}/settings`);
  const loginPageText = await loginPage.text();
  const signupPageText = await signupPage.text();
  const verificationPageText = await verificationPage.text();
  const authEntryAsset = await fetch(`${base}/auth-entry.js?v=smoke-test`);
  const authEntryText = await authEntryAsset.text();
  const accountIntentAsset = await fetch(`${base}/account-intent.js?v=smoke-test`);
  const accountIntentText = await accountIntentAsset.text();
  const settingsPageText = await settingsPage.text();
  const settingsAsset = await fetch(`${base}/settings.js?v=smoke-test`);
  const settingsAssetText = await settingsAsset.text();
  assert(facebookVerificationPage.ok, "The private Facebook mailbox-verification page is not routed through the capability-gated account shell.");
  assert(loginPage.ok && signupPage.ok && verificationPage.ok && resetPage.ok && onboardingPage.ok && loginPageText.includes("Account access is not open yet") && signupPageText.includes("Account access is not open yet") && loginPageText.includes('href="/signup?intent=book">Create an account to book</a>') && loginPageText.includes('href="/join">Join as a cleaner</a>') && loginPageText.includes("creates its account automatically") && loginPageText.includes("data-account-runtime hidden") && loginPageText.includes("data-account-controls disabled") && verificationPageText.includes('data-account-form="verification-request"') && !loginPageText.includes("Sign in with Google") && !signupPageText.includes('action="/api/') && authEntryAsset.ok && accountIntentAsset.ok && accountIntentText.includes('=== "book" ? "book" : ""') && accountIntentText.includes("accountIntentLifetimeMs") && authEntryText.includes("Account access is safely unavailable") && authEntryText.includes("providers.emailPassword === true") && authEntryText.includes('history.replaceState(null, "", `${location.pathname}${location.search}`)') && authEntryText.includes('link.href = `${link.pathname}?intent=book`') && authEntryText.includes('intent: "book"') && authEntryText.includes('location.assign("/login?intent=book#email=verified")') && authEntryText.includes('input[name="role"][value="landlord"]') && authEntryText.includes("only a Cleaner workspace") && authEntryText.includes("/api/marketplace/auth/login") && authEntryText.includes("/api/marketplace/auth/verification/resend"), "Capability-gated account-first entry/recovery pages displayed a non-working action, lost email verification intent, retained a fragment token, permitted an arbitrary redirect or failed to preserve secure Landlord onboarding.");
  assert(settingsPage.ok && settingsPageText.includes("Private account security") && settingsPageText.includes("data-settings-content hidden") && settingsPageText.includes('data-connect-provider="google" hidden') && settingsPageText.includes('autocomplete="current-password"') && settingsAsset.ok && settingsAssetText.includes('requestJson("/api/marketplace/auth/provider-links")') && settingsAssetText.includes("location.assign(safeProviderLocation"), "Authenticated provider settings are missing, exposed before capability checks or can navigate to an unvalidated provider response.");
  const sharedStyles = await fetch(`${base}/styles.css?v=smoke-test`);
  const sharedStylesText = await sharedStyles.text();
  assert(sharedStylesText.includes(".readiness-continue") && sharedStylesText.includes("label.readiness-field-focus"), "Guided launch setup omitted its visible continue action or focused-field styling.");
  assert(sharedStyles.ok && sharedStylesText.includes("[hidden] { display: none !important; }") && sharedStylesText.includes(".guided-form-step { scroll-margin-top: 92px;") && sharedStylesText.includes(".entry-route main > section:not(.forms-section)") && sharedStylesText.includes(".entry-route-request #cleaner-application") && sharedStylesText.includes(".entry-route-join #request-cleaning") && sharedStylesText.includes(".launch-parallel-action") && sharedStylesText.includes(".capture-room-control") && sharedStylesText.includes(".photo-picker.is-disabled") && sharedStylesText.includes(".speech-room-context") && sharedStylesText.includes(".cleaner-handoff-room-missing") && sharedStylesText.includes(".cleaner-handoff-boundaries") && sharedStylesText.includes(".checklist-change-columns") && sharedStylesText.includes(".checklist-change-actions .button { width: 100%; }") && sharedStylesText.includes(".account-grid { display: grid;") && sharedStylesText.includes(".account-role:has(input:checked)") && sharedStylesText.includes(".account-actions .button { width: 100%; }") && sharedStylesText.includes(".account-form .button { width: 100%; }"), "Shared styling allowed hidden private actions or form stages to remain visible, omitted the current-room capture/voice context, room-grouped Cleaner handoff or mobile checklist-change review, failed mobile account forms/actions, omitted launch guidance, or did not isolate focused entry screens.");
  assert(sharedStylesText.includes(".config-preview-economics") && sharedStylesText.includes("grid-template-columns: repeat(3, minmax(0, 1fr))") && sharedStylesText.includes("@media (max-width: 680px) { .config-preview-economics { grid-template-columns: 1fr; } }"), "The no-save minimum-job economics rehearsal omitted its responsive summary layout.");
  assert(requestEntryPageText.includes('id="request-cleaning"') && requestEntryPageText.includes('name="preferredDate" type="date" required') && requestEntryPageText.includes("Choose the first date you could accept") && joinEntryPageText.includes('id="cleaner-application"'), "Focused customer or cleaner entry route did not serve its validated, schedulable form.");

  const privacy = await fetch(`${base}/privacy`);
  const privacyText = await privacy.text();
  assert(privacy.ok && privacyText.includes("Privacy notice") && privacyText.includes("replace their requested date or arrival window") && privacyText.includes("append-only audit history") && privacyText.includes("one exact first-available date") && privacyText.includes("planning evidence only") && privacyText.includes("temporarily holds a client network address in memory") && privacyText.includes("private cleaner tracker") && privacyText.includes("that applicant's own professional introduction/languages/equipment plan") && privacyText.includes("screening notes, decision notes or the authorisation token") && privacyText.includes("never used for matching until Homle records a separate confirmation"), "Privacy page failed or omitted customer timing history, initial Cleaner availability, local anti-abuse, staged private profile, pending availability or tracker disclosures.");

  const terms = await fetch(`${base}/terms`);
  const termsText = await terms.text();
  assert(terms.ok && termsText.includes("Pilot terms") && termsText.includes("private customer and cleaner trackers") && termsText.includes("does not guarantee work") && termsText.includes("replace the requested date or arrival window") && termsText.includes("blocks another timing replacement") && termsText.includes("first-available window") && termsText.includes("separately records that the exact window was re-confirmed") && termsText.includes("planning preference only") && termsText.includes("No recurring schedule") && termsText.includes("UK local time (Europe/London)"), "Terms page failed, implied tracker timing or first availability guarantees work, or omitted the one-visit and UK booking-clock boundaries.");

  const adminPage = await fetch(`${base}/admin`);
  const adminPageText = await adminPage.text();
  assert(adminPage.ok && adminPageText.includes("Lead control desk") && adminPageText.includes("First profitable booking") && adminPageText.includes('id="launch-funnel-stages"') && adminPageText.includes('id="readiness-next"') && adminPageText.includes("Real marketplace activation") && adminPageText.includes('id="technical-readiness-list"') && adminPageText.includes('data-activation-check="socialSignIn"') && adminPageText.includes("never a real two-account booking rehearsal") && adminPageText.includes("no credentials, database addresses, provider keys") && adminPageText.includes('name="publicSiteUrl" type="url"') && adminPageText.includes("Use the final HTTPS origin only") && adminPageText.includes("Public-site verification") && adminPageText.includes('name="publicSiteEvidenceNote"') && adminPageText.includes('name="publicSiteVerifiedDate" type="date"') && adminPageText.includes("Insurance verification") && adminPageText.includes("Never enter passwords, card details") && adminPageText.includes("Minimum-job economics rehearsal") && adminPageText.includes("data-target-safe-rate") && adminPageText.includes("Founder-action queue") && adminPageText.includes('id="action-filter"') && adminPageText.includes('value="schedule">Approaching dates') && adminPageText.includes("Room-media retention") && adminPageText.includes("No media is deleted automatically") && adminPageText.includes('id="private-data-storage"') && adminPageText.includes("never moves, copies or deletes private records automatically"), "Admin launch-runway, technical activation evidence, no-save minimum-job economics, HTTPS public-origin gate, evidence-based readiness, storage-safety warning, schedule-aware dispatch control or private media-retention page failed.");
  const remoteAdminShell = await rawLocalRequest("/admin", "192.0.2.10:4173");
  assert(remoteAdminShell.status === 401 && !remoteAdminShell.body.includes("Lead control desk"), "A non-local request could download the private admin HTML shell without the admin key.");
  const adminScript = await fetch(`${base}/admin.js?v=smoke-test`);
  const adminScriptText = await adminScript.text();
  const readinessNavigatorAsset = await fetch(`${base}/readiness-navigator.js?v=smoke-test`);
  const readinessNavigatorText = await readinessNavigatorAsset.text();
  assert(readinessNavigatorAsset.ok && readinessNavigatorText.includes("navigationModel") && readinessNavigatorText.includes("firstMappedRequirement"), "Readiness area navigation helper was unavailable or incomplete.");
  assert(adminPageText.includes('name="labourOnCostPercent"'), "Admin launch details omitted the founder-set labour on-cost assumption.");
  assert(adminPageText.includes('id="readiness-continue"') && adminPageText.includes("Continue launch setup") && (adminPageText.match(/data-readiness-action/g) || []).length === 7 && (adminPageText.match(/data-readiness-action type="button"/g) || []).length === 7 && adminPageText.includes("/readiness-navigator.js"), "Admin launch readiness omitted its guided continue action or seven non-submitting area controls.");
  assert(adminPageText.includes('<option value="scan">Room scans</option>') && adminPageText.includes('<option value="supply">Cleaner supply</option>') && adminPageText.includes('<option value="profit">Profit review</option>'), "Founder-action filters omitted scan, supply or profit queues.");
  assert(adminScript.ok && adminScriptText.includes("function addLocalAuditPreview") && adminScriptText.includes("Open local customer preview") && adminScriptText.includes("Open local cleaner preview") && adminScriptText.includes("const privateUrl = draft.privateUrl || \"\"") && adminScriptText.includes("/api/admin/booking-drafts") && adminScriptText.includes("Load copy-only booking handoffs") && adminScriptText.includes("booking.publicSiteUrl") && adminScriptText.includes("economics.configuredMeetsTarget") && adminScriptText.includes("economics.configuredRateGap") && !adminScriptText.includes("location.origin") && !adminScriptText.includes("Copy private link") && !adminScriptText.includes("Copy cleaner link") && !adminScriptText.includes("Copy verified booking-pack link"), "The control desk omitted authoritative rehearsal economics or exposed bare/local-origin recipient links outside verified handoff packs.");
  const briefPage = await fetch(`${base}/brief`);
  const briefPageText = await briefPage.text();
  const galleryInputTag = briefPageText.match(/<input id="brief-photos"[^>]*>/)?.[0] || "";
  assert(briefPage.ok && briefPageText.includes("Request details carried over.") && briefPageText.includes("Open this scan from your private request tracker") && briefPageText.includes("data-request-email-label") && briefPageText.includes('id="photo-count">0/10') && briefPageText.includes('id="capture-room"') && briefPageText.includes("Current room for photos, videos and voice notes") && briefPageText.includes("Choose a room to unlock the camera") && briefPageText.includes('id="speech-room-context"') && briefPageText.includes("Homle adds a visible room marker") && briefPageText.includes('id="brief-camera" type="file" accept="image/*" capture="environment"') && briefPageText.includes("Take a room photo") && briefPageText.includes("Choose existing photos or videos") && galleryInputTag.includes("multiple") && !galleryInputTag.includes("capture=") && briefPageText.includes("the floor needs mopping") && briefPageText.includes("turns supported conditions into direct tasks") && briefPageText.includes("Say “do not”, “no need” or “skip”") && briefPageText.includes("Excluded work stays visible to the Cleaner but is not treated as requested extra cleaning time") && briefPageText.includes('aria-label="Cleaner handoff preview"') && briefPageText.includes("Review checklist changes before applying") && briefPageText.includes("data-apply-summary") && briefPageText.includes("Keep my current checklist") && briefPageText.includes("no more than two videos of 30 seconds and 15 MB each") && briefPageText.includes("complete upload is capped at 20 MB") && briefPageText.includes("Checking room scan") && briefPageText.includes("summarise again so the cleaner receives the latest scope") && briefPageText.includes("Extra time may be needed") && briefPageText.includes("require this confirmation again"), "Current-room photo/voice labelling, direct mobile camera capture, natural room-transition speech guidance, condition-to-action and exclusion guidance, grouped Cleaner handoff preview, non-destructive checklist-change review, separate gallery/video selection, bounded whole-property limits, checklist-freshness guidance, live readiness panel, private tracker handoff, customer-facing scope warning or change-sensitive scope confirmation failed.");
  assert(briefPageText.includes('id="job-brief-form" action="/api/job-briefs" method="post" novalidate') && !briefPageText.includes('id="save-brief" class="button submit-button" type="submit" disabled'), "Room-scan submission was blocked before it could explain incomplete readiness.");
  const cleanerHandoffAsset = await fetch(`${base}/cleaner-handoff-preview.js?v=smoke-test`);
  const cleanerHandoffAssetText = await cleanerHandoffAsset.text();
  assert(cleanerHandoffAsset.ok && cleanerHandoffAssetText.includes("cleanerHandoffPreview") && cleanerHandoffAssetText.includes("missingWorkAreas") && cleanerHandoffAssetText.includes("isChecklistExclusion"), "The room-grouped Cleaner handoff helper was unavailable or incomplete.");
  const checklistChangeAsset = await fetch(`${base}/checklist-change-review.js?v=smoke-test`);
  const checklistChangeAssetText = await checklistChangeAsset.text();
  assert(checklistChangeAsset.ok && checklistChangeAssetText.includes("checklistChangeReview") && checklistChangeAssetText.includes("orderChanged") && checklistChangeAssetText.includes("unchangedCount"), "The non-destructive checklist comparison helper was unavailable or incomplete.");
  const briefScript = await fetch(`${base}/brief.js?v=smoke-test`);
  const briefScriptText = await briefScript.text();
  assert(briefScript.ok && briefScriptText.includes("normaliseBriefRoom(captureRoomSelect.value)") && briefScriptText.includes("roomSpeechMarker(currentCaptureRoom())") && briefScriptText.includes("appendCurrentRoomMarker()") && briefScriptText.includes("if (listening) appendCurrentRoomMarker()") && briefScriptText.includes('area: captureRoom') && briefScriptText.includes("cameraInput.disabled = disabled") && briefScriptText.includes('cameraInput.addEventListener("change"') && briefScriptText.includes("addSelectedVisuals(selected)") && briefScriptText.includes("cleanerHandoffPreview") && briefScriptText.includes('boundaryTitle.textContent = "Leave alone"') && briefScriptText.includes("if (currentTasks.length && review.changed)") && briefScriptText.includes("showChecklistChangeReview") && briefScriptText.includes("pendingChecklistChange.sourceFingerprint !== currentSourceFingerprint()") && briefScriptText.includes("your current checklist was not replaced") && briefScriptText.includes('saveButton.disabled = submitting || submissionComplete') && briefScriptText.includes("privateRequestToken") && briefScriptText.includes("history.replaceState") && briefScriptText.includes('"X-Request-Token": privateRequestToken') && briefScriptText.includes("new AbortController()") && briefScriptText.includes("took too long to prepare") && briefScriptText.includes('"Idempotency-Key": pendingSubmission.key') && briefScriptText.includes('location.assign(`/brief-complete'), "Validated current-room photo/voice capture, direct camera handling, room-grouped Cleaner handoff, non-destructive voice/checklist replacement, stale comparison rejection, token-authorised tracker handoff, room-scan button recovery, idempotent retry handling, bounded photo/upload handling or dedicated completion handoff was missing.");
  const briefCompletePage = await fetch(`${base}/brief-complete`);
  const briefCompletePageText = await briefCompletePage.text();
  assert(briefCompletePage.ok && briefCompletePageText.includes("Thank you. Your cleaning instructions are safely submitted.") && briefCompletePageText.includes("What happens next") && briefCompletePageText.includes("Track my cleaning request") && briefCompletePageText.includes("No payment was collected."), "Dedicated room-scan thank-you page failed or omitted its safe next steps.");
  assert(briefPage.headers.get("permissions-policy")?.includes("microphone=(self)"), "Job-brief page did not allow its requested microphone feature.");
  const scopeSignalAsset = await fetch(`${base}/scope-signals.js`);
  assert(scopeSignalAsset.ok && (await scopeSignalAsset.text()).includes("detectPriceSensitiveScope"), "Shared customer/server scope detection asset failed.");
  const briefReadinessAsset = await fetch(`${base}/brief-readiness.js`);
  const briefReadinessAssetText = await briefReadinessAsset.text();
  assert(briefReadinessAsset.ok && briefReadinessAssetText.includes("briefReadiness") && briefReadinessAssetText.includes("maxBriefPhotos = 10") && briefReadinessAssetText.includes("maxBriefVideos = 2"), "Shared room-scan readiness or whole-property media-limit asset failed.");
  const requestStatusPage = await fetch(`${base}/request-status`);
  const requestStatusPageText = await requestStatusPage.text();
  assert(requestStatusPage.ok && requestStatusPageText.includes("Private request tracker") && requestStatusPageText.includes("data-frequency") && requestStatusPageText.includes("data-preferred-date") && requestStatusPageText.includes("data-preferred-time") && requestStatusPageText.includes("not a confirmed visit") && requestStatusPageText.includes("Change requested date or arrival window") && requestStatusPageText.includes("keeps the earlier timing in the private audit history") && requestStatusPageText.includes("Close this unbooked request") && requestStatusPageText.includes("does not delete the audit record or cancel a confirmed visit"), "Private customer request tracker failed or omitted customer-authorised timing changes, the non-confirmation boundary or bounded pre-booking withdrawal.");
  const requestStatusAsset = await fetch(`${base}/request-status.js?v=smoke-test`);
  const requestStatusAssetText = await requestStatusAsset.text();
  assert(requestStatusAsset.ok && requestStatusAssetText.includes('/brief?reference=${encodeURIComponent(result.request.reference)}#${token}') && requestStatusAssetText.includes("/api/request-schedule") && requestStatusAssetText.includes("/api/request-withdrawal") && requestStatusAssetText.includes('"X-Request-Token": token') && requestStatusAssetText.includes("result.scheduleChange?.allowed") && requestStatusAssetText.includes("result.withdrawal?.allowed") && requestStatusAssetText.includes('timeZone: "Europe/London"') && requestStatusAssetText.includes("result.request.preferredTimeWindow"), "The private customer tracker did not preserve its room-scan handoff, render UK-local timing or expose token-authorised schedule and withdrawal controls.");
  const cleanerStatusPage = await fetch(`${base}/cleaner-status`);
  const cleanerStatusPageText = await cleanerStatusPage.text();
  assert(cleanerStatusPage.ok && cleanerStatusPageText.includes("Private cleaner tracker") && cleanerStatusPageText.includes("First window supplied") && cleanerStatusPageText.includes("Complete your professional profile") && cleanerStatusPageText.includes("not published by this form") && cleanerStatusPageText.includes("When are you available?") && cleanerStatusPageText.includes("Keep your future times current while Homle reviews your application") && cleanerStatusPageText.includes("cannot be used for matching until screening") && cleanerStatusPageText.includes("This tracker does not approve, assign or promise work."), "Private cleaner application tracker page failed, omitted safe pre-approval availability/profile actions or implied publication, matching or work approval.");
  const cleanerStatusAsset = await fetch(`${base}/cleaner-status.js?v=smoke-test`);
  const cleanerStatusAssetText = await cleanerStatusAsset.text();
  assert(cleanerStatusAsset.ok && cleanerStatusAssetText.includes("X-Cleaner-Status-Token") && cleanerStatusAssetText.includes("history.replaceState") && cleanerStatusAssetText.includes("firstAvailability") && cleanerStatusAssetText.includes("confirmedAvailabilityWindows") && cleanerStatusAssetText.includes("/api/cleaner-profile-starter") && cleanerStatusAssetText.includes("profileStarterSubmissionAllowed") && cleanerStatusAssetText.includes("/api/cleaner-availability-requests") && cleanerStatusAssetText.includes("Idempotency-Key"), "Cleaner tracker did not keep its token out of request URLs, render captured readiness safely or submit retry-safe profile and availability updates.");
  const quotePage = await fetch(`${base}/quote`);
  const quotePageText = await quotePage.text();
  assert(quotePage.ok && quotePageText.includes("Private customer review") && quotePageText.includes("This is a replacement quote") && quotePageText.includes("A fresh decision is required.") && quotePageText.includes("This quote proposes different timing") && quotePageText.includes("data-requested-date") && quotePageText.includes("data-requested-time") && quotePageText.includes('name="scheduleConfirmed"') && quotePageText.includes("even if it differs from my original request") && quotePageText.includes("data-frequency") && quotePageText.includes("One-visit rule") && quotePageText.includes("UK local time"), "Private customer quote omitted explicit requested-versus-proposed timing, schedule acceptance, frequency scope, UK booking clock or replacement review.");
  const quoteAsset = await fetch(`${base}/quote.js?v=smoke-test`);
  const quoteAssetText = await quoteAsset.text();
  assert(quoteAsset.ok && quoteAssetText.includes("previousCustomerAccepted") && quoteAssetText.includes("requestClosed") && quoteAssetText.includes("alternativeTimingReasons") && quoteAssetText.includes('data.has("scheduleConfirmed")') && quoteAssetText.includes("[data-requested-date]") && quoteAssetText.includes("[data-frequency]") && quoteAssetText.includes('timeZone: "Europe/London"'), "Customer quote script omitted alternative-timing disclosure, server-bound schedule confirmation, closed-request gate, requested-frequency rendering or UK-local display.");
  const opportunityPage = await fetch(`${base}/opportunity`);
  const opportunityPageText = await opportunityPage.text();
  assert(opportunityPage.ok && opportunityPageText.includes("Private cleaner review") && opportunityPageText.includes("data-frequency") && opportunityPageText.includes("One-visit rule") && opportunityPageText.includes("UK local time"), "Private cleaner opportunity page failed or omitted its frequency, one-visit scope or UK booking clock.");
  const opportunityAsset = await fetch(`${base}/opportunity.js?v=smoke-test`);
  const opportunityAssetText = await opportunityAsset.text();
  assert(opportunityAsset.ok && opportunityAssetText.includes("requestClosed") && opportunityAssetText.includes("[data-frequency]") && opportunityAssetText.includes('timeZone: "Europe/London"'), "Cleaner opportunity did not render the closed-request gate, requested frequency or UK-local deadline.");
  const customerBookingPage = await fetch(`${base}/booking-confirmation`);
  const cleanerAssignmentPage = await fetch(`${base}/assignment`);
  const customerBookingPageText = await customerBookingPage.text();
  assert(customerBookingPage.ok && cleanerAssignmentPage.ok && customerBookingPageText.includes("Protected visit details") && customerBookingPageText.includes("Report a cleaning quality issue") && customerBookingPageText.includes("data-frequency") && customerBookingPageText.includes("One-visit rule") && customerBookingPageText.includes("UK local time") && (await cleanerAssignmentPage.text()).includes("Protected visit details"), "Private confirmed-booking pages, frequency boundary, UK booking clock or cleaning-quality reporting route failed.");
  const bookingPackAsset = await fetch(`${base}/booking-pack.js?v=smoke-test`);
  const bookingPackAssetText = await bookingPackAsset.text();
  assert(bookingPackAsset.ok && bookingPackAssetText.includes("arrivalCanBeRecorded") && bookingPackAssetText.includes("completionCanBeRecorded") && bookingPackAssetText.includes("Arrival confirmation opens 30 minutes before the visit"), "Private booking packs did not gate job-day actions against the confirmed visit clock.");
  const adminAsset = await fetch(`${base}/admin.js?v=smoke-test`);
  const adminAssetText = await adminAsset.text();
  assert(adminAssetText.includes("additionalLabourOnCosts") && adminAssetText.includes("plannedLabourOnCosts"), "Admin assets omitted planned, actual or later labour on-cost audit fields.");
  assert(adminAssetText.includes("renderActivationReadiness") && adminAssetText.includes("result.activationReadiness") && adminAssetText.includes("Verified by the current running environment"), "The control desk did not bind technical activation evidence to the server projection.");
  assert(adminAssetText.includes("readinessNavigator.navigationModel") && adminAssetText.includes("focusReadinessRequirement") && adminAssetText.includes("areaButton.onclick") && adminAssetText.includes("setup.open = true") && adminAssetText.includes("readiness-field-focus") && adminAssetText.includes("field.focus({ preventScroll: true })") && !adminAssetText.includes("form.requestSubmit"), "Admin assets omitted evidence-safe per-area navigation, focused-field handling or the no-automatic-submission boundary.");
  assert(adminAssetText.includes("/api/admin/config/preview") && adminAssetText.includes("renderConfigPreview") && adminAssetText.includes("Nothing has been saved") && !adminAssetText.includes("renderReadiness(result.readiness);\n    renderConfigPreview"), "Admin assets omitted the non-persisting launch rehearsal or confused preview readiness with recorded readiness.");
  assert(adminAssetText.includes("funnel.parallelAction") && adminAssetText.includes("launch-parallel-action") && adminAssetText.includes('["schedule", "scan", "supply", "profit"]') && adminAssetText.includes("brief.open = true") && adminAssetText.includes("Open scan review"), "Admin assets omitted safe parallel guidance, schedule-aware action filters or direct scan-review navigation.");
  assert(adminAssetText.includes("/api/admin/request-followup-draft") && adminAssetText.includes("Prepare room-scan follow-up") && adminAssetText.includes("Copy complete private follow-up — does not send") && adminAssetText.includes("Founder approval is still required before outreach") && !adminAssetText.includes('fetch("/api/admin/request-followup-draft", { method: "POST"'), "The control desk omitted the copy-only room-scan follow-up or added an automatic send path.");
  assert(adminAsset.ok && adminAsset.headers.get("cache-control") === "no-cache" && adminAssetText.includes("Later refunds, re-cleans and costs") && adminAssetText.includes("/api/admin/job-outcome-adjustments") && adminAssetText.includes("/api/admin/cleaner-availability-requests") && adminAssetText.includes("Pending only — not available to matching") && adminAssetText.includes("confirmationAllowed") && adminAssetText.includes("cannot be confirmed until every screening check") && adminAssetText.includes("First window supplied with application") && adminAssetText.includes("record.firstAvailableDate") && adminAssetText.includes("Copy complete private handoff — does not send") && adminAssetText.includes("the correct private link is included below") && adminAssetText.includes('draft.privateUrl || ""') && !adminAssetText.includes("new URL(draft.privatePath") && adminAssetText.includes("paymentEvidenceReference") && adminAssetText.includes("Externally verified amount") && adminAssetText.includes("customerReceiptReference") && adminAssetText.includes("cleanerPayoutReference") && adminAssetText.includes("visualsReviewed") && adminAssetText.includes("reviewedVisualIds") && adminAssetText.includes("dataset.reviewedVisualId") && adminAssetText.includes("brief-visual-review-progress") && adminAssetText.includes("checklistReviewed") && adminAssetText.includes("brief-visuals-loaded"), "Updated control-desk assets, server-verified dispatch origin, exact per-visual scan-review evidence controls, pending-only pre-approval availability, copy-only dispatch pack, booking payment evidence, final settlement evidence or post-completion adjustment workflow could remain stale or missing.");
  const publicFormAsset = await fetch(`${base}/app.js?v=smoke-test`);
  const publicFormAssetText = await publicFormAsset.text();
  assert(publicFormAsset.ok && publicFormAssetText.includes("focusedEntryRoutes") && publicFormAssetText.includes('document.body.classList.add("entry-route"') && publicFormAssetText.includes("history.replaceState") && publicFormAssetText.includes("enhanceGuidedForm") && publicFormAssetText.includes("step.dataset.guidedStep") && publicFormAssetText.includes("validateCurrentStep") && publicFormAssetText.includes("validateStructuredContactFields") && publicFormAssetText.includes("Enter a valid UK postcode, for example SW1A 1AA.") && publicFormAssetText.includes("Enter a valid phone number with 10 to 15 digits.") && publicFormAssetText.includes("parseCleanerTravelAreas(travelAreas.value).valid") && publicFormAssetText.includes("Add at least one postcode district or comma-separated postcode area") && publicFormAssetText.includes('scrollIntoView({ behavior: "smooth", block: "start" })') && publicFormAssetText.includes("Choose at least one type of cleaning work before continuing.") && publicFormAssetText.includes("data-cleaner-status-link") && publicFormAssetText.includes("cleanerStatusToken") && publicFormAssetText.includes("customerStatusToken") && publicFormAssetText.includes("const continuationLink = briefLink || (cleanerStatusLink && !cleanerStatusLink.hidden ? cleanerStatusLink : null)") && publicFormAssetText.includes("window.location.assign(destination)") && publicFormAssetText.includes("guidedForm?.complete()") && publicFormAssetText.includes('"Idempotency-Key": pending.key') && publicFormAssetText.includes("pendingSubmissions.delete(form)"), "Focused entry routes, continuous private request-to-scan and application-to-tracker journeys, progressive customer/cleaner stages, visible mobile step positioning, early contact/travel feedback, per-stage service validation or safe retry-key handling failed.");
  const cleanerDraftAsset = await fetch(`${base}/cleaner-application-draft.js?v=smoke-test`);
  const cleanerDraftAssetText = await cleanerDraftAsset.text();
  assert(cleanerDraftAsset.ok && joinEntryPageText.includes("data-cleaner-draft-status") && cleanerDraftAssetText.includes("cleanerApplicationDraftLifetimeMs") && publicFormAssetText.includes("enhanceCleanerApplicationDraft") && publicFormAssetText.includes("navigator.onLine === false") && publicFormAssetText.includes("controller.abort()") && publicFormAssetText.includes("clearCleanerApplicationDraft(window.sessionStorage)"), "Cleaner onboarding omitted tab-only draft recovery, offline handling, bounded submission or successful cleanup.");
  const removedCleanerPreviewAsset = await fetch(`${base}/cleaner-application-preview.js?v=smoke-test`);
  assert(removedCleanerPreviewAsset.status === 404 && !publicFormAssetText.includes("cleaner-application-preview") && !publicFormAssetText.includes("readCleanerPreviewInput"), "Removed Cleaner profile-preview code remains publicly shipped or active in the application controller.");
  const contactValidationAsset = await fetch(`${base}/contact-validation.js?v=smoke-test`);
  const contactValidationAssetText = await contactValidationAsset.text();
  assert(contactValidationAsset.ok && contactValidationAssetText.includes("isUkPostcode") && contactValidationAssetText.includes("isPhone") && contactValidationAssetText.includes("isEmail"), "The shared browser/server contact validation rules were not publicly available to the guided forms.");
  const accessSafetyAsset = await fetch(`${base}/access-detail-safety.js?v=smoke-test`);
  const accessSafetyAssetText = await accessSafetyAsset.text();
  assert(accessSafetyAsset.ok && accessSafetyAssetText.includes("containsSensitiveAccessDetails") && accessSafetyAssetText.includes("only after a booking is accepted") && requestEntryPageText.includes("General access approach") && requestEntryPageText.includes("exact access instructions privately only after a booking is accepted") && (requestEntryPageText.match(/data-access-detail-safe/g) || []).length === 3 && publicFormAssetText.includes('querySelectorAll("[data-access-detail-safe]")'), "The public request did not explain and enforce the pre-booking access-secret boundary across its relevant free-text fields.");
  const travelCoverageAsset = await fetch(`${base}/travel-coverage.js?v=smoke-test`);
  const travelCoverageAssetText = await travelCoverageAsset.text();
  assert(travelCoverageAsset.ok && travelCoverageAssetText.includes("parseCleanerTravelAreas") && travelCoverageAssetText.includes("cleanerTravelCoverage"), "The shared browser/server cleaner travel parser was not publicly available to the application form.");

  const invalidPhone = await fetch(`${base}/api/cleaning-requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contactName: "Test Customer", email: "customer@example.com", phone: "123", postcode: "SW1A 1AA", customerType: "Landlord", propertyType: "Flat or house", service: "Rental turnover clean", siteSize: "2 bedrooms and 1 bathroom", accessNotes: "Collect keys from the office", hazards: "None known", consent: true })
  });
  assert(invalidPhone.status === 422, "Invalid phone number was not rejected.");
  const invalidPostcode = await fetch(`${base}/api/cleaning-requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contactName: "Test Customer", email: "customer@example.com", phone: "07123456789", postcode: "Central London", customerType: "Landlord", propertyType: "Flat or house", service: "Rental turnover clean", siteSize: "2 bedrooms and 1 bathroom", accessNotes: "Collect keys from the office", hazards: "None known", consent: true })
  });
  assert(invalidPostcode.status === 422, "Invalid customer postcode was not rejected by the shared server rule.");
  const invalidArrivalWindow = await fetch(`${base}/api/cleaning-requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contactName: "Test Customer", email: "customer@example.com", phone: "07123456789", postcode: "SW1A 1AA", customerType: "Landlord", propertyType: "Flat or house", service: "Rental turnover clean", siteSize: "2 bedrooms and 1 bathroom", accessNotes: "Collect keys from the office", hazards: "None known", preferredTimeWindow: "Before sunrise", consent: true })
  });
  assert(invalidArrivalWindow.status === 422, "Unsupported customer arrival preference was accepted.");
  const invalidFrequency = await fetch(`${base}/api/cleaning-requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contactName: "Test Customer", email: "customer@example.com", phone: "07123456789", postcode: "SW1A 1AA", customerType: "Landlord", propertyType: "Flat or house", service: "Rental turnover clean", siteSize: "2 bedrooms and 1 bathroom", accessNotes: "Collect keys from the office", hazards: "None known", frequency: "Every leap year", consent: true })
  });
  assert(invalidFrequency.status === 422, "Unsupported cleaning frequency was accepted.");
  const missingPreferredDate = await fetch(`${base}/api/cleaning-requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contactName: "Test Customer", email: "customer@example.com", phone: "07123456789", postcode: "SW1A 1AA", customerType: "Landlord", propertyType: "Flat or house", service: "Rental turnover clean", siteSize: "2 bedrooms and 1 bathroom", accessNotes: "Collect keys from the office", hazards: "None known", frequency: "One-off", preferredTimeWindow: "Flexible", consent: true })
  });
  const missingPreferredDateBody = await missingPreferredDate.json();
  assert(missingPreferredDate.status === 422 && missingPreferredDateBody.errors.includes("Preferred date is required."), "A cleaning request without a schedulable date was accepted.");

  const invalid = await fetch(`${base}/api/cleaning-requests`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert(invalid.status === 422, "Invalid cleaning request was not rejected.");

  const oversized = await fetch(`${base}/api/cleaning-requests`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ details: "x".repeat(70 * 1024) }) });
  assert(oversized.status === 413, "Oversized request body was not rejected.");

  const validRequestInput = { contactName: "Test Customer", email: "customer@example.com", phone: "07123456789", postcode: "SW1A 1AA", customerType: "Landlord", propertyType: "Flat or house", service: "Rental turnover clean", siteSize: "2 bedrooms and 1 bathroom", accessNotes: "Collect keys from the office", hazards: "None known", frequency: "Weekly", preferredDate: "2026-07-20", preferredTimeWindow: "Morning (8am–12pm)", consent: true };
  const malformedSubmissionKey = await fetch(`${base}/api/cleaning-requests`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "predictable-retry" }, body: JSON.stringify(validRequestInput) });
  assert(malformedSubmissionKey.status === 400, "A malformed public submission retry key was accepted.");
  const customerSubmissionKey = "11111111-1111-4111-8111-111111111111";
  const validRequestAttempts = await Promise.all([1, 2].map(() => fetch(`${base}/api/cleaning-requests`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": customerSubmissionKey }, body: JSON.stringify(validRequestInput) })));
  const validRequest = validRequestAttempts.find((response) => response.status === 201);
  const replayedRequest = validRequestAttempts.find((response) => response.status === 200);
  assert(validRequest && replayedRequest, "Concurrent customer retries were not reduced to one stored lead.");
  const requestBody = await validRequest.json();
  const replayedRequestBody = await replayedRequest.json();
  assert(validRequest.status === 201 && requestBody.reference.startsWith("REQ-") && /^[A-Za-z0-9_-]{32}$/.test(requestBody.customerStatusToken), "Valid cleaning request failed or omitted its private tracker token.");
  assert(replayedRequestBody.replayed === true && replayedRequestBody.reference === requestBody.reference && replayedRequestBody.customerStatusToken === requestBody.customerStatusToken, "Customer retry did not return the original reference and private tracker token.");
  const changedRequestWithReusedKey = await fetch(`${base}/api/cleaning-requests`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": customerSubmissionKey }, body: JSON.stringify({ ...validRequestInput, service: "One-off deep clean" }) });
  assert(changedRequestWithReusedKey.status === 409, "A customer retry key was reused for different request details.");
  const invalidRequestStatus = await fetch(`${base}/api/request-status`, { headers: { "x-request-token": "not-a-private-request-token" } });
  assert(invalidRequestStatus.status === 404, "Invalid customer tracker token exposed request status.");
  const initialRequestStatus = await fetch(`${base}/api/request-status`, { headers: { "x-request-token": requestBody.customerStatusToken } });
  const initialRequestStatusBody = await initialRequestStatus.json();
  assert(initialRequestStatus.ok && initialRequestStatusBody.current.stage === "room-scan" && initialRequestStatusBody.links.roomScanRequired === true && initialRequestStatusBody.request.reference === requestBody.reference && initialRequestStatusBody.request.frequency === "Weekly" && initialRequestStatusBody.request.preferredDate === "2026-07-20" && initialRequestStatusBody.request.preferredTimeWindow === "Morning (8am–12pm)" && initialRequestStatusBody.scheduleChange.allowed === true && initialRequestStatusBody.scheduleChange.history.length === 0, "New request tracker did not open at room scan with its requested timing and customer-owned pre-booking schedule control.");
  const initialTrackerSerialised = JSON.stringify(initialRequestStatusBody);
  assert(!initialTrackerSerialised.includes("customer@example.com") && !initialTrackerSerialised.includes("07123456789") && !initialTrackerSerialised.includes("Collect keys") && !initialTrackerSerialised.includes("customerStatusToken"), "Customer tracker exposed contact, access or authorisation-token data.");
  const invalidScheduleToken = await fetch(`${base}/api/request-schedule`, { method: "POST", headers: { "content-type": "application/json", "x-request-token": "not-a-private-request-token" }, body: JSON.stringify({ preferredDate: "2026-07-21", preferredTimeWindow: "Flexible", reason: "The property handover date changed.", confirmed: true }) });
  assert(invalidScheduleToken.status === 404, "An invalid private tracker token changed requested timing.");
  const invalidScheduleChange = await fetch(`${base}/api/request-schedule`, { method: "POST", headers: { "content-type": "application/json", "x-request-token": requestBody.customerStatusToken }, body: JSON.stringify({ preferredDate: "2026-02-30", preferredTimeWindow: "Flexible", reason: "The property handover date changed.", confirmed: true }) });
  assert(invalidScheduleChange.status === 422, "An invalid replacement cleaning date was accepted.");
  const scheduleChange = await fetch(`${base}/api/request-schedule`, { method: "POST", headers: { "content-type": "application/json", "x-request-token": requestBody.customerStatusToken }, body: JSON.stringify({ preferredDate: "2026-07-21", preferredTimeWindow: "Afternoon (12pm–5pm)", reason: "The property handover moved to the following afternoon.", confirmed: true }) });
  const scheduleChangeBody = await scheduleChange.json();
  assert(scheduleChange.status === 201 && scheduleChangeBody.reference.startsWith("RSC-") && scheduleChangeBody.preferredDate === "2026-07-21", "A valid customer-owned requested timing change was not recorded.");
  const changedScheduleStatus = await fetch(`${base}/api/request-status`, { headers: { "x-request-token": requestBody.customerStatusToken } });
  const changedScheduleStatusBody = await changedScheduleStatus.json();
  assert(changedScheduleStatusBody.request.preferredDate === "2026-07-21" && changedScheduleStatusBody.request.preferredTimeWindow === "Afternoon (12pm–5pm)" && changedScheduleStatusBody.scheduleChange.originalPreferredDate === "2026-07-20" && changedScheduleStatusBody.scheduleChange.history.length === 1 && changedScheduleStatusBody.scheduleChange.history[0].reason.includes("handover"), "The private tracker did not project the latest customer timing while preserving its original and append-only history.");
  const replayedScheduleChange = await fetch(`${base}/api/request-schedule`, { method: "POST", headers: { "content-type": "application/json", "x-request-token": requestBody.customerStatusToken }, body: JSON.stringify({ preferredDate: "2026-07-21", preferredTimeWindow: "Afternoon (12pm–5pm)", reason: "Repeated browser submission should not create another history item.", confirmed: true }) });
  assert(replayedScheduleChange.status === 200 && (await replayedScheduleChange.json()).replayed === true, "An exact requested timing retry created duplicate schedule history.");
  const restoredSchedule = await fetch(`${base}/api/request-schedule`, { method: "POST", headers: { "content-type": "application/json", "x-request-token": requestBody.customerStatusToken }, body: JSON.stringify({ preferredDate: "2026-07-20", preferredTimeWindow: "Morning (8am–12pm)", reason: "Restore the original test timing for later matching checks.", confirmed: true }) });
  assert(restoredSchedule.status === 201, "A second customer-approved timing change could not be recorded append-only.");
  const restoredScheduleStatus = await fetch(`${base}/api/request-status`, { headers: { "x-request-token": requestBody.customerStatusToken } });
  const restoredScheduleStatusBody = await restoredScheduleStatus.json();
  assert(restoredScheduleStatusBody.request.preferredDate === "2026-07-20" && restoredScheduleStatusBody.scheduleChange.history.length === 2 && !JSON.stringify(restoredScheduleStatusBody).includes("customer@example.com"), "The latest requested timing or tracker privacy was lost after multiple append-only changes.");
  const blockedScanFollowup = await fetch(`${base}/api/admin/request-followup-draft?requestId=${requestBody.reference}`);
  const blockedScanFollowupBody = await blockedScanFollowup.json();
  const blockedScanFollowupSerialised = JSON.stringify(blockedScanFollowupBody);
  assert(blockedScanFollowup.ok && blockedScanFollowupBody.handoffReady === false && blockedScanFollowupBody.privateUrl === "" && blockedScanFollowupBody.sendsAutomatically === false && blockedScanFollowupBody.requiresFounderOutreachApproval === true, "An unverified deployment produced an active or automatic room-scan customer handoff.");
  assert(!blockedScanFollowupSerialised.includes(requestBody.customerStatusToken) && !blockedScanFollowupSerialised.includes("localhost") && !blockedScanFollowupSerialised.includes("127.0.0.1"), "A blocked room-scan follow-up leaked its tracker token or a local address.");
  const unauthorisedScanFollowup = await fetch(`${base}/api/admin/request-followup-draft?requestId=${requestBody.reference}`, { headers: { "x-forwarded-for": "203.0.113.10" } });
  assert(unauthorisedScanFollowup.status === 401, "A proxied room-scan follow-up draft bypassed admin authentication.");

  const emailOnlyBrief = await fetch(`${base}/api/job-briefs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: requestBody.reference, email: "customer@example.com", transcript: "Clean the kitchen worktops.", checklist: ["Kitchen: Clean the kitchen worktops"], photos: [{ area: "Kitchen", note: "Worktops need wiping", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zs7sAAAAASUVORK5CYII=" }], scopeCompleteConfirmed: true, consent: true })
  });
  const emailOnlyBriefBody = await emailOnlyBrief.json();
  assert(emailOnlyBrief.status === 422 && emailOnlyBriefBody.errors?.some((error) => error.includes("private request tracker")) && !("customerStatusToken" in emailOnlyBriefBody), "A request reference and matching email could still attach a room scan or disclose its tracker token.");

  const wrongPrivateTrackerBrief = await fetch(`${base}/api/job-briefs`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-token": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" },
    body: JSON.stringify({ requestId: requestBody.reference, email: "customer@example.com", transcript: "Clean the kitchen worktops.", checklist: ["Kitchen: Clean the kitchen worktops"], photos: [{ area: "Kitchen", note: "Worktops need wiping", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zs7sAAAAASUVORK5CYII=" }], scopeCompleteConfirmed: true, consent: true })
  });
  assert(wrongPrivateTrackerBrief.status === 404, "A different private tracker token attached a room scan despite a matching email.");
  const malformedPrivateTrackerBrief = await fetch(`${base}/api/job-briefs`, { method: "POST", headers: { "content-type": "application/json", "x-request-token": "short-token" }, body: JSON.stringify({ requestId: requestBody.reference, email: "customer@example.com", transcript: "Clean the kitchen worktops.", checklist: ["Kitchen: Clean the kitchen worktops"], photos: [{ area: "Kitchen", note: "Worktops need wiping", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zs7sAAAAASUVORK5CYII=" }], scopeCompleteConfirmed: true, consent: true }) });
  assert(malformedPrivateTrackerBrief.status === 422, "A malformed private tracker token silently fell back to the typed request email.");

  const invalidPhotoBrief = await fetch(`${base}/api/job-briefs`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-token": requestBody.customerStatusToken },
    body: JSON.stringify({ requestId: requestBody.reference, email: "customer@example.com", transcript: "Clean the kitchen worktops.", checklist: ["Kitchen: Clean the kitchen worktops"], photos: [{ area: "Kitchen", note: "Worktops need wiping", dataUrl: "data:image/png;base64,SGVsbG8=" }], scopeCompleteConfirmed: true, consent: true })
  });
  assert(invalidPhotoBrief.status === 422, "Invalid image content was accepted as a property photo.");

  const excessivePhotoBrief = await fetch(`${base}/api/job-briefs`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-token": requestBody.customerStatusToken },
    body: JSON.stringify({ requestId: requestBody.reference, email: "customer@example.com", transcript: "Clean the kitchen.", checklist: ["Kitchen: Clean the worktops"], photos: Array.from({ length: maxBriefPhotos + 1 }, () => ({ area: "Kitchen", note: "Worktops need cleaning", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zs7sAAAAASUVORK5CYII=" })), scopeCompleteConfirmed: true, consent: true })
  });
  const excessivePhotoBriefBody = await excessivePhotoBrief.json();
  assert(excessivePhotoBrief.status === 422 && excessivePhotoBriefBody.errors?.some((error) => error.includes("10 room visuals")), "The server accepted more than the supported whole-property visual limit.");

  const excessiveVideoBrief = await fetch(`${base}/api/job-briefs`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-token": requestBody.customerStatusToken },
    body: JSON.stringify({ requestId: requestBody.reference, email: "customer@example.com", transcript: "Clean the kitchen.", checklist: ["Kitchen: Clean the worktops"], photos: Array.from({ length: maxBriefVideos + 1 }, () => ({ area: "Kitchen", note: "Short kitchen walkthrough", durationSeconds: 8, dataUrl: "data:video/webm;base64,GkXfo59ChoEB" })), scopeCompleteConfirmed: true, consent: true })
  });
  const excessiveVideoBriefBody = await excessiveVideoBrief.json();
  assert(excessiveVideoBrief.status === 422 && excessiveVideoBriefBody.errors?.some((error) => error.includes(`${maxBriefVideos} short room videos`)), "The server accepted too many room videos.");

  const missingRoomNote = await fetch(`${base}/api/job-briefs`, { method: "POST", headers: { "content-type": "application/json", "x-request-token": requestBody.customerStatusToken }, body: JSON.stringify({ requestId: requestBody.reference, email: "customer@example.com", transcript: "Clean the kitchen worktops.", checklist: ["Kitchen: Clean the kitchen worktops"], photos: [{ area: "Kitchen", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zs7sAAAAASUVORK5CYII=" }], scopeCompleteConfirmed: true, consent: true }) });
  assert(missingRoomNote.status === 422, "Room scan accepted a photo without its specific room note.");
  const uncoveredRoom = await fetch(`${base}/api/job-briefs`, { method: "POST", headers: { "content-type": "application/json", "x-request-token": requestBody.customerStatusToken }, body: JSON.stringify({ requestId: requestBody.reference, email: "customer@example.com", transcript: "Clean the kitchen worktops.", checklist: ["Clean the kitchen worktops"], photos: [{ area: "Kitchen", note: "Worktops need wiping", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zs7sAAAAASUVORK5CYII=" }], scopeCompleteConfirmed: true, consent: true }) });
  assert(uncoveredRoom.status === 422, "Room scan accepted a photographed room with no room-labelled cleaner task.");
  const exclusionOnlyBrief = await fetch(`${base}/api/job-briefs`, { method: "POST", headers: { "content-type": "application/json", "x-request-token": requestBody.customerStatusToken }, body: JSON.stringify({ requestId: requestBody.reference, email: "customer@example.com", transcript: "In the kitchen do not clean inside the oven.", checklist: ["Kitchen: Do not clean inside the oven"], photos: [{ area: "Kitchen", note: "Oven is excluded from cleaning", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zs7sAAAAASUVORK5CYII=" }], scopeCompleteConfirmed: true, consent: true }) });
  const exclusionOnlyBriefBody = await exclusionOnlyBrief.json();
  assert(exclusionOnlyBrief.status === 422 && exclusionOnlyBriefBody.errors?.some((error) => error.includes("exclusions alone")) && exclusionOnlyBriefBody.errors?.some((error) => error.includes("room-labelled cleaning task for: Kitchen")), "Server accepted leave-alone boundaries as a quotable photographed-room cleaning scope.");
  const vagueChecklistBrief = await fetch(`${base}/api/job-briefs`, { method: "POST", headers: { "content-type": "application/json", "x-request-token": requestBody.customerStatusToken }, body: JSON.stringify({ requestId: requestBody.reference, transcript: "The kitchen needs cleaning.", checklist: ["Kitchen: clean everything"], photos: [{ area: "Kitchen", note: "Worktops need cleaning", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zs7sAAAAASUVORK5CYII=" }], scopeCompleteConfirmed: true, consent: true }) });
  const vagueChecklistBriefBody = await vagueChecklistBrief.json();
  assert(vagueChecklistBrief.status === 422 && vagueChecklistBriefBody.errors?.some((error) => error.includes("specific Cleaner action")), "Server accepted a vague room-scan checklist instead of asking for an actionable Cleaner instruction.");

  const unconfirmedScopeBrief = await fetch(`${base}/api/job-briefs`, { method: "POST", headers: { "content-type": "application/json", "x-request-token": requestBody.customerStatusToken }, body: JSON.stringify({ requestId: requestBody.reference, email: "customer@example.com", transcript: "Clean the kitchen worktops.", checklist: ["Kitchen: Clean the kitchen worktops"], photos: [{ area: "Kitchen", note: "Worktops need wiping", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zs7sAAAAASUVORK5CYII=" }], consent: true }) });
  const unconfirmedScopeBriefBody = await unconfirmedScopeBrief.json();
  assert(unconfirmedScopeBrief.status === 422 && unconfirmedScopeBriefBody.errors?.some((error) => error.includes("concise cleaner checklist")), "Room scan was accepted without the customer's final concise-scope confirmation.");

  const validBriefInput = { requestId: requestBody.reference, email: "", transcript: "Please wipe every kitchen worktop, mop the kitchen floor and clean inside the oven.", checklist: ["Kitchen: Wipe every kitchen worktop", "Kitchen: Mop the kitchen floor", "Kitchen: Clean inside the oven"], photos: [{ area: "Kitchen", note: "Worktops, floor and inside oven need attention", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zs7sAAAAASUVORK5CYII=" }, { area: "Kitchen", note: "Short walkthrough of the same kitchen scope", durationSeconds: 8, dataUrl: "data:video/webm;base64,GkXfo59ChoEB" }], scopeCompleteConfirmed: true, consent: true, sharePhotosWithSelectedCleaner: true };
  const briefSubmissionKey = "22222222-2222-4222-8222-222222222222";
  const validBriefAttempts = await Promise.all([1, 2].map(() => fetch(`${base}/api/job-briefs`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": briefSubmissionKey, "x-request-token": requestBody.customerStatusToken }, body: JSON.stringify(validBriefInput) })));
  const validBrief = validBriefAttempts.find((response) => response.status === 201);
  const replayedBrief = validBriefAttempts.find((response) => response.status === 200);
  assert(validBrief && replayedBrief, "Concurrent room-scan retries created more than one brief version.");
  const briefBody = await validBrief.json();
  const replayedBriefBody = await replayedBrief.json();
  assert(validBrief.status === 201 && briefBody.reference.startsWith("BRF-") && briefBody.checklist.length === 3 && briefBody.photos.length === 2 && briefBody.photos[1].kind === "video" && briefBody.photos[1].mimeType === "video/webm" && briefBody.photos[1].durationSeconds === 8 && briefBody.scopeSignals?.length === 1 && briefBody.scopeSignals[0].code === "oven-interior" && briefBody.customerScopeConfirmed === true && Date.parse(briefBody.customerScopeConfirmedAt) > 0 && !("customerStatusToken" in briefBody) && briefBody.cleanerPhotoSharingConsent === true, "Valid photo-and-video job brief failed, omitted media metadata or checklist bullets, failed to record customer scope confirmation or price-sensitive oven scope, disclosed the private tracker token or failed to record selected-cleaner media permission.");
  assert(replayedBriefBody.replayed === true && replayedBriefBody.reference === briefBody.reference && replayedBriefBody.photos[0].id === briefBody.photos[0].id, "Room-scan retry did not return the original scan and media references.");
  const changedBriefWithReusedKey = await fetch(`${base}/api/job-briefs`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": briefSubmissionKey, "x-request-token": requestBody.customerStatusToken }, body: JSON.stringify({ ...validBriefInput, transcript: `${validBriefInput.transcript} Also dust the shelves.`, checklist: [...validBriefInput.checklist, "Kitchen: Dust the shelves"] }) });
  assert(changedBriefWithReusedKey.status === 409, "A room-scan retry key was reused for changed scope.");
  const protectedAdminVideo = await fetch(`${base}/api/admin/job-brief-image?briefId=${briefBody.reference}&imageId=${briefBody.photos[1].id}`);
  assert(protectedAdminVideo.ok && protectedAdminVideo.headers.get("content-type") === "video/webm" && protectedAdminVideo.headers.get("cache-control") === "private, no-store" && (await protectedAdminVideo.arrayBuffer()).byteLength > 0, "Control desk could not load the protected short room video.");
  const scanReviewStatus = await fetch(`${base}/api/request-status`, { headers: { "x-request-token": requestBody.customerStatusToken } });
  const scanReviewStatusBody = await scanReviewStatus.json();
  assert(scanReviewStatus.ok && scanReviewStatusBody.current.stage === "scan-review" && scanReviewStatusBody.roomScan.reference === briefBody.reference && scanReviewStatusBody.roomScan.taskCount === 3 && scanReviewStatusBody.links.roomScanRequired === false, "Customer tracker did not show the submitted room scan awaiting review without requesting a duplicate scan.");

  const privateBriefImage = await fetch(`${base}/api/admin/job-brief-image?briefId=${briefBody.reference}&imageId=${briefBody.photos[0].id}`);
  assert(privateBriefImage.ok && privateBriefImage.headers.get("content-type") === "image/png" && (await privateBriefImage.arrayBuffer()).byteLength > 0, "Private job-brief photo could not be retrieved by the local control desk.");
  const proxiedBriefImage = await fetch(`${base}/api/admin/job-brief-image?briefId=${briefBody.reference}&imageId=${briefBody.photos[0].id}`, { headers: { "x-forwarded-for": "203.0.113.10" } });
  assert(proxiedBriefImage.status === 401, "Private job-brief photo bypassed admin authentication.");

  const vagueTravelCleaner = await fetch(`${base}/api/cleaner-applications`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fullName: "Vague Travel Cleaner", email: "vague@example.com", phone: "07123456780", postcode: "SE1 7PB", travelAreas: "South London and nearby", experience: "1–3 years", availability: "Weekdays", serviceTurnovers: true, rightToWork: true, consent: true })
  });
  const vagueTravelCleanerBody = await vagueTravelCleaner.json();
  assert(vagueTravelCleaner.status === 422 && vagueTravelCleanerBody.errors?.some((error) => error.includes("outward postcode district")), "A cleaner application stored vague travel prose without any matchable postcode coverage.");

  const invalidFirstAvailability = await fetch(`${base}/api/cleaner-applications`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fullName: "Invalid Window Cleaner", email: "window@example.com", phone: "07123456788", postcode: "SE1 7PB", travelAreas: "SW1A", experience: "1–3 years", firstAvailableDate: "2026-07-20", firstAvailableStartTime: "15:00", firstAvailableEndTime: "08:00", serviceTurnovers: true, rightToWork: true, consent: true }) });
  const invalidFirstAvailabilityBody = await invalidFirstAvailability.json();
  assert(invalidFirstAvailability.status === 422 && invalidFirstAvailabilityBody.errors?.some((error) => error.includes("future first-availability window")), "Cleaner application accepted an impossible first-availability window.");

  const profilelessCleaner = await fetch(`${base}/api/cleaner-applications`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fullName: "Profileless Cleaner", email: "profileless@example.com", phone: "07123456781", postcode: "SE1 7PB", travelAreas: "SW1A", experience: "1–3 years", firstAvailableDate: "2026-07-20", firstAvailableStartTime: "08:00", firstAvailableEndTime: "15:00", professionalBio: "This eager profile must be ignored by first contact.", languages: "English", equipmentPlan: "confirm-per-opportunity", serviceTurnovers: true, rightToWork: true, consent: true }) });
  const profilelessCleanerBody = await profilelessCleaner.json();
  assert(profilelessCleaner.status === 201 && /^[A-Za-z0-9_-]{32}$/.test(profilelessCleanerBody.cleanerStatusToken), "Core Cleaner application could not be saved before the optional profile step.");
  const profilelessTracker = await fetch(`${base}/api/cleaner-status`, { headers: { "x-cleaner-status-token": profilelessCleanerBody.cleanerStatusToken } });
  const profilelessTrackerBody = await profilelessTracker.json();
  assert(profilelessTracker.ok && profilelessTrackerBody.readiness.profileStarterCaptured === false && profilelessTrackerBody.links.profileStarterSubmissionAllowed === true && profilelessTrackerBody.steps.find((step) => step.key === "profile")?.state === "current" && profilelessTrackerBody.current.nextAction.includes("Complete the private professional profile") && !JSON.stringify(profilelessTrackerBody).includes("eager profile"), "The staged Cleaner application did not ignore eager profile fields and open a private profile-completion step.");
  const prematureCompleteScreening = await fetch(`${base}/api/admin/cleaner-screening`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ cleanerId: profilelessCleanerBody.reference, identityChecked: true, rightToWorkChecked: true, referencesChecked: true, serviceSkillsChecked: true, availabilityCoverageChecked: true, engagementTermsChecked: true, safeguardingDecisionChecked: true }) });
  assert(prematureCompleteScreening.status === 422, "Screening was marked complete before the Cleaner supplied professional profile details.");
  const profileUpdateKey = "23232323-2323-4232-8232-232323232323";
  const profileUpdateInput = { professionalBio: "I prepare rental homes carefully and follow every agreed room task.", languages: "English, Romanian", equipmentPlan: "confirm-per-opportunity" };
  const profileUpdate = await fetch(`${base}/api/cleaner-profile-starter`, { method: "POST", headers: { "content-type": "application/json", "x-cleaner-status-token": profilelessCleanerBody.cleanerStatusToken, "idempotency-key": profileUpdateKey }, body: JSON.stringify(profileUpdateInput) });
  const profileUpdateBody = await profileUpdate.json();
  const profileUpdateReplay = await fetch(`${base}/api/cleaner-profile-starter`, { method: "POST", headers: { "content-type": "application/json", "x-cleaner-status-token": profilelessCleanerBody.cleanerStatusToken, "idempotency-key": profileUpdateKey }, body: JSON.stringify(profileUpdateInput) });
  const profileUpdateReplayBody = await profileUpdateReplay.json();
  const changedProfileReplay = await fetch(`${base}/api/cleaner-profile-starter`, { method: "POST", headers: { "content-type": "application/json", "x-cleaner-status-token": profilelessCleanerBody.cleanerStatusToken, "idempotency-key": profileUpdateKey }, body: JSON.stringify({ ...profileUpdateInput, languages: "English" }) });
  assert(profileUpdate.status === 201 && profileUpdateBody.profile.captured === true && profileUpdateReplay.status === 200 && profileUpdateReplayBody.replayed === true && changedProfileReplay.status === 409, "Private profile completion was not validated and idempotent.");
  const completedProfileTracker = await fetch(`${base}/api/cleaner-status`, { headers: { "x-cleaner-status-token": profilelessCleanerBody.cleanerStatusToken } });
  const completedProfileTrackerBody = await completedProfileTracker.json();
  assert(completedProfileTracker.ok && completedProfileTrackerBody.readiness.profileStarterCaptured === true && completedProfileTrackerBody.application.profileStarter.professionalBio === profileUpdateInput.professionalBio && completedProfileTrackerBody.application.profileStarter.languages.join(",") === "English,Romanian" && completedProfileTrackerBody.steps.find((step) => step.key === "profile")?.state === "complete", "The Cleaner tracker did not safely project the completed private profile back to its owner.");

  const validCleanerInput = { fullName: "Test Cleaner", email: "cleaner@example.com", phone: "07123456789", postcode: "SE1 7PB", travelAreas: "SW1A and South London", experience: "1–3 years", availability: "Weekdays", firstAvailableDate: "2026-07-20", firstAvailableStartTime: "08:00", firstAvailableEndTime: "15:00", serviceTurnovers: true, rightToWork: true, consent: true };
  const validCleanerProfileInput = { professionalBio: "I clean rental homes carefully and work through every agreed room task.", languages: "English, Polish", equipmentPlan: "confirm-per-opportunity" };
  const cleanerSubmissionKey = "33333333-3333-4333-8333-333333333333";
  const validCleanerAttempts = await Promise.all([1, 2].map(() => fetch(`${base}/api/cleaner-applications`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": cleanerSubmissionKey }, body: JSON.stringify(validCleanerInput) })));
  const validCleaner = validCleanerAttempts.find((response) => response.status === 201);
  const replayedCleaner = validCleanerAttempts.find((response) => response.status === 200);
  assert(validCleaner && replayedCleaner, "Concurrent cleaner retries were not reduced to one application.");
  const cleanerBody = await validCleaner.json();
  const replayedCleanerBody = await replayedCleaner.json();
  assert(validCleaner.status === 201 && cleanerBody.reference.startsWith("CLN-") && /^[A-Za-z0-9_-]{32}$/.test(cleanerBody.cleanerStatusToken), "Valid cleaner application failed or omitted its private tracker token.");
  assert(replayedCleanerBody.replayed === true && replayedCleanerBody.reference === cleanerBody.reference && replayedCleanerBody.cleanerStatusToken === cleanerBody.cleanerStatusToken, "Cleaner retry did not return the original application reference and private tracker token.");
  const changedCleanerWithReusedKey = await fetch(`${base}/api/cleaner-applications`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": cleanerSubmissionKey }, body: JSON.stringify({ ...validCleanerInput, availability: "Weekends" }) });
  assert(changedCleanerWithReusedKey.status === 409, "A cleaner retry key was reused for different application details.");
  const validCleanerProfile = await fetch(`${base}/api/cleaner-profile-starter`, { method: "POST", headers: { "content-type": "application/json", "x-cleaner-status-token": cleanerBody.cleanerStatusToken, "idempotency-key": "45454545-4545-4545-8545-454545454545" }, body: JSON.stringify(validCleanerProfileInput) });
  assert(validCleanerProfile.status === 201, "The streamlined Cleaner application did not continue into its private profile step.");
  const invalidCleanerStatus = await fetch(`${base}/api/cleaner-status`, { headers: { "x-cleaner-status-token": "not-a-private-cleaner-token" } });
  assert(invalidCleanerStatus.status === 404, "Invalid cleaner tracker token exposed application status.");
  const initialCleanerStatus = await fetch(`${base}/api/cleaner-status`, { headers: { "x-cleaner-status-token": cleanerBody.cleanerStatusToken } });
  const initialCleanerStatusBody = await initialCleanerStatus.json();
  assert(initialCleanerStatus.ok && initialCleanerStatusBody.current.stage === "application-review" && initialCleanerStatusBody.application.reference === cleanerBody.reference && initialCleanerStatusBody.application.profileStarter?.captured === true && initialCleanerStatusBody.application.profileStarter?.languageCount === 2 && initialCleanerStatusBody.application.firstAvailability?.availableDate === "2026-07-20" && initialCleanerStatusBody.application.firstAvailability?.startTime === "08:00" && initialCleanerStatusBody.application.firstAvailability?.endTime === "15:00" && initialCleanerStatusBody.application.firstAvailability?.status === "unconfirmed" && initialCleanerStatusBody.application.firstAvailability?.future === true && initialCleanerStatusBody.readiness.profileStarterCaptured === true && initialCleanerStatusBody.readiness.firstAvailabilityCaptured === true && initialCleanerStatusBody.readiness.readyForOpportunities === false && initialCleanerStatusBody.links.profileStarterSubmissionAllowed === true && initialCleanerStatusBody.links.availabilitySubmissionAllowed === true && initialCleanerStatusBody.steps.find((step) => step.key === "application")?.state === "complete" && initialCleanerStatusBody.steps.find((step) => step.key === "profile")?.state === "complete" && initialCleanerStatusBody.steps.find((step) => step.key === "availability")?.detail.includes("not confirmed for matching"), "New cleaner tracker did not safely acknowledge the editable private profile starter, retain the unconfirmed future first window, allow pending-only availability updates or open at received-but-not-screened status.");
  const initialCleanerTrackerSerialised = JSON.stringify(initialCleanerStatusBody);
  assert(!initialCleanerTrackerSerialised.includes("Test Cleaner") && !initialCleanerTrackerSerialised.includes("cleaner@example.com") && !initialCleanerTrackerSerialised.includes("07123456789") && !initialCleanerTrackerSerialised.includes("SE1 7PB") && !initialCleanerTrackerSerialised.includes("SW1A") && !initialCleanerTrackerSerialised.includes("cleanerStatusToken") && initialCleanerTrackerSerialised.includes("I clean rental homes") && initialCleanerTrackerSerialised.includes("Polish"), "Cleaner tracker exposed identity, contact, travel or authorisation-token data, or failed to return the applicant's own editable profile details.");
  const availabilityRequestKey = "44444444-4444-4444-8444-444444444444";
  const availabilityRequestInput = { availableDate: "2026-07-20", startTime: "08:00", endTime: "15:00", note: "Available after the morning train." };
  const earlyAvailability = await fetch(`${base}/api/cleaner-availability-requests`, { method: "POST", headers: { "content-type": "application/json", "x-cleaner-status-token": cleanerBody.cleanerStatusToken, "idempotency-key": availabilityRequestKey }, body: JSON.stringify(availabilityRequestInput) });
  const availabilityRequestBody = await earlyAvailability.json();
  const earlyAvailabilityReplay = await fetch(`${base}/api/cleaner-availability-requests`, { method: "POST", headers: { "content-type": "application/json", "x-cleaner-status-token": cleanerBody.cleanerStatusToken, "idempotency-key": availabilityRequestKey }, body: JSON.stringify(availabilityRequestInput) });
  const earlyAvailabilityReplayBody = await earlyAvailabilityReplay.json();
  const changedEarlyAvailabilityReplay = await fetch(`${base}/api/cleaner-availability-requests`, { method: "POST", headers: { "content-type": "application/json", "x-cleaner-status-token": cleanerBody.cleanerStatusToken, "idempotency-key": availabilityRequestKey }, body: JSON.stringify({ ...availabilityRequestInput, endTime: "14:00" }) });
  const earlyAvailabilityTracker = await fetch(`${base}/api/cleaner-status`, { headers: { "x-cleaner-status-token": cleanerBody.cleanerStatusToken } });
  const earlyAvailabilityTrackerBody = await earlyAvailabilityTracker.json();
  const prematureAvailabilityConfirmation = await fetch(`${base}/api/admin/cleaner-availability-requests`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: availabilityRequestBody.request.reference, decision: "confirmed", note: "Test-only premature confirmation must fail." }) });
  assert(earlyAvailability.status === 201 && availabilityRequestBody.request.status === "pending" && earlyAvailabilityReplay.status === 200 && earlyAvailabilityReplayBody.replayed === true && changedEarlyAvailabilityReplay.status === 409, "An applicant could not keep exact future availability current safely and idempotently during review.");
  assert(earlyAvailabilityTracker.ok && earlyAvailabilityTrackerBody.readiness.pendingAvailabilityWindows === 1 && earlyAvailabilityTrackerBody.readiness.readyForOpportunities === false && earlyAvailabilityTrackerBody.links.availabilitySubmissionAllowed === true && prematureAvailabilityConfirmation.status === 422, "Pending pre-approval availability became matchable, confirmable or hidden from its private owner.");

  const adminRecords = await fetch(`${base}/api/admin/records`);
  const adminBody = await adminRecords.json();
  assert(adminRecords.ok && adminBody.records.length === 3, "Admin records did not load the customer and both staged/full Cleaner applications.");
  assert(!JSON.stringify(adminBody.records).includes("submissionKey") && !JSON.stringify(adminBody.records).includes("submissionFingerprint") && !JSON.stringify(adminBody.records).includes("customerStatusToken") && !JSON.stringify(adminBody.records).includes("cleanerStatusToken"), "Internal retry or private tracker authorisation metadata leaked into the control-desk records API.");
  assert(adminBody.records.find((record) => record.id === requestBody.reference)?.briefs?.length === 1 && adminBody.records.find((record) => record.id === requestBody.reference)?.briefs?.[0]?.id === briefBody.reference && adminBody.records.find((record) => record.id === requestBody.reference)?.briefs?.[0]?.customerScopeConfirmed === true && Date.parse(adminBody.records.find((record) => record.id === requestBody.reference)?.briefs?.[0]?.customerScopeConfirmedAt) > 0, "Photo job brief or its customer scope confirmation was not attached to the request, or an unconfirmed attempt was stored.");
  assert(adminBody.records.find((record) => record.id === requestBody.reference)?.briefs?.[0]?.status === "landlord-draft", "New photo job brief did not enter the human review queue.");
  assert(adminBody.records.find((record) => record.id === requestBody.reference)?.dispatchActions?.some((action) => action.code === "review-scan" && action.severity === "high"), "Submitted room scan was missing from the founder-action queue.");
  assert(adminBody.records.find((record) => record.id === cleanerBody.reference)?.dispatchActions?.some((action) => action.code === "review-cleaner" && action.severity === "high"), "New cleaner application was missing from the founder-action queue.");
  assert(adminBody.records.find((record) => record.id === cleanerBody.reference)?.profileStarter?.captured === true && adminBody.records.find((record) => record.id === cleanerBody.reference)?.professionalBio === validCleanerProfileInput.professionalBio && adminBody.records.find((record) => record.id === cleanerBody.reference)?.languages?.length === 2 && adminBody.records.find((record) => record.id === cleanerBody.reference)?.profileStarter?.equipmentPlanLabel.includes("agreed for each opportunity") && adminBody.records.find((record) => record.id === cleanerBody.reference)?.firstAvailableDate === "2026-07-20" && adminBody.records.find((record) => record.id === cleanerBody.reference)?.firstAvailableStartTime === "08:00" && adminBody.records.find((record) => record.id === cleanerBody.reference)?.firstAvailableEndTime === "15:00" && adminBody.records.find((record) => record.id === cleanerBody.reference)?.cleanerAvailability?.length === 0, "The private founder view lost the tracker-completed profile or application-supplied first window, or treated unverified evidence as public/confirmed.");
  assert(adminBody.records.find((record) => record.id === profilelessCleanerBody.reference)?.profileStarter?.captured === true && adminBody.records.find((record) => record.id === profilelessCleanerBody.reference)?.professionalBio === profileUpdateInput.professionalBio && adminBody.records.find((record) => record.id === profilelessCleanerBody.reference)?.languages?.includes("Romanian") && !JSON.stringify(adminBody.records).includes(profileUpdateKey), "The founder view did not merge the append-only private profile update safely.");
  assert(adminBody.dispatchSummary.high >= 2 && adminBody.dispatchSummary.urgent === 0, "Dispatch summary did not prioritise initial scan and supply review correctly.");
  assert(adminBody.launchFunnel?.stages?.find((stage) => stage.key === "requests")?.count === 1 && adminBody.launchFunnel?.stages?.find((stage) => stage.key === "scans")?.count === 1 && adminBody.launchFunnel?.stages?.find((stage) => stage.key === "reviewed")?.count === 0 && adminBody.launchFunnel?.dispatchReadyCleaners === 0 && adminBody.launchFunnel?.goal?.achieved === false && adminBody.launchFunnel?.bottleneck?.key === "launch-readiness" && adminBody.launchFunnel?.parallelAction?.key === "scan-review", "Initial first-booking funnel did not separate the incomplete launch gate from the actionable submitted-scan review, unavailable supply or stored request.");
  assert(!JSON.stringify(adminBody.launchFunnel).includes("customer@example.com") && !JSON.stringify(adminBody.launchFunnel).includes("07123456789"), "Launch funnel leaked customer contact data.");
  assert(!JSON.stringify(adminBody.records.flatMap((record) => record.dispatchActions || [])).includes("customer@example.com"), "Dispatch actions leaked customer contact data into operational labels.");

  const proxiedAdmin = await fetch(`${base}/api/admin/records`, { headers: { "x-forwarded-for": "203.0.113.10" } });
  assert(proxiedAdmin.status === 401, "Proxied admin request bypassed authentication.");

  const proxiedConfigPreview = await fetch(`${base}/api/admin/config/preview`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.10" }, body: "{}" });
  assert(proxiedConfigPreview.status === 401, "Unauthorised remote configuration rehearsal bypassed the admin boundary.");
  const crossOriginConfigPreview = await fetch(`${base}/api/admin/config/preview`, { method: "POST", headers: { "content-type": "application/json", "origin": "https://attacker.example", "x-forwarded-for": "203.0.113.10", "x-admin-key": "test-admin-key" }, body: "{}" });
  assert(crossOriginConfigPreview.status === 403, "Cross-site configuration rehearsal bypassed the exact-origin boundary.");

  const authorisedProxiedAdmin = await fetch(`${base}/api/admin/records`, { headers: { "x-forwarded-for": "203.0.113.10", "x-admin-key": "test-admin-key" } });
  assert(authorisedProxiedAdmin.ok, "Admin key did not authorise proxied request.");

  const initialConfig = await fetch(`${base}/api/admin/config`);
  const initialConfigBody = await initialConfig.json();
  assert(initialConfig.ok && initialConfigBody.readiness.completed === 0 && initialConfigBody.readiness.next?.key === "identity" && initialConfigBody.readiness.missing?.identity?.includes("legal owner name") && initialConfigBody.readiness.missing?.contact?.includes("domain and deployment evidence naming this hostname") && initialConfigBody.readiness.missing?.contact?.includes("public website verification date") && initialConfigBody.readiness.missing?.insurance?.includes("insurance provider") && initialConfigBody.readiness.missing?.payments?.includes("provider verification date") && initialConfigBody.storageSafety?.safeForPrivatePilot === true && initialConfigBody.storageSafety?.relocationRequired === false && initialConfigBody.activationReadiness?.completed === 1 && initialConfigBody.activationReadiness?.total === 6 && initialConfigBody.activationReadiness?.ready === false && initialConfigBody.activationReadiness?.checks?.privateDataStorage === true && initialConfigBody.activationReadiness?.next?.key === "marketplaceServices" && !JSON.stringify(initialConfigBody.activationReadiness).includes("DATABASE_URL") && initialConfigBody.economics.available === false, "Initial launch readiness did not separate exact founder decisions, current technical activation, safe temporary storage or incomplete economics without exposing environment details.");
  const navigableReadinessLabels = [...new Set([...Object.values(initialConfigBody.readiness.missing).flat(), "viable margin and percentage-cost stack"])].filter((label) => label !== "private data folder outside cloud-sync services");
  assert(navigableReadinessLabels.every((label) => readinessNavigatorText.includes(`"${label}":`)), "At least one server-reported launch requirement has no guided form destination.");

  const completeConfig = { legalOwnerName: "Test Owner", businessStructure: "Sole trader", legalBusinessName: "Test Homle", tradingAddress: "1 Test Street, London", supportEmail: "support@example.com", supportPhone: "07123456789", publicSiteUrl: "https://tideway.example.com", publicSiteEvidenceNote: "tideway.example.com ownership, HTTPS certificate and deployed Homle pages were checked.", publicSiteVerifiedDate: "2026-07-14", pilotPostcodes: "SW1A, SW2, SW4", cleanerModel: "Worker", insuranceStatus: "active", insuranceProvider: "Test Insurer", insuranceEvidenceNote: "Test policy cover, limit and securely stored certificate were reviewed.", insuranceReviewDate: "2026-12-31", paymentProviderName: "TestPay", paymentProviderStatus: "live", paymentProviderEvidenceNote: "Test live account, payout destination and refund route were reviewed.", paymentProviderVerifiedDate: "2026-07-14", refundProcess: "Owner approves and records refunds within five working days.", customerHourlyRate: 30, cleanerHourlyPay: 18, labourOnCostPercent: 5, minimumHours: 2, minimumContributionMarginPercent: 25, paymentFeePercent: 1, paymentFeeFixed: 0, travelCostPerJob: 1, suppliesCostPerJob: 1, riskContingencyPercent: 1, variableCostsConfirmed: true, cancellationPolicy: "24 hours notice.", paymentTiming: "Payment authorised at booking and captured after completion", customerQuoteValidityHours: 24, cleanerOpportunityValidityHours: 12, inactiveMediaRetentionDays: 90, completedMediaRetentionDays: 365 };
  const configPath = path.join(testDataDir, "business-config.json");
  const configBeforePreview = await readFile(configPath, "utf8").catch((error) => error.code === "ENOENT" ? "ABSENT" : Promise.reject(error));
  const configPreview = await fetch(`${base}/api/admin/config/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(completeConfig) });
  const configPreviewBody = await configPreview.json();
  const configAfterPreview = await readFile(configPath, "utf8").catch((error) => error.code === "ENOENT" ? "ABSENT" : Promise.reject(error));
  assert(configPreview.ok && configPreviewBody.ok === true && configPreviewBody.persisted === false && configPreviewBody.readiness.ready === true && !Object.hasOwn(configPreviewBody, "config") && configPreviewBody.economics.available === true && configPreviewBody.economics.costAssumptionsConfirmed === true && configPreviewBody.economics.minimumHours === 2 && configPreviewBody.economics.configured.customerTotal === 60 && configPreviewBody.economics.configured.cleanerPay === 36 && configPreviewBody.economics.configured.nonCleanerCosts === 5 && configPreviewBody.economics.configured.contribution === 19 && configPreviewBody.economics.configuredMeetsTarget === true && configPreviewBody.economics.targetSafeCustomerRate === 27.27 && configPreviewBody.economics.targetSafeCustomerTotal === 54.54 && configPreviewBody.economics.targetRateSupported === true && configPreviewBody.economics.configuredRateGap === 0 && configAfterPreview === configBeforePreview, "Launch readiness rehearsal wrote configuration, leaked submitted details or returned incorrect minimum-job economics.");
  const underpricedConfigPreview = await fetch(`${base}/api/admin/config/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, customerHourlyRate: 25 }) });
  const underpricedConfigPreviewBody = await underpricedConfigPreview.json();
  const configAfterUnderpricedPreview = await readFile(configPath, "utf8").catch((error) => error.code === "ENOENT" ? "ABSENT" : Promise.reject(error));
  assert(underpricedConfigPreview.ok && underpricedConfigPreviewBody.persisted === false && underpricedConfigPreviewBody.readiness.checks.economics === false && underpricedConfigPreviewBody.economics.available === true && underpricedConfigPreviewBody.economics.configuredMeetsTarget === false && underpricedConfigPreviewBody.economics.configured.contribution === 9.2 && underpricedConfigPreviewBody.economics.configured.marginPercent === 18.4 && underpricedConfigPreviewBody.economics.targetSafeCustomerRate === 27.27 && underpricedConfigPreviewBody.economics.configuredRateGap === 2.27 && configAfterUnderpricedPreview === configBeforePreview, "No-save rehearsal failed to quantify an underpriced minimum job or changed recorded configuration.");
  const unsupportedTargetPreview = await fetch(`${base}/api/admin/config/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, customerHourlyRate: 10000, cleanerHourlyPay: 9999 }) });
  const unsupportedTargetPreviewBody = await unsupportedTargetPreview.json();
  assert(unsupportedTargetPreview.ok && unsupportedTargetPreviewBody.economics.available === true && unsupportedTargetPreviewBody.economics.targetSafeCustomerRate > 10000 && unsupportedTargetPreviewBody.economics.targetRateSupported === false && unsupportedTargetPreviewBody.readiness.checks.economics === false, "Rehearsal presented an unattainable target rate as supported proposal pricing.");
  const invalidConfigPreview = await fetch(`${base}/api/admin/config/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, publicSiteUrl: "http://unsafe.example.com" }) });
  const invalidConfigPreviewBody = await invalidConfigPreview.json();
  const configAfterInvalidPreview = await readFile(configPath, "utf8").catch((error) => error.code === "ENOENT" ? "ABSENT" : Promise.reject(error));
  assert(invalidConfigPreview.status === 422 && invalidConfigPreviewBody.persisted === false && invalidConfigPreviewBody.errors.some((error) => error.includes("must be HTTPS")) && configAfterInvalidPreview === configBeforePreview, "Invalid readiness rehearsal changed configuration or hid its validation failure.");
  const savedConfig = await fetch(`${base}/api/admin/config`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(completeConfig)
  });
  const savedConfigBody = await savedConfig.json();
  assert(savedConfig.ok && savedConfigBody.readiness.ready === true && savedConfigBody.readiness.next === null && Object.values(savedConfigBody.readiness.missing).every((items) => items.length === 0), "Complete evidence-backed launch settings did not pass every readiness check.");
  const missingPublicOrigin = await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, publicSiteUrl: "" }) });
  const missingPublicOriginBody = await missingPublicOrigin.json();
  assert(missingPublicOrigin.ok && missingPublicOriginBody.readiness.ready === false && missingPublicOriginBody.readiness.checks.contact === false && missingPublicOriginBody.readiness.missing.contact.includes("valid public HTTPS website origin"), "Missing public website origin passed launch readiness.");
  const unsupportedPublicOrigin = await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, publicSiteEvidenceNote: "", publicSiteVerifiedDate: "" }) });
  const unsupportedPublicOriginBody = await unsupportedPublicOrigin.json();
  assert(unsupportedPublicOrigin.ok && unsupportedPublicOriginBody.readiness.checks.contact === false && unsupportedPublicOriginBody.readiness.missing.contact.includes("domain and deployment evidence naming this hostname") && unsupportedPublicOriginBody.readiness.missing.contact.includes("public website verification date"), "A typed public origin passed readiness without domain and deployment evidence.");
  const mismatchedPublicEvidence = await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, publicSiteUrl: "https://moved.tideway.example.com" }) });
  assert(mismatchedPublicEvidence.status === 422, "Evidence naming an old hostname was accepted for a changed public origin.");
  const futurePublicVerification = await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, publicSiteVerifiedDate: "2026-12-31" }) });
  assert(futurePublicVerification.status === 422, "A future public-site verification date was accepted.");
  const insecurePublicOrigin = await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, publicSiteUrl: "http://tideway.example.com" }) });
  const insecurePublicOriginBody = await insecurePublicOrigin.json();
  assert(insecurePublicOrigin.status === 422 && insecurePublicOriginBody.errors.some((error) => error.includes("must be HTTPS")), "An insecure public website origin was stored for private links.");
  const localPublicOrigin = await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, publicSiteUrl: "https://127.0.0.1:4173" }) });
  assert(localPublicOrigin.status === 422, "A loopback HTTPS origin passed the public booking-link gate.");
  const pathPublicOrigin = await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, publicSiteUrl: "https://tideway.example.com/customer?token=wrong" }) });
  assert(pathPublicOrigin.status === 422, "A public website origin with a path or query was accepted.");
  const unsupportedInsuranceClaim = await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, insuranceProvider: "", insuranceEvidenceNote: "", insuranceReviewDate: "" }) });
  const unsupportedInsuranceClaimBody = await unsupportedInsuranceClaim.json();
  assert(unsupportedInsuranceClaim.ok && unsupportedInsuranceClaimBody.readiness.checks.insurance === false && unsupportedInsuranceClaimBody.readiness.missing.insurance.includes("insurance provider") && unsupportedInsuranceClaimBody.readiness.missing.insurance.includes("future policy expiry or review date"), "An active-insurance selection passed readiness without supporting evidence.");
  const expiredInsurance = await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, insuranceReviewDate: "2026-01-01" }) });
  const expiredInsuranceBody = await expiredInsurance.json();
  assert(expiredInsurance.ok && expiredInsuranceBody.readiness.checks.insurance === false && expiredInsuranceBody.readiness.missing.insurance.includes("future policy expiry or review date"), "Expired insurance evidence passed launch readiness.");
  const unverifiedLivePayments = await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, paymentProviderEvidenceNote: "", paymentProviderVerifiedDate: "" }) });
  const unverifiedLivePaymentsBody = await unverifiedLivePayments.json();
  assert(unverifiedLivePayments.ok && unverifiedLivePaymentsBody.readiness.checks.payments === false && unverifiedLivePaymentsBody.readiness.missing.payments.includes("provider verification evidence summary"), "A live-payment selection passed readiness without verification evidence.");
  const futurePaymentVerification = await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, paymentProviderVerifiedDate: "2026-12-31" }) });
  assert(futurePaymentVerification.status === 422, "A future payment-provider verification date was accepted.");
  const invalidPilotArea = await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, pilotPostcodes: "South London" }) });
  assert(invalidPilotArea.status === 422, "Invalid free-text pilot area was accepted instead of outward postcode codes.");

  const missingMarginFloor = await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, minimumContributionMarginPercent: 0 }) });
  const missingMarginFloorBody = await missingMarginFloor.json();
  assert(missingMarginFloor.ok && missingMarginFloorBody.readiness.ready === false && missingMarginFloorBody.readiness.checks.economics === false, "Missing founder margin floor did not block launch readiness.");
  const impossibleMarginFloor = await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, minimumContributionMarginPercent: 100 }) });
  assert(impossibleMarginFloor.status === 422, "Impossible contribution-margin floor was accepted.");
  const unconfirmedCosts = await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, variableCostsConfirmed: false }) });
  const unconfirmedCostsBody = await unconfirmedCosts.json();
  assert(unconfirmedCosts.ok && unconfirmedCostsBody.readiness.ready === false && unconfirmedCostsBody.readiness.checks.economics === false, "Unconfirmed variable-cost assumptions passed launch readiness.");
  const excessiveContingency = await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, riskContingencyPercent: 51 }) });
  assert(excessiveContingency.status === 422, "An excessive risk contingency assumption was accepted.");
  const excessiveLabourOnCost = await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, labourOnCostPercent: 101 }) });
  assert(excessiveLabourOnCost.status === 422, "An excessive labour on-cost assumption was accepted.");
  const undercostedMinimumJob = await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, labourOnCostPercent: 50 }) });
  const undercostedMinimumJobBody = await undercostedMinimumJob.json();
  assert(undercostedMinimumJob.ok && undercostedMinimumJobBody.readiness.checks.economics === false && undercostedMinimumJobBody.readiness.missing.economics.includes("configured minimum job meets the contribution-margin floor"), "Launch readiness passed a configured minimum job that missed its margin floor after labour on-costs.");
  const impossibleCostStack = await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, minimumContributionMarginPercent: 80, paymentFeePercent: 19, riskContingencyPercent: 1 }) });
  assert(impossibleCostStack.status === 422, "A margin and percentage-cost stack with no viable price was accepted.");
  const overflowConfig = await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, customerHourlyRate: "1e309" }) });
  assert(overflowConfig.status === 422, "A non-finite launch pricing value was accepted into business configuration.");
  const impossibleMinimumHours = await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, minimumHours: 17 }) });
  assert(impossibleMinimumHours.status === 422, "Business configuration accepted minimum hours above the proposal duration limit.");
  await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(completeConfig) });

  const testOnlyPayments = await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, paymentProviderStatus: "testing" }) });
  const testOnlyPaymentsBody = await testOnlyPayments.json();
  assert(testOnlyPayments.ok && testOnlyPaymentsBody.readiness.ready === false && testOnlyPaymentsBody.readiness.checks.payments === false, "Test-mode payment provider did not block launch readiness.");
  await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(completeConfig) });
  const undecidedCleanerModel = await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, cleanerModel: "Undecided" }) });
  const undecidedCleanerModelBody = await undecidedCleanerModel.json();
  assert(undecidedCleanerModel.ok && undecidedCleanerModelBody.readiness.ready === false && undecidedCleanerModelBody.readiness.checks.operatingRules === false, "Undecided cleaner engagement model passed launch readiness.");
  const missingOfferWindows = await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, customerQuoteValidityHours: 0, cleanerOpportunityValidityHours: 0 }) });
  const missingOfferWindowsBody = await missingOfferWindows.json();
  assert(missingOfferWindows.ok && missingOfferWindowsBody.readiness.ready === false && missingOfferWindowsBody.readiness.checks.operatingRules === false, "Missing founder-controlled offer windows passed launch readiness.");
  const excessiveOfferWindow = await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, customerQuoteValidityHours: 169 }) });
  assert(excessiveOfferWindow.status === 422, "An excessive customer response window was accepted.");
  const missingMediaRetention = await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, inactiveMediaRetentionDays: 0, completedMediaRetentionDays: 0 }) });
  const missingMediaRetentionBody = await missingMediaRetention.json();
  assert(missingMediaRetention.ok && missingMediaRetentionBody.readiness.checks.operatingRules === false && missingMediaRetentionBody.readiness.missing.operatingRules.includes("inactive-enquiry media retention period"), "Missing private-media retention decisions passed launch readiness.");
  const invalidMediaRetention = await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, inactiveMediaRetentionDays: 3651 }) });
  assert(invalidMediaRetention.status === 422, "An excessive private-media retention period was accepted.");
  await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(completeConfig) });

  const retentionRequest = await fetch(`${base}/api/cleaning-requests`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contactName: "Retention Test", email: "retention@example.com", phone: "07123456788", postcode: "SW1A 1AA", customerType: "Landlord", propertyType: "Flat or house", service: "Rental turnover clean", siteSize: "Studio", accessNotes: "Test-only access note", hazards: "None known", preferredDate: "2026-07-20", preferredTimeWindow: "Flexible", consent: true }) });
  const retentionRequestBody = await retentionRequest.json();
  const verifiedScanFollowup = await fetch(`${base}/api/admin/request-followup-draft?requestId=${retentionRequestBody.reference}`);
  const verifiedScanFollowupBody = await verifiedScanFollowup.json();
  const expectedScanUrl = `https://tideway.example.com/request-status#${retentionRequestBody.customerStatusToken}`;
  assert(verifiedScanFollowup.ok && verifiedScanFollowupBody.handoffReady === true && verifiedScanFollowupBody.privateUrl === expectedScanUrl && verifiedScanFollowupBody.recipient.email === "retention@example.com" && !Object.hasOwn(verifiedScanFollowupBody.recipient, "phone") && verifiedScanFollowupBody.sendsAutomatically === false, "Verified public-site evidence did not produce the exact recipient-isolated, copy-only room-scan handoff.");
  assert(!JSON.stringify(verifiedScanFollowupBody).includes("127.0.0.1") && !JSON.stringify(verifiedScanFollowupBody).includes("localhost"), "A verified room-scan handoff mixed in a local development address.");
  const retentionBrief = await fetch(`${base}/api/job-briefs`, { method: "POST", headers: { "content-type": "application/json", "x-request-token": retentionRequestBody.customerStatusToken }, body: JSON.stringify({ requestId: retentionRequestBody.reference, email: "retention@example.com", transcript: "Clean the kitchen worktops.", checklist: ["Kitchen: Clean the kitchen worktops"], photos: [{ area: "Kitchen", note: "Test-only worktop photo", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zs7sAAAAASUVORK5CYII=" }], scopeCompleteConfirmed: true, consent: true }) });
  const retentionBriefBody = await retentionBrief.json();
  const duplicateScanFollowup = await fetch(`${base}/api/admin/request-followup-draft?requestId=${retentionRequestBody.reference}`);
  assert(duplicateScanFollowup.status === 409, "A submitted room scan still produced a duplicate customer scan reminder.");
  const closeRetentionRequest = await fetch(`${base}/api/admin/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: retentionRequestBody.reference, kind: "request", status: "lost" }) });
  assert(retentionRequest.status === 201 && retentionBrief.status === 201 && closeRetentionRequest.ok, "Test-only media-retention fixture could not be created and closed.");
  await appendFile(path.join(testDataDir, "status-updates.ndjson"), `${JSON.stringify({ id: retentionRequestBody.reference, kind: "request", status: "lost", previousStatus: "new", source: "test-only", updatedAt: "2020-01-01T00:00:00.000Z" })}\n`);
  const mediaAudit = await fetch(`${base}/api/admin/media-retention`);
  const mediaAuditBody = await mediaAudit.json();
  const retentionItem = mediaAuditBody.audit.items.find((item) => item.briefId === retentionBriefBody.reference);
  const serialisedMediaAudit = JSON.stringify(mediaAuditBody);
  assert(mediaAudit.ok && retentionItem?.state === "eligible" && retentionItem.availableCount === 1 && mediaAuditBody.audit.policy.automaticDeletion === false, "Closed room media was not safely classified against the recorded retention schedule.");
  assert(!serialisedMediaAudit.includes("retention@example.com") && !serialisedMediaAudit.includes("storedPath") && !serialisedMediaAudit.includes("job-brief-images"), "Private media audit exposed contact details or storage paths.");
  const protectedMediaAudit = await fetch(`${base}/api/admin/media-retention`, { headers: { "x-forwarded-for": "203.0.113.11" } });
  assert(protectedMediaAudit.status === 401, "Private media-retention audit bypassed admin authentication.");
  const unsafeMediaPurge = await fetch(`${base}/api/admin/media-retention/purge`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ briefId: retentionBriefBody.reference, typedReference: "WRONG", reason: "Test-only eligible retention deletion.", backupConfirmed: true }) });
  assert(unsafeMediaPurge.status === 422, "Private media deletion accepted the wrong scan confirmation reference.");
  const unbackedMediaPurge = await fetch(`${base}/api/admin/media-retention/purge`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ briefId: retentionBriefBody.reference, typedReference: retentionBriefBody.reference, reason: "Test-only eligible retention deletion.", backupConfirmed: false }) });
  assert(unbackedMediaPurge.status === 422, "Private media deletion proceeded without backup confirmation.");
  const mediaPurge = await fetch(`${base}/api/admin/media-retention/purge`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ briefId: retentionBriefBody.reference, typedReference: retentionBriefBody.reference, reason: "Test-only eligible retention deletion.", backupConfirmed: true }) });
  const mediaPurgeBody = await mediaPurge.json();
  assert(mediaPurge.ok && mediaPurgeBody.event.deletedFiles === 1 && mediaPurgeBody.event.backupConfirmed === true, "Eligible private media was not deleted with an append-only audit record.");
  const purgedMedia = await fetch(`${base}/api/admin/job-brief-image?briefId=${retentionBriefBody.reference}&imageId=${retentionBriefBody.photos[0].id}`);
  assert(purgedMedia.status === 404, "Deleted private room media remained retrievable.");
  const auditAfterPurge = await fetch(`${base}/api/admin/media-retention`);
  const auditAfterPurgeBody = await auditAfterPurge.json();
  assert(auditAfterPurgeBody.audit.items.find((item) => item.briefId === retentionBriefBody.reference)?.state === "purged", "Private media deletion did not remain visible in the retention audit.");
  const repeatMediaPurge = await fetch(`${base}/api/admin/media-retention/purge`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ briefId: retentionBriefBody.reference, typedReference: retentionBriefBody.reference, reason: "Test-only repeat deletion attempt.", backupConfirmed: true }) });
  assert(repeatMediaPurge.status === 409, "A completed private-media deletion was not idempotently blocked.");

  const statusUpdate = await fetch(`${base}/api/admin/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: requestBody.reference, kind: "request", status: "contacted" })
  });
  assert(statusUpdate.ok, "Admin status update failed.");

  const unsafeBookingStatus = await fetch(`${base}/api/admin/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: requestBody.reference, kind: "request", status: "booked" })
  });
  assert(unsafeBookingStatus.status === 422, "Request bypassed the confirmed-booking workflow.");

  const cleanerScreening = await fetch(`${base}/api/admin/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: cleanerBody.reference, kind: "cleaner", status: "screening" })
  });
  assert(cleanerScreening.ok, "Cleaner screening status failed.");
  const screeningCleanerStatus = await fetch(`${base}/api/cleaner-status`, { headers: { "x-cleaner-status-token": cleanerBody.cleanerStatusToken } });
  const screeningCleanerStatusBody = await screeningCleanerStatus.json();
  assert(screeningCleanerStatus.ok && screeningCleanerStatusBody.current.stage === "screening" && screeningCleanerStatusBody.readiness.screeningComplete === false && screeningCleanerStatusBody.steps.find((step) => step.key === "screening")?.state === "current", "Cleaner tracker did not show incomplete screening without implying approval.");
  const unscreenedApproval = await fetch(`${base}/api/admin/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: cleanerBody.reference, kind: "cleaner", status: "approved" })
  });
  assert(unscreenedApproval.status === 422, "Cleaner was approved without a screening checklist.");
  const incompleteScreening = await fetch(`${base}/api/admin/cleaner-screening`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cleanerId: cleanerBody.reference, identityChecked: true, note: "Test-only incomplete screening" })
  });
  const incompleteScreeningBody = await incompleteScreening.json();
  assert(incompleteScreening.ok && incompleteScreeningBody.screening.complete === false && incompleteScreeningBody.screening.completed === 1, "Incomplete cleaner screening was not recorded accurately.");
  const incompleteApproval = await fetch(`${base}/api/admin/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: cleanerBody.reference, kind: "cleaner", status: "approved" })
  });
  assert(incompleteApproval.status === 422, "Incomplete cleaner screening allowed approval.");
  const completeScreening = await fetch(`${base}/api/admin/cleaner-screening`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cleanerId: cleanerBody.reference, identityChecked: true, rightToWorkChecked: true, referencesChecked: true, serviceSkillsChecked: true, availabilityCoverageChecked: true, engagementTermsChecked: true, safeguardingDecisionChecked: true, note: "Test confirmations only; no identity documents stored." })
  });
  const completeScreeningBody = await completeScreening.json();
  assert(completeScreening.ok && completeScreeningBody.screening.complete === true && completeScreeningBody.screening.completed === 7, "Complete cleaner screening did not pass all seven checks.");
  const postScreeningProfileChange = await fetch(`${base}/api/cleaner-profile-starter`, { method: "POST", headers: { "content-type": "application/json", "x-cleaner-status-token": cleanerBody.cleanerStatusToken, "idempotency-key": "34343434-3434-4343-8343-343434343434" }, body: JSON.stringify({ ...profileUpdateInput, professionalBio: "I changed this profile after screening and it must be rejected by the server." }) });
  assert(postScreeningProfileChange.status === 409, "The applicant changed professional profile evidence after screening completed.");
  const screenedCleanerStatus = await fetch(`${base}/api/cleaner-status`, { headers: { "x-cleaner-status-token": cleanerBody.cleanerStatusToken } });
  const screenedCleanerStatusBody = await screenedCleanerStatus.json();
  assert(screenedCleanerStatus.ok && screenedCleanerStatusBody.current.stage === "approval-review" && screenedCleanerStatusBody.readiness.screeningComplete === true && screenedCleanerStatusBody.readiness.approvalRecorded === false && screenedCleanerStatusBody.steps.find((step) => step.key === "approval")?.state === "current", "Completed cleaner screening incorrectly implied approval or failed to surface the pending decision.");
  const cleanerApproval = await fetch(`${base}/api/admin/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: cleanerBody.reference, kind: "cleaner", status: "approved" })
  });
  assert(cleanerApproval.ok, "Cleaner approval status failed.");
  const approvedCleanerStatus = await fetch(`${base}/api/cleaner-status`, { headers: { "x-cleaner-status-token": cleanerBody.cleanerStatusToken } });
  const approvedCleanerStatusBody = await approvedCleanerStatus.json();
  assert(approvedCleanerStatus.ok && approvedCleanerStatusBody.current.stage === "availability" && approvedCleanerStatusBody.readiness.approvalRecorded === true && approvedCleanerStatusBody.readiness.confirmedAvailabilityWindows === 0 && approvedCleanerStatusBody.readiness.pendingAvailabilityWindows === 1 && approvedCleanerStatusBody.links.profileStarterSubmissionAllowed === false && approvedCleanerStatusBody.links.availabilitySubmissionAllowed === true && approvedCleanerStatusBody.steps.find((step) => step.key === "availability")?.state === "current", "Approved cleaner tracker lost the previously submitted exact window, left screened profile editing open, hid its safe submission action or implied work readiness early.");
  const overlappingPendingAvailability = await fetch(`${base}/api/cleaner-availability-requests`, { method: "POST", headers: { "content-type": "application/json", "x-cleaner-status-token": cleanerBody.cleanerStatusToken, "idempotency-key": "66666666-6666-4666-8666-666666666666" }, body: JSON.stringify({ availableDate: "2026-07-20", startTime: "10:00", endTime: "16:00" }) });
  assert(overlappingPendingAvailability.status === 409, "Overlapping pending cleaner availability was accepted.");
  const pendingCleanerStatus = await fetch(`${base}/api/cleaner-status`, { headers: { "x-cleaner-status-token": cleanerBody.cleanerStatusToken } });
  const pendingCleanerStatusBody = await pendingCleanerStatus.json();
  assert(pendingCleanerStatus.ok && pendingCleanerStatusBody.current.stage === "availability" && pendingCleanerStatusBody.readiness.readyForOpportunities === false && pendingCleanerStatusBody.readiness.pendingAvailabilityWindows === 1 && pendingCleanerStatusBody.availabilityRequests[0].reference === availabilityRequestBody.request.reference && !JSON.stringify(pendingCleanerStatusBody).includes("morning train"), "Pending availability was not shown safely or incorrectly made the cleaner match-ready.");
  const pendingAdminRecords = await fetch(`${base}/api/admin/records`);
  const pendingAdminBody = await pendingAdminRecords.json();
  const pendingAdminCleaner = pendingAdminBody.records.find((record) => record.id === cleanerBody.reference);
  assert(pendingAdminRecords.ok && pendingAdminCleaner.availabilityRequests.length === 1 && pendingAdminCleaner.dispatchActions.some((action) => action.code === "availability-review") && !JSON.stringify(pendingAdminCleaner).includes(availabilityRequestKey) && !JSON.stringify(pendingAdminCleaner).includes("submissionFingerprint"), "Pending availability was missing from the founder queue or exposed retry metadata.");

  const uncoveredCleaner = await fetch(`${base}/api/cleaner-applications`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fullName: "Outside Area Cleaner", email: "outside@example.com", phone: "07123456782", postcode: "NE1 1AA", travelAreas: "NE1", experience: "1–3 years", availability: "Weekdays", firstAvailableDate: "2026-07-20", firstAvailableStartTime: "08:00", firstAvailableEndTime: "15:00", serviceTurnovers: true, rightToWork: true, consent: true })
  });
  const uncoveredCleanerBody = await uncoveredCleaner.json();
  assert(uncoveredCleaner.status === 201, "Out-of-area test cleaner application failed before the travel gate could be tested.");
  const uncoveredCleanerProfile = await fetch(`${base}/api/cleaner-profile-starter`, { method: "POST", headers: { "content-type": "application/json", "x-cleaner-status-token": uncoveredCleanerBody.cleanerStatusToken, "idempotency-key": "56565656-5656-4656-8656-565656565656" }, body: JSON.stringify({ professionalBio: "I clean rental homes carefully and confirm every task before starting work.", languages: "English", equipmentPlan: "equipment-and-products-supplied" }) });
  const uncoveredCleanerScreeningStatus = await fetch(`${base}/api/admin/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: uncoveredCleanerBody.reference, kind: "cleaner", status: "screening" }) });
  const uncoveredCleanerScreening = await fetch(`${base}/api/admin/cleaner-screening`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ cleanerId: uncoveredCleanerBody.reference, identityChecked: true, rightToWorkChecked: true, referencesChecked: true, serviceSkillsChecked: true, availabilityCoverageChecked: true, engagementTermsChecked: true, safeguardingDecisionChecked: true, note: "Test confirmations only for the travel-coverage gate." }) });
  const uncoveredCleanerApproval = await fetch(`${base}/api/admin/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: uncoveredCleanerBody.reference, kind: "cleaner", status: "approved" }) });
  const uncoveredCleanerAvailability = await fetch(`${base}/api/admin/cleaner-availability`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cleanerId: uncoveredCleanerBody.reference, availableDate: "2026-07-20", startTime: "08:00", endTime: "15:00", confirmationNote: "Test-only availability confirmed for the travel-coverage gate." }) });
  assert(uncoveredCleanerProfile.status === 201 && uncoveredCleanerScreeningStatus.ok && uncoveredCleanerScreening.ok && uncoveredCleanerApproval.ok && uncoveredCleanerAvailability.status === 201, "Out-of-area cleaner could not complete the private profile or reach the otherwise matchable test state.");
  const uncoveredCleanerProposal = await fetch(`${base}/api/admin/proposals`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: requestBody.reference, cleanerId: uncoveredCleanerBody.reference, proposedDate: "2026-07-20", proposedStartTime: "09:00", estimatedHours: 4, customerRate: 30, cleanerRate: 18, otherCosts: 0 }) });
  const uncoveredCleanerProposalBody = await uncoveredCleanerProposal.json();
  assert(uncoveredCleanerProposal.status === 422 && uncoveredCleanerProposalBody.error?.includes("stated travel areas"), "A direct proposal was created outside the cleaner's explicitly stated travel area.");

  const noAvailabilityMatches = await fetch(`${base}/api/admin/matches?requestId=${requestBody.reference}`);
  const noAvailabilityMatchesBody = await noAvailabilityMatches.json();
  assert(noAvailabilityMatches.ok && noAvailabilityMatchesBody.matches.length === 0, "Matching returned a cleaner without a structured confirmed availability window.");
  const noAvailabilityProposal = await fetch(`${base}/api/admin/proposals`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: requestBody.reference, cleanerId: cleanerBody.reference, proposedDate: "2026-07-20", proposedStartTime: "09:00", estimatedHours: 4, customerRate: 30, cleanerRate: 18, otherCosts: 10 }) });
  assert(noAvailabilityProposal.status === 422, "A proposal was created from pending rather than confirmed cleaner availability.");
  const confirmedAvailabilityRequest = await fetch(`${base}/api/admin/cleaner-availability-requests`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: availabilityRequestBody.request.reference, decision: "confirmed", note: "Test-only exact window verified by Homle." }) });
  const confirmedAvailabilityRequestBody = await confirmedAvailabilityRequest.json();
  assert(confirmedAvailabilityRequest.ok && confirmedAvailabilityRequestBody.status === "confirmed" && confirmedAvailabilityRequestBody.slot.sourceRequestId === availabilityRequestBody.request.reference, "Founder confirmation did not convert the pending request into an auditable confirmed window.");
  const duplicateAvailabilityDecision = await fetch(`${base}/api/admin/cleaner-availability-requests`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: availabilityRequestBody.request.reference, decision: "declined", note: "Test-only duplicate decision should be blocked." }) });
  assert(duplicateAvailabilityDecision.status === 409, "A cleaner availability request accepted more than one founder decision.");
  const unverifiedAvailability = await fetch(`${base}/api/admin/cleaner-availability`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cleanerId: cleanerBody.reference, availableDate: "2026-07-20", startTime: "08:00", endTime: "15:00", confirmationNote: "short" }) });
  assert(unverifiedAvailability.status === 422, "Cleaner availability was recorded without a meaningful confirmation note.");
  const availabilityWindows = [
    { availableDate: "2026-07-22", startTime: "08:00", endTime: "13:00" },
    { availableDate: "2026-07-23", startTime: "08:00", endTime: "13:00" }
  ];
  let activeSlot20Id = confirmedAvailabilityRequestBody.slot.id;
  for (const window of availabilityWindows) {
    const savedWindow = await fetch(`${base}/api/admin/cleaner-availability`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cleanerId: cleanerBody.reference, ...window, confirmationNote: "Test-only cleaner confirmation recorded for this exact window." }) });
    const savedWindowBody = await savedWindow.json();
    assert(savedWindow.status === 201 && savedWindowBody.slot.status === "active", `Confirmed availability window ${window.availableDate} was not saved.`);
  }
  const readyCleanerStatus = await fetch(`${base}/api/cleaner-status`, { headers: { "x-cleaner-status-token": cleanerBody.cleanerStatusToken } });
  const readyCleanerStatusBody = await readyCleanerStatus.json();
  assert(readyCleanerStatus.ok && readyCleanerStatusBody.current.stage === "ready" && readyCleanerStatusBody.readiness.readyForOpportunities === true && readyCleanerStatusBody.readiness.confirmedAvailabilityWindows === 3 && readyCleanerStatusBody.steps.find((step) => step.key === "opportunities")?.state === "current" && readyCleanerStatusBody.current.nextAction.includes("No work is guaranteed"), "Cleaner tracker did not reach evidence-backed opportunity readiness or promised work.");
  const declinedRequest = await fetch(`${base}/api/cleaner-availability-requests`, { method: "POST", headers: { "content-type": "application/json", "x-cleaner-status-token": cleanerBody.cleanerStatusToken, "idempotency-key": "77777777-7777-4777-8777-777777777777" }, body: JSON.stringify({ availableDate: "2026-07-24", startTime: "09:00", endTime: "14:00", note: "Test-only later window." }) });
  const declinedRequestBody = await declinedRequest.json();
  const declinedDecision = await fetch(`${base}/api/admin/cleaner-availability-requests`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: declinedRequestBody.request.reference, decision: "declined", note: "Test-only window could not be verified." }) });
  const afterDeclineStatus = await fetch(`${base}/api/cleaner-status`, { headers: { "x-cleaner-status-token": cleanerBody.cleanerStatusToken } });
  const afterDeclineStatusBody = await afterDeclineStatus.json();
  assert(declinedRequest.status === 201 && declinedDecision.ok && afterDeclineStatusBody.readiness.confirmedAvailabilityWindows === 3 && afterDeclineStatusBody.readiness.pendingAvailabilityWindows === 0 && afterDeclineStatusBody.availabilityRequests.length === 0, "Declining pending availability changed confirmed matching capacity or remained pending.");
  const overlappingAvailability = await fetch(`${base}/api/admin/cleaner-availability`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cleanerId: cleanerBody.reference, availableDate: "2026-07-20", startTime: "10:00", endTime: "16:00", confirmationNote: "Test-only overlapping availability confirmation window." }) });
  assert(overlappingAvailability.status === 409, "Overlapping confirmed availability windows were accepted.");
  const outsideAvailabilityProposal = await fetch(`${base}/api/admin/proposals`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: requestBody.reference, cleanerId: cleanerBody.reference, proposedDate: "2026-07-20", proposedStartTime: "14:00", estimatedHours: 2, customerRate: 30, cleanerRate: 18, otherCosts: 0 }) });
  assert(outsideAvailabilityProposal.status === 422, "A proposal extended beyond the cleaner's confirmed availability window.");

  const unscannedRequest = await fetch(`${base}/api/cleaning-requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contactName: "No Scan Customer", email: "noscan@example.com", phone: "07123456788", postcode: "SW1A 2AA", customerType: "Homeowner or tenant", propertyType: "Flat or house", service: "Rental turnover clean", siteSize: "1 bedroom and 1 bathroom", accessNotes: "Meet at the property", hazards: "None known", preferredDate: "2026-07-22", preferredTimeWindow: "Flexible", consent: true })
  });
  const unscannedRequestBody = await unscannedRequest.json();
  assert(unscannedRequest.status === 201, "Customer request without a room scan could not be created as step one.");
  await rewriteTestRequestCreatedAt(unscannedRequestBody.reference, new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString());
  const stalledScanQueue = await fetch(`${base}/api/admin/records`);
  const stalledScanQueueBody = await stalledScanQueue.json();
  assert(stalledScanQueue.ok && stalledScanQueueBody.records.find((record) => record.id === unscannedRequestBody.reference)?.dispatchActions?.some((action) => action.code === "scan-stalled" && action.severity === "high" && action.group === "scan"), "A customer request without a scan for more than 24 hours was not promoted to founder attention.");
  const unscannedProposal = await fetch(`${base}/api/admin/proposals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: unscannedRequestBody.reference, cleanerId: cleanerBody.reference, proposedDate: "2026-07-22", proposedStartTime: "09:00", estimatedHours: 3, customerRate: 30, cleanerRate: 18, otherCosts: 5 })
  });
  const unscannedProposalBody = await unscannedProposal.json();
  assert(unscannedProposal.status === 201, "Internal draft could not be prepared for the room-scan gate test.");
  const unscannedReady = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: unscannedProposalBody.proposal.id, status: "ready" }) });
  assert(unscannedReady.status === 422, "A proposal advanced without the required reviewed room scan.");
  const unscannedDraft = await fetch(`${base}/api/admin/proposal-drafts?proposalId=${unscannedProposalBody.proposal.id}`);
  const unscannedDraftBody = await unscannedDraft.json();
  assert(unscannedDraft.ok && unscannedDraftBody.sendAllowed === false && unscannedDraftBody.warnings.some((warning) => warning.includes("complete the room scan")), "Missing room scan was not clearly explained in the control desk.");
  const unconfirmedWithdrawal = await fetch(`${base}/api/request-withdrawal`, { method: "POST", headers: { "content-type": "application/json", "x-request-token": unscannedRequestBody.customerStatusToken }, body: JSON.stringify({ reason: "no-longer-needed" }) });
  assert(unconfirmedWithdrawal.status === 422, "An unbooked request was closed without the customer's explicit confirmation.");
  const withdrawnRequest = await fetch(`${base}/api/request-withdrawal`, { method: "POST", headers: { "content-type": "application/json", "x-request-token": unscannedRequestBody.customerStatusToken }, body: JSON.stringify({ reason: "no-longer-needed", note: "Test-only customer withdrawal before any booking.", confirmed: true }) });
  const withdrawnRequestBody = await withdrawnRequest.json();
  const replayedWithdrawal = await fetch(`${base}/api/request-withdrawal`, { method: "POST", headers: { "content-type": "application/json", "x-request-token": unscannedRequestBody.customerStatusToken }, body: JSON.stringify({ reason: "no-longer-needed", confirmed: true }) });
  const replayedWithdrawalBody = await replayedWithdrawal.json();
  assert(withdrawnRequest.status === 201 && withdrawnRequestBody.status === "closed" && replayedWithdrawal.ok && replayedWithdrawalBody.replayed === true && replayedWithdrawalBody.closedAt === withdrawnRequestBody.closedAt, "Private customer withdrawal was not append-only and retry-safe.");
  const withdrawnTracker = await fetch(`${base}/api/request-status`, { headers: { "x-request-token": unscannedRequestBody.customerStatusToken } });
  const withdrawnTrackerBody = await withdrawnTracker.json();
  assert(withdrawnTracker.ok && withdrawnTrackerBody.current.stage === "closed" && withdrawnTrackerBody.withdrawal.closed === true && withdrawnTrackerBody.withdrawal.allowed === false && withdrawnTrackerBody.links.roomScanRequired === false && withdrawnTrackerBody.links.quoteToken === "" && withdrawnTrackerBody.links.bookingToken === "", "A customer-withdrawn enquiry retained an active scan, quote, booking or repeat-withdrawal action.");
  const withdrawnMatches = await fetch(`${base}/api/admin/matches?requestId=${unscannedRequestBody.reference}`);
  const withdrawnMatchesBody = await withdrawnMatches.json();
  assert(withdrawnMatches.ok && withdrawnMatchesBody.matchGate.reason === "request-closed" && withdrawnMatchesBody.matches.length === 0, "A customer-withdrawn enquiry remained open to cleaner matching.");
  const withdrawnProposalAdvance = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: unscannedProposalBody.proposal.id, status: "ready" }) });
  assert(withdrawnProposalAdvance.status === 409, "A proposal advanced after the customer withdrew the unbooked request.");
  const postWithdrawalProposal = await fetch(`${base}/api/admin/proposals`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: unscannedRequestBody.reference, cleanerId: cleanerBody.reference, proposedDate: "2026-07-23", proposedStartTime: "09:00", estimatedHours: 3, customerRate: 30, cleanerRate: 18, otherCosts: 5 }) });
  assert(postWithdrawalProposal.status === 409, "A new proposal was prepared after the customer withdrew the unbooked request.");
  const postWithdrawalScan = await fetch(`${base}/api/job-briefs`, { method: "POST", headers: { "content-type": "application/json", "x-request-token": unscannedRequestBody.customerStatusToken }, body: JSON.stringify({ requestId: unscannedRequestBody.reference, transcript: "In the kitchen wipe the worktops.", photos: [{ area: "Kitchen", note: "Worktops need cleaning", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zs7sAAAAASUVORK5CYII=" }], scopeCompleteConfirmed: true, consent: true }) });
  assert(postWithdrawalScan.status === 422, "A withdrawn enquiry accepted another private room scan.");
  const withdrawnAdmin = await fetch(`${base}/api/admin/records`);
  const withdrawnAdminBody = await withdrawnAdmin.json();
  const withdrawnAdminRecord = withdrawnAdminBody.records.find((record) => record.id === unscannedRequestBody.reference);
  assert(withdrawnAdminRecord?.status === "lost" && withdrawnAdminRecord.dispatchActions.length === 0, "Customer withdrawal did not close the internal founder-action queue.");

  const matching = await fetch(`${base}/api/admin/matches?requestId=${requestBody.reference}`);
  const matchingBody = await matching.json();
  assert(matching.ok && matchingBody.matches.length === 0 && matchingBody.matchGate.ready === false && matchingBody.matchGate.reason === "reviewed-room-scan-required", "Matching opened before the room scan supplied a reviewed duration.");

  const losingProposal = await fetch(`${base}/api/admin/proposals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: requestBody.reference, cleanerId: cleanerBody.reference, proposedDate: "2026-07-20", proposedStartTime: "09:00", estimatedHours: 4, customerRate: 15, cleanerRate: 18, otherCosts: 0 })
  });
  assert(losingProposal.status === 422, "Loss-making proposal was not rejected.");

  const belowMinimumHoursProposal = await fetch(`${base}/api/admin/proposals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: requestBody.reference, cleanerId: cleanerBody.reference, proposedDate: "2026-07-20", proposedStartTime: "09:00", estimatedHours: 1, customerRate: 30, cleanerRate: 18, otherCosts: 0 })
  });
  assert(belowMinimumHoursProposal.status === 422, "Proposal below the founder minimum hours was accepted.");

  const thinMarginProposal = await fetch(`${base}/api/admin/proposals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: requestBody.reference, cleanerId: cleanerBody.reference, proposedDate: "2026-07-20", proposedStartTime: "09:00", estimatedHours: 4, customerRate: 30, cleanerRate: 23.5, otherCosts: 0 })
  });
  assert(thinMarginProposal.status === 422, "Proposal below the founder margin floor was accepted.");

  const overflowProposal = await fetch(`${base}/api/admin/proposals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: requestBody.reference, cleanerId: cleanerBody.reference, proposedDate: "2026-07-20", proposedStartTime: "09:00", estimatedHours: 4, customerRate: "1e309", cleanerRate: 18, otherCosts: 0 })
  });
  assert(overflowProposal.status === 422, "A non-finite proposal rate bypassed the financial and margin checks.");
  const extremeCostProposal = await fetch(`${base}/api/admin/proposals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: requestBody.reference, cleanerId: cleanerBody.reference, proposedDate: "2026-07-20", proposedStartTime: "09:00", estimatedHours: 4, customerRate: 30, cleanerRate: 18, otherCosts: 100001 })
  });
  assert(extremeCostProposal.status === 422, "Proposal costs above the supported financial limit were accepted.");

  const missingTimeProposal = await fetch(`${base}/api/admin/proposals`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: requestBody.reference, cleanerId: cleanerBody.reference, proposedDate: "2026-07-20", estimatedHours: 4, customerRate: 30, cleanerRate: 18, otherCosts: 0 }) });
  assert(missingTimeProposal.status === 422, "Proposal without an exact start time was accepted.");
  const overnightProposal = await fetch(`${base}/api/admin/proposals`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: requestBody.reference, cleanerId: cleanerBody.reference, proposedDate: "2026-07-20", proposedStartTime: "23:00", estimatedHours: 4, customerRate: 30, cleanerRate: 18, otherCosts: 0 }) });
  assert(overnightProposal.status === 422, "Proposal extending beyond the service date was accepted.");

  await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, labourOnCostPercent: 6 }) });
  const labourCostMarginBlocked = await fetch(`${base}/api/admin/proposals`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: requestBody.reference, cleanerId: cleanerBody.reference, proposedDate: "2026-07-20", proposedStartTime: "09:00", estimatedHours: 4, customerRate: 30, cleanerRate: 18, otherCosts: 10 }) });
  assert(labourCostMarginBlocked.status === 422, "A proposal below the margin floor after labour on-costs was accepted.");
  await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(completeConfig) });

  const validProposal = await fetch(`${base}/api/admin/proposals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: requestBody.reference, cleanerId: cleanerBody.reference, proposedDate: "2026-07-20", proposedStartTime: "09:00", estimatedHours: 4, customerRate: 30, cleanerRate: 18, otherCosts: 10, note: "Draft only" })
  });
  const proposalBody = await validProposal.json();
  assert(validProposal.status === 201 && proposalBody.proposal.contribution === 30 && proposalBody.proposal.labourOnCosts === 3.6 && proposalBody.proposal.paymentFees === 1.2 && proposalBody.proposal.riskContingency === 1.2 && proposalBody.proposal.nonCleanerCosts === 18 && proposalBody.proposal.proposedEndTime === "13:00" && /^[A-Za-z0-9_-]{32}$/.test(proposalBody.proposal.reviewToken) && /^[A-Za-z0-9_-]{32}$/.test(proposalBody.proposal.cleanerReviewToken), "Valid draft proposal failed, omitted its full labour and variable cost breakdown, calculated incorrectly, omitted its schedule or omitted a private review token.");
  const blockedScheduleDuringProposal = await fetch(`${base}/api/request-schedule`, { method: "POST", headers: { "content-type": "application/json", "x-request-token": requestBody.customerStatusToken }, body: JSON.stringify({ preferredDate: "2026-07-21", preferredTimeWindow: "Flexible", reason: "Attempt to move timing after quote preparation started.", confirmed: true }) });
  assert(blockedScheduleDuringProposal.status === 409, "Customer timing changed underneath an active controlled proposal instead of requiring that offer to close first.");
  const proposalStageStatus = await fetch(`${base}/api/request-status`, { headers: { "x-request-token": requestBody.customerStatusToken } });
  assert((await proposalStageStatus.json()).scheduleChange.allowed === false, "The tracker exposed date-changing controls while an active proposal depended on the current timing.");

  await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, insuranceStatus: "in-progress" }) });
  const blockedDrafts = await fetch(`${base}/api/admin/proposal-drafts?proposalId=${proposalBody.proposal.id}`);
  const blockedDraftsBody = await blockedDrafts.json();
  assert(blockedDrafts.ok && blockedDraftsBody.sendAllowed === false && blockedDraftsBody.warnings.length > 0, "Unready proposal drafts were not clearly blocked.");
  const readinessBlocked = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: proposalBody.proposal.id, status: "ready" }) });
  assert(readinessBlocked.status === 422, "Incomplete launch readiness did not block proposal advancement.");

  await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, minimumHours: 5 }) });
  const increasedHoursBlocked = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: proposalBody.proposal.id, status: "ready" }) });
  assert(increasedHoursBlocked.status === 422, "Existing proposal bypassed a newly increased minimum-hours rule.");

  await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, minimumContributionMarginPercent: 40 }) });
  const increasedFloorBlocked = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: proposalBody.proposal.id, status: "ready" }) });
  assert(increasedFloorBlocked.status === 422, "Existing proposal bypassed a newly increased founder margin floor.");

  await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, pilotPostcodes: "SW2, SW4" }) });
  const outOfAreaMatches = await fetch(`${base}/api/admin/matches?requestId=${requestBody.reference}`);
  const outOfAreaMatchesBody = await outOfAreaMatches.json();
  assert(outOfAreaMatches.ok && outOfAreaMatchesBody.matches.length === 0 && outOfAreaMatchesBody.pilotCoverage.covered === false, "Out-of-area request still returned cleaner matches.");
  const outOfAreaDrafts = await fetch(`${base}/api/admin/proposal-drafts?proposalId=${proposalBody.proposal.id}`);
  const outOfAreaDraftsBody = await outOfAreaDrafts.json();
  assert(outOfAreaDrafts.ok && outOfAreaDraftsBody.sendAllowed === false && outOfAreaDraftsBody.warnings.some((warning) => warning.includes("outside the configured Homle pilot area")), "Out-of-area proposal drafts were not clearly blocked.");
  const outOfAreaProposal = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: proposalBody.proposal.id, status: "ready" }) });
  assert(outOfAreaProposal.status === 422, "Out-of-area proposal advanced toward booking.");

  await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(completeConfig) });
  const briefBlockedDrafts = await fetch(`${base}/api/admin/proposal-drafts?proposalId=${proposalBody.proposal.id}`);
  const briefBlockedDraftsBody = await briefBlockedDrafts.json();
  assert(briefBlockedDrafts.ok && briefBlockedDraftsBody.sendAllowed === false && briefBlockedDraftsBody.warnings.some((warning) => warning.includes("customer room scan")), "Unreviewed customer room scan did not block cleaner-draft use.");
  const unreviewedProposal = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: proposalBody.proposal.id, status: "ready" }) });
  assert(unreviewedProposal.status === 422, "Unreviewed landlord brief did not block proposal advancement.");
  const revisionWithoutNote = await fetch(`${base}/api/admin/job-briefs/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ briefId: briefBody.reference, status: "needs-revision" }) });
  assert(revisionWithoutNote.status === 422, "A revision request was accepted without guidance for the landlord.");
  const reviewWithoutEstimate = await fetch(`${base}/api/admin/job-briefs/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ briefId: briefBody.reference, status: "reviewed", note: "Scope checked but no time estimate supplied." }) });
  assert(reviewWithoutEstimate.status === 422, "Room scan was approved without a room-by-room cleaning-time worksheet.");
  const mismatchedTimeReview = await fetch(`${base}/api/admin/job-briefs/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ briefId: briefBody.reference, status: "reviewed", note: "Test-only mismatched room-time worksheet.", scopeEstimateHours: 3, scopeTimeBreakdown: reviewTimeBreakdown(briefBody, 3.5), scopeConfidence: "high" }) });
  assert(mismatchedTimeReview.status === 422, "A reviewed scan accepted hours below its exact room-time worksheet.");
  const lowConfidenceReview = await fetch(`${base}/api/admin/job-briefs/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ briefId: briefBody.reference, status: "reviewed", note: "The scan is too unclear to quote safely.", scopeEstimateHours: 3.5, scopeTimeBreakdown: reviewTimeBreakdown(briefBody, 3.5), scopeConfidence: "low" }) });
  assert(lowConfidenceReview.status === 422, "Low-confidence room scan was approved instead of requiring revision.");
  const reviewWithoutEvidence = await fetch(`${base}/api/admin/job-briefs/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ briefId: briefBody.reference, status: "reviewed", note: "Scope estimate entered without opening every visual.", scopeEstimateHours: 3.5, scopeTimeBreakdown: reviewTimeBreakdown(briefBody, 3.5), scopeConfidence: "high", scopeSignalConfirmations: ["oven-interior"] }) });
  const reviewWithoutEvidenceBody = await reviewWithoutEvidence.json();
  assert(reviewWithoutEvidence.status === 422 && reviewWithoutEvidenceBody.error.includes("Open every private room visual"), "Room scan was approved without evidence that every visual, note and concise checklist was reviewed.");
  const incompleteVisualEvidenceReview = await fetch(`${base}/api/admin/job-briefs/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ briefId: briefBody.reference, status: "reviewed", note: "Only one of the submitted room visuals was individually confirmed.", scopeEstimateHours: 3.5, scopeTimeBreakdown: reviewTimeBreakdown(briefBody, 3.5), scopeConfidence: "high", scopeSignalConfirmations: ["oven-interior"], visualsReviewed: true, reviewedVisualIds: [briefBody.photos[0].id], checklistReviewed: true }) });
  const incompleteVisualEvidenceBody = await incompleteVisualEvidenceReview.json();
  assert(incompleteVisualEvidenceReview.status === 422 && incompleteVisualEvidenceBody.error.includes("each private room visual"), "Room scan was approved without an exact per-visual review evidence set.");
  const reviewedVisualIds = briefBody.photos.map((photo) => photo.id);
  const unconfirmedExtraReview = await fetch(`${base}/api/admin/job-briefs/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ briefId: briefBody.reference, status: "reviewed", note: "Time reviewed without confirming the detected oven interior.", scopeEstimateHours: 3.5, scopeTimeBreakdown: reviewTimeBreakdown(briefBody, 3.5), scopeConfidence: "high", visualsReviewed: true, reviewedVisualIds, checklistReviewed: true }) });
  const unconfirmedExtraReviewBody = await unconfirmedExtraReview.json();
  assert(unconfirmedExtraReview.status === 422 && unconfirmedExtraReviewBody.error.includes("Inside oven cleaning"), "Price-sensitive scan scope was approved without explicit confirmation inside the reviewed hours.");
  const reviewedBrief = await fetch(`${base}/api/admin/job-briefs/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ briefId: briefBody.reference, status: "reviewed", note: "Checklist and private photo support a three-and-a-half-hour scope floor, including the oven interior.", scopeEstimateHours: 3.5, scopeTimeBreakdown: reviewTimeBreakdown(briefBody, 3.5), scopeConfidence: "high", scopeSignalConfirmations: ["oven-interior"], visualsReviewed: true, reviewedVisualIds, checklistReviewed: true })
  });
  const reviewedBriefBody = await reviewedBrief.json();
  assert(reviewedBrief.ok && reviewedBriefBody.status === "reviewed" && reviewedBriefBody.scopeEstimateHours === 3.5 && reviewedBriefBody.scopeConfidence === "high" && reviewedBriefBody.scopeTimeEvidenceConfirmed === true && reviewedBriefBody.timeEvidenceVersion === 1 && reviewedBriefBody.scopeTimeBreakdown?.totalMinutes === 210 && reviewedBriefBody.scopeSignals?.[0]?.code === "oven-interior" && reviewedBriefBody.scopeSignalConfirmations?.[0] === "oven-interior" && reviewedBriefBody.visualsReviewed === true && reviewedBriefBody.reviewedVisualIds.length === briefBody.photos.length && reviewedBriefBody.perVisualReviewEvidenceConfirmed === true && reviewedBriefBody.checklistReviewed === true && reviewedBriefBody.reviewEvidenceConfirmed === true, "Structured human scan approval, exact room-time evidence, per-visual founder evidence or price-sensitive scope confirmation was not recorded.");
  const schedulableMatching = await fetch(`${base}/api/admin/matches?requestId=${requestBody.reference}`);
  const schedulableMatchingBody = await schedulableMatching.json();
  const schedulableSlot = schedulableMatchingBody.matches?.[0]?.availabilitySlots?.[0];
  assert(schedulableMatching.ok && schedulableMatchingBody.matchGate.ready === true && schedulableMatchingBody.matchGate.requiredHours === 3.5 && schedulableMatchingBody.matchGate.confirmedExtras?.[0] === "Inside oven cleaning" && schedulableMatchingBody.matches.length === 1 && schedulableMatchingBody.matches[0].id === cleanerBody.reference && schedulableMatchingBody.matches[0].travelCoverageCovered === true, "Reviewed room scan did not open schedulable matching exclusively for the cleaner whose stated travel area covers the customer postcode.");
  assert(schedulableMatchingBody.matches[0].score === 100 && schedulableMatchingBody.matches[0].coverage === "Postcode district listed" && schedulableMatchingBody.matches[0].availabilitySlots.length === 1 && schedulableSlot.availableDate === "2026-07-20" && schedulableSlot.suggestedStartTime === "08:00" && schedulableSlot.suggestedEndTime === "11:30" && schedulableSlot.arrivalWindowFit === true, "Match did not fit the verified postcode district, preferred date, morning arrival and reviewed duration inside confirmed availability.");
  const travelGateRequest = await fetch(`${base}/api/cleaning-requests`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contactName: "Travel Gate Customer", email: "travelgate@example.com", phone: "07123456783", postcode: "SW2 1AA", customerType: "Landlord", propertyType: "Flat or house", service: "Rental turnover clean", siteSize: "1 bedroom and 1 bathroom", accessNotes: "Meet at reception", hazards: "None known", preferredDate: "2026-07-20", preferredTimeWindow: "Morning (8am–12pm)", consent: true }) });
  const travelGateRequestBody = await travelGateRequest.json();
  const travelGateBrief = await fetch(`${base}/api/job-briefs`, { method: "POST", headers: { "content-type": "application/json", "x-request-token": travelGateRequestBody.customerStatusToken }, body: JSON.stringify({ requestId: travelGateRequestBody.reference, email: "travelgate@example.com", transcript: "In the kitchen wipe the worktops and mop the floor.", photos: [{ area: "Kitchen", note: "Worktops and floor need cleaning", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zs7sAAAAASUVORK5CYII=" }], scopeCompleteConfirmed: true, consent: true }) });
  const travelGateBriefBody = await travelGateBrief.json();
  const reviewedTravelGateBrief = await fetch(`${base}/api/admin/job-briefs/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ briefId: travelGateBriefBody.reference, status: "reviewed", note: "Test-only two-hour travel-coverage scope estimate.", scopeEstimateHours: 2, scopeTimeBreakdown: reviewTimeBreakdown(travelGateBriefBody, 2), scopeConfidence: "medium", visualsReviewed: true, reviewedVisualIds: travelGateBriefBody.photos.map((photo) => photo.id), checklistReviewed: true }) });
  const travelBlockedMatches = await fetch(`${base}/api/admin/matches?requestId=${travelGateRequestBody.reference}`);
  const travelBlockedMatchesBody = await travelBlockedMatches.json();
  assert(travelGateRequest.status === 201 && travelGateBrief.status === 201 && reviewedTravelGateBrief.ok && travelBlockedMatches.ok && travelBlockedMatchesBody.matches.length === 0 && travelBlockedMatchesBody.matchGate.reason === "no-cleaner-travel-coverage", "Matching did not distinguish available-but-uncovered cleaners from a missing availability window.");
  const eveningRequest = await fetch(`${base}/api/cleaning-requests`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contactName: "Evening Customer", email: "evening@example.com", phone: "07123456777", postcode: "SW1A 2AA", customerType: "Landlord", propertyType: "Flat or house", service: "Rental turnover clean", siteSize: "1 bedroom and 1 bathroom", accessNotes: "Test access only", hazards: "None known", preferredDate: "2026-07-22", preferredTimeWindow: "Evening (5pm–8pm)", consent: true }) });
  const eveningRequestBody = await eveningRequest.json();
  const eveningBrief = await fetch(`${base}/api/job-briefs`, { method: "POST", headers: { "content-type": "application/json", "x-request-token": eveningRequestBody.customerStatusToken }, body: JSON.stringify({ requestId: eveningRequestBody.reference, email: "evening@example.com", transcript: "In the kitchen wipe the worktops and mop the floor.", photos: [{ area: "Kitchen", note: "Worktops and floor need cleaning", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zs7sAAAAASUVORK5CYII=" }], scopeCompleteConfirmed: true, consent: true }) });
  const eveningBriefBody = await eveningBrief.json();
  const reviewedEveningBrief = await fetch(`${base}/api/admin/job-briefs/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ briefId: eveningBriefBody.reference, status: "reviewed", note: "Test-only two-hour evening scope estimate.", scopeEstimateHours: 2, scopeTimeBreakdown: reviewTimeBreakdown(eveningBriefBody, 2), scopeConfidence: "medium", visualsReviewed: true, reviewedVisualIds: eveningBriefBody.photos.map((photo) => photo.id), checklistReviewed: true }) });
  assert(eveningRequest.status === 201 && eveningBrief.status === 201 && reviewedEveningBrief.ok, "Evening scheduling test request could not reach reviewed scope.");
  const noEveningMatch = await fetch(`${base}/api/admin/matches?requestId=${eveningRequestBody.reference}`);
  const noEveningMatchBody = await noEveningMatch.json();
  assert(noEveningMatch.ok && noEveningMatchBody.matchGate.ready === true && noEveningMatchBody.matchGate.reason === "no-schedulable-window" && noEveningMatchBody.matchGate.requiredHours === 2 && noEveningMatchBody.matches.length === 0, "Morning-only cleaner availability was incorrectly suggested for an evening arrival request.");
  const reviewedTracker = await fetch(`${base}/api/request-status`, { headers: { "x-request-token": requestBody.customerStatusToken } });
  const reviewedTrackerBody = await reviewedTracker.json();
  assert(reviewedTracker.ok && reviewedTrackerBody.current.stage === "quote-preparation" && reviewedTrackerBody.roomScan.status === "reviewed" && reviewedTrackerBody.roomScan.reviewedHours === 3.5 && reviewedTrackerBody.roomScan.confirmedExtras?.[0] === "Inside oven cleaning" && reviewedTrackerBody.steps.find((step) => step.key === "scan")?.state === "complete", "Customer tracker did not reflect the reviewed scan, confirmed extra and quote-preparation stage.");
  const reversedBriefReview = await fetch(`${base}/api/admin/job-briefs/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ briefId: briefBody.reference, status: "needs-revision", note: "Late change" }) });
  assert(reversedBriefReview.status === 422, "Reviewed brief history was overwritten instead of requiring a new submission.");
  const underScopedProposal = await fetch(`${base}/api/admin/proposals`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: requestBody.reference, cleanerId: cleanerBody.reference, proposedDate: "2026-07-20", proposedStartTime: "09:00", estimatedHours: 3, customerRate: 30, cleanerRate: 18, otherCosts: 5 }) });
  const underScopedProposalBody = await underScopedProposal.json();
  assert(underScopedProposal.status === 201, "Internal under-scoped draft could not be created for the reviewed-hours gate test.");
  const underScopedReady = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: underScopedProposalBody.proposal.id, status: "ready" }) });
  assert(underScopedReady.status === 422, "Proposal advanced with fewer hours than the reviewed room-scan estimate.");
  const withdrawnAvailability = await fetch(`${base}/api/admin/cleaner-availability`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ cleanerId: cleanerBody.reference, slotId: activeSlot20Id, note: "Test-only withdrawal before proposal approval." }) });
  assert(withdrawnAvailability.ok, "Confirmed availability could not be withdrawn.");
  const duplicateWithdrawal = await fetch(`${base}/api/admin/cleaner-availability`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ cleanerId: cleanerBody.reference, slotId: activeSlot20Id, note: "Test-only duplicate withdrawal should be blocked." }) });
  assert(duplicateWithdrawal.status === 409, "An already-withdrawn availability window was withdrawn again.");
  const availabilityBlockedReady = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: proposalBody.proposal.id, status: "ready" }) });
  assert(availabilityBlockedReady.status === 422, "Proposal advanced after its cleaner availability window was withdrawn.");
  const restoredAvailability = await fetch(`${base}/api/admin/cleaner-availability`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cleanerId: cleanerBody.reference, availableDate: "2026-07-20", startTime: "08:00", endTime: "15:00", confirmationNote: "Test-only cleaner reconfirmed this exact availability window." }) });
  const restoredAvailabilityBody = await restoredAvailability.json();
  assert(restoredAvailability.status === 201, "A withdrawn cleaner availability window could not be safely reconfirmed.");
  activeSlot20Id = restoredAvailabilityBody.slot.id;
  await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, travelCostPerJob: 2 }) });
  const staleCostModelReady = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: proposalBody.proposal.id, status: "ready" }) });
  assert(staleCostModelReady.status === 422, "Proposal advanced after the founder-confirmed cost assumptions changed.");
  const staleCostDrafts = await fetch(`${base}/api/admin/proposal-drafts?proposalId=${proposalBody.proposal.id}`);
  const staleCostDraftsBody = await staleCostDrafts.json();
  assert(staleCostDrafts.ok && staleCostDraftsBody.sendAllowed === false && staleCostDraftsBody.warnings.some((warning) => warning.includes("cost assumptions changed")), "Stale proposal economics were not clearly blocked in the control desk.");
  await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(completeConfig) });
  const readyProposal = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: proposalBody.proposal.id, status: "ready" }) });
  assert(readyProposal.ok, "Ready proposal status failed after launch checks passed.");
  const preSendDispatchPack = await fetch(`${base}/api/admin/proposal-drafts?proposalId=${proposalBody.proposal.id}`);
  const preSendDispatchPackBody = await preSendDispatchPack.json();
  assert(preSendDispatchPack.ok && preSendDispatchPackBody.sendAllowed === true && preSendDispatchPackBody.handoffReady === false && preSendDispatchPackBody.customer.handoffReady === false && preSendDispatchPackBody.cleaner.handoffReady === false && preSendDispatchPackBody.customer.privateUrl === `https://tideway.example.com/quote#${proposalBody.proposal.reviewToken}` && preSendDispatchPackBody.cleaner.privateUrl === `https://tideway.example.com/opportunity#${proposalBody.proposal.cleanerReviewToken}` && preSendDispatchPackBody.customer.body.includes("Requested frequency: Weekly") && preSendDispatchPackBody.customer.body.includes("UK local time") && preSendDispatchPackBody.customer.body.includes("one dated visit") && preSendDispatchPackBody.cleaner.body.includes("Requested frequency: Weekly") && preSendDispatchPackBody.cleaner.body.includes("UK local time") && preSendDispatchPackBody.cleaner.body.includes("one dated visit") && !preSendDispatchPackBody.customer.body.includes(proposalBody.proposal.reviewToken) && !preSendDispatchPackBody.cleaner.body.includes(proposalBody.proposal.cleanerReviewToken), "Review-stage drafts omitted the verified origin, requested frequency, UK booking clock or one-visit boundary, or exposed a sendable private handoff before the offer was recorded as sent.");
  const quotePreview = await fetch(`${base}/api/quote`, { headers: { "x-quote-token": proposalBody.proposal.reviewToken } });
  const quotePreviewBody = await quotePreview.json();
  assert(quotePreview.ok && quotePreviewBody.quote.reference === proposalBody.proposal.id && quotePreviewBody.quote.frequency === "Weekly" && quotePreviewBody.quote.proposedStartTime === "09:00" && quotePreviewBody.quote.proposedEndTime === "13:00" && quotePreviewBody.quote.decisionAllowed === false && quotePreviewBody.quote.checklist.includes("Kitchen: Clean inside the oven") && quotePreviewBody.quote.confirmedExtras?.[0]?.code === "oven-interior", "Private customer quote preview omitted the approved frequency, scope, confirmed extra or schedule, or opened decisions too early.");
  const opportunityPreview = await fetch(`${base}/api/opportunity`, { headers: { "x-opportunity-token": proposalBody.proposal.cleanerReviewToken } });
  const opportunityPreviewBody = await opportunityPreview.json();
  assert(opportunityPreview.ok && opportunityPreviewBody.opportunity.reference === proposalBody.proposal.id && opportunityPreviewBody.opportunity.frequency === "Weekly" && opportunityPreviewBody.opportunity.proposedStartTime === "09:00" && opportunityPreviewBody.opportunity.proposedEndTime === "13:00" && opportunityPreviewBody.opportunity.decisionAllowed === false && opportunityPreviewBody.opportunity.cleanerPay === 72 && opportunityPreviewBody.opportunity.checklist.includes("Kitchen: Clean inside the oven") && opportunityPreviewBody.opportunity.confirmedExtras?.[0]?.code === "oven-interior" && opportunityPreviewBody.opportunity.photoSharingConsent === true && opportunityPreviewBody.opportunity.photoAccessAllowed === false && opportunityPreviewBody.opportunity.roomPhotos.length === 0, "Private cleaner opportunity preview omitted the requested frequency, reviewed scope, confirmed extra, schedule or pay, opened decisions too early or exposed photos before sending.");
  const previewSerialised = JSON.stringify(opportunityPreviewBody);
  assert(!previewSerialised.includes("customer@example.com") && !previewSerialised.includes("Test Customer") && !previewSerialised.includes("Collect keys"), "Cleaner opportunity preview leaked customer identity or access details.");
  const previewOpportunityPhoto = await fetch(`${base}/api/opportunity-photo?imageId=${briefBody.photos[0].id}`, { headers: { "x-opportunity-token": proposalBody.proposal.cleanerReviewToken } });
  assert(previewOpportunityPhoto.status === 404, "Room photo opened before the cleaner opportunity was sent.");
  const skippedTransition = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: proposalBody.proposal.id, status: "accepted" }) });
  assert(skippedTransition.status === 422, "Proposal status skipped the sent step.");
  const pausedCleaner = await fetch(`${base}/api/admin/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: cleanerBody.reference, kind: "cleaner", status: "paused" }) });
  assert(pausedCleaner.ok, "Approved cleaner could not be paused for proposal revalidation test.");
  const pausedOwnTracker = await fetch(`${base}/api/cleaner-status`, { headers: { "x-cleaner-status-token": cleanerBody.cleanerStatusToken } });
  const pausedOwnTrackerBody = await pausedOwnTracker.json();
  const pausedAvailabilityUpdate = await fetch(`${base}/api/cleaner-availability-requests`, { method: "POST", headers: { "content-type": "application/json", "x-cleaner-status-token": cleanerBody.cleanerStatusToken, "idempotency-key": "78787878-7878-4787-8787-787878787878" }, body: JSON.stringify({ availableDate: "2026-07-25", startTime: "09:00", endTime: "14:00" }) });
  assert(pausedOwnTracker.ok && pausedOwnTrackerBody.current.stage === "paused" && pausedOwnTrackerBody.readiness.approvalRecorded === false && pausedOwnTrackerBody.readiness.confirmedAvailabilityWindows === 0 && pausedOwnTrackerBody.links.availabilitySubmissionAllowed === false && pausedAvailabilityUpdate.status === 422 && pausedOwnTrackerBody.steps.find((step) => step.key === "opportunities")?.detail === "Not active for matching" && !JSON.stringify(pausedOwnTrackerBody).includes("Test confirmations only"), "Paused cleaner tracker remained match-ready, kept availability mutation open or exposed private screening notes.");
  const pausedCleanerSend = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: proposalBody.proposal.id, status: "sent" }) });
  assert(pausedCleanerSend.status === 422, "Proposal was sent after the selected cleaner was paused.");
  const restoredCleaner = await fetch(`${base}/api/admin/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: cleanerBody.reference, kind: "cleaner", status: "approved" }) });
  assert(restoredCleaner.ok, "Paused cleaner could not return to approved status after revalidation test.");
  const restoredOwnTracker = await fetch(`${base}/api/cleaner-status`, { headers: { "x-cleaner-status-token": cleanerBody.cleanerStatusToken } });
  assert(restoredOwnTracker.ok && (await restoredOwnTracker.json()).current.stage === "ready", "Cleaner tracker did not return to evidence-backed readiness after approval was restored.");
  const sentAtLowerBound = Date.now();
  const sentProposal = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: proposalBody.proposal.id, status: "sent" }) });
  assert(sentProposal.ok, "Sent proposal status failed.");
  const sentDispatchPack = await fetch(`${base}/api/admin/proposal-drafts?proposalId=${proposalBody.proposal.id}`);
  const sentDispatchPackBody = await sentDispatchPack.json();
  assert(sentDispatchPack.ok && sentDispatchPackBody.handoffReady === true && sentDispatchPackBody.customer.handoffReady === true && sentDispatchPackBody.cleaner.handoffReady === true && sentDispatchPackBody.customer.recipient.email === "customer@example.com" && sentDispatchPackBody.cleaner.recipient.email === "cleaner@example.com" && sentDispatchPackBody.customer.privateUrl === `https://tideway.example.com/quote#${proposalBody.proposal.reviewToken}` && sentDispatchPackBody.cleaner.privateUrl === `https://tideway.example.com/opportunity#${proposalBody.proposal.cleanerReviewToken}` && !sentDispatchPackBody.customer.privateUrl.includes("127.0.0.1") && !sentDispatchPackBody.cleaner.privateUrl.includes("127.0.0.1"), "Sent offer did not produce correctly paired customer and cleaner handoff packs on the verified public origin.");
  assert(!JSON.stringify(sentDispatchPackBody.customer).includes("cleaner@example.com") && !JSON.stringify(sentDispatchPackBody.customer).includes(proposalBody.proposal.cleanerReviewToken) && !JSON.stringify(sentDispatchPackBody.cleaner).includes("customer@example.com") && !JSON.stringify(sentDispatchPackBody.cleaner).includes(proposalBody.proposal.reviewToken), "A copy-only handoff crossed recipient identity or private-link tokens.");
  const quoteReadyTracker = await fetch(`${base}/api/request-status`, { headers: { "x-request-token": requestBody.customerStatusToken } });
  const quoteReadyTrackerBody = await quoteReadyTracker.json();
  assert(quoteReadyTracker.ok && quoteReadyTrackerBody.current.stage === "quote-review" && quoteReadyTrackerBody.links.quoteToken === proposalBody.proposal.reviewToken && !JSON.stringify(quoteReadyTrackerBody).includes(cleanerBody.reference) && !JSON.stringify(quoteReadyTrackerBody).includes("cleaner@example.com"), "Customer tracker did not expose the ready quote safely or leaked cleaner details.");
  const sentQuote = await fetch(`${base}/api/quote`, { headers: { "x-quote-token": proposalBody.proposal.reviewToken } });
  const sentQuoteBody = await sentQuote.json();
  const sentOpportunity = await fetch(`${base}/api/opportunity`, { headers: { "x-opportunity-token": proposalBody.proposal.cleanerReviewToken } });
  const sentOpportunityBody = await sentOpportunity.json();
  assert(sentQuote.ok && sentQuoteBody.quote.frequency === "Weekly" && sentQuoteBody.quote.requestedDate === "2026-07-20" && sentQuoteBody.quote.requestedTimeWindow === "Morning (8am–12pm)" && sentQuoteBody.quote.alternativeTiming === false && sentQuoteBody.quote.decisionAllowed === true && Date.parse(sentQuoteBody.quote.offerExpiresAt) >= sentAtLowerBound + 24 * 60 * 60 * 1000 - 2000 && sentQuoteBody.quote.expired === false && sentQuoteBody.quote.confirmedExtras?.[0]?.label === "Inside oven cleaning", "Sent customer quote did not expose its frozen requested timing, frequency, response deadline and confirmed extra.");
  assert(sentOpportunity.ok && sentOpportunityBody.opportunity.frequency === "Weekly" && sentOpportunityBody.opportunity.decisionAllowed === true && Date.parse(sentOpportunityBody.opportunity.offerExpiresAt) >= sentAtLowerBound + 12 * 60 * 60 * 1000 - 2000 && sentOpportunityBody.opportunity.expired === false && sentOpportunityBody.opportunity.confirmedExtras?.[0]?.label === "Inside oven cleaning" && sentOpportunityBody.opportunity.photoAccessAllowed === true && sentOpportunityBody.opportunity.roomPhotos?.[0]?.note === "Worktops, floor and inside oven need attention" && sentOpportunityBody.opportunity.roomPhotos?.[1]?.kind === "video" && sentOpportunityBody.opportunity.roomPhotos?.[1]?.durationSeconds === 8 && !JSON.stringify(sentOpportunityBody).includes("storedPath"), "Sent cleaner opportunity did not expose its frozen frequency, deadline, confirmed extra and authorised photo/video scope safely.");
  const protectedOpportunityPhoto = await fetch(`${base}/api/opportunity-photo?imageId=${briefBody.photos[0].id}`, { headers: { "x-opportunity-token": proposalBody.proposal.cleanerReviewToken } });
  assert(protectedOpportunityPhoto.ok && protectedOpportunityPhoto.headers.get("content-type") === "image/png" && protectedOpportunityPhoto.headers.get("cache-control") === "private, no-store" && (await protectedOpportunityPhoto.arrayBuffer()).byteLength > 0, "Selected cleaner could not load the customer-authorised private room photo.");
  const protectedOpportunityVideo = await fetch(`${base}/api/opportunity-photo?imageId=${briefBody.photos[1].id}`, { headers: { "x-opportunity-token": proposalBody.proposal.cleanerReviewToken } });
  assert(protectedOpportunityVideo.ok && protectedOpportunityVideo.headers.get("content-type") === "video/webm" && protectedOpportunityVideo.headers.get("cache-control") === "private, no-store" && (await protectedOpportunityVideo.arrayBuffer()).byteLength > 0, "Selected cleaner could not load the customer-authorised private room video.");
  const unprotectedOpportunityPhoto = await fetch(`${base}/api/opportunity-photo?imageId=${briefBody.photos[0].id}`);
  assert(unprotectedOpportunityPhoto.status === 404, "Room photo was exposed without the selected cleaner's private opportunity token.");
  await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, publicSiteUrl: "https://moved.tideway.example.com", publicSiteEvidenceNote: "moved.tideway.example.com ownership and HTTPS deployment were checked.", cancellationPolicy: "A later rule that must not rewrite an already-sent quote.", cleanerModel: "A later model that must not rewrite a sent opportunity." }) });
  const frozenOriginDispatchPack = await fetch(`${base}/api/admin/proposal-drafts?proposalId=${proposalBody.proposal.id}`);
  const frozenOriginDispatchPackBody = await frozenOriginDispatchPack.json();
  assert(frozenOriginDispatchPack.ok && frozenOriginDispatchPackBody.customer.privateUrl.startsWith("https://tideway.example.com/") && frozenOriginDispatchPackBody.cleaner.privateUrl.startsWith("https://tideway.example.com/") && !JSON.stringify(frozenOriginDispatchPackBody).includes("https://moved.tideway.example.com"), "A sent dispatch pack changed to a later public origin instead of retaining its frozen HTTPS host.");
  const frozenQuote = await fetch(`${base}/api/quote`, { headers: { "x-quote-token": proposalBody.proposal.reviewToken } });
  const frozenQuoteBody = await frozenQuote.json();
  assert(frozenQuote.ok && frozenQuoteBody.quote.cancellationPolicy === completeConfig.cancellationPolicy && frozenQuoteBody.quote.offerExpiresAt === sentQuoteBody.quote.offerExpiresAt && frozenQuoteBody.quote.confirmedExtras?.[0]?.code === "oven-interior", "An already-sent quote changed or lost its confirmed extra when operating settings were edited.");
  const frozenOpportunity = await fetch(`${base}/api/opportunity`, { headers: { "x-opportunity-token": proposalBody.proposal.cleanerReviewToken } });
  const frozenOpportunityBody = await frozenOpportunity.json();
  assert(frozenOpportunity.ok && frozenOpportunityBody.opportunity.cleanerModel === completeConfig.cleanerModel && frozenOpportunityBody.opportunity.offerExpiresAt === sentOpportunityBody.opportunity.offerExpiresAt && frozenOpportunityBody.opportunity.confirmedExtras?.[0]?.code === "oven-interior" && frozenOpportunityBody.opportunity.decisionAllowed === true, "An already-sent cleaner opportunity changed, lost its confirmed extra or remained closed after settings were edited.");
  await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(completeConfig) });
  await fetch(`${base}/api/admin/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: cleanerBody.reference, kind: "cleaner", status: "paused" }) });
  const pausedCleanerTracker = await fetch(`${base}/api/request-status`, { headers: { "x-request-token": requestBody.customerStatusToken } });
  const pausedCleanerTrackerBody = await pausedCleanerTracker.json();
  const pausedTrackerSerialised = JSON.stringify(pausedCleanerTrackerBody);
  assert(pausedCleanerTracker.ok && pausedCleanerTrackerBody.current.stage === "rematching" && pausedCleanerTrackerBody.current.headline === "Cleaner matching changed" && pausedCleanerTrackerBody.links.quoteToken === "" && pausedCleanerTrackerBody.steps.find((step) => step.key === "cleaner")?.detail === "Rematching in progress", "Customer tracker did not move safely into rematching when the selected cleaner lost eligibility.");
  assert(!pausedTrackerSerialised.includes(cleanerBody.reference) && !pausedTrackerSerialised.includes("cleaner@example.com") && !pausedTrackerSerialised.includes("paused"), "Eligibility rematching exposed cleaner identity or the internal eligibility reason.");
  const pausedDispatch = await fetch(`${base}/api/admin/records`);
  const pausedDispatchBody = await pausedDispatch.json();
  assert(pausedDispatch.ok && pausedDispatchBody.records.find((record) => record.id === requestBody.reference)?.dispatchActions?.some((action) => action.code === "rematch" && action.title === "Cleaner eligibility changed"), "Founder dispatch queue did not prioritise rematching after cleaner eligibility changed.");
  const pausedOpportunityPhoto = await fetch(`${base}/api/opportunity-photo?imageId=${briefBody.photos[0].id}`, { headers: { "x-opportunity-token": proposalBody.proposal.cleanerReviewToken } });
  assert(pausedOpportunityPhoto.status === 404, "Private room-photo access remained open while the selected cleaner was paused.");
  const pausedOpportunityVideo = await fetch(`${base}/api/opportunity-photo?imageId=${briefBody.photos[1].id}`, { headers: { "x-opportunity-token": proposalBody.proposal.cleanerReviewToken } });
  assert(pausedOpportunityVideo.status === 404, "Private room-video access remained open while the selected cleaner was paused.");
  const acceptanceWhileCleanerPaused = await fetch(`${base}/api/quote/decision`, { method: "POST", headers: { "content-type": "application/json", "x-quote-token": proposalBody.proposal.reviewToken }, body: JSON.stringify({ decision: "accepted", typedName: "Test Customer", scopeConfirmed: true, scheduleConfirmed: true, termsAccepted: true }) });
  assert(acceptanceWhileCleanerPaused.status === 409, "Customer quote remained open after the proposed cleaner was paused.");
  await fetch(`${base}/api/admin/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: cleanerBody.reference, kind: "cleaner", status: "approved" }) });
  const restoredOpportunityPhoto = await fetch(`${base}/api/opportunity-photo?imageId=${briefBody.photos[0].id}`, { headers: { "x-opportunity-token": proposalBody.proposal.cleanerReviewToken } });
  assert(restoredOpportunityPhoto.ok, "Private room-photo access did not return after the selected cleaner passed readiness checks again.");
  const adminAcceptedProposal = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: proposalBody.proposal.id, status: "accepted" }) });
  assert(adminAcceptedProposal.status === 422, "Control desk fabricated customer acceptance without the private quote flow.");
  const invalidQuote = await fetch(`${base}/api/quote`, { headers: { "x-quote-token": "not-a-private-quote-token" } });
  assert(invalidQuote.status === 404, "Invalid private quote token exposed proposal data.");
  const wrongNameDecision = await fetch(`${base}/api/quote/decision`, { method: "POST", headers: { "content-type": "application/json", "x-quote-token": proposalBody.proposal.reviewToken }, body: JSON.stringify({ decision: "accepted", typedName: "Someone Else", scopeConfirmed: true, scheduleConfirmed: true, termsAccepted: true }) });
  assert(wrongNameDecision.status === 422, "Private quote accepted a mismatched customer name.");
  const incompleteDecision = await fetch(`${base}/api/quote/decision`, { method: "POST", headers: { "content-type": "application/json", "x-quote-token": proposalBody.proposal.reviewToken }, body: JSON.stringify({ decision: "accepted", typedName: "Test Customer", scopeConfirmed: true, scheduleConfirmed: true, termsAccepted: false }) });
  assert(incompleteDecision.status === 422, "Private quote accepted without all required customer confirmations.");
  const missingScheduleDecision = await fetch(`${base}/api/quote/decision`, { method: "POST", headers: { "content-type": "application/json", "x-quote-token": proposalBody.proposal.reviewToken }, body: JSON.stringify({ decision: "accepted", typedName: "Test Customer", scopeConfirmed: true, termsAccepted: true }) });
  const missingScheduleDecisionBody = await missingScheduleDecision.json();
  assert(missingScheduleDecision.status === 422 && missingScheduleDecisionBody.error.includes("exact proposed schedule"), "Private quote accepted without explicit confirmation of the exact proposed timing.");
  await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, suppliesCostPerJob: 2 }) });
  const repricedQuote = await fetch(`${base}/api/quote`, { headers: { "x-quote-token": proposalBody.proposal.reviewToken } });
  const repricedQuoteBody = await repricedQuote.json();
  assert(repricedQuote.ok && repricedQuoteBody.quote.pricingChanged === true && repricedQuoteBody.quote.decisionAllowed === false, "A sent quote remained actionable after its founder cost model changed.");
  const repricedTracker = await fetch(`${base}/api/request-status`, { headers: { "x-request-token": requestBody.customerStatusToken } });
  const repricedTrackerBody = await repricedTracker.json();
  assert(repricedTracker.ok && repricedTrackerBody.current.headline === "Quote needs recalculation" && repricedTrackerBody.links.quoteToken === "", "Customer tracker exposed a stale-cost quote instead of returning to recalculation.");
  const staleCostAcceptance = await fetch(`${base}/api/quote/decision`, { method: "POST", headers: { "content-type": "application/json", "x-quote-token": proposalBody.proposal.reviewToken }, body: JSON.stringify({ decision: "accepted", typedName: "Test Customer", scopeConfirmed: true, scheduleConfirmed: true, termsAccepted: true }) });
  assert(staleCostAcceptance.status === 409, "Customer accepted a quote calculated from stale cost assumptions.");
  await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(completeConfig) });
  const acceptedProposal = await fetch(`${base}/api/quote/decision`, { method: "POST", headers: { "content-type": "application/json", "x-quote-token": proposalBody.proposal.reviewToken }, body: JSON.stringify({ decision: "accepted", typedName: "Test Customer", scopeConfirmed: true, scheduleConfirmed: true, termsAccepted: true }) });
  const acceptedProposalBody = await acceptedProposal.json();
  assert(acceptedProposal.ok && acceptedProposalBody.status === "accepted", "Audited private customer acceptance failed.");
  const cleanerOnlyDispatchPack = await fetch(`${base}/api/admin/proposal-drafts?proposalId=${proposalBody.proposal.id}`);
  const cleanerOnlyDispatchPackBody = await cleanerOnlyDispatchPack.json();
  assert(cleanerOnlyDispatchPack.ok && cleanerOnlyDispatchPackBody.handoffReady === true && cleanerOnlyDispatchPackBody.customer.handoffReady === false && cleanerOnlyDispatchPackBody.cleaner.handoffReady === true, "Customer acceptance did not close only the completed customer handoff while leaving the cleaner handoff available.");
  const acceptedQuoteTracker = await fetch(`${base}/api/request-status`, { headers: { "x-request-token": requestBody.customerStatusToken } });
  const acceptedQuoteTrackerBody = await acceptedQuoteTracker.json();
  assert(acceptedQuoteTracker.ok && acceptedQuoteTrackerBody.current.stage === "cleaner-confirmation" && acceptedQuoteTrackerBody.steps.find((step) => step.key === "quote")?.state === "complete", "Customer tracker did not move to cleaner confirmation after quote acceptance.");
  const duplicateDecision = await fetch(`${base}/api/quote/decision`, { method: "POST", headers: { "content-type": "application/json", "x-quote-token": proposalBody.proposal.reviewToken }, body: JSON.stringify({ decision: "declined", typedName: "Test Customer" }) });
  assert(duplicateDecision.status === 409, "A completed customer decision was overwritten.");
  const acceptedQuote = await fetch(`${base}/api/quote`, { headers: { "x-quote-token": proposalBody.proposal.reviewToken } });
  const acceptedQuoteBody = await acceptedQuote.json();
  assert(acceptedQuote.ok && acceptedQuoteBody.quote.decision?.status === "accepted" && acceptedQuoteBody.quote.confirmedExtras?.[0]?.code === "oven-interior" && acceptedQuoteBody.quote.decisionAllowed === false, "Accepted quote did not become a locked record with its confirmed extra retained.");

  const overlapRequest = await fetch(`${base}/api/cleaning-requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contactName: "Overlap Customer", email: "overlap@example.com", phone: "07123456780", postcode: "SW1A 2AA", customerType: "Landlord", propertyType: "Flat or house", service: "Rental turnover clean", siteSize: "1 bedroom and 1 bathroom", accessNotes: "Access to be confirmed", hazards: "None known", frequency: "One-off", preferredDate: "2026-07-20", preferredTimeWindow: "Afternoon (12pm–5pm)", consent: true })
  });
  const overlapRequestBody = await overlapRequest.json();
  assert(overlapRequest.status === 201, "Overlapping-schedule test request failed.");
  const overlapScan = await fetch(`${base}/api/job-briefs`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-token": overlapRequestBody.customerStatusToken },
    body: JSON.stringify({ requestId: overlapRequestBody.reference, email: "overlap@example.com", transcript: "In the kitchen wipe the worktops and mop the floor.", photos: [{ area: "Kitchen", note: "Worktops and floor need cleaning", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zs7sAAAAASUVORK5CYII=" }], scopeCompleteConfirmed: true, consent: true })
  });
  const overlapScanBody = await overlapScan.json();
  assert(overlapScan.status === 201, "Overlapping-schedule request room scan failed.");
  const reviewedOverlapScan = await fetch(`${base}/api/admin/job-briefs/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ briefId: overlapScanBody.reference, status: "reviewed", note: "Test-only two-hour scan estimate.", scopeEstimateHours: 2, scopeTimeBreakdown: reviewTimeBreakdown(overlapScanBody, 2), scopeConfidence: "medium", visualsReviewed: true, reviewedVisualIds: overlapScanBody.photos.map((photo) => photo.id), checklistReviewed: true }) });
  assert(reviewedOverlapScan.ok, "Overlapping-schedule request room scan was not reviewed.");
  const heldCapacityProposal = await fetch(`${base}/api/admin/proposals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: overlapRequestBody.reference, cleanerId: cleanerBody.reference, proposedDate: "2026-07-20", proposedStartTime: "11:00", estimatedHours: 2, customerRate: 30, cleanerRate: 18, otherCosts: 0 })
  });
  const heldCapacityProposalBody = await heldCapacityProposal.json();
  const heldCapacityReady = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: heldCapacityProposalBody.proposal.id, status: "ready" }) });
  const heldCapacitySent = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: heldCapacityProposalBody.proposal.id, status: "sent" }) });
  const heldCapacitySentBody = await heldCapacitySent.json();
  assert(heldCapacityProposal.status === 201 && heldCapacityReady.ok && heldCapacitySent.status === 409 && heldCapacitySentBody.error.includes("capacity is already held"), "An overlapping offer was sent while another live offer already held the cleaner's time.");
  const cancelledHeldCapacity = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: heldCapacityProposalBody.proposal.id, status: "cancelled", note: "Test-only draft withdrawn after the capacity gate worked." }) });
  assert(cancelledHeldCapacity.ok, "Capacity-gated proposal could not be withdrawn before rematching.");
  const overlapProposal = await fetch(`${base}/api/admin/proposals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: overlapRequestBody.reference, cleanerId: cleanerBody.reference, proposedDate: "2026-07-22", proposedStartTime: "09:00", estimatedHours: 2, customerRate: 30, cleanerRate: 18, otherCosts: 0 })
  });
  const overlapProposalBody = await overlapProposal.json();
  assert(overlapProposal.status === 201 && overlapProposalBody.proposal.proposedEndTime === "11:00", "Held-capacity test proposal failed.");
  const overlapReady = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: overlapProposalBody.proposal.id, status: "ready" }) });
  const overlapSent = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: overlapProposalBody.proposal.id, status: "sent" }) });
  assert(overlapReady.ok && overlapSent.ok, "A non-overlapping opportunity could not reserve confirmed cleaner capacity.");
  const alternativeTimingQuote = await fetch(`${base}/api/quote`, { headers: { "x-quote-token": overlapProposalBody.proposal.reviewToken } });
  const alternativeTimingQuoteBody = await alternativeTimingQuote.json();
  assert(alternativeTimingQuote.ok && alternativeTimingQuoteBody.quote.requestedDate === "2026-07-20" && alternativeTimingQuoteBody.quote.proposedDate === "2026-07-22" && alternativeTimingQuoteBody.quote.requestedTimeWindow === "Afternoon (12pm–5pm)" && alternativeTimingQuoteBody.quote.alternativeTiming === true && alternativeTimingQuoteBody.quote.alternativeTimingReasons.dateChanged === true && alternativeTimingQuoteBody.quote.alternativeTimingReasons.arrivalOutsideRequestedWindow === true, "Alternative-date/time quote did not distinguish the customer's frozen request from the exact proposed visit.");
  const noConsentOpportunityPhoto = await fetch(`${base}/api/opportunity-photo?imageId=${overlapScanBody.photos[0].id}`, { headers: { "x-opportunity-token": overlapProposalBody.proposal.cleanerReviewToken } });
  assert(noConsentOpportunityPhoto.status === 404, "A cleaner loaded room photos when the customer had not authorised pre-booking sharing.");
  const capacityAwareMatching = await fetch(`${base}/api/admin/matches?requestId=${overlapRequestBody.reference}`);
  const capacityAwareMatchingBody = await capacityAwareMatching.json();
  const firstCapacityAwareSlot = capacityAwareMatchingBody.matches?.[0]?.availabilitySlots?.[0];
  assert(capacityAwareMatching.ok && firstCapacityAwareSlot?.availableDate === "2026-07-20" && firstCapacityAwareSlot.suggestedStartTime === "13:00" && firstCapacityAwareSlot.suggestedEndTime === "15:00" && firstCapacityAwareSlot.capacityAdjusted === true && firstCapacityAwareSlot.heldIntervalsAvoided === 1, "Matching did not move the next suggested visit around an existing live capacity hold.");

  const replacementProposal = await fetch(`${base}/api/admin/proposals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: overlapRequestBody.reference, cleanerId: cleanerBody.reference, proposedDate: "2026-07-22", proposedStartTime: "09:00", estimatedHours: 2, customerRate: 30, cleanerRate: 18, otherCosts: 0 })
  });
  const replacementProposalBody = await replacementProposal.json();
  assert(replacementProposal.status === 201 && replacementProposalBody.proposal.replacesProposalId === overlapProposalBody.proposal.id && replacementProposalBody.proposal.replacementSequence === 2, "Replacement proposal draft was not linked to the offer it supersedes.");
  const competingReplacementReady = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: replacementProposalBody.proposal.id, status: "ready" }) });
  assert(competingReplacementReady.status === 409, "A second live proposal was allowed for the same cleaning request.");
  const declinedOverlapOpportunity = await fetch(`${base}/api/opportunity/decision`, { method: "POST", headers: { "content-type": "application/json", "x-opportunity-token": overlapProposalBody.proposal.cleanerReviewToken }, body: JSON.stringify({ decision: "declined", typedName: "Test Cleaner", reason: "Test-only schedule decline." }) });
  assert(declinedOverlapOpportunity.ok, "Cleaner could not decline the original opportunity before rematching.");
  const declinedDispatchPack = await fetch(`${base}/api/admin/proposal-drafts?proposalId=${overlapProposalBody.proposal.id}`);
  const declinedDispatchPackBody = await declinedDispatchPack.json();
  assert(declinedDispatchPack.ok && declinedDispatchPackBody.sendAllowed === false && declinedDispatchPackBody.handoffReady === false && declinedDispatchPackBody.customer.handoffReady === false && declinedDispatchPackBody.cleaner.handoffReady === false && declinedDispatchPackBody.warnings.some((warning) => warning.includes("cleaner declined")), "Cleaner decline left an exhausted customer or cleaner handoff available to copy.");
  const exhaustedCustomerQuote = await fetch(`${base}/api/quote`, { headers: { "x-quote-token": overlapProposalBody.proposal.reviewToken } });
  const exhaustedCustomerQuoteBody = await exhaustedCustomerQuote.json();
  assert(exhaustedCustomerQuote.ok && exhaustedCustomerQuoteBody.quote.cleanerDeclined === true && exhaustedCustomerQuoteBody.quote.decisionAllowed === false, "Customer quote remained actionable after its proposed cleaner declined.");
  const staleCustomerAcceptance = await fetch(`${base}/api/quote/decision`, { method: "POST", headers: { "content-type": "application/json", "x-quote-token": overlapProposalBody.proposal.reviewToken }, body: JSON.stringify({ decision: "accepted", typedName: "Overlap Customer", scopeConfirmed: true, scheduleConfirmed: true, termsAccepted: true }) });
  assert(staleCustomerAcceptance.status === 409, "Customer accepted an unfulfillable quote after the cleaner declined.");
  const replacementReady = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: replacementProposalBody.proposal.id, status: "ready" }) });
  const replacementSent = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: replacementProposalBody.proposal.id, status: "sent" }) });
  assert(replacementReady.ok && replacementSent.ok, "Replacement proposal did not reuse the released cleaner capacity after the original decline.");
  const replacementQuote = await fetch(`${base}/api/quote`, { headers: { "x-quote-token": replacementProposalBody.proposal.reviewToken } });
  const replacementQuoteBody = await replacementQuote.json();
  assert(replacementQuote.ok && replacementQuoteBody.quote.replacement?.previousReference === overlapProposalBody.proposal.id && replacementQuoteBody.quote.replacement?.previousCustomerAccepted === false && replacementQuoteBody.quote.replacement?.freshCustomerDecisionRequired === true && replacementQuoteBody.quote.replacement?.changes?.some((change) => change.key === "matching") && replacementQuoteBody.quote.decisionAllowed === true, "Replacement quote omitted its prior-offer audit, change summary or fresh-decision requirement.");
  const replacementTracker = await fetch(`${base}/api/request-status`, { headers: { "x-request-token": overlapRequestBody.customerStatusToken } });
  const replacementTrackerBody = await replacementTracker.json();
  assert(replacementTracker.ok && replacementTrackerBody.current.stage === "quote-review" && replacementTrackerBody.links.quoteToken === replacementProposalBody.proposal.reviewToken, "Customer tracker did not prioritise the replacement quote over the exhausted proposal.");
  const acceptedReplacement = await fetch(`${base}/api/quote/decision`, { method: "POST", headers: { "content-type": "application/json", "x-quote-token": replacementProposalBody.proposal.reviewToken }, body: JSON.stringify({ decision: "accepted", typedName: "Overlap Customer", scopeConfirmed: true, scheduleConfirmed: true, termsAccepted: true }) });
  assert(acceptedReplacement.ok, "Replacement customer quote could not be accepted.");
  const shortWithdrawal = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: replacementProposalBody.proposal.id, status: "cancelled", note: "Short" }) });
  assert(shortWithdrawal.status === 422, "Proposal withdrawal was recorded without an auditable reason.");
  const withdrawnReplacement = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: replacementProposalBody.proposal.id, status: "cancelled", note: "Test-only withdrawal before a booking was recorded." }) });
  assert(withdrawnReplacement.ok, "Accepted pre-booking proposal could not be withdrawn safely.");
  const withdrawnQuote = await fetch(`${base}/api/quote`, { headers: { "x-quote-token": replacementProposalBody.proposal.reviewToken } });
  const withdrawnQuoteBody = await withdrawnQuote.json();
  assert(withdrawnQuote.ok && withdrawnQuoteBody.quote.status === "cancelled" && withdrawnQuoteBody.quote.decision?.status === "accepted" && withdrawnQuoteBody.quote.decisionAllowed === false, "Withdrawn customer quote did not preserve its acceptance audit while becoming read-only.");
  const changedReplacement = await fetch(`${base}/api/admin/proposals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: overlapRequestBody.reference, cleanerId: cleanerBody.reference, proposedDate: "2026-07-22", proposedStartTime: "09:00", estimatedHours: 2, customerRate: 31, cleanerRate: 18, otherCosts: 0 })
  });
  const changedReplacementBody = await changedReplacement.json();
  assert(changedReplacement.status === 201 && changedReplacementBody.proposal.replacesProposalId === replacementProposalBody.proposal.id && changedReplacementBody.proposal.replacementSequence === 3, "Second replacement did not continue the prior-offer audit chain.");
  const changedReplacementReady = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: changedReplacementBody.proposal.id, status: "ready" }) });
  const changedReplacementSent = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: changedReplacementBody.proposal.id, status: "sent" }) });
  assert(changedReplacementReady.ok && changedReplacementSent.ok, "Audited replacement could not advance after its accepted predecessor was withdrawn.");
  const changedReplacementQuote = await fetch(`${base}/api/quote`, { headers: { "x-quote-token": changedReplacementBody.proposal.reviewToken } });
  const changedReplacementQuoteBody = await changedReplacementQuote.json();
  assert(changedReplacementQuote.ok && changedReplacementQuoteBody.quote.replacement?.previousReference === replacementProposalBody.proposal.id && changedReplacementQuoteBody.quote.replacement?.previousCustomerAccepted === true && changedReplacementQuoteBody.quote.replacement?.changes?.some((change) => change.key === "customer-total") && changedReplacementQuoteBody.quote.decision === null && changedReplacementQuoteBody.quote.decisionAllowed === true, "Changed replacement silently carried forward a prior acceptance or failed to disclose the changed customer total.");
  const closeChangedReplacement = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: changedReplacementBody.proposal.id, status: "cancelled", note: "Test-only closure after replacement lineage verification." }) });
  assert(closeChangedReplacement.ok, "Test replacement could not be closed after lineage verification.");
  const rematchingTracker = await fetch(`${base}/api/request-status`, { headers: { "x-request-token": overlapRequestBody.customerStatusToken } });
  const rematchingTrackerBody = await rematchingTracker.json();
  assert(rematchingTracker.ok && rematchingTrackerBody.current.stage === "rematching" && rematchingTrackerBody.links.quoteToken === "", "Customer tracker did not return to safe rematching after replacement withdrawal.");

  const bookingBeforeCleaner = await fetch(`${base}/api/admin/booking-audit?proposalId=${proposalBody.proposal.id}`);
  const bookingBeforeCleanerBody = await bookingBeforeCleaner.json();
  assert(bookingBeforeCleaner.ok && bookingBeforeCleanerBody.automatedReady === false && bookingBeforeCleanerBody.checks.customerAccepted === true && bookingBeforeCleanerBody.checks.cleanerAccepted === false, "Booking audit did not block while cleaner acceptance was missing.");
  const invalidOpportunity = await fetch(`${base}/api/opportunity`, { headers: { "x-opportunity-token": "not-an-opportunity-token" } });
  assert(invalidOpportunity.status === 404, "Invalid cleaner opportunity token exposed proposal data.");
  const wrongCleanerName = await fetch(`${base}/api/opportunity/decision`, { method: "POST", headers: { "content-type": "application/json", "x-opportunity-token": proposalBody.proposal.cleanerReviewToken }, body: JSON.stringify({ decision: "accepted", typedName: "Someone Else", scopeConfirmed: true, payConfirmed: true, availabilityConfirmed: true }) });
  assert(wrongCleanerName.status === 422, "Cleaner opportunity accepted a mismatched application name.");
  const incompleteCleanerDecision = await fetch(`${base}/api/opportunity/decision`, { method: "POST", headers: { "content-type": "application/json", "x-opportunity-token": proposalBody.proposal.cleanerReviewToken }, body: JSON.stringify({ decision: "accepted", typedName: "Test Cleaner", scopeConfirmed: true, payConfirmed: true, availabilityConfirmed: false }) });
  assert(incompleteCleanerDecision.status === 422, "Cleaner opportunity accepted without scope, pay and availability confirmations.");
  const availabilityWithdrawnBeforeDecision = await fetch(`${base}/api/admin/cleaner-availability`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ cleanerId: cleanerBody.reference, slotId: activeSlot20Id, note: "Test-only withdrawal before cleaner decision." }) });
  assert(availabilityWithdrawnBeforeDecision.ok, "Availability could not be withdrawn before the cleaner decision test.");
  const unavailableOpportunity = await fetch(`${base}/api/opportunity`, { headers: { "x-opportunity-token": proposalBody.proposal.cleanerReviewToken } });
  const unavailableOpportunityBody = await unavailableOpportunity.json();
  assert(unavailableOpportunity.ok && unavailableOpportunityBody.opportunity.availabilityChanged === true && unavailableOpportunityBody.opportunity.decisionAllowed === false, "Withdrawn availability did not close the private cleaner opportunity clearly.");
  const unavailableTracker = await fetch(`${base}/api/request-status`, { headers: { "x-request-token": requestBody.customerStatusToken } });
  const unavailableTrackerBody = await unavailableTracker.json();
  assert(unavailableTracker.ok && unavailableTrackerBody.current.stage === "rematching" && unavailableTrackerBody.current.headline === "Cleaner availability changed", "Customer tracker did not move to safe rematching after availability withdrawal.");
  const staleAvailabilityDecision = await fetch(`${base}/api/opportunity/decision`, { method: "POST", headers: { "content-type": "application/json", "x-opportunity-token": proposalBody.proposal.cleanerReviewToken }, body: JSON.stringify({ decision: "accepted", typedName: "Test Cleaner", scopeConfirmed: true, payConfirmed: true, availabilityConfirmed: true }) });
  assert(staleAvailabilityDecision.status === 409, "Cleaner accepted an opportunity after the confirmed availability window was withdrawn.");
  const reverifiedAvailability = await fetch(`${base}/api/admin/cleaner-availability`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cleanerId: cleanerBody.reference, availableDate: "2026-07-20", startTime: "08:00", endTime: "15:00", confirmationNote: "Test-only availability reverified before cleaner acceptance." }) });
  const reverifiedAvailabilityBody = await reverifiedAvailability.json();
  assert(reverifiedAvailability.status === 201, "Cleaner availability could not be reverified before acceptance.");
  activeSlot20Id = reverifiedAvailabilityBody.slot.id;
  const acceptedCleaner = await fetch(`${base}/api/opportunity/decision`, { method: "POST", headers: { "content-type": "application/json", "x-opportunity-token": proposalBody.proposal.cleanerReviewToken }, body: JSON.stringify({ decision: "accepted", typedName: "Test Cleaner", scopeConfirmed: true, payConfirmed: true, availabilityConfirmed: true }) });
  const acceptedCleanerBody = await acceptedCleaner.json();
  assert(acceptedCleaner.ok && acceptedCleanerBody.status === "accepted", "Audited private cleaner acceptance failed.");
  const bothAcceptedTracker = await fetch(`${base}/api/request-status`, { headers: { "x-request-token": requestBody.customerStatusToken } });
  const bothAcceptedTrackerBody = await bothAcceptedTracker.json();
  assert(bothAcceptedTracker.ok && bothAcceptedTrackerBody.current.stage === "finalising-booking" && bothAcceptedTrackerBody.steps.find((step) => step.key === "cleaner")?.state === "complete", "Customer tracker did not show final booking checks after both private acceptances.");
  const finalisationQueue = await fetch(`${base}/api/admin/records`);
  const finalisationQueueBody = await finalisationQueue.json();
  assert(finalisationQueue.ok && finalisationQueueBody.records.find((record) => record.id === requestBody.reference)?.dispatchActions?.some((action) => action.code === "finalise-booking" && action.group === "booking"), "Both-side acceptance did not create a final booking-check action.");
  assert(finalisationQueueBody.launchFunnel?.dispatchReadyCleaners >= 1 && finalisationQueueBody.launchFunnel?.stages?.find((stage) => stage.key === "offers")?.count >= 1 && finalisationQueueBody.launchFunnel?.stages?.find((stage) => stage.key === "accepted")?.count >= 1 && finalisationQueueBody.launchFunnel?.stages?.find((stage) => stage.key === "bookings")?.count === 0 && finalisationQueueBody.launchFunnel?.bottleneck?.key === "booking-confirmation" && finalisationQueueBody.launchFunnel?.parallelAction === null, "Ready first-booking funnel did not identify final booking confirmation or stop presenting a parallel launch-gate action.");
  const overlappingCleanerDecision = await fetch(`${base}/api/opportunity/decision`, { method: "POST", headers: { "content-type": "application/json", "x-opportunity-token": overlapProposalBody.proposal.cleanerReviewToken }, body: JSON.stringify({ decision: "accepted", typedName: "Test Cleaner", scopeConfirmed: true, payConfirmed: true, availabilityConfirmed: true }) });
  assert(overlappingCleanerDecision.status === 409, "Cleaner changed a completed decline after that opportunity's capacity had been released.");
  const duplicateCleanerDecision = await fetch(`${base}/api/opportunity/decision`, { method: "POST", headers: { "content-type": "application/json", "x-opportunity-token": proposalBody.proposal.cleanerReviewToken }, body: JSON.stringify({ decision: "declined", typedName: "Test Cleaner" }) });
  assert(duplicateCleanerDecision.status === 409, "A completed cleaner decision was overwritten.");
  const acceptedOpportunity = await fetch(`${base}/api/opportunity`, { headers: { "x-opportunity-token": proposalBody.proposal.cleanerReviewToken } });
  const acceptedOpportunityBody = await acceptedOpportunity.json();
  assert(acceptedOpportunity.ok && acceptedOpportunityBody.opportunity.decision?.status === "accepted" && acceptedOpportunityBody.opportunity.confirmedExtras?.[0]?.code === "oven-interior" && acceptedOpportunityBody.opportunity.decisionAllowed === false, "Accepted cleaner opportunity did not become a locked record with its confirmed extra retained.");

  const readyDrafts = await fetch(`${base}/api/admin/proposal-drafts?proposalId=${proposalBody.proposal.id}`);
  const readyDraftsBody = await readyDrafts.json();
  assert(readyDrafts.ok && readyDraftsBody.sendAllowed === true && readyDraftsBody.handoffReady === false && readyDraftsBody.customer.handoffReady === false && readyDraftsBody.cleaner.handoffReady === false, "Completed private decisions left a sendable handoff active or hid the locked drafts from review.");
  assert(readyDraftsBody.customer.body.includes("Test Customer") && readyDraftsBody.customer.body.includes("£120.00") && readyDraftsBody.customer.body.includes("09:00–13:00") && readyDraftsBody.customer.body.includes("Respond by:") && readyDraftsBody.customer.body.includes("Price-sensitive items included in this reviewed time and total:") && readyDraftsBody.customer.body.includes("Inside oven cleaning"), "Customer quote draft omitted required proposal, schedule, response deadline or confirmed extra.");
  assert(readyDraftsBody.cleaner.body.includes("£72.00") && readyDraftsBody.cleaner.body.includes("09:00–13:00") && readyDraftsBody.cleaner.body.includes("Respond by:") && readyDraftsBody.cleaner.body.includes("None known") && readyDraftsBody.cleaner.body.includes("Homle-reviewed cleaner checklist") && readyDraftsBody.cleaner.body.includes("Kitchen: Wipe every kitchen worktop") && readyDraftsBody.cleaner.body.includes("Price-sensitive items included in these hours and proposed pay:") && readyDraftsBody.cleaner.body.includes("Inside oven cleaning") && readyDraftsBody.cleaner.body.includes("Customer-authorised room visuals: 2") && readyDraftsBody.cleaner.body.includes("photos and short videos") && readyDraftsBody.cleaner.body.includes("private opportunity link") && !readyDraftsBody.cleaner.body.includes("customer@example.com") && !readyDraftsBody.cleaner.body.includes("Test Customer") && !readyDraftsBody.cleaner.body.includes("base64"), "Cleaner draft omitted reviewed schedule, pay, confirmed-extra or room-visual/checklist scope, or leaked customer identity or media data.");

  const bookingAudit = await fetch(`${base}/api/admin/booking-audit?proposalId=${proposalBody.proposal.id}`);
  const bookingAuditBody = await bookingAudit.json();
  assert(bookingAudit.ok && bookingAuditBody.automatedReady === true && bookingAuditBody.checks.customerScopeConfirmed === true && bookingAuditBody.checks.cleanerTravelCovered === true && bookingAuditBody.checks.frequencyCaptured === true && bookingAuditBody.checks.publicOriginFrozen === true && bookingAuditBody.publicSiteUrl === "https://tideway.example.com" && bookingAuditBody.customerDecision?.status === "accepted" && Object.values(bookingAuditBody.checks).every(Boolean), "Two-sided accepted proposal did not retain customer scope confirmation, requested frequency, frozen public origin, accepted customer decision and cleaner travel coverage or pass the automated booking audit.");
  assert(bookingAuditBody.manualChecklist.length >= 4 && bookingAuditBody.manualChecklist.some((item) => item.includes("exact accepted amount") && item.includes("provider reference")), "Booking audit omitted required payment-evidence confirmation.");
  const missingBookingHandoffs = await fetch(`${base}/api/admin/booking-drafts?bookingId=BKG-NOTFOUND`);
  assert(missingBookingHandoffs.status === 404, "Booking handoffs were fabricated without a confirmed booking.");

  const quotedStatus = await fetch(`${base}/api/admin/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: requestBody.reference, kind: "request", status: "quoted" }) });
  assert(quotedStatus.ok, "Customer request could not move from contacted to quoted.");
  const incompleteBooking = await fetch(`${base}/api/admin/bookings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: proposalBody.proposal.id, addressAndAccessConfirmed: true }) });
  assert(incompleteBooking.status === 422, "Incomplete manual confirmations created a booking.");
  const bookingInput = { proposalId: proposalBody.proposal.id, serviceAddress: "10 Clean Street, Westminster, London", servicePostcode: "SW1A 1AA", accessContactName: "Site Manager", accessContactPhone: "07123456781", accessInstructions: "Meet the site manager at reception. No access codes stored.", parkingNotes: "Paid parking nearby.", productsAndEquipment: "Cleaner brings standard products and equipment; customer provides site-specific consumables.", emergencyInstructions: "Stop work and call Homle support if the site is unsafe or materially different.", paymentEvidenceReference: "PAY-TEST-001", paymentEvidenceAmount: 120, paymentEvidenceVerifiedAt: new Date().toISOString(), addressAndAccessConfirmed: true, finalChecklistConfirmed: true, paymentAuthorisationConfirmed: true, emergencyInstructionsConfirmed: true, internalNote: "Test confirmation only" };
  const mismatchedBookingPostcode = await fetch(`${base}/api/admin/bookings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...bookingInput, servicePostcode: "SW2 1AA" }) });
  assert(mismatchedBookingPostcode.status === 422, "Booking pack changed the accepted service postcode.");
  const missingPaymentReference = await fetch(`${base}/api/admin/bookings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...bookingInput, paymentEvidenceReference: "" }) });
  assert(missingPaymentReference.status === 422, "A confirmed booking was recorded without a non-sensitive external payment reference.");
  const mismatchedPaymentAmount = await fetch(`${base}/api/admin/bookings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...bookingInput, paymentEvidenceAmount: 119.99 }) });
  assert(mismatchedPaymentAmount.status === 422, "A confirmed booking accepted external payment evidence below the frozen quote total.");
  const stalePaymentEvidence = await fetch(`${base}/api/admin/bookings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...bookingInput, paymentEvidenceVerifiedAt: "2020-01-01T00:00:00.000Z" }) });
  assert(stalePaymentEvidence.status === 422, "Payment evidence from before customer acceptance was accepted.");
  const futurePaymentEvidence = await fetch(`${base}/api/admin/bookings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...bookingInput, paymentEvidenceVerifiedAt: new Date(Date.now() + 60000).toISOString() }) });
  assert(futurePaymentEvidence.status === 422, "Future-dated payment evidence was accepted.");
  const confirmedBooking = await fetch(`${base}/api/admin/bookings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(bookingInput)
  });
  const confirmedBookingBody = await confirmedBooking.json();
  assert(confirmedBookingBody.booking?.plannedLabourOnCosts === 3.6, "Confirmed booking did not freeze the proposal's planned labour on-costs.");
  assert(confirmedBooking.status === 201 && confirmedBookingBody.booking.id.startsWith("BKG-") && confirmedBookingBody.booking.frequency === "Weekly" && confirmedBookingBody.booking.publicSiteUrl === "https://tideway.example.com" && confirmedBookingBody.booking.paymentEvidence.reference === "PAY-TEST-001" && confirmedBookingBody.booking.paymentEvidence.amount === 120 && confirmedBookingBody.booking.paymentEvidence.status === "authorisation-confirmed" && confirmedBookingBody.booking.paymentEvidence.providerName === "TestPay" && /^[A-Za-z0-9_-]{32}$/.test(confirmedBookingBody.booking.customerViewToken) && /^[A-Za-z0-9_-]{32}$/.test(confirmedBookingBody.booking.cleanerViewToken), "Fully confirmed booking, requested frequency, frozen public host, external payment evidence or its private view tokens were not recorded.");
  const bookingHandoffs = await fetch(`${base}/api/admin/booking-drafts?bookingId=${confirmedBookingBody.booking.id}`);
  const bookingHandoffsBody = await bookingHandoffs.json();
  const customerBookingHandoff = JSON.stringify(bookingHandoffsBody.customer || {});
  const cleanerBookingHandoff = JSON.stringify(bookingHandoffsBody.cleaner || {});
  assert(bookingHandoffs.ok && bookingHandoffsBody.handoffReady === true && bookingHandoffsBody.warnings.length === 0 && bookingHandoffsBody.customer.recipient.email === "customer@example.com" && bookingHandoffsBody.cleaner.recipient.email === "cleaner@example.com" && bookingHandoffsBody.customer.privateUrl === `https://tideway.example.com/booking-confirmation#${confirmedBookingBody.booking.customerViewToken}` && bookingHandoffsBody.cleaner.privateUrl === `https://tideway.example.com/assignment#${confirmedBookingBody.booking.cleanerViewToken}` && bookingHandoffsBody.customer.body.includes("Requested frequency: Weekly") && bookingHandoffsBody.customer.body.includes("UK local time") && bookingHandoffsBody.customer.body.includes("one dated visit only") && bookingHandoffsBody.cleaner.body.includes("Requested frequency: Weekly") && bookingHandoffsBody.cleaner.body.includes("UK local time") && bookingHandoffsBody.cleaner.body.includes("one dated assignment only"), "Confirmed-booking handoffs did not pair the frozen public links, frequency, UK booking clock and one-visit boundary with their intended recipients.");
  assert(!customerBookingHandoff.includes(confirmedBookingBody.booking.cleanerViewToken) && !customerBookingHandoff.includes("cleaner@example.com") && !customerBookingHandoff.includes("Test Cleaner") && !customerBookingHandoff.includes("Agreed cleaner pay") && !cleanerBookingHandoff.includes(confirmedBookingBody.booking.customerViewToken) && !cleanerBookingHandoff.includes("customer@example.com") && !cleanerBookingHandoff.includes("Test Customer") && !cleanerBookingHandoff.includes("10 Clean Street"), "A confirmed-booking handoff leaked the other recipient's token, identity, address or pay details.");
  const changedOriginAfterBooking = await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, publicSiteUrl: "https://moved.tideway.example.com", publicSiteEvidenceNote: "moved.tideway.example.com ownership and HTTPS deployment were checked." }) });
  assert(changedOriginAfterBooking.ok, "Test-only public-origin change after booking failed.");
  const frozenBookingHandoffs = await fetch(`${base}/api/admin/booking-drafts?bookingId=${confirmedBookingBody.booking.id}`);
  const frozenBookingHandoffsBody = await frozenBookingHandoffs.json();
  assert(frozenBookingHandoffs.ok && frozenBookingHandoffsBody.customer.privateUrl.startsWith("https://tideway.example.com/") && frozenBookingHandoffsBody.cleaner.privateUrl.startsWith("https://tideway.example.com/") && !JSON.stringify(frozenBookingHandoffsBody).includes("https://moved.tideway.example.com"), "Confirmed-booking handoffs changed to a later configured public host.");
  await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(completeConfig) });
  const postBookingProposal = await fetch(`${base}/api/admin/proposals`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: requestBody.reference, cleanerId: cleanerBody.reference, proposedDate: "2026-07-20", proposedStartTime: "09:00", estimatedHours: 4, customerRate: 30, cleanerRate: 18, otherCosts: 0 }) });
  assert(postBookingProposal.status === 409, "A new proposal was created for a request that already had a confirmed booking.");
  const postBookingOpportunityPhoto = await fetch(`${base}/api/opportunity-photo?imageId=${briefBody.photos[0].id}`, { headers: { "x-opportunity-token": proposalBody.proposal.cleanerReviewToken } });
  assert(postBookingOpportunityPhoto.status === 404, "Pre-booking opportunity photo access remained open after the confirmed booking pack took over.");
  const postBookingOpportunityVideo = await fetch(`${base}/api/opportunity-photo?imageId=${briefBody.photos[1].id}`, { headers: { "x-opportunity-token": proposalBody.proposal.cleanerReviewToken } });
  assert(postBookingOpportunityVideo.status === 404, "Pre-booking opportunity video access remained open after the confirmed booking pack took over.");
  const bookedCapacityMatching = await fetch(`${base}/api/admin/matches?requestId=${overlapRequestBody.reference}`);
  const bookedCapacityMatchingBody = await bookedCapacityMatching.json();
  const firstBookedCapacitySlot = bookedCapacityMatchingBody.matches?.[0]?.availabilitySlots?.[0];
  assert(bookedCapacityMatching.ok && firstBookedCapacitySlot?.availableDate === "2026-07-20" && firstBookedCapacitySlot.suggestedStartTime === "13:00" && firstBookedCapacitySlot.suggestedEndTime === "15:00" && firstBookedCapacitySlot.capacityAdjusted === true, "Confirmed booking capacity was not removed from later matching suggestions.");
  const bookedProposalWithdrawal = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: proposalBody.proposal.id, status: "cancelled", note: "Test-only attempt to withdraw a confirmed booking." }) });
  assert(bookedProposalWithdrawal.status === 409, "Proposal controls were allowed to cancel an already confirmed booking.");
  const bookedTracker = await fetch(`${base}/api/request-status`, { headers: { "x-request-token": requestBody.customerStatusToken } });
  const bookedTrackerBody = await bookedTracker.json();
  assert(bookedTracker.ok && bookedTrackerBody.current.stage === "booking-confirmed" && bookedTrackerBody.request.frequency === "Weekly" && bookedTrackerBody.links.bookingToken === confirmedBookingBody.booking.customerViewToken && bookedTrackerBody.visit.reference === confirmedBookingBody.booking.id && !JSON.stringify(bookedTrackerBody).includes("cleanerViewToken"), "Customer tracker did not retain the requested frequency or link the confirmed customer booking safely.");
  const bookedCustomerWithdrawal = await fetch(`${base}/api/request-withdrawal`, { method: "POST", headers: { "content-type": "application/json", "x-request-token": requestBody.customerStatusToken }, body: JSON.stringify({ reason: "no-longer-needed", confirmed: true }) });
  assert(bookedCustomerWithdrawal.status === 409, "The enquiry tracker was allowed to close a confirmed booking instead of requiring the protected booking-change workflow.");
  const invalidBookingPack = await fetch(`${base}/api/booking-pack`, { headers: { "x-booking-token": "not-a-booking-pack-token" } });
  assert(invalidBookingPack.status === 404, "Invalid booking-pack token exposed visit details.");
  const customerPack = await fetch(`${base}/api/booking-pack`, { headers: { "x-booking-token": confirmedBookingBody.booking.customerViewToken } });
  const customerPackBody = await customerPack.json();
  assert(customerPack.ok && customerPackBody.booking.audience === "customer" && customerPackBody.booking.frequency === "Weekly" && customerPackBody.booking.jobTiming?.arrivalCanBeRecorded === false && customerPackBody.booking.jobTiming?.completionCanBeRecorded === false && customerPackBody.booking.serviceAddress === "10 Clean Street, Westminster, London" && customerPackBody.booking.customerTotal === 120 && customerPackBody.booking.checklist.includes("Kitchen: Clean inside the oven") && customerPackBody.booking.confirmedExtras?.[0]?.code === "oven-interior" && customerPackBody.booking.roomPhotos?.[0]?.note === "Worktops, floor and inside oven need attention" && customerPackBody.booking.roomPhotos?.[1]?.kind === "video", "Customer booking pack omitted requested frequency, job-day timing gate, confirmed address, price, checklist, confirmed extra or protected photo/video details.");
  const customerPackSerialised = JSON.stringify(customerPackBody);
  assert(!customerPackSerialised.includes("cleaner@example.com") && !customerPackSerialised.includes("cleanerPay") && !customerPackSerialised.includes("cleanerRate") && !customerPackSerialised.includes("07123456781") && !customerPackSerialised.includes("storedPath") && !customerPackSerialised.includes("PAY-TEST-001") && !customerPackSerialised.includes("paymentEvidence"), "Customer booking pack exposed cleaner economics, payment evidence, private access-contact data or storage paths.");
  const protectedCustomerPhoto = await fetch(`${base}/api/booking-photo?imageId=${briefBody.photos[0].id}`, { headers: { "x-booking-token": confirmedBookingBody.booking.customerViewToken } });
  assert(protectedCustomerPhoto.ok && protectedCustomerPhoto.headers.get("content-type") === "image/png" && (await protectedCustomerPhoto.arrayBuffer()).byteLength > 0, "Customer could not load a protected booked room photo.");
  const protectedCustomerVideo = await fetch(`${base}/api/booking-photo?imageId=${briefBody.photos[1].id}`, { headers: { "x-booking-token": confirmedBookingBody.booking.customerViewToken } });
  assert(protectedCustomerVideo.ok && protectedCustomerVideo.headers.get("content-type") === "video/webm" && protectedCustomerVideo.headers.get("cache-control") === "private, no-store" && (await protectedCustomerVideo.arrayBuffer()).byteLength > 0, "Customer could not load a protected booked room video.");
  const unprotectedBookingPhoto = await fetch(`${base}/api/booking-photo?imageId=${briefBody.photos[0].id}`);
  assert(unprotectedBookingPhoto.status === 404, "Booked room photo was exposed without its private booking token.");
  const cleanerPack = await fetch(`${base}/api/booking-pack`, { headers: { "x-booking-token": confirmedBookingBody.booking.cleanerViewToken } });
  const cleanerPackBody = await cleanerPack.json();
  assert(cleanerPack.ok && cleanerPackBody.booking.audience === "cleaner" && cleanerPackBody.booking.frequency === "Weekly" && cleanerPackBody.booking.jobTiming?.arrivalCanBeRecorded === false && cleanerPackBody.booking.jobTiming?.arrivalOpensAt && cleanerPackBody.booking.serviceAddress === "10 Clean Street, Westminster, London" && cleanerPackBody.booking.accessContactName === "Site Manager" && cleanerPackBody.booking.accessContactPhone === "07123456781" && cleanerPackBody.booking.cleanerPay === 72 && cleanerPackBody.booking.confirmedExtras?.[0]?.label === "Inside oven cleaning" && cleanerPackBody.booking.roomPhotos?.[0]?.area === "Kitchen" && cleanerPackBody.booking.roomPhotos?.[1]?.mimeType === "video/webm", "Cleaner assignment pack omitted requested frequency, job-day timing gate, confirmed visit, access, pay, confirmed extra or room-scan media details.");
  const protectedCleanerPhoto = await fetch(`${base}/api/booking-photo?imageId=${briefBody.photos[0].id}`, { headers: { "x-booking-token": confirmedBookingBody.booking.cleanerViewToken } });
  assert(protectedCleanerPhoto.ok && protectedCleanerPhoto.headers.get("cache-control") === "private, no-store", "Cleaner could not load the protected room photo or it was cacheable.");
  const cleanerPackSerialised = JSON.stringify(cleanerPackBody);
  assert(!cleanerPackSerialised.includes("customer@example.com") && !cleanerPackSerialised.includes("Test Customer") && !cleanerPackSerialised.includes("customerTotal") && !cleanerPackSerialised.includes("PAY-TEST-001") && !cleanerPackSerialised.includes("paymentEvidence"), "Cleaner assignment pack exposed customer identity, customer price or payment evidence.");
  const invalidChangeRequest = await fetch(`${base}/api/booking-change-requests`, { method: "POST", headers: { "content-type": "application/json", "x-booking-token": confirmedBookingBody.booking.customerViewToken }, body: JSON.stringify({ type: "reschedule", message: "Short" }) });
  assert(invalidChangeRequest.status === 422, "Invalid or incomplete booking change request was accepted.");
  const customerChangeRequest = await fetch(`${base}/api/booking-change-requests`, { method: "POST", headers: { "content-type": "application/json", "x-booking-token": confirmedBookingBody.booking.customerViewToken }, body: JSON.stringify({ type: "reschedule", message: "Please review whether the visit can move to the following morning.", proposedDate: "2026-07-21", proposedStartTime: "10:00" }) });
  const customerChangeBody = await customerChangeRequest.json();
  assert(customerChangeRequest.status === 201 && customerChangeBody.reference.startsWith("CHG-") && customerChangeBody.status === "open", "Valid customer reschedule request was not recorded.");
  const cleanerSafetyRequest = await fetch(`${base}/api/booking-change-requests`, { method: "POST", headers: { "content-type": "application/json", "x-booking-token": confirmedBookingBody.booking.cleanerViewToken }, body: JSON.stringify({ type: "safety-issue", message: "Please review a potential site safety concern before arrival." }) });
  const cleanerSafetyBody = await cleanerSafetyRequest.json();
  assert(cleanerSafetyRequest.status === 201 && cleanerSafetyBody.reference.startsWith("CHG-"), "Valid cleaner safety request was not recorded.");
  const safetyQueue = await fetch(`${base}/api/admin/records`);
  const safetyQueueBody = await safetyQueue.json();
  assert(safetyQueue.ok && safetyQueueBody.records.find((record) => record.id === requestBody.reference)?.dispatchActions?.some((action) => action.code === "safety-review" && action.severity === "urgent") && safetyQueueBody.dispatchSummary.urgent >= 1, "Open safety report did not become the highest-priority dispatch action.");
  const customerPackWithRequest = await fetch(`${base}/api/booking-pack`, { headers: { "x-booking-token": confirmedBookingBody.booking.customerViewToken } });
  const customerPackWithRequestBody = await customerPackWithRequest.json();
  const cleanerPackWithRequest = await fetch(`${base}/api/booking-pack`, { headers: { "x-booking-token": confirmedBookingBody.booking.cleanerViewToken } });
  const cleanerPackWithRequestBody = await cleanerPackWithRequest.json();
  assert(customerPackWithRequestBody.booking.changeRequests.length === 1 && customerPackWithRequestBody.booking.changeRequests[0].id === customerChangeBody.reference && !JSON.stringify(customerPackWithRequestBody).includes(cleanerSafetyBody.reference), "Customer booking pack exposed another audience's request or lost its own.");
  assert(cleanerPackWithRequestBody.booking.changeRequests.length === 1 && cleanerPackWithRequestBody.booking.changeRequests[0].id === cleanerSafetyBody.reference && !JSON.stringify(cleanerPackWithRequestBody).includes(customerChangeBody.reference), "Cleaner booking pack exposed another audience's request or lost its own.");
  assert(customerPackWithRequestBody.booking.proposedDate === "2026-07-20" && customerPackWithRequestBody.booking.proposedStartTime === "09:00", "A reschedule request silently changed the confirmed booking.");
  const closeWithoutNote = await fetch(`${base}/api/admin/booking-change-requests/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ changeRequestId: customerChangeBody.reference, status: "closed" }) });
  assert(closeWithoutNote.status === 422, "Booking change request closed without a clear response note.");
  const reviewingChange = await fetch(`${base}/api/admin/booking-change-requests/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ changeRequestId: customerChangeBody.reference, status: "reviewing" }) });
  assert(reviewingChange.ok, "Booking change request could not move into review.");
  const closedChange = await fetch(`${base}/api/admin/booking-change-requests/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ changeRequestId: customerChangeBody.reference, status: "closed", note: "Homle recorded the request; the original booking remains unchanged pending a separately accepted proposal." }) });
  assert(closedChange.ok, "Booking change request could not close with a response note.");
  const reopenClosedChange = await fetch(`${base}/api/admin/booking-change-requests/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ changeRequestId: customerChangeBody.reference, status: "open" }) });
  assert(reopenClosedChange.status === 422, "Closed booking change history was overwritten.");
  const resolvedCustomerPack = await fetch(`${base}/api/booking-pack`, { headers: { "x-booking-token": confirmedBookingBody.booking.customerViewToken } });
  const resolvedCustomerPackBody = await resolvedCustomerPack.json();
  assert(resolvedCustomerPackBody.booking.changeRequests[0].status === "closed" && resolvedCustomerPackBody.booking.changeRequests[0].resolutionNote.includes("original booking remains unchanged"), "Customer could not see the reviewed change-request outcome.");
  const duplicateBooking = await fetch(`${base}/api/admin/bookings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(bookingInput) });
  assert(duplicateBooking.status === 409, "A duplicate confirmed booking was not rejected.");

  const prematureOutcome = await fetch(`${base}/api/admin/job-outcomes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingId: confirmedBookingBody.booking.id, actualHours: 4, customerCollected: 120, cleanerPaid: 72, labourOnCosts: 3.6, otherCosts: 10, refundAmount: 0, customerReceiptReference: "RECEIPT-EARLY-001", cleanerPayoutReference: "PAYOUT-EARLY-001", settlementVerifiedAt: new Date().toISOString(), settlementEvidenceNote: "Test-only early settlement evidence must remain blocked.", settlementConfirmed: true }) });
  assert(prematureOutcome.status === 422, "Final job economics were recorded before the operational completion timeline.");
  const wrongAudienceEvent = await fetch(`${base}/api/job-events`, { method: "POST", headers: { "content-type": "application/json", "x-booking-token": confirmedBookingBody.booking.customerViewToken }, body: JSON.stringify({ type: "cleaner-arrived", addressConfirmed: true, safeToStart: true, scopeAccessible: true }) });
  assert(wrongAudienceEvent.status === 403, "Customer booking link recorded a cleaner-only job event.");
  const arrivalBeforeWindow = await fetch(`${base}/api/job-events`, { method: "POST", headers: { "content-type": "application/json", "x-booking-token": confirmedBookingBody.booking.cleanerViewToken }, body: JSON.stringify({ type: "cleaner-arrived", addressConfirmed: true, safeToStart: true, scopeAccessible: true }) });
  const arrivalBeforeWindowBody = await arrivalBeforeWindow.json();
  assert(arrivalBeforeWindow.status === 409 && arrivalBeforeWindowBody.error.includes("30 minutes before"), "A future visit was marked arrived before its job-day window opened.");
  const completedBeforeArrival = await fetch(`${base}/api/job-events`, { method: "POST", headers: { "content-type": "application/json", "x-booking-token": confirmedBookingBody.booking.cleanerViewToken }, body: JSON.stringify({ type: "cleaner-completed", checklistCompleted: true, siteSecured: true, issuesDisclosed: true }) });
  assert(completedBeforeArrival.status === 409, "Cleaner completion was recorded before arrival.");
  const nearStartSchedule = testWallClockSlot(15);
  await rewriteTestBookingSchedule(confirmedBookingBody.booking.id, nearStartSchedule);
  const arrivalBlockedBySafety = await fetch(`${base}/api/job-events`, { method: "POST", headers: { "content-type": "application/json", "x-booking-token": confirmedBookingBody.booking.cleanerViewToken }, body: JSON.stringify({ type: "cleaner-arrived", addressConfirmed: true, safeToStart: true, scopeAccessible: true }) });
  assert(arrivalBlockedBySafety.status === 409, "Cleaner started while a safety request remained open.");
  const closedSafety = await fetch(`${base}/api/admin/booking-change-requests/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ changeRequestId: cleanerSafetyBody.reference, status: "closed", note: "Safety concern reviewed and resolved before the cleaner records arrival." }) });
  assert(closedSafety.ok, "Safety request could not be resolved before job start.");
  const incompleteArrival = await fetch(`${base}/api/job-events`, { method: "POST", headers: { "content-type": "application/json", "x-booking-token": confirmedBookingBody.booking.cleanerViewToken }, body: JSON.stringify({ type: "cleaner-arrived", addressConfirmed: true }) });
  assert(incompleteArrival.status === 422, "Cleaner arrival was recorded without all safe-start confirmations.");
  const cleanerArrival = await fetch(`${base}/api/job-events`, { method: "POST", headers: { "content-type": "application/json", "x-booking-token": confirmedBookingBody.booking.cleanerViewToken }, body: JSON.stringify({ type: "cleaner-arrived", addressConfirmed: true, safeToStart: true, scopeAccessible: true, note: "Test arrival only" }) });
  const cleanerArrivalBody = await cleanerArrival.json();
  assert(cleanerArrival.status === 201 && cleanerArrivalBody.reference.startsWith("EVT-") && cleanerArrivalBody.jobTiming?.arrivalCanBeRecorded === true && cleanerArrivalBody.jobTiming?.completionCanBeRecorded === false, "Valid near-start cleaner arrival or its completion gate was not recorded.");
  const arrivalTracker = await fetch(`${base}/api/request-status`, { headers: { "x-request-token": requestBody.customerStatusToken } });
  const arrivalTrackerBody = await arrivalTracker.json();
  assert(arrivalTracker.ok && arrivalTrackerBody.current.stage === "clean-in-progress" && arrivalTrackerBody.visit.jobProgress.cleanerArrivedAt, "Customer tracker did not show the recorded cleaner arrival.");
  const completionBeforeVisitStart = await fetch(`${base}/api/job-events`, { method: "POST", headers: { "content-type": "application/json", "x-booking-token": confirmedBookingBody.booking.cleanerViewToken }, body: JSON.stringify({ type: "cleaner-completed", checklistCompleted: true, siteSecured: true, issuesDisclosed: true }) });
  const completionBeforeVisitStartBody = await completionBeforeVisitStart.json();
  assert(completionBeforeVisitStart.status === 409 && completionBeforeVisitStartBody.error.includes("before the confirmed visit starts"), "Cleaner completion was recorded during the permitted early-arrival window but before the visit start.");
  await rewriteTestBookingSchedule(confirmedBookingBody.booking.id, testWallClockSlot(-24 * 60));
  const duplicateArrival = await fetch(`${base}/api/job-events`, { method: "POST", headers: { "content-type": "application/json", "x-booking-token": confirmedBookingBody.booking.cleanerViewToken }, body: JSON.stringify({ type: "cleaner-arrived", addressConfirmed: true, safeToStart: true, scopeAccessible: true }) });
  assert(duplicateArrival.status === 409, "Duplicate cleaner arrival overwrote the timeline.");
  const earlyCustomerCompletion = await fetch(`${base}/api/job-events`, { method: "POST", headers: { "content-type": "application/json", "x-booking-token": confirmedBookingBody.booking.customerViewToken }, body: JSON.stringify({ type: "customer-completed", serviceReceived: true, completionDetailsAccurate: true }) });
  assert(earlyCustomerCompletion.status === 409, "Customer acknowledged completion before the cleaner finished.");
  const cleanerCompletion = await fetch(`${base}/api/job-events`, { method: "POST", headers: { "content-type": "application/json", "x-booking-token": confirmedBookingBody.booking.cleanerViewToken }, body: JSON.stringify({ type: "cleaner-completed", checklistCompleted: true, siteSecured: true, issuesDisclosed: true, note: "Test completion only" }) });
  assert(cleanerCompletion.status === 201, "Valid cleaner completion was not recorded.");
  const customerCompletion = await fetch(`${base}/api/job-events`, { method: "POST", headers: { "content-type": "application/json", "x-booking-token": confirmedBookingBody.booking.customerViewToken }, body: JSON.stringify({ type: "customer-completed", serviceReceived: true, completionDetailsAccurate: true }) });
  assert(customerCompletion.status === 201, "Valid customer completion acknowledgement was not recorded.");
  const acknowledgedTracker = await fetch(`${base}/api/request-status`, { headers: { "x-request-token": requestBody.customerStatusToken } });
  const acknowledgedTrackerBody = await acknowledgedTracker.json();
  assert(acknowledgedTracker.ok && acknowledgedTrackerBody.current.stage === "completion-recorded" && acknowledgedTrackerBody.steps.find((step) => step.key === "clean")?.state === "complete", "Customer tracker did not show acknowledged completion.");
  const packAfterCompletion = await fetch(`${base}/api/booking-pack`, { headers: { "x-booking-token": confirmedBookingBody.booking.customerViewToken } });
  const packAfterCompletionBody = await packAfterCompletion.json();
  assert(packAfterCompletionBody.booking.jobProgress.readyForOutcome === true && packAfterCompletionBody.booking.jobProgress.cleanerArrivedAt && packAfterCompletionBody.booking.jobProgress.cleanerCompletedAt && packAfterCompletionBody.booking.jobProgress.customerCompletedAt, "Private booking pack did not show the completed job timeline.");

  const unsafeCompletionStatus = await fetch(`${base}/api/admin/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: requestBody.reference, kind: "request", status: "completed" }) });
  assert(unsafeCompletionStatus.status === 422, "Request bypassed the completed-job workflow.");
  const settlementEvidence = { customerReceiptReference: "RECEIPT-TEST-001", cleanerPayoutReference: "PAYOUT-TEST-001", settlementVerifiedAt: new Date().toISOString(), settlementEvidenceNote: "Test-only customer receipt and cleaner payout evidence verified.", settlementConfirmed: true };
  const missingLabourOnCosts = await fetch(`${base}/api/admin/job-outcomes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingId: confirmedBookingBody.booking.id, actualHours: 4, customerCollected: 120, cleanerPaid: 72, ...settlementEvidence }) });
  assert(missingLabourOnCosts.status === 422, "Completed-job economics omitted actual labour on-costs.");
  const missingSettlementEvidence = await fetch(`${base}/api/admin/job-outcomes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingId: confirmedBookingBody.booking.id, actualHours: 4, customerCollected: 120, cleanerPaid: 72, labourOnCosts: 3.6 }) });
  assert(missingSettlementEvidence.status === 422, "Typed receipt and cleaner-pay amounts were accepted without external settlement evidence.");
  const invalidOutcome = await fetch(`${base}/api/admin/job-outcomes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingId: confirmedBookingBody.booking.id, actualHours: 4, customerCollected: 0, cleanerPaid: 72, labourOnCosts: 3.6 }) });
  assert(invalidOutcome.status === 422, "Invalid actual job economics were accepted.");
  const mismatchedCustomerReceipt = await fetch(`${base}/api/admin/job-outcomes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingId: confirmedBookingBody.booking.id, actualHours: 4, customerCollected: 119.99, cleanerPaid: 72, labourOnCosts: 3.6, ...settlementEvidence }) });
  assert(mismatchedCustomerReceipt.status === 422, "A customer receipt below the frozen accepted total was accepted as final settlement.");
  const underpaidCleaner = await fetch(`${base}/api/admin/job-outcomes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingId: confirmedBookingBody.booking.id, actualHours: 4, customerCollected: 120, cleanerPaid: 71.99, labourOnCosts: 3.6, ...settlementEvidence }) });
  assert(underpaidCleaner.status === 422, "A cleaner payout below the agreed booking pay was accepted.");
  const sameSettlementReferences = await fetch(`${base}/api/admin/job-outcomes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingId: confirmedBookingBody.booking.id, actualHours: 4, customerCollected: 120, cleanerPaid: 72, labourOnCosts: 3.6, ...settlementEvidence, cleanerPayoutReference: settlementEvidence.customerReceiptReference }) });
  assert(sameSettlementReferences.status === 422, "One external reference was accepted as both the customer receipt and cleaner payout.");
  const staleSettlementEvidence = await fetch(`${base}/api/admin/job-outcomes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingId: confirmedBookingBody.booking.id, actualHours: 4, customerCollected: 120, cleanerPaid: 72, labourOnCosts: 3.6, ...settlementEvidence, settlementVerifiedAt: "2020-01-01T00:00:00.000Z" }) });
  assert(staleSettlementEvidence.status === 422, "Settlement evidence predating customer completion was accepted.");
  const futureSettlementEvidence = await fetch(`${base}/api/admin/job-outcomes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingId: confirmedBookingBody.booking.id, actualHours: 4, customerCollected: 120, cleanerPaid: 72, labourOnCosts: 3.6, ...settlementEvidence, settlementVerifiedAt: new Date(Date.now() + 60_000).toISOString() }) });
  assert(futureSettlementEvidence.status === 422, "Future-dated settlement verification was accepted.");
  const unconfirmedSettlementEvidence = await fetch(`${base}/api/admin/job-outcomes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingId: confirmedBookingBody.booking.id, actualHours: 4, customerCollected: 120, cleanerPaid: 72, labourOnCosts: 3.6, ...settlementEvidence, settlementConfirmed: false }) });
  assert(unconfirmedSettlementEvidence.status === 422, "Settlement evidence was accepted without confirming the external money movements occurred.");
  const negativeActualCost = await fetch(`${base}/api/admin/job-outcomes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingId: confirmedBookingBody.booking.id, actualHours: 4, customerCollected: 120, cleanerPaid: 72, labourOnCosts: 3.6, paymentFees: -1, ...settlementEvidence }) });
  assert(negativeActualCost.status === 422, "A negative actual payment fee was accepted.");
  const excessiveActualHours = await fetch(`${base}/api/admin/job-outcomes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingId: confirmedBookingBody.booking.id, actualHours: 101, customerCollected: 120, cleanerPaid: 72, labourOnCosts: 3.6, ...settlementEvidence }) });
  assert(excessiveActualHours.status === 422, "Completed-job evidence exceeded the supported actual-hours audit limit.");
  const excessiveActualCost = await fetch(`${base}/api/admin/job-outcomes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingId: confirmedBookingBody.booking.id, actualHours: 4, customerCollected: 120, cleanerPaid: 72, labourOnCosts: 3.6, otherCosts: 1000001, ...settlementEvidence }) });
  assert(excessiveActualCost.status === 422, "Completed-job evidence exceeded the supported financial audit limit.");
  const completedOutcomeInput = { bookingId: confirmedBookingBody.booking.id, actualHours: 4.5, customerCollected: 120, cleanerPaid: 72, labourOnCosts: 3.6, paymentFees: 2, travelCosts: 1, suppliesCosts: 1, otherCosts: 2.4, refundAmount: 5, internalNote: "Test completion only", ...settlementEvidence };
  const completedOutcomeAttempts = await Promise.all([1, 2].map(() => fetch(`${base}/api/admin/job-outcomes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(completedOutcomeInput) })));
  const completedJob = completedOutcomeAttempts.find((response) => response.status === 201);
  const duplicateOutcome = completedOutcomeAttempts.find((response) => response.status === 409);
  assert(completedJob && duplicateOutcome, "Concurrent completed-job writes were not reduced to one authoritative outcome.");
  const completedJobBody = await completedJob.json();
  assert(completedJob.status === 201 && completedJobBody.outcome.totalDirectCosts === 10 && completedJobBody.outcome.labourOnCosts === 3.6 && completedJobBody.outcome.paymentFees === 2 && completedJobBody.outcome.contribution === 33 && completedJobBody.outcome.profitable === true && completedJobBody.outcome.metTargetMargin === true && completedJobBody.outcome.settlementEvidence.customerReceiptReference === "RECEIPT-TEST-001" && completedJobBody.outcome.settlementEvidence.cleanerPayoutReference === "PAYOUT-TEST-001" && completedJobBody.outcome.settlementEvidence.confirmedExternally === true, "Completed-job actual labour and variable costs or external receipt/payout evidence were not recorded correctly.");
  const completedTracker = await fetch(`${base}/api/request-status`, { headers: { "x-request-token": requestBody.customerStatusToken } });
  const completedTrackerBody = await completedTracker.json();
  assert(completedTracker.ok && completedTrackerBody.current.stage === "completed" && completedTrackerBody.links.bookingToken === confirmedBookingBody.booking.customerViewToken, "Customer tracker did not reach completed status after the final job outcome.");
  const customerPackAfterOutcome = await fetch(`${base}/api/booking-pack`, { headers: { "x-booking-token": confirmedBookingBody.booking.customerViewToken } });
  const cleanerPackAfterOutcome = await fetch(`${base}/api/booking-pack`, { headers: { "x-booking-token": confirmedBookingBody.booking.cleanerViewToken } });
  const recipientOutcomeText = `${await customerPackAfterOutcome.text()} ${await cleanerPackAfterOutcome.text()}`;
  assert(!recipientOutcomeText.includes("RECEIPT-TEST-001") && !recipientOutcomeText.includes("PAYOUT-TEST-001") && !recipientOutcomeText.includes("settlementEvidence"), "Private settlement references leaked into a customer or cleaner booking pack.");

  const profitableBeforeAdjustment = await fetch(`${base}/api/admin/records`);
  const profitableBeforeAdjustmentBody = await profitableBeforeAdjustment.json();
  assert(profitableBeforeAdjustmentBody.launchFunnel?.goal?.achieved === true && profitableBeforeAdjustmentBody.launchFunnel.goal.contribution === 33, "First-booking runway did not initially recognise the evidence-backed profitable outcome.");
  const qualityIssue = await fetch(`${base}/api/booking-change-requests`, { method: "POST", headers: { "content-type": "application/json", "x-booking-token": confirmedBookingBody.booking.customerViewToken }, body: JSON.stringify({ type: "quality-issue", message: "The customer reports that part of the agreed kitchen clean needs review." }) });
  const qualityIssueBody = await qualityIssue.json();
  assert(qualityIssue.status === 201 && qualityIssueBody.reference.startsWith("CHG-"), "Post-completion cleaning quality issue was not recorded through the protected booking pack.");
  const qualityQueue = await fetch(`${base}/api/admin/records`);
  const qualityQueueBody = await qualityQueue.json();
  assert(qualityQueueBody.records.find((record) => record.id === requestBody.reference)?.dispatchActions?.some((action) => action.code === "booking-change-review"), "Post-completion quality issue did not enter the founder-action queue.");
  const adjustmentWithOpenIssue = await fetch(`${base}/api/admin/job-outcome-adjustments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingId: confirmedBookingBody.booking.id, reasonType: "re-clean", sourceReference: "CASE-QUALITY-001", relatedChangeRequestId: qualityIssueBody.reference, additionalHours: 1.5, additionalCleanerPaid: 20, additionalOtherCosts: 5, additionalRefundAmount: 20, externalActionConfirmed: true, internalNote: "Test-only re-clean and refund evidence checked after completion." }) });
  assert(adjustmentWithOpenIssue.status === 422, "Final financial adjustment was recorded before its related quality issue was resolved.");
  const closedQualityIssue = await fetch(`${base}/api/admin/booking-change-requests/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ changeRequestId: qualityIssueBody.reference, status: "closed", note: "Test-only quality issue reviewed; later re-clean and refund amounts were confirmed externally." }) });
  assert(closedQualityIssue.ok, "Post-completion quality issue could not be closed with a resolution record.");
  const unconfirmedAdjustment = await fetch(`${base}/api/admin/job-outcome-adjustments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingId: confirmedBookingBody.booking.id, reasonType: "re-clean", sourceReference: "CASE-QUALITY-001", relatedChangeRequestId: qualityIssueBody.reference, additionalRefundAmount: 20, internalNote: "Test-only re-clean and refund evidence checked after completion." }) });
  assert(unconfirmedAdjustment.status === 422, "Later job economics were recorded without confirmation that external work or money movement already occurred.");
  const negativeAdjustment = await fetch(`${base}/api/admin/job-outcome-adjustments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingId: confirmedBookingBody.booking.id, reasonType: "record-correction", sourceReference: "CASE-NEGATIVE", additionalOtherCosts: -1, externalActionConfirmed: true, internalNote: "Test-only invalid negative adjustment that must be rejected." }) });
  assert(negativeAdjustment.status === 422, "A negative append-only job adjustment was accepted.");
  const outcomeAdjustment = await fetch(`${base}/api/admin/job-outcome-adjustments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingId: confirmedBookingBody.booking.id, reasonType: "re-clean", sourceReference: "CASE-QUALITY-001", relatedChangeRequestId: qualityIssueBody.reference, additionalHours: 1.5, additionalCleanerPaid: 20, additionalLabourOnCosts: 1, additionalOtherCosts: 5, additionalRefundAmount: 20, externalActionConfirmed: true, internalNote: "Test-only re-clean and refund evidence checked after completion." }) });
  const outcomeAdjustmentBody = await outcomeAdjustment.json();
  assert(outcomeAdjustment.status === 201 && outcomeAdjustmentBody.outcome.adjusted === true && outcomeAdjustmentBody.outcome.original.contribution === 33 && outcomeAdjustmentBody.outcome.labourOnCosts === 4.6 && outcomeAdjustmentBody.outcome.actualHours === 6 && outcomeAdjustmentBody.outcome.refundAmount === 25 && outcomeAdjustmentBody.outcome.contribution === -13 && outcomeAdjustmentBody.outcome.profitable === false && outcomeAdjustmentBody.outcome.metTargetMargin === false, "Later re-clean/refund and labour on-cost evidence did not revise the append-only completed-job economics correctly.");
  const cumulativeLimitAdjustment = await fetch(`${base}/api/admin/job-outcome-adjustments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingId: confirmedBookingBody.booking.id, reasonType: "late-provider-cost", sourceReference: "CASE-CUMULATIVE-LIMIT", additionalOtherCosts: 999993, externalActionConfirmed: true, internalNote: "Test-only cumulative financial limit must reject this adjustment before storage." }) });
  assert(cumulativeLimitAdjustment.status === 422, "A later adjustment pushed cumulative completed-job economics beyond the supported audit limit.");
  const duplicateAdjustment = await fetch(`${base}/api/admin/job-outcome-adjustments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingId: confirmedBookingBody.booking.id, reasonType: "re-clean", sourceReference: "case-quality-001", additionalOtherCosts: 1, externalActionConfirmed: true, internalNote: "Test-only duplicate case reference that must be rejected." }) });
  assert(duplicateAdjustment.status === 409, "Duplicate external adjustment reference was not blocked atomically.");
  const protectedAdjustment = await fetch(`${base}/api/admin/job-outcome-adjustments`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.12" }, body: JSON.stringify({ bookingId: confirmedBookingBody.booking.id, reasonType: "other", sourceReference: "CASE-REMOTE", additionalOtherCosts: 1, externalActionConfirmed: true, internalNote: "Test-only remote adjustment attempt that must be blocked." }) });
  assert(protectedAdjustment.status === 401, "Post-completion financial adjustment bypassed admin authentication.");
  const adjustedTracker = await fetch(`${base}/api/request-status`, { headers: { "x-request-token": requestBody.customerStatusToken } });
  const adjustedTrackerText = await adjustedTracker.text();
  assert(adjustedTracker.ok && !adjustedTrackerText.includes("CASE-QUALITY-001") && !adjustedTrackerText.includes("additionalRefundAmount") && !adjustedTrackerText.includes("contribution"), "Private customer tracker exposed internal adjustment evidence or job economics.");

  const activityUpdate = await fetch(`${base}/api/admin/activity`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: requestBody.reference, kind: "request", note: "Called customer and confirmed the scope.", nextActionAt: "2026-07-15" })
  });
  assert(activityUpdate.status === 201, "Admin follow-up activity failed.");

  const refreshedAdmin = await fetch(`${base}/api/admin/records`);
  const refreshedBody = await refreshedAdmin.json();
  assert(refreshedBody.records.find((record) => record.id === requestBody.reference)?.status === "completed", "Gated booking and completion statuses were not retained.");
  assert(refreshedBody.records.find((record) => record.id === requestBody.reference)?.activities?.[0]?.note.includes("confirmed the scope"), "Lead activity was not retained.");
  assert(refreshedBody.records.find((record) => record.id === requestBody.reference)?.proposals?.some((proposal) => proposal.id.startsWith("PRO-")), "Draft proposal was not retained on the customer request.");
  assert(refreshedBody.records.find((record) => record.id === requestBody.reference)?.proposals?.some((proposal) => proposal.status === "accepted"), "Proposal status progression was not retained.");
  assert(refreshedBody.records.find((record) => record.id === requestBody.reference)?.proposals?.some((proposal) => proposal.cleanerDecision?.status === "accepted"), "Cleaner opportunity decision was not attached to the proposal.");
  assert(refreshedBody.records.find((record) => record.id === requestBody.reference)?.briefs?.[0]?.status === "reviewed" && refreshedBody.records.find((record) => record.id === requestBody.reference)?.briefs?.[0]?.customerScopeConfirmed === true && refreshedBody.records.find((record) => record.id === requestBody.reference)?.briefs?.[0]?.scopeEstimateHours === 3.5 && refreshedBody.records.find((record) => record.id === requestBody.reference)?.briefs?.[0]?.scopeConfidence === "high" && refreshedBody.records.find((record) => record.id === requestBody.reference)?.briefs?.[0]?.scopeTimeEvidenceConfirmed === true && refreshedBody.records.find((record) => record.id === requestBody.reference)?.briefs?.[0]?.scopeTimeBreakdown?.totalMinutes === 210 && refreshedBody.records.find((record) => record.id === requestBody.reference)?.briefs?.[0]?.priceSensitiveScopeConfirmed === true && refreshedBody.records.find((record) => record.id === requestBody.reference)?.briefs?.[0]?.reviewEvidenceConfirmed === true && refreshedBody.records.find((record) => record.id === requestBody.reference)?.briefs?.[0]?.visualsReviewed === true && refreshedBody.records.find((record) => record.id === requestBody.reference)?.briefs?.[0]?.checklistReviewed === true && refreshedBody.records.find((record) => record.id === requestBody.reference)?.briefs?.[0]?.scopeSignalConfirmations?.[0] === "oven-interior", "Customer scope confirmation, structured room-time review, founder evidence or confirmed price-sensitive scope was not retained.");
  assert(refreshedBody.records.find((record) => record.id === requestBody.reference)?.booking?.id === confirmedBookingBody.booking.id, "Confirmed booking was not attached to the request.");
  assert(refreshedBody.records.find((record) => record.id === requestBody.reference)?.booking?.details?.serviceAddress === "10 Clean Street, Westminster, London" && refreshedBody.records.find((record) => record.id === requestBody.reference)?.booking?.frequency === "Weekly" && refreshedBody.records.find((record) => record.id === requestBody.reference)?.booking?.publicSiteUrl === "https://tideway.example.com" && refreshedBody.records.find((record) => record.id === requestBody.reference)?.booking?.cleanerViewToken === confirmedBookingBody.booking.cleanerViewToken && refreshedBody.records.find((record) => record.id === requestBody.reference)?.booking?.paymentEvidence?.reference === "PAY-TEST-001", "Structured booking pack, requested frequency, frozen public host or private payment evidence was not retained in the control desk.");
  assert(refreshedBody.records.find((record) => record.id === requestBody.reference)?.booking?.changeRequests?.length === 3 && refreshedBody.records.find((record) => record.id === requestBody.reference)?.booking?.changeRequests?.some((change) => change.type === "safety-issue" && change.status === "closed") && refreshedBody.records.find((record) => record.id === requestBody.reference)?.booking?.changeRequests?.some((change) => change.type === "quality-issue" && change.status === "closed"), "Booking change, safety and post-completion quality queues were not retained in the control desk.");
  assert(refreshedBody.records.find((record) => record.id === requestBody.reference)?.booking?.jobEvents?.length === 3 && refreshedBody.records.find((record) => record.id === requestBody.reference)?.booking?.jobProgress?.readyForOutcome === true, "Append-only job progress was not retained in the control desk.");
  assert(refreshedBody.records.find((record) => record.id === requestBody.reference)?.outcome?.contribution === -13 && refreshedBody.records.find((record) => record.id === requestBody.reference)?.outcome?.labourOnCosts === 4.6 && refreshedBody.records.find((record) => record.id === requestBody.reference)?.outcome?.original?.contribution === 33 && refreshedBody.records.find((record) => record.id === requestBody.reference)?.outcome?.settlementEvidence?.customerReceiptReference === "RECEIPT-TEST-001" && refreshedBody.records.find((record) => record.id === requestBody.reference)?.outcome?.settlementEvidence?.cleanerPayoutReference === "PAYOUT-TEST-001" && refreshedBody.records.find((record) => record.id === requestBody.reference)?.outcome?.adjustments?.[0]?.sourceReference === "CASE-QUALITY-001", "Append-only adjusted labour on-cost outcome or private settlement evidence was not attached to the request.");
  assert(refreshedBody.records.find((record) => record.id === requestBody.reference)?.pilotCoverage?.covered === true, "Configured pilot coverage was not attached to the customer request.");
  assert(refreshedBody.records.find((record) => record.id === cleanerBody.reference)?.screening?.complete === true, "Latest cleaner screening was not attached to the application.");
  assert(refreshedBody.records.find((record) => record.id === cleanerBody.reference)?.cleanerAvailability?.length === 3, "Active confirmed availability windows were not attached to the cleaner control-desk record.");
  const withdrawnAdminProposal = refreshedBody.records.find((record) => record.id === overlapRequestBody.reference)?.proposals?.find((proposal) => proposal.id === replacementProposalBody.proposal.id);
  assert(withdrawnAdminProposal?.status === "cancelled" && withdrawnAdminProposal.statusNote === "Test-only withdrawal before a booking was recorded.", "Control desk did not retain the audited pre-booking withdrawal reason.");
  assert(refreshedBody.records.find((record) => record.id === overlapRequestBody.reference)?.dispatchActions?.some((action) => action.code === "rematch" && action.group === "rematching"), "Exhausted and withdrawn offers did not remain visible in the rematching queue.");
  assert(refreshedBody.records.find((record) => record.id === requestBody.reference)?.dispatchActions?.some((action) => action.code === "loss-review" && action.group === "profit"), "A later adjustment that made the job loss-making did not become a founder action.");
  assert(refreshedBody.launchFunnel?.goal?.achieved === false && refreshedBody.launchFunnel.goal.profitableBookings === 0 && refreshedBody.launchFunnel.goal.customerReceipts === 0 && refreshedBody.launchFunnel.goal.contribution === 0 && refreshedBody.launchFunnel?.stages?.find((stage) => stage.key === "completed")?.count === 1 && refreshedBody.launchFunnel?.stages?.find((stage) => stage.key === "profitable")?.count === 0 && refreshedBody.launchFunnel?.bottleneck?.key === "actual-economics", "First-booking funnel stayed falsely profitable after later recorded re-clean/refund costs.");

  let publicThrottle = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`${base}/api/cleaning-requests`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    if (response.status === 429) { publicThrottle = response; break; }
  }
  assert(publicThrottle?.headers.get("retry-after") && publicThrottle.headers.get("cache-control") === "no-store", "Repeated public form abuse was not throttled with a bounded retry response.");
  const spoofedForwardedBypass = await fetch(`${base}/api/cleaning-requests`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.200" }, body: "{}" });
  assert(spoofedForwardedBypass.status === 429, "An untrusted forwarded address bypassed the public submission limit.");

  let privateMutationThrottle = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch(`${base}/api/quote/decision`, { method: "POST", headers: { "content-type": "application/json", "x-quote-token": "invalid-private-token" }, body: JSON.stringify({ decision: "accepted" }) });
    if (response.status === 429) { privateMutationThrottle = response; break; }
  }
  assert(privateMutationThrottle?.headers.get("retry-after"), "Repeated private-token mutation attempts were not throttled.");

  let adminAuthenticationThrottle = null;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const response = await fetch(`${base}/api/admin/records`, { headers: { "x-forwarded-for": "203.0.113.25", "x-admin-key": "wrong-test-key" } });
    if (response.status === 429) { adminAuthenticationThrottle = response; break; }
  }
  assert(adminAuthenticationThrottle?.headers.get("retry-after"), "Repeated remote admin-key guesses were not throttled.");
  const authorisedAfterThrottle = await fetch(`${base}/api/admin/records`, { headers: { "x-forwarded-for": "203.0.113.25", "x-admin-key": "test-admin-key" } });
  const healthAfterThrottle = await fetch(`${base}/api/health`);
  assert(authorisedAfterThrottle.ok && healthAfterThrottle.ok, "Scoped abuse throttling blocked an authorised admin or unrelated health check.");

  const healthyIntegrity = await fetch(`${base}/api/admin/data-integrity`);
  const healthyIntegrityBody = await healthyIntegrity.json();
  assert(healthyIntegrity.ok && healthyIntegrityBody.audit?.healthy === true && healthyIntegrityBody.audit.issueCount === 0 && healthyIntegrityBody.audit.files.length === 21, "The authenticated private-data integrity desk did not verify the complete healthy record set, including append-only customer timing changes.");

  await appendFile(path.join(testDataDir, "job-outcome-adjustments.ndjson"), `${JSON.stringify({ id: "ADJ-FINANCIAL-CORRUPT", bookingId: confirmedBookingBody.booking.id, sourceReference: "CORRUPT-FINANCIAL-TEST", additionalHours: 0, additionalCustomerCollected: 0, additionalCleanerPaid: 0, additionalLabourOnCosts: 0, additionalPaymentFees: 0, additionalTravelCosts: 0, additionalSuppliesCosts: 0, additionalOtherCosts: "1e309", additionalRefundAmount: 0, createdAt: new Date().toISOString() })}\n`, "utf8");
  await appendFile(path.join(testDataDir, "job-outcome-adjustments.ndjson"), `${JSON.stringify({ id: "ADJ-ORPHANED", bookingId: "BKG-NOT-REAL", createdAt: new Date().toISOString() })}\n`, "utf8");
  await appendFile(path.join(testDataDir, "job-brief-status.ndjson"), `${JSON.stringify({ briefId: briefBody.reference, requestId: requestBody.reference, status: "reviewed", visualsReviewed: true, reviewedVisualIds: [briefBody.photos[0].id], visualEvidenceVersion: 1, checklistReviewed: true, updatedAt: new Date().toISOString() })}\n`, "utf8");
  await appendFile(path.join(testDataDir, "request-schedule-updates.ndjson"), `${JSON.stringify({ id: "RSC-CORRUPT1", requestId: requestBody.reference, previousDate: "2026-01-01", previousTimeWindow: "Flexible", preferredDate: "2026-07-22", preferredTimeWindow: "Flexible", reason: "Corrupted disconnected timing history for the integrity test.", source: "customer-private-schedule-change", createdAt: new Date().toISOString() })}\n`, "utf8");
  await appendFile(path.join(testDataDir, "job-events.ndjson"), "{\"id\":\"EVT-INCOMPLETE\"\n", "utf8");
  const corruptConfig = JSON.parse(await readFile(path.join(testDataDir, "business-config.json"), "utf8"));
  corruptConfig.customerHourlyRate = "1e309";
  await writeFile(path.join(testDataDir, "business-config.json"), `${JSON.stringify(corruptConfig, null, 2)}\n`, "utf8");
  const degradedIntegrity = await fetch(`${base}/api/admin/data-integrity`);
  const degradedIntegrityText = await degradedIntegrity.text();
  const degradedIntegrityBody = JSON.parse(degradedIntegrityText);
  assert(degradedIntegrity.ok && degradedIntegrityBody.audit?.healthy === false && degradedIntegrityBody.audit.issueCount >= 6 && degradedIntegrityBody.audit.issues.some((issue) => issue.code === "malformed-record" && issue.file === "job-events.ndjson") && degradedIntegrityBody.audit.issues.some((issue) => issue.code === "orphaned-reference" && issue.reference === "BKG-NOT-REAL") && degradedIntegrityBody.audit.issues.some((issue) => issue.code === "invalid-request-schedule-update" && issue.reference === "RSC-CORRUPT1") && degradedIntegrityBody.audit.issues.some((issue) => issue.code === "invalid-visual-review-evidence" && issue.reference === briefBody.reference) && degradedIntegrityBody.audit.issues.some((issue) => issue.code === "invalid-scope-time-evidence" && issue.reference === briefBody.reference) && degradedIntegrityBody.audit.issues.some((issue) => issue.code === "invalid-financial-record" && issue.file === "job-outcome-adjustments.ndjson" && issue.reference === "ADJ-FINANCIAL-CORRUPT") && degradedIntegrityBody.audit.issues.some((issue) => issue.code === "invalid-financial-config" && issue.file === "business-config.json"), "The non-destructive integrity audit missed malformed JSON, disconnected timing history, a cross-record orphan, visual/time evidence corruption, semantic financial corruption or invalid launch economics.");
  assert(!degradedIntegrityText.includes("customer@example.com") && !degradedIntegrityText.includes("10 Clean Street"), "The integrity report exposed private customer content instead of safe file and reference diagnostics.");

  const blockedConfigWrite = await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: "{}" });
  const blockedConfigWriteBody = await blockedConfigWrite.json();
  const degradedHealth = await fetch(`${base}/api/health`);
  const degradedHealthBody = await degradedHealth.json();
  assert(blockedConfigWrite.status === 503 && blockedConfigWriteBody.error.includes("No changes were written") && degradedHealthBody.dataIntegrity === "degraded" && degradedHealthBody.writesAllowed === false, "Homle did not fail closed before a write after private record corruption.");

  console.log("Smoke tests passed: public pages, evidence-based seven-area launch requirements, evidence-backed HTTPS public-origin gates, unsupported insurance/live-payment claims and invalid verification dates, private first-profitable-booking funnel and bottleneck progression, eight-item live scan readiness, empty/partial/complete readiness states, stale source-to-checklist detection, harmless-whitespace stability, non-destructive checklist comparison, explicit summary application, stale pending-summary rejection, photo/video count and duration safeguards, supported-room safeguards, reviewed-scan matching gates, exact per-visual review evidence, explicit cleaner postcode declarations, captured-but-unconfirmed first cleaner availability, exact/area travel coverage, vague-travel rejection, uncovered-cleaner exclusion, direct out-of-area proposal rejection, booking-audit travel retention, required customer scope-completeness confirmation, stored confirmation timestamps, booking-audit scope confirmation, preferred arrival fit, reviewed-duration capacity, impossible-window rejection, founder-action dispatch priorities, urgent safety escalation, rematching visibility, private request-to-scan handoff, private customer journey tracker from scan through completion, tracker data isolation, automatic concise speech bullets, explicit spoken exclusions, exclusion-safe price-sensitive scope, room-grouped Cleaner handoff, exclusion-only scope blocking, mandatory room labels, per-visual notes, shown-room task coverage, customer-visible price-sensitive scope warnings, supported-signal coverage, false-positive protection, required reviewer confirmations, frozen confirmed extras, explicit selected-cleaner media consent, frozen opportunity media scope, token-authorised non-cacheable opportunity photos/videos, preview/no-consent/readiness/booking media revocation, structured scan-hour estimates, scope-confidence review, scan-to-quote duration floors, protected booked-room media, pilot-area enforcement, cleaner screening, confirmed availability windows, availability withdrawal gates, admin security, abuse throttling, constant-time admin-key checks, retry-safe public intake, founder-confirmed cost assumptions, finite bounded pricing inputs, frozen proposal cost breakdowns, stale-cost rejection, exact job schedules, frozen offer deadlines, recipient-isolated copy-only dispatch packs, stale-decision protection, one-live-offer enforcement, live cleaner-capacity holds, capacity-aware matching, cleaner-decline capacity release, cleaner-decline quote lockout, replacement selection, audited pre-booking withdrawal, overlap prevention, matching, profitable proposals, two-sided private decisions, protected booking packs, non-destructive change/safety requests, schedule-locked append-only job progress, booking confirmations, private settlement evidence, bounded categorised actual completed-job economics and cumulative adjustments, serialized integrity audits, semantic financial, visual-evidence and structural integrity auditing and fail-closed writes.");
} finally {
  if (child.exitCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await exited;
  }
  await rm(testDataDir, { recursive: true, force: true });
}
