import { checklistFromTranscript } from "./checklist.js";
import { clearSelectedCleaner, clearSelectedProperty, readSelectedCleaner, readSelectedProperty, saveSelectedCleaner, saveSelectedProperty } from "./account-intent.js?v=20260718-2";
import { isUkPostcode } from "./contact-validation.js";
import { clearLandlordRequestDraft, readLandlordRequestDraft, saveLandlordRequestDraft } from "./landlord-request-draft.js";
import { maximumRoomPhotos, validatedRoomPhotoSelection } from "./room-photo-selection.js";
import { extractRoomVideoFrames, maximumRoomVideoFrames } from "./room-video-frames.js";
import { renderAccountAvatar } from "./account-avatar.js?v=20260718-1";
import { dashboardWorkspaceAccess } from "./workspace-access.js?v=20260718-1";
import { landlordDispatchAction, landlordMarketplaceCapabilityState, landlordStartFromSearch, moneyToPence, requestStatusLabel, requestTasksFromLines, requestedWindow, suggestedCleaningType, tasksToLines } from "./landlord-dashboard-model.js?v=20260719-1";
import { bookingInvitationDeadlineState, bookingSummaryBuckets, bookingSummaryMoneyBoundary, bookingSummaryPriceLabel, bookingSummaryStatusLabels, formatBookingMoment, formatBookingMoney, formatBookingWindow, formatInvitationTimeRemaining, landlordDashboardSummary } from "./booking-summary-model.js?v=20260723-3";

const state = document.querySelector("[data-landlord-state]");
const stateTitle = document.querySelector("[data-landlord-state-title]");
const stateCopy = document.querySelector("[data-landlord-state-copy]");
const signIn = document.querySelector("[data-landlord-sign-in]");
const workspaceLink = document.querySelector("[data-landlord-workspace-link]");
const retry = document.querySelector("[data-landlord-retry]");
const workspace = document.querySelector("[data-landlord-workspace]");
const requestComplete = document.querySelector("[data-request-complete]");
const requestCompleteLead = document.querySelector("[data-request-complete-lead]");
const requestCompleteReference = document.querySelector("[data-request-complete-reference]");
const requestCompleteCounts = document.querySelector("[data-request-complete-counts]");
const requestCompleteWarning = document.querySelector("[data-request-complete-warning]");
const propertyForm = document.querySelector("[data-property-form]");
const requestForm = document.querySelector("[data-request-form]");
const landlordProfileForm = document.querySelector("[data-landlord-profile-form]");
const landlordProfileFeedback = document.querySelector("[data-landlord-profile-feedback]");
const landlordProfileSave = document.querySelector("[data-save-landlord-profile]");
const propertyList = document.querySelector("[data-property-list]");
const propertyEmpty = document.querySelector("[data-property-empty]");
const requestList = document.querySelector("[data-request-list]");
const requestEmpty = document.querySelector("[data-request-empty]");
const propertySelect = document.querySelector("[data-property-select]");
const propertySelectLabel = document.querySelector("[data-property-select-label]");
const soleProperty = document.querySelector("[data-sole-property]");
const solePropertyName = document.querySelector("[data-sole-property-name]");
const propertyFeedback = document.querySelector("[data-property-feedback]");
const propertyStatus = document.querySelector("[data-property-status]");
const propertyFormTitle = document.querySelector("[data-property-form-title]");
const requestFeedback = document.querySelector("[data-request-feedback]");
const requestRecoveryStatus = document.querySelector("[data-request-recovery-status]");
const requestStatus = document.querySelector("[data-request-status]");
const invitationQuoteDialog = document.querySelector("[data-invitation-quote-dialog]");
const invitationQuoteCleaner = document.querySelector("[data-invitation-quote-cleaner]");
const invitationQuotePrice = document.querySelector("[data-invitation-quote-price]");
const invitationQuoteApprove = document.querySelector("[data-invitation-quote-approve]");
const dispatchPriceDialog = document.querySelector("[data-dispatch-price-dialog]");
const dispatchPriceMaximum = document.querySelector("[data-dispatch-price-maximum]");
const dispatchPriceAttempts = document.querySelector("[data-dispatch-price-attempts]");
const dispatchPriceApprove = document.querySelector("[data-dispatch-price-approve]");
const requestWithdrawDialog = document.querySelector("[data-request-withdraw-dialog]");
const requestWithdrawForm = document.querySelector("[data-request-withdraw-form]");
const requestWithdrawFeedback = document.querySelector("[data-request-withdraw-feedback]");
const requestWithdrawCancel = document.querySelector("[data-request-withdraw-cancel]");
const requestWithdrawConfirm = document.querySelector("[data-request-withdraw-confirm]");
const propertySave = document.querySelector("[data-save-property]");
const requestSave = document.querySelector("[data-save-request]");
const speechButton = document.querySelector("[data-speech-toggle]");
const scanPropertyStatus = document.querySelector("[data-scan-property-status]");
const speechStatus = document.querySelector("[data-speech-status]");
const speechFallback = document.querySelector("[data-speech-fallback]");
const taskPreview = document.querySelector("[data-task-preview]");
const taskReviewStatus = document.querySelector("[data-task-review-status]");
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
const upcomingSectionToggle = document.querySelector('[data-landlord-section-toggle][aria-controls="landlord-booking-content"]');
const selectedCleanerSummary = document.querySelector("[data-landlord-selected-cleaner]");
const selectedCleanerAvatar = document.querySelector("[data-landlord-selected-cleaner-avatar]");
const selectedCleanerName = document.querySelector("[data-landlord-selected-cleaner-name]");
const selectedCleanerEvidence = document.querySelector("[data-landlord-selected-cleaner-evidence]");
const selectedCleanerStatus = document.querySelector("[data-landlord-selected-cleaner-status]");
const selectedCleanerClear = document.querySelector("[data-landlord-selected-cleaner-clear]");
let properties = [];
let requests = [];
let bookings = [];
let favouriteCleaners = [];
let landlordProfile = null;
let recognition = null;
let tasksManuallyEdited = false;
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
let withdrawalPending = false;
let loading = false;
let mediaReady = false;
let pricingReady = false;
let geocodingReady = false;
let matchingReady = false;
let requestRecoveryChecked = false;
let requestRecoveryTimer = null;
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
try { if (bookingStart) selectedCleanerId = readSelectedCleaner(localStorage); } catch {}
try { if (bookingStart) selectedPropertyId = readSelectedProperty(sessionStorage); } catch {}

function browserOffline() {
  return navigator.onLine === false;
}

function updateNetworkStatus() {
  networkStatus.hidden = !browserOffline();
}

function storedCsrf() {
  try { return sessionStorage.getItem("tideway_csrf") || ""; } catch { return ""; }
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

function renderTaskPreview() {
  const lines = String(requestForm.elements.tasks.value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const confirmation = requestForm.elements.scopeReviewed;
  try {
    const reviewedTasks = requestTasksFromLines(lines.join("\n"));
    const roomCount = new Set(reviewedTasks.map((task) => task.roomName.toLowerCase())).size;
    confirmation.disabled = false;
    taskReviewStatus.dataset.kind = "ready";
    taskReviewStatus.textContent = `${reviewedTasks.length} clear ${reviewedTasks.length === 1 ? "task" : "tasks"} across ${roomCount} ${roomCount === 1 ? "room" : "rooms"}. Review the bullets, then confirm.`;
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

function showRequestCompletion(submission, { automaticDispatch = false, automaticMaximumPricePence = null, selectedCleanerInvited = false, selectedCleanerPricePence = null, warning = "" } = {}) {
  const photos = Number(submission?.photoCount);
  const tasks = Number(submission?.taskCount);
  requestCompleteReference.textContent = submission?.cleaningRequestId || "Recorded privately";
  requestCompleteCounts.textContent = `${Number.isInteger(photos) ? photos : 0} room ${photos === 1 ? "photo" : "photos"} · ${Number.isInteger(tasks) ? tasks : 0} concise Cleaner ${tasks === 1 ? "task" : "tasks"}`;
  requestCompleteLead.textContent = warning
    ? "Your reviewed scan is submitted for matching. No booking or payment exists yet."
    : selectedCleanerInvited
    ? `Your reviewed scan is submitted and the selected Cleaner has been invited at ${formatBookingMoney(selectedCleanerPricePence)}. This becomes a booking only if they accept.`
    : automaticDispatch
    ? `Your reviewed scan is submitted and Homle is authorised to invite an eligible profitable match costing no more than ${formatBookingMoney(automaticMaximumPricePence)} within your chosen attempt limit.`
    : "Your reviewed scan is submitted for matching. No Cleaner has been invited automatically.";
  requestCompleteWarning.textContent = warning;
  requestCompleteWarning.hidden = !warning;
  state.hidden = true;
  workspace.hidden = true;
  requestComplete.hidden = false;
  history.replaceState(null, "", "/landlord/dashboard");
  requestComplete.focus();
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
    invitationQuoteDialog.addEventListener("close", () => resolve(invitationQuoteDialog.returnValue === "approve"), { once: true });
    invitationQuoteDialog.showModal();
  });
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
    dispatchPriceDialog.addEventListener("close", () => resolve(dispatchPriceDialog.returnValue === "approve"), { once: true });
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

function workspaceTabFromHash() {
  const match = /^#landlord-(properties|requests|account)$/.exec(location.hash);
  return match?.[1] || "";
}

const requestBuilderMount = document.querySelector("[data-request-builder-mount]");
const requestBuilderPanel = document.querySelector('[data-landlord-panel="requests"]');
if (requestBuilderMount && requestBuilderPanel) requestBuilderMount.replaceWith(requestBuilderPanel);

function setRequestBuilderExpanded(expanded) {
  if (!requestBuilderPanel) return;
  requestBuilderPanel.hidden = false;
  requestBuilderPanel.classList.toggle("pac-collapsed", !expanded);
  const toggle = requestBuilderPanel.querySelector("[data-pac-toggle]");
  if (toggle) {
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.textContent = expanded ? "Hide ↑" : "Reveal builder ↓";
  }
}

function selectWorkspaceTab(name, { historyMode = "" } = {}) {
  const selected = ["properties", "requests", "account"].includes(name) ? name : "properties";
  document.querySelectorAll('[data-landlord-panel]:not([data-landlord-panel="requests"])').forEach((panel) => {
    panel.hidden = selected === "requests" ? panel.dataset.landlordPanel !== "properties" : panel.dataset.landlordPanel !== selected;
  });
  setRequestBuilderExpanded(selected === "requests");
  if (historyMode === "push") history.pushState({ landlordTab: selected }, "", `#landlord-${selected}`);
  if (historyMode === "replace") history.replaceState({ landlordTab: selected }, "", `#landlord-${selected}`);
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

async function requestJson(path, options = {}) {
  const { headers = {}, ...rest } = options;
  const mutation = Boolean(rest.method && rest.method !== "GET");
  if (browserOffline()) throw Object.assign(new Error(mutation
    ? "You are offline. This change was not sent; your entries are still here. Reconnect, then try again."
    : "You are offline. Reconnect to open your private workspace."), { code: "browser-offline" });
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...rest, headers: { Accept: "application/json", ...headers }, signal: controller.signal });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(result.error || result.message || "The account action could not be completed."), { statusCode: response.status, code: result.code });
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
  propertyForm.scrollIntoView({ behavior: "smooth", block: "start" });
  (property ? propertyForm.elements.accessInstructions : propertyForm.elements.propertyType).focus({ preventScroll: true });
}

function closePropertyEditor() {
  if (propertyDirty && !window.confirm("Close and discard these unsaved property changes?")) return;
  propertyForm.hidden = true;
  propertyForm.reset();
  editingPropertyId = "";
  propertyDirty = false;
  propertyFormTitle.textContent = "Add the cleaning location";
  propertySave.textContent = "Save property privately";
}

function renderProperties() {
  propertyList.replaceChildren();
  propertySelect.replaceChildren(element("option", "", properties.length ? "Choose a property" : "Add a property first"));
  propertySelect.firstElementChild.value = "";
  for (const property of properties) {
    const card = element("article", "landlord-property-card");
    const heading = element("div", "landlord-property-card-heading");
    const title = element("div");
    title.append(element("span", "landlord-private-pill", "Private property"), element("h3", "", property.name || "Saved property"), element("p", "", exactAddress(property)));
    heading.append(title, element("strong", "", String(property.propertyType || "Property").replace(/-/g, " ")));
    const facts = element("dl", "landlord-property-facts");
    facts.append(propertyFact("Bedrooms", property.bedrooms ?? "—"), propertyFact("Bathrooms", property.bathrooms ?? "—"), propertyFact("Size", property.approximateSizeSqM == null ? "Not supplied" : `${property.approximateSizeSqM} m²`), propertyFact("Saved tasks", Array.isArray(property.savedChecklist) ? property.savedChecklist.length : 0));
    const details = element("details", "landlord-property-details");
    details.append(element("summary", "", "View protected property details"));
    const notes = element("dl");
    notes.append(propertyFact("Access instructions", property.accessInstructions || "None saved"), propertyFact("Parking", property.parkingInstructions || "None saved"), propertyFact("Cleaning preferences", property.cleaningPreferences || "None saved"), propertyFact("Special notes", property.specialNotes || "None saved"));
    details.append(notes);
    const actions = element("div", "landlord-property-actions");
    const edit = element("button", "button button-outline", property.accessInstructions ? "Edit access and details" : "Add access details");
    edit.type = "button";
    edit.setAttribute("aria-label", `${property.accessInstructions ? "Edit access and details for" : "Add access details for"} ${property.name || "saved property"}`);
    edit.addEventListener("click", () => openPropertyEditor(property));
    actions.append(edit);
    card.append(heading, facts, details, actions);
    propertyList.append(card);
    const option = element("option", "", property.name || "Saved property");
    option.value = property.propertyId;
    propertySelect.append(option);
  }
  const hasSoleProperty = properties.length === 1;
  propertySelectLabel.hidden = hasSoleProperty;
  soleProperty.hidden = !hasSoleProperty;
  if (hasSoleProperty) {
    propertySelect.value = properties[0].propertyId;
    solePropertyName.textContent = properties[0].name || "Saved property";
  } else solePropertyName.textContent = "";
  applySuggestedCleaningType();
  propertyEmpty.hidden = properties.length > 0;
  propertyList.hidden = properties.length === 0;
  scanPropertyStatus.dataset.kind = properties.length ? "ready" : "attention";
  scanPropertyStatus.textContent = properties.length
    ? "Your room scan can be saved to the selected private property."
    : "Start speaking now. Add a property before saving the request; your unfinished walkthrough stays in this tab.";
  document.querySelector("[data-property-count]").textContent = String(properties.length);
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
  const details = [...requestList.querySelectorAll("[data-request-scan-id]")].find((item) => item.dataset.requestScanId === requestId);
  if (!details) return false;
  details.open = true;
  details.scrollIntoView({ behavior: "smooth", block: "start" });
  details.querySelector('select[name="roomName"]')?.focus({ preventScroll: true });
  return true;
}

function requestScanPanel(request) {
  const details = element("details", "landlord-request-scan");
  details.dataset.requestScanId = request.requestId;
  const summary = element("summary", "", request.status === "draft" ? (mediaReady ? "Add room photos and submit" : "Test the room camera") : "View reviewed room scan");
  details.append(summary);
  const panel = element("div", "landlord-request-scan-body");
  const intro = element("p", "landlord-request-scan-copy", request.status === "draft" ? (mediaReady ? "Choose the checklist room and take a current photo or short room video. Homle turns video into private still frames on this device, strips image metadata and keeps only sanitized JPEGs." : "Test the real phone camera or a short room video now. The visual previews stay only on this device and disappear when you leave; secure upload and matching submission remain locked until private storage is connected.") : "This is the reviewed room-scan handoff attached to the request.");
  const feedback = element("div", "landlord-form-feedback");
  feedback.hidden = true;
  feedback.tabIndex = -1;
  const count = element("strong", "landlord-scan-count", "Loading private room photos…");
  const list = element("ul", "landlord-scan-photo-list");
  list.hidden = true;
  panel.append(intro, count, list);
  let loaded = false;

  async function loadScan() {
    if (!mediaReady) {
      count.textContent = "Private room-photo storage not connected";
      loaded = true;
      return;
    }
    try {
      const result = await requestJson(`/api/marketplace/cleaning-requests/${encodeURIComponent(request.requestId)}/scan`);
      requestScans.set(request.requestId, result.scan);
      renderScanPhotos(request.requestId, result.scan, list, count);
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
    const roomLabel = element("label", "", "Checklist room");
    const room = element("select");
    room.name = "roomName";
    room.required = true;
    room.append(element("option", "", "Choose a room"));
    room.firstElementChild.value = "";
    for (const name of roomNames(request)) { const option = element("option", "", name); option.value = name; room.append(option); }
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
    let files = [];
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
      const candidates = event.target.files;
      event.target.value = "";
      if (!candidates?.length) return;
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
      const candidate = event.target.files?.[0];
      event.target.value = "";
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
      setUploadEditorLocked(true);
      setPending(upload, true, `Checking photo 1 of ${queuedCount}…`);
      try {
        const csrf = await recoverCsrf(feedback, "uploading this room photo");
        if (!csrf) return;
        while (files.length) {
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
          setPending(upload, true, `Verifying photo ${uploadedCount + 1} of ${queuedCount}…`);
          let completed;
          try {
            completed = await requestJson(`/api/marketplace/cleaning-requests/${encodeURIComponent(request.requestId)}/photos/${encodeURIComponent(uploadId)}/complete`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: "{}" });
          } catch (error) {
            if (["request-photo-upload-expired", "request-photo-upload-not-found", "request-photo-mismatch", "unsafe-request-photo", "request-photo-upload-not-allowed"].includes(error?.code)) pendingPhotoCompletions.delete(candidate);
            throw error;
          }
          requestScans.set(request.requestId, completed.scan);
          renderScanPhotos(request.requestId, completed.scan, list, count);
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
        setUploadEditorLocked(false);
        setPending(upload, false, files.length ? `Upload ${files.length} remaining ${files.length === 1 ? "photo" : "photos"}` : "Upload private room photos");
        renderSelection();
      }
    });
    panel.append(form);

    const submitForm = element("form", "landlord-request-submit-form");
    const confirmLabel = element("label", "checkbox landlord-review-confirmation");
    const confirm = element("input");
    confirm.type = "checkbox";
    confirm.required = true;
    confirm.name = "scopeReviewed";
    confirmLabel.append(confirm, element("span", "", "I reviewed the concise Cleaner checklist and every attached room photo. This is the exact work I want Homle to match and quote."));
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
    autoLabel.append(auto, element("span", "", automaticMaximumPricePence == null
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
    auto.addEventListener("change", () => { attempts.disabled = !auto.checked; });
    const submit = element("button", "button", "Submit cleaning request");
    submit.type = "submit";
    for (const control of [confirm, preview, submit]) control.disabled = !mediaReady;
    for (const control of [auto, preferred, attempts]) control.disabled = !mediaReady || !matchingReady || control === attempts;
    if (automaticMaximumPricePence == null || !matchingReady) auto.disabled = true;
    if (!mediaReady) submit.textContent = "Room photos required before submission";
    submitForm.append(confirmLabel, previewLabel, ...(selectedCleanerReady ? [preferredLabel] : [autoLabel, attemptsLabel]), submit);
    submitForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      feedback.hidden = true;
      if (!submitForm.reportValidity()) return;
      if (!(requestScans.get(request.requestId)?.photos?.length > 0)) return showFeedback(feedback, "Upload and finish at least one current room photo before submission.");
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
        submission = result.submission;
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
  const visibleRequests = requests.filter((request) => request.status !== "cancelled");
  for (const request of visibleRequests) {
    const card = element("article", "landlord-request-card");
    const property = properties.find((item) => item.propertyId === request.propertyId);
    const heading = element("div", "landlord-request-card-heading");
    const title = element("div");
    title.append(element("span", "landlord-private-pill", requestStatusLabel(request.status)), element("h3", "", property?.name || "Saved property"));
    heading.append(title, element("strong", "", String(request.cleaningType || "Cleaning").replace(/-/g, " ")));
    const facts = element("dl", "landlord-request-facts");
    const start = new Date(request.requestedStartAt);
    const end = new Date(request.requestedEndAt);
    facts.append(propertyFact("Requested", Number.isNaN(start.getTime()) ? "Unavailable" : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(start)), propertyFact("Duration", Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) ? "Unavailable" : `${Math.round((end - start) / 3_600_000 * 10) / 10} hours`), propertyFact("Tasks", Array.isArray(request.tasks) ? request.tasks.length : 0), propertyFact("Frequency", String(request.frequency || "one-time").replace(/-/g, " ")));
    const boundaryCopy = request.status === "draft"
      ? "Private draft only — no Cleaner has been invited and no booking or payment exists."
      : request.status === "searching-for-cleaner"
      ? "Open for matching — no booking exists until an eligible Cleaner accepts the frozen terms."
      : request.status === "cancelled"
      ? "Withdrawn — matching is closed and no booking or payment was changed."
      : "This request has entered the account workflow.";
    const boundary = element("p", "landlord-request-boundary", boundaryCopy);
    card.append(heading, facts, boundary, requestScanPanel(request));
    const dispatchAction = landlordDispatchAction(request);
    if (dispatchAction.kind !== "none") {
      const dispatchPanel = element("section", "landlord-dispatch-action");
      dispatchPanel.setAttribute("aria-label", "Cleaner matching authorization");
      dispatchPanel.dataset.dispatchRequestId = request.requestId;
      const dispatchFeedback = element("p", "form-feedback");
      dispatchFeedback.hidden = true;
      if (uncertainDispatchRequests.has(request.requestId)) {
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
        dispatchPanel.append(element("strong", "", firstAttempt ? "Ready to find your Cleaner?" : "Try one more eligible Cleaner?"), element("p", "", maximum == null ? "Automatic matching is unavailable because this submitted request has no approved maximum total. Choose a Cleaner directly or withdraw and create a new request with a maximum." : `This authorises exactly one additional invitation to the best eligible profitable match at no more than ${formatBookingMoney(maximum)}. It is not a booking, no payment is taken, and the Cleaner must still accept.`));
        const authorize = element("button", "button", firstAttempt ? "Find my Cleaner" : "Try one more Cleaner");
        authorize.type = "button";
        authorize.disabled = maximum == null;
        authorize.addEventListener("click", () => authorizeNextCleaner(request.requestId, dispatchAction.attemptLimit, authorize, dispatchFeedback));
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
    requestList.append(card);
  }
  requestEmpty.hidden = visibleRequests.length > 0;
  requestList.hidden = visibleRequests.length === 0;
  const draftCount = visibleRequests.filter((request) => request.status === "draft").length;
  document.querySelector("[data-draft-count]").textContent = String(draftCount);
  updateUpcomingRevealCount();
}

async function authorizeNextCleaner(requestId, attemptLimit, button, feedback) {
  feedback.hidden = true;
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

function setBookingLiveStatus(message, kind = "info") {
  bookingLiveStatus.dataset.kind = kind;
  bookingLiveStatus.textContent = message;
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
      if (accepted) setBookingLiveStatus(`Cleaner accepted — ${accepted.propertyName || "your clean"} is now a confirmed booking.`, "success");
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

function openRequestWithdrawal(requestId) {
  const request = requests.find((item) => item.requestId === requestId);
  if (!request || !["draft", "searching-for-cleaner"].includes(request.status)) return;
  withdrawingRequestId = requestId;
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
    withdrawingRequestId = "";
    requestWithdrawDialog.close();
    renderRequests();
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
  const heading = element("div", "booking-summary-heading");
  const title = element("div");
  title.append(element("span", "booking-status-pill", bookingSummaryStatusLabels[booking.status] || "Booking"), element("h3", "", booking.cleaningType || "Cleaning"), element("p", "", `${booking.propertyName || "Saved property"} · ${booking.counterpartyName || "Assigned Cleaner"}`));
  heading.append(title, element("strong", "booking-summary-price", formatBookingMoney(booking.pricePence)));
  const facts = element("dl", "booking-summary-facts");
  for (const [label, value] of [["When", formatBookingWindow(booking.scheduledStartAt, booking.scheduledEndAt)], ["Area", booking.propertyArea || "Saved property area"], [bookingSummaryPriceLabel("landlord"), formatBookingMoney(booking.pricePence)], ["Checklist", `${booking.taskCount} ${booking.taskCount === 1 ? "task" : "tasks"}`]]) {
    const wrapper = element("div");
    wrapper.append(element("dt", "", label), element("dd", "", value));
    facts.append(wrapper);
  }
  const actions = element("div", "booking-summary-actions");
  if (booking.paymentStepAvailable) {
    const payment = element("a", "button", "Authorize booking total");
    payment.href = `/booking-payment?bookingId=${encodeURIComponent(booking.bookingId)}`;
    actions.append(payment);
  }
  if (booking.activeJobAvailable) {
    const link = element("a", booking.paymentStepAvailable ? "button button-outline" : "button", ["awaiting-review", "completed"].includes(booking.status) ? "View job record" : booking.paymentStepAvailable ? "View booking details" : "Open live booking");
    link.href = `/bookings/${booking.bookingId}`;
    actions.append(link);
  }
  card.append(heading, facts, element("p", "booking-money-boundary", bookingSummaryMoneyBoundary(booking, "landlord")));
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

function renderBookings() {
  const buckets = bookingSummaryBuckets(bookings, "landlord");
  const historySummary = landlordDashboardSummary(bookings);
  const current = [...buckets.active, ...buckets.upcoming];
  const list = document.querySelector("[data-landlord-booking-list]");
  list.replaceChildren(...current.map(renderBookingCard));
  list.hidden = current.length === 0;
  document.querySelector("[data-landlord-booking-empty]").hidden = current.length > 0;
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
  const visibleRequestCount = requests.filter((request) => request.status !== "cancelled").length;
  const buckets = bookingSummaryBuckets(bookings, "landlord");
  const bookingCount = buckets.active.length + buckets.upcoming.length + buckets.waiting.length;
  document.querySelector("[data-landlord-booking-reveal-count]").textContent = String(visibleRequestCount + bookingCount);
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
    const remove = element("button", "text-button", "Remove");
    remove.type = "button";
    remove.addEventListener("click", () => removeFavouriteCleaner(cleaner.cleanerId, remove));
    actions.append(request, remove);
    card.append(identity, actions);
    return card;
  }));
  document.querySelector("[data-landlord-favourite-empty]").hidden = favouriteCleaners.length > 0;
}

async function refreshFavouriteCleaners({ quiet = false } = {}) {
  const feedback = document.querySelector("[data-landlord-favourite-feedback]");
  try {
    const result = await requestJson("/api/marketplace/landlord/favourite-cleaners");
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

async function loadWorkspace() {
  if (loading) return;
  loading = true;
  showState("Checking secure Landlord access…", "Your properties and drafts open only inside an authenticated Landlord session.");
  try {
    const accountResult = await requestJson("/api/marketplace/account");
    const account = accountResult.account;
    const access = dashboardWorkspaceAccess(account, "landlord");
    if (!access.ready) return access.reason === "different-workspace"
      ? showState(`Your ${access.label} workspace is active.`, "Properties, room scans and cleaning requests remain in a separate private Landlord dashboard.", { kind: "authentication", workspaceDestination: access.destination, workspaceLabel: access.label })
      : showState("This account has no Landlord workspace.", "Sign in through Book a clean to create the separate property workspace.", { kind: "authentication", allowSignIn: true });
    document.querySelector("[data-landlord-name]").textContent = account.displayName || "Landlord";
    renderAccountAvatar(account);
    state.hidden = true;
    workspace.hidden = false;
    workspace.setAttribute("aria-busy", "true");
    loadStatus.hidden = true;

    const [profileResult, propertyResult, requestResult, bookingResult, healthResult] = await Promise.allSettled([
      requestJson("/api/marketplace/landlord/profile"),
      requestJson("/api/marketplace/properties"),
      requestJson("/api/marketplace/cleaning-requests"),
      requestJson("/api/marketplace/bookings?limit=50"),
      requestJson("/api/health")
    ]);
    const results = [profileResult, propertyResult, requestResult, bookingResult, healthResult];
    const failures = results.filter((result) => result.status === "rejected");
    const authorizationFailure = failures.find((result) => [401, 403].includes(result.reason?.statusCode));
    if (authorizationFailure) throw authorizationFailure.reason;
    if (propertyResult.status === "fulfilled") properties = Array.isArray(propertyResult.value.properties) ? propertyResult.value.properties : [];
    if (requestResult.status === "fulfilled") requests = Array.isArray(requestResult.value.cleaningRequests) ? requestResult.value.cleaningRequests : [];
    if (bookingResult.status === "fulfilled") bookings = Array.isArray(bookingResult.value.bookings) ? bookingResult.value.bookings : [];
    landlordProfile = profileResult.status === "fulfilled" ? (profileResult.value.profile || { organisationName: null, biography: "" }) : { organisationName: null, biography: "" };
    landlordProfileForm.elements.organisationName.value = landlordProfile.organisationName || "";
    landlordProfileForm.elements.biography.value = landlordProfile.biography || "";
    landlordProfileDirty = false;
    const capabilities = landlordMarketplaceCapabilityState({
      mediaReady: healthResult.status === "fulfilled" && healthResult.value?.marketplace?.mediaReady === true,
      pricingReady: healthResult.status === "fulfilled" && healthResult.value?.marketplace?.matchingReady === true,
      geocodingReady: healthResult.status === "fulfilled" && healthResult.value?.marketplace?.geocodingReady === true
    });
    ({ mediaReady, pricingReady, geocodingReady, matchingReady } = capabilities);
    mediaReadiness.hidden = capabilities.notice === null;
    if (capabilities.notice) {
      capabilityTitle.textContent = capabilities.notice.title;
      capabilityCopy.textContent = capabilities.notice.copy;
    }
    renderProperties();
    restoreWorkingRequest();
    renderRequests();
    renderBookings();
    await refreshFavouriteCleaners();
    loadStatus.hidden = failures.length === 0;
    if (location.hash === "#landlord-account-title") selectWorkspaceTab("account");
    continueBookingStart();
    void refreshSelectedCleanerProfile();
  } catch (error) {
    if (error.code === "browser-offline") showState("You are offline.", "Your unfinished room walkthrough stays in this tab. Reconnect and Homle will safely reopen the private workspace; no change will be retried automatically.", { kind: "offline", allowRetry: true });
    else if (error.statusCode === 401) showState("Sign in as a Landlord to open this workspace.", "Your properties and request drafts are private to your verified account.", { kind: "authentication", allowSignIn: true });
    else if (error.statusCode === 403) showState("This account cannot open the Landlord workspace.", "Use a Landlord/Property Manager account selected during onboarding.", { kind: "authentication", allowSignIn: true });
    else if (error.statusCode === 404 || error.statusCode === 503) showState("Landlord accounts are not connected yet.", "The workspace is ready but remains closed until Homle's secure marketplace database and account runtime are activated.", { kind: "unavailable", allowRetry: true });
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

async function createRequestDraft(event) {
  event.preventDefault();
  requestFeedback.hidden = true;
  if (!requestForm.reportValidity()) return;
  const data = new FormData(requestForm);
  let tasks;
  let window;
  let budgetPence;
  try {
    tasks = requestTasksFromLines(data.get("tasks"));
    window = requestedWindow(data.get("requestedDate"), data.get("requestedTime"), data.get("durationMinutes"));
    budgetPence = moneyToPence(data.get("budget"));
  } catch (error) { return showFeedback(requestFeedback, error.message); }
  const cleaningType = String(data.get("cleaningType") || "");
  const requiredServices = [cleaningType];
  if (data.get("scopeReviewed") !== "on") return showFeedback(requestFeedback, "Review and confirm the concise room checklist before saving this draft.");
  const csrf = await recoverCsrf(requestFeedback, "saving this cleaning-request draft");
  if (!csrf) return;
  const body = { propertyId: String(data.get("propertyId") || ""), ...window, cleaningType, requiredServices, specialInstructions: String(data.get("specialInstructions") || ""), budgetPence, frequency: String(data.get("frequency") || "one-time"), tasks, submit: false };
  setPending(requestSave, true, "Saving draft…");
  try {
    const result = await requestJson("/api/marketplace/cleaning-requests", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify(body) });
    if (!result.cleaningRequest?.requestId) throw new Error("The saved cleaning-request draft could not be verified.");
    requests.unshift(result.cleaningRequest);
    renderRequests();
    requestForm.reset();
    try { clearLandlordRequestDraft(window.sessionStorage); } catch {}
    requestRecoveryStatus.removeAttribute("data-kind");
    requestRecoveryStatus.textContent = "An unfinished walkthrough stays only in this browser tab for up to 30 minutes. Approval and photos are never restored.";
    delete cleaningTypeSelect.dataset.selectionSource;
    initialiseRequestDefaults();
    renderTaskPreview();
    showFeedback(requestFeedback, `Private draft ${result.cleaningRequest.requestId} saved. It was not sent for matching.`, "success");
    requestDirty = false;
    setLandlordSectionExpanded(upcomingSectionToggle, true);
    openRequestScan(result.cleaningRequest.requestId);
    requestList.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) { showFeedback(requestFeedback, error.statusCode === 401 || error.statusCode === 403 ? "Your secure session expired or cannot save this draft. Sign in again." : error.message); }
  finally { setPending(requestSave, false, "Save private draft"); }
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
    speechStatus.textContent = `${tasks.length} room ${tasks.length === 1 ? "task" : "tasks"} understood from your walkthrough. Review every bullet before confirming.`;
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

window.addEventListener("popstate", () => selectWorkspaceTab(workspaceTabFromHash() || "properties"));
selectWorkspaceTab(workspaceTabFromHash() || "properties");
document.querySelectorAll("[data-open-landlord-section]").forEach((link) => link.addEventListener("click", (event) => {
  event.preventDefault();
  const selected = link.dataset.openLandlordSection;
  selectWorkspaceTab(selected, { historyMode: "push" });
  const accountMenu = link.closest("[data-account-menu]");
  if (accountMenu) accountMenu.open = false;
  document.querySelector(`[data-landlord-panel="${selected}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}));
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
  if (requestBuilderPanel) requestBuilderPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}));

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
  const tasks = Array.isArray(scan?.tasks) ? scan.tasks.filter((task) => typeof task === "string" && task.trim()) : [];
  const transcript = typeof scan?.transcript === "string" ? scan.transcript.trim() : "";
  if (!tasks.length && !transcript) return;

  selectWorkspaceTab("requests", { historyMode: "replace" });
  if (transcript) requestForm.elements.transcript.value = transcript.slice(0, 5000);
  if (tasks.length) {
    requestForm.elements.tasks.value = tasks.join("\n");
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
document.querySelector("[data-close-property-form]").addEventListener("click", closePropertyEditor);
document.querySelector("[data-use-saved-checklist]").addEventListener("click", useSavedChecklist);
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
requestForm.addEventListener("input", () => { requestDirty = true; scheduleWorkingRequestRecovery(); });
requestForm.addEventListener("change", () => { requestDirty = true; scheduleWorkingRequestRecovery(); });
propertyForm.addEventListener("submit", saveProperty);
landlordProfileForm.addEventListener("submit", saveLandlordProfile);
requestForm.addEventListener("submit", createRequestDraft);
requestWithdrawForm.addEventListener("submit", withdrawRequest);
requestWithdrawCancel.addEventListener("click", () => { if (!withdrawalPending) requestWithdrawDialog.close(); });
requestWithdrawDialog.addEventListener("cancel", (event) => { if (withdrawalPending) event.preventDefault(); });
requestWithdrawDialog.addEventListener("close", () => {
  if (withdrawalPending) return;
  withdrawingRequestId = "";
  requestWithdrawForm.reset();
  requestWithdrawFeedback.hidden = true;
});
landlordSectionToggles.forEach((button) => button.addEventListener("click", () => toggleLandlordSection(button)));
retry.addEventListener("click", loadWorkspace);
bookingRefresh.addEventListener("click", () => { void refreshBookingTransition({ manual: true }); });
document.querySelector("[data-request-complete-another]").addEventListener("click", () => {
  requestComplete.hidden = true;
  workspace.hidden = false;
  selectWorkspaceTab("requests");
  requestForm.scrollIntoView({ behavior: "smooth", block: "start" });
  (propertySelect.value ? requestForm.elements.requestedDate : propertySelect).focus({ preventScroll: true });
});
window.addEventListener("beforeunload", (event) => { rememberWorkingRequest(); if (propertyDirty || requestDirty || landlordProfileDirty) event.preventDefault(); });
window.addEventListener("pagehide", () => { closeInvitationStream(); clearLandlordInvitationDeadlineTimer(); });
window.addEventListener("offline", updateNetworkStatus);
window.addEventListener("online", () => {
  updateNetworkStatus();
  if (!state.hidden && state.dataset.kind === "offline") loadWorkspace();
  else if (!workspace.hidden && bookings.some((booking) => booking.status === "pending-cleaner-acceptance")) void refreshBookingTransition();
});
document.querySelector("[data-year]").textContent = new Date().getFullYear();
initialiseRequestDefaults();
renderTaskPreview();
configureSpeech();
updateNetworkStatus();
loadWorkspace();
