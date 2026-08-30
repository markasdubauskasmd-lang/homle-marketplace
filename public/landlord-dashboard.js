import { checklistFromTranscript } from "./checklist.js";
import { checklistChangeReview } from "./checklist-change-review.js";
import { clearSelectedCleaner, clearSelectedProperty, readSelectedCleaner, readSelectedProperty, saveSelectedCleaner, saveSelectedProperty } from "./account-intent.js?v=20260718-2";
import { isUkPostcode } from "./contact-validation.js";
import { clearLandlordRequestDraft, readLandlordRequestDraft, saveLandlordRequestDraft } from "./landlord-request-draft.js";
import { consumeRoomPhotoInputFiles, maximumRoomPhotos, validatedRoomPhotoSelection } from "./room-photo-selection.js";
import { extractRoomVideoFrames, maximumRoomVideoFrames } from "./room-video-frames.js";
import { renderAccountAvatar } from "./account-avatar.js?v=20260718-1";
import { dashboardWorkspaceAccess } from "./workspace-access.js?v=20260718-1";
import { landlordDispatchAction, landlordMarketplaceCapabilityState, landlordStartFromSearch, liveBookingForRequest, moneyToPence, optionalRequestScope, pricingRequestFromManualTasks, propertyCleaningBlocker, requestStatusLabel, requestTasksFromLines, requestedWindow, suggestedCleaningType, tasksToLines } from "./landlord-dashboard-model.js?v=20260830-1";
import { bookingInvitationDeadlineState, bookingSummaryBuckets, bookingSummaryMoneyBoundary, bookingSummaryPriceLabel, bookingSummaryStatusLabels, formatBookingMoment, formatBookingMoney, formatBookingWindow, formatInvitationTimeRemaining, landlordDashboardSummary } from "./booking-summary-model.js?v=20260723-3";
import { activeBookingChangeRequestFor, supportRequestPage, supportStatusLabels } from "./landlord-help-model.js?v=20260804-1";
import { storedCsrf } from "./session-csrf.js";

const state = document.querySelector("[data-landlord-state]");
const stateTitle = document.querySelector("[data-landlord-state-title]");
const stateCopy = document.querySelector("[data-landlord-state-copy]");
const signIn = document.querySelector("[data-landlord-sign-in]");
const workspaceLink = document.querySelector("[data-landlord-workspace-link]");
const retry = document.querySelector("[data-landlord-retry]");
const workspace = document.querySelector("[data-landlord-workspace]");
const privateNavigation = document.querySelectorAll("[data-landlord-private-navigation]");
const notificationLink = document.querySelector("[data-notification-link]");
const requestComplete = document.querySelector("[data-request-complete]");
const requestCompleteLead = document.querySelector("[data-request-complete-lead]");
const requestCompleteReference = document.querySelector("[data-request-complete-reference]");
const requestCompleteCounts = document.querySelector("[data-request-complete-counts]");
const requestCompleteQuote = document.querySelector("[data-request-complete-quote]");
const requestCompletePriceLabel = document.querySelector("[data-request-complete-price-label]");
const requestCompletePrice = document.querySelector("[data-request-complete-price]");
const requestCompleteDuration = document.querySelector("[data-request-complete-duration]");
const requestCompleteQuoteNote = document.querySelector("[data-request-complete-quote-note]");
const requestCompleteWarning = document.querySelector("[data-request-complete-warning]");
const requestCompleteNext = document.querySelector("[data-request-complete-next]");
const requestCompleteSandbox = document.querySelector("[data-request-complete-sandbox]");
const requestCompleteSandboxNote = document.querySelector("[data-request-complete-sandbox-note]");
const requestCompleteSandboxUnavailable = document.querySelector("[data-request-complete-sandbox-unavailable]");
const propertyDialog = document.querySelector("[data-property-dialog]");
const propertyForm = document.querySelector("[data-property-form]");
const requestForm = document.querySelector("[data-request-form]");
const requestContinuation = document.querySelector("[data-request-continuation]");
const landlordProfileForm = document.querySelector("[data-landlord-profile-form]");
const landlordProfileFeedback = document.querySelector("[data-landlord-profile-feedback]");
const landlordProfileSave = document.querySelector("[data-save-landlord-profile]");
const propertyList = document.querySelector("[data-property-list]");
const propertyEmpty = document.querySelector("[data-property-empty]");
const requestList = document.querySelector("[data-request-list]");
const activeRequestList = document.querySelector("[data-active-request-list]");
const requestEmpty = document.querySelector("[data-request-empty]");
const propertySelect = document.querySelector("[data-property-select]");
const propertySelectLabel = document.querySelector("[data-property-select-label]");
const soleProperty = document.querySelector("[data-sole-property]");
const solePropertyName = document.querySelector("[data-sole-property-name]");
const propertyFeedback = document.querySelector("[data-property-feedback]");
const propertyStatus = document.querySelector("[data-property-status]");
const archivedPropertySection = document.querySelector("[data-archived-properties]");
const archivedPropertyList = document.querySelector("[data-archived-property-list]");
const archivedPropertyCount = document.querySelector("[data-archived-property-count]");
const archivedPropertyStatus = document.querySelector("[data-archived-property-status]");
const propertyFormTitle = document.querySelector("[data-property-form-title]");
const requestFeedback = document.querySelector("[data-request-feedback]");
const requestRecoveryStatus = document.querySelector("[data-request-recovery-status]");
const requestStatus = document.querySelector("[data-request-status]");
const invitationQuoteDialog = document.querySelector("[data-invitation-quote-dialog]");
const invitationQuoteCleaner = document.querySelector("[data-invitation-quote-cleaner]");
const invitationQuotePrice = document.querySelector("[data-invitation-quote-price]");
const invitationQuoteApprove = document.querySelector("[data-invitation-quote-approve]");
const matchOutcomeDialog = document.querySelector("[data-match-outcome-dialog]");
const matchOutcomeTitle = document.querySelector("[data-match-outcome-title]");
const matchOutcomeCopy = document.querySelector("[data-match-outcome-copy]");
const matchOutcomePlace = document.querySelector("[data-match-outcome-place]");
const matchOutcomeTime = document.querySelector("[data-match-outcome-time]");
const matchOutcomeResult = document.querySelector("[data-match-outcome-result]");
const matchOutcomeTiming = document.querySelector("[data-match-outcome-timing]");
const matchOutcomeChangeTime = document.querySelector("[data-match-outcome-change-time]");
const matchOutcomeDate = document.querySelector("[data-match-outcome-date]");
const matchOutcomeStart = document.querySelector("[data-match-outcome-start]");
const matchOutcomeDuration = document.querySelector("[data-match-outcome-duration]");
const matchOutcomeFeedback = document.querySelector("[data-match-outcome-feedback]");
const matchOutcomeBack = document.querySelector("[data-match-outcome-back]");
const matchOutcomeContinue = document.querySelector("[data-match-outcome-continue]");
const matchOutcomeSequence = document.querySelector("[data-match-outcome-sequence]");
const dispatchPriceDialog = document.querySelector("[data-dispatch-price-dialog]");
const dispatchPriceMaximum = document.querySelector("[data-dispatch-price-maximum]");
const dispatchPriceAttempts = document.querySelector("[data-dispatch-price-attempts]");
const dispatchPriceApprove = document.querySelector("[data-dispatch-price-approve]");
const requestWithdrawDialog = document.querySelector("[data-request-withdraw-dialog]");
const requestWithdrawForm = document.querySelector("[data-request-withdraw-form]");
const requestWithdrawFeedback = document.querySelector("[data-request-withdraw-feedback]");
const requestWithdrawCancel = document.querySelector("[data-request-withdraw-cancel]");
const requestWithdrawConfirm = document.querySelector("[data-request-withdraw-confirm]");
const propertyArchiveDialog = document.querySelector("[data-property-archive-dialog]");
const propertyArchiveForm = document.querySelector("[data-property-archive-form]");
const propertyArchiveName = document.querySelector("[data-property-archive-name]");
const propertyArchiveFeedback = document.querySelector("[data-property-archive-feedback]");
const propertyArchiveCancel = document.querySelector("[data-property-archive-cancel]");
const propertyArchiveConfirm = document.querySelector("[data-property-archive-confirm]");
const bookCleanOpen = document.querySelector("[data-book-clean-open]");
const bookCleanDialog = document.querySelector("[data-book-clean-dialog]");
const bookCleanClose = document.querySelector("[data-book-clean-close]");
const bookCleanPlaces = document.querySelector("[data-book-clean-places]");
const bookCleanMethods = document.querySelector("[data-book-clean-methods]");
const bookCleanSelected = document.querySelector("[data-book-clean-selected]");
const bookCleanStep = document.querySelector("[data-book-clean-step]");
const bookCleanNewPlace = document.querySelector("[data-book-clean-new-place]");
const bookCleanScan = document.querySelector("[data-book-clean-scan]");
const bookCleanManual = document.querySelector("[data-book-clean-manual]");
const propertySave = document.querySelector("[data-save-property]");
const requestSave = document.querySelector("[data-save-request]");
const requestContinue = document.querySelector("[data-continue-request]");
const manualQuote = document.querySelector("[data-manual-quote]");
const manualQuotePrice = document.querySelector("[data-manual-quote-price]");
const manualQuoteDuration = document.querySelector("[data-manual-quote-duration]");
const manualQuoteStatus = document.querySelector("[data-manual-quote-status]");
const speechButton = document.querySelector("[data-speech-toggle]");
const scanPropertyStatus = document.querySelector("[data-scan-property-status]");
const speechStatus = document.querySelector("[data-speech-status]");
const speechFallback = document.querySelector("[data-speech-fallback]");
const taskPreview = document.querySelector("[data-task-preview]");
const taskReviewStatus = document.querySelector("[data-task-review-status]");
const checklistChanges = document.querySelector("[data-checklist-changes]");
const checklistChangesTitle = document.querySelector("[data-checklist-changes-title]");
const checklistChangesBody = document.querySelector("[data-checklist-changes-body]");
const checklistRestore = document.querySelector("[data-checklist-restore]");
const cleaningTypeSelect = requestForm.elements.cleaningType;
const cleaningTypeHint = document.querySelector("[data-cleaning-type-hint]");
const mediaReadiness = document.querySelector("[data-landlord-media-readiness]");
const capabilityTitle = document.querySelector("[data-landlord-capability-title]");
const capabilityCopy = document.querySelector("[data-landlord-capability-copy]");
const networkStatus = document.querySelector("[data-landlord-network-status]");
const loadStatus = document.querySelector("[data-landlord-load-status]");
const loadRetry = document.querySelector("[data-landlord-load-retry]");
const bookingLiveStatus = document.querySelector("[data-landlord-booking-live]");
const bookingRefresh = document.querySelector("[data-landlord-booking-refresh]");
const landlordSectionToggles = document.querySelectorAll("[data-landlord-section-toggle]");
const selectedCleanerSummary = document.querySelector("[data-landlord-selected-cleaner]");
const selectedCleanerAvatar = document.querySelector("[data-landlord-selected-cleaner-avatar]");
const selectedCleanerName = document.querySelector("[data-landlord-selected-cleaner-name]");
const selectedCleanerEvidence = document.querySelector("[data-landlord-selected-cleaner-evidence]");
const selectedCleanerStatus = document.querySelector("[data-landlord-selected-cleaner-status]");
const selectedCleanerClear = document.querySelector("[data-landlord-selected-cleaner-clear]");
let properties = [];
let archivedProperties = [];
let requests = [];
let bookings = [];
let supportRequests = [];
let favouriteCleaners = [];
let landlordProfile = null;
let recognition = null;
let tasksManuallyEdited = false;
// The checklist exactly as it was generated — from the room scan, the speech
// summary, or a saved property checklist. Kept so the Landlord can see what
// THEY changed before confirming, rather than being asked to approve a list
// with no memory of what the scan actually found. Empty when the Landlord typed
// the scope themselves, in which case there is nothing to compare against.
let generatedChecklist = [];
let generatedChecklistSource = "";
let liveSummariseTimer = null;
let assistedSummariseTimer = null;
let assistedSummaryInFlight = false;
let assistedSummaryUnavailable = false;
let assistedSummaryTranscript = "";
let listening = false;
let speechFailed = false;
let speechChangedDuringListen = false;
let propertyDirty = false;
let requestDirty = false;
let landlordProfileDirty = false;
let editingPropertyId = "";
let withdrawingRequestId = "";
let withdrawingFromPropertyId = "";
let withdrawalPending = false;
let archivingPropertyId = "";
let propertyArchivePending = false;
let restoringPropertyId = "";
let loading = false;
let mediaReady = false;
let pricingReady = false;
let geocodingReady = false;
let matchingReady = false;
let automaticDispatchReady = false;
let paymentsReady = false;
const readinessRequestTimeoutMs = 5_000;
const optionalDashboardRequestTimeoutMs = 8_000;
const readinessRecoveryDelaysMs = Object.freeze([2_000, 6_000]);
// Render's free web service can briefly answer 503 while the instance wakes.
// A read is safe to repeat once; a mutation is deliberately never replayed
// because the first attempt may already have changed private marketplace data.
const safeReadWakeRetryDelayMs = 1_000;
let readinessRecoveryTimer = null;
let requestRecoveryChecked = false;
let requestRecoveryTimer = null;
let manualQuoteTimer = null;
let manualQuoteGeneration = 0;
let manualQuoteSignature = "";
let completedRequestId = "";
let activeRequestPhotoDialog = null;
let currentRequestDraft = null;
let invitationStream = null;
let invitationStreamKey = "";
let bookingTransitionRefresh = null;
let landlordInvitationDeadlineTimer = null;
let expiredWaitingRefreshNeeded = false;
let refreshingExpiredWaiting = false;
const requestScans = new Map();
const uncertainDispatchRequests = new Set();
const bookingStart = landlordStartFromSearch(location.search) === "booking";
let selectedCleanerId = "";
let selectedPropertyId = "";
let selectedCleanerProfile = null;
let selectedCleanerVerificationState = "none";
let bookCleanPropertyId = "";
try { if (bookingStart) selectedCleanerId = readSelectedCleaner(localStorage); } catch {}
try { if (bookingStart) selectedPropertyId = readSelectedProperty(sessionStorage); } catch {}

function browserOffline() {
  return navigator.onLine === false;
}

function updateNetworkStatus() {
  networkStatus.hidden = !browserOffline();
}


function saveCsrf(token) {
  try {
    sessionStorage.setItem("tideway_csrf", token);
    return sessionStorage.getItem("tideway_csrf") === token;
  } catch { return false; }
}

function requestDraftFields() {
  return Object.fromEntries(["propertyId", "requestedDate", "requestedTime", "durationMinutes", "cleaningType", "frequency", "budget", "specialInstructions", "transcript", "tasks"].map((name) => [name, requestForm.elements[name]?.value || ""]));
}

function rememberWorkingRequest() {
  if (!requestDirty) return;
  try { saveLandlordRequestDraft(window.sessionStorage, { fields: requestDraftFields() }); } catch {}
}

function scheduleWorkingRequestRecovery() {
  window.clearTimeout(requestRecoveryTimer);
  requestRecoveryTimer = window.setTimeout(rememberWorkingRequest, 250);
}

function restoreWorkingRequest() {
  if (requestRecoveryChecked) return;
  requestRecoveryChecked = true;
  let draft = null;
  try { draft = readLandlordRequestDraft(window.sessionStorage); } catch {}
  if (!draft) return;
  const propertyAvailable = properties.some((property) => property.propertyId === draft.fields.propertyId);
  for (const name of ["requestedDate", "requestedTime", "durationMinutes", "cleaningType", "frequency", "budget", "specialInstructions", "transcript", "tasks"]) {
    const control = requestForm.elements[name];
    if (control && draft.fields[name]) control.value = draft.fields[name];
  }
  if (propertyAvailable) propertySelect.value = draft.fields.propertyId;
  if (draft.fields.cleaningType) cleaningTypeSelect.dataset.selectionSource = "user";
  requestForm.elements.scopeReviewed.checked = false;
  renderTaskPreview();
  requestDirty = true;
  requestRecoveryStatus.dataset.kind = "recovered";
  requestRecoveryStatus.textContent = propertyAvailable || !draft.fields.propertyId
    ? "Your unfinished room walkthrough was recovered from this tab. Review every bullet before saving."
    : "Your unfinished walkthrough was recovered, but its saved property is no longer available. Choose a property and review every bullet.";
}

function element(name, className, text) {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function renderBookCleanChooser() {
  if (!bookCleanPlaces || !bookCleanMethods) return;
  if (!properties.some((property) => property.propertyId === bookCleanPropertyId)) bookCleanPropertyId = "";
  bookCleanPlaces.replaceChildren();
  for (const property of properties) {
    const button = element("button", "hub-book-place");
    button.type = "button";
    button.setAttribute("aria-pressed", String(property.propertyId === bookCleanPropertyId));
    const icon = element("span", "hub-book-place-icon");
    icon.append(cloneIcon("home"));
    icon.setAttribute("aria-hidden", "true");
    const copy = element("span", "hub-book-place-copy");
    copy.append(element("strong", "", property.name || "Saved property"), element("small", "", propertySubtitle(property)));
    button.append(icon, copy, element("span", "hub-book-place-tick", "✓"));
    button.addEventListener("click", () => {
      bookCleanPropertyId = property.propertyId;
      bookCleanStep.textContent = "Step 2 of 2 · choose a method";
      renderBookCleanChooser();
      bookCleanMethods.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    bookCleanPlaces.append(button);
  }
  bookCleanMethods.hidden = !bookCleanPropertyId;
  if (bookCleanPropertyId) {
    const property = properties.find((item) => item.propertyId === bookCleanPropertyId);
    bookCleanSelected.textContent = `${property?.name || "Saved property"} is selected.`;
  } else bookCleanSelected.textContent = "";
}

function openBookCleanChooser() {
  if (!bookCleanDialog) return;
  try {
    const remembered = readSelectedProperty(sessionStorage);
    if (remembered && properties.some((property) => property.propertyId === remembered)) bookCleanPropertyId = remembered;
  } catch {}
  bookCleanStep.textContent = properties.length
    ? "Step 1 of 2 · choose a place"
    : "Add your first place, then choose Scan or Manual.";
  renderBookCleanChooser();
  if (!bookCleanDialog.open) bookCleanDialog.showModal();
}

function keepBookCleanProperty() {
  const property = properties.find((item) => item.propertyId === bookCleanPropertyId);
  if (!property) return null;
  saveSelectedProperty(sessionStorage, property.propertyId);
  selectedPropertyId = property.propertyId;
  return property;
}

function beginManualCleanFromChooser() {
  const property = keepBookCleanProperty();
  if (!property) return;
  bookCleanDialog.close();
  selectWorkspaceTab("requests", { historyMode: "push" });
  propertySelect.value = property.propertyId;
  applySuggestedCleaningType();
  requestForm.scrollIntoView({ behavior: "smooth", block: "start" });
  requestForm.elements.requestedDate.focus({ preventScroll: true });
}

function showState(title, copy, { kind = "info", allowSignIn = false, allowRetry = false, workspaceDestination = "", workspaceLabel = "" } = {}) {
  state.dataset.kind = kind;
  state.hidden = false;
  stateTitle.textContent = title;
  stateCopy.textContent = copy;
  signIn.hidden = !allowSignIn;
  retry.hidden = !allowRetry;
  workspaceLink.hidden = !workspaceDestination;
  if (workspaceDestination) {
    workspaceLink.href = workspaceDestination;
    workspaceLink.textContent = `Open ${workspaceLabel} dashboard`;
  }
  notificationLink.hidden = true;
  for (const item of privateNavigation) item.hidden = true;
  workspace.hidden = true;
  requestComplete.hidden = true;
}

function showFeedback(target, message, kind = "error") {
  target.dataset.kind = kind;
  target.textContent = message;
  target.hidden = false;
  target.focus?.();
}

function invalidateScopeReview(message) {
  const confirmation = requestForm.elements.scopeReviewed;
  if (!confirmation.checked) return;
  confirmation.checked = false;
  showFeedback(requestFeedback, message, "info");
}

/**
 * Show what the Landlord changed against the generated checklist.
 *
 * `checklistChangeReview` already computes added/removed/reordered scope and is
 * covered by its own tests; this is the surface that finally reaches a user.
 * Added and removed scope are what change the price and the cleaner's work, so
 * they are listed item by item. A pure reorder is stated but not enumerated —
 * it changes nothing about what gets cleaned.
 */
const cleanerProfileDialog = document.querySelector("[data-cleaner-profile-dialog]");
const cleanerProfileAvatar = document.querySelector("[data-cleaner-profile-avatar]");
const cleanerProfileName = document.querySelector("[data-cleaner-profile-name]");
const cleanerProfileRating = document.querySelector("[data-cleaner-profile-rating]");
const cleanerProfileBody = document.querySelector("[data-cleaner-profile-body]");
// Only the newest request's response may paint, so a slow first profile cannot
// overwrite a second one the Landlord opened while waiting.
let cleanerProfileRequest = 0;

/**
 * Show a Cleaner's public profile and their completed-job reviews.
 *
 * Both endpoints already existed and were already permission-checked server
 * side; the Landlord side simply never called them. Read-only by design — every
 * action stays on the cards behind it, so opening a profile cannot change a
 * booking.
 */
async function openCleanerProfile(cleanerId, fallbackName = "Cleaner") {
  if (!cleanerProfileDialog || !cleanerId) return;
  const generation = ++cleanerProfileRequest;
  cleanerProfileName.textContent = fallbackName;
  cleanerProfileRating.textContent = "";
  cleanerProfileAvatar.replaceChildren(document.createTextNode(String(fallbackName).slice(0, 1).toLocaleUpperCase("en-GB")));
  cleanerProfileBody.replaceChildren(element("p", "", "Loading this Cleaner’s public profile…"));
  if (typeof cleanerProfileDialog.showModal === "function" && !cleanerProfileDialog.open) cleanerProfileDialog.showModal();

  try {
    const [profileResult, reviewsResult] = await Promise.all([
      requestJson(`/api/marketplace/cleaners/${encodeURIComponent(cleanerId)}`),
      // Reviews are supporting detail: a profile is still worth showing without
      // them, so a failure here must not blank the whole dialog.
      requestJson(`/api/marketplace/cleaners/${encodeURIComponent(cleanerId)}/reviews`).catch(() => null),
    ]);
    if (generation !== cleanerProfileRequest) return;
    const cleaner = profileResult?.cleaner;
    if (!cleaner) throw new Error("This Cleaner’s public profile is not available.");

    cleanerProfileName.textContent = cleaner.displayName || fallbackName;
    const reviewCount = Number(cleaner.reviewCount) || 0;
    cleanerProfileRating.textContent = reviewCount > 0
      ? `${Number(cleaner.averageRating).toFixed(1)} stars from ${reviewCount} completed ${reviewCount === 1 ? "job" : "jobs"}`
      : "No completed-job reviews yet";
    if (cleaner.profilePhotoUrl) {
      const image = element("img");
      image.src = cleaner.profilePhotoUrl;
      image.alt = "";
      image.addEventListener("error", () => {
        cleanerProfileAvatar.replaceChildren(document.createTextNode(String(cleaner.displayName || fallbackName).slice(0, 1).toLocaleUpperCase("en-GB")));
      }, { once: true });
      cleanerProfileAvatar.replaceChildren(image);
    }

    cleanerProfileBody.replaceChildren();
    const services = Array.isArray(cleaner.services) ? cleaner.services.filter(Boolean) : [];
    if (services.length) {
      const block = element("div", "landlord-cleaner-profile-section");
      block.append(element("h3", "", "Services offered"));
      const list = element("ul", "landlord-cleaner-profile-services");
      services.forEach((service) => list.append(element("li", "", typeof service === "string" ? service : String(service?.name || "Service"))));
      block.append(list);
      cleanerProfileBody.append(block);
    }
    if (cleaner.bio) {
      const block = element("div", "landlord-cleaner-profile-section");
      block.append(element("h3", "", "About"), element("p", "", String(cleaner.bio)));
      cleanerProfileBody.append(block);
    }

    const reviews = Array.isArray(reviewsResult?.reviews) ? reviewsResult.reviews : [];
    const block = element("div", "landlord-cleaner-profile-section");
    block.append(element("h3", "", "Reviews from completed jobs"));
    if (!reviewsResult) {
      block.append(element("p", "landlord-cleaner-profile-note", "Reviews could not be loaded just now. The profile above is current."));
    } else if (!reviews.length) {
      block.append(element("p", "landlord-cleaner-profile-note", "No published reviews yet. Ratings appear here once a booking with this Cleaner is completed and reviewed."));
    } else {
      const list = element("ul", "landlord-cleaner-profile-reviews");
      for (const review of reviews.slice(0, 5)) {
        const item = element("li");
        const rating = Number(review.rating);
        item.append(element("strong", "", Number.isFinite(rating) ? `${rating.toFixed(1)} stars` : "Rated"));
        if (review.comment) item.append(element("p", "", String(review.comment)));
        list.append(item);
      }
      block.append(list);
      if (reviews.length > 5) block.append(element("p", "landlord-cleaner-profile-note", `Showing the 5 most recent of ${reviews.length} reviews.`));
    }
    cleanerProfileBody.append(block);
  } catch (error) {
    if (generation !== cleanerProfileRequest) return;
    cleanerProfileBody.replaceChildren(element("p", "landlord-cleaner-profile-note", error?.message || "This Cleaner’s public profile could not be loaded. No booking was changed."));
  }
}

function renderChecklistChanges(lines) {
  if (!checklistChanges) return;
  if (!generatedChecklist.length) {
    checklistChanges.hidden = true;
    return;
  }
  const review = checklistChangeReview(generatedChecklist, lines);
  if (!review.changed) {
    checklistChanges.hidden = true;
    return;
  }
  checklistChanges.hidden = false;
  checklistChangesTitle.textContent = `Your edits to the ${generatedChecklistSource || "generated"} checklist`;
  checklistChangesBody.replaceChildren();

  const section = (label, tasks, kind) => {
    if (!tasks.length) return;
    const block = element("div", `landlord-checklist-change landlord-checklist-change-${kind}`);
    block.append(element("strong", "", `${label} (${tasks.length})`));
    const list = element("ul");
    tasks.forEach((task) => list.append(element("li", "", task)));
    block.append(list);
    checklistChangesBody.append(block);
  };
  section("You added", review.added, "added");
  section("You removed", review.removed, "removed");
  if (review.orderChanged && !review.added.length && !review.removed.length) {
    checklistChangesBody.append(element("p", "landlord-checklist-change-note", "Same tasks, different order. Nothing was added or removed."));
  }
}

function restoreGeneratedChecklist() {
  if (!generatedChecklist.length) return;
  requestForm.elements.tasks.value = generatedChecklist.join("\n");
  invalidateScopeReview("The scanned checklist was restored. Review every room task again before saving.");
  renderTaskPreview();
  requestDirty = true;
  scheduleWorkingRequestRecovery();
  showFeedback(requestFeedback, "Restored the checklist exactly as it was generated.", "success");
}

function renderTaskPreview() {
  const lines = String(requestForm.elements.tasks.value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  renderChecklistChanges(lines);
  const confirmation = requestForm.elements.scopeReviewed;
  try {
    const reviewedTasks = optionalRequestScope(lines.join("\n"), {
      cleaningType: requestForm.elements.cleaningType.value
    }).tasks;
    const roomCount = new Set(reviewedTasks.map((task) => task.roomName.toLowerCase())).size;
    confirmation.disabled = false;
    taskReviewStatus.dataset.kind = "ready";
    taskReviewStatus.textContent = lines.length
      ? `${reviewedTasks.length} clear ${reviewedTasks.length === 1 ? "task" : "tasks"} across ${roomCount} ${roomCount === 1 ? "room" : "rooms"}. Review the bullets, then confirm.`
      : "Notes are optional. Homle will use the selected cleaning service as the Cleaner brief.";
  } catch (error) {
    confirmation.checked = false;
    confirmation.disabled = true;
    taskReviewStatus.dataset.kind = "needs-attention";
    taskReviewStatus.textContent = error.message;
  }
  taskPreview.replaceChildren();
  if (!lines.length) {
    const empty = element("p", "landlord-task-empty", "No tasks yet. Start speaking or type the room walkthrough.");
    empty.setAttribute("role", "listitem");
    taskPreview.append(empty);
    return;
  }
  const rooms = new Map();
  for (const line of lines) {
    const separator = line.indexOf(":");
    const room = separator > 0 ? line.slice(0, separator).trim() : "Needs a room name";
    const task = separator > 0 ? line.slice(separator + 1).trim() : line;
    if (!rooms.has(room)) rooms.set(room, []);
    rooms.get(room).push(task || "Add a specific cleaning task");
  }
  for (const [room, tasks] of rooms) {
    const group = element("section", "landlord-task-room");
    group.setAttribute("role", "listitem");
    group.append(element("strong", "", room));
    const list = element("ul");
    tasks.forEach((task) => list.append(element("li", "", task)));
    group.append(list);
    taskPreview.append(group);
  }
}

function formatQuotedDuration(minutes) {
  const value = Number(minutes);
  if (!Number.isInteger(value) || value < 1) return "";
  const hours = Math.floor(value / 60);
  const remainingMinutes = value % 60;
  if (!hours) return `${remainingMinutes} ${remainingMinutes === 1 ? "minute" : "minutes"}`;
  if (!remainingMinutes) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return `${hours} ${hours === 1 ? "hour" : "hours"} ${remainingMinutes} ${remainingMinutes === 1 ? "minute" : "minutes"}`;
}

function clearManualQuote(message = "Review and confirm the room checklist to see a server-calculated estimate before submission.") {
  manualQuoteGeneration += 1;
  manualQuoteSignature = "";
  window.clearTimeout(manualQuoteTimer);
  manualQuote.hidden = true;
  manualQuoteStatus.textContent = message;
}

function currentManualPricingRequest() {
  if (!pricingReady) return { message: "Price estimates are temporarily unavailable. You can keep your draft and retry before matching." };
  const cleaningType = String(requestForm.elements.cleaningType.value || "");
  if (!cleaningType) return { message: "Choose a cleaning service to calculate the current estimate." };
  try {
    const tasks = optionalRequestScope(requestForm.elements.tasks.value, { cleaningType }).tasks;
    return { pricingRequest: pricingRequestFromManualTasks(tasks, {
      cleaningType,
      frequency: String(requestForm.elements.frequency.value || "one-time"),
      requestedMinutes: Number(requestForm.elements.durationMinutes.value)
    }) };
  } catch (error) {
    return { message: error.message };
  }
}

async function refreshManualQuote(generation, pricingRequest, signature) {
  manualQuote.hidden = false;
  manualQuotePrice.textContent = "Calculating…";
  manualQuoteDuration.textContent = "Calculating…";
  manualQuoteStatus.textContent = "Checking the current Homle price for these confirmed rooms and tasks…";
  const csrf = await recoverCsrf(manualQuoteStatus, "calculating this estimate");
  if (!csrf || generation !== manualQuoteGeneration) return;
  try {
    const result = await requestJson("/api/marketplace/pricing/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify(pricingRequest)
    });
    if (generation !== manualQuoteGeneration) return;
    const totalPence = Number(result.quote?.totalPence);
    const duration = formatQuotedDuration(result.quote?.estimatedMinutes);
    if (result.quote?.priceable !== true || !Number.isInteger(totalPence) || totalPence < 1 || !duration) {
      throw new Error(result.quote?.reason || "A current estimate is unavailable.");
    }
    manualQuoteSignature = signature;
    manualQuotePrice.textContent = formatBookingMoney(totalPence);
    manualQuoteDuration.textContent = duration;
    manualQuoteStatus.textContent = "Server-calculated estimate. The final total is frozen when you approve a Cleaner.";
  } catch (error) {
    if (generation !== manualQuoteGeneration) return;
    manualQuote.hidden = true;
    manualQuoteStatus.textContent = `${error.message} Your entries are still here; you can retry before matching.`;
  }
}

function scheduleManualQuote() {
  window.clearTimeout(manualQuoteTimer);
  const generation = ++manualQuoteGeneration;
  const candidate = currentManualPricingRequest();
  if (!candidate.pricingRequest) {
    manualQuoteSignature = "";
    manualQuote.hidden = true;
    manualQuoteStatus.textContent = candidate.message;
    return;
  }
  const signature = JSON.stringify(candidate.pricingRequest);
  if (signature === manualQuoteSignature && !manualQuote.hidden) return;
  manualQuote.hidden = false;
  manualQuotePrice.textContent = "Calculating…";
  manualQuoteDuration.textContent = "Calculating…";
  manualQuoteStatus.textContent = "Preparing the current estimate…";
  manualQuoteTimer = window.setTimeout(() => { void refreshManualQuote(generation, candidate.pricingRequest, signature); }, 450);
}

function renderCompletionQuote(quote, { saved = false } = {}) {
  const totalPence = Number(quote?.quotedTotalPence ?? quote?.totalPence);
  const duration = formatQuotedDuration(quote?.quotedMinutes ?? quote?.estimatedMinutes);
  if (!Number.isInteger(totalPence) || totalPence < 1 || !duration) return false;
  requestCompletePriceLabel.textContent = saved ? "Saved price estimate" : "Current price estimate";
  requestCompletePrice.textContent = formatBookingMoney(totalPence);
  requestCompleteDuration.textContent = duration;
  requestCompleteQuote.hidden = false;
  requestCompleteQuoteNote.hidden = false;
  requestCompleteQuoteNote.textContent = saved
    ? "This estimate is saved with this request. Stripe checkout opens only after a Cleaner accepts the exact scope, time and total."
    : "This current estimate was recovered from your confirmed tasks. Choose a Cleaner to freeze the final total. Real Stripe checkout opens after they accept.";
  return true;
}

async function recoverCompletionQuote(requestId) {
  const source = requests.find((request) => request.requestId === requestId);
  if (!source || !Array.isArray(source.tasks) || !source.tasks.length) return;
  const csrf = storedCsrf();
  if (!csrf) return;
  requestCompleteQuote.hidden = false;
  requestCompleteQuoteNote.hidden = false;
  requestCompletePriceLabel.textContent = "Current price estimate";
  requestCompletePrice.textContent = "Calculating…";
  requestCompleteDuration.textContent = "Calculating…";
  requestCompleteQuoteNote.textContent = "Checking the current Homle price for the confirmed rooms and tasks…";
  try {
    const requestedMinutes = Math.round((Date.parse(source.requestedEndAt) - Date.parse(source.requestedStartAt)) / 60_000);
    const pricingRequest = pricingRequestFromManualTasks(source.tasks, {
      cleaningType: source.cleaningType,
      frequency: source.frequency,
      requestedMinutes
    });
    const result = await requestJson("/api/marketplace/pricing/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify(pricingRequest)
    });
    if (completedRequestId !== requestId) return;
    if (!renderCompletionQuote(result.quote)) throw new Error(result.quote?.reason || "A current estimate is unavailable.");
  } catch (error) {
    if (completedRequestId !== requestId) return;
    requestCompleteQuote.hidden = false;
    requestCompleteQuoteNote.hidden = false;
    requestCompletePrice.textContent = "Unavailable";
    requestCompleteDuration.textContent = "Unavailable";
    requestCompleteQuoteNote.textContent = `${error.message} Your request is saved, but Homle could not verify an estimate. Please retry from Bookings before choosing a Cleaner.`;
  }
}

function showRequestCompletion(submission, { automaticDispatch = false, automaticMaximumPricePence = null, selectedCleanerInvited = false, selectedCleanerPricePence = null, warning = "" } = {}) {
  closeRequestPhotoDialog();
  currentRequestDraft = null;
  requestForm.reset();
  delete cleaningTypeSelect.dataset.selectionSource;
  initialiseRequestDefaults();
  renderTaskPreview();
  requestDirty = false;
  const photos = Number(submission?.photoCount);
  const tasks = Number(submission?.taskCount);
  const quotedTotalPence = Number(submission?.quotedTotalPence);
  const quotedDuration = formatQuotedDuration(submission?.quotedMinutes);
  const quoteReady = Number.isInteger(quotedTotalPence) && quotedTotalPence >= 1 && Boolean(quotedDuration);
  requestCompleteReference.textContent = submission?.cleaningRequestId || "Recorded privately";
  requestCompleteCounts.textContent = `${Number.isInteger(photos) ? photos : 0} room ${photos === 1 ? "photo" : "photos"} · ${Number.isInteger(tasks) ? tasks : 0} concise Cleaner ${tasks === 1 ? "task" : "tasks"}`;
  requestCompleteQuote.hidden = true;
  requestCompleteQuoteNote.hidden = true;
  if (quoteReady) renderCompletionQuote({ quotedTotalPence, quotedMinutes: submission?.quotedMinutes }, { saved: true });
  requestCompleteLead.textContent = warning
    ? "Your reviewed scan is submitted for matching. No booking or payment exists yet."
    : selectedCleanerInvited
    ? `Your reviewed scan is submitted and the selected Cleaner has been invited at ${formatBookingMoney(selectedCleanerPricePence)}. This becomes a booking only if they accept.`
    : automaticDispatch
    ? `Your reviewed scan is submitted and Homle is authorised to invite an eligible profitable match costing no more than ${formatBookingMoney(automaticMaximumPricePence)} within your chosen attempt limit.`
    : "Your reviewed scan is submitted for matching. No Cleaner has been invited automatically.";
  requestCompleteWarning.textContent = warning;
  requestCompleteWarning.hidden = !warning;
  // The health response is the server-owned capability boundary. Advertising a
  // checkout that the same deployment says is detached produces a guaranteed
  // dead end and makes a failed navigation look like a failed payment.
  requestCompleteSandbox.hidden = !paymentsReady;
  requestCompleteSandboxNote.hidden = !paymentsReady;
  requestCompleteSandboxUnavailable.hidden = paymentsReady;
  completedRequestId = String(submission?.cleaningRequestId || "");
  if (!quoteReady && completedRequestId) void recoverCompletionQuote(completedRequestId);
  requestCompleteNext.textContent = selectedCleanerInvited || automaticDispatch ? "Track Cleaner response" : "Choose Cleaner & exact price";
  // The dashboard remains the stable page. Replace the form inside its
  // already-open modal with the completion step instead of revealing a
  // separate full-page result.
  requestBuilderPanel.hidden = true;
  requestComplete.hidden = false;
  requestBuilderDialog?.classList.add("is-completion-sequence");
  if (requestBuilderDialog && !requestBuilderDialog.open) requestBuilderDialog.showModal();
  requestComplete.focus();
}

/**
 * Runs dismissal work for a <dialog> in every engine still in use.
 *
 * Dismissal used to be one signal: close() removed [open] and a `close` event
 * followed. Chrome has since moved dialogs onto the popover ToggleEvent model,
 * so a dismissal now also fires `beforetoggle` and `toggle` (newState
 * "closed"), and `toggle` is the signal newer code is written against.
 *
 * A report of the deployed dashboard concluded that `close` had stopped being
 * delivered in Chrome 151 and that every consequence below was therefore dead
 * in production. That did not reproduce. Measured on this file's own builder
 * dialog in headless Chrome 151, dismissal fires `toggle` (newState "closed")
 * and then `close`, and the teardown runs: the address moves from
 * /landlord/requests to /landlord/bookings. A synthetic dialog agrees across
 * both same-task and deferred close(), with and without a `beforetoggle`
 * listener attached. So `close` alone was not broken here.
 *
 * Both signals are still subscribed, deliberately. The cost is one extra
 * listener; the benefit is that dismissal work does not depend on which of two
 * overlapping models a given engine or configuration favours, and this is the
 * booking path — a dismissal that goes unheard strands a price approval
 * awaiting forever. Robustness, not a fix for a confirmed defect.
 *
 * Because current Chrome delivers BOTH events, every handler passed here runs
 * twice per dismissal. That is safe only because each guards on the state it is
 * about to change, and the render suite dismisses a real dialog to prove the
 * outcome is single and correct. Keep that property in anything added here.
 */
function onDialogDismissal(dialog, handler) {
  if (!dialog) return;
  dialog.addEventListener("close", handler);
  dialog.addEventListener("toggle", (event) => { if (event.newState === "closed") handler(); });
}

/** One dismissal only: both listeners detach as soon as either signal lands. */
function onceDialogDismissal(dialog, handler) {
  const onToggle = (event) => { if (event.newState === "closed") finish(); };
  const finish = () => {
    dialog.removeEventListener("close", finish);
    dialog.removeEventListener("toggle", onToggle);
    handler();
  };
  dialog.addEventListener("close", finish);
  dialog.addEventListener("toggle", onToggle);
}

function approveInvitationQuote(quote, cleanerName) {
  const pricePence = Number(quote?.customerPricePence);
  if (!Number.isInteger(pricePence) || pricePence < 1 || pricePence > 10_000_000) throw new Error("The exact booking total could not be verified.");
  const formattedPrice = formatBookingMoney(pricePence);
  invitationQuoteCleaner.textContent = cleanerName || "Selected Cleaner";
  invitationQuotePrice.textContent = formattedPrice;
  invitationQuoteApprove.textContent = `Invite for ${formattedPrice}`;
  if (typeof invitationQuoteDialog.showModal !== "function") return Promise.resolve(window.confirm(`Invite ${cleanerName || "this Cleaner"} for the exact total ${formattedPrice}? No payment is taken now.`));
  invitationQuoteDialog.returnValue = "";
  return new Promise((resolve) => {
    onceDialogDismissal(invitationQuoteDialog, () => resolve(invitationQuoteDialog.returnValue === "approve"));
    invitationQuoteDialog.showModal();
  });
}

let matchOutcomeRequestId = "";

function showNoEligibleCleanerOutcome(requestId) {
  const request = requests.find((item) => item.requestId === requestId);
  const property = properties.find((item) => item.propertyId === request?.propertyId);
  matchOutcomeRequestId = requestId;
  matchOutcomeTitle.textContent = "No Cleaner is free at this time";
  matchOutcomeCopy.textContent = "Homle checked current service fit, travel coverage and availability. There is no eligible Cleaner to quote for this exact time yet.";
  matchOutcomePlace.textContent = property?.name || "Saved property";
  matchOutcomeTime.textContent = request?.requestedStartAt ? formatBookingMoment(request.requestedStartAt) : "Selected time";
  showMatchOutcomeStep("result");
  if (typeof matchOutcomeDialog.showModal !== "function") {
    window.alert(`${matchOutcomeTitle.textContent}. ${matchOutcomeCopy.textContent} Your request remains open.`);
    return;
  }
  if (!matchOutcomeDialog.open) matchOutcomeDialog.showModal();
}

function showMatchOutcomeStep(step) {
  const timing = step === "timing";
  matchOutcomeDialog?.setAttribute("aria-labelledby", "match-outcome-title");
  matchOutcomeDialog?.removeAttribute("aria-label");
  if (matchOutcomeSequence) matchOutcomeSequence.hidden = false;
  if (matchOutcomeResult) matchOutcomeResult.hidden = timing;
  if (matchOutcomeTiming) matchOutcomeTiming.hidden = !timing;
  if (matchOutcomeFeedback) matchOutcomeFeedback.hidden = true;
}

function prepareAnotherTime(requestId) {
  const request = requests.find((item) => item.requestId === requestId);
  if (!request) return;
  const start = new Date(request.requestedStartAt);
  const end = new Date(request.requestedEndAt);
  matchOutcomeDate.min = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  if (!Number.isNaN(start.getTime())) {
    const localStart = new Date(start.getTime() - start.getTimezoneOffset() * 60_000).toISOString();
    matchOutcomeDate.value = localStart.slice(0, 10);
    matchOutcomeStart.value = localStart.slice(11, 16);
  }
  if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
    const durationMinutes = String(Math.round((end.getTime() - start.getTime()) / 60_000));
    if ([...matchOutcomeDuration.options].some((option) => option.value === durationMinutes)) matchOutcomeDuration.value = durationMinutes;
  }
  showMatchOutcomeStep("timing");
  matchOutcomeDate.focus({ preventScroll: true });
}

async function continueAnotherTime(requestId) {
  const request = requests.find((item) => item.requestId === requestId);
  if (!request || !matchOutcomeDate.value || !matchOutcomeStart.value || !matchOutcomeDuration.value) {
    showFeedback(matchOutcomeFeedback, "Choose a date, start time and duration to continue.", "error");
    return;
  }
  let requestedTimeWindow;
  try {
    requestedTimeWindow = requestedWindow(matchOutcomeDate.value, matchOutcomeStart.value, matchOutcomeDuration.value, new Date());
  } catch (error) {
    showFeedback(matchOutcomeFeedback, error.message, "error");
    return;
  }
  setPending(matchOutcomeContinue, true, "Updating time…");
  const csrf = await recoverCsrf(matchOutcomeFeedback, "updating the requested time");
  if (!csrf) {
    setPending(matchOutcomeContinue, false, "Update time and check again");
    return;
  }
  try {
    const result = await requestJson(`/api/marketplace/cleaning-requests/${encodeURIComponent(requestId)}/reschedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ requestedStartAt: requestedTimeWindow.requestedStartAt })
    });
    if (result.reschedule?.cleaningRequestId !== requestId || result.reschedule?.status !== "searching-for-cleaner") throw new Error("The updated request could not be verified. Refresh before trying again.");
    requests = requests.map((item) => item.requestId === requestId ? { ...item, ...result.reschedule } : item);
    matchOutcomeDialog.close();
    await refreshBookingTransition();
    showFeedback(requestStatus, `Time updated to ${formatBookingMoment(result.reschedule.requestedStartAt)}. Homle is checking eligible Cleaners now.`, "success");
    await inviteBestEligibleCleaner(requestId, matchOutcomeContinue, requestStatus, { idleLabel: "Update time and check again" });
  } catch (error) {
    showFeedback(matchOutcomeFeedback, error.message, "error");
  } finally {
    if (matchOutcomeContinue.isConnected) setPending(matchOutcomeContinue, false, "Update time and check again");
  }
}

function selectedCleanerInvitationRecovery(error) {
  if (error?.code === "cleaner-payout-not-ready") {
    return "The room scan is safely submitted, but the selected Cleaner is not currently ready to receive this paid booking. No invitation or payment was created. Open the saved request and use the best eligible match instead.";
  }
  return `The room scan is safely submitted, but Homle could not verify the selected-Cleaner invitation: ${error.message} Track the saved request before taking another action; Homle will not repeat an invitation automatically.`;
}

function automaticMaximumPrice(request) {
  const value = Number(request?.budgetPence);
  return Number.isInteger(value) && value >= 1 && value <= 10_000_000 ? value : null;
}

function approveAutomaticDispatchPrice(maximumPricePence, attemptLimit) {
  if (!Number.isInteger(maximumPricePence) || maximumPricePence < 1 || maximumPricePence > 10_000_000) throw new Error("Add a maximum booking total before authorizing automatic matching.");
  const formattedPrice = formatBookingMoney(maximumPricePence);
  const boundedAttempts = Number(attemptLimit);
  dispatchPriceMaximum.textContent = formattedPrice;
  dispatchPriceAttempts.textContent = `Homle may make ${boundedAttempts === 1 ? "one invitation attempt" : `up to ${boundedAttempts} invitation attempts`} for this one clean, but no quoted total may exceed ${formattedPrice}. No payment is taken now, and a Cleaner must still accept.`;
  dispatchPriceApprove.textContent = `Approve maximum ${formattedPrice}`;
  if (typeof dispatchPriceDialog.showModal !== "function") return Promise.resolve(window.confirm(`Allow Cleaner matching only when the exact total is ${formattedPrice} or less? No payment is taken now.`));
  dispatchPriceDialog.returnValue = "";
  return new Promise((resolve) => {
    onceDialogDismissal(dispatchPriceDialog, () => resolve(dispatchPriceDialog.returnValue === "approve"));
    dispatchPriceDialog.showModal();
  });
}

function selectedCleanerInitials(name) {
  const parts = String(name || "Cleaner").trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)[0]}` : parts[0]?.slice(0, 2) || "C").toLocaleUpperCase("en-GB");
}

function safePublicPhoto(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : "";
  } catch { return ""; }
}

function renderSelectedCleaner() {
  const visible = Boolean(selectedCleanerId) || ["unavailable", "error"].includes(selectedCleanerVerificationState);
  selectedCleanerSummary.hidden = !visible;
  if (!visible) return;
  const ready = selectedCleanerVerificationState === "ready" && selectedCleanerProfile;
  const displayName = ready ? selectedCleanerProfile.displayName : selectedCleanerVerificationState === "unavailable" ? "Cleaner no longer available" : selectedCleanerVerificationState === "error" ? "Selection not verified" : "Checking current public profile…";
  selectedCleanerName.textContent = displayName;
  selectedCleanerAvatar.replaceChildren(document.createTextNode(selectedCleanerInitials(displayName)));
  if (ready) {
    const photo = safePublicPhoto(selectedCleanerProfile.profilePhotoUrl);
    if (photo) {
      const image = document.createElement("img");
      image.src = photo;
      image.alt = "";
      image.width = 56;
      image.height = 56;
      image.decoding = "async";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("error", () => selectedCleanerAvatar.replaceChildren(document.createTextNode(selectedCleanerInitials(displayName))), { once: true });
      selectedCleanerAvatar.replaceChildren(image);
    }
    const rating = Number(selectedCleanerProfile.averageRating);
    const reviews = Number(selectedCleanerProfile.reviewCount);
    const reputation = Number.isFinite(rating) && reviews > 0 ? `${rating.toFixed(1)} stars from ${reviews} completed-job ${reviews === 1 ? "review" : "reviews"}` : "No completed-job reviews yet";
    selectedCleanerEvidence.textContent = `${reputation} · ${Array.isArray(selectedCleanerProfile.services) ? selectedCleanerProfile.services.length : 0} active ${selectedCleanerProfile.services?.length === 1 ? "service" : "services"}`;
    selectedCleanerStatus.textContent = "Verified from the Cleaner’s current public profile. This is still not a booking or invitation.";
  } else if (selectedCleanerVerificationState === "unavailable") {
    selectedCleanerEvidence.textContent = "The profile is no longer public and has been removed from this request. Homle will use normal matching instead.";
    selectedCleanerStatus.textContent = "No Cleaner was invited and no booking or payment was created.";
  } else if (selectedCleanerVerificationState === "error") {
    selectedCleanerEvidence.textContent = "Homle could not verify the current public profile. Direct invitation stays disabled until a fresh verification succeeds.";
    selectedCleanerStatus.textContent = "Refresh this dashboard, change Cleaner, or use the best eligible match instead.";
  } else {
    selectedCleanerEvidence.textContent = "Homle is verifying this selection before it can be invited.";
    selectedCleanerStatus.textContent = "Private contact details and exact location are never loaded here.";
  }
}

function clearSelectedCleanerChoice({ keepNotice = false } = {}) {
  try { clearSelectedCleaner(localStorage); } catch {}
  selectedCleanerId = "";
  selectedCleanerProfile = null;
  if (!keepNotice) selectedCleanerVerificationState = "none";
  renderSelectedCleaner();
}

function clearCleanerSelection() {
  clearSelectedCleanerChoice();
  try { clearSelectedProperty(sessionStorage); } catch {}
  selectedPropertyId = "";
}

async function refreshSelectedCleanerProfile() {
  if (!selectedCleanerId) return renderSelectedCleaner();
  selectedCleanerVerificationState = "loading";
  selectedCleanerProfile = null;
  renderSelectedCleaner();
  try {
    const result = await requestJson(`/api/marketplace/cleaners/${encodeURIComponent(selectedCleanerId)}`);
    if (!result.cleaner || result.cleaner.cleanerId !== selectedCleanerId) throw new Error("Homle returned a different Cleaner profile.");
    selectedCleanerProfile = result.cleaner;
    selectedCleanerVerificationState = "ready";
  } catch (error) {
    if (error.statusCode === 404) {
      selectedCleanerVerificationState = "unavailable";
      clearSelectedCleanerChoice({ keepNotice: true });
    } else selectedCleanerVerificationState = "error";
  }
  renderSelectedCleaner();
  renderRequests();
}

/**
 * Which panel this URL asks for.
 *
 * The pathname wins, because /landlord/properties is a destination someone can
 * bookmark or send to a colleague. The hash form is still read: it is what the
 * dashboard used until now, so saved links and any open tab keep working.
 */
function workspaceTabFromLocation() {
  const path = /^\/landlord\/(home|properties|bookings|messages|requests|account|payments)\/?$/.exec(location.pathname);
  // Properties is part of Bookings now. The old address still resolves rather
  // than 404ing a link someone bookmarked or sent to a colleague.
  if (path) return path[1] === "properties" ? "places" : path[1];
  // /landlord/dashboard is the canonical entry point and now opens Home, which
  // is the view the v2 design leads with.
  if (/^\/landlord\/dashboard\/?$/.test(location.pathname)) return "home";
  const hash = /^#landlord-(properties|requests|account|bookings)$/.exec(location.hash);
  if (hash) return hash[1] === "properties" ? "places" : hash[1];
  // The Bookings section kept its original id, so the anchor that used to scroll
  // to it now selects the view instead of landing on a hidden panel.
  if (location.hash === "#landlord-bookings") return "bookings";
  if (location.hash === "#your-places") return "places";
  return "";
}

// Retained under the old name so nothing that calls it has to change.
function workspaceTabFromHash() {
  return workspaceTabFromLocation();
}

const requestBuilderMount = document.querySelector("[data-request-builder-mount]");
const requestBuilderPanel = document.querySelector('[data-landlord-panel="requests"]');
const requestBuilderDialog = document.querySelector("[data-request-builder-dialog]");
const requestBuilderToggle = requestBuilderPanel?.querySelector("[data-pac-toggle]");
// The mount now sits inside the dialog, so this single move puts the working
// builder into the overlay. It is the same element with the same listeners and
// the same form state — only its parent differs.
if (requestBuilderMount && requestBuilderPanel) requestBuilderMount.replaceWith(requestBuilderPanel);
// Submission is the last step of the same request journey, not a new page.
// Keep the dashboard mounted underneath and move the existing completion card
// into this dialog beside the working builder. This preserves the request,
// quote and Stripe-test behaviour while preventing a full-page takeover.
if (requestBuilderDialog && requestComplete) requestBuilderDialog.append(requestComplete);

function hideRequestCompletion() {
  if (!requestComplete || requestComplete.hidden) return;
  requestComplete.hidden = true;
  requestBuilderDialog?.classList.remove("is-completion-sequence");
}
// Closing by Escape or the backdrop has to run the same teardown as the Hide
// control, or the panel would stay flagged as open and refuse to reopen.
onDialogDismissal(requestBuilderDialog, () => {
  hideRequestCompletion();
  if (requestBuilderPanel && !requestBuilderPanel.hidden) setRequestBuilderExpanded(false);
  // The builder is a view, so closing it has to land on a real one. Without
  // this, Escape or the backdrop leaves the address on /landlord/requests with
  // the builder hidden and nothing in its place: an empty page whose heading
  // reads "Properties" while the navigation still marks Bookings.
  // selectWorkspaceTab assigns currentWorkspaceTab before it closes this
  // dialog, so switching to another view never reaches this branch — and the
  // same guard is what lets this handler run twice harmlessly in an engine
  // that delivers both dismissal signals.
  if (currentWorkspaceTab === "requests") selectWorkspaceTab("bookings", { historyMode: "replace" });
});
requestBuilderDialog?.addEventListener("click", (event) => {
  // A modal backdrop click targets the dialog itself. Keep clicks inside the
  // white sheet inert so form controls never close the request accidentally.
  if (event.target !== requestBuilderDialog) return;
  const box = requestBuilderDialog.getBoundingClientRect();
  const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
  if (!inside) setRequestBuilderExpanded(false);
});

// Properties merged into Bookings. The panel moves into the hub between the
// account totals and the completed work, which is the order the design puts it
// in; nothing inside it changes, so the property form, the archive dialog and
// every data hook keep working exactly as before.
const placesMount = document.querySelector("[data-places-mount]");
const placesPanel = document.querySelector('[data-landlord-panel="properties"]');
if (placesMount && placesPanel) placesMount.replaceWith(placesPanel);

function setRequestBuilderExpanded(expanded) {
  if (!requestBuilderPanel) return;
  // The builder is its own view now. It used to sit collapsed at the foot of
  // every panel, which in the v2 layout would put a second "Manual request"
  // banner directly under the Manual card on Home offering the same thing.
  requestBuilderPanel.hidden = !expanded;
  requestBuilderPanel.classList.toggle("pac-collapsed", !expanded);
  if (requestBuilderToggle) {
    requestBuilderToggle.setAttribute("aria-expanded", String(expanded));
    // The words came off this control, not the control itself. It is the only
    // visible way out of the builder — Escape and a backdrop click are the
    // others, and neither is discoverable — and leaving a Landlord inside a
    // view with no visible exit is a defect this workspace has already fixed
    // once. So: an unlabelled glyph carrying its name for assistive tech.
    requestBuilderToggle.textContent = expanded ? "×" : "+";
    requestBuilderToggle.setAttribute("aria-label", expanded ? "Close the cleaning request builder" : "Open the cleaning request builder");
    requestBuilderToggle.title = expanded ? "Close" : "Open";
  }
  // The design opens this over the hub instead of pushing the page down, and
  // closing it leaves the reader where they were. showModal() does exactly
  // that: the page underneath keeps its scroll position, so nothing has to be
  // recorded or restored by hand.
  if (!requestBuilderDialog) return;
  if (expanded) {
    if (!requestBuilderDialog.open) requestBuilderDialog.showModal();
  } else if (requestBuilderDialog.open) requestBuilderDialog.close();
}

// The stepped wizard is 23KB that only the Prepare-a-clean panel uses, and it
// was parsed on every dashboard load — including the far more common visits that
// only check a booking. It is explicitly progressive enhancement: its own header
// says the request builder is "a complete, working private draft form on its
// own" and that this file only PRESENTS it. landlord-dashboard.js references
// none of the fields it builds, and keeps owning validation, speech, recovery
// and submit.
//
// So it loads when the panel it decorates is first opened. If that load fails —
// offline, cache miss — the form stays fully usable as the long-hand version it
// already is, which is the guarantee progressive enhancement was making all
// along and which a static <script> tag never actually tested.
let prepareWizardLoad = null;
function loadPrepareWizard() {
  if (prepareWizardLoad) return prepareWizardLoad;
  prepareWizardLoad = import("./landlord-prepare-wizard.js?v=20260723-2").catch((error) => {
    // Deliberately quiet: the panel below is a working form without this.
    console.warn("The stepped wizard could not load; the request form remains usable.", error);
  });
  return prepareWizardLoad;
}

/**
 * The title and standfirst for each view, so the top bar says where you are.
 *
 * `requests` deliberately reuses the Properties heading: selecting it expands the
 * builder underneath the Properties panel rather than replacing the view, which
 * is the behaviour that was already here.
 */
const workspaceTabCopy = {
  home: { title: "Hello, {name}", subtitle: "Let’s keep your property spotless." },
  properties: { title: "Properties", subtitle: "The locations saved privately to your account." },
  bookings: { title: "Bookings", subtitle: "Everything for every place you own." },
  places: { title: "Bookings", subtitle: "Everything for every place you own." },
  messages: { title: "Messages", subtitle: "Talk to the Cleaner working on your property." },
  account: { title: "Your account", subtitle: "Details, security, payments and preferences — one place, opened as needed." },
  payments: { title: "Payments", subtitle: "What each booking costs, and where its authorisation has reached." },
  requests: { title: "Properties", subtitle: "The locations saved privately to your account." }
};

const viewTitle = document.querySelector("[data-view-title]");
const viewSubtitle = document.querySelector("[data-view-subtitle]");

/**
 * The Landlord's name lives here, not in the heading.
 *
 * Only the Home greeting renders it, and switching to any other view replaces
 * that heading's contents — so reading the name back out of the DOM would lose
 * it the first time someone visited Properties and came back.
 */
let landlordDisplayName = "Landlord";

function setLandlordDisplayName(name) {
  landlordDisplayName = name || "Landlord";
  const named = document.querySelector("[data-landlord-name]");
  if (named) named.textContent = landlordDisplayName;
}

function renderWorkspaceHeading(selected) {
  const copy = workspaceTabCopy[selected] || workspaceTabCopy.home;
  if (viewSubtitle) viewSubtitle.textContent = copy.subtitle;
  if (!viewTitle) return;
  if (copy.title.includes("{name}")) {
    const [before, after] = copy.title.split("{name}");
    const holder = element("span", "", landlordDisplayName);
    holder.setAttribute("data-landlord-name", "");
    viewTitle.replaceChildren(document.createTextNode(before), holder, document.createTextNode(after));
  } else {
    viewTitle.textContent = copy.title;
  }
}

// Opening and closing the builder is core dashboard navigation, not optional
// wizard decoration. Keeping this listener here means the visible Reveal/Hide
// control works even while the progressively loaded wizard is still arriving
// (or if that enhancement cannot load on a weak connection). The wizard owns
// fields and steps; this controller alone owns the modal and collapsed state.
requestBuilderToggle?.addEventListener("click", (event) => {
  event.preventDefault();
  const expanded = requestBuilderToggle.getAttribute("aria-expanded") === "true";
  setRequestBuilderExpanded(!expanded);
  if (!expanded) void loadPrepareWizard();
});

function markCurrentNavigation(selected) {
  // Both navs point at the same destinations, so both are marked from one place.
  for (const link of document.querySelectorAll(".landlord-dashboard-nav a, .ld-mobile-nav a")) {
    const section = link.dataset.openLandlordSection;
    const current = (section === selected && selected !== "places")
    || (selected === "requests" && section === "bookings")
    || (selected === "properties" && section === "bookings")
    || (selected === "places" && section === "bookings")
    || (selected === "payments" && section === "account");
    if (current) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}

// Which view is on screen. Needed because bookings arrive AFTER first paint,
// and the Messages view has to be rebuilt when they do.
let currentWorkspaceTab = "";

function selectWorkspaceTab(name, { historyMode = "" } = {}) {
  const selected = ["home", "properties", "bookings", "places", "messages", "requests", "account", "payments"].includes(name) ? name : "home";
  currentWorkspaceTab = selected;
  // Properties merged into Bookings: one connected flow rather than a separate
  // tab holding the places the bookings are for. The panel still exists — its
  // form, archive dialog and every data hook are unchanged — it is simply shown
  // as part of the hub instead of on its own.
  document.querySelectorAll('[data-landlord-panel]:not([data-landlord-panel="requests"])').forEach((panel) => {
    const panelName = panel.dataset.landlordPanel;
    const visible = selected === "requests"
      ? panelName === "properties"
      : selected === "bookings" || selected === "places" || selected === "properties"
        ? panelName === "bookings" || panelName === "properties"
        : panelName === selected;
    panel.hidden = !visible;
  });
  setRequestBuilderExpanded(selected === "requests");
  if (selected === "requests") loadPrepareWizard();
  renderWorkspaceHeading(selected);
  // Switching views replaces the whole main region without a page load, so a
  // screen reader heard nothing and the keyboard position stayed on the link
  // just activated. Focusing the freshly written heading both announces the new
  // view and moves the caret into it. Guarded on "push" so first paint and Back
  // (both "replace") do not steal focus.
  if (historyMode === "push") viewTitle?.focus({ preventScroll: true });
  markCurrentNavigation(selected);
  if (selected === "home") renderHomeView();
  // Loaded when the view is opened rather than on every dashboard visit: most
  // visits never open Messages, and the conversation list needs bookings that
  // have already been fetched anyway.
  if (selected === "messages") void openMessages();
  // A real path, not a fragment, so the address bar names where the Landlord
  // is, Back returns to the previous panel, and the link can be shared.
  const url = selected === "places" ? "/landlord/bookings" : `/landlord/${selected}`;
  // Only a move between views is worth a history entry. Tapping the view you
  // are already on used to push a duplicate, so Back had to be pressed once per
  // tap before anything moved and read as broken. Places and Bookings share an
  // address, so this also covers scrolling to Your places from the Bookings hub.
  const samePlace = url === location.pathname && history.state?.landlordTab === selected;
  const mode = historyMode === "push" && samePlace ? "replace" : historyMode;
  if (mode === "push") history.pushState({ landlordTab: selected }, "", url);
  if (mode === "replace") history.replaceState({ landlordTab: selected }, "", url);
  if (selected === "places") {
    requestAnimationFrame(() => document.querySelector("[data-places-section]")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
}

function continueBookingStart() {
  if (!bookingStart) return;
  if (!properties.length) {
    openPropertyEditor();
    return;
  }
  selectWorkspaceTab("requests");
  if (selectedPropertyId && properties.some((property) => property.propertyId === selectedPropertyId)) propertySelect.value = selectedPropertyId;
  else {
    try { clearSelectedProperty(sessionStorage); } catch {}
    selectedPropertyId = "";
    if (properties.length === 1) propertySelect.value = properties[0].propertyId;
  }
  applySuggestedCleaningType();
  requestForm.scrollIntoView({ behavior: "smooth", block: "start" });
  (propertySelect.value ? requestForm.elements.requestedDate : propertySelect).focus({ preventScroll: true });
}

/**
 * Opens the Messages view against the bookings already in memory.
 *
 * Imported on demand for the same reason the stepped wizard is: a Landlord who
 * only checks a booking should not parse a conversation client they never open.
 * A failed import leaves the panel with its own empty state rather than a blank
 * screen.
 */
let landlordMessagesLoad = null;
let landlordMessagesOpenSequence = 0;
async function openMessages() {
  const sequence = ++landlordMessagesOpenSequence;
  const panel = document.querySelector('[data-landlord-panel="messages"]');
  panel?.setAttribute("aria-busy", "true");
  try {
    if (!landlordMessagesLoad) {
      landlordMessagesLoad = import("./landlord-messages.js?v=20260813-1").catch((error) => {
        console.warn("The Messages view could not be loaded.", error);
        return null;
      });
    }
    const module = await landlordMessagesLoad;
    if (!module) return;
    await module.openLandlordMessages({
      requestJson,
      bookings,
      selectBookingId: new URLSearchParams(location.search).get("bookingId") || ""
    });
  } finally {
    // loadWorkspace can refresh the booking list while the first lazy import is
    // still resolving. Only the newest open owns the settled state; an older
    // request must not announce that Messages is ready while the refreshed
    // conversation is still loading.
    if (sequence === landlordMessagesOpenSequence) panel?.removeAttribute("aria-busy");
  }
}

async function requestJson(path, options = {}) {
  const { headers = {}, timeoutMs = 30_000, ...rest } = options;
  const mutation = Boolean(rest.method && rest.method !== "GET");
  if (browserOffline()) throw Object.assign(new Error(mutation
    ? "You are offline. This change was not sent; your entries are still here. Reconnect, then try again."
    : "You are offline. Reconnect to open your private workspace."), { code: "browser-offline" });
  const maximumAttempts = mutation ? 1 : 2;
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...rest, headers: { Accept: "application/json", ...headers }, signal: controller.signal });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 503 && attempt + 1 < maximumAttempts) {
          await new Promise((resolve) => window.setTimeout(resolve, safeReadWakeRetryDelayMs));
          continue;
        }
        throw Object.assign(new Error(result.error || result.message || "The account action could not be completed."), { statusCode: response.status, code: result.code });
      }
      return result;
    } catch (error) {
      if (browserOffline()) throw Object.assign(new Error(mutation
        ? "You went offline. This change may have reached Homle. Your entries are still here; reconnect and refresh to verify before trying again."
        : "You are offline. Reconnect to open your private workspace."), { code: "browser-offline" });
      if (error?.name === "AbortError") throw Object.assign(new Error(mutation
        ? "The connection took too long. This action may have completed. Your entries are still here; refresh the dashboard to check before trying again."
        : "The connection took too long. Check the connection and try again."), { code: "request-timeout" });
      throw error;
    } finally {
      window.clearTimeout(timer);
    }
  }
}

async function recoverCsrf(target, action) {
  const current = storedCsrf();
  if (current) return current;
  try {
    const result = await requestJson("/api/marketplace/auth/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!result.csrfToken || !saveCsrf(result.csrfToken)) throw new Error("This browser could not keep the renewed secure editing token.");
    return result.csrfToken;
  } catch (error) {
    showFeedback(target, error?.code === "browser-offline" ? error.message : `Your secure session could not be recovered. Sign in again before ${action}.`);
    return "";
  }
}

function exactAddress(property) {
  const address = property.exactAddress || {};
  return [address.addressLine1, address.addressLine2, address.locality, address.postcode].filter(Boolean).join(", ") || "Exact address unavailable";
}

function populatePropertyForm(property) {
  const address = property?.exactAddress || {};
  propertyForm.reset();
  propertyForm.elements.name.value = property?.name || "";
  propertyForm.elements.propertyType.value = property?.propertyType || "";
  propertyForm.elements.addressLine1.value = address.addressLine1 || "";
  propertyForm.elements.addressLine2.value = address.addressLine2 || "";
  propertyForm.elements.locality.value = address.locality || "";
  propertyForm.elements.postcode.value = address.postcode || "";
  propertyForm.elements.bedrooms.value = property?.bedrooms ?? "";
  propertyForm.elements.bathrooms.value = property?.bathrooms ?? "";
  propertyForm.elements.approximateSizeSqM.value = property?.approximateSizeSqM ?? "";
  propertyForm.elements.accessInstructions.value = property?.accessInstructions || "";
  propertyForm.elements.parkingInstructions.value = property?.parkingInstructions || "";
  propertyForm.elements.cleaningPreferences.value = property?.cleaningPreferences || "";
  propertyForm.elements.savedChecklist.value = tasksToLines(property?.savedChecklist);
  propertyForm.elements.specialNotes.value = property?.specialNotes || "";
}

function openPropertyEditor(property = null) {
  if (!propertyForm.hidden && propertyDirty && !window.confirm("Discard the unsaved property changes and open these details instead?")) return;
  editingPropertyId = property?.propertyId || "";
  populatePropertyForm(property);
  propertyFormTitle.textContent = property ? "Edit access and property details" : "Add the cleaning location";
  propertySave.textContent = property ? "Update protected details" : "Save property privately";
  propertyFeedback.hidden = true;
  propertyStatus.hidden = true;
  propertyDirty = false;
  propertyForm.querySelector(".dashboard-optional-fields").open = Boolean(property);
  propertyForm.hidden = false;
  selectWorkspaceTab("properties");
  if (propertyDialog && !propertyDialog.open) propertyDialog.showModal();
  (property ? propertyForm.elements.accessInstructions : propertyForm.elements.propertyType).focus({ preventScroll: true });
}

function closePropertyEditor() {
  if (propertyDirty && !window.confirm("Close and discard these unsaved property changes?")) return false;
  propertyForm.hidden = true;
  propertyForm.reset();
  editingPropertyId = "";
  propertyDirty = false;
  propertyFormTitle.textContent = "Add the cleaning location";
  propertySave.textContent = "Save property privately";
  if (propertyDialog?.open) propertyDialog.close();
  return true;
}

/* Cloned from a <template> in the markup, so no markup is ever parsed here. */
function cloneIcon(name) {
  const template = document.querySelector(`[data-ld-icon="${name}"]`);
  return template ? template.content.cloneNode(true) : document.createDocumentFragment();
}

// Every booking time the Landlord reads is Europe/London, because that is the
// zone the clean is actually scheduled in and the one the Cleaner turns up in.
// booking-summary-model.js pins it for the window and the moment; these local
// formatters did not, so one Happening now card could print its window in
// London time and its stage times in the device's zone. A Landlord reading it
// from anywhere but the UK saw two different times for the same clean.
const bookingZone = "Europe/London";

const shortDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: bookingZone });

function formatShortDate(value) {
  const parsed = Date.parse(value || "");
  return Number.isNaN(parsed) ? "—" : shortDate.format(new Date(parsed));
}

/** "2 Bedrooms · 1 Bathroom", falling back to the property type. */
function propertySubtitle(property) {
  const parts = [];
  const bedrooms = Number(property.bedrooms);
  const bathrooms = Number(property.bathrooms);
  if (Number.isFinite(bedrooms) && bedrooms > 0) parts.push(`${bedrooms} ${bedrooms === 1 ? "Bedroom" : "Bedrooms"}`);
  if (Number.isFinite(bathrooms) && bathrooms > 0) parts.push(`${bathrooms} ${bathrooms === 1 ? "Bathroom" : "Bathrooms"}`);
  if (!parts.length) return String(property.propertyType || "Property").replace(/-/g, " ");
  return parts.join(" · ");
}

/**
 * The room chips.
 *
 * A saved checklist already names its rooms, so those are used when present.
 * Otherwise the bedroom/bathroom counts are described rather than invented —
 * nothing here claims a room the Landlord has not told Homle about.
 */
function propertyRoomLabels(property) {
  const saved = Array.isArray(property.savedChecklist) ? property.savedChecklist : [];
  const named = [...new Set(saved.map((task) => String(task?.room || "").trim()).filter(Boolean))];
  if (named.length) return named.slice(0, 6);
  const labels = [];
  const bedrooms = Number(property.bedrooms);
  const bathrooms = Number(property.bathrooms);
  if (Number.isFinite(bedrooms) && bedrooms > 0) labels.push(bedrooms === 1 ? "Bedroom" : `${bedrooms} Bedrooms`);
  if (Number.isFinite(bathrooms) && bathrooms > 0) labels.push(bathrooms === 1 ? "Bathroom" : `${bathrooms} Bathrooms`);
  return labels;
}

/**
 * When this property was last cleaned and what is next.
 *
 * Bookings carry propertyName rather than a property id for anything that is
 * not repeat-eligible, so they are matched by that name. An unmatched property
 * shows "—" instead of borrowing another property's dates.
 */
function propertyCleaningDates(property) {
  const name = String(property.name || "").trim();
  const mine = name ? bookings.filter((booking) => String(booking.propertyName || "").trim() === name) : [];
  const done = mine
    .filter((booking) => ["completed", "awaiting-review"].includes(booking.status))
    .sort((a, b) => String(b.scheduledStartAt || "").localeCompare(String(a.scheduledStartAt || "")));
  const ahead = mine
    .filter((booking) => ["pending-cleaner-acceptance", "confirmed", "cleaner-en-route", "cleaner-arrived", "cleaning-in-progress"].includes(booking.status))
    .sort((a, b) => String(a.scheduledStartAt || "").localeCompare(String(b.scheduledStartAt || "")));
  return {
    last: done.length ? formatShortDate(done[0].scheduledStartAt) : "—",
    next: ahead.length ? formatShortDate(ahead[0].scheduledStartAt) : "—",
    booked: ahead.length > 0
  };
}

function propertyBlockerCopy(blocker) {
  if (!blocker) return "";
  if (blocker.booking) {
    if (blocker.booking.status === "pending-cleaner-acceptance") return "A Cleaner invitation is awaiting a response. Open it to see the deadline and exact price.";
    if (["cleaner-en-route", "cleaner-arrived", "cleaning-in-progress"].includes(blocker.booking.status)) return "This clean is underway. Open the booking to see its live status before removing the property.";
    if (blocker.booking.status === "awaiting-review") return "This clean is awaiting your review. Finish the booking record before removing the property.";
    return "An accepted booking is linked to this property. View it or request cancellation before removing the property.";
  }
  return blocker.canWithdraw
    ? "This cleaning request is keeping the property active. You can view or cancel it here."
    : "This request has entered the Cleaner workflow. Open it to see its current status and the next safe action.";
}

function focusCleaningRequest(requestId) {
  selectWorkspaceTab("bookings", { historyMode: "push" });
  const card = [...document.querySelectorAll("[data-cleaning-request-id]")].find((item) => item.dataset.cleaningRequestId === requestId);
  if (!card) return;
  card.classList.add("landlord-linked-record-focus");
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  card.setAttribute("tabindex", "-1");
  card.focus({ preventScroll: true });
  window.setTimeout(() => card.classList.remove("landlord-linked-record-focus"), 1800);
}

function renderPropertyBlocker(property, blocker) {
  if (!blocker) return null;
  const request = blocker.request;
  const booking = blocker.booking;
  const section = element("section", "landlord-property-work");
  section.dataset.propertyCleaningBlocker = property.propertyId;
  section.setAttribute("aria-label", `Cleaning activity for ${property.name || "this property"}`);
  const heading = element("div", "landlord-property-work-heading");
  const title = element("div");
  title.append(
    element("span", "landlord-private-pill", "Property in use"),
    element("h4", "", booking ? "Active or upcoming booking" : "Active cleaning request")
  );
  const status = element("strong", "landlord-property-work-status", booking
    ? bookingSummaryStatusLabels[booking.status] || "Booking active"
    : requestStatusLabel(request.status));
  heading.append(title, status);
  const facts = element("dl", "landlord-property-work-facts");
  facts.append(
    propertyFact("Status", booking ? bookingSummaryStatusLabels[booking.status] || "Booking active" : requestStatusLabel(request.status)),
    propertyFact("Date", formatBookingMoment(booking?.scheduledStartAt || request.requestedStartAt)),
    propertyFact("Cleaner", booking?.counterpartyName && booking.counterpartyName !== "Assigned Cleaner" ? booking.counterpartyName : booking ? "Assigned Cleaner" : "Not assigned yet")
  );
  if (booking?.pricePence) facts.append(propertyFact("Agreed total", formatBookingMoney(booking.pricePence)));
  const copy = element("p", "landlord-property-work-copy", propertyBlockerCopy(blocker));
  const actions = element("div", "landlord-property-work-actions");
  const view = element("button", "button button-outline", booking ? "View booking" : "View cleaning request");
  view.type = "button";
  view.addEventListener("click", () => {
    if (booking?.activeJobAvailable) location.assign(`/bookings/${encodeURIComponent(booking.bookingId)}`);
    else focusCleaningRequest(request.requestId);
  });
  actions.append(view);
  if (blocker.canWithdraw) {
    const cancel = element("button", "button landlord-property-cancel-request", "Cancel cleaning request");
    cancel.type = "button";
    cancel.addEventListener("click", () => openRequestWithdrawal(request.requestId, property.propertyId));
    actions.append(cancel);
  } else if (blocker.canRequestCancellation) {
    const activeChangeRequest = activeBookingChangeRequestFor(supportRequests, booking.bookingId);
    const cancel = element("a", "button landlord-property-cancel-request", activeChangeRequest ? "View cancellation request" : "Request cancellation");
    cancel.href = `/landlord/help?bookingId=${encodeURIComponent(booking.bookingId)}${activeChangeRequest ? "#support-history" : ""}`;
    actions.append(cancel);
  }
  section.append(heading, facts, copy, actions);
  return section;
}

function renderProperties() {
  propertyList.replaceChildren();
  propertySelect.replaceChildren(element("option", "", properties.length ? "Choose a property" : "Add a property first"));
  propertySelect.firstElementChild.value = "";
  // Every owned property remains selectable for a future clean, but the hub
  // gives each place one visual home: active work belongs under Upcoming and
  // only places with nothing booked belong under Your places.
  for (const property of properties) {
    const option = element("option", "", property.name || "Saved property");
    option.value = property.propertyId;
    propertySelect.append(option);
  }
  // Every place keeps its card. The grid used to hide any property with live
  // cleaning work, which read as the property vanishing the moment a request
  // was made — the most alarming possible feedback for "I asked for a clean".
  // Live work now shows ON the card: the pill and summary carry the work's own
  // state, and the action row swaps Book/Scan for the one action that work
  // allows. The delete gate in openPropertyArchive was built for exactly this
  // and was unreachable while blocked places had no card to press it from.
  for (const property of properties) {
    const blocker = propertyCleaningBlocker(property, requests, bookings);
    // The v2 property card: address, what the property is, when it was last
    // cleaned and what is next, the rooms, then the two things a Landlord
    // actually does from here. The protected details and the access/archive
    // controls keep their existing behaviour inside the disclosure below —
    // they are the rarer actions and the design gives the card to the common
    // two.
    const card = element("article", "landlord-property-card");
    const heading = element("div", "landlord-property-card-heading");
    const icon = element("span", "ld-prop-icon");
    icon.append(cloneIcon("property"));
    icon.setAttribute("aria-hidden", "true");
    const title = element("div", "ld-prop-main");
    const propertyTitle = element("h3", "", property.name || "Saved property");
    title.append(propertyTitle);
    const cleaned = propertyCleaningDates(property);
    const taskCount = Array.isArray(property.savedChecklist) ? property.savedChecklist.length : 0;
    let summary = cleaned.last && cleaned.last !== "—"
      ? `Last cleaned ${cleaned.last}${taskCount ? ` · ${taskCount} ${taskCount === 1 ? "task" : "tasks"} saved` : ""}`
      : taskCount ? `Nothing booked · ${taskCount} ${taskCount === 1 ? "task" : "tasks"} saved` : "No scan yet";
    if (blocker) {
      // The work's own words rather than a generic "busy": which state, which
      // day. Same labels the booking and request cards use, so one clean reads
      // identically wherever the Landlord meets it.
      const workLabel = blocker.booking
        ? bookingSummaryStatusLabels[blocker.booking.status] || "Booking active"
        : requestStatusLabel(blocker.request.status);
      summary = `${workLabel} · ${formatBookingMoment(blocker.booking?.scheduledStartAt || blocker.request.requestedStartAt)}`;
      card.dataset.propertyCleaningBlocker = property.propertyId;
      propertyTitle.append(element("span", "landlord-private-pill ld-prop-work-pill", blocker.booking ? "Booked" : "Requested"));
    }
    title.append(element("p", "ld-prop-summary", summary));
    heading.append(icon, title);

    const actions = element("div", "landlord-property-actions");
    const scanAgain = element("a", "button button-outline", taskCount ? "Scan" : "Scan rooms");
    scanAgain.href = "/landlord/book";
    scanAgain.setAttribute("aria-label", `Scan ${property.name || "saved property"} again`);
    scanAgain.addEventListener("click", () => saveSelectedProperty(sessionStorage, property.propertyId));
    const book = element("button", "button", "Book clean");
    book.type = "button";
    book.setAttribute("aria-label", `Book a clean for ${property.name || "saved property"}`);
    book.addEventListener("click", () => {
      bookCleanPropertyId = property.propertyId;
      openBookCleanChooser();
    });
    // Booking a second clean or rescanning rooms mid-clean are not offers this
    // place can honour, so live work replaces them with the one action it does
    // allow: open the work. propertyBlockerCopy already owns the wording for
    // every state, and renderPropertyBlocker still owns the detailed panel that
    // the overflow opens.
    if (blocker) {
      const openWork = element("button", "button", blocker.booking ? "View booking" : "View request");
      openWork.type = "button";
      openWork.setAttribute("aria-label", `${blocker.booking ? "View the booking for" : "View the cleaning request for"} ${property.name || "saved property"}`);
      openWork.addEventListener("click", () => {
        if (blocker.booking?.activeJobAvailable) location.assign(`/bookings/${encodeURIComponent(blocker.booking.bookingId)}`);
        else if (blocker.booking) selectWorkspaceTab("bookings", { historyMode: "push" });
        else focusCleaningRequest(blocker.request.requestId);
      });
      actions.append(openWork);
    } else if (taskCount) actions.append(book, scanAgain);
    else actions.append(scanAgain);

    const details = element("details", "landlord-property-details");
    const detailsSummary = element("summary", "", "⋯");
    detailsSummary.setAttribute("aria-label", `More options for ${property.name || "saved property"}`);
    details.append(detailsSummary);
    const detailsPanel = element("div", "ld-prop-menu");
    const notes = element("dl");
    notes.append(propertyFact("Exact address", exactAddress(property)), propertyFact("Access instructions", property.accessInstructions || "None saved"), propertyFact("Parking", property.parkingInstructions || "None saved"), propertyFact("Cleaning preferences", property.cleaningPreferences || "None saved"), propertyFact("Special notes", property.specialNotes || "None saved"), propertyFact("Size", property.approximateSizeSqM == null ? "Not supplied" : `${property.approximateSizeSqM} m²`), propertyFact("Saved tasks", Array.isArray(property.savedChecklist) ? property.savedChecklist.length : 0));
    detailsPanel.append(notes);
    const secondary = element("div", "landlord-property-actions landlord-property-actions-secondary");
    const edit = element("button", "button button-outline", property.accessInstructions ? "Edit access and details" : "Add access details");
    edit.type = "button";
    edit.setAttribute("aria-label", `${property.accessInstructions ? "Edit access and details for" : "Add access details for"} ${property.name || "saved property"}`);
    edit.addEventListener("click", () => openPropertyEditor(property));
    const archive = element("button", "button button-outline landlord-property-archive", "Delete property");
    archive.type = "button";
    archive.setAttribute("aria-label", `Delete ${property.name || "saved property"} from active properties`);
    archive.addEventListener("click", () => openPropertyArchive(property));
    // The design gives a place card three controls: Book clean, Scan and the
    // overflow. Deleting a place is neither common nor reversible, so it
    // belongs behind the overflow with Edit access rather than sitting in the
    // row as a third button competing with the two real actions.
    secondary.append(edit, archive);
    // renderPropertyBlocker has existed, fully written, since the blocked-place
    // design was drawn, and nothing ever called it. It belongs here: the card
    // stays a card, and the detailed work record — status, date, Cleaner,
    // agreed total, and the safe cancellation route — opens with the overflow.
    if (blocker) detailsPanel.append(renderPropertyBlocker(property, blocker));
    detailsPanel.append(secondary);
    details.append(detailsPanel);

    actions.append(details);
    card.append(heading, actions);
    propertyList.append(card);
  }
  // The design closes the grid with a dashed tile rather than leaving the last
  // row ragged. It opens the same property editor the heading button does.
  const add = element("button", "ld-prop-add");
  add.type = "button";
  add.append(cloneIcon("add"), element("span", "ld-prop-add-title", "Add a place"), element("span", "ld-prop-add-copy", "Four facts, then scan"));
  add.addEventListener("click", () => openPropertyEditor());
  propertyList.append(add);
  const hasSoleProperty = properties.length === 1;
  propertySelectLabel.hidden = hasSoleProperty;
  soleProperty.hidden = !hasSoleProperty;
  if (hasSoleProperty) {
    propertySelect.value = properties[0].propertyId;
    solePropertyName.textContent = properties[0].name || "Saved property";
  } else solePropertyName.textContent = "";
  applySuggestedCleaningType();
  // Places with live work now stay in the grid, so the only empty state left is
  // the honest one: no saved properties at all. The old second message told the
  // Landlord their places had moved to Upcoming, which is no longer where they
  // are, and it could only ever appear in the state this change removes.
  propertyEmpty.replaceChildren(
    element("strong", "", "No account properties yet."),
    element("p", "", "Add a property to prepare a private request draft. Nothing is published to Cleaner search.")
  );
  propertyEmpty.hidden = true;
  propertyList.hidden = false;
  scanPropertyStatus.dataset.kind = properties.length ? "ready" : "attention";
  scanPropertyStatus.textContent = properties.length
    ? "Your room scan can be saved to the selected private property."
    : "Start speaking now. Add a property before saving the request; your unfinished walkthrough stays in this tab.";
  document.querySelector("[data-property-count]").textContent = String(properties.length);
  // If the contextual chooser is open while a place is added or restored, keep
  // it in sync without closing the dialog or losing the Landlord's position.
  if (bookCleanDialog?.open) renderBookCleanChooser();
}

function renderArchivedProperties() {
  archivedPropertyList.replaceChildren();
  archivedPropertyCount.textContent = String(archivedProperties.length);
  archivedPropertySection.hidden = archivedProperties.length === 0;
  for (const property of archivedProperties) {
    const card = element("article", "landlord-property-card");
    const heading = element("div", "landlord-property-card-heading");
    const title = element("div");
    title.append(
      element("span", "landlord-private-pill", "Archived"),
      element("h3", "", property.name || "Saved property"),
      element("p", "", exactAddress(property))
    );
    heading.append(title, element("strong", "", String(property.propertyType || "Property").replace(/-/g, " ")));
    const facts = element("dl", "landlord-property-facts");
    facts.append(
      propertyFact("Archived", property.archivedAt ? formatBookingMoment(property.archivedAt) : "Date unavailable"),
      propertyFact("Saved tasks", Array.isArray(property.savedChecklist) ? property.savedChecklist.length : 0)
    );
    const actions = element("div", "landlord-property-actions");
    const restore = element("button", "button button-outline", restoringPropertyId === property.propertyId ? "Restoring…" : "Restore property");
    restore.type = "button";
    restore.disabled = Boolean(restoringPropertyId);
    restore.setAttribute("aria-label", `Restore ${property.name || "saved property"} for new cleaning requests`);
    restore.addEventListener("click", () => restoreProperty(property));
    actions.append(restore);
    card.append(heading, facts, actions);
    archivedPropertyList.append(card);
  }
}

async function restoreProperty(property) {
  if (!property?.propertyId || restoringPropertyId) return;
  archivedPropertyStatus.hidden = true;
  const csrf = await recoverCsrf(archivedPropertyStatus, "restoring this property");
  if (!csrf) return;
  restoringPropertyId = property.propertyId;
  renderArchivedProperties();
  try {
    const result = await requestJson(`/api/marketplace/properties/${encodeURIComponent(property.propertyId)}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: "{}"
    });
    if (result.restoredProperty?.propertyId !== property.propertyId) throw new Error("Homle could not verify which property was restored.");
    archivedProperties = archivedProperties.filter((item) => item.propertyId !== property.propertyId);
    const { archivedAt: _archivedAt, ...activeProperty } = property;
    properties.push(activeProperty);
    properties.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    restoringPropertyId = "";
    renderProperties();
    renderArchivedProperties();
    // propertyStatus lives in the Places panel, which is hidden while the
    // Archived properties list is open, so the confirmation was written into a
    // node with two hidden ancestors: nothing appeared, the aria-live region
    // never announced, and focus was sent somewhere invisible. The error path
    // two lines below already used the archived panel's own status node.
    showFeedback(archivedPropertyStatus, `${property.name || "Property"} restored and available for new cleaning requests.`, "success");
    archivedPropertyStatus.focus({ preventScroll: true });
  } catch (error) {
    restoringPropertyId = "";
    renderArchivedProperties();
    showFeedback(archivedPropertyStatus, error.statusCode === 401 || error.statusCode === 403 ? "Your secure session expired or cannot restore this property. Sign in again." : error.message);
    archivedPropertyStatus.focus({ preventScroll: true });
  }
}

function openPropertyArchive(property) {
  if (!property?.propertyId || propertyArchivePending) return;
  const blocker = propertyCleaningBlocker(property, requests, bookings);
  if (blocker) {
    const linkedWork = [...propertyList.querySelectorAll("[data-property-cleaning-blocker]")].find((item) => item.dataset.propertyCleaningBlocker === property.propertyId);
    showFeedback(propertyStatus, blocker.canWithdraw
      ? "This property has an active cleaning request. View or cancel it on the property card, then delete the property."
      : "This property has active cleaning work. Use the action shown on the property card before deleting it.");
    propertyStatus.focus({ preventScroll: true });
    linkedWork?.scrollIntoView({ behavior: "smooth", block: "center" });
    linkedWork?.classList.add("landlord-linked-record-focus");
    window.setTimeout(() => linkedWork?.classList.remove("landlord-linked-record-focus"), 1800);
    return;
  }
  if (editingPropertyId === property.propertyId && propertyDirty && !window.confirm("Discard the unsaved property changes and continue to the delete confirmation?")) return;
  if (editingPropertyId === property.propertyId) {
    propertyForm.hidden = true;
    propertyForm.reset();
    editingPropertyId = "";
    propertyDirty = false;
    if (propertyDialog?.open) propertyDialog.close();
  }
  archivingPropertyId = property.propertyId;
  propertyArchiveName.textContent = property.name || "this property";
  propertyArchiveFeedback.hidden = true;
  propertyArchiveDialog.showModal();
}

async function archiveProperty(event) {
  event.preventDefault();
  if (!archivingPropertyId || propertyArchivePending) return;
  const property = properties.find((item) => item.propertyId === archivingPropertyId);
  if (!property) return propertyArchiveDialog.close();
  const csrf = await recoverCsrf(propertyArchiveFeedback, "deleting this property");
  if (!csrf) return;
  propertyArchivePending = true;
  propertyArchiveCancel.disabled = true;
  setPending(propertyArchiveConfirm, true, "Deleting…");
  try {
    const result = await requestJson(`/api/marketplace/properties/${encodeURIComponent(archivingPropertyId)}/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: "{}"
    });
    if (result.archivedProperty?.propertyId !== archivingPropertyId) throw new Error("Homle could not verify which property was archived.");
    properties = properties.filter((item) => item.propertyId !== archivingPropertyId);
    archivedProperties.unshift({ ...property, archivedAt: result.archivedProperty.archivedAt });
    archivingPropertyId = "";
    propertyArchiveDialog.close();
    renderProperties();
    renderArchivedProperties();
    showFeedback(propertyStatus, `${property.name || "Property"} was removed from active Properties. Completed and cancelled booking history is unchanged.`, "success");
    propertyStatus.focus({ preventScroll: true });
  } catch (error) {
    if (["property-has-active-request", "property-has-active-booking"].includes(error.code)) {
      propertyArchiveDialog.close();
      await refreshBookingTransition();
      renderProperties();
      showFeedback(propertyStatus, "This property still has active cleaning work. Its status and the action needed are now shown on the property card.");
      propertyStatus.focus({ preventScroll: true });
    } else {
      showFeedback(propertyArchiveFeedback, error.statusCode === 401 || error.statusCode === 403 ? "Your secure session expired or cannot delete this property. Sign in again." : error.message);
      propertyArchiveFeedback.focus({ preventScroll: true });
    }
  } finally {
    propertyArchivePending = false;
    propertyArchiveCancel.disabled = false;
    setPending(propertyArchiveConfirm, false, "Delete property");
  }
}

function applySuggestedCleaningType() {
  const property = properties.find((item) => item.propertyId === propertySelect.value);
  const suggestion = suggestedCleaningType(property?.propertyType);
  const source = cleaningTypeSelect.dataset.selectionSource;
  if (!property || !suggestion) {
    if (source === "suggested") cleaningTypeSelect.value = "";
    if (source !== "user") delete cleaningTypeSelect.dataset.selectionSource;
    cleaningTypeHint.textContent = property ? "Choose the cleaning type for this property." : "Choose a property to receive a sensible default.";
    return;
  }
  if (source === "user" || (cleaningTypeSelect.value && source !== "suggested")) {
    cleaningTypeSelect.dataset.selectionSource = "user";
    cleaningTypeHint.textContent = "Selected by you. Change it if the requested clean is different.";
    return;
  }
  cleaningTypeSelect.value = suggestion;
  cleaningTypeSelect.dataset.selectionSource = "suggested";
  cleaningTypeHint.textContent = `Suggested from the saved ${String(property.propertyType).replace(/-/g, " ")} type. Change it if needed.`;
}

function propertyFact(label, value) {
  const wrapper = element("div");
  wrapper.append(element("dt", "", label), element("dd", "", String(value)));
  return wrapper;
}

function roomNames(request) {
  return [...new Set((request.tasks || []).map((task) => String(task.roomName || "").trim()).filter(Boolean))];
}

function humanFileSize(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 1) return "Unknown size";
  return bytes < 1_000_000 ? `${Math.ceil(bytes / 1000)} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`;
}

async function sha256(file) {
  if (!crypto?.subtle || typeof file?.arrayBuffer !== "function") throw new Error("This browser cannot verify the photo securely. Try a current mobile browser.");
  let timer;
  try {
    const digest = await Promise.race([
      file.arrayBuffer().then((buffer) => crypto.subtle.digest("SHA-256", buffer)),
      new Promise((_, reject) => {
        timer = window.setTimeout(() => reject(new Error("This photo took too long to check securely. It is still selected; try again or choose a smaller photo.")), 15_000);
      })
    ]);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } finally {
    window.clearTimeout(timer);
  }
}

function checkedUploadResponse(response) {
  if (!response.ok) throw new Error("The private photo upload did not reach secure storage. Try again.");
}

function renderScanPhotos(requestId, scan, list, count) {
  const photos = Array.isArray(scan?.photos) ? scan.photos : [];
  count.textContent = `${photos.length} of 10 private room ${photos.length === 1 ? "photo" : "photos"}`;
  list.replaceChildren();
  for (const photo of photos) {
    const item = element("li", "landlord-scan-photo");
    const copy = element("div");
    copy.append(element("strong", "", photo.roomName), element("span", "", photo.note || "See the confirmed room checklist for cleaning instructions."), element("small", "", `${humanFileSize(photo.byteSize)} · metadata removed · private JPEG`));
    const view = element("button", "button button-outline", "View privately");
    view.type = "button";
    view.addEventListener("click", async () => {
      const privateWindow = window.open("about:blank", "_blank");
      if (privateWindow) privateWindow.opener = null;
      view.disabled = true;
      try {
        if (!privateWindow) throw new Error("Allow this site to open the private photo viewer, then try again.");
        const result = await requestJson(`/api/marketplace/cleaning-requests/${encodeURIComponent(requestId)}/photos/${encodeURIComponent(photo.photoId)}/access`);
        const url = new URL(result.photo?.url || "");
        if (url.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("The private photo link was unsafe.");
        privateWindow.location.replace(url.toString());
      } catch (error) { privateWindow?.close(); window.alert(error.message); }
      finally { view.disabled = false; }
    });
    item.append(copy, view);
    list.append(item);
  }
  list.hidden = photos.length === 0;
}

function openRequestScan(requestId) {
  const request = requests.find((item) => item.requestId === requestId);
  if (request?.status === "draft") return showRequestContinuation(request);
  const details = [...document.querySelectorAll("[data-request-scan-id]")].find((item) => item.dataset.requestScanId === requestId);
  if (!details) return false;
  details.open = true;
  details.scrollIntoView({ behavior: "smooth", block: "start" });
  details.querySelector('select[name="roomName"]')?.focus({ preventScroll: true });
  return true;
}

function resetRequestContinuation() {
  closeRequestPhotoDialog();
  if (!requestContinuation) return;
  requestContinuation.replaceChildren();
  requestContinuation.hidden = true;
  requestForm.hidden = false;
}

// A running photo upload owns its dialog. Dismissing mid-loop left the loop
// writing progress into a detached panel while the remaining photos kept
// uploading and attaching to the request, with nothing on screen saying so.
// A list that could not be read is not a list that is empty. When the bookings
// call rejects, `bookings` keeps its previous value — [] on a cold load — and
// every empty state below it then states a fact about the account that the
// server never sent. The partial-load banner says a refresh did not complete;
// these say which answer is actually unknown.
let bookingsUnavailable = false;
function renderBookingSourceState() {
  const empty = document.querySelector("[data-landlord-booking-empty]");
  if (empty) {
    empty.replaceChildren(
      element("strong", "", bookingsUnavailable ? "Your bookings could not be loaded." : "No confirmed bookings yet."),
      element("p", "", bookingsUnavailable
        ? "Nothing about your bookings was changed. Use Try again above to load them."
        : "A request becomes a booking only once a Cleaner accepts the frozen time, scope and price. Requests you are still preparing sit under Your places.")
    );
  }
  const past = document.querySelector("[data-ld-past-empty]");
  if (past) {
    past.replaceChildren(
      element("strong", "", bookingsUnavailable ? "Completed cleans could not be loaded" : "No completed cleans yet"),
      element("p", "", bookingsUnavailable
        ? "This list needs the bookings that did not load. Use Try again above."
        : "Finished cleans appear here with the record of what was done.")
    );
  }
  const payments = document.querySelector("[data-landlord-payments-empty]");
  if (payments) {
    payments.textContent = bookingsUnavailable
      ? "Payment records could not be loaded. Nothing was authorised or charged. Use Try again above."
      : "No bookings with a price yet. Totals appear here once a Cleaner accepts a request.";
  }
}

// Guards the one function every "save this draft" control reaches.
let requestDraftPending = false;
function setRequestDraftControlsLocked(locked) {
  for (const control of [requestSave, requestContinue]) {
    if (control) control.disabled = locked;
  }
}

let requestPhotoUploadInFlight = false;
function setRequestPhotoUploadInFlight(busy) {
  requestPhotoUploadInFlight = busy;
  const close = activeRequestPhotoDialog?.querySelector(".landlord-photo-dialog-close");
  if (!close) return;
  // Disabled rather than silently ignored, so the block is visible instead of
  // reading as a dead button.
  close.disabled = busy;
  if (busy) close.title = "Photos are still uploading.";
  else close.removeAttribute("title");
}

function closeRequestPhotoDialog() {
  if (!activeRequestPhotoDialog) return;
  const dialog = activeRequestPhotoDialog;
  activeRequestPhotoDialog = null;
  if (dialog.open) dialog.close();
  dialog.remove();
}

function enableRequestPhotoDialogDismissal(dialog) {
  if (dialog.dataset.dismissalReady === "true") return;
  dialog.dataset.dismissalReady = "true";
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    // Escape while photos are uploading used to close the panel the loop was
    // still reporting into, leaving it to finish attaching the rest in the
    // background. The upload owns the dialog until it stops.
    if (requestPhotoUploadInFlight) return;
    closeRequestPhotoDialog();
  });
  // Backdrop pointer events arrive on the dialog element. Close only when the
  // pointer is outside its rendered box so taps inside never discard entries.
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    const outside = event.clientX < bounds.left || event.clientX > bounds.right
      || event.clientY < bounds.top || event.clientY > bounds.bottom;
    // Same reason as the cancel handler above: a backdrop tap must not abandon
    // an upload that will keep running either way.
    if (outside && !requestPhotoUploadInFlight) closeRequestPhotoDialog();
  });
}

function showRequestContinuation(request, options = {}) {
  if (request?.status !== "draft") return false;
  requestFeedback.hidden = true;
  let dialog = options.dialog;
  if (!dialog) {
    closeRequestPhotoDialog();
    dialog = element("dialog", "landlord-photo-dialog");
    document.body.append(dialog);
  }
  activeRequestPhotoDialog = dialog;
  dialog.replaceChildren();
  const close = element("button", "landlord-photo-dialog-close", "Close");
  close.type = "button";
  close.setAttribute("aria-label", "Close room photo window");
  close.addEventListener("click", () => { if (!requestPhotoUploadInFlight) closeRequestPhotoDialog(); });
  const heading = element("div", "landlord-request-continuation-heading");
  heading.append(
    element("p", "eyebrow", "Review request"),
    element("h3", "", "Photos and notes are optional"),
    element("p", "", "Add a room photo if it helps, or review and submit the selected cleaning service without one.")
  );
  const scan = requestScanPanel(request, options);
  dialog.append(close, heading, scan);
  scan.open = true;
  enableRequestPhotoDialogDismissal(dialog);
  if (!dialog.open) dialog.showModal();
  queueMicrotask(() => {
    scan.querySelector('select[name="roomName"]')?.focus({ preventScroll: true });
  });
  return true;
}

function requestScanPanel(request, options = {}) {
  const details = element("details", "landlord-request-scan");
  details.dataset.requestScanId = request.requestId;
  const summary = element("summary", "", request.status === "draft" ? (mediaReady ? "Add room photos and submit" : "Test the room camera") : "View reviewed room scan");
  details.append(summary);
  const panel = element("div", "landlord-request-scan-body");
  const intro = element("p", "landlord-request-scan-copy", request.status === "draft" ? (mediaReady ? "Room photos are optional. Add one if it helps explain the clean, or review and submit without images." : "Room photos are optional and secure upload is temporarily unavailable. You can still review and submit this request without images.") : "This is the reviewed room-scan handoff attached to the request.");
  const feedback = element("div", "landlord-form-feedback");
  feedback.hidden = true;
  feedback.tabIndex = -1;
  const count = element("strong", "landlord-scan-count", "Loading private room photos…");
  const list = element("ul", "landlord-scan-photo-list");
  list.hidden = true;
  panel.append(intro, count, list);
  let loaded = false;
  let submit = null;
  let selectedPhotoCount = 0;
  let choosePhoto = null;
  let uploadSelectedPhotos = null;

  function refreshSubmissionAvailability() {
    if (!submit) return;
    submit.disabled = false;
    submit.type = selectedPhotoCount ? "button" : "submit";
    submit.textContent = selectedPhotoCount
      ? `Upload ${selectedPhotoCount} selected ${selectedPhotoCount === 1 ? "photo" : "photos"} to continue`
      : "Submit cleaning request";
  }

  async function loadScan() {
    if (!mediaReady) {
      count.textContent = "Private room-photo storage not connected";
      requestScans.set(request.requestId, { photos: [] });
      refreshSubmissionAvailability();
      loaded = true;
      return;
    }
    try {
      const result = await requestJson(`/api/marketplace/cleaning-requests/${encodeURIComponent(request.requestId)}/scan`);
      requestScans.set(request.requestId, result.scan);
      renderScanPhotos(request.requestId, result.scan, list, count);
      refreshSubmissionAvailability();
      loaded = true;
    } catch (error) {
      count.textContent = "Private room scan unavailable";
      showFeedback(feedback, error.message);
    }
  }
  details.addEventListener("toggle", () => { if (details.open && !loaded) loadScan(); });

  if (request.status === "draft") {
    const form = element("form", "landlord-scan-upload-form");
    form.noValidate = true;
    const roomLabel = element("label", "", "Which room is this?");
    const room = element("select");
    room.name = "roomName";
    room.required = true;
    room.append(element("option", "", "Choose a room"));
    room.firstElementChild.value = "";
    const availableRooms = [...new Set([...roomNames(request), "Kitchen", "Bathroom", "Bedroom", "Living Room", "Hallway", "Other"])];
    for (const name of availableRooms) { const option = element("option", "", name); option.value = name; room.append(option); }
    if (options.initialRoomName && availableRooms.includes(options.initialRoomName)) room.value = options.initialRoomName;
    roomLabel.append(room);
    const noteLabel = element("label", "", "Photo note (optional)");
    const note = element("textarea");
    note.name = "note";
    note.rows = 3;
    note.maxLength = 1000;
    note.placeholder = "For example: Grease around the hob and splashback";
    noteLabel.append(note);
    const pickerActions = element("div", "landlord-scan-picker-actions");
    const cameraButton = element("button", "button", "Open rear camera");
    const libraryButton = element("button", "button button-outline", "Choose existing photos");
    const videoButton = element("button", "button button-outline", "Record short room video");
    cameraButton.type = libraryButton.type = videoButton.type = "button";
    const cameraInput = element("input");
    cameraInput.type = "file";
    cameraInput.accept = "image/*";
    cameraInput.setAttribute("capture", "environment");
    cameraInput.hidden = true;
    const libraryInput = element("input");
    libraryInput.type = "file";
    libraryInput.accept = "image/jpeg,image/png,image/webp,image/heic,.heic";
    libraryInput.multiple = true;
    libraryInput.hidden = true;
    const videoInput = element("input");
    videoInput.type = "file";
    videoInput.accept = "video/mp4,video/quicktime,video/webm,video/*";
    videoInput.setAttribute("capture", "environment");
    videoInput.hidden = true;
    const localMediaBoundary = element("p", "landlord-local-media-boundary", "Camera rehearsal: these visual previews are not uploaded or saved. Keep this page open while reviewing them.");
    localMediaBoundary.hidden = mediaReady;
    const videoPrivacy = element("small", "landlord-scan-video-privacy", "A short video becomes up to three still frames. The raw video and audio never leave this device.");
    const selected = element("span", "landlord-scan-selected", "No room visuals selected");
    const selectionPreview = element("div", "landlord-scan-selection-preview");
    selectionPreview.setAttribute("role", "list");
    selectionPreview.setAttribute("aria-label", "Room photos selected for review");
    selectionPreview.hidden = true;
    let files = validatedRoomPhotoSelection(options.initialFiles || []);
    let previewUrls = [];
    const pendingPhotoCompletions = new WeakMap();
    let uploadPending = false;
    let videoProcessing = false;
    const upload = element("button", "button", "Upload private room photos");
    upload.type = "submit";
    function setUploadEditorLocked(locked) {
      for (const control of [room, note, cameraButton, libraryButton, videoButton, cameraInput, libraryInput, videoInput]) control.disabled = locked;
    }
    function clearSelectionPreviews() {
      for (const url of previewUrls) URL.revokeObjectURL(url);
      previewUrls = [];
      selectionPreview.replaceChildren();
      selectionPreview.hidden = true;
    }
    function renderSelection() {
      clearSelectionPreviews();
      selectedPhotoCount = files.length;
      refreshSubmissionAvailability();
      if (!files.length) {
        selected.textContent = "No room visuals selected";
        upload.textContent = mediaReady ? "Upload private room photos" : "Secure storage needed to save";
        upload.disabled = !mediaReady;
        return;
      }
      const totalBytes = files.reduce((sum, item) => sum + item.byteSize, 0);
      const awaitingVerification = files.filter((item) => pendingPhotoCompletions.has(item)).length;
      selected.textContent = files.length === 1 ? `${files[0].name} · ${humanFileSize(files[0].byteSize)}` : `${files.length} photos selected · ${humanFileSize(totalBytes)} total`;
      if (awaitingVerification) {
        selected.textContent += ` · ${awaitingVerification} securely uploaded, awaiting verification`;
        upload.textContent = awaitingVerification === files.length ? `Verify ${awaitingVerification} uploaded ${awaitingVerification === 1 ? "photo" : "photos"}` : "Verify uploaded photos and continue";
      } else {
        upload.textContent = mediaReady ? `Upload ${files.length} private ${files.length === 1 ? "photo" : "photos"}` : "Secure storage needed to save";
      }
      if (!mediaReady) selected.textContent += " · on this device only, not saved";
      upload.disabled = !mediaReady;
      selectionPreview.hidden = false;
      for (const candidate of files) {
        const card = element("div", "landlord-scan-selection-card");
        card.setAttribute("role", "listitem");
        if (candidate.mimeType === "image/heic" || typeof URL.createObjectURL !== "function") {
          card.append(element("span", "landlord-scan-selection-placeholder", "Photo selected"));
        } else {
          const image = element("img");
          const previewUrl = URL.createObjectURL(candidate.file);
          previewUrls.push(previewUrl);
          image.src = previewUrl;
          image.alt = `${candidate.name} selected for review`;
          card.append(image);
        }
        const copy = element("div", "landlord-scan-selection-copy");
        copy.append(element("strong", "", candidate.name), element("small", "", `${humanFileSize(candidate.byteSize)} · ${room.value || "Choose its checklist room"}`));
        const remove = element("button", "text-button", pendingPhotoCompletions.has(candidate) ? "Awaiting verification" : "Remove");
        remove.type = "button";
        remove.disabled = uploadPending || pendingPhotoCompletions.has(candidate);
        remove.addEventListener("click", () => {
          if (uploadPending || pendingPhotoCompletions.has(candidate)) return;
          files = files.filter((item) => item !== candidate);
          renderSelection();
        });
        card.append(copy, remove);
        selectionPreview.append(card);
      }
    }
    function choose(event) {
      if (uploadPending || videoProcessing) { event.target.value = ""; return; }
      const candidates = consumeRoomPhotoInputFiles(event.target);
      if (!candidates.length) return;
      try {
        const existingPhotoCount = Array.isArray(requestScans.get(request.requestId)?.photos) ? requestScans.get(request.requestId).photos.length : 0;
        files = validatedRoomPhotoSelection(candidates, { existingPhotoCount });
        renderSelection();
        if (mediaReady) feedback.hidden = true;
        else showFeedback(feedback, `${files.length} room ${files.length === 1 ? "photo is" : "photos are"} ready to review on this device. Nothing was uploaded or saved.`, "success");
      } catch (error) {
        files = [];
        renderSelection();
        showFeedback(feedback, error.message);
      }
    }
    cameraInput.addEventListener("change", choose);
    libraryInput.addEventListener("change", choose);
    videoInput.addEventListener("change", async (event) => {
      if (uploadPending || videoProcessing) { event.target.value = ""; return; }
      const [candidate] = consumeRoomPhotoInputFiles(event.target);
      if (!candidate) return;
      feedback.hidden = true;
      videoProcessing = true;
      setUploadEditorLocked(true);
      setPending(videoButton, true, "Preparing private stills…");
      try {
        const existingPhotoCount = Array.isArray(requestScans.get(request.requestId)?.photos) ? requestScans.get(request.requestId).photos.length : 0;
        const remaining = maximumRoomPhotos - existingPhotoCount;
        if (remaining < 1) throw new TypeError(`This request already has ${maximumRoomPhotos} room photos.`);
        const frames = await extractRoomVideoFrames(candidate, { frameCount: Math.min(maximumRoomVideoFrames, remaining) });
        files = validatedRoomPhotoSelection(frames, { existingPhotoCount });
        renderSelection();
        showFeedback(feedback, mediaReady
          ? `${files.length} private still ${files.length === 1 ? "frame was" : "frames were"} prepared from the room video. The raw video and audio stayed on this device. Review the frames, then upload.`
          : `${files.length} still ${files.length === 1 ? "frame was" : "frames were"} prepared for review on this device. The raw video and audio were not uploaded, and these previews will disappear when you leave.`, "success");
      } catch (error) {
        files = [];
        renderSelection();
        showFeedback(feedback, error.message);
      } finally {
        videoProcessing = false;
        setUploadEditorLocked(false);
        setPending(videoButton, false, "Record short room video");
        videoButton.disabled = false;
      }
    });
    room.addEventListener("change", () => { if (files.length) renderSelection(); });
    cameraButton.addEventListener("click", () => cameraInput.click());
    libraryButton.addEventListener("click", () => libraryInput.click());
    videoButton.addEventListener("click", () => videoInput.click());
    window.addEventListener("pagehide", clearSelectionPreviews, { once: true });
    pickerActions.append(cameraButton, videoButton, libraryButton, cameraInput, videoInput, libraryInput);
    choosePhoto = () => libraryInput.click();
    uploadSelectedPhotos = () => form.requestSubmit(upload);
    upload.disabled = !mediaReady;
    if (!mediaReady) upload.textContent = "Secure storage needed to save";
    form.append(roomLabel, noteLabel, localMediaBoundary, pickerActions, videoPrivacy, selected, selectionPreview, upload);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (uploadPending || videoProcessing) return;
      feedback.hidden = true;
      if (!mediaReady) return showFeedback(feedback, "These visual previews are still only on this device. Secure private storage must be connected before Homle can save them.");
      if (!form.reportValidity()) return;
      if (!files.length) return showFeedback(feedback, "Take a current room photo or choose photos from this device.");
      const queuedCount = files.length;
      let uploadedCount = 0;
      uploadPending = true;
      setRequestPhotoUploadInFlight(true);
      setUploadEditorLocked(true);
      setPending(upload, true, `Checking photo 1 of ${queuedCount}…`);
      try {
        const csrf = await recoverCsrf(feedback, "uploading this room photo");
        if (!csrf) return;
        while (files.length) {
          // The in-flight flag blocks the three ways a person can dismiss this
          // dialog, but not the two programmatic closes (resetRequestContinuation
          // and showRequestCompletion). A detached form means the panel is gone,
          // so stop rather than upload into nothing.
          if (!form.isConnected) break;
          if (browserOffline()) throw Object.assign(new Error("You are offline. The remaining selected photos are still here; reconnect, then continue the upload."), { code: "browser-offline" });
          const candidate = files[0];
          let uploadId = pendingPhotoCompletions.get(candidate);
          if (!uploadId) {
            setPending(upload, true, `Checking photo ${uploadedCount + 1} of ${queuedCount}…`);
            const checksumSha256 = await sha256(candidate.file);
            const intent = await requestJson(`/api/marketplace/cleaning-requests/${encodeURIComponent(request.requestId)}/photos/intents`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ roomName: room.value, note: note.value, mimeType: candidate.mimeType, byteSize: candidate.byteSize, checksumSha256 }) });
            const signed = intent.upload;
            if (signed?.method !== "PUT" || !signed.uploadId || !signed.uploadUrl || !signed.requiredHeaders || Object.keys(signed.requiredHeaders).length !== 4) throw new Error("The secure upload instructions were incomplete.");
            const destination = new URL(signed.uploadUrl);
            if (destination.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(destination.hostname)) throw new Error("The secure upload destination was unsafe.");
            setPending(upload, true, `Uploading photo ${uploadedCount + 1} of ${queuedCount} (${humanFileSize(candidate.byteSize)})…`);
            const uploadController = new AbortController();
            const uploadTimer = window.setTimeout(() => uploadController.abort(), 120_000);
            try {
              checkedUploadResponse(await fetch(destination, { method: "PUT", headers: signed.requiredHeaders, body: candidate.file, credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", signal: uploadController.signal }));
            } catch (error) {
              if (browserOffline()) throw Object.assign(new Error("You went offline during the private upload. The remaining selected photos are still here; reconnect, then continue."), { code: "browser-offline" });
              if (error?.name === "AbortError") throw new Error("The private photo upload took too long. The remaining selected photos are still here; check the connection and try again.");
              throw error;
            } finally {
              window.clearTimeout(uploadTimer);
            }
            uploadId = signed.uploadId;
            pendingPhotoCompletions.set(candidate, uploadId);
          }
          setPending(upload, true, `Securing photo ${uploadedCount + 1} of ${queuedCount}…`);
          let completed;
          const verificationHintTimer = window.setTimeout(() => {
            setPending(upload, true, `Removing metadata and securing photo ${uploadedCount + 1} of ${queuedCount}…`);
          }, 2_000);
          try {
            completed = await requestJson(`/api/marketplace/cleaning-requests/${encodeURIComponent(request.requestId)}/photos/${encodeURIComponent(uploadId)}/complete`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: "{}" });
          } catch (error) {
            if (["request-photo-upload-expired", "request-photo-upload-not-found", "request-photo-mismatch", "unsafe-request-photo", "request-photo-upload-not-allowed"].includes(error?.code)) pendingPhotoCompletions.delete(candidate);
            throw error;
          } finally {
            window.clearTimeout(verificationHintTimer);
          }
          requestScans.set(request.requestId, completed.scan);
          renderScanPhotos(request.requestId, completed.scan, list, count);
          refreshSubmissionAvailability();
          pendingPhotoCompletions.delete(candidate);
          files.shift();
          uploadedCount += 1;
          renderSelection();
          loaded = true;
        }
        note.value = "";
        showFeedback(feedback, `${uploadedCount} private room ${uploadedCount === 1 ? "photo" : "photos"} checked, sanitized and attached.`, "success");
      } catch (error) {
        if (error?.code === "request-photo-limit") files = [];
        renderSelection();
        showFeedback(feedback, `${uploadedCount ? `${uploadedCount} ${uploadedCount === 1 ? "photo was" : "photos were"} attached. ` : ""}${error.message}`);
      }
      finally {
        uploadPending = false;
        setRequestPhotoUploadInFlight(false);
        setUploadEditorLocked(false);
        setPending(upload, false, files.length ? `Upload ${files.length} remaining ${files.length === 1 ? "photo" : "photos"}` : "Upload private room photos");
        renderSelection();
      }
    });
    renderSelection();
    if (options.autoUpload && files.length) queueMicrotask(() => form.requestSubmit(upload));
    panel.append(form);

    const submitForm = element("form", "landlord-request-submit-form");
    const confirmLabel = element("label", "checkbox landlord-review-confirmation");
    const confirm = element("input");
    confirm.type = "checkbox";
    confirm.required = true;
    confirm.name = "scopeReviewed";
    confirmLabel.append(confirm, element("span", "", "I reviewed the Cleaner brief and any attached room photos. This is the exact service I want Homle to match and quote."));
    const previewLabel = element("label", "checkbox");
    const preview = element("input");
    preview.type = "checkbox";
    preview.name = "cleanerPreviewAuthorized";
    previewLabel.append(preview, element("span", "", "Allow the one invited Cleaner to privately preview these room photos before accepting. My identity, exact address and access details remain hidden."));
    const autoLabel = element("label", "checkbox");
    const auto = element("input");
    auto.type = "checkbox";
    auto.name = "automaticDispatch";
    const automaticMaximumPricePence = automaticMaximumPrice(request);
    autoLabel.append(auto, element("span", "", !automaticDispatchReady
      ? "Automatic matching is temporarily unavailable. Submit the reviewed request and it will stay safely open for Homle review; no Cleaner is contacted automatically."
      : automaticMaximumPricePence == null
      ? "Automatic matching needs a maximum booking total. Keep this request open and choose a Cleaner directly, or create a new request with a maximum."
      : `After submission, invite the best eligible profitable match only when the exact total is ${formatBookingMoney(automaticMaximumPricePence)} or less. No booking exists until a Cleaner accepts.`));
    const preferredLabel = element("label", "checkbox landlord-preferred-cleaner");
    const preferred = element("input");
    preferred.type = "checkbox";
    preferred.name = "selectedCleanerInvitation";
    const selectedCleanerReady = Boolean(selectedCleanerId && selectedCleanerProfile && selectedCleanerVerificationState === "ready");
    preferred.checked = selectedCleanerReady && matchingReady;
    preferredLabel.append(preferred, element("span", "", selectedCleanerReady ? (matchingReady ? `Invite ${selectedCleanerProfile.displayName} first. Homle will recheck the room scan, availability and service fit, then show your exact total for one approval before sending anything. If they cannot be invited, this request stays open for matching.` : `${selectedCleanerProfile.displayName} stays saved to this request. Cleaner invitations unlock only after Homle's private pricing and postcode-distance checks are connected.`) : "Use normal matching to find the best currently eligible and profitable Cleaner."));
    const attemptsLabel = element("label", "landlord-attempt-limit", "Maximum Cleaner invitations");
    const attempts = element("select");
    attempts.name = "attemptLimit";
    attempts.disabled = true;
    for (const value of [1, 2, 3, 4, 5]) { const option = element("option", "", String(value)); option.value = String(value); if (value === 3) option.selected = true; attempts.append(option); }
    attemptsLabel.append(attempts);
    attemptsLabel.hidden = !automaticDispatchReady || automaticMaximumPricePence == null;
    auto.addEventListener("change", () => { attempts.disabled = !automaticDispatchReady || !auto.checked; });
    submit = element("button", "button", "Submit cleaning request");
    submit.type = "button";
    submit.addEventListener("click", () => {
      if (selectedPhotoCount > 0) uploadSelectedPhotos?.();
    });
    preferred.disabled = !matchingReady;
    auto.disabled = !automaticDispatchReady || automaticMaximumPricePence == null;
    attempts.disabled = true;
    refreshSubmissionAvailability();
    submitForm.append(confirmLabel, previewLabel, ...(selectedCleanerReady ? [preferredLabel] : [autoLabel, attemptsLabel]), submit);
    submitForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      feedback.hidden = true;
      if (!submitForm.reportValidity()) return;
      if (auto.checked && !automaticDispatchReady) return showFeedback(feedback, "Automatic matching is temporarily unavailable. Leave it off and submit the request for Homle review.");
      if (auto.checked && !(await approveAutomaticDispatchPrice(automaticMaximumPricePence, Number(attempts.value)))) return;
      setPending(submit, true, "Submitting reviewed scan…");
      const csrf = await recoverCsrf(feedback, "submitting this cleaning request");
      if (!csrf) {
        setPending(submit, false, "Submit cleaning request");
        return;
      }
      let submitted = false;
      let submission = null;
      let selectedCleanerInvited = false;
      let selectedCleanerPricePence = null;
      try {
        const result = await requestJson(`/api/marketplace/cleaning-requests/${encodeURIComponent(request.requestId)}/submit`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ scopeReviewed: true, cleanerPreviewAuthorized: preview.checked }) });
        // Creation is the authoritative pricing boundary. The submit function
        // returns scan counts, while the request already carries the frozen
        // platform quote returned by that creation call. Keep both together so
        // the confirmation never hides the price and time the Landlord just
        // approved merely because the submission projection is intentionally
        // narrow.
        submission = {
          ...result.submission,
          quotedTotalPence: result.submission?.quotedTotalPence ?? request.quotedTotalPence,
          quotedMinutes: result.submission?.quotedMinutes ?? request.quotedMinutes,
          pricingConfigVersion: result.submission?.pricingConfigVersion ?? request.pricingConfigVersion,
          quotedAt: result.submission?.quotedAt ?? request.quotedAt
        };
        submitted = submission?.status === "searching-for-cleaner";
        if (!submitted) throw new Error("The submitted request could not be verified.");
        const index = requests.findIndex((item) => item.requestId === request.requestId);
        if (index >= 0) requests[index] = { ...requests[index], status: "searching-for-cleaner", submittedAt: submission.submittedAt, cleanerPreviewAuthorized: preview.checked };
        if (selectedCleanerReady && preferred.checked) {
          const quoted = await requestJson(`/api/marketplace/cleaning-requests/${encodeURIComponent(request.requestId)}/invitation-quote`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ cleanerId: selectedCleanerId }) });
          const approved = await approveInvitationQuote(quoted.quote, selectedCleanerProfile.displayName);
          if (!approved) {
            clearCleanerSelection();
            renderRequests();
            showRequestCompletion(submission, { warning: "You kept the request open without inviting the selected Cleaner. No booking or payment exists. You can track the request and choose matching when ready." });
            return;
          }
          selectedCleanerPricePence = Number(quoted.quote.customerPricePence);
          const invited = await requestJson(`/api/marketplace/cleaning-requests/${encodeURIComponent(request.requestId)}/invitations`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ cleanerId: selectedCleanerId, approvedCustomerPricePence: selectedCleanerPricePence }) });
          if (Number(invited.booking?.customerPricePence) !== selectedCleanerPricePence) throw new Error("The saved invitation total could not be verified. Refresh the request before taking another action.");
          selectedCleanerInvited = true;
          if (index >= 0) requests[index] = { ...requests[index], status: "cleaner-invited" };
        } else if (auto.checked) await requestJson(`/api/marketplace/cleaning-requests/${encodeURIComponent(request.requestId)}/automatic-dispatch`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ enabled: true, attemptLimit: Number(attempts.value), approvedMaximumPricePence: automaticMaximumPricePence }) });
        clearCleanerSelection();
        renderRequests();
        showRequestCompletion(submission, { automaticDispatch: auto.checked, automaticMaximumPricePence, selectedCleanerInvited, selectedCleanerPricePence });
      } catch (error) {
        if (submitted) {
          const selectedInvitationFailed = Boolean(selectedCleanerReady && preferred.checked);
          clearCleanerSelection();
          renderRequests();
          showRequestCompletion(submission, { warning: selectedInvitationFailed
            ? selectedCleanerInvitationRecovery(error)
            : `The room scan is safely submitted, but Homle could not verify automatic invitation authorisation: ${error.message} Check the request before retrying.` });
        } else showFeedback(requestFeedback, error.message);
      } finally { setPending(submit, false, "Submit cleaning request"); }
    });
    panel.append(submitForm);
  }
  panel.append(feedback);
  details.append(panel);
  return details;
}

function renderRequests() {
  requestList.replaceChildren();
  activeRequestList?.replaceChildren();
  // A matched request has become a booking, and the Happening now card below
  // renders that booking from its real status and real timestamps. Keeping the
  // request card too put the same clean on screen twice, under two progress
  // rails that disagreed: this one is hardcoded to "Matching in progress", so a
  // booking already marked On the way sat directly beneath a card insisting a
  // Cleaner was still being found. Once a booking exists, the booking owns it.
  //
  // liveBookingForRequest owns the join. A Landlord's booking summary carries no
  // request id at all, so reading one off the booking finds nothing and leaves
  // both cards on screen; the frozen time window is what actually matches here.
  const visibleRequests = requests.filter((request) => request.status !== "cancelled"
    && !(request.status === "matched" && liveBookingForRequest(request, bookings)));
  for (const request of visibleRequests) {
    const submitted = request.status !== "draft";
    const card = element("article", submitted ? "landlord-request-card ld-request-now" : "landlord-request-card");
    card.dataset.cleaningRequestId = request.requestId;
    const property = properties.find((item) => item.propertyId === request.propertyId);
    const heading = element("div", "landlord-request-card-heading");
    const title = element("div");
    title.append(element("span", "landlord-private-pill", requestStatusLabel(request.status)), element("h3", "", property?.name || "Saved property"));
    heading.append(title, element("strong", "", String(request.cleaningType || "Cleaning").replace(/-/g, " ")));
    const start = new Date(request.requestedStartAt);
    const end = new Date(request.requestedEndAt);
    const duration = Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) ? "Time unavailable" : `${Math.round((end - start) / 3_600_000 * 10) / 10} hours`;
    let facts;
    if (submitted) {
      const nowTop = element("div", "ld-request-now-top");
      const status = element("span", "ld-request-now-pill", request.status === "searching-for-cleaner" ? "Finding your cleaner" : requestStatusLabel(request.status));
      status.prepend(element("span", "ld-request-now-dot"));
      nowTop.append(status, element("span", "ld-request-now-since", "Matching in progress"));
      const identity = element("div", "ld-request-now-identity");
      const icon = element("span", "ld-request-now-icon");
      icon.append(cloneIcon("home"));
      const identityCopy = element("div", "ld-request-now-identity-copy");
      identityCopy.append(
        element("strong", "", property?.name || "Saved property"),
        element("span", "", [Number.isNaN(start.getTime()) ? "Date unavailable" : formatBookingMoment(start.toISOString()), duration, String(request.cleaningType || "Cleaning").replace(/-/g, " "), `${Array.isArray(request.tasks) ? request.tasks.length : 0} ${Array.isArray(request.tasks) && request.tasks.length === 1 ? "task" : "tasks"}`].join(" · "))
      );
      const placeDetails = element("button", "ld-request-now-place", "Place details →");
      placeDetails.type = "button";
      placeDetails.hidden = !property;
      if (property) placeDetails.addEventListener("click", () => openPropertyEditor(property));
      identity.append(icon, identityCopy, placeDetails);
      const stages = element("ol", "ld-request-now-stages");
      for (const [label, state] of [["Booked", "done"], ["Matching", "current"], ["On the way", "future"], ["Cleaning", "future"], ["Complete", "future"]]) {
        const item = element("li", `ld-request-now-stage is-${state}`);
        item.append(element("span", "ld-request-now-stage-mark", state === "done" ? "✓" : ""), element("span", "", label));
        stages.append(item);
      }
      facts = element("div", "ld-request-now-main");
      facts.append(nowTop, identity, stages);
    } else {
      facts = element("dl", "landlord-request-facts");
      facts.append(propertyFact("Requested", Number.isNaN(start.getTime()) ? "Unavailable" : formatBookingMoment(start.toISOString())), propertyFact("Duration", duration), propertyFact("Tasks", Array.isArray(request.tasks) ? request.tasks.length : 0), propertyFact("Frequency", String(request.frequency || "one-time").replace(/-/g, " ")));
    }
    const boundaryCopy = request.status === "draft"
      ? "Private draft only — no Cleaner has been invited and no booking or payment exists."
      : request.status === "searching-for-cleaner"
      ? "Open for matching — no booking exists until an eligible Cleaner accepts the frozen terms."
      : request.status === "cancelled"
      ? "Withdrawn — matching is closed and no booking or payment was changed."
      : "This request has entered the account workflow.";
    const boundary = element("p", "landlord-request-boundary", boundaryCopy);
    if (submitted) card.append(facts);
    else card.append(heading, facts, boundary);
    // An unsent draft blocks its property from Your places just as a live
    // booking does, and unlike the matching card above this one offered no way
    // back, so access details for a place with a draft were unreachable.
    if (!submitted && property) {
      const draftPlaceDetails = element("button", "button button-outline", "Place details");
      draftPlaceDetails.type = "button";
      draftPlaceDetails.setAttribute("aria-label", `Place details for ${property.name || "saved property"}`);
      draftPlaceDetails.addEventListener("click", () => openPropertyEditor(property));
      card.append(draftPlaceDetails);
    }
    if (request.status === "draft") {
      const continueRequest = element("button", "button", "Continue photos and matching");
      continueRequest.type = "button";
      continueRequest.addEventListener("click", () => {
        selectWorkspaceTab("requests", { historyMode: "push" });
        showRequestContinuation(request);
      });
      card.append(continueRequest);
    } else card.append(requestScanPanel(request));
    const dispatchAction = landlordDispatchAction(request);
    if (dispatchAction.kind !== "none") {
      const dispatchPanel = element("section", "landlord-dispatch-action");
      dispatchPanel.setAttribute("aria-label", "Cleaner matching authorization");
      dispatchPanel.dataset.dispatchRequestId = request.requestId;
      const dispatchFeedback = element("p", "form-feedback");
      dispatchFeedback.hidden = true;
      if (!automaticDispatchReady) {
        dispatchPanel.append(
          element("strong", "", "Automatic matching is temporarily paused"),
          element("p", "", dispatchAction.kind === "waiting"
            ? "Your matching authorization remains saved, but no background invitation is running. The request stays open for Homle review and no Cleaner is contacted automatically."
            : "This request stays safely open for Homle review. No Cleaner is contacted automatically while the background matching service is unavailable.")
        );
      } else if (uncertainDispatchRequests.has(request.requestId)) {
        dispatchPanel.append(element("strong", "", "Check whether matching was authorised"), element("p", "", "The last connection ended before Homle could confirm the result. Refresh the saved request before authorising anything again."));
        const refresh = element("button", "button button-outline", "Refresh matching status");
        refresh.type = "button";
        refresh.addEventListener("click", () => refreshDispatchAuthorization(request.requestId, refresh, dispatchFeedback));
        dispatchPanel.append(refresh, dispatchFeedback);
      } else if (dispatchAction.kind === "waiting") {
        const maximum = automaticMaximumPrice(request);
        dispatchPanel.append(element("strong", "", "Finding one eligible Cleaner"), element("p", "", maximum == null
          ? "Matching authorization exists on this older request, but its maximum total cannot be displayed. Homle will not offer another authorization; review the saved request before continuing."
          : `You authorised ${dispatchAction.attemptLimit === 1 ? "one Cleaner invitation" : `up to ${dispatchAction.attemptLimit} total invitations`} at no more than ${formatBookingMoney(maximum)}. Homle is checking service fit, exact availability and profitable pricing. No booking or charge exists until a Cleaner accepts and you authorise payment.`));
      } else if (dispatchAction.kind === "exhausted") {
        dispatchPanel.append(element("strong", "", "Matching needs review"), element("p", "", "Five Cleaner invitation attempts have been used. Homle will not contact anyone else automatically; review the timing or scope before deciding what to change."));
      } else {
        const firstAttempt = dispatchAction.kind === "authorize" && dispatchAction.attemptCount === 0;
        const maximum = automaticMaximumPrice(request);
        const needsExactQuote = maximum == null;
        dispatchPanel.append(element("strong", "", needsExactQuote ? "Choose the best Cleaner and exact price" : firstAttempt ? "Ready to find your Cleaner?" : "Try one more eligible Cleaner?"), element("p", "", needsExactQuote ? "Homle will check eligible Cleaners now and show the best current Cleaner and exact total for your approval. Nothing is invited or charged until you approve." : `This authorises exactly one additional invitation to the best eligible profitable match at no more than ${formatBookingMoney(maximum)}. It is not a booking, no payment is taken, and the Cleaner must still accept.`));
        const authorize = element("button", "button", needsExactQuote ? "See best Cleaner & exact price" : firstAttempt ? "Find my Cleaner" : "Try one more Cleaner");
        authorize.type = "button";
        authorize.disabled = !matchingReady;
        authorize.addEventListener("click", () => needsExactQuote
          ? inviteBestEligibleCleaner(request.requestId, authorize, dispatchFeedback)
          : authorizeNextCleaner(request.requestId, dispatchAction.attemptLimit, authorize, dispatchFeedback));
        dispatchPanel.append(authorize, dispatchFeedback);
      }
      card.append(dispatchPanel);
    }
    if (["draft", "searching-for-cleaner"].includes(request.status)) {
      const actions = element("div", "landlord-request-actions");
      const withdraw = element("button", "text-button", "Withdraw request");
      withdraw.type = "button";
      withdraw.setAttribute("aria-label", `Withdraw cleaning request for ${property?.name || "saved property"}`);
      withdraw.addEventListener("click", () => openRequestWithdrawal(request.requestId));
      actions.append(withdraw);
      card.append(actions);
    }
    (submitted && activeRequestList ? activeRequestList : requestList).append(card);
  }
  const draftCount = visibleRequests.filter((request) => request.status === "draft").length;
  const submittedCount = visibleRequests.length - draftCount;
  // The reviewed hub has no empty "requests" card. With no private draft the
  // entire shelf disappears; Your places already carries the next action.
  requestEmpty.hidden = true;
  requestList.hidden = draftCount === 0;
  if (activeRequestList) activeRequestList.hidden = submittedCount === 0;
  document.querySelector("[data-draft-count]").textContent = String(draftCount);
  updateUpcomingRevealCount();
  syncHappeningNowLabel();
}

async function inviteBestEligibleCleaner(requestId, button, feedback, options = {}) {
  const idleLabel = options.idleLabel || "See best Cleaner & exact price";
  feedback.hidden = true;
  if (!matchingReady) return showFeedback(feedback, "Cleaner pricing and distance matching are temporarily unavailable. This request remains safely open and no payment was started.");
  setPending(button, true, "Finding the best eligible Cleaner…");
  const csrf = await recoverCsrf(feedback, "choosing a Cleaner");
  if (!csrf) {
    setPending(button, false, idleLabel);
    return;
  }
  let invitationStarted = false;
  try {
    const matchResult = await requestJson(`/api/marketplace/cleaning-requests/${encodeURIComponent(requestId)}/matches`);
    const candidate = Array.isArray(matchResult.candidates) ? matchResult.candidates[0] : null;
    if (!candidate?.cleanerId) throw Object.assign(new Error("No eligible Cleaner is currently available for this exact time, service area and checklist. Your request remains open; try again later or change the timing."), { code: "no-eligible-cleaner" });
    setPending(button, true, "Checking the exact price…");
    const quoted = await requestJson(`/api/marketplace/cleaning-requests/${encodeURIComponent(requestId)}/invitation-quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ cleanerId: candidate.cleanerId })
    });
    const approvedPricePence = Number(quoted.quote?.customerPricePence);
    if (!(await approveInvitationQuote(quoted.quote, candidate.displayName))) {
      showFeedback(feedback, "No invitation was sent and no payment was started. The request remains open.");
      return;
    }
    invitationStarted = true;
    setPending(button, true, "Sending the approved invitation…");
    const invited = await requestJson(`/api/marketplace/cleaning-requests/${encodeURIComponent(requestId)}/invitations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ cleanerId: candidate.cleanerId, approvedCustomerPricePence: approvedPricePence })
    });
    if (Number(invited.booking?.customerPricePence) !== approvedPricePence) throw new Error("The saved invitation total could not be verified. Refresh the request before taking another action.");
    await refreshBookingTransition();
    setLandlordSectionExpanded(upcomingSectionToggle, true);
    showFeedback(requestStatus, `${candidate.displayName || "The best eligible Cleaner"} was invited at ${formatBookingMoney(approvedPricePence)}. Stripe checkout opens after they accept the exact total.`, "success");
  } catch (error) {
    if (invitationStarted && (error?.code === "request-timeout" || /may have (?:reached Homle|completed)/i.test(error?.message || ""))) {
      uncertainDispatchRequests.add(requestId);
      await refreshBookingTransition();
      showFeedback(requestStatus, "Homle could not verify the final invitation response. The saved booking status was refreshed; do not send another invitation until the result is shown.");
    } else {
      if (error?.code === "no-eligible-cleaner") {
        showNoEligibleCleanerOutcome(requestId);
      } else showFeedback(feedback, error.message);
    }
  } finally {
    if (button.isConnected) setPending(button, false, idleLabel);
  }
}

async function authorizeNextCleaner(requestId, attemptLimit, button, feedback) {
  feedback.hidden = true;
  if (!automaticDispatchReady) return showFeedback(feedback, "Automatic matching is temporarily unavailable. This request remains safely open for Homle review; no Cleaner was contacted.");
  const request = requests.find((item) => item.requestId === requestId);
  const approvedMaximumPricePence = automaticMaximumPrice(request);
  if (approvedMaximumPricePence == null) return showFeedback(feedback, "This request has no approved maximum total. Choose a Cleaner directly or create a new request with a maximum.");
  if (!(await approveAutomaticDispatchPrice(approvedMaximumPricePence, attemptLimit))) return;
  setPending(button, true, "Authorising…");
  const csrf = await recoverCsrf(feedback, "authorising Cleaner matching");
  if (!csrf) {
    setPending(button, false, attemptLimit === 1 ? "Find my Cleaner" : "Try one more Cleaner");
    return;
  }
  try {
    const result = await requestJson(`/api/marketplace/cleaning-requests/${encodeURIComponent(requestId)}/automatic-dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ enabled: true, attemptLimit, approvedMaximumPricePence })
    });
    requests = requests.map((request) => request.requestId === requestId ? { ...request, automaticDispatch: result.automaticDispatch } : request);
    uncertainDispatchRequests.delete(requestId);
    renderRequests();
    showFeedback(requestStatus, "Matching authorised for one additional Cleaner. No booking or payment exists until they accept and you approve the next step.", "success");
  } catch (error) {
    const uncertain = error?.code === "request-timeout" || /may have (?:reached Homle|completed)/i.test(error?.message || "");
    if (uncertain) {
      uncertainDispatchRequests.add(requestId);
      renderRequests();
      showFeedback(requestStatus, "Homle could not verify whether matching was authorised. Refresh the saved status before trying again; no action will be repeated automatically.");
    } else {
      showFeedback(feedback, error.statusCode === 401 || error.statusCode === 403 ? "Your secure session expired or cannot authorise matching. Sign in again." : error.message);
      setPending(button, false, attemptLimit === 1 ? "Find my Cleaner" : "Try one more Cleaner");
    }
  }
}

async function refreshDispatchAuthorization(requestId, button, feedback) {
  feedback.hidden = true;
  setPending(button, true, "Refreshing…");
  try {
    const result = await requestJson("/api/marketplace/cleaning-requests");
    requests = Array.isArray(result.cleaningRequests) ? result.cleaningRequests : [];
    uncertainDispatchRequests.delete(requestId);
    renderRequests();
    const current = requests.find((request) => request.requestId === requestId);
    showFeedback(requestStatus, current?.automaticDispatch?.enabled ? "Matching authorization is saved. Homle will not repeat it." : "Matching was not authorised. You can choose the next action now.", "success");
  } catch (error) {
    showFeedback(feedback, error.message);
    setPending(button, false, "Refresh matching status");
  }
}

function setBookingLiveStatus(message, kind = "info", action = null) {
  bookingLiveStatus.dataset.kind = kind;
  bookingLiveStatus.textContent = message;
  // The line is a live region, so the Landlord who was told "Cleaner accepted"
  // used to be left to hunt for where to pay. When the update calls for one,
  // the action rides in the same announcement, and textContent above has
  // already cleared any previous one so actions never accumulate.
  if (action?.href && action?.label) {
    const link = element("a", "button landlord-live-action", action.label);
    link.href = action.href;
    bookingLiveStatus.append(link);
  }
}

function closeInvitationStream() {
  invitationStream?.close();
  invitationStream = null;
  invitationStreamKey = "";
}

function clearLandlordInvitationDeadlineTimer() {
  window.clearTimeout(landlordInvitationDeadlineTimer);
  landlordInvitationDeadlineTimer = null;
}

async function refreshBookingTransition({ manual = false } = {}) {
  if (bookingTransitionRefresh) return bookingTransitionRefresh;
  const before = new Map(bookings.map((booking) => [booking.bookingId, booking.status]));
  bookingRefresh.disabled = true;
  bookingRefresh.textContent = "Refreshing…";
  bookingTransitionRefresh = (async () => {
    try {
      const [bookingResult, requestResult] = await Promise.all([
        requestJson("/api/marketplace/bookings?limit=50"),
        requestJson("/api/marketplace/cleaning-requests")
      ]);
      bookings = Array.isArray(bookingResult.bookings) ? bookingResult.bookings : [];
      requests = Array.isArray(requestResult.cleaningRequests) ? requestResult.cleaningRequests : [];
      const invited = bookings.find((booking) => !before.has(booking.bookingId) && booking.status === "pending-cleaner-acceptance");
      const accepted = bookings.find((booking) => before.get(booking.bookingId) === "pending-cleaner-acceptance" && booking.status === "confirmed");
      const closed = bookings.find((booking) => before.get(booking.bookingId) === "pending-cleaner-acceptance" && booking.status === "cancelled");
      renderRequests();
      renderBookings();
      // Acceptance is the moment the exact total exists, so the same update
      // that announces it carries the way to authorize it. Following the link
      // is still optional and the booking card keeps its own copy of the
      // action; nothing is charged by rendering a route to checkout.
      if (accepted) setBookingLiveStatus(`Cleaner accepted — ${accepted.propertyName || "your clean"} is now a confirmed booking.`, "success", accepted.paymentStepAvailable && Number.isInteger(accepted.pricePence)
        ? { label: `Authorize ${formatBookingMoney(accepted.pricePence)} securely`, href: `/landlord/checkout?bookingId=${encodeURIComponent(accepted.bookingId)}` }
        : null);
      else if (closed) setBookingLiveStatus("That Cleaner could not take the request. Matching has reopened and no payment was taken.", "attention");
      else if (invited) setBookingLiveStatus("A Cleaner invitation was sent. Homle is now watching securely for their response; no booking is confirmed and no payment was taken.", "live");
      else if (manual) setBookingLiveStatus("Booking and Cleaner-response status checked just now.", "success");
      return true;
    } catch (error) {
      setBookingLiveStatus(error.code === "browser-offline" ? "You are offline. The last verified booking status remains shown." : "Booking status could not be refreshed. The last verified status remains shown; try again.", "error");
      return false;
    }
  })();
  try { return await bookingTransitionRefresh; }
  finally {
    bookingTransitionRefresh = null;
    bookingRefresh.disabled = false;
    bookingRefresh.textContent = "Refresh booking status";
  }
}

function syncInvitationStream() {
  const pending = bookings.find((booking) => booking.participantRole === "landlord" && booking.status === "pending-cleaner-acceptance");
  const matchingRequest = requests.find((request) => request.status === "searching-for-cleaner" && request.automaticDispatch?.enabled === true);
  if (!pending && !matchingRequest) {
    closeInvitationStream();
    if (bookingLiveStatus.dataset.kind !== "success" && bookingLiveStatus.dataset.kind !== "attention") setBookingLiveStatus("No Cleaner response is currently waiting. Refresh any time.");
    return;
  }
  const streamType = pending ? "booking" : "request";
  const streamId = pending?.bookingId || matchingRequest.requestId;
  const streamKey = `${streamType}:${streamId}`;
  if (invitationStream && invitationStreamKey === streamKey) return;
  closeInvitationStream();
  if (typeof EventSource !== "function") {
    setBookingLiveStatus("Live Cleaner-response updates are unavailable in this browser. Use Refresh booking status.", "attention");
    return;
  }
  const streamPath = streamType === "booking"
    ? `/api/marketplace/bookings/${encodeURIComponent(streamId)}/events`
    : `/api/marketplace/cleaning-requests/${encodeURIComponent(streamId)}/events`;
  const stream = new EventSource(streamPath, { withCredentials: true });
  invitationStream = stream;
  invitationStreamKey = streamKey;
  stream.addEventListener("open", () => setBookingLiveStatus(streamType === "booking" ? "Watching securely for the Cleaner’s response." : "Finding one eligible Cleaner. This page will update automatically when an invitation is sent.", "live"));
  stream.addEventListener("booking-snapshot", (event) => {
    try {
      const snapshot = JSON.parse(event.data);
      if (snapshot.bookingId !== streamId) throw new Error("Booking mismatch");
      const current = bookings.find((booking) => booking.bookingId === streamId);
      if (snapshot.status && snapshot.status !== current?.status) void refreshBookingTransition();
    } catch { setBookingLiveStatus("A live update could not be verified. Use Refresh booking status.", "error"); }
  });
  stream.addEventListener("request-snapshot", (event) => {
    try {
      const snapshot = JSON.parse(event.data);
      if (snapshot.requestId !== streamId) throw new Error("Request mismatch");
      const current = requests.find((request) => request.requestId === streamId);
      const dispatch = current?.automaticDispatch || {};
      const liveDispatch = snapshot.automaticDispatch || {};
      if (snapshot.status !== current?.status || liveDispatch.lastResult !== dispatch.lastResult || Number(liveDispatch.attemptCount) !== Number(dispatch.attemptCount)) void refreshBookingTransition();
    } catch { setBookingLiveStatus("A live matching update could not be verified. Use Refresh booking status.", "error"); }
  });
  stream.addEventListener("stream-error", () => setBookingLiveStatus("Live updates were interrupted. Use Refresh booking status while Homle reconnects.", "attention"));
  stream.addEventListener("error", () => setBookingLiveStatus("Reconnecting securely for the Cleaner’s response. The last verified status remains shown.", "attention"));
}

function openRequestWithdrawal(requestId, propertyId = "") {
  const request = requests.find((item) => item.requestId === requestId);
  if (!request || !["draft", "searching-for-cleaner"].includes(request.status)) return;
  withdrawingRequestId = requestId;
  withdrawingFromPropertyId = propertyId;
  requestWithdrawForm.reset();
  requestWithdrawFeedback.hidden = true;
  requestStatus.hidden = true;
  requestWithdrawDialog.showModal();
  requestWithdrawForm.elements.reasonCode.focus();
}

async function withdrawRequest(event) {
  event.preventDefault();
  requestWithdrawFeedback.hidden = true;
  if (withdrawalPending || !requestWithdrawForm.reportValidity()) return;
  const csrf = await recoverCsrf(requestWithdrawFeedback, "withdrawing this request");
  if (!csrf) return;
  const requestId = withdrawingRequestId;
  if (!requestId) return showFeedback(requestWithdrawFeedback, "The cleaning request is no longer available.");
  withdrawalPending = true;
  requestWithdrawCancel.disabled = true;
  setPending(requestWithdrawConfirm, true, "Withdrawing…");
  try {
    const result = await requestJson(`/api/marketplace/cleaning-requests/${encodeURIComponent(requestId)}/withdraw`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ reasonCode: requestWithdrawForm.elements.reasonCode.value })
    });
    requests = requests.map((request) => request.requestId === requestId ? { ...request, status: result.withdrawal.status } : request);
    const propertyReturnId = withdrawingFromPropertyId;
    withdrawingRequestId = "";
    requestWithdrawDialog.close();
    renderRequests();
    renderProperties();
    if (propertyReturnId) {
      const property = properties.find((item) => item.propertyId === propertyReturnId);
      showFeedback(propertyStatus, `${property?.name || "Property"} is no longer blocked by that cleaning request. You can now delete it.`, "success");
      propertyStatus.focus({ preventScroll: true });
    }
    showFeedback(requestStatus, "Request withdrawn. Matching is closed and no booking or payment was changed.", "success");
  } catch (error) {
    showFeedback(requestWithdrawFeedback, error.statusCode === 401 || error.statusCode === 403 ? "Your secure session expired or cannot withdraw this request. Sign in again." : error.message);
  } finally {
    withdrawalPending = false;
    requestWithdrawCancel.disabled = false;
    setPending(requestWithdrawConfirm, false, "Withdraw request");
  }
}

function renderBookingCard(booking) {
  const card = element("article", "booking-summary-card");
  if (booking.status === "pending-cleaner-acceptance") {
    card.classList.add("landlord-waiting-card");
    card.dataset.landlordWaitingBookingId = booking.bookingId;
  }
  // The v2 booking row: the property leads, then one line saying when, who and
  // how much — the three things the design puts under the address. The status
  // pill and the price keep their own elements so the existing styling and the
  // status-agreement test still find them.
  const settled = ["completed", "awaiting-review", "cancelled", "disputed"].includes(booking.status);
  const heading = element("div", "booking-summary-heading");
  const icon = element("span", `ld-booking-icon${settled ? " ld-booking-icon-done" : ""}`);
  icon.append(cloneIcon(settled ? "booking-done" : "booking"));
  icon.setAttribute("aria-hidden", "true");
  const title = element("div", "ld-booking-main");
  // Price is deliberately not repeated here — booking-summary-price carries it.
  const meta = [formatBookingWindow(booking.scheduledStartAt, booking.scheduledEndAt), booking.counterpartyName || "Assigned Cleaner"].filter(Boolean).join(" · ");
  title.append(element("h3", "", booking.propertyName || "Saved property"), element("p", "", meta));
  heading.append(icon, title, element("span", "booking-status-pill", bookingSummaryStatusLabels[booking.status] || "Booking"), element("strong", "booking-summary-price", formatBookingMoney(booking.pricePence)));
  const facts = element("dl", "booking-summary-facts");
  // Cleaning type moved down here when the address took the heading.
  for (const [label, value] of [["Clean", booking.cleaningType || "Cleaning"], ["When", formatBookingWindow(booking.scheduledStartAt, booking.scheduledEndAt)], ["Area", booking.propertyArea || "Saved property area"], [bookingSummaryPriceLabel("landlord"), formatBookingMoney(booking.pricePence)], ["Checklist", `${booking.taskCount} ${booking.taskCount === 1 ? "task" : "tasks"}`]]) {
    const wrapper = element("div");
    wrapper.append(element("dt", "", label), element("dd", "", value));
    facts.append(wrapper);
  }
  const actions = element("div", "booking-summary-actions");
  const activeChangeRequest = activeBookingChangeRequestFor(supportRequests, booking.bookingId);
  if (booking.paymentStepAvailable) {
    const payment = element("a", "button", "Authorize booking total");
    payment.href = `/landlord/checkout?bookingId=${encodeURIComponent(booking.bookingId)}`;
    actions.append(payment);
  }
  if (booking.activeJobAvailable) {
    const link = element("a", booking.paymentStepAvailable ? "button button-outline" : "button", ["awaiting-review", "completed"].includes(booking.status) ? "View job record" : booking.paymentStepAvailable ? "View booking details" : "Open live booking");
    link.href = `/bookings/${booking.bookingId}`;
    actions.append(link);
  }
  if (booking.status === "confirmed" && Date.parse(booking.scheduledStartAt) > Date.now()) {
    const change = element("a", "button button-outline", activeChangeRequest ? "View change request" : "Request a change");
    change.href = `/landlord/help?bookingId=${encodeURIComponent(booking.bookingId)}${activeChangeRequest ? "#support-history" : ""}`;
    actions.append(change);
  }
  card.append(heading, facts, element("p", "booking-money-boundary", bookingSummaryMoneyBoundary(booking, "landlord")));
  if (activeChangeRequest) {
    const action = activeChangeRequest.bookingChangeKind === "cancel" ? "Cancellation requested" : "Reschedule requested";
    const proposed = activeChangeRequest.bookingChangeKind === "reschedule" && activeChangeRequest.proposedStartAt
      ? ` Preferred time: ${formatBookingMoment(activeChangeRequest.proposedStartAt)}.`
      : "";
    card.append(element("p", "landlord-request-boundary", `${action} · ${supportStatusLabels[activeChangeRequest.status]}.${proposed} This booking, Cleaner commitment and payment remain unchanged until Homle confirms the outcome.`));
  }
  if (booking.status === "pending-cleaner-acceptance") {
    const deadline = bookingInvitationDeadlineState(booking);
    const boundary = element("p", "landlord-waiting-deadline");
    boundary.dataset.landlordWaitingDeadline = "";
    boundary.setAttribute("role", "status");
    boundary.dataset.kind = deadline.kind;
    boundary.textContent = deadline.kind === "expired"
      ? "The Cleaner response window has ended. Homle is updating the request before matching can continue."
      : deadline.kind === "unavailable"
        ? "The Cleaner response deadline is being verified. No booking or payment has been created."
        : `Cleaner response due by ${formatBookingMoment(booking.responseDeadline)}. If they do not accept, this invitation closes and matching can reopen.`;
    card.append(boundary, element("p", "landlord-request-boundary", "No payment has been taken. This becomes a confirmed booking only if the Cleaner accepts the frozen time, checklist and total."));
  } else if (booking.paymentAuthorizationReady) card.append(element("p", "landlord-request-boundary", "Payment authorization is ready for this clean."));
  else if (booking.paymentStepOpensAt) card.append(element("p", "landlord-request-boundary", `Payment opens ${formatBookingMoment(booking.paymentStepOpensAt)}. No action is needed yet.`));
  if (actions.childElementCount) card.append(actions);
  return card;
}

function updateLandlordWaitingDeadlineCard(card, booking) {
  const deadline = bookingInvitationDeadlineState(booking);
  const boundary = card.querySelector("[data-landlord-waiting-deadline]");
  if (!boundary) return deadline;
  boundary.dataset.kind = deadline.kind;
  boundary.textContent = deadline.kind === "expired"
    ? "The Cleaner response window has ended. Homle is checking the current request without sending or repeating any action."
    : deadline.kind === "unavailable"
      ? "The Cleaner response deadline is being verified. No booking or payment has been created."
      : deadline.kind === "closed"
        ? "This Cleaner invitation is no longer awaiting a response."
        : `Cleaner replies within ${formatInvitationTimeRemaining(deadline.remainingMs)} · by ${formatBookingMoment(booking.responseDeadline)}. If they do not accept, this invitation closes and matching can reopen.`;
  return deadline;
}

async function refreshExpiredLandlordWaiting() {
  if (refreshingExpiredWaiting || !expiredWaitingRefreshNeeded || browserOffline()) return;
  refreshingExpiredWaiting = true;
  setBookingLiveStatus("A Cleaner response window ended. Homle is checking the current status without sending any action.", "attention");
  try {
    const refreshed = await refreshBookingTransition();
    expiredWaitingRefreshNeeded = false;
    if (refreshed && bookings.some((booking) => booking.status === "pending-cleaner-acceptance" && bookingInvitationDeadlineState(booking).kind === "expired")) {
      setBookingLiveStatus("The response window has ended. Homle is waiting for the server to reopen matching; no booking or payment was created.", "attention");
    }
  } finally {
    refreshingExpiredWaiting = false;
  }
}

function updateLandlordWaitingDeadlines() {
  clearLandlordInvitationDeadlineTimer();
  let nextUpdateMs = Number.POSITIVE_INFINITY;
  let expired = false;
  for (const card of document.querySelectorAll("[data-landlord-waiting-booking-id]")) {
    const booking = bookings.find((record) => record.bookingId === card.dataset.landlordWaitingBookingId);
    if (!booking) continue;
    const deadline = updateLandlordWaitingDeadlineCard(card, booking);
    if (deadline.kind === "expired") expired = true;
    else if (["open", "urgent"].includes(deadline.kind)) nextUpdateMs = Math.min(nextUpdateMs, deadline.remainingMs, 60_000);
  }
  if (expired) {
    expiredWaitingRefreshNeeded = true;
    queueMicrotask(refreshExpiredLandlordWaiting);
    return;
  }
  expiredWaitingRefreshNeeded = false;
  if (Number.isFinite(nextUpdateMs)) landlordInvitationDeadlineTimer = window.setTimeout(updateLandlordWaitingDeadlines, Math.max(1_000, nextUpdateMs + 250));
}

/**
 * Guide prices for the Home view's "Recommended for you" cards.
 *
 * THESE ARE NOT QUOTES, and there is deliberately no endpoint behind them.
 * Homle has no landlord-facing pricing API: the only pricing rules that exist
 * (/api/marketplace/pricing/scan-ruleset) price a completed room scan, not a
 * catalogue. A real total is the one a Cleaner accepts against a frozen
 * checklist, which is the guarantee the whole request flow is built on.
 *
 * So they are a labelled constant rather than a fetch pretending to be one, the
 * section header carries an "Indicative" flag, and every card links to the scan
 * that produces a real price instead of adding anything to a draft. When a
 * pricing endpoint exists, replace this array and the markup stays as it is.
 */
// `code` is the marketplace service each card stands for, carried into the
// journey so choosing "Deep clean" here does not mean answering "which service?"
// again two steps later. The codes are the ones landlord-journey-model.js
// already prices; the journey ignores anything it does not recognise.
const LD_INDICATIVE_PLANS = Object.freeze([
  Object.freeze({ name: "Standard clean", desc: "Living room, kitchen, bathroom", from: "£68", tone: "standard", code: "regular-domestic" }),
  Object.freeze({ name: "Deep clean", desc: "Detailed kitchen and bathroom refresh", from: "£112", tone: "deep", code: "deep-cleans" }),
  Object.freeze({ name: "End of tenancy", desc: "Full property clean", from: "£185", tone: "tenancy", code: "end-of-tenancy" })
]);

/* Cloned from the <template>s in the markup — see the note beside them. */
function planArtwork(tone) {
  const template = document.querySelector(`[data-ld-plan-art="${tone}"]`);
  return template ? template.content.cloneNode(true) : document.createDocumentFragment();
}

let indicativePlansRendered = false;

function renderIndicativePlans() {
  const list = document.querySelector("[data-ld-plans]");
  if (!list || indicativePlansRendered) return;
  list.replaceChildren(...LD_INDICATIVE_PLANS.map((plan) => {
    const row = element("a", `ld-plan ld-plan-${plan.tone}`);
    row.href = `/landlord/book?service=${encodeURIComponent(plan.code)}`;
    const icon = element("span", "ld-plan-icon");
    icon.append(planArtwork(plan.tone));
    icon.setAttribute("aria-hidden", "true");
    const copy = element("span", "ld-plan-copy");
    copy.append(element("strong", "", plan.name), element("small", "", plan.desc));
    const price = element("span", "ld-plan-price");
    price.append(element("small", "", "From"), element("strong", "", plan.from));
    const chev = element("span", "ld-plan-chev", "›");
    chev.setAttribute("aria-hidden", "true");
    row.append(icon, copy, price, chev);
    // Screen readers get the caveat the badge makes visual, and the destination.
    row.setAttribute("aria-label", `${plan.name}. Guide price from ${plan.from}, not a quote. Scan your property for an exact price.`);
    return row;
  }));
  indicativePlansRendered = true;
}

/**
 * The Home view's "Your care record" section, from the reviewed Home + Care
 * design. Every figure is a record the care-summary endpoint derives from this
 * account — completed bookings, scan results and booking timestamps. The
 * reviewed retention concept sets the rules rendered here: freezes are earned
 * by using the service and never sold, nothing resets on a schedule, and when
 * there is not enough history for a figure the section says so instead of
 * inventing a label.
 */
let careSummary = null;

const careWholePounds = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
const careMonth = new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: bookingZone });
const careNumberWords = Object.freeze(["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"]);

function careLagShort(hours) {
  if (!Number.isFinite(hours)) return "—";
  return hours < 48 ? `${Math.max(1, Math.round(hours))}h` : `${Math.round(hours / 24)}d`;
}

function careLagSentence(hours) {
  if (hours < 48) {
    const rounded = Math.max(1, Math.round(hours));
    return `${rounded} ${rounded === 1 ? "hour" : "hours"}`;
  }
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"}`;
}

function careRelativeTime(value) {
  const parsed = Date.parse(value || "");
  if (Number.isNaN(parsed)) return "";
  const minutes = Math.max(0, Math.round((Date.now() - parsed) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  return formatShortDate(value);
}

function careFigure(value, label) {
  const figure = element("span", "ld-care-figure");
  figure.append(element("strong", "", value), element("small", "", label));
  return figure;
}

function careFindRow(tone, tag, title, detail) {
  const row = element("div", "ld-care-find");
  const badge = element("span", `ld-care-find-tag ld-care-find-tag-${tone}`, tag);
  const copy = element("span", "ld-care-find-copy");
  copy.append(element("strong", "", title), element("small", "", detail));
  row.append(badge, copy);
  return row;
}

/* "Top 18%" green, "Middle 40%" amber — the standing vocabulary the design
   uses, mapped honestly onto the percentile the benchmark returns. */
function careStanding(topPercent) {
  if (topPercent <= 33) return { text: `Top ${topPercent}%`, tone: "good" };
  if (topPercent <= 66) return { text: `Middle ${topPercent}%`, tone: "warn" };
  return { text: `Behind ${topPercent}%`, tone: "quiet" };
}

function careMeter(wideLabel, narrowLabel, topPercent, tone) {
  const meter = element("div", `ld-care-meter ld-care-meter-${tone}`);
  const head = element("div", "ld-care-meter-head");
  const label = element("span", "ld-care-meter-label");
  label.append(element("span", "ld-care-meter-label-wide", wideLabel), element("span", "ld-care-meter-label-narrow", narrowLabel));
  const standing = careStanding(topPercent);
  head.append(label, element("strong", `ld-care-meter-standing is-${standing.tone}`, standing.text));
  const track = element("div", "ld-care-meter-track");
  const fill = element("span", `ld-care-meter-fill ld-care-meter-fill-${tone}`);
  fill.style.width = `${Math.min(99, Math.max(1, 100 - topPercent))}%`;
  track.append(fill);
  meter.append(head, track);
  return meter;
}

function renderCareRecord() {
  const title = document.querySelector("[data-ld-care-title]");
  if (!title) return;
  const lead = document.querySelector("[data-ld-care-lead]");
  const figures = document.querySelector("[data-ld-care-figures]");
  const totals = careSummary?.totals || null;
  const medianLag = Number.isFinite(careSummary?.medianLagHours) ? careSummary.medianLagHours : null;

  // The identity card. "The Fast Turnaround" is the one archetype the
  // retention concept defines, earned at the same 24-hour boundary the streak
  // announces. Anything else states the record without inventing a label.
  if (medianLag != null && medianLag <= 24) {
    title.textContent = "The Fast Turnaround";
    lead.textContent = `You book a clean a median ${careLagSentence(medianLag)} after a tenancy ends — your places spend more days ready and fewer days empty.`;
  } else if (medianLag != null) {
    title.textContent = "Your turnaround record";
    lead.textContent = `You book a clean a median ${careLagSentence(medianLag)} after a tenancy ends. Bring that inside 24 hours and your places spend more days ready.`;
  } else {
    title.textContent = "Your care record";
    lead.textContent = "Your first booked cleans start this record — real figures only, never an estimate.";
  }

  if (figures) {
    figures.replaceChildren(
      careFigure(String(totals?.completedCleanCount ?? 0), "Cleans completed"),
      careFigure(String(totals?.roomsScannedCount ?? 0), "Rooms scanned"),
      careFigure(careWholePounds.format((totals?.bookedValuePence ?? 0) / 100), "Booked to date"),
      careFigure(careLagShort(medianLag), "Median lag")
    );
  }

  const streak = careSummary?.streak || null;
  const streakCount = document.querySelector("[data-ld-care-streak-count]");
  if (streakCount) {
    const turnarounds = streak?.turnaroundCount ?? 0;
    streakCount.textContent = `${turnarounds} ${turnarounds === 1 ? "turnaround" : "turnarounds"}`;
  }
  const cellsHost = document.querySelector("[data-ld-care-cells]");
  if (cellsHost) {
    const cells = streak?.cells?.length ? streak.cells : Array.from({ length: 8 }, () => "empty");
    cellsHost.replaceChildren(...cells.map((kind, index) => {
      const cell = element("span", `ld-care-cell is-${kind}`);
      cell.style.animationDelay = `${(0.12 + index * 0.05).toFixed(2)}s`;
      return cell;
    }));
  }
  const freezesEarned = streak?.freezesEarned ?? 0;
  const freezeCount = document.querySelector("[data-ld-care-freeze-count]");
  if (freezeCount) freezeCount.textContent = freezesEarned > 0 ? `${freezesEarned} ${freezesEarned === 1 ? "freeze" : "freezes"} earned` : "No freeze earned yet";
  const freezePill = document.querySelector("[data-ld-care-freeze-pill]");
  if (freezePill) {
    freezePill.hidden = freezesEarned < 1;
    freezePill.textContent = freezesEarned > 0 ? `${freezesEarned} ${freezesEarned === 1 ? "freeze" : "freezes"}` : "";
  }

  // Discovery — the honest variable reward. The rows are what the latest scan
  // actually returned; when it finds nothing new, it says nothing new.
  const scanSub = document.querySelector("[data-ld-care-scan-sub]");
  const finds = document.querySelector("[data-ld-care-finds]");
  const lastScan = careSummary?.lastScan || null;
  if (scanSub && finds) {
    if (lastScan) {
      scanSub.textContent = `${lastScan.propertyName} · ${lastScan.roomCount} ${lastScan.roomCount === 1 ? "room" : "rooms"} · ${careRelativeTime(lastScan.capturedAt)}`;
      const rows = [];
      for (const object of lastScan.newObjects) {
        const previousMonth = lastScan.previousCapturedAt ? careMonth.format(new Date(lastScan.previousCapturedAt)) : "";
        rows.push(careFindRow("new", "NEW", object.label, previousMonth ? `${object.roomName} · not present in your ${previousMonth} scan` : object.roomName));
      }
      if (lastScan.taskCount > 0) {
        const word = careNumberWords[lastScan.taskCount] || String(lastScan.taskCount);
        rows.push(careFindRow("add", `+${lastScan.taskCount}`, `${word} ${lastScan.taskCount === 1 ? "task" : "tasks"} added to the brief`, lastScan.taskRoomNames.join(", ") || "From your reviewed walkthrough"));
      }
      if (lastScan.unchangedRoomCount > 0) {
        rows.push(careFindRow("ok", "OK", `${lastScan.unchangedRoomCount} ${lastScan.unchangedRoomCount === 1 ? "room" : "rooms"} unchanged`, "Nothing needed — no task created"));
      }
      if (rows.length === 0) rows.push(careFindRow("ok", "OK", "Nothing new found", "Rooms really do change — this scan found no new work"));
      finds.replaceChildren(...rows.map((row, index) => {
        row.style.animationDelay = `${(0.2 + index * 0.1).toFixed(2)}s`;
        return row;
      }));
    } else {
      scanSub.textContent = "No scans yet — your first walkthrough starts this record.";
      finds.replaceChildren();
    }
  }

  // The anonymised local benchmark: a percentile you can only move by doing
  // the work — never a named leaderboard.
  const benchSub = document.querySelector("[data-ld-care-bench-sub]");
  const meters = document.querySelector("[data-ld-care-meters]");
  const calloutCopy = document.querySelector("[data-ld-care-callout-copy]");
  const bench = careSummary?.benchmark || null;
  if (benchSub && meters) {
    if (bench && bench.lagTopPercent != null) {
      benchSub.textContent = `Anonymised · near you · ${bench.cohortSize} portfolios`;
      const built = [careMeter("Booking lag after tenancy ends", "Booking lag near you", bench.lagTopPercent, "lag")];
      if (bench.coverageTopPercent != null) built.push(careMeter("Rooms scanned before booking", "Rooms scanned", bench.coverageTopPercent, "coverage"));
      meters.replaceChildren(...built);
    } else {
      benchSub.textContent = "Anonymised — the benchmark unlocks as more portfolios join.";
      meters.replaceChildren();
    }
  }
  if (calloutCopy) {
    const scanned = bench?.latestScannedRooms;
    const planned = bench?.latestPlannedRooms;
    const gap = Number.isFinite(planned) && Number.isFinite(scanned) ? planned - scanned : 0;
    if (gap > 0 && bench?.closingGapReachesTopQuarter === true) {
      calloutCopy.textContent = `Scanning the last ${gap} ${gap === 1 ? "room" : "rooms"} moves you into the top quarter.`;
    } else if (gap > 0) {
      calloutCopy.textContent = `Scanning the last ${gap} ${gap === 1 ? "room" : "rooms"} gives the Cleaner a complete brief.`;
    } else {
      calloutCopy.textContent = "Scanning every room before you book gives the Cleaner a complete brief.";
    }
  }
}

async function loadCareSummary() {
  try {
    const result = await requestJson("/api/marketplace/landlord/care-summary");
    careSummary = result?.careSummary && typeof result.careSummary === "object" ? result.careSummary : null;
  } catch {
    // The section keeps its honest starting copy; the partial-load banner
    // already tells the Landlord when a refresh did not complete.
    careSummary = null;
  }
  renderCareRecord();
}

/* The flex-card rule from the reviewed concept: no addresses, tenant names or
   prices — a landlord's share has to be safe to post. */
function careShareText() {
  const totals = careSummary?.totals || null;
  const medianLag = Number.isFinite(careSummary?.medianLagHours) ? careSummary.medianLagHours : null;
  const label = document.querySelector("[data-ld-care-title]")?.textContent || "Your care record";
  const parts = [
    `${totals?.completedCleanCount ?? 0} cleans completed`,
    `${totals?.roomsScannedCount ?? 0} rooms scanned`
  ];
  if (medianLag != null) parts.push(`${careLagShort(medianLag)} median booking lag`);
  return `My Homle care profile — ${label}. ${parts.join(" · ")}.`;
}

let careShareStatusTimer = 0;

function showCareShareStatus(message) {
  const status = document.querySelector("[data-ld-care-share-status]");
  if (!status) return;
  status.textContent = message;
  status.hidden = false;
  window.clearTimeout(careShareStatusTimer);
  careShareStatusTimer = window.setTimeout(() => { status.hidden = true; }, 4_000);
}

document.querySelector("[data-ld-care-share]")?.addEventListener("click", async () => {
  const text = careShareText();
  try {
    if (typeof navigator.share === "function") {
      await navigator.share({ title: "Homle care profile", text });
      showCareShareStatus("Shared.");
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      showCareShareStatus("Copied to your clipboard.");
    } else {
      showCareShareStatus("Sharing is not available in this browser.");
    }
  } catch (error) {
    if (error?.name !== "AbortError") showCareShareStatus("Could not share the card.");
  }
});

function renderHomeView() {
  renderIndicativePlans();
  renderCareRecord();
}

const clockTime = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: bookingZone });

function formatClock(value) {
  const parsed = Date.parse(value || "");
  return Number.isNaN(parsed) ? "" : clockTime.format(new Date(parsed));
}

/** "2.5 hrs" from the booked window, or "" when the window is incomplete. */
function bookedDuration(booking) {
  const start = Date.parse(booking?.scheduledStartAt || "");
  const end = Date.parse(booking?.scheduledEndAt || "");
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return "";
  const hours = (end - start) / 3_600_000;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hrs`;
}

/* "Assigned Cleaner" is the server's placeholder for "not matched yet". */
function namedCleaner(booking) {
  const name = String(booking?.counterpartyName || "").trim();
  return name && name !== "Assigned Cleaner" ? name : "";
}

function initialsFor(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() || "").join("") || "?";
}

/**
 * One accepted booking owns the prominent "Happening now" card. Returning the
 * same record here and in Upcoming would make one place appear twice, so both
 * renderers share this exact selection rule. Cleaner-decision records stay in
 * Upcoming because their response deadline and actions live on that card.
 */
function featuredBooking(buckets) {
  return [...buckets.active, ...buckets.upcoming]
    .slice()
    .sort((a, b) => String(a.scheduledStartAt || "").localeCompare(String(b.scheduledStartAt || "")))[0] || null;
}

/**
 * The five stages the Happening now card draws, and where each booking status
 * sits on them.
 *
 * These are the same five the request rail names while matching is still open,
 * so one clean reads as one continuous line from the request to the finished
 * job rather than restarting under a different vocabulary once a Cleaner
 * accepts.
 *
 * The index is the stage in progress: everything before it is done, everything
 * after is still to come. `confirmed` therefore points at "On the way" — the
 * booking is agreed and the next thing that happens is the Cleaner travelling.
 * Terminal records that never reach the card (cancelled, disputed) are absent
 * on purpose; the `?? 0` at the call site keeps any unknown status on "Booked"
 * instead of throwing.
 */
const upcomingStepDefinitions = Object.freeze([
  Object.freeze({ id: "booked", label: "Booked" }),
  Object.freeze({ id: "matching", label: "Matching" }),
  Object.freeze({ id: "on-the-way", label: "On the way" }),
  Object.freeze({ id: "cleaning", label: "Cleaning" }),
  Object.freeze({ id: "complete", label: "Complete" })
]);

const upcomingStepByStatus = Object.freeze({
  "pending-cleaner-acceptance": 1,
  confirmed: 2,
  "cleaner-en-route": 2,
  "cleaner-arrived": 3,
  "cleaning-in-progress": 3,
  "awaiting-review": 4,
  completed: 4
});

function syncHappeningNowLabel() {
  const label = document.querySelector("[data-hub-now-label]");
  if (!label) return;
  const hasSubmittedRequest = requests.some((request) => !["draft", "cancelled"].includes(request.status));
  const hasFeaturedBooking = Boolean(featuredBooking(bookingSummaryBuckets(bookings, "landlord")));
  label.hidden = !hasSubmittedRequest && !hasFeaturedBooking;
}

/**
 * The "NEXT CLEAN" card.
 *
 * Every value is read from the booking record. The design also shows the
 * Cleaner's lifetime clean count and star rating, and a per-room task
 * breakdown; the booking payload carries none of those — it has a name, a task
 * TOTAL and a window — so they are omitted rather than invented. The stage
 * times are shown only where a real timestamp exists.
 */
// A Landlord's booking summary names its property but carries no id for it:
// list_my_booking_summaries builds propertyName, not propertyId. Matching on
// booking.propertyId therefore found nothing on every booking there has ever
// been, which silently hid the one control below that reaches a blocked place.
// The request behind the booking does carry the id, and liveBookingForRequest
// already owns that join.
function propertyForBooking(booking) {
  if (!booking) return null;
  const linked = requests.find((item) => liveBookingForRequest(item, [booking])?.bookingId === booking.bookingId);
  if (!linked) return null;
  return properties.find((item) => item.propertyId === linked.propertyId) || null;
}

function renderNextClean() {
  const card = document.querySelector("[data-ld-next]");
  const label = document.querySelector("[data-hub-now-label]");
  if (!card) return;

  const buckets = bookingSummaryBuckets(bookings, "landlord");
  const booking = featuredBooking(buckets);

  // The design has no "nothing booked" block here. With nothing happening the
  // section simply is not drawn, and Your places carries the way to start —
  // which also stops an empty state appearing above a card that does exist.
  card.hidden = !booking;
  if (label) syncHappeningNowLabel();
  if (!booking) return;

  const icon = card.querySelector("[data-ld-next-icon]");
  if (icon && !icon.firstChild) icon.append(cloneIcon("home"));

  const pill = card.querySelector("[data-ld-next-pill]");
  if (pill) pill.textContent = bookingSummaryStatusLabels[booking.status] || "Booking";

  const address = card.querySelector("[data-ld-next-address]");
  if (address) address.textContent = booking.propertyName || "Saved property";

  const meta = card.querySelector("[data-ld-next-meta]");
  if (meta) {
    meta.textContent = [
      formatBookingWindow(booking.scheduledStartAt, booking.scheduledEndAt),
      bookedDuration(booking),
      `${booking.taskCount} ${booking.taskCount === 1 ? "task" : "tasks"}`
    ].filter(Boolean).join(" · ");
  }

  // A place with a clean booked no longer appears under Your places, so this is
  // the only route left to its access details, saved rooms and archiving. It is
  // hidden when the booking cannot be matched back to an owned property, rather
  // than opening an editor for nothing.
  const placeDetails = card.querySelector("[data-ld-next-place]");
  if (placeDetails) {
    const property = propertyForBooking(booking);
    placeDetails.hidden = !property;
    if (property) {
      placeDetails.setAttribute("aria-label", `Place details for ${property.name || "saved property"}`);
      placeDetails.onclick = () => openPropertyEditor(property);
    }
  }

  const cleanerRow = card.querySelector("[data-ld-next-cleaner]");
  const cleaner = namedCleaner(booking);
  if (cleanerRow) {
    cleanerRow.hidden = !cleaner;
    if (cleaner) {
      card.querySelector("[data-ld-next-initials]").textContent = initialsFor(cleaner);
      card.querySelector("[data-ld-next-cleaner-name]").textContent = cleaner;
      card.querySelector("[data-ld-next-cleaner-note]").textContent = "Cleaner for this booking";
    }
  }

  // Only timestamps the record actually carries. A stage with nothing known
  // shows no time rather than a guess.
  const stageIndex = upcomingStepByStatus[booking.status] ?? 0;
  const stageTimes = [
    "",
    formatShortDate(booking.respondedAt || booking.confirmedAt) === "—" ? "" : formatShortDate(booking.respondedAt || booking.confirmedAt),
    "",
    formatClock(booking.scheduledStartAt),
    formatClock(booking.scheduledEndAt)
  ];
  const stages = card.querySelector("[data-ld-next-stages]");
  if (stages) {
    stages.replaceChildren(...upcomingStepDefinitions.map((step, index) => {
      const node = element("li", "ld-stage");
      if (index < stageIndex) node.classList.add("is-done");
      if (index === stageIndex) node.classList.add("is-now");
      const dot = element("span", "ld-stage-dot");
      dot.setAttribute("aria-hidden", "true");
      if (index < stageIndex) dot.append(cloneIcon("tick"));
      node.append(dot, element("span", "ld-stage-label", step.label), element("span", "ld-stage-time", stageTimes[index] || ""));
      if (index === stageIndex) node.setAttribute("aria-current", "step");
      return node;
    }));
  }

  const planCount = card.querySelector("[data-ld-next-plan-count]");
  if (planCount) planCount.textContent = `${booking.taskCount} ${booking.taskCount === 1 ? "task" : "tasks"}`;

  // The design breaks this down room by room. The booking record has a task
  // total only, so the panel shows the truthful whole-plan state instead of a
  // fabricated per-room split.
  const planBody = card.querySelector("[data-ld-next-plan-body]");
  if (planBody) {
    const complete = stageIndex >= 4;
    const running = stageIndex === 3;
    const row = element("div", "ld-plan-row");
    const dot = element("span", `ld-plan-dot${complete ? " is-done" : running ? " is-now" : ""}`);
    dot.setAttribute("aria-hidden", "true");
    const label = element("span", "ld-plan-name", booking.cleaningType || "Cleaning");
    const track = element("span", "ld-plan-track");
    const fill = element("span", `ld-plan-fill${complete ? " is-done" : ""}`);
    fill.style.width = complete ? "100%" : running ? "50%" : "0%";
    track.append(fill);
    row.append(dot, label, track);
    const note = element("p", "ld-plan-note", complete
      ? "Every task on this plan is done."
      : running
        ? "The clean is in progress. Room-by-room progress appears in the booking record."
        : "The reviewed checklist is attached to this booking.");
    planBody.replaceChildren(row, note);
  }

  const view = card.querySelector("[data-ld-next-view]");
  if (view) {
    // The real booking record, when the server says one is available. Without
    // one there is nowhere further to go: this card is already the booking, on
    // the Bookings view. The control used to point at /landlord/bookings from
    // /landlord/bookings — a button that visibly did nothing — so it is shown
    // only when it actually leads somewhere.
    const record = booking.activeJobAvailable ? `/bookings/${encodeURIComponent(booking.bookingId)}` : "";
    view.href = record || "#";
    view.hidden = !record;
  }
  const change = card.querySelector("[data-ld-next-change]");
  if (change) change.href = `/landlord/help?bookingId=${encodeURIComponent(booking.bookingId)}`;
}

/**
 * The account totals beside the next clean.
 *
 * The design's second tile counts evidence photos. Nothing in the booking
 * payload exposes a photo count, so the completed booking value — which
 * landlordDashboardSummary already computes — takes that slot rather than a
 * number with nothing behind it.
 */
function renderBookStats(summary) {
  const host = document.querySelector("[data-ld-book-stats]");
  if (!host) return;
  const propertyCount = properties.length;
  const tiles = [
    { key: "CLEANS COMPLETED", value: String(summary.completedCleanCount), sub: propertyCount ? `across ${propertyCount} ${propertyCount === 1 ? "property" : "properties"}` : "" },
    { key: "COMPLETED VALUE", value: formatBookingMoney(summary.completedBookingValuePence), sub: summary.previousCleanerVisitCount ? `${summary.previousCleanerVisitCount} Cleaner ${summary.previousCleanerVisitCount === 1 ? "visit" : "visits"}` : "" }
  ];
  host.replaceChildren(...tiles.map((tile) => {
    const node = element("div", "ld-book-stat");
    node.append(element("div", "ld-book-stat-key", tile.key));
    const value = element("div", "ld-book-stat-value");
    value.append(element("strong", "", tile.value), element("span", "", tile.sub));
    node.append(value);
    return node;
  }));
}

/**
 * Completed work, as the design's evidence grid.
 *
 * The BEFORE/AFTER strip and photo counts in the design are not reproduced:
 * the booking payload exposes no media, and a card captioned "6 photos" over a
 * placeholder texture would be claiming evidence this page cannot show. The
 * card keeps its shape and its two real actions.
 */
function renderPastCleans(buckets) {
  const grid = document.querySelector("[data-ld-past-grid]");
  const empty = document.querySelector("[data-ld-past-empty]");
  const note = document.querySelector("[data-ld-past-note]");
  if (!grid || !empty) return;

  const past = buckets.history
    .filter((booking) => ["completed", "awaiting-review", "disputed"].includes(booking.status))
    .slice()
    .sort((a, b) => String(b.scheduledStartAt || "").localeCompare(String(a.scheduledStartAt || "")));

  empty.hidden = past.length > 0;
  grid.hidden = past.length === 0;
  if (note) note.textContent = past.length ? "The record of what was done on each visit" : "";

  const groups = new Map();
  past.forEach((booking) => {
    const propertyName = booking.propertyName || "Saved property";
    if (!groups.has(propertyName)) groups.set(propertyName, []);
    groups.get(propertyName).push(booking);
  });

  const rows = [];
  groups.forEach((propertyBookings, propertyName) => {
    const heading = element("div", "ld-past-group-head");
    const headingCopy = element("div", "ld-past-group-copy");
    const completedValuePence = propertyBookings.reduce((total, booking) => total + (Number.isInteger(booking.pricePence) ? booking.pricePence : 0), 0);
    const valueLabel = completedValuePence > 0 ? ` · ${formatBookingMoney(completedValuePence)}` : "";
    headingCopy.append(
      element("strong", "ld-past-group-name", propertyName),
      element("span", "ld-past-group-summary", `${propertyBookings.length} ${propertyBookings.length === 1 ? "clean" : "cleans"}${valueLabel}`),
    );
    const again = element("button", "ld-btn ld-btn-quiet", "Book again");
    again.type = "button";
    again.addEventListener("click", () => {
      const match = properties.find((property) => property.name === propertyName);
      if (match) {
        bookCleanPropertyId = match.propertyId;
        saveSelectedProperty(sessionStorage, match.propertyId);
        selectedPropertyId = match.propertyId;
      }
      openBookCleanChooser();
    });
    heading.append(headingCopy, again);
    rows.push(heading);

    propertyBookings.forEach((booking) => {
      const row = element("article", "ld-past-row");
      const cleaner = namedCleaner(booking);
      const cleaningType = String(booking.cleaningType || "Cleaning").replace(/-/g, " ");
      row.append(
        element("time", "ld-past-date", formatShortDate(booking.scheduledStartAt)),
        element("div", "ld-past-description", [cleaningType, `${booking.taskCount} ${booking.taskCount === 1 ? "task" : "tasks"}`, cleaner].filter(Boolean).join(" · ")),
        element("span", "ld-past-state", `${booking.status === "disputed" ? "Issue open" : "✓ Completed"}`),
      );
      const report = element("a", "ld-past-report", "View report");
      report.href = `/bookings/${encodeURIComponent(booking.bookingId)}`;
      row.append(report);
      rows.push(row);
    });
  });
  grid.replaceChildren(...rows);
}

function renderBookings() {
  const buckets = bookingSummaryBuckets(bookings, "landlord");
  const historySummary = landlordDashboardSummary(bookings);
  const featured = featuredBooking(buckets);
  const current = [...buckets.active, ...buckets.upcoming]
    .filter((booking) => booking.bookingId !== featured?.bookingId);
  const list = document.querySelector("[data-landlord-booking-list]");
  list.replaceChildren(...current.map(renderBookingCard));
  list.hidden = current.length === 0;
  const visibleRequestCount = requests.filter((request) => request.status !== "cancelled").length;
  document.querySelector("[data-landlord-booking-empty]").hidden = current.length > 0 || buckets.waiting.length > 0 || visibleRequestCount > 0;
  const waitingSection = document.querySelector("[data-landlord-waiting-section]");
  const waitingList = document.querySelector("[data-landlord-waiting-list]");
  waitingList.replaceChildren(...buckets.waiting.map(renderBookingCard));
  waitingSection.hidden = buckets.waiting.length === 0;
  document.querySelector("[data-landlord-waiting-count]").textContent = String(buckets.waiting.length);
  updateLandlordWaitingDeadlines();
  const historyList = document.querySelector("[data-landlord-history-list]");
  historyList.replaceChildren(...buckets.history.map(renderBookingCard));
  document.querySelector("[data-landlord-history-count]").textContent = String(buckets.history.length);
  document.querySelector("[data-landlord-history-section]").hidden = buckets.history.length === 0;
  document.querySelector("[data-landlord-active-count]").textContent = String(current.length);
  updateUpcomingRevealCount();
  document.querySelector("[data-landlord-history-reveal-count]").textContent = String(historySummary.completedCleanCount);
  renderLandlordHistory(historySummary);
  renderLandlordPayments(bookings);
  // Home's care record is served by its own summary endpoint; refreshing it
  // here keeps the section in step with the bookings it is derived from.
  void loadCareSummary();
  renderNextClean();
  // Conversations are built from these bookings. At first paint there were none
  // — selectWorkspaceTab runs before loadWorkspace resolves — so a Landlord who
  // deep-linked to /landlord/messages saw an empty list until they navigated
  // away and back.
  if (currentWorkspaceTab === "messages") void openMessages();
  renderBookStats(historySummary);
  renderPastCleans(buckets);
  syncInvitationStream();
}

function toggleLandlordSection(button) {
  const contentId = button.getAttribute("aria-controls");
  const content = contentId ? document.getElementById(contentId) : null;
  if (!content) return;
  const expanded = button.getAttribute("aria-expanded") === "true";
  button.setAttribute("aria-expanded", String(!expanded));
  content.hidden = expanded;
}

function setLandlordSectionExpanded(button, expanded) {
  const contentId = button?.getAttribute("aria-controls");
  const content = contentId ? document.getElementById(contentId) : null;
  if (!button || !content) return;
  button.setAttribute("aria-expanded", String(expanded));
  content.hidden = !expanded;
}

function updateUpcomingRevealCount() {
  const draftRequestCount = requests.filter((request) => request.status === "draft").length;
  const buckets = bookingSummaryBuckets(bookings, "landlord");
  const featured = featuredBooking(buckets);
  const bookingCount = buckets.active.length + buckets.upcoming.length + buckets.waiting.length - (featured ? 1 : 0);
  // Upcoming counts confirmed work only. A request still being prepared has no
  // Cleaner, no frozen price and no booking behind it, so counting it here
  // announced a commitment that does not exist. Those requests are listed under
  // Your places instead, against the place they are for.
  document.querySelector("[data-landlord-booking-reveal-count]").textContent = String(bookingCount);
  const heading = document.querySelector("[data-landlord-upcoming-heading]");
  const content = document.getElementById("landlord-booking-content");
  if (heading) heading.hidden = bookingCount === 0;
  if (content) content.hidden = bookingCount === 0;
  // The drafts label only appears when there is something under it.
  const draftsLabel = document.querySelector("[data-drafts-label]");
  if (draftsLabel) draftsLabel.hidden = draftRequestCount === 0;
}

/**
 * Payment status for every priced booking.
 *
 * Deliberately status, not receipts. There is no receipt URL, invoice URL,
 * charge id or payment intent exposed to a Landlord anywhere in this system,
 * and bookingSummaryMoneyBoundary already states in several places that these
 * totals are not proof of a charge. Rendering them as a receipt-shaped document
 * would create something a Landlord could reasonably treat as proof of payment
 * in a dispute. Real receipts belong to the payment provider.
 *
 * So every row reuses the same wording the booking cards already use, rather
 * than inventing a more confident phrasing for the same underlying data.
 */
function renderLandlordPayments(allBookings) {
  const list = document.querySelector("[data-landlord-payments-list]");
  const empty = document.querySelector("[data-landlord-payments-empty]");
  if (!list || !empty) return;

  const priced = (Array.isArray(allBookings) ? allBookings : [])
    .filter((booking) => Number(booking?.pricePence) > 0)
    .sort((a, b) => String(b.scheduledStartAt || "").localeCompare(String(a.scheduledStartAt || "")));

  empty.hidden = priced.length > 0;
  list.replaceChildren(...priced.map((booking) => {
    const row = element("article", "landlord-payment-row");

    const head = element("div", "landlord-payment-head");
    head.append(
      element("strong", "", booking.propertyLabel || booking.propertyArea || "Saved property"),
      element("span", "landlord-payment-total", formatBookingMoney(booking.pricePence)),
    );

    const meta = element("p", "landlord-payment-meta", formatBookingWindow(booking.scheduledStartAt, booking.scheduledEndAt));

    // The authorisation stage in words. Never "paid": nothing here evidences a
    // completed charge, and saying so would be the whole problem.
    const stage = booking.paymentAuthorizationReady === true
      ? { label: "Authorised", kind: "ready" }
      : booking.paymentStepAvailable === true
        ? { label: "Awaiting your authorisation", kind: "action" }
        : { label: "No authorisation needed yet", kind: "idle" };
    const badge = element("span", `landlord-payment-stage landlord-payment-stage-${stage.kind}`, stage.label);

    const status = element("div", "landlord-payment-status");
    status.append(badge, element("span", "landlord-payment-booking-state", bookingSummaryStatusLabels[booking.status] || "Booking"));

    // The badge named an action the view then offered no way to take. Same
    // label and same destination as the booking card, so the two stay in
    // wording lockstep; element() sets textContent only, so no markup is parsed.
    if (stage.kind === "action") {
      const authorize = element("a", "button", "Authorize booking total");
      authorize.href = `/landlord/checkout?bookingId=${encodeURIComponent(booking.bookingId)}`;
      status.append(authorize);
    }

    row.append(head, meta, status, element("p", "landlord-payment-boundary", bookingSummaryMoneyBoundary(booking, "landlord")));
    return row;
  }));
}

function renderLandlordHistory(summary) {
  document.querySelector("[data-landlord-completed-count]").textContent = String(summary.completedCleanCount);
  document.querySelector("[data-landlord-awaiting-count]").textContent = String(summary.awaitingConfirmationCount);
  document.querySelector("[data-landlord-completed-value]").textContent = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(summary.completedBookingValuePence / 100);
  document.querySelector("[data-landlord-previous-count]").textContent = String(summary.previousCleanerVisitCount);
  const list = document.querySelector("[data-landlord-previous-cleaners]");
  list.replaceChildren(...summary.previousCleanerVisits.map((cleaner) => {
    const card = element("article", "landlord-previous-cleaner");
    const identity = element("div");
    const copy = element("div");
    copy.append(element("strong", "", cleaner.displayName), element("small", "", formatBookingMoment(cleaner.scheduledStartAt)));
    identity.append(element("span", "landlord-previous-avatar", cleaner.displayName.slice(0, 1).toLocaleUpperCase("en-GB")), copy);
    const actions = element("div", "landlord-previous-actions");
    const link = element("a", "text-button", "View latest clean");
    link.href = `/bookings/${cleaner.bookingId}`;
    actions.append(link);
    if (cleaner.cleanerId && cleaner.propertyId) {
      const repeat = element("button", "button", "Book again");
      repeat.type = "button";
      repeat.addEventListener("click", () => {
        try {
          saveSelectedCleaner(localStorage, cleaner.cleanerId);
          saveSelectedProperty(sessionStorage, cleaner.propertyId);
        } catch {}
        location.assign("/landlord/dashboard?start=booking");
      });
      actions.append(repeat);
    }
    card.append(identity, actions);
    return card;
  }));
  list.hidden = summary.previousCleanerVisits.length === 0;
  document.querySelector("[data-landlord-previous-empty]").hidden = summary.previousCleanerVisits.length > 0;
}

function renderFavouriteCleaners() {
  const list = document.querySelector("[data-landlord-favourite-cleaners]");
  list.replaceChildren(...favouriteCleaners.map((cleaner) => {
    const card = element("article", "landlord-favourite-cleaner");
    const identity = element("div", "landlord-favourite-identity");
    const displayName = String(cleaner.displayName || "Cleaner profile");
    const copy = element("div");
    const evidence = Number(cleaner.reviewCount) > 0
      ? `${Number(cleaner.averageRating).toFixed(1)} stars from ${Number(cleaner.reviewCount)} completed-job reviews`
      : "No completed-job reviews yet";
    copy.append(element("strong", "", displayName), element("small", "", evidence));
    identity.append(element("span", "landlord-previous-avatar", displayName.slice(0, 1).toLocaleUpperCase("en-GB")), copy);
    const actions = element("div", "landlord-favourite-actions");
    const request = element("button", "button", "Start request");
    request.type = "button";
    request.addEventListener("click", () => {
      try { saveSelectedCleaner(localStorage, cleaner.cleanerId); } catch {}
      location.assign("/landlord/dashboard?start=booking");
    });
    const view = element("button", "text-button", "View profile");
    view.type = "button";
    view.addEventListener("click", () => openCleanerProfile(cleaner.cleanerId, displayName));
    const remove = element("button", "text-button", "Remove");
    remove.type = "button";
    remove.addEventListener("click", () => removeFavouriteCleaner(cleaner.cleanerId, remove));
    actions.append(request, view, remove);
    card.append(identity, actions);
    return card;
  }));
  document.querySelector("[data-landlord-favourite-empty]").hidden = favouriteCleaners.length > 0;
}

async function refreshFavouriteCleaners({ quiet = false } = {}) {
  const feedback = document.querySelector("[data-landlord-favourite-feedback]");
  try {
    const result = await requestJson("/api/marketplace/landlord/favourite-cleaners", { timeoutMs: optionalDashboardRequestTimeoutMs });
    favouriteCleaners = Array.isArray(result.cleaners) ? result.cleaners : [];
    renderFavouriteCleaners();
    if (quiet) return true;
    feedback.hidden = true;
    feedback.textContent = "";
    return true;
  } catch {
    if (!quiet) {
      feedback.textContent = "Saved Cleaners are temporarily unavailable. Your other Landlord records are unaffected.";
      feedback.hidden = false;
    }
    return false;
  }
}

async function removeFavouriteCleaner(cleanerId, button) {
  if (button.disabled) return;
  const feedback = document.querySelector("[data-landlord-favourite-feedback]");
  const csrf = await recoverCsrf(feedback, "changing your saved Cleaners");
  if (!csrf) return;
  button.disabled = true;
  feedback.textContent = "Removing saved Cleaner...";
  feedback.hidden = false;
  try {
    const result = await requestJson(`/api/marketplace/landlord/favourite-cleaners/${encodeURIComponent(cleanerId)}`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ favourite: false }) });
    if (result.favourite?.favourite !== false) throw new Error("Homle did not confirm the saved Cleaner change.");
    favouriteCleaners = favouriteCleaners.filter((cleaner) => cleaner.cleanerId !== cleanerId);
    renderFavouriteCleaners();
    feedback.textContent = "Cleaner removed from your private saved list.";
  } catch (error) {
    const reconciled = await refreshFavouriteCleaners({ quiet: true });
    feedback.textContent = reconciled && !favouriteCleaners.some((cleaner) => cleaner.cleanerId === cleanerId)
      ? "Cleaner removed from your private saved list."
      : (error?.message || "Homle could not confirm the change. No removal will be retried automatically.");
  } finally {
    button.disabled = false;
  }
}

function applyMarketplaceReadiness(health, { repaint = false } = {}) {
  const capabilities = landlordMarketplaceCapabilityState({
    mediaReady: health?.marketplace?.mediaReady === true,
    pricingReady: health?.marketplace?.matchingReady === true,
    geocodingReady: health?.marketplace?.geocodingReady === true,
    automaticDispatchReady: health?.marketplace?.automaticDispatchReady === true
  });
  ({ mediaReady, pricingReady, geocodingReady, matchingReady, automaticDispatchReady } = capabilities);
  paymentsReady = health?.marketplace?.paymentsReady === true;
  scheduleManualQuote();
  mediaReadiness.hidden = capabilities.notice === null;
  if (capabilities.notice) {
    capabilityTitle.textContent = capabilities.notice.title;
    capabilityCopy.textContent = capabilities.notice.copy;
  }
  if (repaint) renderRequests();
  return capabilities;
}

/* Render opens the HTTP listener before the non-fatal background workers now,
   so a customer can use Homle while dispatch is still warming. A health read
   in those first seconds must not leave a truthful-but-stale "paused" banner
   on screen for the rest of the visit. Retry twice, in the background, then
   stop: a genuinely disabled dispatcher stays fail-closed and the dashboard
   never polls forever. */
function scheduleReadinessRecovery(attempt = 0) {
  window.clearTimeout(readinessRecoveryTimer);
  if (automaticDispatchReady || attempt >= readinessRecoveryDelaysMs.length || browserOffline()) return;
  readinessRecoveryTimer = window.setTimeout(async () => {
    try {
      const health = await requestJson("/api/health", {
        credentials: "omit",
        timeoutMs: readinessRequestTimeoutMs
      });
      applyMarketplaceReadiness(health, { repaint: true });
    } catch {}
    if (!automaticDispatchReady) scheduleReadinessRecovery(attempt + 1);
  }, readinessRecoveryDelaysMs[attempt]);
}

async function loadWorkspace() {
  if (loading) return;
  window.clearTimeout(readinessRecoveryTimer);
  loading = true;
  showState("Checking secure Landlord access…", "Your properties and drafts open only inside an authenticated Landlord session.");
  try {
    // One authenticated bootstrap replaces seven competing private requests.
    // Health is public and independent, so it can still overlap the secured
    // read without multiplying authorization failures for an expired session.
    const [bootstrapResult, healthResult] = await Promise.allSettled([
      requestJson("/api/marketplace/landlord/bootstrap"),
      requestJson("/api/health", { credentials: "omit", timeoutMs: readinessRequestTimeoutMs })
    ]);
    if (bootstrapResult.status === "rejected") throw bootstrapResult.reason;
    const bootstrap = bootstrapResult.value;
    const account = bootstrap.account;
    const access = dashboardWorkspaceAccess(account, "landlord");
    if (!access.ready) return access.reason === "different-workspace"
      ? showState(`Your ${access.label} workspace is active.`, "Properties, room scans and cleaning requests remain in a separate private Landlord dashboard.", { kind: "authentication", workspaceDestination: access.destination, workspaceLabel: access.label })
      : showState("This account has no Landlord workspace.", "Sign in through Book a clean to create the separate property workspace.", { kind: "authentication", allowSignIn: true });
    setLandlordDisplayName(account.displayName || "Landlord");
    renderAccountAvatar(account);
    state.hidden = true;
    for (const item of privateNavigation) item.hidden = false;
    notificationLink.hidden = false;
    // The unread badge owns a private read and EventSource. Do not let either
    // start until this server-authorised bootstrap has proved the browser has
    // an active Landlord session; otherwise an expired session generates an
    // avoidable 401 and can begin reconnect work before the sign-in gate shows.
    window.dispatchEvent(new Event("homle:landlord-session-ready"));
    workspace.hidden = false;
    workspace.setAttribute("aria-busy", "true");
    loadStatus.hidden = true;

    const unavailable = new Set(Array.isArray(bootstrap.unavailable) ? bootstrap.unavailable : []);
    if (!unavailable.has("properties")) properties = Array.isArray(bootstrap.properties) ? bootstrap.properties : [];
    if (!unavailable.has("archivedProperties")) archivedProperties = Array.isArray(bootstrap.archivedProperties) ? bootstrap.archivedProperties : [];
    if (!unavailable.has("cleaningRequests")) requests = Array.isArray(bootstrap.cleaningRequests) ? bootstrap.cleaningRequests : [];
    if (!unavailable.has("bookings")) bookings = Array.isArray(bootstrap.bookings) ? bootstrap.bookings : [];
    bookingsUnavailable = unavailable.has("bookings");
    renderBookingSourceState();
    if (!unavailable.has("supportRequests")) supportRequests = Array.isArray(bootstrap.supportRequests) ? [...bootstrap.supportRequests] : [];
    if (!unavailable.has("profile")) landlordProfile = bootstrap.profile || { organisationName: null, biography: "" };
    landlordProfileForm.elements.organisationName.value = landlordProfile.organisationName || "";
    landlordProfileForm.elements.biography.value = landlordProfile.biography || "";
    landlordProfileDirty = false;
    const capabilities = applyMarketplaceReadiness(healthResult.status === "fulfilled" ? healthResult.value : null);
    if (!capabilities.automaticDispatchReady) scheduleReadinessRecovery();
    renderProperties();
    renderArchivedProperties();
    restoreWorkingRequest();
    renderRequests();
    renderBookings();
    // Saved Cleaners are useful, but they are not required to open the
    // Landlord workspace. Keeping this optional request inside the awaited
    // startup chain left the whole dashboard aria-busy for up to 30 seconds
    // when that one endpoint was slow, even though properties, requests and
    // bookings had already rendered. Finish primary startup immediately and
    // let this isolated panel report its own bounded failure state.
    void refreshFavouriteCleaners();
    loadStatus.hidden = unavailable.size === 0 && healthResult.status === "fulfilled";
    if (location.hash === "#landlord-account-title") selectWorkspaceTab("account");
    continueBookingStart();
    void refreshSelectedCleanerProfile();
  } catch (error) {
    if (error.code === "browser-offline") showState("You are offline.", "Your unfinished room walkthrough stays in this tab. Reconnect and Homle will safely reopen the private workspace; no change will be retried automatically.", { kind: "offline", allowRetry: true });
    else if (error.statusCode === 401) showState("Sign in as a Landlord to open this workspace.", "Your properties and request drafts are private to your verified account.", { kind: "authentication", allowSignIn: true });
    else if (error.statusCode === 403) showState("This account cannot open the Landlord workspace.", "Use a Landlord/Property Manager account selected during onboarding.", { kind: "authentication", allowSignIn: true });
    else if (error.statusCode === 404) showState("Landlord accounts are not available on this release.", "This deployed release does not include the secure Landlord account runtime. No property or request was changed.", { kind: "unavailable", allowRetry: true });
    else if (error.statusCode === 503) showState("Homle is still waking up.", "Your account and data are safe. Wait a moment, then try again; no property or request was changed.", { kind: "unavailable", allowRetry: true });
    else showState("The Landlord workspace is temporarily unavailable.", "No property or request was changed. Check the connection and try again.", { kind: "error", allowRetry: true });
  } finally {
    workspace.removeAttribute("aria-busy");
    loading = false;
  }
}

loadRetry.addEventListener("click", loadWorkspace);
selectedCleanerClear.addEventListener("click", () => {
  clearSelectedCleanerChoice();
  renderRequests();
});

function optionalNumber(value) {
  return String(value || "").trim() === "" ? null : Number(value);
}

async function saveLandlordProfile(event) {
  event.preventDefault();
  landlordProfileFeedback.hidden = true;
  if (!landlordProfileForm.reportValidity()) return;
  const csrf = await recoverCsrf(landlordProfileFeedback, "saving your Landlord details");
  if (!csrf) return;
  const data = new FormData(landlordProfileForm);
  const body = {
    organisationName: String(data.get("organisationName") || ""),
    biography: String(data.get("biography") || "")
  };
  setPending(landlordProfileSave, true, "Saving…");
  try {
    const result = await requestJson("/api/marketplace/landlord/profile", { method: "PUT", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify(body) });
    landlordProfile = result.profile;
    landlordProfileForm.elements.organisationName.value = landlordProfile.organisationName || "";
    landlordProfileForm.elements.biography.value = landlordProfile.biography || "";
    landlordProfileDirty = false;
    showFeedback(landlordProfileFeedback, "Landlord account details saved privately.", "success");
  } catch (error) {
    showFeedback(landlordProfileFeedback, error.statusCode === 401 || error.statusCode === 403 ? "Your secure session expired or cannot save this Landlord profile. Sign in again." : error.message);
  } finally {
    setPending(landlordProfileSave, false, "Save Landlord details");
  }
}

async function saveProperty(event) {
  event.preventDefault();
  propertyFeedback.hidden = true;
  if (!propertyForm.reportValidity()) return;
  const data = new FormData(propertyForm);
  const postcode = String(data.get("postcode") || "").trim();
  if (!isUkPostcode(postcode)) return showFeedback(propertyFeedback, "Enter a valid UK postcode.");
  let savedChecklist = [];
  try { if (String(data.get("savedChecklist") || "").trim()) savedChecklist = requestTasksFromLines(data.get("savedChecklist")); } catch (error) { return showFeedback(propertyFeedback, error.message); }
  const csrf = await recoverCsrf(propertyFeedback, "saving this property");
  if (!csrf) return;
  const body = {
    name: String(data.get("name") || ""), propertyType: String(data.get("propertyType") || ""), addressLine1: String(data.get("addressLine1") || ""), addressLine2: String(data.get("addressLine2") || ""), locality: String(data.get("locality") || ""), postcode,
    bedrooms: optionalNumber(data.get("bedrooms")), bathrooms: optionalNumber(data.get("bathrooms")), approximateSizeSqM: optionalNumber(data.get("approximateSizeSqM")),
    accessInstructions: String(data.get("accessInstructions") || ""), parkingInstructions: String(data.get("parkingInstructions") || ""), cleaningPreferences: String(data.get("cleaningPreferences") || ""), savedChecklist, specialNotes: String(data.get("specialNotes") || "")
  };
  const selectedPropertyId = editingPropertyId;
  const updating = Boolean(selectedPropertyId);
  setPending(propertySave, true, updating ? "Updating…" : "Saving…");
  try {
    const path = updating ? `/api/marketplace/properties/${encodeURIComponent(selectedPropertyId)}` : "/api/marketplace/properties";
    const result = await requestJson(path, { method: updating ? "PUT" : "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify(body) });
    if (updating) properties = properties.map((property) => property.propertyId === selectedPropertyId ? result.property : property);
    else properties.push(result.property);
    properties.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    renderProperties();
    propertyForm.reset();
    propertyForm.hidden = true;
    editingPropertyId = "";
    propertyDirty = false;
    propertyFormTitle.textContent = "Add the cleaning location";
    propertySave.textContent = "Save property privately";
    if (propertyDialog?.open) propertyDialog.close();
    showFeedback(propertyStatus, updating ? "Protected access and property details updated." : "Property saved privately.", "success");
    if (bookingStart && !updating) {
      selectWorkspaceTab("requests");
      propertySelect.value = result.property.propertyId;
      requestForm.scrollIntoView({ behavior: "smooth", block: "start" });
      requestForm.elements.requestedDate.focus({ preventScroll: true });
    }
  } catch (error) { showFeedback(propertyFeedback, error.statusCode === 401 || error.statusCode === 403 ? "Your secure session expired or cannot save this property. Sign in again." : error.message); }
  finally { setPending(propertySave, false, editingPropertyId ? "Update protected details" : "Save property privately"); }
}

function openNewRequestPhotoDialog() {
  requestFeedback.hidden = true;
  if (!requestForm.reportValidity()) return;
  if (currentRequestDraft?.status === "draft") {
    showRequestContinuation(currentRequestDraft);
    return;
  }
  closeRequestPhotoDialog();
  const dialog = element("dialog", "landlord-photo-dialog landlord-photo-room-dialog");
  activeRequestPhotoDialog = dialog;
  const close = element("button", "landlord-photo-dialog-close", "Close");
  close.type = "button";
  close.setAttribute("aria-label", "Close add images window");
  close.addEventListener("click", () => { if (!requestPhotoUploadInFlight) closeRequestPhotoDialog(); });
  const heading = element("div", "landlord-request-continuation-heading");
  heading.append(element("p", "eyebrow", "Add images (optional)"), element("h3", "", "Which room is this?"), element("p", "", "Choose a room to add a photo, or continue without one."));
  const room = element("select");
  room.required = true;
  room.setAttribute("aria-label", "Room for these images");
  room.append(element("option", "", "Choose a room"));
  room.firstElementChild.value = "";
  for (const name of ["Kitchen", "Bathroom", "Bedroom", "Living Room", "Hallway", "Other"]) {
    const option = element("option", "", name);
    option.value = name;
    room.append(option);
  }
  const cameraInput = element("input");
  cameraInput.type = "file";
  cameraInput.accept = "image/*";
  cameraInput.setAttribute("capture", "environment");
  cameraInput.hidden = true;
  const libraryInput = element("input");
  libraryInput.type = "file";
  libraryInput.accept = "image/jpeg,image/png,image/webp,image/heic,.heic";
  libraryInput.multiple = true;
  libraryInput.hidden = true;
  const actions = element("div", "landlord-photo-room-actions");
  const camera = element("button", "button", "Take photo");
  const library = element("button", "button button-outline", "Choose photos");
  const continueWithoutImages = element("button", "button button-outline landlord-photo-skip", "Continue without images");
  camera.type = library.type = "button";
  continueWithoutImages.type = "button";
  camera.disabled = library.disabled = true;
  room.addEventListener("change", () => { camera.disabled = library.disabled = !room.value; });
  camera.addEventListener("click", () => cameraInput.click());
  library.addEventListener("click", () => libraryInput.click());
  const feedback = element("p", "landlord-form-feedback");
  feedback.hidden = true;
  async function choose(event) {
    const selectedFiles = consumeRoomPhotoInputFiles(event.target);
    if (!selectedFiles.length) return;
    try {
      validatedRoomPhotoSelection(selectedFiles);
    } catch (error) {
      return showFeedback(feedback, error.message);
    }
    camera.disabled = library.disabled = true;
    showFeedback(feedback, "Saving your private draft and opening the secure photo upload…", "success");
    const saved = await createRequestDraft(null, { defaultRoomName: room.value, initialFiles: selectedFiles, initialRoomName: room.value, dialog, autoUpload: true, feedback });
    if (!saved) {
      camera.disabled = library.disabled = false;
    }
  }
  cameraInput.addEventListener("change", choose);
  libraryInput.addEventListener("change", choose);
  continueWithoutImages.addEventListener("click", () => createRequestDraft(null, {
    defaultRoomName: "Property",
    dialog,
    feedback,
    triggerButton: continueWithoutImages
  }));
  actions.append(camera, library, cameraInput, libraryInput);
  dialog.append(close, heading, room, actions, continueWithoutImages, feedback);
  enableRequestPhotoDialogDismissal(dialog);
  document.body.append(dialog);
  dialog.showModal();
  room.focus();
}

async function createRequestDraft(event, options = {}) {
  event?.preventDefault();
  const operationFeedback = options.feedback || requestFeedback;
  operationFeedback.hidden = true;
  if (!requestForm.reportValidity()) return false;
  // One draft per clean, however many controls point here.
  if (requestDraftPending) return false;
  // "Add images" is the one deliberate approval action in the simplified
  // final step. Keep the existing server payload and validation boundary, but
  // do not ask the Landlord to repeat approval in a separate checkbox.
  const scopeConfirmation = requestForm.elements.scopeReviewed;
  scopeConfirmation.disabled = false;
  scopeConfirmation.checked = true;
  const data = new FormData(requestForm);
  let tasks;
  let supplementalNote = "";
  // Named for what it holds rather than `window`: the previous name shadowed the
  // global for this whole function, so the `window.sessionStorage` used below to
  // clear the saved walkthrough resolved to this object instead. The clear is a
  // no-op on undefined storage, so a saved draft silently stayed in the tab and
  // was offered back on the next load as unfinished work.
  let requestedTimeWindow;
  let budgetPence;
  try {
    const optionalScope = optionalRequestScope(data.get("tasks"), {
      defaultRoomName: options.defaultRoomName,
      cleaningType: data.get("cleaningType")
    });
    tasks = optionalScope.tasks;
    supplementalNote = optionalScope.supplementalNote;
    requestedTimeWindow = requestedWindow(data.get("requestedDate"), data.get("requestedTime"), data.get("durationMinutes"));
    budgetPence = moneyToPence(data.get("budget"));
  } catch (error) {
    scopeConfirmation.checked = false;
    showFeedback(operationFeedback, error.message);
    return false;
  }
  const cleaningType = String(data.get("cleaningType") || "");
  const frequency = String(data.get("frequency") || "one-time");
  const requiredServices = [cleaningType];
  if (data.get("scopeReviewed") !== "on") {
    showFeedback(operationFeedback, "Review and confirm the concise checklist before saving this draft.");
    return false;
  }
  // The lock must precede the first await, not follow it. recoverCsrf makes a
  // real round trip on a reopened tab, and until it returned nothing stopped a
  // second tap — or a sibling control, since "Continue", "Add images" and the
  // photo dialog's own two buttons all reach this one function — from entering
  // again and creating a second draft for one clean. The upload, submit and
  // authorize flows already lock in this order; this was the one create path
  // that did not.
  const triggerButton = options.triggerButton || requestSave;
  const triggerLabel = triggerButton === requestContinue ? "Continue" : triggerButton.textContent;
  requestDraftPending = true;
  setRequestDraftControlsLocked(true);
  setPending(triggerButton, true, "Saving draft…");
  try {
    const csrf = await recoverCsrf(operationFeedback, "saving this cleaning-request draft");
    if (!csrf) return false;
    const body = {
      propertyId: String(data.get("propertyId") || ""),
      ...requestedTimeWindow,
      cleaningType,
      requiredServices,
      specialInstructions: [String(data.get("specialInstructions") || "").trim(), supplementalNote].filter(Boolean).join("\n\n"),
      budgetPence,
      frequency,
      tasks,
      // Scope only. The server applies its active price list and freezes the
      // quote; omitting this field was why manual requests displayed no price.
      pricingRequest: pricingRequestFromManualTasks(tasks, {
        cleaningType,
        frequency,
        requestedMinutes: Number(data.get("durationMinutes"))
      }),
      submit: false
    };
    const result = await requestJson("/api/marketplace/cleaning-requests", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify(body) });
    if (!result.cleaningRequest?.requestId) throw new Error("The saved cleaning-request draft could not be verified.");
    requests.unshift(result.cleaningRequest);
    currentRequestDraft = result.cleaningRequest;
    renderRequests();
    try { clearLandlordRequestDraft(window.sessionStorage); } catch {}
    requestRecoveryStatus.removeAttribute("data-kind");
    requestRecoveryStatus.textContent = "An unfinished walkthrough stays only in this browser tab for up to 30 minutes. Approval and photos are never restored.";
    requestDirty = false;
    showRequestContinuation(result.cleaningRequest, options);
    return true;
  } catch (error) {
    showFeedback(operationFeedback, error.statusCode === 401 || error.statusCode === 403 ? "Your secure session expired or cannot save this draft. Sign in again." : error.message);
    return false;
  }
  finally {
    requestDraftPending = false;
    setRequestDraftControlsLocked(false);
    setPending(triggerButton, false, triggerLabel);
  }
}

function setPending(button, pending, label) {
  button.disabled = pending;
  button.setAttribute("aria-busy", String(pending));
  button.textContent = label;
}

function initialiseRequestDefaults() {
  const today = new Date();
  const localDate = new Date(today.getTime() - today.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  requestForm.elements.requestedDate.min = localDate;
  requestForm.elements.durationMinutes.value = "120";
  requestForm.elements.frequency.value = "one-time";
  if (properties.length === 1) propertySelect.value = properties[0].propertyId;
  applySuggestedCleaningType();
}

function useSavedChecklist() {
  const property = properties.find((item) => item.propertyId === propertySelect.value);
  if (!property) return showFeedback(requestFeedback, "Choose a saved property first.");
  const value = tasksToLines(property.savedChecklist);
  if (!value) return showFeedback(requestFeedback, "This property has no reusable checklist. Add tasks from the current room walkthrough.");
  if (requestForm.elements.tasks.value.trim() && !window.confirm("Replace the current room tasks with this property's saved checklist?")) return;
  invalidateScopeReview("The checklist changed. Review every room task again before saving.");
  requestForm.elements.tasks.value = value;
  generatedChecklist = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  generatedChecklistSource = "saved";
  renderTaskPreview();
  requestDirty = true;
  scheduleWorkingRequestRecovery();
  showFeedback(requestFeedback, "Saved checklist copied. Review every task against the current room scan before saving.", "success");
}

function summariseSpeech({ automatic = false, live = false } = {}) {
  const tasks = checklistFromTranscript(requestForm.elements.transcript.value);
  if (!tasks.length) {
    // Mid-sentence speech often has no complete task yet; a live pass stays
    // quiet and simply waits for the next pause instead of raising an error.
    if (!live) showFeedback(requestFeedback, "No cleaning tasks could be summarised. Name each room and describe the cleaning action clearly.");
    return false;
  }
  const value = tasks.join("\n");
  if (requestForm.elements.tasks.value.trim() === value) return true;
  if (!automatic && requestForm.elements.tasks.value.trim() && !window.confirm("Replace the current room tasks with this new concise speech summary?")) return false;
  invalidateScopeReview("The concise checklist changed. Review every room task again before saving.");
  requestForm.elements.tasks.value = value;
  generatedChecklist = tasks.slice();
  generatedChecklistSource = "spoken";
  tasksManuallyEdited = false;
  renderTaskPreview();
  requestDirty = true;
  scheduleWorkingRequestRecovery();
  if (live) {
    speechStatus.textContent = `${tasks.length} concise room ${tasks.length === 1 ? "task" : "tasks"} so far — updating as you go. Review every bullet before confirming.`;
  } else {
    showFeedback(requestFeedback, `${tasks.length} concise room ${tasks.length === 1 ? "task" : "tasks"} prepared${automatic ? " automatically" : ""}. Review every bullet before confirming.`, "success");
  }
  return true;
}

// Turn speech (or typing) into concise bullets automatically after a short
// pause, without a separate action. Manual checklist edits switch the live
// pass off so a later spoken sentence can never silently overwrite them; the
// explicit summarise action with its confirmation still covers that case.
function scheduleLiveSummarise() {
  if (tasksManuallyEdited) return;
  clearTimeout(liveSummariseTimer);
  liveSummariseTimer = setTimeout(() => {
    if (requestForm.elements.transcript.value.trim()) summariseSpeech({ automatic: true, live: true });
  }, 900);
  // The on-device pass keeps the bullets moving while the Landlord is still
  // talking; the assisted pass refines them once they pause, because it needs
  // a round trip and only settled speech is worth sending.
  clearTimeout(assistedSummariseTimer);
  assistedSummariseTimer = setTimeout(requestAssistedSummary, 2500);
}

// Assisted understanding is optional and best-effort. Any failure — not
// configured, offline, provider down, slow — leaves the on-device bullets
// exactly as they are. The Landlord is never blocked and never sees an error
// for a feature they did not ask for.
async function requestAssistedSummary() {
  if (tasksManuallyEdited || assistedSummaryInFlight || assistedSummaryUnavailable) return;
  const transcript = requestForm.elements.transcript.value.trim();
  if (transcript.length < 20 || transcript === assistedSummaryTranscript) return;
  const csrf = storedCsrf();
  // This is a background convenience, so it never triggers the interactive
  // token-recovery flow — a missing token simply means no assisted pass.
  if (!csrf) return;
  assistedSummaryInFlight = true;
  try {
    const result = await requestJson("/api/marketplace/landlord/scan-summary", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ transcript })
    });
    const tasks = Array.isArray(result?.tasks) ? result.tasks.filter((task) => typeof task === "string" && task.trim()) : [];
    // Re-check every guard against the state as it is NOW, not as it was when
    // the request was sent. The Landlord may have kept speaking, started
    // editing, loaded a saved checklist or reset the form while this was in
    // flight — applying a stale answer would discard whichever of those is
    // newer than the transcript this response was built from.
    if (!tasks.length || tasksManuallyEdited) return;
    if (requestForm.elements.transcript.value.trim() !== transcript) return;
    assistedSummaryTranscript = transcript;
    const value = tasks.join("\n");
    if (requestForm.elements.tasks.value.trim() === value) return;
    invalidateScopeReview("The concise checklist changed. Review every room task again before saving.");
    requestForm.elements.tasks.value = value;
    renderTaskPreview();
    requestDirty = true;
    scheduleWorkingRequestRecovery();
    // Restrictions and safety warnings are called out by name rather than left
    // to blend into the checklist. "Do not move the paperwork" and "mind the
    // loose stair" are not work to do, and a Landlord who cannot see that they
    // were understood as restrictions has no way to check that they were.
    const structured = Array.isArray(result?.instructions) ? result.instructions : [];
    const guardCounts = ["restriction", "safety"]
      .map((kind) => ({ kind, count: structured.filter((entry) => entry?.kind === kind).length }))
      .filter((entry) => entry.count);
    const guardNote = guardCounts
      .map((entry) => `${entry.count} ${entry.kind === "safety"
        ? `safety ${entry.count === 1 ? "warning" : "warnings"}`
        : `do-not ${entry.count === 1 ? "instruction" : "instructions"}`}`)
      .join(" and ");
    speechStatus.textContent = `${tasks.length} room ${tasks.length === 1 ? "task" : "tasks"} understood from your walkthrough${guardNote ? `, including ${guardNote}` : ""}. Review every bullet before confirming.`;
  } catch (error) {
    // A 503 means no provider is configured on this deployment; stop asking for
    // the rest of the session rather than retrying on every pause.
    if (error?.statusCode === 503) assistedSummaryUnavailable = true;
  } finally {
    assistedSummaryInFlight = false;
  }
}

function configureSpeech() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    speechButton.disabled = true;
    speechStatus.textContent = "Speech capture is not supported in this browser. Type the walkthrough instead.";
    speechFallback.open = true;
    return;
  }
  recognition = new Recognition();
  recognition.lang = "en-GB";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onstart = () => { listening = true; speechFailed = false; speechChangedDuringListen = false; speechButton.textContent = "Stop speaking"; speechStatus.textContent = "Listening… Describe each room and the cleaning needed."; };
  recognition.onend = () => {
    listening = false;
    speechButton.textContent = "Start speaking";
    if (speechFailed) return;
    if (speechChangedDuringListen && requestForm.elements.transcript.value.trim()) {
      summariseSpeech({ automatic: true });
      speechStatus.textContent = "Speech stopped. Concise room tasks were updated automatically.";
    } else speechStatus.textContent = "Speech stopped. No new room notes were heard.";
  };
  recognition.onerror = () => {
    listening = false;
    speechFailed = true;
    speechButton.textContent = "Start speaking";
    const tasksUpdated = speechChangedDuringListen && requestForm.elements.transcript.value.trim()
      ? summariseSpeech({ automatic: true })
      : false;
    speechStatus.textContent = tasksUpdated
      ? "Speech stopped unexpectedly. Captured room notes were preserved and concise tasks were updated automatically."
      : "Speech capture stopped. Your existing transcript is still here; type or try again.";
  };
  recognition.onresult = (event) => {
    let finalText = "";
    let interimText = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const text = event.results[index][0]?.transcript || "";
      if (event.results[index].isFinal) finalText += `${text.trim()} `;
      else interimText += text;
    }
    if (finalText) {
      invalidateScopeReview("The spoken walkthrough changed. Summarise again or manually reconcile every room task before confirming.");
      requestForm.elements.transcript.value = `${requestForm.elements.transcript.value.trim()} ${finalText}`.trim().slice(0, 5000);
      speechChangedDuringListen = true;
      scheduleWorkingRequestRecovery();
      scheduleLiveSummarise();
    }
    speechStatus.textContent = interimText ? `Listening: ${interimText.slice(0, 160)}` : "Listening…";
    requestDirty = true;
  };
  speechStatus.textContent = "Speech is available. Your browser may use its own speech-to-text service.";
}

/**
 * The account menu behaves like a popover.
 *
 * <details> gives none of this for free: it stays open until its own summary is
 * clicked again, which on a menu anchored to an avatar reads as broken. The
 * design is explicit — clicking anywhere outside, pressing Escape, or choosing a
 * row closes it, and whichever view you are on stays where it is.
 *
 * Deliberately bound here rather than in account-menu.js: that file is shared by
 * every workspace and owns sign-out, and this is presentation for one dashboard.
 */
for (const menu of document.querySelectorAll("[data-account-menu]")) {
  // Choosing a row closes the menu. The row's own handler still runs — this
  // listener only collapses the popover around it.
  menu.querySelector(".account-menu-panel")?.addEventListener("click", (event) => {
    if (event.target.closest("a, button")) menu.open = false;
  });
}
document.addEventListener("click", (event) => {
  for (const menu of document.querySelectorAll("[data-account-menu][open]")) {
    if (!menu.contains(event.target)) menu.open = false;
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  for (const menu of document.querySelectorAll("[data-account-menu][open]")) {
    menu.open = false;
    // Focus goes back to the control that opened it, or the menu becomes a
    // keyboard trap that drops you at the top of the document.
    menu.querySelector("summary")?.focus();
  }
});

// Home is the landing view in the v2 design, so an address with no view in it
// opens Home rather than Properties.
// The entry's own state is the honest answer to "which view was this?".
// Reading only the address cannot tell Places from Bookings, because both are
// /landlord/bookings, so going back between them moved nothing on screen.
window.addEventListener("popstate", (event) => selectWorkspaceTab(event.state?.landlordTab || workspaceTabFromHash() || "home"));
// `replace` rather than a bare call, so an address that resolves to a view but
// is not that view's own address is rewritten to the canonical one. Landing on
// /landlord/properties showed the Bookings hub while the address bar still said
// properties — a link shared from there took the reader somewhere the sender
// never saw. Legacy #landlord-* anchors are normalised by the same line.
selectWorkspaceTab(workspaceTabFromHash() || "home", { historyMode: "replace" });

document.querySelectorAll("[data-open-landlord-section]").forEach((link) => link.addEventListener("click", (event) => {
  event.preventDefault();
  const selected = link.dataset.openLandlordSection;
  selectWorkspaceTab(selected, { historyMode: "push" });
  const accountMenu = link.closest("[data-account-menu]");
  if (accountMenu) accountMenu.open = false;
  document.querySelector(`[data-landlord-panel="${selected}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}));

/**
 * Account is one system with two doors: the large Account view and the compact
 * avatar menu. Personal details therefore opens the same disclosure in the
 * same panel from either entry point instead of navigating to a competing form.
 */
function openPersonalAccountDetails({ focus = false } = {}) {
  selectWorkspaceTab("account", { historyMode: "push" });
  const personal = document.querySelector('[data-account-section="personal"]');
  if (!personal) return;
  personal.open = true;
  personal.scrollIntoView({ behavior: "smooth", block: "start" });
  if (focus) personal.querySelector("input, textarea, button")?.focus({ preventScroll: true });
}

document.querySelectorAll("[data-account-destination=\"personal\"]").forEach((link) => link.addEventListener("click", (event) => {
  event.preventDefault();
  link.closest("[data-account-menu]")?.removeAttribute("open");
  openPersonalAccountDetails();
}));
document.querySelector("[data-account-personal-toggle]")?.addEventListener("click", () => openPersonalAccountDetails({ focus: true }));

for (const section of document.querySelectorAll("[data-account-section]")) {
  section.addEventListener("toggle", () => {
    if (!section.open) return;
    for (const peer of document.querySelectorAll("[data-account-section][open]")) {
      if (peer !== section) peer.open = false;
    }
  });
}
if (location.hash === "#account-personal") openPersonalAccountDetails();
// The redesigned dashboard sends its scan hero straight to the guided booking
// journey, so the legacy in-page request button is not present on every layout.
// Keep the old progressive-enhancement hook when that button exists without
// preventing the authenticated workspace from loading when it does not.
document.querySelectorAll("[data-open-request-tab]").forEach((button) => button.addEventListener("click", (event) => {
  event.preventDefault();
  // Open (expand) the Prepare-a-clean builder at its first step. Voice capture
  // is never auto-started here — the landlord taps "Start speaking" on the
  // walkthrough step when they are ready.
  selectWorkspaceTab("requests", { historyMode: "push" });
  resetRequestContinuation();
  // The builder is an overlay now, so it is already in view and scrolling the
  // page behind it would move the reader away from where they were.
  if (requestBuilderPanel && !requestBuilderDialog) requestBuilderPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}));

bookCleanOpen?.addEventListener("click", openBookCleanChooser);
bookCleanClose?.addEventListener("click", () => bookCleanDialog.close());
bookCleanNewPlace?.addEventListener("click", () => {
  bookCleanDialog.close();
  openPropertyEditor();
});
bookCleanScan?.addEventListener("click", () => {
  if (!keepBookCleanProperty()) return;
  location.assign("/landlord/book");
});
bookCleanManual?.addEventListener("click", beginManualCleanFromChooser);
bookCleanDialog?.addEventListener("click", (event) => {
  // Native dialog backdrop clicks target the dialog itself. Check coordinates
  // as well so a click in the white surface never closes the chooser.
  if (event.target !== bookCleanDialog) return;
  const box = bookCleanDialog.getBoundingClientRect();
  const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
  if (!inside) bookCleanDialog.close();
});
onDialogDismissal(bookCleanDialog, () => {
  bookCleanPropertyId = "";
  if (bookCleanStep) bookCleanStep.textContent = "Step 1 of 2 · choose a place";
});
matchOutcomeChangeTime?.addEventListener("click", () => prepareAnotherTime(matchOutcomeRequestId));
matchOutcomeBack?.addEventListener("click", () => showMatchOutcomeStep("result"));
matchOutcomeContinue?.addEventListener("click", () => continueAnotherTime(matchOutcomeRequestId));
onDialogDismissal(matchOutcomeDialog, () => {
  if (matchOutcomeSequence) matchOutcomeSequence.hidden = false;
  matchOutcomeDialog.setAttribute("aria-labelledby", "match-outcome-title");
  matchOutcomeDialog.removeAttribute("aria-label");
});
matchOutcomeDialog?.addEventListener("click", (event) => {
  if (event.target !== matchOutcomeDialog) return;
  const box = matchOutcomeDialog.getBoundingClientRect();
  const outside = event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
  if (outside) matchOutcomeDialog.close();
});

// A completed room scan hands its checklist and spoken note back here. Without
// this the scan would finish, say "use this checklist", and deliver nothing.
function adoptRoomScan() {
  let scan = null;
  try {
    const stored = sessionStorage.getItem("homle_scan_result");
    if (!stored) return;
    sessionStorage.removeItem("homle_scan_result");
    scan = JSON.parse(stored);
  } catch { return; }
  // A pre-consolidation cached scanner could have persisted private room-photo
  // data URLs in this handoff. Delete the key above, then refuse the payload.
  if (Array.isArray(scan?.photos) && scan.photos.length) return;
  const tasks = Array.isArray(scan?.tasks) ? scan.tasks.filter((task) => typeof task === "string" && task.trim()) : [];
  const transcript = typeof scan?.transcript === "string" ? scan.transcript.trim() : "";
  if (!tasks.length && !transcript) return;

  selectWorkspaceTab("requests", { historyMode: "replace" });
  if (transcript) requestForm.elements.transcript.value = transcript.slice(0, 5000);
  if (tasks.length) {
    requestForm.elements.tasks.value = tasks.join("\n");
    generatedChecklist = tasks.slice();
    generatedChecklistSource = "scanned";
    // The scan is a fresh scope, so any earlier approval no longer applies.
    invalidateScopeReview("This checklist came from your room scan. Review every room task before saving.");
    renderTaskPreview();
    tasksManuallyEdited = false;
  }
  requestDirty = true;
  scheduleWorkingRequestRecovery();
  showFeedback(requestFeedback, tasks.length
    ? `${tasks.length} room ${tasks.length === 1 ? "task" : "tasks"} brought over from your scan. Review every bullet before confirming.`
    : "Your spoken walkthrough was brought over from the scan. Review the checklist before confirming.", "success");
}
adoptRoomScan();
document.querySelector("[data-toggle-property-form]").addEventListener("click", () => openPropertyEditor());
document.querySelector("[data-close-property-form]").addEventListener("click", () => closePropertyEditor());
propertyDialog?.addEventListener("cancel", (event) => {
  // Route Escape through the same unsaved-change protection as Close.
  event.preventDefault();
  closePropertyEditor();
});
propertyDialog?.addEventListener("click", (event) => {
  if (event.target !== propertyDialog) return;
  const box = propertyDialog.getBoundingClientRect();
  const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
  if (!inside) closePropertyEditor();
});
document.querySelector("[data-use-saved-checklist]").addEventListener("click", useSavedChecklist);
checklistRestore?.addEventListener("click", restoreGeneratedChecklist);
document.querySelector("[data-summarise-speech]").addEventListener("click", summariseSpeech);
propertySelect.addEventListener("change", applySuggestedCleaningType);
cleaningTypeSelect.addEventListener("change", () => {
  cleaningTypeSelect.dataset.selectionSource = "user";
  cleaningTypeHint.textContent = "Selected by you. Change it if the requested clean is different.";
});
speechButton.addEventListener("click", () => { if (!recognition) return; if (listening) recognition.stop(); else { try { recognition.start(); } catch { speechStatus.textContent = "Speech is already starting. Try again in a moment."; } } });
requestForm.elements.transcript.addEventListener("input", () => { invalidateScopeReview("The walkthrough changed. Summarise again or manually reconcile every room task before confirming."); scheduleLiveSummarise(); });
requestForm.elements.tasks.addEventListener("input", () => { tasksManuallyEdited = true; clearTimeout(liveSummariseTimer); renderTaskPreview(); invalidateScopeReview("The concise checklist changed. Review every room task again before saving."); });
propertyForm.addEventListener("input", () => { propertyDirty = true; });
landlordProfileForm.addEventListener("input", () => { landlordProfileDirty = true; });
requestForm.addEventListener("input", () => { currentRequestDraft = null; requestDirty = true; scheduleWorkingRequestRecovery(); scheduleManualQuote(); });
requestForm.addEventListener("change", () => { currentRequestDraft = null; requestDirty = true; scheduleWorkingRequestRecovery(); scheduleManualQuote(); });
requestForm.addEventListener("reset", () => { window.setTimeout(() => clearManualQuote(), 0); });
propertyForm.addEventListener("submit", saveProperty);
landlordProfileForm.addEventListener("submit", saveLandlordProfile);
requestSave.addEventListener("click", openNewRequestPhotoDialog);
requestForm.addEventListener("submit", (event) => createRequestDraft(event, {
  defaultRoomName: "Property",
  triggerButton: requestContinue
}));
requestWithdrawForm.addEventListener("submit", withdrawRequest);
requestWithdrawCancel.addEventListener("click", () => { if (!withdrawalPending) requestWithdrawDialog.close(); });
requestWithdrawDialog.addEventListener("cancel", (event) => { if (withdrawalPending) event.preventDefault(); });
onDialogDismissal(requestWithdrawDialog, () => {
  if (withdrawalPending) return;
  withdrawingRequestId = "";
  withdrawingFromPropertyId = "";
  requestWithdrawForm.reset();
  requestWithdrawFeedback.hidden = true;
});
propertyArchiveForm.addEventListener("submit", archiveProperty);
propertyArchiveCancel.addEventListener("click", () => { if (!propertyArchivePending) propertyArchiveDialog.close(); });
propertyArchiveDialog.addEventListener("cancel", (event) => { if (propertyArchivePending) event.preventDefault(); });
onDialogDismissal(propertyArchiveDialog, () => {
  if (propertyArchivePending) return;
  archivingPropertyId = "";
  propertyArchiveFeedback.hidden = true;
});
landlordSectionToggles.forEach((button) => button.addEventListener("click", () => toggleLandlordSection(button)));
retry.addEventListener("click", loadWorkspace);
bookingRefresh.addEventListener("click", () => { void refreshBookingTransition({ manual: true }); });
document.querySelector("[data-request-complete-another]").addEventListener("click", () => {
  hideRequestCompletion();
  if (requestBuilderDialog?.open) requestBuilderDialog.close();
  selectWorkspaceTab("home");
  resetRequestContinuation();
  openBookCleanChooser();
});
requestCompleteNext.addEventListener("click", () => {
  hideRequestCompletion();
  if (requestBuilderDialog?.open) requestBuilderDialog.close();
  selectWorkspaceTab("bookings");
  setLandlordSectionExpanded(upcomingSectionToggle, true);
  const requestCard = [...document.querySelectorAll("[data-cleaning-request-id]")]
    .find((card) => card.dataset.cleaningRequestId === completedRequestId);
  (requestCard || requestList).scrollIntoView({ behavior: "smooth", block: "start" });
  requestCard?.querySelector(".landlord-dispatch-action .button")?.focus({ preventScroll: true });
});
window.addEventListener("beforeunload", (event) => { rememberWorkingRequest(); if (propertyDirty || requestDirty || landlordProfileDirty) event.preventDefault(); });
window.addEventListener("pagehide", () => { closeInvitationStream(); clearLandlordInvitationDeadlineTimer(); });
// Leaving for checkout, a booking record or settings is a full-page navigation,
// so the line above closes the stream. Coming back restores this page from
// bfcache with its DOM intact and its module state untouched, which meant
// nothing reopened the stream and nothing rearmed the countdown: a Landlord
// waiting on a Cleaner sat on a page that had quietly stopped listening.
// refreshBookingTransition refetches and rerenders, and renderBookings reaches
// syncInvitationStream, which reopens because closeInvitationStream cleared the
// key. No polling is introduced.
window.addEventListener("pageshow", (event) => { if (event.persisted) void refreshBookingTransition(); });
window.addEventListener("offline", updateNetworkStatus);
window.addEventListener("online", () => {
  updateNetworkStatus();
  if (!state.hidden && state.dataset.kind === "offline") loadWorkspace();
  else if (!workspace.hidden && bookings.some((booking) => booking.status === "pending-cleaner-acceptance")) void refreshBookingTransition();
});
initialiseRequestDefaults();
renderTaskPreview();
configureSpeech();
updateNetworkStatus();
loadWorkspace();
