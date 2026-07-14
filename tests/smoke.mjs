import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checklistFromTranscript } from "../public/checklist.js";
import { clearBriefHandoff, readBriefHandoff, saveBriefHandoff } from "../public/brief-handoff.js";
import { briefReadiness, briefScopeConfirmationIsCurrent, briefScopeFingerprint } from "../public/brief-readiness.js";
import { detectPriceSensitiveScope, normalisePriceSensitiveScopeSignals } from "../public/scope-signals.js";
import { decisionWasInTime, offerDeadline, offerIsOpen } from "../offer-expiry.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testDataDir = await mkdtemp(path.join(tmpdir(), "tideway-smoke-"));
const port = 4279;
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["server.mjs"], { cwd: root, env: { ...process.env, PORT: String(port), ADMIN_KEY: "test-admin-key", DATA_DIR: testDataDir }, stdio: "pipe" });

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

try {
  await waitForServer();

  const fixedSentAt = "2026-07-14T10:00:00.000Z";
  const fixedVisitStart = Date.parse("2026-07-16T09:00:00.000Z");
  const fixedDeadline = offerDeadline(fixedSentAt, 24, fixedVisitStart);
  assert(fixedDeadline === "2026-07-15T10:00:00.000Z" && offerIsOpen(fixedDeadline, Date.parse("2026-07-15T09:59:59.999Z")) && !offerIsOpen(fixedDeadline, Date.parse(fixedDeadline)), "Offer response window did not close exactly at its frozen deadline.");
  assert(offerDeadline(fixedSentAt, 72, fixedVisitStart) === "2026-07-16T09:00:00.000Z", "Offer deadline was not capped at the proposed visit start.");
  assert(decisionWasInTime("2026-07-15T09:59:59.999Z", fixedDeadline) && !decisionWasInTime(fixedDeadline, fixedDeadline), "Booking audit did not distinguish timely and stale acceptances.");

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

  const detectedScopeCodes = detectPriceSensitiveScope({ transcript: "Clean inside the oven and inside the fridge. Clean inside cupboards, wash the windows, change the bed linen, arrange carpet cleaning, rubbish removal, balcony cleaning and wash the walls." }).map((signal) => signal.code);
  assert(JSON.stringify(detectedScopeCodes) === JSON.stringify(["oven-interior", "fridge-freezer-interior", "inside-storage", "window-cleaning", "linen-laundry", "carpet-upholstery", "waste-removal", "outdoor-area", "walls-ceilings"]), "Customer-facing price-sensitive scope detection omitted or reordered a supported extra.");
  assert(detectPriceSensitiveScope({ transcript: "Wipe the oven door, fridge door and kitchen wall tiles." }).length === 0, "Ordinary surface wiping was incorrectly flagged as a price-sensitive extra.");
  assert(JSON.stringify(normalisePriceSensitiveScopeSignals([{ code: "oven-interior", label: "Tampered label" }, { code: "not-supported", label: "Invented" }])) === JSON.stringify([{ code: "oven-interior", label: "Inside oven cleaning" }]), "Stored scope signals were not constrained to Tideway's supported labels.");

  const emptyScanReadiness = briefReadiness();
  assert(emptyScanReadiness.ready === false && emptyScanReadiness.remaining === 8 && emptyScanReadiness.items.length === 8, "Empty room scan did not expose every required readiness item.");
  const excessivePhotos = Array.from({ length: 7 }, () => ({ area: "Kitchen", note: "Worktops need cleaning" }));
  const excessivePhotoReadiness = briefReadiness({ requestId: "REQ-1234ABCD", email: "customer@example.com", transcript: "Clean the kitchen.", tasks: ["Kitchen: Clean the worktops"], photos: excessivePhotos, scopeCompleteConfirmed: true, consent: true });
  assert(excessivePhotoReadiness.ready === false && excessivePhotoReadiness.checks.roomPhotos === false, "Live readiness showed more than six room photos as ready.");
  const invalidRoomReadiness = briefReadiness({ requestId: "REQ-1234ABCD", email: "customer@example.com", transcript: "Clean the garage.", tasks: ["Garage: Clean the floor"], photos: [{ area: "Garage", note: "Floor needs cleaning" }], scopeCompleteConfirmed: true, consent: true });
  assert(invalidRoomReadiness.ready === false && invalidRoomReadiness.checks.photoDetails === false && invalidRoomReadiness.checks.roomCoverage === false, "Live readiness accepted a room label outside Tideway's supported set.");
  const uncoveredScanReadiness = briefReadiness({ requestId: "REQ-1234ABCD", email: "customer@example.com", transcript: "Clean the kitchen.", tasks: ["Bathroom: Clean the sink"], photos: [{ area: "Kitchen", note: "Worktops need cleaning" }], scopeCompleteConfirmed: true, consent: true });
  assert(uncoveredScanReadiness.ready === false && uncoveredScanReadiness.remaining === 1 && uncoveredScanReadiness.checks.roomCoverage === false && uncoveredScanReadiness.uncoveredAreas[0] === "Kitchen" && uncoveredScanReadiness.items.find((item) => item.key === "roomCoverage")?.label === "Add cleaner task for: Kitchen", "Live readiness missed or failed to name an uncovered photographed room.");
  const multipleUncoveredScanReadiness = briefReadiness({ requestId: "REQ-1234ABCD", email: "customer@example.com", transcript: "Clean the rooms.", tasks: ["Hallway: Vacuum the floor"], photos: [{ area: "Kitchen", note: "Worktops need cleaning" }, { area: "Bathroom", note: "Shower needs cleaning" }], scopeCompleteConfirmed: true, consent: true });
  assert(multipleUncoveredScanReadiness.items.find((item) => item.key === "roomCoverage")?.label === "Add cleaner tasks for: Kitchen, Bathroom", "Live readiness did not name every photographed room still missing cleaner tasks.");
  const numberedRoomReadiness = briefReadiness({ requestId: "REQ-1234ABCD", email: "customer@example.com", transcript: "Clean bedroom one and bedroom two.", tasks: ["Bedroom 1: Change the bed linen", "Bedroom 2: Dust the shelves"], photos: [{ area: "Bedroom 1", note: "Bed needs changing" }, { area: "Bedroom 2", note: "Shelves need dusting" }], scopeCompleteConfirmed: true, consent: true });
  assert(numberedRoomReadiness.ready === true, "Canonical numbered bedroom labels did not satisfy photographed-room coverage.");
  const confirmedScopeFingerprint = briefScopeFingerprint({ transcript: "  Clean   the kitchen. ", tasks: ["Kitchen: Wipe the worktops"], photos: [{ area: "Kitchen", note: " Worktops need cleaning " }] });
  const whitespaceOnlyScopeFingerprint = briefScopeFingerprint({ transcript: "Clean the kitchen.", tasks: ["Kitchen: Wipe the worktops"], photos: [{ area: "Kitchen", note: "Worktops need cleaning" }] });
  const changedScopeFingerprint = briefScopeFingerprint({ transcript: "Clean the kitchen.", tasks: ["Kitchen: Wipe the worktops", "Kitchen: Mop the floor"], photos: [{ area: "Kitchen", note: "Worktops and floor need cleaning" }] });
  assert(confirmedScopeFingerprint === whitespaceOnlyScopeFingerprint && confirmedScopeFingerprint !== changedScopeFingerprint, "Scope confirmation fingerprint did not distinguish a real task/note change from harmless whitespace.");
  assert(briefScopeConfirmationIsCurrent({ checked: true, confirmedFingerprint: confirmedScopeFingerprint, currentFingerprint: whitespaceOnlyScopeFingerprint }) === true && briefScopeConfirmationIsCurrent({ checked: true, confirmedFingerprint: confirmedScopeFingerprint, currentFingerprint: changedScopeFingerprint }) === false && briefScopeConfirmationIsCurrent({ checked: false, confirmedFingerprint: confirmedScopeFingerprint, currentFingerprint: confirmedScopeFingerprint }) === false, "Scope confirmation did not become invalid after a material scope change or manual uncheck.");
  const completeScanReadiness = briefReadiness({ requestId: "REQ-1234ABCD", email: "customer@example.com", transcript: "Clean the kitchen.", tasks: ["Kitchen: Clean the worktops"], photos: [{ area: "Kitchen", note: "Worktops need cleaning" }], scopeCompleteConfirmed: true, consent: true });
  assert(completeScanReadiness.ready === true && completeScanReadiness.remaining === 0 && Object.values(completeScanReadiness.checks).every(Boolean), "Complete room scan did not reach its client-side ready state.");

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
  assert(home.ok && (await home.text()).includes("Book a clean with every room clearly scoped"), "Homepage failed.");
  assert(home.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"), "Security headers were missing.");
  assert(home.headers.get("content-security-policy")?.includes("img-src 'self' data: blob:"), "Secure local photo previews were blocked by the content policy.");

  const privacy = await fetch(`${base}/privacy`);
  assert(privacy.ok && (await privacy.text()).includes("Privacy notice"), "Privacy page failed.");

  const terms = await fetch(`${base}/terms`);
  assert(terms.ok && (await terms.text()).includes("Pilot terms"), "Terms page failed.");

  const adminPage = await fetch(`${base}/admin`);
  const adminPageText = await adminPage.text();
  assert(adminPage.ok && adminPageText.includes("Lead control desk") && adminPageText.includes("Founder-action queue") && adminPageText.includes('id="action-filter"'), "Admin dispatch control page failed.");
  const briefPage = await fetch(`${base}/brief`);
  const briefPageText = await briefPage.text();
  assert(briefPage.ok && briefPageText.includes("Request details carried over.") && briefPageText.includes("Checking room scan") && briefPageText.includes("Extra time may be needed") && briefPageText.includes("require this confirmation again"), "Photo job-brief page, live readiness panel, private handoff notice, customer-facing scope warning or change-sensitive scope confirmation failed.");
  assert(briefPage.headers.get("permissions-policy")?.includes("microphone=(self)"), "Job-brief page did not allow its requested microphone feature.");
  const scopeSignalAsset = await fetch(`${base}/scope-signals.js`);
  assert(scopeSignalAsset.ok && (await scopeSignalAsset.text()).includes("detectPriceSensitiveScope"), "Shared customer/server scope detection asset failed.");
  const briefReadinessAsset = await fetch(`${base}/brief-readiness.js`);
  assert(briefReadinessAsset.ok && (await briefReadinessAsset.text()).includes("briefReadiness"), "Shared room-scan readiness asset failed.");
  const requestStatusPage = await fetch(`${base}/request-status`);
  assert(requestStatusPage.ok && (await requestStatusPage.text()).includes("Private request tracker"), "Private customer request tracker page failed.");
  const quotePage = await fetch(`${base}/quote`);
  assert(quotePage.ok && (await quotePage.text()).includes("Private customer review"), "Private customer quote page failed.");
  const opportunityPage = await fetch(`${base}/opportunity`);
  assert(opportunityPage.ok && (await opportunityPage.text()).includes("Private cleaner review"), "Private cleaner opportunity page failed.");
  const customerBookingPage = await fetch(`${base}/booking-confirmation`);
  const cleanerAssignmentPage = await fetch(`${base}/assignment`);
  assert(customerBookingPage.ok && cleanerAssignmentPage.ok && (await customerBookingPage.text()).includes("Protected visit details") && (await cleanerAssignmentPage.text()).includes("Protected visit details"), "Private confirmed-booking pages failed.");
  const adminAsset = await fetch(`${base}/admin.js?v=smoke-test`);
  assert(adminAsset.ok && adminAsset.headers.get("cache-control") === "no-cache", "Updated assets could remain stale in the control desk.");

  const invalidPhone = await fetch(`${base}/api/cleaning-requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contactName: "Test Customer", email: "customer@example.com", phone: "123", postcode: "SW1A 1AA", customerType: "Landlord", propertyType: "Flat or house", service: "Rental turnover clean", siteSize: "2 bedrooms and 1 bathroom", accessNotes: "Collect keys from the office", hazards: "None known", consent: true })
  });
  assert(invalidPhone.status === 422, "Invalid phone number was not rejected.");
  const invalidArrivalWindow = await fetch(`${base}/api/cleaning-requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contactName: "Test Customer", email: "customer@example.com", phone: "07123456789", postcode: "SW1A 1AA", customerType: "Landlord", propertyType: "Flat or house", service: "Rental turnover clean", siteSize: "2 bedrooms and 1 bathroom", accessNotes: "Collect keys from the office", hazards: "None known", preferredTimeWindow: "Before sunrise", consent: true })
  });
  assert(invalidArrivalWindow.status === 422, "Unsupported customer arrival preference was accepted.");

  const invalid = await fetch(`${base}/api/cleaning-requests`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert(invalid.status === 422, "Invalid cleaning request was not rejected.");

  const oversized = await fetch(`${base}/api/cleaning-requests`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ details: "x".repeat(70 * 1024) }) });
  assert(oversized.status === 413, "Oversized request body was not rejected.");

  const validRequest = await fetch(`${base}/api/cleaning-requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contactName: "Test Customer", email: "customer@example.com", phone: "07123456789", postcode: "SW1A 1AA", customerType: "Landlord", propertyType: "Flat or house", service: "Rental turnover clean", siteSize: "2 bedrooms and 1 bathroom", accessNotes: "Collect keys from the office", hazards: "None known", preferredDate: "2026-07-20", preferredTimeWindow: "Morning (8am–12pm)", consent: true })
  });
  const requestBody = await validRequest.json();
  assert(validRequest.status === 201 && requestBody.reference.startsWith("REQ-") && /^[A-Za-z0-9_-]{32}$/.test(requestBody.customerStatusToken), "Valid cleaning request failed or omitted its private tracker token.");
  const invalidRequestStatus = await fetch(`${base}/api/request-status`, { headers: { "x-request-token": "not-a-private-request-token" } });
  assert(invalidRequestStatus.status === 404, "Invalid customer tracker token exposed request status.");
  const initialRequestStatus = await fetch(`${base}/api/request-status`, { headers: { "x-request-token": requestBody.customerStatusToken } });
  const initialRequestStatusBody = await initialRequestStatus.json();
  assert(initialRequestStatus.ok && initialRequestStatusBody.current.stage === "room-scan" && initialRequestStatusBody.links.roomScanRequired === true && initialRequestStatusBody.request.reference === requestBody.reference, "New request tracker did not open at the required room-scan stage.");
  const initialTrackerSerialised = JSON.stringify(initialRequestStatusBody);
  assert(!initialTrackerSerialised.includes("customer@example.com") && !initialTrackerSerialised.includes("07123456789") && !initialTrackerSerialised.includes("Collect keys") && !initialTrackerSerialised.includes("customerStatusToken"), "Customer tracker exposed contact, access or authorisation-token data.");

  const unmatchedBrief = await fetch(`${base}/api/job-briefs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: requestBody.reference, email: "wrong@example.com", transcript: "Clean the kitchen worktops.", checklist: ["Kitchen: Clean the kitchen worktops"], photos: [{ area: "Kitchen", note: "Worktops need wiping", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zs7sAAAAASUVORK5CYII=" }], scopeCompleteConfirmed: true, consent: true })
  });
  assert(unmatchedBrief.status === 404, "A job brief attached without matching the request email.");

  const invalidPhotoBrief = await fetch(`${base}/api/job-briefs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: requestBody.reference, email: "customer@example.com", transcript: "Clean the kitchen worktops.", checklist: ["Kitchen: Clean the kitchen worktops"], photos: [{ area: "Kitchen", note: "Worktops need wiping", dataUrl: "data:image/png;base64,SGVsbG8=" }], scopeCompleteConfirmed: true, consent: true })
  });
  assert(invalidPhotoBrief.status === 422, "Invalid image content was accepted as a property photo.");

  const missingRoomNote = await fetch(`${base}/api/job-briefs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: requestBody.reference, email: "customer@example.com", transcript: "Clean the kitchen worktops.", checklist: ["Kitchen: Clean the kitchen worktops"], photos: [{ area: "Kitchen", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zs7sAAAAASUVORK5CYII=" }], scopeCompleteConfirmed: true, consent: true }) });
  assert(missingRoomNote.status === 422, "Room scan accepted a photo without its specific room note.");
  const uncoveredRoom = await fetch(`${base}/api/job-briefs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: requestBody.reference, email: "customer@example.com", transcript: "Clean the kitchen worktops.", checklist: ["Clean the kitchen worktops"], photos: [{ area: "Kitchen", note: "Worktops need wiping", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zs7sAAAAASUVORK5CYII=" }], scopeCompleteConfirmed: true, consent: true }) });
  assert(uncoveredRoom.status === 422, "Room scan accepted a photographed room with no room-labelled cleaner task.");

  const unconfirmedScopeBrief = await fetch(`${base}/api/job-briefs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: requestBody.reference, email: "customer@example.com", transcript: "Clean the kitchen worktops.", checklist: ["Kitchen: Clean the kitchen worktops"], photos: [{ area: "Kitchen", note: "Worktops need wiping", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zs7sAAAAASUVORK5CYII=" }], consent: true }) });
  const unconfirmedScopeBriefBody = await unconfirmedScopeBrief.json();
  assert(unconfirmedScopeBrief.status === 422 && unconfirmedScopeBriefBody.errors?.some((error) => error.includes("concise cleaner checklist")), "Room scan was accepted without the customer's final concise-scope confirmation.");

  const validBrief = await fetch(`${base}/api/job-briefs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: requestBody.reference, email: "customer@example.com", transcript: "Please wipe every kitchen worktop, mop the kitchen floor and clean inside the oven.", checklist: ["Kitchen: Wipe every kitchen worktop", "Kitchen: Mop the kitchen floor", "Kitchen: Clean inside the oven"], photos: [{ area: "Kitchen", note: "Worktops, floor and inside oven need attention", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zs7sAAAAASUVORK5CYII=" }], scopeCompleteConfirmed: true, consent: true, sharePhotosWithSelectedCleaner: true })
  });
  const briefBody = await validBrief.json();
  assert(validBrief.status === 201 && briefBody.reference.startsWith("BRF-") && briefBody.checklist.length === 3 && briefBody.scopeSignals?.length === 1 && briefBody.scopeSignals[0].code === "oven-interior" && briefBody.customerScopeConfirmed === true && Date.parse(briefBody.customerScopeConfirmedAt) > 0 && briefBody.customerStatusToken === requestBody.customerStatusToken && briefBody.cleanerPhotoSharingConsent === true, "Valid photo job brief failed, omitted checklist bullets, failed to record customer scope confirmation or price-sensitive oven scope, lost the private tracker handoff or failed to record selected-cleaner photo permission.");
  const scanReviewStatus = await fetch(`${base}/api/request-status`, { headers: { "x-request-token": requestBody.customerStatusToken } });
  const scanReviewStatusBody = await scanReviewStatus.json();
  assert(scanReviewStatus.ok && scanReviewStatusBody.current.stage === "scan-review" && scanReviewStatusBody.roomScan.reference === briefBody.reference && scanReviewStatusBody.roomScan.taskCount === 3 && scanReviewStatusBody.links.roomScanRequired === false, "Customer tracker did not show the submitted room scan awaiting review without requesting a duplicate scan.");

  const privateBriefImage = await fetch(`${base}/api/admin/job-brief-image?briefId=${briefBody.reference}&imageId=${briefBody.photos[0].id}`);
  assert(privateBriefImage.ok && privateBriefImage.headers.get("content-type") === "image/png" && (await privateBriefImage.arrayBuffer()).byteLength > 0, "Private job-brief photo could not be retrieved by the local control desk.");
  const proxiedBriefImage = await fetch(`${base}/api/admin/job-brief-image?briefId=${briefBody.reference}&imageId=${briefBody.photos[0].id}`, { headers: { "x-forwarded-for": "203.0.113.10" } });
  assert(proxiedBriefImage.status === 401, "Private job-brief photo bypassed admin authentication.");

  const validCleaner = await fetch(`${base}/api/cleaner-applications`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fullName: "Test Cleaner", email: "cleaner@example.com", phone: "07123456789", postcode: "SE1 7PB", travelAreas: "SW1A and South London", experience: "1–3 years", availability: "Weekdays", serviceTurnovers: true, rightToWork: true, consent: true })
  });
  const cleanerBody = await validCleaner.json();
  assert(validCleaner.status === 201 && cleanerBody.reference.startsWith("CLN-"), "Valid cleaner application failed.");

  const adminRecords = await fetch(`${base}/api/admin/records`);
  const adminBody = await adminRecords.json();
  assert(adminRecords.ok && adminBody.records.length === 2, "Admin records did not load.");
  assert(adminBody.records.find((record) => record.id === requestBody.reference)?.briefs?.length === 1 && adminBody.records.find((record) => record.id === requestBody.reference)?.briefs?.[0]?.id === briefBody.reference && adminBody.records.find((record) => record.id === requestBody.reference)?.briefs?.[0]?.customerScopeConfirmed === true && Date.parse(adminBody.records.find((record) => record.id === requestBody.reference)?.briefs?.[0]?.customerScopeConfirmedAt) > 0, "Photo job brief or its customer scope confirmation was not attached to the request, or an unconfirmed attempt was stored.");
  assert(adminBody.records.find((record) => record.id === requestBody.reference)?.briefs?.[0]?.status === "landlord-draft", "New photo job brief did not enter the human review queue.");
  assert(adminBody.records.find((record) => record.id === requestBody.reference)?.dispatchActions?.some((action) => action.code === "review-scan" && action.severity === "high"), "Submitted room scan was missing from the founder-action queue.");
  assert(adminBody.records.find((record) => record.id === cleanerBody.reference)?.dispatchActions?.some((action) => action.code === "review-cleaner" && action.severity === "high"), "New cleaner application was missing from the founder-action queue.");
  assert(adminBody.dispatchSummary.high >= 2 && adminBody.dispatchSummary.urgent === 0, "Dispatch summary did not prioritise initial scan and supply review correctly.");
  assert(!JSON.stringify(adminBody.records.flatMap((record) => record.dispatchActions || [])).includes("customer@example.com"), "Dispatch actions leaked customer contact data into operational labels.");

  const proxiedAdmin = await fetch(`${base}/api/admin/records`, { headers: { "x-forwarded-for": "203.0.113.10" } });
  assert(proxiedAdmin.status === 401, "Proxied admin request bypassed authentication.");

  const authorisedProxiedAdmin = await fetch(`${base}/api/admin/records`, { headers: { "x-forwarded-for": "203.0.113.10", "x-admin-key": "test-admin-key" } });
  assert(authorisedProxiedAdmin.ok, "Admin key did not authorise proxied request.");

  const initialConfig = await fetch(`${base}/api/admin/config`);
  const initialConfigBody = await initialConfig.json();
  assert(initialConfig.ok && initialConfigBody.readiness.completed === 0, "Initial launch readiness was incorrect.");

  const completeConfig = { legalOwnerName: "Test Owner", businessStructure: "Sole trader", legalBusinessName: "Test Tideway", tradingAddress: "1 Test Street, London", supportEmail: "support@example.com", supportPhone: "07123456789", pilotPostcodes: "SW1A, SW2, SW4", cleanerModel: "Worker", insuranceStatus: "active", paymentProviderName: "TestPay", paymentProviderStatus: "live", refundProcess: "Owner approves and records refunds within five working days.", customerHourlyRate: 30, cleanerHourlyPay: 18, minimumHours: 2, minimumContributionMarginPercent: 25, paymentFeePercent: 1, paymentFeeFixed: 0, travelCostPerJob: 1, suppliesCostPerJob: 1, riskContingencyPercent: 1, variableCostsConfirmed: true, cancellationPolicy: "24 hours notice.", paymentTiming: "Payment authorised at booking and captured after completion", customerQuoteValidityHours: 24, cleanerOpportunityValidityHours: 12 };
  const savedConfig = await fetch(`${base}/api/admin/config`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(completeConfig)
  });
  const savedConfigBody = await savedConfig.json();
  assert(savedConfig.ok && savedConfigBody.readiness.ready === true, "Complete launch settings did not pass readiness checks.");
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
  const impossibleCostStack = await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, minimumContributionMarginPercent: 80, paymentFeePercent: 19, riskContingencyPercent: 1 }) });
  assert(impossibleCostStack.status === 422, "A margin and percentage-cost stack with no viable price was accepted.");
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
  await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(completeConfig) });

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
  const cleanerApproval = await fetch(`${base}/api/admin/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: cleanerBody.reference, kind: "cleaner", status: "approved" })
  });
  assert(cleanerApproval.ok, "Cleaner approval status failed.");

  const noAvailabilityMatches = await fetch(`${base}/api/admin/matches?requestId=${requestBody.reference}`);
  const noAvailabilityMatchesBody = await noAvailabilityMatches.json();
  assert(noAvailabilityMatches.ok && noAvailabilityMatchesBody.matches.length === 0, "Matching returned a cleaner without a structured confirmed availability window.");
  const noAvailabilityProposal = await fetch(`${base}/api/admin/proposals`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: requestBody.reference, cleanerId: cleanerBody.reference, proposedDate: "2026-07-20", proposedStartTime: "09:00", estimatedHours: 4, customerRate: 30, cleanerRate: 18, otherCosts: 10 }) });
  assert(noAvailabilityProposal.status === 422, "A proposal was created without confirmed cleaner availability.");
  const unverifiedAvailability = await fetch(`${base}/api/admin/cleaner-availability`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cleanerId: cleanerBody.reference, availableDate: "2026-07-20", startTime: "08:00", endTime: "15:00", confirmationNote: "short" }) });
  assert(unverifiedAvailability.status === 422, "Cleaner availability was recorded without a meaningful confirmation note.");
  const availabilityWindows = [
    { availableDate: "2026-07-20", startTime: "08:00", endTime: "15:00" },
    { availableDate: "2026-07-22", startTime: "08:00", endTime: "13:00" },
    { availableDate: "2026-07-23", startTime: "08:00", endTime: "13:00" }
  ];
  let activeSlot20Id = "";
  for (const window of availabilityWindows) {
    const savedWindow = await fetch(`${base}/api/admin/cleaner-availability`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cleanerId: cleanerBody.reference, ...window, confirmationNote: "Test-only cleaner confirmation recorded for this exact window." }) });
    const savedWindowBody = await savedWindow.json();
    assert(savedWindow.status === 201 && savedWindowBody.slot.status === "active", `Confirmed availability window ${window.availableDate} was not saved.`);
    if (window.availableDate === "2026-07-20") activeSlot20Id = savedWindowBody.slot.id;
  }
  const overlappingAvailability = await fetch(`${base}/api/admin/cleaner-availability`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cleanerId: cleanerBody.reference, availableDate: "2026-07-20", startTime: "10:00", endTime: "16:00", confirmationNote: "Test-only overlapping availability confirmation window." }) });
  assert(overlappingAvailability.status === 409, "Overlapping confirmed availability windows were accepted.");
  const outsideAvailabilityProposal = await fetch(`${base}/api/admin/proposals`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: requestBody.reference, cleanerId: cleanerBody.reference, proposedDate: "2026-07-20", proposedStartTime: "14:00", estimatedHours: 2, customerRate: 30, cleanerRate: 18, otherCosts: 0 }) });
  assert(outsideAvailabilityProposal.status === 422, "A proposal extended beyond the cleaner's confirmed availability window.");

  const unscannedRequest = await fetch(`${base}/api/cleaning-requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contactName: "No Scan Customer", email: "noscan@example.com", phone: "07123456788", postcode: "SW1A 2AA", customerType: "Homeowner or tenant", propertyType: "Flat or house", service: "Rental turnover clean", siteSize: "1 bedroom and 1 bathroom", accessNotes: "Meet at the property", hazards: "None known", consent: true })
  });
  const unscannedRequestBody = await unscannedRequest.json();
  assert(unscannedRequest.status === 201, "Customer request without a room scan could not be created as step one.");
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

  const missingTimeProposal = await fetch(`${base}/api/admin/proposals`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: requestBody.reference, cleanerId: cleanerBody.reference, proposedDate: "2026-07-20", estimatedHours: 4, customerRate: 30, cleanerRate: 18, otherCosts: 0 }) });
  assert(missingTimeProposal.status === 422, "Proposal without an exact start time was accepted.");
  const overnightProposal = await fetch(`${base}/api/admin/proposals`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: requestBody.reference, cleanerId: cleanerBody.reference, proposedDate: "2026-07-20", proposedStartTime: "23:00", estimatedHours: 4, customerRate: 30, cleanerRate: 18, otherCosts: 0 }) });
  assert(overnightProposal.status === 422, "Proposal extending beyond the service date was accepted.");

  const validProposal = await fetch(`${base}/api/admin/proposals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: requestBody.reference, cleanerId: cleanerBody.reference, proposedDate: "2026-07-20", proposedStartTime: "09:00", estimatedHours: 4, customerRate: 30, cleanerRate: 18, otherCosts: 10, note: "Draft only" })
  });
  const proposalBody = await validProposal.json();
  assert(validProposal.status === 201 && proposalBody.proposal.contribution === 33.6 && proposalBody.proposal.paymentFees === 1.2 && proposalBody.proposal.riskContingency === 1.2 && proposalBody.proposal.nonCleanerCosts === 14.4 && proposalBody.proposal.proposedEndTime === "13:00" && /^[A-Za-z0-9_-]{32}$/.test(proposalBody.proposal.reviewToken) && /^[A-Za-z0-9_-]{32}$/.test(proposalBody.proposal.cleanerReviewToken), "Valid draft proposal failed, omitted its full cost breakdown, calculated incorrectly, omitted its schedule or omitted a private review token.");

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
  assert(outOfAreaDrafts.ok && outOfAreaDraftsBody.sendAllowed === false && outOfAreaDraftsBody.warnings.some((warning) => warning.includes("outside the configured Tideway pilot area")), "Out-of-area proposal drafts were not clearly blocked.");
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
  assert(reviewWithoutEstimate.status === 422, "Room scan was approved without a reviewed cleaning-time estimate.");
  const lowConfidenceReview = await fetch(`${base}/api/admin/job-briefs/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ briefId: briefBody.reference, status: "reviewed", note: "The scan is too unclear to quote safely.", scopeEstimateHours: 3.5, scopeConfidence: "low" }) });
  assert(lowConfidenceReview.status === 422, "Low-confidence room scan was approved instead of requiring revision.");
  const unconfirmedExtraReview = await fetch(`${base}/api/admin/job-briefs/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ briefId: briefBody.reference, status: "reviewed", note: "Time reviewed without confirming the detected oven interior.", scopeEstimateHours: 3.5, scopeConfidence: "high" }) });
  const unconfirmedExtraReviewBody = await unconfirmedExtraReview.json();
  assert(unconfirmedExtraReview.status === 422 && unconfirmedExtraReviewBody.error.includes("Inside oven cleaning"), "Price-sensitive scan scope was approved without explicit confirmation inside the reviewed hours.");
  const reviewedBrief = await fetch(`${base}/api/admin/job-briefs/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ briefId: briefBody.reference, status: "reviewed", note: "Checklist and private photo support a three-and-a-half-hour scope floor, including the oven interior.", scopeEstimateHours: 3.5, scopeConfidence: "high", scopeSignalConfirmations: ["oven-interior"] })
  });
  const reviewedBriefBody = await reviewedBrief.json();
  assert(reviewedBrief.ok && reviewedBriefBody.status === "reviewed" && reviewedBriefBody.scopeEstimateHours === 3.5 && reviewedBriefBody.scopeConfidence === "high" && reviewedBriefBody.scopeSignals?.[0]?.code === "oven-interior" && reviewedBriefBody.scopeSignalConfirmations?.[0] === "oven-interior", "Structured human scan approval or price-sensitive scope confirmation was not recorded.");
  const schedulableMatching = await fetch(`${base}/api/admin/matches?requestId=${requestBody.reference}`);
  const schedulableMatchingBody = await schedulableMatching.json();
  const schedulableSlot = schedulableMatchingBody.matches?.[0]?.availabilitySlots?.[0];
  assert(schedulableMatching.ok && schedulableMatchingBody.matchGate.ready === true && schedulableMatchingBody.matchGate.requiredHours === 3.5 && schedulableMatchingBody.matchGate.confirmedExtras?.[0] === "Inside oven cleaning" && schedulableMatchingBody.matches.length === 1, "Reviewed room scan and its confirmed price-sensitive scope did not open schedulable matching.");
  assert(schedulableMatchingBody.matches[0].score === 100 && schedulableMatchingBody.matches[0].coverage === "Postcode listed" && schedulableMatchingBody.matches[0].availabilitySlots.length === 1 && schedulableSlot.availableDate === "2026-07-20" && schedulableSlot.suggestedStartTime === "08:00" && schedulableSlot.suggestedEndTime === "11:30" && schedulableSlot.arrivalWindowFit === true, "Match did not fit the preferred date, morning arrival and reviewed duration inside confirmed availability.");
  const eveningRequest = await fetch(`${base}/api/cleaning-requests`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contactName: "Evening Customer", email: "evening@example.com", phone: "07123456777", postcode: "SW1A 2AA", customerType: "Landlord", propertyType: "Flat or house", service: "Rental turnover clean", siteSize: "1 bedroom and 1 bathroom", accessNotes: "Test access only", hazards: "None known", preferredDate: "2026-07-22", preferredTimeWindow: "Evening (5pm–8pm)", consent: true }) });
  const eveningRequestBody = await eveningRequest.json();
  const eveningBrief = await fetch(`${base}/api/job-briefs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: eveningRequestBody.reference, email: "evening@example.com", transcript: "In the kitchen wipe the worktops and mop the floor.", photos: [{ area: "Kitchen", note: "Worktops and floor need cleaning", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zs7sAAAAASUVORK5CYII=" }], scopeCompleteConfirmed: true, consent: true }) });
  const eveningBriefBody = await eveningBrief.json();
  const reviewedEveningBrief = await fetch(`${base}/api/admin/job-briefs/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ briefId: eveningBriefBody.reference, status: "reviewed", note: "Test-only two-hour evening scope estimate.", scopeEstimateHours: 2, scopeConfidence: "medium" }) });
  assert(eveningRequest.status === 201 && eveningBrief.status === 201 && reviewedEveningBrief.ok, "Evening scheduling test request could not reach reviewed scope.");
  const noEveningMatch = await fetch(`${base}/api/admin/matches?requestId=${eveningRequestBody.reference}`);
  const noEveningMatchBody = await noEveningMatch.json();
  assert(noEveningMatch.ok && noEveningMatchBody.matchGate.ready === true && noEveningMatchBody.matchGate.reason === "no-schedulable-window" && noEveningMatchBody.matchGate.requiredHours === 2 && noEveningMatchBody.matches.length === 0, "Morning-only cleaner availability was incorrectly suggested for an evening arrival request.");
  const reviewedTracker = await fetch(`${base}/api/request-status`, { headers: { "x-request-token": requestBody.customerStatusToken } });
  const reviewedTrackerBody = await reviewedTracker.json();
  assert(reviewedTracker.ok && reviewedTrackerBody.current.stage === "quote-preparation" && reviewedTrackerBody.roomScan.status === "reviewed" && reviewedTrackerBody.roomScan.reviewedHours === 3.5 && reviewedTrackerBody.roomScan.confirmedExtras?.[0] === "Inside oven cleaning" && reviewedTrackerBody.steps.find((step) => step.key === "scan")?.state === "complete", "Customer tracker did not reflect the reviewed scan, confirmed extra and quote-preparation stage.");
  const reversedBriefReview = await fetch(`${base}/api/admin/job-briefs/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ briefId: briefBody.reference, status: "needs-revision", note: "Late change" }) });
  assert(reversedBriefReview.status === 422, "Reviewed brief history was overwritten instead of requiring a new submission.");
  const underScopedProposal = await fetch(`${base}/api/admin/proposals`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: requestBody.reference, cleanerId: cleanerBody.reference, proposedDate: "2026-07-23", proposedStartTime: "09:00", estimatedHours: 3, customerRate: 30, cleanerRate: 18, otherCosts: 5 }) });
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
  const quotePreview = await fetch(`${base}/api/quote`, { headers: { "x-quote-token": proposalBody.proposal.reviewToken } });
  const quotePreviewBody = await quotePreview.json();
  assert(quotePreview.ok && quotePreviewBody.quote.reference === proposalBody.proposal.id && quotePreviewBody.quote.proposedStartTime === "09:00" && quotePreviewBody.quote.proposedEndTime === "13:00" && quotePreviewBody.quote.decisionAllowed === false && quotePreviewBody.quote.checklist.includes("Kitchen: Clean inside the oven") && quotePreviewBody.quote.confirmedExtras?.[0]?.code === "oven-interior", "Private customer quote preview omitted the approved scope, confirmed extra or schedule, or opened decisions too early.");
  const opportunityPreview = await fetch(`${base}/api/opportunity`, { headers: { "x-opportunity-token": proposalBody.proposal.cleanerReviewToken } });
  const opportunityPreviewBody = await opportunityPreview.json();
  assert(opportunityPreview.ok && opportunityPreviewBody.opportunity.reference === proposalBody.proposal.id && opportunityPreviewBody.opportunity.proposedStartTime === "09:00" && opportunityPreviewBody.opportunity.proposedEndTime === "13:00" && opportunityPreviewBody.opportunity.decisionAllowed === false && opportunityPreviewBody.opportunity.cleanerPay === 72 && opportunityPreviewBody.opportunity.checklist.includes("Kitchen: Clean inside the oven") && opportunityPreviewBody.opportunity.confirmedExtras?.[0]?.code === "oven-interior" && opportunityPreviewBody.opportunity.photoSharingConsent === true && opportunityPreviewBody.opportunity.photoAccessAllowed === false && opportunityPreviewBody.opportunity.roomPhotos.length === 0, "Private cleaner opportunity preview omitted the reviewed scope, confirmed extra, schedule or pay, opened decisions too early or exposed photos before sending.");
  const previewSerialised = JSON.stringify(opportunityPreviewBody);
  assert(!previewSerialised.includes("customer@example.com") && !previewSerialised.includes("Test Customer") && !previewSerialised.includes("Collect keys"), "Cleaner opportunity preview leaked customer identity or access details.");
  const previewOpportunityPhoto = await fetch(`${base}/api/opportunity-photo?imageId=${briefBody.photos[0].id}`, { headers: { "x-opportunity-token": proposalBody.proposal.cleanerReviewToken } });
  assert(previewOpportunityPhoto.status === 404, "Room photo opened before the cleaner opportunity was sent.");
  const skippedTransition = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: proposalBody.proposal.id, status: "accepted" }) });
  assert(skippedTransition.status === 422, "Proposal status skipped the sent step.");
  const pausedCleaner = await fetch(`${base}/api/admin/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: cleanerBody.reference, kind: "cleaner", status: "paused" }) });
  assert(pausedCleaner.ok, "Approved cleaner could not be paused for proposal revalidation test.");
  const pausedCleanerSend = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: proposalBody.proposal.id, status: "sent" }) });
  assert(pausedCleanerSend.status === 422, "Proposal was sent after the selected cleaner was paused.");
  const restoredCleaner = await fetch(`${base}/api/admin/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: cleanerBody.reference, kind: "cleaner", status: "approved" }) });
  assert(restoredCleaner.ok, "Paused cleaner could not return to approved status after revalidation test.");
  const sentAtLowerBound = Date.now();
  const sentProposal = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: proposalBody.proposal.id, status: "sent" }) });
  assert(sentProposal.ok, "Sent proposal status failed.");
  const quoteReadyTracker = await fetch(`${base}/api/request-status`, { headers: { "x-request-token": requestBody.customerStatusToken } });
  const quoteReadyTrackerBody = await quoteReadyTracker.json();
  assert(quoteReadyTracker.ok && quoteReadyTrackerBody.current.stage === "quote-review" && quoteReadyTrackerBody.links.quoteToken === proposalBody.proposal.reviewToken && !JSON.stringify(quoteReadyTrackerBody).includes(cleanerBody.reference) && !JSON.stringify(quoteReadyTrackerBody).includes("cleaner@example.com"), "Customer tracker did not expose the ready quote safely or leaked cleaner details.");
  const sentQuote = await fetch(`${base}/api/quote`, { headers: { "x-quote-token": proposalBody.proposal.reviewToken } });
  const sentQuoteBody = await sentQuote.json();
  const sentOpportunity = await fetch(`${base}/api/opportunity`, { headers: { "x-opportunity-token": proposalBody.proposal.cleanerReviewToken } });
  const sentOpportunityBody = await sentOpportunity.json();
  assert(sentQuote.ok && sentQuoteBody.quote.decisionAllowed === true && Date.parse(sentQuoteBody.quote.offerExpiresAt) >= sentAtLowerBound + 24 * 60 * 60 * 1000 - 2000 && sentQuoteBody.quote.expired === false && sentQuoteBody.quote.confirmedExtras?.[0]?.label === "Inside oven cleaning", "Sent customer quote did not expose its frozen response deadline and confirmed extra.");
  assert(sentOpportunity.ok && sentOpportunityBody.opportunity.decisionAllowed === true && Date.parse(sentOpportunityBody.opportunity.offerExpiresAt) >= sentAtLowerBound + 12 * 60 * 60 * 1000 - 2000 && sentOpportunityBody.opportunity.expired === false && sentOpportunityBody.opportunity.confirmedExtras?.[0]?.label === "Inside oven cleaning" && sentOpportunityBody.opportunity.photoAccessAllowed === true && sentOpportunityBody.opportunity.roomPhotos?.[0]?.note === "Worktops, floor and inside oven need attention" && !JSON.stringify(sentOpportunityBody).includes("storedPath"), "Sent cleaner opportunity did not expose its frozen deadline, confirmed extra and authorised visual scope safely.");
  const protectedOpportunityPhoto = await fetch(`${base}/api/opportunity-photo?imageId=${briefBody.photos[0].id}`, { headers: { "x-opportunity-token": proposalBody.proposal.cleanerReviewToken } });
  assert(protectedOpportunityPhoto.ok && protectedOpportunityPhoto.headers.get("content-type") === "image/png" && protectedOpportunityPhoto.headers.get("cache-control") === "private, no-store" && (await protectedOpportunityPhoto.arrayBuffer()).byteLength > 0, "Selected cleaner could not load the customer-authorised private room photo.");
  const unprotectedOpportunityPhoto = await fetch(`${base}/api/opportunity-photo?imageId=${briefBody.photos[0].id}`);
  assert(unprotectedOpportunityPhoto.status === 404, "Room photo was exposed without the selected cleaner's private opportunity token.");
  await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, cancellationPolicy: "A later rule that must not rewrite an already-sent quote.", cleanerModel: "A later model that must not rewrite a sent opportunity." }) });
  const frozenQuote = await fetch(`${base}/api/quote`, { headers: { "x-quote-token": proposalBody.proposal.reviewToken } });
  const frozenQuoteBody = await frozenQuote.json();
  assert(frozenQuote.ok && frozenQuoteBody.quote.cancellationPolicy === completeConfig.cancellationPolicy && frozenQuoteBody.quote.offerExpiresAt === sentQuoteBody.quote.offerExpiresAt && frozenQuoteBody.quote.confirmedExtras?.[0]?.code === "oven-interior", "An already-sent quote changed or lost its confirmed extra when operating settings were edited.");
  const frozenOpportunity = await fetch(`${base}/api/opportunity`, { headers: { "x-opportunity-token": proposalBody.proposal.cleanerReviewToken } });
  const frozenOpportunityBody = await frozenOpportunity.json();
  assert(frozenOpportunity.ok && frozenOpportunityBody.opportunity.cleanerModel === completeConfig.cleanerModel && frozenOpportunityBody.opportunity.offerExpiresAt === sentOpportunityBody.opportunity.offerExpiresAt && frozenOpportunityBody.opportunity.confirmedExtras?.[0]?.code === "oven-interior" && frozenOpportunityBody.opportunity.decisionAllowed === true, "An already-sent cleaner opportunity changed, lost its confirmed extra or remained closed after settings were edited.");
  await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(completeConfig) });
  await fetch(`${base}/api/admin/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: cleanerBody.reference, kind: "cleaner", status: "paused" }) });
  const pausedOpportunityPhoto = await fetch(`${base}/api/opportunity-photo?imageId=${briefBody.photos[0].id}`, { headers: { "x-opportunity-token": proposalBody.proposal.cleanerReviewToken } });
  assert(pausedOpportunityPhoto.status === 404, "Private room-photo access remained open while the selected cleaner was paused.");
  const acceptanceWhileCleanerPaused = await fetch(`${base}/api/quote/decision`, { method: "POST", headers: { "content-type": "application/json", "x-quote-token": proposalBody.proposal.reviewToken }, body: JSON.stringify({ decision: "accepted", typedName: "Test Customer", scopeConfirmed: true, termsAccepted: true }) });
  assert(acceptanceWhileCleanerPaused.status === 409, "Customer quote remained open after the proposed cleaner was paused.");
  await fetch(`${base}/api/admin/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: cleanerBody.reference, kind: "cleaner", status: "approved" }) });
  const restoredOpportunityPhoto = await fetch(`${base}/api/opportunity-photo?imageId=${briefBody.photos[0].id}`, { headers: { "x-opportunity-token": proposalBody.proposal.cleanerReviewToken } });
  assert(restoredOpportunityPhoto.ok, "Private room-photo access did not return after the selected cleaner passed readiness checks again.");
  const adminAcceptedProposal = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: proposalBody.proposal.id, status: "accepted" }) });
  assert(adminAcceptedProposal.status === 422, "Control desk fabricated customer acceptance without the private quote flow.");
  const invalidQuote = await fetch(`${base}/api/quote`, { headers: { "x-quote-token": "not-a-private-quote-token" } });
  assert(invalidQuote.status === 404, "Invalid private quote token exposed proposal data.");
  const wrongNameDecision = await fetch(`${base}/api/quote/decision`, { method: "POST", headers: { "content-type": "application/json", "x-quote-token": proposalBody.proposal.reviewToken }, body: JSON.stringify({ decision: "accepted", typedName: "Someone Else", scopeConfirmed: true, termsAccepted: true }) });
  assert(wrongNameDecision.status === 422, "Private quote accepted a mismatched customer name.");
  const incompleteDecision = await fetch(`${base}/api/quote/decision`, { method: "POST", headers: { "content-type": "application/json", "x-quote-token": proposalBody.proposal.reviewToken }, body: JSON.stringify({ decision: "accepted", typedName: "Test Customer", scopeConfirmed: true, termsAccepted: false }) });
  assert(incompleteDecision.status === 422, "Private quote accepted without both customer confirmations.");
  await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, suppliesCostPerJob: 2 }) });
  const repricedQuote = await fetch(`${base}/api/quote`, { headers: { "x-quote-token": proposalBody.proposal.reviewToken } });
  const repricedQuoteBody = await repricedQuote.json();
  assert(repricedQuote.ok && repricedQuoteBody.quote.pricingChanged === true && repricedQuoteBody.quote.decisionAllowed === false, "A sent quote remained actionable after its founder cost model changed.");
  const repricedTracker = await fetch(`${base}/api/request-status`, { headers: { "x-request-token": requestBody.customerStatusToken } });
  const repricedTrackerBody = await repricedTracker.json();
  assert(repricedTracker.ok && repricedTrackerBody.current.headline === "Quote needs recalculation" && repricedTrackerBody.links.quoteToken === "", "Customer tracker exposed a stale-cost quote instead of returning to recalculation.");
  const staleCostAcceptance = await fetch(`${base}/api/quote/decision`, { method: "POST", headers: { "content-type": "application/json", "x-quote-token": proposalBody.proposal.reviewToken }, body: JSON.stringify({ decision: "accepted", typedName: "Test Customer", scopeConfirmed: true, termsAccepted: true }) });
  assert(staleCostAcceptance.status === 409, "Customer accepted a quote calculated from stale cost assumptions.");
  await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(completeConfig) });
  const acceptedProposal = await fetch(`${base}/api/quote/decision`, { method: "POST", headers: { "content-type": "application/json", "x-quote-token": proposalBody.proposal.reviewToken }, body: JSON.stringify({ decision: "accepted", typedName: "Test Customer", scopeConfirmed: true, termsAccepted: true }) });
  const acceptedProposalBody = await acceptedProposal.json();
  assert(acceptedProposal.ok && acceptedProposalBody.status === "accepted", "Audited private customer acceptance failed.");
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
    body: JSON.stringify({ contactName: "Overlap Customer", email: "overlap@example.com", phone: "07123456780", postcode: "SW1A 2AA", customerType: "Landlord", propertyType: "Flat or house", service: "Rental turnover clean", siteSize: "1 bedroom and 1 bathroom", accessNotes: "Access to be confirmed", hazards: "None known", frequency: "One-off", consent: true })
  });
  const overlapRequestBody = await overlapRequest.json();
  assert(overlapRequest.status === 201, "Overlapping-schedule test request failed.");
  const overlapScan = await fetch(`${base}/api/job-briefs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: overlapRequestBody.reference, email: "overlap@example.com", transcript: "In the kitchen wipe the worktops and mop the floor.", photos: [{ area: "Kitchen", note: "Worktops and floor need cleaning", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zs7sAAAAASUVORK5CYII=" }], scopeCompleteConfirmed: true, consent: true })
  });
  const overlapScanBody = await overlapScan.json();
  assert(overlapScan.status === 201, "Overlapping-schedule request room scan failed.");
  const reviewedOverlapScan = await fetch(`${base}/api/admin/job-briefs/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ briefId: overlapScanBody.reference, status: "reviewed", note: "Test-only two-hour scan estimate.", scopeEstimateHours: 2, scopeConfidence: "medium" }) });
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
  assert(replacementProposal.status === 201, "Replacement proposal draft could not be prepared.");
  const competingReplacementReady = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: replacementProposalBody.proposal.id, status: "ready" }) });
  assert(competingReplacementReady.status === 409, "A second live proposal was allowed for the same cleaning request.");
  const declinedOverlapOpportunity = await fetch(`${base}/api/opportunity/decision`, { method: "POST", headers: { "content-type": "application/json", "x-opportunity-token": overlapProposalBody.proposal.cleanerReviewToken }, body: JSON.stringify({ decision: "declined", typedName: "Test Cleaner", reason: "Test-only schedule decline." }) });
  assert(declinedOverlapOpportunity.ok, "Cleaner could not decline the original opportunity before rematching.");
  const exhaustedCustomerQuote = await fetch(`${base}/api/quote`, { headers: { "x-quote-token": overlapProposalBody.proposal.reviewToken } });
  const exhaustedCustomerQuoteBody = await exhaustedCustomerQuote.json();
  assert(exhaustedCustomerQuote.ok && exhaustedCustomerQuoteBody.quote.cleanerDeclined === true && exhaustedCustomerQuoteBody.quote.decisionAllowed === false, "Customer quote remained actionable after its proposed cleaner declined.");
  const staleCustomerAcceptance = await fetch(`${base}/api/quote/decision`, { method: "POST", headers: { "content-type": "application/json", "x-quote-token": overlapProposalBody.proposal.reviewToken }, body: JSON.stringify({ decision: "accepted", typedName: "Overlap Customer", scopeConfirmed: true, termsAccepted: true }) });
  assert(staleCustomerAcceptance.status === 409, "Customer accepted an unfulfillable quote after the cleaner declined.");
  const replacementReady = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: replacementProposalBody.proposal.id, status: "ready" }) });
  const replacementSent = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: replacementProposalBody.proposal.id, status: "sent" }) });
  assert(replacementReady.ok && replacementSent.ok, "Replacement proposal did not reuse the released cleaner capacity after the original decline.");
  const replacementTracker = await fetch(`${base}/api/request-status`, { headers: { "x-request-token": overlapRequestBody.customerStatusToken } });
  const replacementTrackerBody = await replacementTracker.json();
  assert(replacementTracker.ok && replacementTrackerBody.current.stage === "quote-review" && replacementTrackerBody.links.quoteToken === replacementProposalBody.proposal.reviewToken, "Customer tracker did not prioritise the replacement quote over the exhausted proposal.");
  const acceptedReplacement = await fetch(`${base}/api/quote/decision`, { method: "POST", headers: { "content-type": "application/json", "x-quote-token": replacementProposalBody.proposal.reviewToken }, body: JSON.stringify({ decision: "accepted", typedName: "Overlap Customer", scopeConfirmed: true, termsAccepted: true }) });
  assert(acceptedReplacement.ok, "Replacement customer quote could not be accepted.");
  const shortWithdrawal = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: replacementProposalBody.proposal.id, status: "cancelled", note: "Short" }) });
  assert(shortWithdrawal.status === 422, "Proposal withdrawal was recorded without an auditable reason.");
  const withdrawnReplacement = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: replacementProposalBody.proposal.id, status: "cancelled", note: "Test-only withdrawal before a booking was recorded." }) });
  assert(withdrawnReplacement.ok, "Accepted pre-booking proposal could not be withdrawn safely.");
  const withdrawnQuote = await fetch(`${base}/api/quote`, { headers: { "x-quote-token": replacementProposalBody.proposal.reviewToken } });
  const withdrawnQuoteBody = await withdrawnQuote.json();
  assert(withdrawnQuote.ok && withdrawnQuoteBody.quote.status === "cancelled" && withdrawnQuoteBody.quote.decision?.status === "accepted" && withdrawnQuoteBody.quote.decisionAllowed === false, "Withdrawn customer quote did not preserve its acceptance audit while becoming read-only.");
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
  const overlappingCleanerDecision = await fetch(`${base}/api/opportunity/decision`, { method: "POST", headers: { "content-type": "application/json", "x-opportunity-token": overlapProposalBody.proposal.cleanerReviewToken }, body: JSON.stringify({ decision: "accepted", typedName: "Test Cleaner", scopeConfirmed: true, payConfirmed: true, availabilityConfirmed: true }) });
  assert(overlappingCleanerDecision.status === 409, "Cleaner changed a completed decline after that opportunity's capacity had been released.");
  const duplicateCleanerDecision = await fetch(`${base}/api/opportunity/decision`, { method: "POST", headers: { "content-type": "application/json", "x-opportunity-token": proposalBody.proposal.cleanerReviewToken }, body: JSON.stringify({ decision: "declined", typedName: "Test Cleaner" }) });
  assert(duplicateCleanerDecision.status === 409, "A completed cleaner decision was overwritten.");
  const acceptedOpportunity = await fetch(`${base}/api/opportunity`, { headers: { "x-opportunity-token": proposalBody.proposal.cleanerReviewToken } });
  const acceptedOpportunityBody = await acceptedOpportunity.json();
  assert(acceptedOpportunity.ok && acceptedOpportunityBody.opportunity.decision?.status === "accepted" && acceptedOpportunityBody.opportunity.confirmedExtras?.[0]?.code === "oven-interior" && acceptedOpportunityBody.opportunity.decisionAllowed === false, "Accepted cleaner opportunity did not become a locked record with its confirmed extra retained.");

  const readyDrafts = await fetch(`${base}/api/admin/proposal-drafts?proposalId=${proposalBody.proposal.id}`);
  const readyDraftsBody = await readyDrafts.json();
  assert(readyDrafts.ok && readyDraftsBody.sendAllowed === true, "Ready proposal drafts were not available for review.");
  assert(readyDraftsBody.customer.body.includes("Test Customer") && readyDraftsBody.customer.body.includes("£120.00") && readyDraftsBody.customer.body.includes("09:00–13:00") && readyDraftsBody.customer.body.includes("Respond by:") && readyDraftsBody.customer.body.includes("Price-sensitive items included in this reviewed time and total:") && readyDraftsBody.customer.body.includes("Inside oven cleaning"), "Customer quote draft omitted required proposal, schedule, response deadline or confirmed extra.");
  assert(readyDraftsBody.cleaner.body.includes("£72.00") && readyDraftsBody.cleaner.body.includes("09:00–13:00") && readyDraftsBody.cleaner.body.includes("Respond by:") && readyDraftsBody.cleaner.body.includes("None known") && readyDraftsBody.cleaner.body.includes("Tideway-reviewed cleaner checklist") && readyDraftsBody.cleaner.body.includes("Kitchen: Wipe every kitchen worktop") && readyDraftsBody.cleaner.body.includes("Price-sensitive items included in these hours and proposed pay:") && readyDraftsBody.cleaner.body.includes("Inside oven cleaning") && readyDraftsBody.cleaner.body.includes("Customer-authorised room photos: 1") && readyDraftsBody.cleaner.body.includes("private opportunity link") && !readyDraftsBody.cleaner.body.includes("customer@example.com") && !readyDraftsBody.cleaner.body.includes("Test Customer") && !readyDraftsBody.cleaner.body.includes("base64"), "Cleaner draft omitted reviewed schedule, pay, confirmed-extra or photo/checklist scope, or leaked customer identity or image data.");

  const bookingAudit = await fetch(`${base}/api/admin/booking-audit?proposalId=${proposalBody.proposal.id}`);
  const bookingAuditBody = await bookingAudit.json();
  assert(bookingAudit.ok && bookingAuditBody.automatedReady === true && bookingAuditBody.checks.customerScopeConfirmed === true && Object.values(bookingAuditBody.checks).every(Boolean), "Two-sided accepted proposal did not retain customer scope confirmation or pass the automated booking audit.");
  assert(bookingAuditBody.manualChecklist.length >= 4, "Booking audit omitted required manual confirmations.");

  const quotedStatus = await fetch(`${base}/api/admin/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: requestBody.reference, kind: "request", status: "quoted" }) });
  assert(quotedStatus.ok, "Customer request could not move from contacted to quoted.");
  const incompleteBooking = await fetch(`${base}/api/admin/bookings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: proposalBody.proposal.id, addressAndAccessConfirmed: true }) });
  assert(incompleteBooking.status === 422, "Incomplete manual confirmations created a booking.");
  const bookingInput = { proposalId: proposalBody.proposal.id, serviceAddress: "10 Clean Street, Westminster, London", servicePostcode: "SW1A 1AA", accessContactName: "Site Manager", accessContactPhone: "07123456781", accessInstructions: "Meet the site manager at reception. No access codes stored.", parkingNotes: "Paid parking nearby.", productsAndEquipment: "Cleaner brings standard products and equipment; customer provides site-specific consumables.", emergencyInstructions: "Stop work and call Tideway support if the site is unsafe or materially different.", addressAndAccessConfirmed: true, finalChecklistConfirmed: true, paymentAuthorisationConfirmed: true, emergencyInstructionsConfirmed: true, internalNote: "Test confirmation only" };
  const mismatchedBookingPostcode = await fetch(`${base}/api/admin/bookings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...bookingInput, servicePostcode: "SW2 1AA" }) });
  assert(mismatchedBookingPostcode.status === 422, "Booking pack changed the accepted service postcode.");
  const confirmedBooking = await fetch(`${base}/api/admin/bookings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(bookingInput)
  });
  const confirmedBookingBody = await confirmedBooking.json();
  assert(confirmedBooking.status === 201 && confirmedBookingBody.booking.id.startsWith("BKG-") && /^[A-Za-z0-9_-]{32}$/.test(confirmedBookingBody.booking.customerViewToken) && /^[A-Za-z0-9_-]{32}$/.test(confirmedBookingBody.booking.cleanerViewToken), "Fully confirmed booking or its private view tokens were not recorded.");
  const postBookingOpportunityPhoto = await fetch(`${base}/api/opportunity-photo?imageId=${briefBody.photos[0].id}`, { headers: { "x-opportunity-token": proposalBody.proposal.cleanerReviewToken } });
  assert(postBookingOpportunityPhoto.status === 404, "Pre-booking opportunity photo access remained open after the confirmed booking pack took over.");
  const bookedCapacityMatching = await fetch(`${base}/api/admin/matches?requestId=${overlapRequestBody.reference}`);
  const bookedCapacityMatchingBody = await bookedCapacityMatching.json();
  const firstBookedCapacitySlot = bookedCapacityMatchingBody.matches?.[0]?.availabilitySlots?.[0];
  assert(bookedCapacityMatching.ok && firstBookedCapacitySlot?.availableDate === "2026-07-20" && firstBookedCapacitySlot.suggestedStartTime === "13:00" && firstBookedCapacitySlot.suggestedEndTime === "15:00" && firstBookedCapacitySlot.capacityAdjusted === true, "Confirmed booking capacity was not removed from later matching suggestions.");
  const bookedProposalWithdrawal = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: proposalBody.proposal.id, status: "cancelled", note: "Test-only attempt to withdraw a confirmed booking." }) });
  assert(bookedProposalWithdrawal.status === 409, "Proposal controls were allowed to cancel an already confirmed booking.");
  const bookedTracker = await fetch(`${base}/api/request-status`, { headers: { "x-request-token": requestBody.customerStatusToken } });
  const bookedTrackerBody = await bookedTracker.json();
  assert(bookedTracker.ok && bookedTrackerBody.current.stage === "booking-confirmed" && bookedTrackerBody.links.bookingToken === confirmedBookingBody.booking.customerViewToken && bookedTrackerBody.visit.reference === confirmedBookingBody.booking.id && !JSON.stringify(bookedTrackerBody).includes("cleanerViewToken"), "Customer tracker did not link the confirmed customer booking safely.");
  const invalidBookingPack = await fetch(`${base}/api/booking-pack`, { headers: { "x-booking-token": "not-a-booking-pack-token" } });
  assert(invalidBookingPack.status === 404, "Invalid booking-pack token exposed visit details.");
  const customerPack = await fetch(`${base}/api/booking-pack`, { headers: { "x-booking-token": confirmedBookingBody.booking.customerViewToken } });
  const customerPackBody = await customerPack.json();
  assert(customerPack.ok && customerPackBody.booking.audience === "customer" && customerPackBody.booking.serviceAddress === "10 Clean Street, Westminster, London" && customerPackBody.booking.customerTotal === 120 && customerPackBody.booking.checklist.includes("Kitchen: Clean inside the oven") && customerPackBody.booking.confirmedExtras?.[0]?.code === "oven-interior" && customerPackBody.booking.roomPhotos?.[0]?.note === "Worktops, floor and inside oven need attention", "Customer booking pack omitted confirmed address, price, checklist, confirmed extra or room-scan details.");
  const customerPackSerialised = JSON.stringify(customerPackBody);
  assert(!customerPackSerialised.includes("cleaner@example.com") && !customerPackSerialised.includes("cleanerPay") && !customerPackSerialised.includes("cleanerRate") && !customerPackSerialised.includes("07123456781") && !customerPackSerialised.includes("storedPath"), "Customer booking pack exposed cleaner economics, private access-contact data or storage paths.");
  const protectedCustomerPhoto = await fetch(`${base}/api/booking-photo?imageId=${briefBody.photos[0].id}`, { headers: { "x-booking-token": confirmedBookingBody.booking.customerViewToken } });
  assert(protectedCustomerPhoto.ok && protectedCustomerPhoto.headers.get("content-type") === "image/png" && (await protectedCustomerPhoto.arrayBuffer()).byteLength > 0, "Customer could not load a protected booked room photo.");
  const unprotectedBookingPhoto = await fetch(`${base}/api/booking-photo?imageId=${briefBody.photos[0].id}`);
  assert(unprotectedBookingPhoto.status === 404, "Booked room photo was exposed without its private booking token.");
  const cleanerPack = await fetch(`${base}/api/booking-pack`, { headers: { "x-booking-token": confirmedBookingBody.booking.cleanerViewToken } });
  const cleanerPackBody = await cleanerPack.json();
  assert(cleanerPack.ok && cleanerPackBody.booking.audience === "cleaner" && cleanerPackBody.booking.serviceAddress === "10 Clean Street, Westminster, London" && cleanerPackBody.booking.accessContactName === "Site Manager" && cleanerPackBody.booking.accessContactPhone === "07123456781" && cleanerPackBody.booking.cleanerPay === 72 && cleanerPackBody.booking.confirmedExtras?.[0]?.label === "Inside oven cleaning" && cleanerPackBody.booking.roomPhotos?.[0]?.area === "Kitchen", "Cleaner assignment pack omitted confirmed visit, access, pay, confirmed extra or room-scan details.");
  const protectedCleanerPhoto = await fetch(`${base}/api/booking-photo?imageId=${briefBody.photos[0].id}`, { headers: { "x-booking-token": confirmedBookingBody.booking.cleanerViewToken } });
  assert(protectedCleanerPhoto.ok && protectedCleanerPhoto.headers.get("cache-control") === "private, no-store", "Cleaner could not load the protected room photo or it was cacheable.");
  const cleanerPackSerialised = JSON.stringify(cleanerPackBody);
  assert(!cleanerPackSerialised.includes("customer@example.com") && !cleanerPackSerialised.includes("Test Customer") && !cleanerPackSerialised.includes("customerTotal"), "Cleaner assignment pack exposed customer identity or customer price.");
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
  const closedChange = await fetch(`${base}/api/admin/booking-change-requests/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ changeRequestId: customerChangeBody.reference, status: "closed", note: "Tideway recorded the request; the original booking remains unchanged pending a separately accepted proposal." }) });
  assert(closedChange.ok, "Booking change request could not close with a response note.");
  const reopenClosedChange = await fetch(`${base}/api/admin/booking-change-requests/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ changeRequestId: customerChangeBody.reference, status: "open" }) });
  assert(reopenClosedChange.status === 422, "Closed booking change history was overwritten.");
  const resolvedCustomerPack = await fetch(`${base}/api/booking-pack`, { headers: { "x-booking-token": confirmedBookingBody.booking.customerViewToken } });
  const resolvedCustomerPackBody = await resolvedCustomerPack.json();
  assert(resolvedCustomerPackBody.booking.changeRequests[0].status === "closed" && resolvedCustomerPackBody.booking.changeRequests[0].resolutionNote.includes("original booking remains unchanged"), "Customer could not see the reviewed change-request outcome.");
  const duplicateBooking = await fetch(`${base}/api/admin/bookings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(bookingInput) });
  assert(duplicateBooking.status === 409, "A duplicate confirmed booking was not rejected.");

  const prematureOutcome = await fetch(`${base}/api/admin/job-outcomes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingId: confirmedBookingBody.booking.id, actualHours: 4, customerCollected: 120, cleanerPaid: 72, otherCosts: 10, refundAmount: 0 }) });
  assert(prematureOutcome.status === 422, "Final job economics were recorded before the operational completion timeline.");
  const wrongAudienceEvent = await fetch(`${base}/api/job-events`, { method: "POST", headers: { "content-type": "application/json", "x-booking-token": confirmedBookingBody.booking.customerViewToken }, body: JSON.stringify({ type: "cleaner-arrived", addressConfirmed: true, safeToStart: true, scopeAccessible: true }) });
  assert(wrongAudienceEvent.status === 403, "Customer booking link recorded a cleaner-only job event.");
  const completedBeforeArrival = await fetch(`${base}/api/job-events`, { method: "POST", headers: { "content-type": "application/json", "x-booking-token": confirmedBookingBody.booking.cleanerViewToken }, body: JSON.stringify({ type: "cleaner-completed", checklistCompleted: true, siteSecured: true, issuesDisclosed: true }) });
  assert(completedBeforeArrival.status === 409, "Cleaner completion was recorded before arrival.");
  const arrivalBlockedBySafety = await fetch(`${base}/api/job-events`, { method: "POST", headers: { "content-type": "application/json", "x-booking-token": confirmedBookingBody.booking.cleanerViewToken }, body: JSON.stringify({ type: "cleaner-arrived", addressConfirmed: true, safeToStart: true, scopeAccessible: true }) });
  assert(arrivalBlockedBySafety.status === 409, "Cleaner started while a safety request remained open.");
  const closedSafety = await fetch(`${base}/api/admin/booking-change-requests/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ changeRequestId: cleanerSafetyBody.reference, status: "closed", note: "Safety concern reviewed and resolved before the cleaner records arrival." }) });
  assert(closedSafety.ok, "Safety request could not be resolved before job start.");
  const incompleteArrival = await fetch(`${base}/api/job-events`, { method: "POST", headers: { "content-type": "application/json", "x-booking-token": confirmedBookingBody.booking.cleanerViewToken }, body: JSON.stringify({ type: "cleaner-arrived", addressConfirmed: true }) });
  assert(incompleteArrival.status === 422, "Cleaner arrival was recorded without all safe-start confirmations.");
  const cleanerArrival = await fetch(`${base}/api/job-events`, { method: "POST", headers: { "content-type": "application/json", "x-booking-token": confirmedBookingBody.booking.cleanerViewToken }, body: JSON.stringify({ type: "cleaner-arrived", addressConfirmed: true, safeToStart: true, scopeAccessible: true, note: "Test arrival only" }) });
  const cleanerArrivalBody = await cleanerArrival.json();
  assert(cleanerArrival.status === 201 && cleanerArrivalBody.reference.startsWith("EVT-"), "Valid cleaner arrival was not recorded.");
  const arrivalTracker = await fetch(`${base}/api/request-status`, { headers: { "x-request-token": requestBody.customerStatusToken } });
  const arrivalTrackerBody = await arrivalTracker.json();
  assert(arrivalTracker.ok && arrivalTrackerBody.current.stage === "clean-in-progress" && arrivalTrackerBody.visit.jobProgress.cleanerArrivedAt, "Customer tracker did not show the recorded cleaner arrival.");
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
  const invalidOutcome = await fetch(`${base}/api/admin/job-outcomes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingId: confirmedBookingBody.booking.id, actualHours: 4, customerCollected: 0, cleanerPaid: 72 }) });
  assert(invalidOutcome.status === 422, "Invalid actual job economics were accepted.");
  const negativeActualCost = await fetch(`${base}/api/admin/job-outcomes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingId: confirmedBookingBody.booking.id, actualHours: 4, customerCollected: 120, cleanerPaid: 72, paymentFees: -1 }) });
  assert(negativeActualCost.status === 422, "A negative actual payment fee was accepted.");
  const completedJob = await fetch(`${base}/api/admin/job-outcomes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ bookingId: confirmedBookingBody.booking.id, actualHours: 4.5, customerCollected: 120, cleanerPaid: 72, paymentFees: 2, travelCosts: 1, suppliesCosts: 1, otherCosts: 6, refundAmount: 5, internalNote: "Test completion only" })
  });
  const completedJobBody = await completedJob.json();
  assert(completedJob.status === 201 && completedJobBody.outcome.totalDirectCosts === 10 && completedJobBody.outcome.paymentFees === 2 && completedJobBody.outcome.contribution === 33 && completedJobBody.outcome.profitable === true && completedJobBody.outcome.metTargetMargin === true, "Completed-job actual cost breakdown, contribution or target comparison was not calculated correctly.");
  const completedTracker = await fetch(`${base}/api/request-status`, { headers: { "x-request-token": requestBody.customerStatusToken } });
  const completedTrackerBody = await completedTracker.json();
  assert(completedTracker.ok && completedTrackerBody.current.stage === "completed" && completedTrackerBody.links.bookingToken === confirmedBookingBody.booking.customerViewToken, "Customer tracker did not reach completed status after the final job outcome.");

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
  assert(refreshedBody.records.find((record) => record.id === requestBody.reference)?.briefs?.[0]?.status === "reviewed" && refreshedBody.records.find((record) => record.id === requestBody.reference)?.briefs?.[0]?.customerScopeConfirmed === true && refreshedBody.records.find((record) => record.id === requestBody.reference)?.briefs?.[0]?.scopeEstimateHours === 3.5 && refreshedBody.records.find((record) => record.id === requestBody.reference)?.briefs?.[0]?.scopeConfidence === "high" && refreshedBody.records.find((record) => record.id === requestBody.reference)?.briefs?.[0]?.priceSensitiveScopeConfirmed === true && refreshedBody.records.find((record) => record.id === requestBody.reference)?.briefs?.[0]?.scopeSignalConfirmations?.[0] === "oven-interior", "Customer scope confirmation, structured job-brief review or confirmed price-sensitive scope was not retained.");
  assert(refreshedBody.records.find((record) => record.id === requestBody.reference)?.booking?.id === confirmedBookingBody.booking.id, "Confirmed booking was not attached to the request.");
  assert(refreshedBody.records.find((record) => record.id === requestBody.reference)?.booking?.details?.serviceAddress === "10 Clean Street, Westminster, London" && refreshedBody.records.find((record) => record.id === requestBody.reference)?.booking?.cleanerViewToken === confirmedBookingBody.booking.cleanerViewToken, "Structured booking pack was not retained in the control desk.");
  assert(refreshedBody.records.find((record) => record.id === requestBody.reference)?.booking?.changeRequests?.length === 2 && refreshedBody.records.find((record) => record.id === requestBody.reference)?.booking?.changeRequests?.some((change) => change.type === "safety-issue" && change.status === "closed"), "Booking change and safety queue was not retained in the control desk.");
  assert(refreshedBody.records.find((record) => record.id === requestBody.reference)?.booking?.jobEvents?.length === 3 && refreshedBody.records.find((record) => record.id === requestBody.reference)?.booking?.jobProgress?.readyForOutcome === true, "Append-only job progress was not retained in the control desk.");
  assert(refreshedBody.records.find((record) => record.id === requestBody.reference)?.outcome?.contribution === 33, "Actual job outcome was not attached to the request.");
  assert(refreshedBody.records.find((record) => record.id === requestBody.reference)?.pilotCoverage?.covered === true, "Configured pilot coverage was not attached to the customer request.");
  assert(refreshedBody.records.find((record) => record.id === cleanerBody.reference)?.screening?.complete === true, "Latest cleaner screening was not attached to the application.");
  assert(refreshedBody.records.find((record) => record.id === cleanerBody.reference)?.cleanerAvailability?.length === 3, "Active confirmed availability windows were not attached to the cleaner control-desk record.");
  const withdrawnAdminProposal = refreshedBody.records.find((record) => record.id === overlapRequestBody.reference)?.proposals?.find((proposal) => proposal.id === replacementProposalBody.proposal.id);
  assert(withdrawnAdminProposal?.status === "cancelled" && withdrawnAdminProposal.statusNote === "Test-only withdrawal before a booking was recorded.", "Control desk did not retain the audited pre-booking withdrawal reason.");
  assert(refreshedBody.records.find((record) => record.id === overlapRequestBody.reference)?.dispatchActions?.some((action) => action.code === "rematch" && action.group === "rematching"), "Exhausted and withdrawn offers did not remain visible in the rematching queue.");
  assert(refreshedBody.records.find((record) => record.id === requestBody.reference)?.dispatchActions?.length === 0, "Completed profitable work remained in the active founder-action queue.");

  console.log("Smoke tests passed: public pages, eight-item live scan readiness, empty/partial/complete readiness states, photo-count and supported-room safeguards, reviewed-scan matching gates, required customer scope-completeness confirmation, stored confirmation timestamps, booking-audit scope confirmation, preferred arrival fit, reviewed-duration capacity, impossible-window rejection, founder-action dispatch priorities, urgent safety escalation, rematching visibility, private request-to-scan handoff, private customer journey tracker from scan through completion, tracker data isolation, automatic concise speech bullets, mandatory room labels, per-photo notes, photographed-room task coverage, customer-visible price-sensitive scope warnings, supported-signal coverage, false-positive protection, required reviewer confirmations, frozen confirmed extras, explicit selected-cleaner photo consent, frozen opportunity photo scope, token-authorised non-cacheable opportunity images, preview/no-consent/readiness/booking image revocation, structured scan-hour estimates, scope-confidence review, scan-to-quote duration floors, protected booked-room images, pilot-area enforcement, cleaner screening, confirmed availability windows, availability withdrawal gates, admin security, founder-confirmed cost assumptions, frozen proposal cost breakdowns, stale-cost rejection, exact job schedules, frozen offer deadlines, stale-decision protection, one-live-offer enforcement, live cleaner-capacity holds, capacity-aware matching, cleaner-decline capacity release, cleaner-decline quote lockout, replacement selection, audited pre-booking withdrawal, overlap prevention, matching, profitable proposals, two-sided private decisions, protected booking packs, non-destructive change/safety requests, append-only job progress, booking confirmations and categorised actual completed-job economics.");
} finally {
  if (child.exitCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await exited;
  }
  await rm(testDataDir, { recursive: true, force: true });
}
