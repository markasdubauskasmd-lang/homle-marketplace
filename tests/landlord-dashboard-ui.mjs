import { readFile } from "node:fs/promises";
import { landlordDispatchAction, landlordMarketplaceCapabilityState, landlordStartFromSearch, liveBookingForRequest, moneyToPence, optionalRequestScope, pricingRequestFromManualTasks, propertyCleaningBlocker, requestStatusLabel, requestTasksFromLines, requestedWindow, suggestedCleaningType, tasksToLines } from "../public/landlord-dashboard-model.js";
import "./landlord-request-draft.mjs";
import "./room-photo-selection.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function throws(operation, expected) {
  try { operation(); } catch (error) { return String(error.message).includes(expected); }
  return false;
}

const tasks = requestTasksFromLines("Kitchen: Wipe the worktops\nBathroom: Remove limescale");
assert(tasks.length === 2 && tasks[0].roomName === "Kitchen" && tasks[1].description === "Remove limescale" && tasksToLines(tasks) === "Kitchen: Wipe the worktops\nBathroom: Remove limescale", "Room-labelled draft tasks were not parsed and displayed losslessly.");
const manualPricingRequest = pricingRequestFromManualTasks(tasks, { cleaningType: "deep-cleans", frequency: "fortnightly" });
assert(manualPricingRequest.serviceType === "deep" && manualPricingRequest.frequency === "fortnightly" && manualPricingRequest.rooms.length === 2 && manualPricingRequest.rooms[0].roomType === "kitchen" && manualPricingRequest.rooms[1].items[0].code === "limescale", "Manual room tasks cannot enter the same server-authoritative pricing model as a scan.");
const naturalTasks = requestTasksFromLines("Wipe the worktops\nRemove limescale from the bathroom shower", { defaultRoomName: "Kitchen" });
assert(naturalTasks[0].roomName === "Kitchen" && naturalTasks[0].description === "Wipe the worktops" && naturalTasks[1].roomName === "Bathroom", "Natural task descriptions were not accepted or safely assigned an internal photo-room context.");
assert(throws(() => requestTasksFromLines("Wipe sink\nWipe sink", { defaultRoomName: "Kitchen" }), "unique") && throws(() => requestTasksFromLines("clean everything", { defaultRoomName: "Kitchen" }), "specific Cleaner action"), "Duplicate or vague request tasks were accepted.");
const emptyOptionalScope = optionalRequestScope("", { cleaningType: "regular-domestic" });
const noteOnlyScope = optionalRequestScope("test", { cleaningType: "workplaces", defaultRoomName: "Office" });
assert(emptyOptionalScope.tasks.length === 1 && emptyOptionalScope.supplementalNote === "" && noteOnlyScope.tasks[0].roomName === "Office" && noteOnlyScope.tasks[0].description.startsWith("Clean the agreed workplace") && noteOnlyScope.supplementalNote === "test", "Optional notes can still block a request or replace the safe service-level Cleaner brief.");
const now = new Date("2026-07-16T08:00:00.000Z");
const window = requestedWindow("2026-07-20", "10:00", 180, now);
assert(Date.parse(window.requestedEndAt) - Date.parse(window.requestedStartAt) === 180 * 60_000 && throws(() => requestedWindow("2026-07-15", "10:00", 180, now), "future"), "The draft request window lost its exact duration or accepted past work.");
assert(moneyToPence("125.50") === 12550 && moneyToPence("") === null && throws(() => moneyToPence("12.999"), "two decimal"), "Draft budget did not convert to exact integer pence or reject ambiguous decimals.");
assert(requestStatusLabel("draft").includes("scan not submitted") && requestStatusLabel("invented") === "Status unavailable", "Request status copy can imply unsupported progress.");
const blockerProperty = { propertyId: "44444444-4444-4444-8444-444444444444" };
const blockerRequest = { requestId: "66666666-6666-4666-8666-666666666666", propertyId: blockerProperty.propertyId, status: "searching-for-cleaner", requestedStartAt: "2099-08-20T09:00:00.000Z", requestedEndAt: "2099-08-20T11:00:00.000Z" };
const requestBlocker = propertyCleaningBlocker(blockerProperty, [blockerRequest], []);
const bookingBlocker = propertyCleaningBlocker(blockerProperty, [{ ...blockerRequest, status: "matched" }], [{ bookingId: "77777777-7777-4777-8777-777777777777", status: "confirmed", scheduledStartAt: blockerRequest.requestedStartAt, scheduledEndAt: blockerRequest.requestedEndAt }]);
assert(requestBlocker?.kind === "request" && requestBlocker.canWithdraw === true && bookingBlocker?.kind === "booking" && bookingBlocker.canWithdraw === false && bookingBlocker.canRequestCancellation === true && propertyCleaningBlocker(blockerProperty, [{ ...blockerRequest, status: "cancelled" }], []) === null, "Properties cannot distinguish a cancellable pre-booking request from an accepted booking or release the blocker after cancellation.");
assert(landlordStartFromSearch("?start=booking") === "booking" && landlordStartFromSearch("?start=booking&start=booking") === "" && landlordStartFromSearch("?start=https%3A%2F%2Fattacker.example") === "", "The account-to-booking handoff accepted an ambiguous or arbitrary dashboard action.");
assert(suggestedCleaningType("flat") === "regular-domestic" && suggestedCleaningType("office") === "workplaces" && suggestedCleaningType("communal") === "communal-areas" && suggestedCleaningType("other") === "", "Safe property-based cleaning-type suggestions are incomplete or guess for an unsupported property type.");
assert(landlordDispatchAction({ status: "searching-for-cleaner", automaticDispatch: { enabled: false, attemptCount: 0 } }).kind === "authorize" && landlordDispatchAction({ status: "searching-for-cleaner", automaticDispatch: { enabled: false, attemptCount: 0 } }).attemptLimit === 1, "A newly submitted unmatched request does not offer exactly one first Cleaner invitation.");
assert(landlordDispatchAction({ status: "searching-for-cleaner", automaticDispatch: { enabled: true, attemptCount: 0, attemptLimit: 1 } }).kind === "waiting" && landlordDispatchAction({ status: "searching-for-cleaner", automaticDispatch: { enabled: true, attemptCount: 1, attemptLimit: 1 } }).attemptLimit === 2, "An active authorization can be repeated or a used attempt cannot advance by exactly one.");
assert(landlordDispatchAction({ status: "searching-for-cleaner", automaticDispatch: { enabled: true, attemptCount: 5, attemptLimit: 5 } }).kind === "exhausted" && landlordDispatchAction({ status: "pending-cleaner-acceptance" }).kind === "none", "The one-at-a-time matching action exceeds its five-attempt boundary or appears during a Cleaner decision.");
const missingMedia = landlordMarketplaceCapabilityState({ mediaReady: false, pricingReady: true, geocodingReady: true });
const missingPricing = landlordMarketplaceCapabilityState({ mediaReady: true, pricingReady: false, geocodingReady: true });
const missingGeocoding = landlordMarketplaceCapabilityState({ mediaReady: true, pricingReady: true, geocodingReady: false });
const missingAutomaticDispatch = landlordMarketplaceCapabilityState({ mediaReady: true, pricingReady: true, geocodingReady: true, automaticDispatchReady: false });
const completeCapabilities = landlordMarketplaceCapabilityState({ mediaReady: true, pricingReady: true, geocodingReady: true, automaticDispatchReady: true });
assert(missingMedia.matchingReady === true && missingMedia.notice?.key === "private-media", "Missing private media did not preserve the separate matching capability while keeping scan submission unavailable.");
assert(missingPricing.matchingReady === false && missingPricing.notice?.key === "private-pricing", "Missing private pricing did not block Cleaner invitations with an exact explanation.");
assert(missingGeocoding.matchingReady === false && missingGeocoding.notice?.key === "postcode-geocoding" && missingGeocoding.notice.copy.includes("real distance"), "Missing postcode geocoding did not block distance-priced Cleaner invitations with an exact explanation.");
assert(missingAutomaticDispatch.matchingReady === true && missingAutomaticDispatch.automaticDispatchReady === false && missingAutomaticDispatch.notice?.key === "automatic-dispatch" && missingAutomaticDispatch.notice.copy.includes("no Cleaner will be contacted automatically"), "A missing background dispatcher was presented as working automatic matching or incorrectly disabled safe direct matching.");
assert(completeCapabilities.matchingReady === true && completeCapabilities.automaticDispatchReady === true && completeCapabilities.notice === null && Object.isFrozen(completeCapabilities), "Complete marketplace capabilities did not remove the activation warning or remain immutable.");

const [page, script, model, styles, designStyles, v2Styles, server, authEntry] = await Promise.all([
  readFile(new URL("../public/landlord-dashboard.html", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-dashboard.js", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-dashboard-model.js", import.meta.url), "utf8"),
  readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-dashboard.css", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-dashboard-v2.css", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8"),
  readFile(new URL("../public/auth-entry.js", import.meta.url), "utf8")
]);

assert(server.includes('"/landlord/dashboard": "landlord-dashboard.html"') && page.includes('data-landlord-workspace hidden') && page.includes('data-landlord-state'), "The Landlord route or fail-closed initial workspace is missing.");
assert(
  page.includes('class="ld-property-form-heading"') &&
  page.includes('class="ld-property-form-close"') &&
  page.includes('class="ld-property-required-fields"') &&
  page.includes('class="ld-property-form-actions"') &&
  page.includes("These details stay private until a booking is confirmed.") &&
  page.includes('placeholder="House number and street"') &&
  v2Styles.includes(".ld-property-form-actions") &&
  v2Styles.includes(".ld-property-required-fields"),
  "The Add place dialog lost the current dashboard hierarchy, private-address reassurance, modern field group, or responsive action bar."
);
assert([...page.matchAll(/data-wizard-step/g)].length === 5 && page.includes('data-pac-step-total>5</span>') && !page.includes('data-step-title="Walk through the rooms"') && !page.includes('data-step-title="Add room photos next"') && !page.includes("Review the concise bullets"), "Steps 1–4 were not preserved with one simplified final instructions-and-images step, or the removed review panels returned.");
assert([...page.matchAll(/data-landlord-private-navigation hidden/g)].length === 2 && script.includes('const privateNavigation = document.querySelectorAll("[data-landlord-private-navigation]")') && script.includes("for (const item of privateNavigation) item.hidden = true") && script.includes("for (const item of privateNavigation) item.hidden = false") && script.indexOf("for (const item of privateNavigation) item.hidden = false") > script.indexOf('dashboardWorkspaceAccess(account, "landlord")'), "Signed-out, loading or wrong-role visitors can see dead Landlord navigation before private workspace access is confirmed.");
assert(script.includes('requestJson("/api/marketplace/landlord/bootstrap")') && script.includes('const path = updating ? `/api/marketplace/properties/${encodeURIComponent(selectedPropertyId)}` : "/api/marketplace/properties"') && script.includes('requestJson("/api/marketplace/cleaning-requests", { method: "POST"') && script.includes('"X-CSRF-Token": csrf'), "The workspace is not bound to one authenticated Landlord bootstrap, owner mutations and CSRF-protected writes.");
assert(script.includes("requestResult.cleaningRequests") && script.includes("result.cleaningRequest?.requestId") && script.includes("showRequestContinuation(result.cleaningRequest, options)") && !script.includes("requestResult.requests") && !script.includes("result.request)") && !script.includes("result.request.requestId"), "The Landlord workspace does not consume the server's cleaning-request response contract consistently.");
assert(script.includes('method: "POST"') && script.includes('submit: false') && page.includes("Not sent for matching · private draft") && page.includes("data-save-request") && page.includes("data-continue-request") && script.includes('/submit`') && script.includes("scopeReviewed: true"), "The account workspace can silently submit a request, bypass deliberate reviewed submission, or hide the explicit optional-image and continue actions.");
assert(page.includes('data-step-title="Add instructions and images"') && page.includes('data-speech-toggle>Speak</button>') && script.includes("checklistFromTranscript") && script.includes('capture", "environment"') && script.includes("Choose existing photo") && script.includes("crypto.subtle.digest") && script.includes("credentials: \"omit\"") && script.includes('redirect: "error"') && script.includes('referrerPolicy: "no-referrer"'), "The simplified instructions step or the separate rear-camera/library, speech, checksum or isolated signed-upload handling was lost.");
assert(script.includes('"Photo note (optional)"') && !script.includes("note.required = true") && script.includes("See the confirmed room checklist for cleaning instructions."), "The account room scan still demands a duplicate photo description or leaves an optional note without Cleaner context.");
assert(script.includes("metadata removed") && script.includes("cleanerPreviewAuthorized") && script.includes("automaticDispatch") && script.includes("attemptLimit") && script.includes("No booking exists until") && server.includes("landlordDashboardPage") && server.includes("privateMediaPage"), "Room-photo privacy, explicit Cleaner preview/dispatch consent, bounded attempts, truthful booking copy or the route-specific media policy is missing.");
assert(script.includes('requestJson("/api/marketplace/auth/session"') && script.includes("saveCsrf(result.csrfToken)") && [...script.matchAll(/await recoverCsrf\(/g)].length >= 7, "A reopened mobile Landlord tab cannot recover its secure token for every profile, property, scan and request mutation.");
assert(page.includes("data-landlord-media-readiness") && page.includes("Room photos are optional") && script.includes('requestJson("/api/health"') && script.includes('healthResult.status === "fulfilled"') && script.includes("health?.marketplace?.mediaReady === true") && script.includes("Camera rehearsal: these visual previews are not uploaded or saved") && script.includes('upload.disabled = !mediaReady') && script.includes('if (!mediaReady) return showFeedback') && !script.includes("Room photos required before submission"), "The Landlord dashboard must isolate unavailable photo storage without blocking an image-free request.");
assert(page.includes("data-landlord-capability-title") && page.includes("data-landlord-capability-copy") && server.includes("matchingReady: marketplaceAttachment.matchingReady === true") && server.includes("geocodingReady: marketplaceAttachment.geocodingReady === true") && server.includes("automaticDispatchReady: inlineWorkerAttachment?.capabilities?.dispatch === true") && script.includes("health?.marketplace?.matchingReady === true") && script.includes("health?.marketplace?.geocodingReady === true") && script.includes("health?.marketplace?.automaticDispatchReady === true") && script.includes("landlordMarketplaceCapabilityState") && model.includes("const matchingReady = pricingReady && geocodingReady") && model.includes("const automaticDispatchReady = matchingReady && input.automaticDispatchReady === true") && model.includes("Private pricing and Cleaner matching are being connected") && model.includes("Postcode distance matching is being connected") && model.includes("Automatic Cleaner matching is temporarily paused") && model.includes("will not invite a Cleaner until property and service-area postcodes can be checked by real distance") && script.includes("preferred.disabled = !matchingReady") && script.includes("auto.disabled = !automaticDispatchReady") && script.includes("no Cleaner is contacted automatically"), "The Landlord dashboard can present unavailable pricing, postcode-distance evidence or a stopped background worker as working Cleaner matching.");
assert(script.includes("readinessRequestTimeoutMs = 5_000") && script.includes("readinessRecoveryDelaysMs = Object.freeze([2_000, 6_000])") && script.includes("function scheduleReadinessRecovery") && script.includes("if (automaticDispatchReady || attempt >= readinessRecoveryDelaysMs.length") && script.includes('applyMarketplaceReadiness(health, { repaint: true })') && script.includes("if (!capabilities.automaticDispatchReady) scheduleReadinessRecovery()") && !script.includes("setInterval("), "A truthful readiness read taken while Render workers are still waking can remain stale for the whole Landlord session or retry without a strict bound.");
assert(script.includes("textContent") && script.includes("replaceChildren") && !script.includes("innerHTML") && script.includes("beforeunload") && script.includes("window.confirm"), "Private account records can enter unsafe HTML or forms lack unsaved/destructive-change protection.");
assert(page.includes("data-request-recovery-status") && script.includes("restoreWorkingRequest()") && script.includes("requestForm.elements.scopeReviewed.checked = false"), "An interrupted mobile room walkthrough cannot recover safely or restores approval without review.");
assert([...script.matchAll(/new AbortController\(\)/g)].length >= 2 && script.includes("30_000") && script.includes("120_000") && script.includes("This action may have completed") && script.includes("refresh the dashboard to check before trying again") && script.includes("remaining selected photos are still here") && script.includes("window.clearTimeout(timer)") && script.includes("window.clearTimeout(uploadTimer)"), "Slow account or photo requests can leave the Landlord dashboard spinning or encourage an unsafe blind mutation retry.");
const photoDigestStart = script.indexOf("async function sha256(file)");
const photoDigestEnd = script.indexOf("function checkedUploadResponse", photoDigestStart);
const photoDigestFlow = script.slice(photoDigestStart, photoDigestEnd);
assert(photoDigestStart >= 0 && photoDigestEnd > photoDigestStart && photoDigestFlow.includes("Promise.race") && photoDigestFlow.includes("15_000") && photoDigestFlow.includes("This photo took too long to check securely") && photoDigestFlow.includes("It is still selected") && photoDigestFlow.includes("window.clearTimeout(timer)"), "A stalled mobile file read or integrity digest can leave the required room-photo upload locked without a safe retry message.");
assert(page.includes("data-landlord-network-status") && page.includes("Homle will not retry a change automatically") && script.includes("navigator.onLine === false") && script.includes('{ code: "browser-offline" }') && script.includes('error?.code === "browser-offline" ? error.message') && script.includes('window.addEventListener("offline", updateNetworkStatus)') && script.includes('window.addEventListener("online"') && script.includes('state.dataset.kind === "offline"') && script.includes("no change will be retried automatically") && styles.includes(".landlord-network-status[hidden]"), "A mobile Landlord is not warned immediately when offline, could lose selected scan work, or could have a mutation retried automatically after reconnecting.");
assert(script.includes("consumeRoomPhotoInputFiles(event.target)") && script.includes("validatedRoomPhotoSelection") && script.includes("libraryInput.multiple = true") && script.includes("while (files.length)") && script.includes("files.shift()") && script.includes("checked, sanitized and attached"), "The existing-photo path can erase a live mobile FileList, still requires one selection per image, or loses an unprocessed batch after a partial private-upload failure.");
assert(script.includes("refreshSubmissionAvailability") && script.includes('submit.type = selectedPhotoCount ? "button" : "submit"') && script.includes('"Submit cleaning request"') && script.includes("form.requestSubmit(upload)") && script.includes("renderScanPhotos(request.requestId, completed.scan, list, count);\n          refreshSubmissionAvailability();") && !script.includes("Upload and finish at least one current room photo before submission"), "The request cannot submit without a photo or cannot still upload a selected visual safely before submission.");
assert(page.includes("data-request-continuation") && script.includes("function openNewRequestPhotoDialog()") && script.includes("function showRequestContinuation(request, options = {})") && script.includes('element("dialog", "landlord-photo-dialog")') && script.includes("dialog.showModal()") && !script.includes("requestForm.hidden = true") && script.includes('element("button", "button", "Continue photos and matching")'), "Add images still replaces the main form instead of opening the focused in-page room-photo window.");
const dialogDismissalStart = script.indexOf("function enableRequestPhotoDialogDismissal");
const dialogDismissalEnd = script.indexOf("function showRequestContinuation", dialogDismissalStart);
const dialogDismissalFlow = script.slice(dialogDismissalStart, dialogDismissalEnd);
const dialogCloseStart = script.indexOf("function closeRequestPhotoDialog");
const dialogCloseEnd = script.indexOf("function enableRequestPhotoDialogDismissal", dialogCloseStart);
const dialogCloseFlow = script.slice(dialogCloseStart, dialogCloseEnd);
assert(dialogDismissalStart >= 0 && dialogDismissalEnd > dialogDismissalStart
  && dialogDismissalFlow.includes('dialog.addEventListener("cancel"')
  && dialogDismissalFlow.includes("event.preventDefault()")
  && dialogDismissalFlow.includes("event.target !== dialog")
  && dialogDismissalFlow.includes("dialog.getBoundingClientRect()")
  && dialogDismissalFlow.includes("closeRequestPhotoDialog()")
  && dialogCloseStart >= 0 && dialogCloseEnd > dialogCloseStart
  && !dialogCloseFlow.includes("requestForm.reset"),
"The optional image dialog cannot be dismissed by Escape/backdrop click, closes from inside clicks, or resets the Landlord's entered form data.");
assert(script.includes('element("div", "landlord-scan-selection-preview")') && script.includes("URL.createObjectURL(candidate.file)") && script.includes("URL.revokeObjectURL(url)") && script.includes('image.alt = `${candidate.name} selected for review`') && script.includes('element("button", "text-button", pendingPhotoCompletions.has(candidate) ? "Awaiting verification" : "Remove")') && script.includes("files = files.filter((item) => item !== candidate)") && styles.includes(".landlord-scan-selection-card"), "Selected room photos are not privately previewable and removable before upload, or temporary browser preview URLs can outlive the selection.");
assert(script.includes('summary", "", request.status === "draft" ? (mediaReady ? "Add room photos and submit" : "Test the room camera")') && script.includes("on this device only, not saved") && script.includes("Nothing was uploaded or saved") && script.includes("these previews will disappear when you leave") && script.includes('localMediaBoundary.hidden = mediaReady') && styles.includes(".landlord-local-media-boundary"), "The storage-disabled preview does not expose a real camera/video rehearsal or could mislead the Landlord that device-only visuals were saved.");
assert(script.includes('element("button", "button button-outline", "Record short room video")') && script.includes('videoInput.setAttribute("capture", "environment")') && script.includes("extractRoomVideoFrames(candidate") && script.includes("The raw video and audio stayed on this device") && script.includes("files = validatedRoomPhotoSelection(frames") && script.includes("videoProcessing") && script.includes("if (uploadPending || videoProcessing) return"), "The authenticated Landlord scan cannot turn one short rear-camera video into private room stills, exposes raw video/audio to storage, or can race video preparation with photo upload.");
assert(page.includes('name="accessInstructions"') && page.includes("kept protected") && page.includes('name="savedChecklist"') && !page.includes('name="requiredServices"') && page.includes('name="budget"') && script.includes("const requiredServices = [cleaningType]"), "The simplified property/request form lost protected optional details or still asks for the same service twice.");
const photoUploadStart = script.indexOf('form.addEventListener("submit"', script.indexOf('const upload = element("button", "button", "Upload private room photos")'));
const photoUploadEnd = script.indexOf("panel.append(form)", photoUploadStart);
const photoUploadFlow = script.slice(photoUploadStart, photoUploadEnd);
assert(photoUploadStart >= 0 && photoUploadEnd > photoUploadStart && photoUploadFlow.includes("if (uploadPending || videoProcessing) return") && photoUploadFlow.indexOf("uploadPending = true") < photoUploadFlow.indexOf('await recoverCsrf(feedback, "uploading this room photo")') && photoUploadFlow.indexOf("setPending(upload, true") < photoUploadFlow.indexOf('await recoverCsrf(feedback, "uploading this room photo")') && photoUploadFlow.includes("uploadPending = false"), "A fast second tap can start two private room-photo upload loops while secure-session recovery is running, video extraction can race an upload, or failed recovery leaves the upload action locked.");

// One clean, one draft. Every "save this draft" control — Continue, Add images
// and the photo dialog's own two buttons — reaches createRequestDraft, and the
// lock used to be taken after recoverCsrf, which makes a real round trip on a
// reopened tab. A second tap in that window created a second draft, and the
// continuation panel then pointed at it while the first was orphaned. Same
// ordering the room-photo, submit and authorize flows above are pinned to.
const draftStart = script.indexOf("async function createRequestDraft");
const draftEnd = script.indexOf("function setPending(", draftStart);
const draftFlow = script.slice(draftStart, draftEnd);
assert(draftStart >= 0 && draftEnd > draftStart
  && draftFlow.includes("if (requestDraftPending) return false")
  && draftFlow.indexOf("requestDraftPending = true") < draftFlow.indexOf('await recoverCsrf(operationFeedback, "saving this cleaning-request draft")')
  && draftFlow.indexOf("setRequestDraftControlsLocked(true)") < draftFlow.indexOf('await recoverCsrf(operationFeedback, "saving this cleaning-request draft")')
  && draftFlow.indexOf("setPending(triggerButton, true") < draftFlow.indexOf('await recoverCsrf(operationFeedback, "saving this cleaning-request draft")')
  && draftFlow.includes("requestDraftPending = false")
  && draftFlow.includes("setRequestDraftControlsLocked(false)"),
  "A fast second tap, or a sibling control, can create two cleaning-request drafts for one clean while secure-session recovery is running.");

assert(script.includes("const pendingPhotoCompletions = new WeakMap()") && photoUploadFlow.includes("let uploadId = pendingPhotoCompletions.get(candidate)") && photoUploadFlow.includes("if (!uploadId)") && photoUploadFlow.indexOf("pendingPhotoCompletions.set(candidate, uploadId)") < photoUploadFlow.indexOf("Securing photo") && photoUploadFlow.includes("encodeURIComponent(uploadId)") && photoUploadFlow.includes("pendingPhotoCompletions.delete(candidate)") && script.includes("securely uploaded, awaiting verification") && photoUploadFlow.includes("renderSelection()"), "An uncertain private-photo completion can be retried as a new upload instead of verifying the same server-owned upload ID, consuming the request photo allowance or duplicating media.");
assert(photoUploadFlow.includes("Uploading photo") && photoUploadFlow.includes("Securing photo") && photoUploadFlow.includes("Removing metadata and securing photo") && photoUploadFlow.includes("2_000") && photoUploadFlow.includes("window.clearTimeout(verificationHintTimer)"), "A large room photo can appear frozen instead of showing its upload and server-sanitization phases, or its delayed progress timer can outlive completion.");
assert(script.includes("function setUploadEditorLocked(locked)") && script.includes("[room, note, cameraButton, libraryButton, videoButton, cameraInput, libraryInput, videoInput]") && script.includes('if (uploadPending || videoProcessing) { event.target.value = ""; return; }') && photoUploadFlow.indexOf("setUploadEditorLocked(true)") < photoUploadFlow.indexOf('await recoverCsrf(feedback, "uploading this room photo")') && photoUploadFlow.includes("setUploadEditorLocked(false)"), "The Landlord can replace the selected photo/video queue or alter its frozen room/note while media preparation or authenticated upload is running, causing the wrong pending file to be removed or labelled.");
assert(page.includes("data-property-form-title") && page.includes("data-property-status") && script.includes("function openPropertyEditor(property = null)") && script.includes("populatePropertyForm(property)") && script.includes('propertyForm.elements.accessInstructions.value = property?.accessInstructions || ""') && script.includes('method: updating ? "PUT" : "POST"') && script.includes("Protected access and property details updated.") && script.includes("Add access details") && script.includes("Edit access and details"), "A Landlord cannot reopen a saved property and update protected job-day access details through the existing owner API.");
assert(page.includes("data-property-dialog") && page.includes('aria-labelledby="property-form-dialog-title"') && script.includes("propertyDialog.showModal()") && script.includes('propertyDialog?.addEventListener("cancel"') && script.includes('propertyDialog?.addEventListener("click"') && script.includes("event.target !== propertyDialog") && script.includes("propertyDialog.getBoundingClientRect()") && script.includes("closePropertyEditor()") && v2Styles.includes(".ld-property-dialog::backdrop") && v2Styles.includes(".ld-property-dialog[open]"), "Add place is not a focused responsive dialog, or Escape/backdrop dismissal bypasses its unsaved-change protection.");
assert(script.includes('requestBuilderDialog?.addEventListener("click"') && script.includes("event.target !== requestBuilderDialog") && script.includes("requestBuilderDialog.getBoundingClientRect()") && script.includes("setRequestBuilderExpanded(false)"), "The manual-request sheet cannot be dismissed by clicking its grey backdrop while preserving the in-progress form.");
assert(page.includes("data-property-archive-dialog") && page.includes("Delete property") && page.includes("Completed and cancelled booking history will remain") && script.includes("function openPropertyArchive(property)") && script.includes("propertyCleaningBlocker(property, requests, bookings)") && script.includes("View cleaning request") && script.includes("Cancel cleaning request") && script.includes("Request cancellation") && script.includes("renderPropertyBlocker(property, blocker)") && script.includes('`/api/marketplace/properties/${encodeURIComponent(archivingPropertyId)}/archive`') && script.includes('method: "POST"') && script.includes("Completed and cancelled booking history is unchanged") && script.includes("properties = properties.filter((item) => item.propertyId !== archivingPropertyId)") && designStyles.includes(".landlord-property-work") && designStyles.includes(".landlord-property-archive"), "A blocked property does not show its exact cleaning work and immediate safe cancellation action, or an unused property cannot be removed without implying booking history is erased.");
assert(page.includes("data-archived-properties") && page.includes("Archived locations stay out of new cleaning requests") && script.includes('requestJson("/api/marketplace/landlord/bootstrap")') && script.includes('!unavailable.has("archivedProperties")') && script.includes("function renderArchivedProperties()") && script.includes("async function restoreProperty(property)") && script.includes('`/api/marketplace/properties/${encodeURIComponent(property.propertyId)}/restore`') && script.includes("properties.push(activeProperty)") && script.includes("restored and available for new cleaning requests") && designStyles.includes(".landlord-archived-properties"), "Archived properties have no private collapsed recovery list, or restoration does not return the owner property to active selection.");
assert(script.includes("let propertyDirty = false") && script.includes("let requestDirty = false") && script.includes("let landlordProfileDirty = false") && script.includes("propertyDirty || requestDirty || landlordProfileDirty") && script.includes("Close and discard these unsaved property changes?"), "Profile or property editing can silently discard its own or the room-scan form's unsaved work.");
assert(page.includes('data-landlord-panel="account"') && page.includes('data-landlord-profile-form') && page.includes('data-open-landlord-section="account"') && page.includes("They are not shown to Cleaners as personal contact information") && script.includes('requestJson("/api/marketplace/landlord/bootstrap")') && script.includes('requestJson("/api/marketplace/landlord/profile", { method: "PUT"') && script.includes("Landlord account details saved privately") && styles.includes(".landlord-profile-form"), "The separate Landlord dashboard does not provide a complete private profile handoff.");
// Properties is no longer a desktop destination. The reviewed mobile bar keeps
// Places, and the account menu links to the same Your places section inside the
// Bookings hub. The old URL still resolves, but it also lands on that section.
// One Places entry, not two: the mobile tab bar keeps its Places tab, which the
// design requires, while the account menu no longer repeats it. That menu entry
// and "Cleaning preferences" both resolved to the same view already reachable
// from the sidebar and the tab bar. Two Bookings entries — sidebar and tab bar;
// the third lived on Home's Upcoming card, which the Home + Care design removed.
assert([...page.matchAll(/data-open-landlord-section="bookings"/g)].length === 2 && [...page.matchAll(/data-open-landlord-section="places"/g)].length === 1 && !page.includes('data-open-landlord-section="properties"') && page.includes('href="/landlord/bookings"') && page.includes('href="/landlord/account"') && script.includes('document.querySelectorAll("[data-open-landlord-section]")') && script.includes("event.preventDefault()") && script.includes('historyMode: "push"') && script.includes('link.closest("[data-account-menu]")'), "Landlord header or account-menu links can target a hidden panel instead of activating the correct persistent hub section.");
assert(script.includes('/^#landlord-(properties|requests|account|bookings)$/') && !script.includes("clearLegacyRequestHash") && page.includes('data-open-request-tab') && page.includes('data-landlord-panel="requests"'), "The 'Manual request' builder is not reachable from the main dashboard actions, or a saved #landlord-requests link is stripped on load.");
assert(page.includes("Favourite Cleaners") && page.includes("data-landlord-favourite-cleaners") && page.includes("Your saved Cleaner relationships appear here") && script.includes('requestJson("/api/marketplace/landlord/favourite-cleaners", { timeoutMs: optionalDashboardRequestTimeoutMs })') && script.includes("void refreshFavouriteCleaners()") && !script.includes("await refreshFavouriteCleaners();") && script.includes('/api/marketplace/landlord/favourite-cleaners/${encodeURIComponent(cleanerId)}') && script.includes('saveSelectedCleaner(localStorage, cleaner.cleanerId)') && script.includes('location.assign("/landlord/dashboard?start=booking")') && script.includes("No removal will be retried automatically") && script.includes("refreshFavouriteCleaners({ quiet: true })") && styles.includes(".landlord-favourite-cleaner"), "The Landlord dashboard cannot list, remove or start a request from private favourite Cleaners with safe mutation recovery, or its optional read can hold primary workspace startup busy.");
const workspaceLoadStart = script.indexOf("async function loadWorkspace()");
const workspaceLoadEnd = script.indexOf('loadRetry.addEventListener("click", loadWorkspace)', workspaceLoadStart);
const workspaceLoadFlow = script.slice(workspaceLoadStart, workspaceLoadEnd);
assert(workspaceLoadStart >= 0 && workspaceLoadEnd > workspaceLoadStart
  && workspaceLoadFlow.includes('requestJson("/api/marketplace/landlord/bootstrap")')
  && workspaceLoadFlow.includes('requestJson("/api/health", { credentials: "omit"')
  && workspaceLoadFlow.includes("Promise.allSettled")
  && workspaceLoadFlow.includes('dashboardWorkspaceAccess(account, "landlord")')
  && workspaceLoadFlow.indexOf("renderAccountAvatar(account)") < workspaceLoadFlow.indexOf('if (!unavailable.has("properties"))')
  && !workspaceLoadFlow.includes('requestJson("/api/marketplace/account")')
  && !workspaceLoadFlow.includes('requestJson("/api/marketplace/landlord/profile")')
  && !workspaceLoadFlow.includes('requestJson("/api/marketplace/properties")')
  && !workspaceLoadFlow.includes('requestJson("/api/marketplace/cleaning-requests")')
  && !workspaceLoadFlow.includes("favourite-cleaners"),
"Landlord startup can again multiply one expired session into competing private reads, reveal owner data before the role check, or pull optional Saved Cleaners into primary startup.");
assert(script.includes("const safeReadWakeRetryDelayMs = 1_000")
  && script.includes("const maximumAttempts = mutation ? 1 : 2")
  && script.includes("response.status === 503 && attempt + 1 < maximumAttempts")
  && script.includes("Homle is still waking up.")
  && script.includes("Your account and data are safe. Wait a moment, then try again; no property or request was changed."),
"A sleeping Landlord service can still strand a safe read on its first 503, retry a write, or falsely claim that the live marketplace is not connected.");
assert(script.includes('element("button", "button", "Book again")') && script.includes("saveSelectedProperty(sessionStorage, cleaner.propertyId)") && script.includes("readSelectedProperty(sessionStorage)") && script.includes("clearSelectedProperty(sessionStorage)") && script.includes("properties.some((property) => property.propertyId === selectedPropertyId)") && script.includes("applySuggestedCleaningType()"), "A completed visit cannot preselect the same owner-verified property and Cleaner without bypassing the fresh room-review journey.");
assert(page.includes("data-request-withdraw-dialog") && page.includes("This cannot cancel a confirmed booking or change a payment") && page.includes('name="reasonCode" required') && page.includes("data-request-status") && script.includes('request.status === "searching-for-cleaner"') && script.includes('element("button", "text-button", "Withdraw request")') && script.includes('function openRequestWithdrawal(requestId, propertyId = "")') && script.includes("async function withdrawRequest(event)") && script.includes('/withdraw`') && script.includes("reasonCode: requestWithdrawForm.elements.reasonCode.value") && script.includes("matching is closed and no booking or payment was changed") && script.includes("if (withdrawalPending) event.preventDefault()"), "A Landlord cannot deliberately withdraw an eligible pre-booking request with clear status, safe pending-state behavior and truthful money/booking boundaries.");
assert(script.includes('const visibleRequests = requests.filter((request) => request.status !== "cancelled"') && script.includes("for (const request of visibleRequests)") && script.includes('const draftCount = visibleRequests.filter((request) => request.status === "draft").length') && script.includes("requestList.hidden = draftCount === 0") && script.includes("activeRequestList.hidden = submittedCount === 0"), "Cancelled cleaning requests remain visible in the active Landlord workspace after withdrawal or refresh, or submitted requests are not separated from private drafts.");
// A matched request has become a booking, and the Happening now card renders
// that booking from its real status. Keeping the request card too put the same
// clean on screen twice under two rails that disagreed — the request rail is
// hardcoded to "Matching in progress", so a booking already On the way sat
// beneath a card insisting a Cleaner was still being found.
//
// Asserted against the join itself rather than the filter's source text. A
// Landlord's booking summary carries no request id — list_my_booking_summaries
// returns bookingId, status, schedule and price and nothing that names the
// request — so an earlier version of this fix read booking.requestId, matched
// nothing, and left both cards on screen while every source-text assertion
// passed. These fixtures carry exactly what the endpoint really returns.
const matchedRequest = { requestId: "88888888-8888-4888-8888-888888888888", propertyId: blockerProperty.propertyId, status: "matched", requestedStartAt: "2099-09-14T09:00:00.000Z", requestedEndAt: "2099-09-14T12:00:00.000Z" };
const matchedBooking = { bookingId: "99999999-9999-4999-8999-999999999999", status: "cleaner-en-route", scheduledStartAt: matchedRequest.requestedStartAt, scheduledEndAt: matchedRequest.requestedEndAt };
assert(liveBookingForRequest(matchedRequest, [matchedBooking])?.bookingId === matchedBooking.bookingId,
  "A booking is not recognised as its request's own without a request id on the summary, so one clean renders twice under contradictory progress rails.");
assert(liveBookingForRequest(matchedRequest, [{ ...matchedBooking, scheduledStartAt: "2099-09-15T09:00:00.000Z" }]) === null
  && liveBookingForRequest({ ...matchedRequest, requestedStartAt: "", requestedEndAt: "" }, [{ ...matchedBooking, scheduledStartAt: "", scheduledEndAt: "" }]) === null,
  "An unrelated booking, or a pair with no readable window, is treated as the request's own booking and silently hides a live request.");
assert(liveBookingForRequest(matchedRequest, [{ ...matchedBooking, status: "cancelled" }]) === null
  && liveBookingForRequest(matchedRequest, [{ bookingId: matchedBooking.bookingId, status: "confirmed", cleaningRequestId: matchedRequest.requestId }])?.bookingId === matchedBooking.bookingId,
  "A cancelled booking still suppresses its request, or an explicit cleaningRequestId is ignored where the surface does carry one.");
assert(script.includes('!(request.status === "matched" && liveBookingForRequest(request, bookings))'),
  "The request list no longer stands down once the booking owns the clean, so one clean appears twice with contradictory progress rails.");
// A request still being prepared is not upcoming work: it has no Cleaner, no
// frozen price and no booking behind it. It is listed under Your places,
// against the place it is for, and Upcoming counts confirmed bookings only.
assert(page.indexOf("data-request-list") > page.indexOf('id="landlord-panel-properties"') && page.indexOf("data-request-list") < page.indexOf('id="landlord-panel-account"') && script.includes("function updateUpcomingRevealCount()") && script.includes("String(bookingCount)") && script.includes('element("button", "button", "Continue photos and matching")') && script.includes("showRequestContinuation(request)"), "A saved request lost its record under Your places, or cannot reopen that draft inside the same builder continuation.");
assert(page.indexOf("data-active-request-list") > page.indexOf("data-hub-now-label") && page.indexOf("data-active-request-list") < page.indexOf("data-ld-next") && script.includes('request.status === "searching-for-cleaner" ? "Finding your cleaner"') && script.includes('[["Booked", "done"], ["Matching", "current"], ["On the way", "future"], ["Cleaning", "future"], ["Complete", "future"]]') && v2Styles.includes(".ld-request-now-stages"), "A submitted cleaning request is not rendered in the reviewed Happening now design with its real matching progress.");
assert(authEntry.includes("accountWorkspaceDestination(account, accountIntent, workspaceReady)") && authEntry.includes("openSignedInWorkspace"), "Email or social sign-in cannot hand an established account into its verified staging completion or guided booking journey.");
assert(authEntry.includes('accountIntent === "book" ? selectedCleanerFromSearch(location.search) : ""') && authEntry.includes("saveSelectedCleaner(localStorage, selectedCleaner)") && script.includes("if (bookingStart) selectedCleanerId = readSelectedCleaner(localStorage)") && page.includes("data-landlord-selected-cleaner") && page.includes("Use best match instead") && script.includes('requestJson(`/api/marketplace/cleaners/${encodeURIComponent(selectedCleanerId)}`)') && script.includes("result.cleaner.cleanerId !== selectedCleanerId") && script.includes("selectedCleanerReady") && script.includes("Invite ${selectedCleanerProfile.displayName} first") && script.includes('/invitation-quote`') && script.includes('/invitations`') && script.includes("approvedCustomerPricePence: selectedCleanerPricePence") && script.includes("Number(invited.booking?.customerPricePence) !== selectedCleanerPricePence") && script.includes("selectedCleanerInvited") && script.includes("clearSelectedCleanerChoice()") && page.includes("data-invitation-quote-dialog") && page.includes("Your exact booking total") && page.includes("No payment is taken now") && styles.includes(".landlord-selected-cleaner-avatar") && styles.includes(".landlord-invitation-quote-total"), "A Cleaner selected in public search is not preserved, independently verified, shown with an exact server quote or deliberately invited only after the Landlord approves that total.");
assert(page.includes("data-match-outcome-dialog") && page.includes("No Cleaner is free at this time") && page.includes("data-match-outcome-result") && page.includes("data-match-outcome-timing") && page.includes("data-match-outcome-date") && page.includes("data-match-outcome-start") && page.includes("data-match-outcome-duration") && page.includes("Update time and check again") && page.includes("No duplicate request is created") && !page.includes("data-match-outcome-builder-mount") && script.includes("function showNoEligibleCleanerOutcome(requestId)") && script.includes("function prepareAnotherTime(requestId)") && script.includes("async function continueAnotherTime(requestId)") && script.includes('showMatchOutcomeStep("timing")') && script.includes('showMatchOutcomeStep("result")') && script.includes("/reschedule`") && script.includes("await refreshBookingTransition()") && script.includes("await inviteBestEligibleCleaner(requestId") && !script.includes("matchOutcomeBuilderMount.append(requestBuilderPanel)") && !script.includes('element("a", "button button-outline", "Open Stripe test checkout")') && v2Styles.includes(".landlord-match-outcome-timing-fields") && !v2Styles.includes(".landlord-match-outcome-dialog.is-builder-sequence"), "A no-match result still duplicates its request instead of securely rescheduling and rechecking the same open request in one guided sequence.");
assert(script.includes("landlordStartFromSearch(location.search)") && script.includes("continueBookingStart()") && script.includes('selectWorkspaceTab("properties")') && script.includes('selectWorkspaceTab("requests")') && script.includes("propertyForm.hidden = false") && script.includes("propertySelect.value = result.property.propertyId"), "A new account does not continue directly into property setup or a returning Landlord into the request form.");
assert(script.includes("function openRequestScan(requestId)") && script.includes("details.dataset.requestScanId = request.requestId") && script.includes("scan.open = true") && script.includes('scan.querySelector(\'select[name="roomName"]\')') && script.includes("showRequestContinuation(result.cleaningRequest, options)"), "Saving a private request draft does not continue directly into the required room scan modal.");
assert(page.includes("data-request-complete hidden") && page.includes("Thank you. Your cleaning request is ready for matching.") && page.includes("Stripe checkout opens") && page.includes("After a Cleaner accepts the exact total") && page.includes("data-request-complete-reference") && page.includes("data-request-complete-quote") && page.includes("data-request-complete-price") && page.includes("data-request-complete-duration") && page.includes("data-request-complete-next") && page.includes("data-request-complete-another"), "A submitted account room scan does not have a dedicated, truthful private completion state or explain when secure Stripe checkout opens.");
assert(page.includes("Cleaning request submitted") && script.includes("requestBuilderDialog.append(requestComplete)") && script.includes('requestBuilderDialog?.classList.add("is-completion-sequence")') && script.includes("if (requestBuilderDialog && !requestBuilderDialog.open) requestBuilderDialog.showModal()") && !script.includes('history.replaceState(null, "", "/landlord/dashboard")') && v2Styles.includes(".ld-builder-dialog .landlord-request-complete"), "Submission still replaces the Landlord dashboard instead of becoming the final step inside the same manual-request dialog.");
assert(page.includes("data-request-complete-sandbox") && page.includes("Test Stripe payment now (&pound;0.30)") && page.includes("opens Stripe immediately in test mode") && page.includes("does not confirm this cleaning booking") && page.includes("data-request-complete-sandbox-unavailable") && page.includes("No payment was attempted") && page.indexOf("data-request-complete-quote-note") < page.indexOf("data-request-complete-sandbox") && page.indexOf("data-request-complete-sandbox") < page.indexOf('class="completion-next"'), "The submitted request screen does not place the authenticated Stripe test state directly after the price or distinguish it from a real accepted booking.");
assert(script.includes("function authorizeNextCleaner(requestId, attemptLimit") && script.includes('body: JSON.stringify({ enabled: true, attemptLimit, approvedMaximumPricePence })') && script.includes("approveAutomaticDispatchPrice(approvedMaximumPricePence, attemptLimit)") && script.includes("This request has no approved maximum total") && script.includes("exactly one additional invitation") && script.includes("No booking or payment exists") && script.includes("uncertainDispatchRequests.add(requestId)") && script.includes("Refresh matching status") && page.includes("data-dispatch-price-dialog") && page.includes("Maximum total for this clean") && styles.includes(".landlord-dispatch-action"), "A returning unmatched Landlord can authorize matching without approving the saved maximum, or an uncertain mobile result can be repeated blindly.");
const matchingAuthorizationStart = script.indexOf("async function authorizeNextCleaner");
const matchingAuthorizationEnd = script.indexOf("async function refreshDispatchAuthorization", matchingAuthorizationStart);
const matchingAuthorizationFlow = script.slice(matchingAuthorizationStart, matchingAuthorizationEnd);
assert(matchingAuthorizationStart >= 0 && matchingAuthorizationEnd > matchingAuthorizationStart && matchingAuthorizationFlow.indexOf('setPending(button, true, "Authorising…")') < matchingAuthorizationFlow.indexOf('await recoverCsrf(feedback, "authorising Cleaner matching")') && matchingAuthorizationFlow.includes('setPending(button, false, attemptLimit === 1 ? "Find my Cleaner" : "Try one more Cleaner")'), "A fast second tap can start a competing matching authorization while secure-session recovery is still running, or a failed recovery leaves the action locked.");
assert(script.includes("dataset.dispatchRequestId") && script.includes("This authorises exactly one additional invitation") && script.includes("function inviteBestEligibleCleaner") && script.includes('requestId)}/matches`') && script.includes('requestId)}/invitation-quote`') && script.includes('requestId)}/invitations`') && script.includes("approveInvitationQuote(quoted.quote, candidate.displayName)") && script.includes("Stripe checkout opens after they accept the exact total") && script.includes("authorize.disabled = !matchingReady"), "A submitted request without a matching limit cannot safely choose the best eligible Cleaner, approve one exact price and progress toward Stripe checkout.");
assert(script.includes("function showRequestCompletion(submission") && script.includes("submission?.cleaningRequestId") && script.includes("submission?.photoCount") && script.includes("submission?.taskCount") && script.includes("submission?.quotedTotalPence") && script.includes("submission?.quotedMinutes") && script.includes("formatQuotedDuration") && script.includes("renderCompletionQuote({ quotedTotalPence") && script.includes("result.submission?.quotedTotalPence ?? request.quotedTotalPence") && script.includes("result.submission?.quotedMinutes ?? request.quotedMinutes") && script.includes("requestCompleteSandbox.hidden = !paymentsReady") && script.includes("requestCompleteSandboxUnavailable.hidden = paymentsReady") && script.includes("requestBuilderPanel.hidden = true") && script.includes("showRequestCompletion(submission, { automaticDispatch: auto.checked, automaticMaximumPricePence, selectedCleanerInvited, selectedCleanerPricePence })") && script.includes("could not verify automatic invitation authorisation") && script.includes("will not repeat an invitation automatically") && script.includes('document.querySelector("[data-request-complete-another]")') && script.includes('requestCompleteNext.addEventListener("click"') && script.includes("card.dataset.cleaningRequestId === completedRequestId"), "The private completion state cannot show the submitted reference/scope/server-returned price and duration inside the booking modal, truthfully gate test Stripe, open the exact saved request action, clear the booking-start action or recover safely from an uncertain invitation or dispatch response.");
assert(script.includes("pricingRequest: pricingRequestFromManualTasks(tasks, { cleaningType, frequency })") && script.includes("paymentsReady = health?.marketplace?.paymentsReady === true") && script.includes("requestCompleteSandbox.hidden = !paymentsReady") && page.includes('href="/stripe-sandbox?start=1"'), "Manual requests can still be created without a frozen server quote or lose the fail-closed Stripe test capability gate.");
assert(script.includes("async function recoverCompletionQuote(requestId)") && script.includes('requestJson("/api/marketplace/pricing/quote"') && script.includes("pricingRequestFromManualTasks(source.tasks") && script.includes("Current price estimate") && script.includes("Choose a Cleaner to freeze the final total"), "A request created by the previously deployed unpriced manual flow cannot recover a current estimate on completion.");
assert(page.includes("data-manual-quote") && page.includes("data-manual-quote-price") && page.includes("data-manual-quote-duration") && page.includes("data-manual-quote-status") && script.includes("function scheduleManualQuote()") && script.includes("currentManualPricingRequest()") && script.includes('requestJson("/api/marketplace/pricing/quote"') && script.includes('"X-CSRF-Token": csrf') && script.includes("generation !== manualQuoteGeneration") && script.includes("result.quote?.priceable !== true") && script.includes("formatBookingMoney(totalPence)") && script.includes("formatQuotedDuration(result.quote?.estimatedMinutes)"), "The manual request basket cannot show a current authenticated server price and duration safely before submission.");
assert(script.includes("function selectedCleanerInvitationRecovery(error)") && script.includes('error?.code === "cleaner-payout-not-ready"') && script.includes("selected Cleaner is not currently ready to receive this paid booking") && script.includes("No invitation or payment was created") && script.includes("use the best eligible match instead") && script.includes("selectedCleanerInvitationRecovery(error)"), "A payout-unready directly selected Cleaner leaves the Landlord with a technical failure instead of one safe matching recovery after the request is saved.");
const requestSubmissionStart = script.indexOf('submitForm.addEventListener("submit"');
const requestSubmissionEnd = script.indexOf("panel.append(submitForm)", requestSubmissionStart);
const requestSubmissionFlow = script.slice(requestSubmissionStart, requestSubmissionEnd);
assert(requestSubmissionStart >= 0 && requestSubmissionEnd > requestSubmissionStart && requestSubmissionFlow.indexOf('setPending(submit, true, "Submitting reviewed scan…")') < requestSubmissionFlow.indexOf('await recoverCsrf(feedback, "submitting this cleaning request")') && requestSubmissionFlow.includes('setPending(submit, false, "Submit cleaning request")'), "A fast second tap can start a competing room-scan submission or invitation chain while secure-session recovery is running, or failed recovery leaves the submit action locked.");
assert(page.includes('name="tasks" rows="8" maxlength="5000"') && !page.includes('name="tasks" rows="8" required') && page.includes('data-speech-toggle>Speak</button>') && page.includes('data-save-request') && page.includes('data-continue-request') && page.includes("Images and notes are optional") && page.includes("data-task-preview") && script.includes("function renderTaskPreview()") && script.includes("function invalidateScopeReview(message)") && script.includes('requestForm.elements.transcript.addEventListener("input"') && script.includes('requestForm.elements.tasks.addEventListener("input"') && script.includes("summariseSpeech({ automatic: true })") && script.includes("Concise room tasks were updated automatically"), "The final request step still forces notes/images or speech no longer updates the optional instruction box safely.");
assert(script.includes("function scheduleLiveSummarise()") && script.includes("if (tasksManuallyEdited) return;") && script.includes("summariseSpeech({ automatic: true, live: true })") && script.includes("tasksManuallyEdited = true;") && script.includes("updating as you go") && [...script.matchAll(/scheduleLiveSummarise\(\)/g)].length >= 2, "Speech does not build concise bullets in the single instruction box after a short pause, or a live pass can overwrite manual edits.");
assert(page.includes("data-scan-property-status") && !script.includes('requestForm.querySelector("[data-request-controls]").disabled = properties.length === 0') && !script.includes("function beginRoomWalkthrough()") && script.includes('document.querySelectorAll("[data-open-request-tab]").forEach') && script.includes('selectWorkspaceTab("requests", { historyMode: "push" })') && script.includes("event.preventDefault()") && page.includes("data-speech-toggle"), "Opening the in-place Prepare-a-clean builder must expand the request form without navigating away or auto-starting the microphone; voice stays behind the explicit Start speaking control.");
const speechErrorStart = script.indexOf("recognition.onerror =");
const speechErrorEnd = script.indexOf("recognition.onresult =", speechErrorStart);
const speechErrorFlow = script.slice(speechErrorStart, speechErrorEnd);
assert(speechErrorStart >= 0 && speechErrorEnd > speechErrorStart && speechErrorFlow.includes("speechChangedDuringListen") && speechErrorFlow.includes("summariseSpeech({ automatic: true })") && speechErrorFlow.includes("Captured room notes were preserved and concise tasks were updated automatically") && speechErrorFlow.indexOf("speechFailed = true") < speechErrorFlow.indexOf("summariseSpeech({ automatic: true })"), "A recognition failure can preserve final Landlord speech without updating the concise Cleaner checklist, or a later end event can summarise it twice.");
assert(page.includes("data-task-review-status") && /name="scopeReviewed"[^>]+disabled/.test(page) && script.includes("optionalRequestScope(lines.join") && script.includes("confirmation.disabled = false") && script.includes("confirmation.disabled = true") && script.includes("scopeConfirmation.checked = true") && script.includes("reviewedTasks.length") && script.includes("roomCount") && model.includes("inferredTaskRoom") && model.includes("supplementalNote") && !model.includes("must start with a room"), "Optional notes can block the final action, require an artificial room prefix, or fail to preserve a safe Cleaner brief.");
// Bookings is now a served route rather than an in-page anchor, so it is
// bookmarkable and survives a refresh — the same reason Properties, Requests and
// Account stopped being #fragments. The section keeps its id either way.
assert(!page.includes("data-landlord-next") && !script.includes("function renderNextAction()") && /href="\/landlord\/bookings"[^>]*>/.test(page) && page.includes('id="landlord-bookings"') && page.includes("Add property details later") && !page.includes("Add matching limit or recurring preference"), "The Landlord dashboard still includes the duplicate next-action banner, does not link Bookings directly, or leaves optional controls in the simplified main path.");
assert(page.includes("Private property label") && page.includes("never the street address") && !/name="name"[^>]*required/.test(page) && page.includes("data-sole-property") && script.includes("propertySelectLabel.hidden = hasSoleProperty") && script.includes("propertySelect.value = properties[0].propertyId"), "Property setup still requires an invented label, risks deriving it from the exact address, or asks a Landlord to choose their only property.");
assert(page.includes("data-cleaning-type-hint") && script.includes("function applySuggestedCleaningType()") && script.includes('cleaningTypeSelect.dataset.selectionSource = "user"') && script.includes("suggestedCleaningType(property?.propertyType)"), "The request form does not suggest an obvious cleaning category or can overwrite an explicit Landlord choice.");
assert(styles.includes(".landlord-dashboard-page") && styles.includes(".landlord-speech-scope") && styles.includes(".landlord-request-scan-body") && styles.includes("@media (max-width: 720px)") && styles.includes(".landlord-property-actions .button { width: 100%; }") && styles.includes(".landlord-request-actions .text-button { width: 100%; }") && page.includes('aria-live="polite"'), "The Landlord room-scan workspace, property editor or withdrawal control lacks mobile or accessible feedback styling.");
assert(!/(Jane|Sarah|Maria|John|five-star|fully insured|background checked|DBS checked)/i.test(`${page}\n${script}\n${model}`), "The real Landlord workspace contains an invented person or unsupported trust claim.");

assert(page.includes("landlord-sidebar-account-menu") && page.includes("landlord-topbar-account-menu") && page.includes("Signed in securely") && [...page.matchAll(/data-account-destination="personal"/g)].length === 2 && v2Styles.includes(".landlord-sidebar-account-menu .account-menu-panel") && v2Styles.includes("bottom: 88px") && v2Styles.includes(".landlord-topbar-account-menu .account-menu-panel"), "The sidebar identity and top-bar avatar are not linked to one complete, unclipped account menu.");
const desktopAccountControlRules = v2Styles.slice(v2Styles.indexOf("@media (min-width: 901px)"), v2Styles.indexOf("/* The bell kept"));
assert(desktopAccountControlRules.includes(".landlord-topbar-account-menu") && desktopAccountControlRules.includes("display: none !important"), "Desktop still shows the mobile top-bar profile control beside the sidebar account control.");
// The account menu no longer lists Saved properties or Cleaning preferences.
// Both resolved to the same view already reachable from the sidebar and the
// mobile tab bar, and "Cleaning preferences" named a field on an individual
// place as though it were a section of its own.
assert(page.includes('id="landlord-panel-account"') && script.includes("Details, security, payments and preferences") && page.includes("ld-account-identity-card") && page.includes("Verified sign-in identity") && page.includes("Landlord · private account") && page.includes('data-account-section="personal"') && page.includes("Security &amp; login") && script.includes("function openPersonalAccountDetails") && script.includes('selectWorkspaceTab("account"') && script.includes('document.querySelectorAll("[data-account-section]")') && v2Styles.includes(".ld-account-identity-card") && v2Styles.includes(".ld-account-section-link"), "The full Account page does not match the reviewed identity-led design or share its personal-details destination with the profile menu.");

/* ── Starting a clean leads the dashboard ──────────────────────────────────
   Home exposes Scan and Manual as two equal, direct cards. A duplicate mode
   switch must not sit above those same actions. Scanning still leads, opens the
   guided journey in one click, and its motion remains optional decoration. */
{
  const homeAt = page.indexOf('data-landlord-panel="home"');
  const scanCardAt = page.indexOf('data-ld-card="scan"');
  const manualCardAt = page.indexOf('data-ld-card="manual"');
  const builderMountAt = page.indexOf("data-request-builder-mount");
  const bookingsAt = page.indexOf("landlord-booking-section");
  const propertiesAt = page.indexOf('data-landlord-panel="properties"');
  assert(homeAt > 0 && scanCardAt > 0, "The dashboard has no room-scan entry point.");
  assert(scanCardAt < manualCardAt, "The manual path is presented ahead of the scan, which is how a booking is meant to start.");
  assert(homeAt < bookingsAt && bookingsAt < propertiesAt, `The dashboard order is wrong — home ${homeAt}, bookings ${bookingsAt}, properties ${propertiesAt}.`);
  // The builder is an overlay, not a block in the page. Its mount sits inside
  // the request-builder dialog so the panel opens over the hub and closing it
  // leaves the reader where they were, instead of pushing the page down and
  // losing their place on the way back.
  const builderDialogAt = page.indexOf("data-request-builder-dialog");
  assert(builderDialogAt > 0 && builderDialogAt < builderMountAt && builderMountAt < page.indexOf("</dialog>", builderDialogAt), `The request builder is not mounted inside its overlay dialog — dialog ${builderDialogAt}, mount ${builderMountAt}.`);
  // One click into the guided journey, not a scroll to a panel further down.
  assert(/<a class="ld-btn ld-btn-primary" href="\/landlord\/book">/.test(page), "The scan card does not open the guided journey directly.");
  assert(script.includes('requestBuilderMount.replaceWith(requestBuilderPanel)') && script.includes('document.querySelectorAll("[data-open-request-tab]").forEach'), "The real request builder is not mounted in the approved dashboard position or its entry actions do not expand it.");
  assert(v2Styles.includes(".ld-start-card") && v2Styles.includes("ld-scanbeam") && v2Styles.includes("ld-rise"), "The scan card has no presentation or motion.");
  // Motion is decoration; it must never be the thing that makes the card work.
  const reducedMotion = v2Styles.slice(v2Styles.indexOf("prefers-reduced-motion"));
  assert(reducedMotion.includes(".ld-art-beam") && reducedMotion.includes("animation: none"), "Reduced motion does not still the scan artwork.");
  assert(!page.includes("data-ld-tab") && !page.includes('class="ld-tabs"') && !script.includes("selectStartTab"), "The duplicate Scan/Manual mode switch is still present above the two working action cards.");
}

/* The Home + Care design: everything on Home stays, Care joins it at the
   bottom, and Recommended for you closes the page. Upcoming cleaning is gone
   from Home — confirmed work lives in Bookings. Every care figure comes from
   the care-summary endpoint (completed bookings, scan results and booking
   timestamps); nothing is estimated and nothing resets on a schedule. */
{
  const startCardsAt = page.indexOf('data-ld-card="manual"');
  const careDividerAt = page.indexOf("Your care record");
  const careHeroAt = page.indexOf('class="ld-care-hero"');
  const plansAt = page.indexOf('class="ld-plans"');
  const homePanelEndAt = page.indexOf("landlord-booking-section");
  assert(careDividerAt > startCardsAt && careHeroAt > careDividerAt && plansAt > careHeroAt && plansAt < homePanelEndAt, `Home does not run start cards -> care record -> Recommended for you — cards ${startCardsAt}, divider ${careDividerAt}, hero ${careHeroAt}, plans ${plansAt}.`);
  assert(!page.includes("data-ld-upcoming") && !page.includes("Upcoming cleaning") && !script.includes("renderUpcomingClean"), "The removed Upcoming cleaning card is still on Home.");
  assert(script.includes("/api/marketplace/landlord/care-summary") && script.includes("renderCareRecord"), "The care record is not fed by the account's own care-summary endpoint.");
  // The honesty rules from the reviewed retention concept, kept in the copy.
  assert(page.includes("Earned by using Homle, never sold") && script.includes("inventing a label") && script.includes("never an estimate"), "The care record lost its earned-freeze or no-invented-figures guarantees.");
  assert(page.includes("booked inside 24 hours") && script.includes('"The Fast Turnaround"'), "The Ready streak boundary and the earned archetype are missing.");
  // The share card carries no address, tenant name or price.
  const shareBody = script.slice(script.indexOf("function careShareText"), script.indexOf("let careShareStatusTimer"));
  assert(page.includes("data-ld-care-share") && script.includes("navigator.share") && script.includes("navigator.clipboard") && shareBody.length > 0 && !shareBody.includes("bookedValuePence") && !shareBody.includes("propertyName"), "The care share card is missing, or it leaks money or property figures a public share must not carry.");
  assert(page.includes('class="ld-care-zone"') && page.includes("<span>Care</span>") && v2Styles.includes(".ld-care-zone") && v2Styles.includes("border-top: 3px solid var(--ld-coral)"), "The care record is not clearly grouped and identified as Care.");
  assert(v2Styles.includes(".ld-care-hero") && v2Styles.includes("ld-care-bloom") && v2Styles.includes(".ld-care-cell.is-frozen") && v2Styles.includes(".ld-care-meter-fill"), "The care record has no presentation.");
  const careHeroHeadingStyles = v2Styles.slice(v2Styles.indexOf(".ld-care-hero-main h3"), v2Styles.indexOf(".ld-care-lead"));
  assert(careHeroHeadingStyles.includes("color: #fff"), "The Care identity heading can inherit dark text and disappear on the black hero.");
  const careReducedMotion = v2Styles.slice(v2Styles.lastIndexOf("prefers-reduced-motion"));
  assert(careReducedMotion.includes(".ld-care-bloom") && careReducedMotion.includes("animation: none"), "Reduced motion does not still the care record.");
}

assert(page.includes("Secure landlord access") && !page.includes("landlord-prepare-card") && page.includes("data-request-builder-mount") && page.includes("Not sent for matching · private draft") && page.includes('class="landlord-workspace-panel pac-collapsed"') && page.includes('aria-expanded="false"') && page.includes('aria-label="Open the cleaning request builder"'), "The Landlord dashboard still has the duplicate teaser or the real clean builder is not mounted in its approved collapsed position.");

// Collapsed, the builder is a regular banner. Hiding only `.pac-layout` left
// the form's own bordered shell (`.landlord-record-form` styles itself)
// floating under the subtitle as an empty box — the field screenshot exactly.
// The whole body hides, the padding tightens to banner height, and the banner
// itself expands on click while the reveal button stays the accessible control.
{
  const wizard = await readFile(new URL("../public/landlord-prepare-wizard.js", import.meta.url), "utf8");
  assert(script.includes('requestBuilderToggle?.addEventListener("click"') && script.includes("setRequestBuilderExpanded(!expanded)") && script.includes("if (!expanded) void loadPrepareWizard()") && !wizard.includes('toggle.addEventListener("click"'), "Reveal/Hide is not owned by the main modal controller, so the delayed wizard can leave the dialog on its collapsed cover or double-toggle it closed.");
  assert(designStyles.includes(".pac-collapsed .pac-body { display: none; }"), "The collapsed builder still shows the form's empty shell as a stray box under the banner.");
  // Two ways to start a clean share the screen, so each has to announce which
  // it is at a glance. The scan banner is red, camera-led and animated; this
  // one is white and still, with a pen badge and icon chips naming the manual
  // steps — shown only while collapsed, which is where the choosing happens.
  assert(page.includes(">Manual request</h2>") && page.includes("No camera — fill the details in yourself"), "The manual path is not named as such, so it reads as a second scanner.");
  // The decorative pencil badge was removed on request, to leave the header
  // carrying one idea rather than an icon, a title, an eyebrow and a pill. The
  // chips are what actually distinguish the manual path from the scan — they
  // name what this route asks of you — so they are what this still holds.
  assert(page.includes("Type the basics") && page.includes("Or speak the rooms") && page.includes("One exact price"), "The banner lost the chips that distinguish the manual path from the scan.");
  assert(/\.pac-collapsed \.pac-head-tags \{\s*display: flex/.test(designStyles) && /\.pac-head-tags \{ display: none; \}/.test(designStyles), "The distinguishing chips are missing from the collapsed banner, or clutter the open builder.");
  // The manual route is the alternative to the scan, and must not out-shout it.
  assert(/\.landlord-sidebar-cta \{[^}]*min-height: 38px/.test(designStyles) && /\.landlord-sidebar-cta \{[^}]*font-size: 13\.5px/.test(designStyles), "The manual-request button is back to full primary-button size, competing with the scan banner it is an alternative to.");

  // Collapsed, the panel is a hero of the same standing as the scan banner. A
  // white strip beneath a full-bleed red banner reads as a footnote to it
  // rather than as the second of two choices.
  const scanHeroMinHeight = Number(designStyles.match(/\.scan-hero \{[^}]*min-height: (\d+)px/)[1]);
  const manualHeroMinHeight = Number(designStyles.match(/\.pac-collapsed \.pac-card \{[^}]*min-height: (\d+)px/)[1]);
  assert(manualHeroMinHeight >= scanHeroMinHeight, `The manual hero (${manualHeroMinHeight}px) is smaller than the scan hero (${scanHeroMinHeight}px), so the two routes no longer read as equals.`);
  assert(page.includes('class="pac-head-art"') && page.includes('class="pac-art-doc"') && page.includes("Drafting"), "The manual hero lost the artwork that answers the scan hero's phone.");
  // Its motion must cost nothing to lay out — this banner sits above a
  // workspace that is already fetching — and must respect reduced motion.
  for (const [name, body] of designStyles.matchAll(/@keyframes (pacDraft\w+) \{([\s\S]*?)\n\}/g)) {
    const properties = [...body.matchAll(/([a-z-]+):/g)].map((match) => match[1]);
    assert(properties.every((property) => property === "transform" || property === "opacity"),
      `The ${name} animation moves ${properties.filter((p) => p !== "transform" && p !== "opacity").join(", ")}, which lays the banner out again on every frame.`);
  }
  assert(/prefers-reduced-motion[\s\S]{0,400}\.pac-head-art::before \{ animation: none/.test(designStyles), "The manual hero's moving light ignores reduced-motion.");
  // The draft is always drawn. An earlier version typed the lines in and
  // cleared them, so roughly a second in every cycle showed an empty document
  // — indistinguishable, to whoever arrived at that moment, from a broken one.
  assert(!/\.pac-art-doc i \{[^}]*animation:/.test(designStyles), "The draft lines animate themselves away again, so the hero periodically shows an empty document.");
  assert(/\.pac-collapsed \.pac-card-head \{[^}]*cursor: pointer/.test(designStyles), "The collapsed banner does not present itself as clickable.");
  assert(wizard.includes('if (!panel.classList.contains("pac-collapsed")) return;') && wizard.includes("if (toggle.contains(event.target)) return;") && wizard.includes("toggle.click();"), "The banner head cannot delegate expansion to the canonical modal control, or a click on the heading while working collapses it / double-fires through the button.");
}
/* The v2 shell: a sidebar of five destinations, a top bar carrying the bell and
   avatar, and a bottom bar that takes over below 900px. The scanning-phone
   artwork moved from a full-width banner into the Scan card, and the sidebar's
   manual-request button moved into the Manual card beside it. */
assert(page.includes("workspace-brand-copy") && page.includes("ld-mobile-nav") && page.includes("ld-start-art-scan") && page.includes("ld-art-beam"), "The approved sidebar, bottom bar or scanning-phone presentation is missing from the real dashboard markup.");
assert(v2Styles.includes("width: auto;") && v2Styles.includes("max-width: none;") && v2Styles.includes(".landlord-dashboard-main > * {\n  width: 100%;\n  max-width: none;"), "The desktop Landlord workspace is still constrained by the global reading-page shell or a narrow child cap.");
const mobileShellRules = v2Styles.slice(v2Styles.indexOf("@media (max-width: 900px)"), v2Styles.indexOf("@media (max-width: 900px) and"));
assert(/\.site-header\s*\{[^}]*display:\s*none;/s.test(mobileShellRules) && /\.landlord-dashboard-main\s*\{[^}]*width:\s*100%;[^}]*margin-left:\s*0;[^}]*margin-right:\s*0;/s.test(mobileShellRules), "The phone breakpoint still shows the desktop sidebar/profile banner or reserves its fixed offset and crushes the Landlord workspace.");
assert(page.includes('class="ld-mobile-brand" href="/landlord/dashboard"') && /\.ld-mobile-brand\s*\{[^}]*grid-area:\s*brand;[^}]*display:\s*inline-grid;/s.test(mobileShellRules), "Removing the oversized mobile header also removed the compact Homle identity from the authenticated workspace, or the mark leaves the workspace for the marketing site instead of returning to its home.");
assert(page.includes('class="account-menu landlord-account-menu landlord-topbar-account-menu"') && page.includes('class="ld-topbar-avatar" data-account-avatar') && page.includes('class="account-menu-primary" href="/landlord/account"') && v2Styles.includes(".ld-topbar-avatar img") && v2Styles.includes("border-radius: inherit;") && v2Styles.includes("object-fit: cover;"), "The signed-in profile photo is not a useful Account menu/link or can still render as an unclipped square.");
assert(!page.includes('class="account-footer"') && !v2Styles.includes(".account-footer") && !script.includes('querySelector("[data-year]")'), "The desktop or mobile Landlord dashboard still renders or initializes the removed public-site footer inside the private application workspace.");
assert(page.includes('data-open-landlord-section="messages"') && page.includes('data-landlord-panel="messages"'), "The Messages destination in the sidebar has no panel to select.");
// Messaging is real now: the endpoint, the service and migration 015 were
// always there, and only this view was missing. The guarantee inverts — the
// composer must NOT be disabled, and the panel must not claim to be unbuilt.
// tests/landlord-messages-ui.mjs covers the conversation behaviour itself.
assert(!page.includes("Messaging is coming soon") && /data-messages-input/.test(page) && !/data-messages-input[^>]*\sdisabled/.test(page), "The Landlord Messages panel is still a placeholder, so a Cleaner can write to someone who cannot reply.");
// The guide prices are not quotes and there is no pricing endpoint behind them.
assert(script.includes("LD_INDICATIVE_PLANS") && page.includes("Indicative") && page.includes("not a quote"), "The recommended-plan prices are presented as real quotes.");
assert(designStyles.includes("grid-template-columns: minmax(0, 1fr) 180px") && designStyles.includes("landlordPhoneScan") && designStyles.includes("@media (max-width: 700px)") && designStyles.includes("overflow-x: auto"), "The reference dashboard styling lost its desktop scan composition or mobile adaptation.");
assert(designStyles.includes("grid-template-areas: none") && designStyles.includes(".landlord-dashboard-identity > .role-dashboard-welcome { grid-area: auto; }") && designStyles.includes("color: var(--ld-ink)") && designStyles.includes("background: none") && designStyles.includes(".landlord-dashboard-identity .role-dashboard-welcome > p:last-child { color: #755548; }"), "Older shared dashboard grid or colour rules can still displace or wash out the approved Landlord welcome header.");
assert(script.includes('booking.status === "confirmed"') && script.includes('"Request a change"') && script.includes('/landlord/help?bookingId='), "A confirmed booking no longer offers the Landlord a direct, booking-bound change request.");


/* ── Spoken restrictions are named, not blended into the checklist ─────── */

// "Do not move the paperwork" is not work to do. A Landlord who cannot see that
// it was understood as a restriction has no way to check that it was, and the
// cleaner inherits the ambiguity.
assert(script.includes("Array.isArray(result?.instructions)"),
  "The walkthrough response's structured instructions are ignored.");
assert(script.includes('["restriction", "safety"]'),
  "Restrictions and safety warnings are not counted separately from tasks.");
assert(script.includes("do-not") && script.includes("safety ${entry.count === 1"),
  "The walkthrough status does not tell the Landlord that restrictions were understood as restrictions.");

/* ── One clean, one clock ─────────────────────────────────────────────── */

// booking-summary-model.js pins Europe/London for the booking window and the
// booking moment. The dashboard's own shortDate and clockTime formatters did
// not, so the Happening now card printed its window in London time and its
// stage times in the device's zone: an hour apart from Madrid, eight and a
// day apart from Tokyo, for the same clean.
assert(script.includes('const bookingZone = "Europe/London"'),
  "The dashboard has no single owner for the zone every booking time is read in.");
for (const formatter of ["shortDate", "clockTime", "careMonth"]) {
  const declaration = script.slice(script.indexOf(`const ${formatter} = new Intl.DateTimeFormat`));
  assert(declaration.slice(0, declaration.indexOf(");")).includes("timeZone: bookingZone"),
    `${formatter} formats in the device's zone, so it can disagree with the pinned booking window on the same card.`);
}

/* ── The Happening now card can actually draw its stages ──────────────── */

// renderNextClean read `upcomingStepByStatus` and `upcomingStepDefinitions`,
// neither of which was declared anywhere in the tree. Nothing showed while an
// account had no accepted booking, because the function returns early without
// one. The first confirmed booking reached those lines, threw a ReferenceError
// into loadWorkspace's catch, and the whole workspace was replaced by "The
// Landlord workspace is temporarily unavailable" — a connectivity message for
// a bug that had nothing to do with the connection.
assert(script.includes("const upcomingStepDefinitions = Object.freeze([") && script.includes("const upcomingStepByStatus = Object.freeze({"),
  "The Happening now stage rail reads identifiers that are never declared, so the first accepted booking takes down the whole workspace.");
for (const status of ["pending-cleaner-acceptance", "confirmed", "cleaner-en-route", "cleaner-arrived", "cleaning-in-progress", "awaiting-review", "completed"]) {
  assert(new RegExp(`(^|[{,]\\s*)"?${status}"?:\\s*[0-4]`, "m").test(script.slice(script.indexOf("const upcomingStepByStatus"), script.indexOf("const upcomingStepByStatus") + 400)),
    `The stage rail has no position for a booking in "${status}", so that status silently falls back to Booked.`);
}

/* ── Messages is reachable on a phone ─────────────────────────────────── */

// The sidebar that carries Messages on a laptop is inside .site-header, which
// landlord-dashboard-v2.css hides below 900px. The mobile bar listed Home,
// Places, Scan, Bookings and Account, so a phone had no route to the view where
// the Cleaner working in the property is reached — only a typed URL.
assert([...page.matchAll(/data-open-landlord-section="messages"/g)].length >= 2,
  "Messages has no entry in the mobile tab bar, so it is unreachable below 900px where the sidebar is hidden.");
assert(v2Styles.includes("flex: 0 1 58px") && v2Styles.includes("flex: 0 0 62px"),
  "The mobile tab bar cannot shrink its tabs, so the sixth destination overflows or wraps on a narrow handset.");

/* ── Closing the request builder lands on a real view ─────────────────── */

// The builder is a view, reached at /landlord/requests. Closing it used to hide
// the builder without selecting anything in its place, so Escape or a backdrop
// click left the address on /landlord/requests with an empty main region, the
// heading reading "Properties" and the navigation still marking Bookings.
assert(/onDialogDismissal\(requestBuilderDialog[\s\S]{0,900}?currentWorkspaceTab === "requests"[\s\S]{0,120}?selectWorkspaceTab\("bookings"/.test(script),
  "Closing the request builder no longer returns the Landlord to a real view, so /landlord/requests can render an empty page.");

/* ── Dialog dismissal is heard in every engine still in use ───────────── */

// Chrome moved dialogs onto the ToggleEvent model, so a dismissal now fires
// beforetoggle and toggle (newState "closed") alongside the long-standing
// `close`. A report of the deployed dashboard concluded that `close` had
// stopped being delivered in Chrome 151, leaving every consequence below dead
// in production. That did not reproduce: measured on the real builder dialog in
// headless Chrome 151, dismissal fires toggle and then close, and the teardown
// runs. See the helper's own comment for the full measurement.
//
// Both signals stay subscribed as robustness rather than as a fix — this is the
// booking path, and the price approvals are the sharp edge, since each resolves
// a Promise on dismissal and a signal that never arrives leaves the approval
// awaiting forever with no error anywhere. These assertions keep that shape
// from being quietly narrowed back to one signal; what actually proves the
// behaviour is tests/landlord-dashboard-render.mjs, which dismisses a real
// dialog in a real engine and checks where the Landlord lands.
assert(script.includes("function onDialogDismissal(dialog, handler)") && script.includes("function onceDialogDismissal(dialog, handler)"),
  "There is no dual-signal dialog dismissal helper, so dismissal work depends on a single event current Chrome no longer fires.");
assert(/dialog\.addEventListener\("toggle", \(event\) => \{ if \(event\.newState === "closed"\) handler\(\); \}\)/.test(script),
  "The dismissal helper does not listen for toggle newState closed, so it is deaf in engines where `close` no longer fires.");
for (const dialogName of ["requestBuilderDialog", "bookCleanDialog", "matchOutcomeDialog", "requestWithdrawDialog", "propertyArchiveDialog"]) {
  assert(script.includes(`onDialogDismissal(${dialogName}`),
    `${dialogName}'s dismissal work is not routed through the dual-signal helper, so it can silently stop running in current Chrome.`);
}
assert(script.includes("onceDialogDismissal(invitationQuoteDialog") && script.includes("onceDialogDismissal(dispatchPriceDialog"),
  "A price-approval Promise still resolves only on the `close` event, so approving a Cleaner's exact total can hang forever in current Chrome.");
assert(!/\baddEventListener\("close"/.test(script.replace(/function onDialogDismissal[\s\S]{0,700}?\n\}/, "").replace(/function onceDialogDismissal[\s\S]{0,700}?\n\}/, "")),
  "A dialog subscribes to `close` outside the dismissal helpers, so that consequence is lost in engines that no longer fire it.");

/* ── The saved walkthrough is cleared once its draft is stored ─────────── */

// `let window` inside the draft-saving function shadowed the global for the
// whole function, so `window.sessionStorage` resolved to the requested-time
// window object. Clearing is a no-op on undefined storage, so the saved
// walkthrough survived its own save and was offered back as unfinished work.
assert(!/\blet window\b|\bconst window\b|\bvar window\b/.test(script),
  "A local declaration shadows the global window, so storage reached through window inside that scope is silently undefined.");
assert(script.includes("clearLandlordRequestDraft(window.sessionStorage)") && script.includes("...requestedTimeWindow,"),
  "The saved walkthrough is no longer cleared from this tab's storage after its draft is saved.");

console.log("Landlord dashboard UI tests passed: simplified navigation, selected-Cleaner continuation, voice-first scope, grouped bullet review, accessible fallbacks, owner APIs, direct room-scan continuation, safe rendering, builder close-out, draft clearing and mobile accessibility.");
