import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checklistFromTranscript } from "../public/checklist.js";
import { clearBriefHandoff, readBriefHandoff, saveBriefHandoff } from "../public/brief-handoff.js";

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
  assert(adminPage.ok && (await adminPage.text()).includes("Lead control desk"), "Admin page failed.");
  const briefPage = await fetch(`${base}/brief`);
  assert(briefPage.ok && (await briefPage.text()).includes("Request details carried over."), "Photo job-brief page or private handoff notice failed.");
  assert(briefPage.headers.get("permissions-policy")?.includes("microphone=(self)"), "Job-brief page did not allow its requested microphone feature.");
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

  const invalid = await fetch(`${base}/api/cleaning-requests`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert(invalid.status === 422, "Invalid cleaning request was not rejected.");

  const oversized = await fetch(`${base}/api/cleaning-requests`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ details: "x".repeat(70 * 1024) }) });
  assert(oversized.status === 413, "Oversized request body was not rejected.");

  const validRequest = await fetch(`${base}/api/cleaning-requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contactName: "Test Customer", email: "customer@example.com", phone: "07123456789", postcode: "SW1A 1AA", customerType: "Landlord", propertyType: "Flat or house", service: "Rental turnover clean", siteSize: "2 bedrooms and 1 bathroom", accessNotes: "Collect keys from the office", hazards: "None known", consent: true })
  });
  const requestBody = await validRequest.json();
  assert(validRequest.status === 201 && requestBody.reference.startsWith("REQ-"), "Valid cleaning request failed.");

  const unmatchedBrief = await fetch(`${base}/api/job-briefs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: requestBody.reference, email: "wrong@example.com", transcript: "Clean the kitchen worktops.", checklist: ["Kitchen: Clean the kitchen worktops"], photos: [{ area: "Kitchen", note: "Worktops need wiping", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zs7sAAAAASUVORK5CYII=" }], consent: true })
  });
  assert(unmatchedBrief.status === 404, "A job brief attached without matching the request email.");

  const invalidPhotoBrief = await fetch(`${base}/api/job-briefs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: requestBody.reference, email: "customer@example.com", transcript: "Clean the kitchen worktops.", checklist: ["Kitchen: Clean the kitchen worktops"], photos: [{ area: "Kitchen", note: "Worktops need wiping", dataUrl: "data:image/png;base64,SGVsbG8=" }], consent: true })
  });
  assert(invalidPhotoBrief.status === 422, "Invalid image content was accepted as a property photo.");

  const missingRoomNote = await fetch(`${base}/api/job-briefs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: requestBody.reference, email: "customer@example.com", transcript: "Clean the kitchen worktops.", checklist: ["Kitchen: Clean the kitchen worktops"], photos: [{ area: "Kitchen", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zs7sAAAAASUVORK5CYII=" }], consent: true }) });
  assert(missingRoomNote.status === 422, "Room scan accepted a photo without its specific room note.");
  const uncoveredRoom = await fetch(`${base}/api/job-briefs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: requestBody.reference, email: "customer@example.com", transcript: "Clean the kitchen worktops.", checklist: ["Clean the kitchen worktops"], photos: [{ area: "Kitchen", note: "Worktops need wiping", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zs7sAAAAASUVORK5CYII=" }], consent: true }) });
  assert(uncoveredRoom.status === 422, "Room scan accepted a photographed room with no room-labelled cleaner task.");

  const validBrief = await fetch(`${base}/api/job-briefs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: requestBody.reference, email: "customer@example.com", transcript: "Please wipe every kitchen worktop. Also mop the kitchen floor.", checklist: ["Kitchen: Wipe every kitchen worktop", "Kitchen: Mop the kitchen floor"], photos: [{ area: "Kitchen", note: "Worktops and floor need attention", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zs7sAAAAASUVORK5CYII=" }], consent: true })
  });
  const briefBody = await validBrief.json();
  assert(validBrief.status === 201 && briefBody.reference.startsWith("BRF-") && briefBody.checklist.length === 2, "Valid photo job brief failed or checklist bullets were not generated.");

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
  assert(adminBody.records.find((record) => record.id === requestBody.reference)?.briefs?.[0]?.id === briefBody.reference, "Photo job brief was not attached to its customer request.");
  assert(adminBody.records.find((record) => record.id === requestBody.reference)?.briefs?.[0]?.status === "landlord-draft", "New photo job brief did not enter the human review queue.");

  const proxiedAdmin = await fetch(`${base}/api/admin/records`, { headers: { "x-forwarded-for": "203.0.113.10" } });
  assert(proxiedAdmin.status === 401, "Proxied admin request bypassed authentication.");

  const authorisedProxiedAdmin = await fetch(`${base}/api/admin/records`, { headers: { "x-forwarded-for": "203.0.113.10", "x-admin-key": "test-admin-key" } });
  assert(authorisedProxiedAdmin.ok, "Admin key did not authorise proxied request.");

  const initialConfig = await fetch(`${base}/api/admin/config`);
  const initialConfigBody = await initialConfig.json();
  assert(initialConfig.ok && initialConfigBody.readiness.completed === 0, "Initial launch readiness was incorrect.");

  const completeConfig = { legalOwnerName: "Test Owner", businessStructure: "Sole trader", legalBusinessName: "Test Tideway", tradingAddress: "1 Test Street, London", supportEmail: "support@example.com", supportPhone: "07123456789", pilotPostcodes: "SW1A, SW2, SW4", cleanerModel: "Worker", insuranceStatus: "active", paymentProviderName: "TestPay", paymentProviderStatus: "live", refundProcess: "Owner approves and records refunds within five working days.", customerHourlyRate: 30, cleanerHourlyPay: 18, minimumHours: 2, minimumContributionMarginPercent: 25, cancellationPolicy: "24 hours notice.", paymentTiming: "Payment authorised at booking and captured after completion" };
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
  await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(completeConfig) });

  const testOnlyPayments = await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, paymentProviderStatus: "testing" }) });
  const testOnlyPaymentsBody = await testOnlyPayments.json();
  assert(testOnlyPayments.ok && testOnlyPaymentsBody.readiness.ready === false && testOnlyPaymentsBody.readiness.checks.payments === false, "Test-mode payment provider did not block launch readiness.");
  await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(completeConfig) });
  const undecidedCleanerModel = await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, cleanerModel: "Undecided" }) });
  const undecidedCleanerModelBody = await undecidedCleanerModel.json();
  assert(undecidedCleanerModel.ok && undecidedCleanerModelBody.readiness.ready === false && undecidedCleanerModelBody.readiness.checks.operatingRules === false, "Undecided cleaner engagement model passed launch readiness.");
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
  assert(matching.ok && matchingBody.matches.length === 1, "Approved cleaner match was not returned.");
  assert(matchingBody.matches[0].score === 100 && matchingBody.matches[0].coverage === "Postcode listed", "Cleaner match score was incorrect.");

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
  assert(validProposal.status === 201 && proposalBody.proposal.contribution === 38 && proposalBody.proposal.proposedEndTime === "13:00" && /^[A-Za-z0-9_-]{32}$/.test(proposalBody.proposal.reviewToken) && /^[A-Za-z0-9_-]{32}$/.test(proposalBody.proposal.cleanerReviewToken), "Valid draft proposal failed, calculated incorrectly, omitted its schedule or omitted a private review token.");

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
  const reviewedBrief = await fetch(`${base}/api/admin/job-briefs/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ briefId: briefBody.reference, status: "reviewed", note: "Checklist and private photo support a three-and-a-half-hour scope floor.", scopeEstimateHours: 3.5, scopeConfidence: "high" })
  });
  const reviewedBriefBody = await reviewedBrief.json();
  assert(reviewedBrief.ok && reviewedBriefBody.status === "reviewed" && reviewedBriefBody.scopeEstimateHours === 3.5 && reviewedBriefBody.scopeConfidence === "high", "Structured human scan approval was not recorded.");
  const reversedBriefReview = await fetch(`${base}/api/admin/job-briefs/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ briefId: briefBody.reference, status: "needs-revision", note: "Late change" }) });
  assert(reversedBriefReview.status === 422, "Reviewed brief history was overwritten instead of requiring a new submission.");
  const underScopedProposal = await fetch(`${base}/api/admin/proposals`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: requestBody.reference, cleanerId: cleanerBody.reference, proposedDate: "2026-07-23", proposedStartTime: "09:00", estimatedHours: 3, customerRate: 30, cleanerRate: 18, otherCosts: 5 }) });
  const underScopedProposalBody = await underScopedProposal.json();
  assert(underScopedProposal.status === 201, "Internal under-scoped draft could not be created for the reviewed-hours gate test.");
  const underScopedReady = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: underScopedProposalBody.proposal.id, status: "ready" }) });
  assert(underScopedReady.status === 422, "Proposal advanced with fewer hours than the reviewed room-scan estimate.");
  const readyProposal = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: proposalBody.proposal.id, status: "ready" }) });
  assert(readyProposal.ok, "Ready proposal status failed after launch checks passed.");
  const quotePreview = await fetch(`${base}/api/quote`, { headers: { "x-quote-token": proposalBody.proposal.reviewToken } });
  const quotePreviewBody = await quotePreview.json();
  assert(quotePreview.ok && quotePreviewBody.quote.reference === proposalBody.proposal.id && quotePreviewBody.quote.proposedStartTime === "09:00" && quotePreviewBody.quote.proposedEndTime === "13:00" && quotePreviewBody.quote.decisionAllowed === false && quotePreviewBody.quote.checklist.includes("Kitchen: Wipe every kitchen worktop"), "Private customer quote preview omitted the approved scope/schedule or opened decisions too early.");
  const opportunityPreview = await fetch(`${base}/api/opportunity`, { headers: { "x-opportunity-token": proposalBody.proposal.cleanerReviewToken } });
  const opportunityPreviewBody = await opportunityPreview.json();
  assert(opportunityPreview.ok && opportunityPreviewBody.opportunity.reference === proposalBody.proposal.id && opportunityPreviewBody.opportunity.proposedStartTime === "09:00" && opportunityPreviewBody.opportunity.proposedEndTime === "13:00" && opportunityPreviewBody.opportunity.decisionAllowed === false && opportunityPreviewBody.opportunity.cleanerPay === 72 && opportunityPreviewBody.opportunity.checklist.includes("Kitchen: Wipe every kitchen worktop"), "Private cleaner opportunity preview omitted the reviewed scope/schedule/pay or opened decisions too early.");
  const previewSerialised = JSON.stringify(opportunityPreviewBody);
  assert(!previewSerialised.includes("customer@example.com") && !previewSerialised.includes("Test Customer") && !previewSerialised.includes("Collect keys"), "Cleaner opportunity preview leaked customer identity or access details.");
  const skippedTransition = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: proposalBody.proposal.id, status: "accepted" }) });
  assert(skippedTransition.status === 422, "Proposal status skipped the sent step.");
  const pausedCleaner = await fetch(`${base}/api/admin/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: cleanerBody.reference, kind: "cleaner", status: "paused" }) });
  assert(pausedCleaner.ok, "Approved cleaner could not be paused for proposal revalidation test.");
  const pausedCleanerSend = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: proposalBody.proposal.id, status: "sent" }) });
  assert(pausedCleanerSend.status === 422, "Proposal was sent after the selected cleaner was paused.");
  const restoredCleaner = await fetch(`${base}/api/admin/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: cleanerBody.reference, kind: "cleaner", status: "approved" }) });
  assert(restoredCleaner.ok, "Paused cleaner could not return to approved status after revalidation test.");
  const sentProposal = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: proposalBody.proposal.id, status: "sent" }) });
  assert(sentProposal.ok, "Sent proposal status failed.");
  await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...completeConfig, cancellationPolicy: "A later rule that must not rewrite an already-sent quote.", cleanerModel: "A later model that must not rewrite a sent opportunity." }) });
  const frozenQuote = await fetch(`${base}/api/quote`, { headers: { "x-quote-token": proposalBody.proposal.reviewToken } });
  const frozenQuoteBody = await frozenQuote.json();
  assert(frozenQuote.ok && frozenQuoteBody.quote.cancellationPolicy === completeConfig.cancellationPolicy, "An already-sent quote changed when operating settings were edited.");
  const frozenOpportunity = await fetch(`${base}/api/opportunity`, { headers: { "x-opportunity-token": proposalBody.proposal.cleanerReviewToken } });
  const frozenOpportunityBody = await frozenOpportunity.json();
  assert(frozenOpportunity.ok && frozenOpportunityBody.opportunity.cleanerModel === completeConfig.cleanerModel && frozenOpportunityBody.opportunity.decisionAllowed === true, "An already-sent cleaner opportunity changed when operating settings were edited or remained closed.");
  await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(completeConfig) });
  await fetch(`${base}/api/admin/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: cleanerBody.reference, kind: "cleaner", status: "paused" }) });
  const acceptanceWhileCleanerPaused = await fetch(`${base}/api/quote/decision`, { method: "POST", headers: { "content-type": "application/json", "x-quote-token": proposalBody.proposal.reviewToken }, body: JSON.stringify({ decision: "accepted", typedName: "Test Customer", scopeConfirmed: true, termsAccepted: true }) });
  assert(acceptanceWhileCleanerPaused.status === 409, "Customer quote remained open after the proposed cleaner was paused.");
  await fetch(`${base}/api/admin/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: cleanerBody.reference, kind: "cleaner", status: "approved" }) });
  const adminAcceptedProposal = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: proposalBody.proposal.id, status: "accepted" }) });
  assert(adminAcceptedProposal.status === 422, "Control desk fabricated customer acceptance without the private quote flow.");
  const invalidQuote = await fetch(`${base}/api/quote`, { headers: { "x-quote-token": "not-a-private-quote-token" } });
  assert(invalidQuote.status === 404, "Invalid private quote token exposed proposal data.");
  const wrongNameDecision = await fetch(`${base}/api/quote/decision`, { method: "POST", headers: { "content-type": "application/json", "x-quote-token": proposalBody.proposal.reviewToken }, body: JSON.stringify({ decision: "accepted", typedName: "Someone Else", scopeConfirmed: true, termsAccepted: true }) });
  assert(wrongNameDecision.status === 422, "Private quote accepted a mismatched customer name.");
  const incompleteDecision = await fetch(`${base}/api/quote/decision`, { method: "POST", headers: { "content-type": "application/json", "x-quote-token": proposalBody.proposal.reviewToken }, body: JSON.stringify({ decision: "accepted", typedName: "Test Customer", scopeConfirmed: true, termsAccepted: false }) });
  assert(incompleteDecision.status === 422, "Private quote accepted without both customer confirmations.");
  const acceptedProposal = await fetch(`${base}/api/quote/decision`, { method: "POST", headers: { "content-type": "application/json", "x-quote-token": proposalBody.proposal.reviewToken }, body: JSON.stringify({ decision: "accepted", typedName: "Test Customer", scopeConfirmed: true, termsAccepted: true }) });
  const acceptedProposalBody = await acceptedProposal.json();
  assert(acceptedProposal.ok && acceptedProposalBody.status === "accepted", "Audited private customer acceptance failed.");
  const duplicateDecision = await fetch(`${base}/api/quote/decision`, { method: "POST", headers: { "content-type": "application/json", "x-quote-token": proposalBody.proposal.reviewToken }, body: JSON.stringify({ decision: "declined", typedName: "Test Customer" }) });
  assert(duplicateDecision.status === 409, "A completed customer decision was overwritten.");
  const acceptedQuote = await fetch(`${base}/api/quote`, { headers: { "x-quote-token": proposalBody.proposal.reviewToken } });
  const acceptedQuoteBody = await acceptedQuote.json();
  assert(acceptedQuote.ok && acceptedQuoteBody.quote.decision?.status === "accepted" && acceptedQuoteBody.quote.decisionAllowed === false, "Accepted quote did not become a locked read-only record.");

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
    body: JSON.stringify({ requestId: overlapRequestBody.reference, email: "overlap@example.com", transcript: "In the kitchen wipe the worktops and mop the floor.", photos: [{ area: "Kitchen", note: "Worktops and floor need cleaning", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zs7sAAAAASUVORK5CYII=" }], consent: true })
  });
  const overlapScanBody = await overlapScan.json();
  assert(overlapScan.status === 201, "Overlapping-schedule request room scan failed.");
  const reviewedOverlapScan = await fetch(`${base}/api/admin/job-briefs/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ briefId: overlapScanBody.reference, status: "reviewed", note: "Test-only two-hour scan estimate.", scopeEstimateHours: 2, scopeConfidence: "medium" }) });
  assert(reviewedOverlapScan.ok, "Overlapping-schedule request room scan was not reviewed.");
  const overlapProposal = await fetch(`${base}/api/admin/proposals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: overlapRequestBody.reference, cleanerId: cleanerBody.reference, proposedDate: "2026-07-20", proposedStartTime: "11:00", estimatedHours: 2, customerRate: 30, cleanerRate: 18, otherCosts: 0 })
  });
  const overlapProposalBody = await overlapProposal.json();
  assert(overlapProposal.status === 201 && overlapProposalBody.proposal.proposedEndTime === "13:00", "Overlapping-schedule test proposal failed.");
  const overlapReady = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: overlapProposalBody.proposal.id, status: "ready" }) });
  const overlapSent = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: overlapProposalBody.proposal.id, status: "sent" }) });
  assert(overlapReady.ok && overlapSent.ok, "A second opportunity could not reach sent state before either cleaner decision existed.");

  const bookingBeforeCleaner = await fetch(`${base}/api/admin/booking-audit?proposalId=${proposalBody.proposal.id}`);
  const bookingBeforeCleanerBody = await bookingBeforeCleaner.json();
  assert(bookingBeforeCleaner.ok && bookingBeforeCleanerBody.automatedReady === false && bookingBeforeCleanerBody.checks.customerAccepted === true && bookingBeforeCleanerBody.checks.cleanerAccepted === false, "Booking audit did not block while cleaner acceptance was missing.");
  const invalidOpportunity = await fetch(`${base}/api/opportunity`, { headers: { "x-opportunity-token": "not-an-opportunity-token" } });
  assert(invalidOpportunity.status === 404, "Invalid cleaner opportunity token exposed proposal data.");
  const wrongCleanerName = await fetch(`${base}/api/opportunity/decision`, { method: "POST", headers: { "content-type": "application/json", "x-opportunity-token": proposalBody.proposal.cleanerReviewToken }, body: JSON.stringify({ decision: "accepted", typedName: "Someone Else", scopeConfirmed: true, payConfirmed: true, availabilityConfirmed: true }) });
  assert(wrongCleanerName.status === 422, "Cleaner opportunity accepted a mismatched application name.");
  const incompleteCleanerDecision = await fetch(`${base}/api/opportunity/decision`, { method: "POST", headers: { "content-type": "application/json", "x-opportunity-token": proposalBody.proposal.cleanerReviewToken }, body: JSON.stringify({ decision: "accepted", typedName: "Test Cleaner", scopeConfirmed: true, payConfirmed: true, availabilityConfirmed: false }) });
  assert(incompleteCleanerDecision.status === 422, "Cleaner opportunity accepted without scope, pay and availability confirmations.");
  const acceptedCleaner = await fetch(`${base}/api/opportunity/decision`, { method: "POST", headers: { "content-type": "application/json", "x-opportunity-token": proposalBody.proposal.cleanerReviewToken }, body: JSON.stringify({ decision: "accepted", typedName: "Test Cleaner", scopeConfirmed: true, payConfirmed: true, availabilityConfirmed: true }) });
  const acceptedCleanerBody = await acceptedCleaner.json();
  assert(acceptedCleaner.ok && acceptedCleanerBody.status === "accepted", "Audited private cleaner acceptance failed.");
  const overlappingCleanerDecision = await fetch(`${base}/api/opportunity/decision`, { method: "POST", headers: { "content-type": "application/json", "x-opportunity-token": overlapProposalBody.proposal.cleanerReviewToken }, body: JSON.stringify({ decision: "accepted", typedName: "Test Cleaner", scopeConfirmed: true, payConfirmed: true, availabilityConfirmed: true }) });
  assert(overlappingCleanerDecision.status === 409, "Cleaner accepted a second opportunity that overlaps already-accepted work.");
  const duplicateCleanerDecision = await fetch(`${base}/api/opportunity/decision`, { method: "POST", headers: { "content-type": "application/json", "x-opportunity-token": proposalBody.proposal.cleanerReviewToken }, body: JSON.stringify({ decision: "declined", typedName: "Test Cleaner" }) });
  assert(duplicateCleanerDecision.status === 409, "A completed cleaner decision was overwritten.");
  const acceptedOpportunity = await fetch(`${base}/api/opportunity`, { headers: { "x-opportunity-token": proposalBody.proposal.cleanerReviewToken } });
  const acceptedOpportunityBody = await acceptedOpportunity.json();
  assert(acceptedOpportunity.ok && acceptedOpportunityBody.opportunity.decision?.status === "accepted" && acceptedOpportunityBody.opportunity.decisionAllowed === false, "Accepted cleaner opportunity did not become a locked read-only record.");

  const readyDrafts = await fetch(`${base}/api/admin/proposal-drafts?proposalId=${proposalBody.proposal.id}`);
  const readyDraftsBody = await readyDrafts.json();
  assert(readyDrafts.ok && readyDraftsBody.sendAllowed === true, "Ready proposal drafts were not available for review.");
  assert(readyDraftsBody.customer.body.includes("Test Customer") && readyDraftsBody.customer.body.includes("£120.00") && readyDraftsBody.customer.body.includes("09:00–13:00"), "Customer quote draft omitted required proposal or schedule details.");
  assert(readyDraftsBody.cleaner.body.includes("£72.00") && readyDraftsBody.cleaner.body.includes("09:00–13:00") && readyDraftsBody.cleaner.body.includes("None known") && readyDraftsBody.cleaner.body.includes("Tideway-reviewed cleaner checklist") && readyDraftsBody.cleaner.body.includes("Kitchen: Wipe every kitchen worktop") && readyDraftsBody.cleaner.body.includes("Photo references held privately: 1") && !readyDraftsBody.cleaner.body.includes("customer@example.com") && !readyDraftsBody.cleaner.body.includes("Test Customer") && !readyDraftsBody.cleaner.body.includes("base64"), "Cleaner draft omitted reviewed schedule/pay/photo checklist scope or leaked customer identity or image data.");

  const bookingAudit = await fetch(`${base}/api/admin/booking-audit?proposalId=${proposalBody.proposal.id}`);
  const bookingAuditBody = await bookingAudit.json();
  assert(bookingAudit.ok && bookingAuditBody.automatedReady === true && Object.values(bookingAuditBody.checks).every(Boolean), "Two-sided accepted proposal did not pass the automated booking audit.");
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
  const invalidBookingPack = await fetch(`${base}/api/booking-pack`, { headers: { "x-booking-token": "not-a-booking-pack-token" } });
  assert(invalidBookingPack.status === 404, "Invalid booking-pack token exposed visit details.");
  const customerPack = await fetch(`${base}/api/booking-pack`, { headers: { "x-booking-token": confirmedBookingBody.booking.customerViewToken } });
  const customerPackBody = await customerPack.json();
  assert(customerPack.ok && customerPackBody.booking.audience === "customer" && customerPackBody.booking.serviceAddress === "10 Clean Street, Westminster, London" && customerPackBody.booking.customerTotal === 120 && customerPackBody.booking.checklist.includes("Kitchen: Wipe every kitchen worktop") && customerPackBody.booking.roomPhotos?.[0]?.note === "Worktops and floor need attention", "Customer booking pack omitted confirmed address, price, checklist or room-scan details.");
  const customerPackSerialised = JSON.stringify(customerPackBody);
  assert(!customerPackSerialised.includes("cleaner@example.com") && !customerPackSerialised.includes("cleanerPay") && !customerPackSerialised.includes("cleanerRate") && !customerPackSerialised.includes("07123456781") && !customerPackSerialised.includes("storedPath"), "Customer booking pack exposed cleaner economics, private access-contact data or storage paths.");
  const protectedCustomerPhoto = await fetch(`${base}/api/booking-photo?imageId=${briefBody.photos[0].id}`, { headers: { "x-booking-token": confirmedBookingBody.booking.customerViewToken } });
  assert(protectedCustomerPhoto.ok && protectedCustomerPhoto.headers.get("content-type") === "image/png" && (await protectedCustomerPhoto.arrayBuffer()).byteLength > 0, "Customer could not load a protected booked room photo.");
  const unprotectedBookingPhoto = await fetch(`${base}/api/booking-photo?imageId=${briefBody.photos[0].id}`);
  assert(unprotectedBookingPhoto.status === 404, "Booked room photo was exposed without its private booking token.");
  const cleanerPack = await fetch(`${base}/api/booking-pack`, { headers: { "x-booking-token": confirmedBookingBody.booking.cleanerViewToken } });
  const cleanerPackBody = await cleanerPack.json();
  assert(cleanerPack.ok && cleanerPackBody.booking.audience === "cleaner" && cleanerPackBody.booking.serviceAddress === "10 Clean Street, Westminster, London" && cleanerPackBody.booking.accessContactName === "Site Manager" && cleanerPackBody.booking.accessContactPhone === "07123456781" && cleanerPackBody.booking.cleanerPay === 72 && cleanerPackBody.booking.roomPhotos?.[0]?.area === "Kitchen", "Cleaner assignment pack omitted confirmed visit, access, pay or room-scan details.");
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
  const duplicateArrival = await fetch(`${base}/api/job-events`, { method: "POST", headers: { "content-type": "application/json", "x-booking-token": confirmedBookingBody.booking.cleanerViewToken }, body: JSON.stringify({ type: "cleaner-arrived", addressConfirmed: true, safeToStart: true, scopeAccessible: true }) });
  assert(duplicateArrival.status === 409, "Duplicate cleaner arrival overwrote the timeline.");
  const earlyCustomerCompletion = await fetch(`${base}/api/job-events`, { method: "POST", headers: { "content-type": "application/json", "x-booking-token": confirmedBookingBody.booking.customerViewToken }, body: JSON.stringify({ type: "customer-completed", serviceReceived: true, completionDetailsAccurate: true }) });
  assert(earlyCustomerCompletion.status === 409, "Customer acknowledged completion before the cleaner finished.");
  const cleanerCompletion = await fetch(`${base}/api/job-events`, { method: "POST", headers: { "content-type": "application/json", "x-booking-token": confirmedBookingBody.booking.cleanerViewToken }, body: JSON.stringify({ type: "cleaner-completed", checklistCompleted: true, siteSecured: true, issuesDisclosed: true, note: "Test completion only" }) });
  assert(cleanerCompletion.status === 201, "Valid cleaner completion was not recorded.");
  const customerCompletion = await fetch(`${base}/api/job-events`, { method: "POST", headers: { "content-type": "application/json", "x-booking-token": confirmedBookingBody.booking.customerViewToken }, body: JSON.stringify({ type: "customer-completed", serviceReceived: true, completionDetailsAccurate: true }) });
  assert(customerCompletion.status === 201, "Valid customer completion acknowledgement was not recorded.");
  const packAfterCompletion = await fetch(`${base}/api/booking-pack`, { headers: { "x-booking-token": confirmedBookingBody.booking.customerViewToken } });
  const packAfterCompletionBody = await packAfterCompletion.json();
  assert(packAfterCompletionBody.booking.jobProgress.readyForOutcome === true && packAfterCompletionBody.booking.jobProgress.cleanerArrivedAt && packAfterCompletionBody.booking.jobProgress.cleanerCompletedAt && packAfterCompletionBody.booking.jobProgress.customerCompletedAt, "Private booking pack did not show the completed job timeline.");

  const unsafeCompletionStatus = await fetch(`${base}/api/admin/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: requestBody.reference, kind: "request", status: "completed" }) });
  assert(unsafeCompletionStatus.status === 422, "Request bypassed the completed-job workflow.");
  const invalidOutcome = await fetch(`${base}/api/admin/job-outcomes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingId: confirmedBookingBody.booking.id, actualHours: 4, customerCollected: 0, cleanerPaid: 72 }) });
  assert(invalidOutcome.status === 422, "Invalid actual job economics were accepted.");
  const completedJob = await fetch(`${base}/api/admin/job-outcomes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ bookingId: confirmedBookingBody.booking.id, actualHours: 4.5, customerCollected: 120, cleanerPaid: 72, otherCosts: 10, refundAmount: 5, internalNote: "Test completion only" })
  });
  const completedJobBody = await completedJob.json();
  assert(completedJob.status === 201 && completedJobBody.outcome.contribution === 33 && completedJobBody.outcome.profitable === true && completedJobBody.outcome.metTargetMargin === true, "Completed-job actual contribution or target comparison was not calculated correctly.");

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
  assert(refreshedBody.records.find((record) => record.id === requestBody.reference)?.briefs?.[0]?.status === "reviewed" && refreshedBody.records.find((record) => record.id === requestBody.reference)?.briefs?.[0]?.scopeEstimateHours === 3.5 && refreshedBody.records.find((record) => record.id === requestBody.reference)?.briefs?.[0]?.scopeConfidence === "high", "Structured job-brief review was not retained.");
  assert(refreshedBody.records.find((record) => record.id === requestBody.reference)?.booking?.id === confirmedBookingBody.booking.id, "Confirmed booking was not attached to the request.");
  assert(refreshedBody.records.find((record) => record.id === requestBody.reference)?.booking?.details?.serviceAddress === "10 Clean Street, Westminster, London" && refreshedBody.records.find((record) => record.id === requestBody.reference)?.booking?.cleanerViewToken === confirmedBookingBody.booking.cleanerViewToken, "Structured booking pack was not retained in the control desk.");
  assert(refreshedBody.records.find((record) => record.id === requestBody.reference)?.booking?.changeRequests?.length === 2 && refreshedBody.records.find((record) => record.id === requestBody.reference)?.booking?.changeRequests?.some((change) => change.type === "safety-issue" && change.status === "closed"), "Booking change and safety queue was not retained in the control desk.");
  assert(refreshedBody.records.find((record) => record.id === requestBody.reference)?.booking?.jobEvents?.length === 3 && refreshedBody.records.find((record) => record.id === requestBody.reference)?.booking?.jobProgress?.readyForOutcome === true, "Append-only job progress was not retained in the control desk.");
  assert(refreshedBody.records.find((record) => record.id === requestBody.reference)?.outcome?.contribution === 33, "Actual job outcome was not attached to the request.");
  assert(refreshedBody.records.find((record) => record.id === requestBody.reference)?.pilotCoverage?.covered === true, "Configured pilot coverage was not attached to the customer request.");
  assert(refreshedBody.records.find((record) => record.id === cleanerBody.reference)?.screening?.complete === true, "Latest cleaner screening was not attached to the application.");

  console.log("Smoke tests passed: public pages, private request-to-scan handoff, automatic concise speech bullets, mandatory room labels, per-photo notes, photographed-room task coverage, structured scan-hour estimates, scope-confidence review, scan-to-quote duration floors, protected booked-room images, pilot-area enforcement, cleaner screening, admin security, pricing controls, exact job schedules, overlap prevention, matching, profitable proposals, two-sided private decisions, protected booking packs, non-destructive change/safety requests, append-only job progress, booking confirmations and gated actual completed-job economics.");
} finally {
  if (child.exitCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await exited;
  }
  await rm(testDataDir, { recursive: true, force: true });
}
