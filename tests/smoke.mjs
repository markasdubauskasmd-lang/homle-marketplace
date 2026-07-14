import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checklistFromTranscript } from "../public/checklist.js";

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

  const home = await fetch(base);
  assert(home.ok && (await home.text()).includes("Cleaning work, matched and managed properly"), "Homepage failed.");
  assert(home.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"), "Security headers were missing.");
  assert(home.headers.get("content-security-policy")?.includes("img-src 'self' data: blob:"), "Secure local photo previews were blocked by the content policy.");

  const privacy = await fetch(`${base}/privacy`);
  assert(privacy.ok && (await privacy.text()).includes("Privacy notice"), "Privacy page failed.");

  const terms = await fetch(`${base}/terms`);
  assert(terms.ok && (await terms.text()).includes("Pilot terms"), "Terms page failed.");

  const adminPage = await fetch(`${base}/admin`);
  assert(adminPage.ok && (await adminPage.text()).includes("Lead control desk"), "Admin page failed.");
  const briefPage = await fetch(`${base}/brief`);
  assert(briefPage.ok && (await briefPage.text()).includes("Show the property. Say what needs cleaning."), "Photo job-brief page failed.");
  assert(briefPage.headers.get("permissions-policy")?.includes("microphone=(self)"), "Job-brief page did not allow its requested microphone feature.");
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
    body: JSON.stringify({ requestId: requestBody.reference, email: "wrong@example.com", transcript: "Clean the kitchen worktops.", checklist: ["Clean the kitchen worktops"], photos: [{ area: "Kitchen", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zs7sAAAAASUVORK5CYII=" }], consent: true })
  });
  assert(unmatchedBrief.status === 404, "A job brief attached without matching the request email.");

  const invalidPhotoBrief = await fetch(`${base}/api/job-briefs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: requestBody.reference, email: "customer@example.com", transcript: "Clean the kitchen worktops.", checklist: ["Clean the kitchen worktops"], photos: [{ area: "Kitchen", dataUrl: "data:image/png;base64,SGVsbG8=" }], consent: true })
  });
  assert(invalidPhotoBrief.status === 422, "Invalid image content was accepted as a property photo.");

  const validBrief = await fetch(`${base}/api/job-briefs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: requestBody.reference, email: "customer@example.com", transcript: "Please wipe every kitchen worktop. Also mop the kitchen floor.", photos: [{ area: "Kitchen", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zs7sAAAAASUVORK5CYII=" }], consent: true })
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

  const completeConfig = { legalOwnerName: "Test Owner", businessStructure: "Sole trader", legalBusinessName: "Test Tideway", tradingAddress: "1 Test Street, London", supportEmail: "support@example.com", supportPhone: "07123456789", pilotPostcodes: "SW2, SW4", cleanerModel: "Worker", insuranceStatus: "active", paymentProviderName: "TestPay", paymentProviderStatus: "live", refundProcess: "Owner approves and records refunds within five working days.", customerHourlyRate: 30, cleanerHourlyPay: 18, minimumHours: 2, minimumContributionMarginPercent: 25, cancellationPolicy: "24 hours notice.", paymentTiming: "Payment authorised at booking and captured after completion" };
  const savedConfig = await fetch(`${base}/api/admin/config`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(completeConfig)
  });
  const savedConfigBody = await savedConfig.json();
  assert(savedConfig.ok && savedConfigBody.readiness.ready === true, "Complete launch settings did not pass readiness checks.");

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
  const cleanerApproval = await fetch(`${base}/api/admin/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: cleanerBody.reference, kind: "cleaner", status: "approved" })
  });
  assert(cleanerApproval.ok, "Cleaner approval status failed.");

  const matching = await fetch(`${base}/api/admin/matches?requestId=${requestBody.reference}`);
  const matchingBody = await matching.json();
  assert(matching.ok && matchingBody.matches.length === 1, "Approved cleaner match was not returned.");
  assert(matchingBody.matches[0].score === 100 && matchingBody.matches[0].coverage === "Postcode listed", "Cleaner match score was incorrect.");

  const losingProposal = await fetch(`${base}/api/admin/proposals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: requestBody.reference, cleanerId: cleanerBody.reference, proposedDate: "2026-07-20", estimatedHours: 4, customerRate: 15, cleanerRate: 18, otherCosts: 0 })
  });
  assert(losingProposal.status === 422, "Loss-making proposal was not rejected.");

  const belowMinimumHoursProposal = await fetch(`${base}/api/admin/proposals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: requestBody.reference, cleanerId: cleanerBody.reference, proposedDate: "2026-07-20", estimatedHours: 1, customerRate: 30, cleanerRate: 18, otherCosts: 0 })
  });
  assert(belowMinimumHoursProposal.status === 422, "Proposal below the founder minimum hours was accepted.");

  const thinMarginProposal = await fetch(`${base}/api/admin/proposals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: requestBody.reference, cleanerId: cleanerBody.reference, proposedDate: "2026-07-20", estimatedHours: 4, customerRate: 30, cleanerRate: 23.5, otherCosts: 0 })
  });
  assert(thinMarginProposal.status === 422, "Proposal below the founder margin floor was accepted.");

  const validProposal = await fetch(`${base}/api/admin/proposals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: requestBody.reference, cleanerId: cleanerBody.reference, proposedDate: "2026-07-20", estimatedHours: 4, customerRate: 30, cleanerRate: 18, otherCosts: 10, note: "Draft only" })
  });
  const proposalBody = await validProposal.json();
  assert(validProposal.status === 201 && proposalBody.proposal.contribution === 38, "Valid draft proposal failed or calculated incorrectly.");

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

  await fetch(`${base}/api/admin/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(completeConfig) });
  const briefBlockedDrafts = await fetch(`${base}/api/admin/proposal-drafts?proposalId=${proposalBody.proposal.id}`);
  const briefBlockedDraftsBody = await briefBlockedDrafts.json();
  assert(briefBlockedDrafts.ok && briefBlockedDraftsBody.sendAllowed === false && briefBlockedDraftsBody.warnings.some((warning) => warning.includes("photo job brief")), "Unreviewed landlord brief did not block cleaner-draft use.");
  const unreviewedProposal = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: proposalBody.proposal.id, status: "ready" }) });
  assert(unreviewedProposal.status === 422, "Unreviewed landlord brief did not block proposal advancement.");
  const revisionWithoutNote = await fetch(`${base}/api/admin/job-briefs/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ briefId: briefBody.reference, status: "needs-revision" }) });
  assert(revisionWithoutNote.status === 422, "A revision request was accepted without guidance for the landlord.");
  const reviewedBrief = await fetch(`${base}/api/admin/job-briefs/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ briefId: briefBody.reference, status: "reviewed", note: "Checklist and private photo checked against the submitted scope." })
  });
  const reviewedBriefBody = await reviewedBrief.json();
  assert(reviewedBrief.ok && reviewedBriefBody.status === "reviewed", "Human brief approval was not recorded.");
  const reversedBriefReview = await fetch(`${base}/api/admin/job-briefs/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ briefId: briefBody.reference, status: "needs-revision", note: "Late change" }) });
  assert(reversedBriefReview.status === 422, "Reviewed brief history was overwritten instead of requiring a new submission.");
  const readyProposal = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: proposalBody.proposal.id, status: "ready" }) });
  assert(readyProposal.ok, "Ready proposal status failed after launch checks passed.");
  const skippedTransition = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: proposalBody.proposal.id, status: "accepted" }) });
  assert(skippedTransition.status === 422, "Proposal status skipped the sent step.");
  const sentProposal = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: proposalBody.proposal.id, status: "sent" }) });
  assert(sentProposal.ok, "Sent proposal status failed.");
  const acceptedProposal = await fetch(`${base}/api/admin/proposals/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: proposalBody.proposal.id, status: "accepted" }) });
  assert(acceptedProposal.ok, "Accepted proposal status failed.");

  const readyDrafts = await fetch(`${base}/api/admin/proposal-drafts?proposalId=${proposalBody.proposal.id}`);
  const readyDraftsBody = await readyDrafts.json();
  assert(readyDrafts.ok && readyDraftsBody.sendAllowed === true, "Ready proposal drafts were not available for review.");
  assert(readyDraftsBody.customer.body.includes("Test Customer") && readyDraftsBody.customer.body.includes("£120.00"), "Customer quote draft omitted required proposal details.");
  assert(readyDraftsBody.cleaner.body.includes("£72.00") && readyDraftsBody.cleaner.body.includes("None known") && readyDraftsBody.cleaner.body.includes("Tideway-reviewed cleaner checklist") && readyDraftsBody.cleaner.body.includes("Wipe every kitchen worktop") && readyDraftsBody.cleaner.body.includes("Photo references held privately: 1") && !readyDraftsBody.cleaner.body.includes("customer@example.com") && !readyDraftsBody.cleaner.body.includes("Test Customer") && !readyDraftsBody.cleaner.body.includes("base64"), "Cleaner draft omitted reviewed pay/photo checklist scope or leaked customer identity or image data.");

  const bookingAudit = await fetch(`${base}/api/admin/booking-audit?proposalId=${proposalBody.proposal.id}`);
  const bookingAuditBody = await bookingAudit.json();
  assert(bookingAudit.ok && bookingAuditBody.automatedReady === true && Object.values(bookingAuditBody.checks).every(Boolean), "Accepted proposal did not pass the automated booking audit.");
  assert(bookingAuditBody.manualChecklist.length >= 5, "Booking audit omitted required manual confirmations.");

  const quotedStatus = await fetch(`${base}/api/admin/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: requestBody.reference, kind: "request", status: "quoted" }) });
  assert(quotedStatus.ok, "Customer request could not move from contacted to quoted.");
  const incompleteBooking = await fetch(`${base}/api/admin/bookings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: proposalBody.proposal.id, addressAndAccessConfirmed: true }) });
  assert(incompleteBooking.status === 422, "Incomplete manual confirmations created a booking.");
  const confirmedBooking = await fetch(`${base}/api/admin/bookings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ proposalId: proposalBody.proposal.id, addressAndAccessConfirmed: true, finalChecklistConfirmed: true, paymentAuthorisationConfirmed: true, cleanerAcceptanceConfirmed: true, emergencyInstructionsConfirmed: true, internalNote: "Test confirmation only" })
  });
  const confirmedBookingBody = await confirmedBooking.json();
  assert(confirmedBooking.status === 201 && confirmedBookingBody.booking.id.startsWith("BKG-"), "Fully confirmed booking was not recorded.");

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
  assert(refreshedBody.records.find((record) => record.id === requestBody.reference)?.proposals?.[0]?.id.startsWith("PRO-"), "Draft proposal was not retained on the customer request.");
  assert(refreshedBody.records.find((record) => record.id === requestBody.reference)?.proposals?.[0]?.status === "accepted", "Proposal status progression was not retained.");
  assert(refreshedBody.records.find((record) => record.id === requestBody.reference)?.briefs?.[0]?.status === "reviewed", "Job-brief review status was not retained.");
  assert(refreshedBody.records.find((record) => record.id === requestBody.reference)?.booking?.id === confirmedBookingBody.booking.id, "Confirmed booking was not attached to the request.");
  assert(refreshedBody.records.find((record) => record.id === requestBody.reference)?.outcome?.contribution === 33, "Actual job outcome was not attached to the request.");

  console.log("Smoke tests passed: public pages, automatic concise speech bullets, photo-and-voice job briefs, human brief review gates, private images, admin security, pricing controls, matching, profitable proposals, booking confirmations and actual completed-job economics.");
} finally {
  if (child.exitCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await exited;
  }
  await rm(testDataDir, { recursive: true, force: true });
}
