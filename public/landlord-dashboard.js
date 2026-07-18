import { checklistFromTranscript } from "./checklist.js";
import { clearSelectedCleaner, readSelectedCleaner } from "./account-intent.js";
import { isUkPostcode } from "./contact-validation.js";
import { clearLandlordRequestDraft, readLandlordRequestDraft, saveLandlordRequestDraft } from "./landlord-request-draft.js";
import { validatedRoomPhotoSelection } from "./room-photo-selection.js";
import { renderAccountAvatar } from "./account-avatar.js?v=20260717-1";
import { landlordDispatchAction, landlordStartFromSearch, moneyToPence, requestStatusLabel, requestTasksFromLines, requestedWindow, suggestedCleaningType, tasksToLines } from "./landlord-dashboard-model.js?v=20260717-6";
import { bookingSummaryBuckets, bookingSummaryPriceLabel, bookingSummaryStatusLabels, formatBookingMoment, formatBookingMoney, formatBookingWindow, landlordBookingNextAction, landlordDashboardSummary } from "./booking-summary-model.js?v=20260718-2";

const state = document.querySelector("[data-landlord-state]");
const stateTitle = document.querySelector("[data-landlord-state-title]");
const stateCopy = document.querySelector("[data-landlord-state-copy]");
const signIn = document.querySelector("[data-landlord-sign-in]");
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
const requestWithdrawDialog = document.querySelector("[data-request-withdraw-dialog]");
const requestWithdrawForm = document.querySelector("[data-request-withdraw-form]");
const requestWithdrawFeedback = document.querySelector("[data-request-withdraw-feedback]");
const requestWithdrawCancel = document.querySelector("[data-request-withdraw-cancel]");
const requestWithdrawConfirm = document.querySelector("[data-request-withdraw-confirm]");
const propertySave = document.querySelector("[data-save-property]");
const requestSave = document.querySelector("[data-save-request]");
const speechButton = document.querySelector("[data-speech-toggle]");
const speechStatus = document.querySelector("[data-speech-status]");
const speechFallback = document.querySelector("[data-speech-fallback]");
const taskPreview = document.querySelector("[data-task-preview]");
const taskReviewStatus = document.querySelector("[data-task-review-status]");
const cleaningTypeSelect = requestForm.elements.cleaningType;
const cleaningTypeHint = document.querySelector("[data-cleaning-type-hint]");
const nextTitle = document.querySelector("[data-landlord-next-title]");
const nextCopy = document.querySelector("[data-landlord-next-copy]");
const nextLink = document.querySelector("[data-landlord-next-link]");
const nextButton = document.querySelector("[data-landlord-next-button]");
const mediaReadiness = document.querySelector("[data-landlord-media-readiness]");
const networkStatus = document.querySelector("[data-landlord-network-status]");
const bookingLiveStatus = document.querySelector("[data-landlord-booking-live]");
const bookingRefresh = document.querySelector("[data-landlord-booking-refresh]");
let properties = [];
let requests = [];
let bookings = [];
let landlordProfile = null;
let recognition = null;
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
let requestRecoveryChecked = false;
let requestRecoveryTimer = null;
let invitationStream = null;
let invitationStreamKey = "";
let bookingTransitionRefresh = null;
const requestScans = new Map();
const uncertainDispatchRequests = new Set();
const bookingStart = landlordStartFromSearch(location.search) === "booking";
let selectedCleanerId = "";
try { if (bookingStart) selectedCleanerId = readSelectedCleaner(localStorage); } catch {}

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

function showState(title, copy, { kind = "info", allowSignIn = false, allowRetry = false } = {}) {
  state.dataset.kind = kind;
  state.hidden = false;
  stateTitle.textContent = title;
  stateCopy.textContent = copy;
  signIn.hidden = !allowSignIn;
  retry.hidden = !allowRetry;
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

function showRequestCompletion(submission, { automaticDispatch = false, selectedCleanerInvited = false, warning = "" } = {}) {
  const photos = Number(submission?.photoCount);
  const tasks = Number(submission?.taskCount);
  requestCompleteReference.textContent = submission?.cleaningRequestId || "Recorded privately";
  requestCompleteCounts.textContent = `${Number.isInteger(photos) ? photos : 0} room ${photos === 1 ? "photo" : "photos"} · ${Number.isInteger(tasks) ? tasks : 0} concise Cleaner ${tasks === 1 ? "task" : "tasks"}`;
  requestCompleteLead.textContent = warning
    ? "Your reviewed scan is submitted for matching. No booking or payment exists yet."
    : selectedCleanerInvited
    ? "Your reviewed scan is submitted and the selected Cleaner has been invited. This becomes a booking only if they accept."
    : automaticDispatch
    ? "Your reviewed scan is submitted and Homle is authorised to invite an eligible profitable match within your chosen attempt limit."
    : "Your reviewed scan is submitted for matching. No Cleaner has been invited automatically.";
  requestCompleteWarning.textContent = warning;
  requestCompleteWarning.hidden = !warning;
  state.hidden = true;
  workspace.hidden = true;
  requestComplete.hidden = false;
  history.replaceState(null, "", "/landlord/dashboard");
  requestComplete.focus();
}

function clearCleanerSelection() {
  try { clearSelectedCleaner(localStorage); } catch {}
  selectedCleanerId = "";
}

function selectWorkspaceTab(name) {
  document.querySelectorAll("[data-landlord-tab]").forEach((button) => {
    const active = button.dataset.landlordTab === name;
    button.classList.toggle("current", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll("[data-landlord-panel]").forEach((panel) => { panel.hidden = panel.dataset.landlordPanel !== name; });
}

function continueBookingStart() {
  if (!bookingStart) return;
  if (!properties.length) {
    openPropertyEditor();
    return;
  }
  selectWorkspaceTab("requests");
  if (properties.length === 1) propertySelect.value = properties[0].propertyId;
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
  requestForm.querySelector("[data-request-controls]").disabled = properties.length === 0;
  document.querySelector("[data-property-count]").textContent = String(properties.length);
  renderNextAction();
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
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
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
  const summary = element("summary", "", request.status === "draft" ? "Add room photos and submit" : "View reviewed room scan");
  details.append(summary);
  const panel = element("div", "landlord-request-scan-body");
  const intro = element("p", "landlord-request-scan-copy", request.status === "draft" ? (mediaReady ? "Choose the checklist room and take a current photo. Add a photo note only when the checklist needs extra visual context. Homle strips metadata and keeps the sanitized image private." : "Your spoken room checklist is saved. Private photo storage is not connected yet, so camera upload and matching submission remain safely locked.") : "This is the reviewed room-scan handoff attached to the request.");
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
    cameraButton.type = libraryButton.type = "button";
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
    const selected = element("span", "landlord-scan-selected", "No photos selected");
    let files = [];
    const upload = element("button", "button", "Upload private room photos");
    upload.type = "submit";
    function renderSelection() {
      if (!files.length) {
        selected.textContent = "No photos selected";
        upload.textContent = "Upload private room photos";
        return;
      }
      const totalBytes = files.reduce((sum, item) => sum + item.byteSize, 0);
      selected.textContent = files.length === 1 ? `${files[0].name} · ${humanFileSize(files[0].byteSize)}` : `${files.length} photos selected · ${humanFileSize(totalBytes)} total`;
      upload.textContent = `Upload ${files.length} private ${files.length === 1 ? "photo" : "photos"}`;
    }
    function choose(event) {
      const candidates = event.target.files;
      event.target.value = "";
      if (!candidates?.length) return;
      try {
        const existingPhotoCount = Array.isArray(requestScans.get(request.requestId)?.photos) ? requestScans.get(request.requestId).photos.length : 0;
        files = validatedRoomPhotoSelection(candidates, { existingPhotoCount });
        renderSelection();
        feedback.hidden = true;
      } catch (error) {
        files = [];
        renderSelection();
        showFeedback(feedback, error.message);
      }
    }
    cameraInput.addEventListener("change", choose);
    libraryInput.addEventListener("change", choose);
    cameraButton.addEventListener("click", () => cameraInput.click());
    libraryButton.addEventListener("click", () => libraryInput.click());
    pickerActions.append(cameraButton, libraryButton, cameraInput, libraryInput);
    for (const control of [room, note, cameraButton, libraryButton, cameraInput, libraryInput, upload]) control.disabled = !mediaReady;
    if (!mediaReady) selected.textContent = "Photo capture unlocks after secure storage is verified";
    form.append(roomLabel, noteLabel, pickerActions, selected, upload);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      feedback.hidden = true;
      if (!form.reportValidity()) return;
      if (!files.length) return showFeedback(feedback, "Take a current room photo or choose photos from this device.");
      const csrf = await recoverCsrf(feedback, "uploading this room photo");
      if (!csrf) return;
      const queuedCount = files.length;
      let uploadedCount = 0;
      setPending(upload, true, `Checking photo 1 of ${queuedCount}…`);
      try {
        while (files.length) {
          if (browserOffline()) throw Object.assign(new Error("You are offline. The remaining selected photos are still here; reconnect, then continue the upload."), { code: "browser-offline" });
          const candidate = files[0];
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
          const completed = await requestJson(`/api/marketplace/cleaning-requests/${encodeURIComponent(request.requestId)}/photos/${encodeURIComponent(signed.uploadId)}/complete`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: "{}" });
          requestScans.set(request.requestId, completed.scan);
          renderScanPhotos(request.requestId, completed.scan, list, count);
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
      finally { setPending(upload, false, files.length ? `Upload ${files.length} remaining ${files.length === 1 ? "photo" : "photos"}` : "Upload private room photos"); }
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
    autoLabel.append(auto, element("span", "", "After submission, automatically invite the best eligible profitable match. No booking exists until a Cleaner accepts."));
    const preferredLabel = element("label", "checkbox landlord-preferred-cleaner");
    const preferred = element("input");
    preferred.type = "checkbox";
    preferred.name = "selectedCleanerInvitation";
    preferred.checked = Boolean(selectedCleanerId);
    preferredLabel.append(preferred, element("span", "", "Invite the Cleaner I selected from the directory first. Homle will recheck the room scan, availability, service fit and profitable price before sending anything. If they cannot be invited, this request stays open for matching."));
    const attemptsLabel = element("label", "landlord-attempt-limit", "Maximum Cleaner invitations");
    const attempts = element("select");
    attempts.name = "attemptLimit";
    attempts.disabled = true;
    for (const value of [1, 2, 3, 4, 5]) { const option = element("option", "", String(value)); option.value = String(value); if (value === 3) option.selected = true; attempts.append(option); }
    attemptsLabel.append(attempts);
    auto.addEventListener("change", () => { attempts.disabled = !auto.checked; });
    const submit = element("button", "button", "Submit cleaning request");
    submit.type = "submit";
    for (const control of [confirm, preview, auto, preferred, attempts, submit]) control.disabled = !mediaReady || control === attempts;
    if (!mediaReady) submit.textContent = "Room photos required before submission";
    submitForm.append(confirmLabel, previewLabel, ...(selectedCleanerId ? [preferredLabel] : [autoLabel, attemptsLabel]), submit);
    submitForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      feedback.hidden = true;
      if (!submitForm.reportValidity()) return;
      if (!(requestScans.get(request.requestId)?.photos?.length > 0)) return showFeedback(feedback, "Upload and finish at least one current room photo before submission.");
      const csrf = await recoverCsrf(feedback, "submitting this cleaning request");
      if (!csrf) return;
      setPending(submit, true, "Submitting reviewed scan…");
      let submitted = false;
      let submission = null;
      let selectedCleanerInvited = false;
      try {
        const result = await requestJson(`/api/marketplace/cleaning-requests/${encodeURIComponent(request.requestId)}/submit`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ scopeReviewed: true, cleanerPreviewAuthorized: preview.checked }) });
        submission = result.submission;
        submitted = submission?.status === "searching-for-cleaner";
        if (!submitted) throw new Error("The submitted request could not be verified.");
        const index = requests.findIndex((item) => item.requestId === request.requestId);
        if (index >= 0) requests[index] = { ...requests[index], status: "searching-for-cleaner", submittedAt: submission.submittedAt, cleanerPreviewAuthorized: preview.checked };
        if (selectedCleanerId && preferred.checked) {
          await requestJson(`/api/marketplace/cleaning-requests/${encodeURIComponent(request.requestId)}/invitations`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ cleanerId: selectedCleanerId }) });
          selectedCleanerInvited = true;
          if (index >= 0) requests[index] = { ...requests[index], status: "cleaner-invited" };
        } else if (auto.checked) await requestJson(`/api/marketplace/cleaning-requests/${encodeURIComponent(request.requestId)}/automatic-dispatch`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ enabled: true, attemptLimit: Number(attempts.value) }) });
        clearCleanerSelection();
        renderRequests();
        showRequestCompletion(submission, { automaticDispatch: auto.checked, selectedCleanerInvited });
      } catch (error) {
        if (submitted) {
          const selectedInvitationFailed = Boolean(selectedCleanerId && preferred.checked);
          clearCleanerSelection();
          renderRequests();
          showRequestCompletion(submission, { warning: selectedInvitationFailed
            ? `The room scan is safely submitted, but the selected Cleaner could not be invited: ${error.message} The request remains open for matching and no booking or payment exists.`
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
  for (const request of requests) {
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
        dispatchPanel.append(element("strong", "", "Finding one eligible Cleaner"), element("p", "", `You authorised ${dispatchAction.attemptLimit === 1 ? "one Cleaner invitation" : `up to ${dispatchAction.attemptLimit} total invitations`}. Homle is checking service fit, exact availability and profitable pricing. No booking or charge exists until a Cleaner accepts and you authorise payment.`));
      } else if (dispatchAction.kind === "exhausted") {
        dispatchPanel.append(element("strong", "", "Matching needs review"), element("p", "", "Five Cleaner invitation attempts have been used. Homle will not contact anyone else automatically; review the timing or scope before deciding what to change."));
      } else {
        const firstAttempt = dispatchAction.kind === "authorize" && dispatchAction.attemptCount === 0;
        dispatchPanel.append(element("strong", "", firstAttempt ? "Ready to find your Cleaner?" : "Try one more eligible Cleaner?"), element("p", "", "This authorises exactly one additional invitation to the best eligible profitable match. It is not a booking, no payment is taken, and the Cleaner must still accept."));
        const authorize = element("button", "button", firstAttempt ? "Find my Cleaner" : "Try one more Cleaner");
        authorize.type = "button";
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
  requestEmpty.hidden = requests.length > 0;
  requestList.hidden = requests.length === 0;
  const draftCount = requests.filter((request) => request.status === "draft").length;
  document.querySelector("[data-draft-count]").textContent = String(draftCount);
  renderNextAction();
}

async function authorizeNextCleaner(requestId, attemptLimit, button, feedback) {
  feedback.hidden = true;
  const csrf = await recoverCsrf(feedback, "authorising Cleaner matching");
  if (!csrf) return;
  setPending(button, true, "Authorising…");
  try {
    const result = await requestJson(`/api/marketplace/cleaning-requests/${encodeURIComponent(requestId)}/automatic-dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ enabled: true, attemptLimit })
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
  if (booking.activeJobAvailable) {
    const link = element("a", "button", ["awaiting-review", "completed"].includes(booking.status) ? "View job record" : "Open live booking");
    link.href = `/bookings/${booking.bookingId}`;
    actions.append(link);
  }
  if (booking.paymentStepAvailable) {
    const payment = element("a", "button button-outline", "Authorize booking total");
    payment.href = `/booking-payment?bookingId=${encodeURIComponent(booking.bookingId)}`;
    actions.append(payment);
  }
  card.append(heading, facts);
  if (booking.paymentAuthorizationReady) card.append(element("p", "landlord-request-boundary", "Payment authorization is ready for this clean."));
  else if (booking.paymentStepOpensAt) card.append(element("p", "landlord-request-boundary", `Payment opens ${formatBookingMoment(booking.paymentStepOpensAt)}. No action is needed yet.`));
  if (actions.childElementCount) card.append(actions);
  return card;
}

function renderBookings() {
  const buckets = bookingSummaryBuckets(bookings, "landlord");
  const historySummary = landlordDashboardSummary(bookings);
  const current = [...buckets.active, ...buckets.upcoming];
  const list = document.querySelector("[data-landlord-booking-list]");
  list.replaceChildren(...current.map(renderBookingCard));
  list.hidden = current.length === 0;
  document.querySelector("[data-landlord-booking-empty]").hidden = current.length > 0;
  const historyList = document.querySelector("[data-landlord-history-list]");
  historyList.replaceChildren(...buckets.history.map(renderBookingCard));
  document.querySelector("[data-landlord-history-count]").textContent = String(buckets.history.length);
  document.querySelector("[data-landlord-history-section]").hidden = buckets.history.length === 0;
  document.querySelector("[data-landlord-active-count]").textContent = String(current.length);
  renderLandlordHistory(historySummary);
  renderNextAction();
  syncInvitationStream();
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
    const link = element("a", "text-button", "View latest clean");
    link.href = `/bookings/${cleaner.bookingId}`;
    card.append(identity, link);
    return card;
  }));
  list.hidden = summary.previousCleanerVisits.length === 0;
  document.querySelector("[data-landlord-previous-empty]").hidden = summary.previousCleanerVisits.length > 0;
}

function renderNextAction() {
  const bookingAction = landlordBookingNextAction(bookings);
  const booking = bookingAction.booking;
  nextLink.hidden = true;
  nextButton.hidden = true;
  delete nextButton.dataset.nextRequestId;
  if (bookingAction.kind === "active-job") {
    nextTitle.textContent = bookingAction.active ? "Open your live clean" : "View your confirmed clean";
    nextCopy.textContent = `${booking.propertyName || "Your property"} · ${formatBookingWindow(booking.scheduledStartAt, booking.scheduledEndAt)}`;
    nextLink.href = `/bookings/${booking.bookingId}`;
    nextLink.textContent = bookingAction.active ? "Open live progress" : "View booking";
    nextLink.hidden = false;
    return;
  }
  if (bookingAction.kind === "payment") {
    nextTitle.textContent = "Secure your confirmed booking";
    nextCopy.textContent = `${booking.propertyName || "Your property"} is ready for its booking-total authorization.`;
    nextLink.href = `/booking-payment?bookingId=${encodeURIComponent(booking.bookingId)}`;
    nextLink.textContent = "Authorize booking";
    nextLink.hidden = false;
    return;
  }
  if (bookingAction.kind === "payment-waiting") {
    nextTitle.textContent = "Payment opens closer to your clean";
    nextCopy.textContent = `You can authorize ${booking.propertyName || "your property"} from ${formatBookingMoment(booking.paymentStepOpensAt)}. No action is needed now.`;
    nextLink.href = `/bookings/${booking.bookingId}`;
    nextLink.textContent = "View confirmed booking";
    nextLink.hidden = false;
    return;
  }
  if (!properties.length) {
    nextTitle.textContent = "Add the property to clean";
    nextCopy.textContent = "Only the name and address are needed now. Extra property details can wait.";
    nextButton.textContent = "Add property";
    nextButton.dataset.nextAction = "property";
    nextButton.hidden = false;
    return;
  }
  const activeRequest = requests.find((request) => ["searching-for-cleaner", "cleaner-invited", "pending-cleaner-acceptance", "matched"].includes(request.status));
  if (activeRequest) {
    const waitingForCleaner = ["cleaner-invited", "pending-cleaner-acceptance"].includes(activeRequest.status);
    const dispatchAction = landlordDispatchAction(activeRequest);
    const needsAuthorization = ["authorize", "retry"].includes(dispatchAction.kind);
    nextTitle.textContent = needsAuthorization ? (dispatchAction.kind === "authorize" ? "Find your Cleaner" : "Try one more eligible Cleaner") : waitingForCleaner ? "A Cleaner is reviewing your request" : activeRequest.status === "matched" ? "Your Cleaner is matched" : "Homle is looking for your Cleaner";
    nextCopy.textContent = needsAuthorization ? "Authorize exactly one next invitation. Homle still rechecks availability, service fit and profitable pricing before anything is sent." : `${requestStatusLabel(activeRequest.status)} · Review the submitted rooms, tasks and current status in one place.`;
    nextButton.textContent = needsAuthorization ? (dispatchAction.kind === "authorize" ? "Find my Cleaner" : "Review next Cleaner attempt") : "View request status";
    nextButton.dataset.nextAction = needsAuthorization ? "dispatch" : "submitted";
    nextButton.dataset.nextRequestId = activeRequest.requestId;
    nextButton.hidden = false;
    return;
  }
  if (requests.some((request) => request.status === "draft")) {
    nextTitle.textContent = mediaReady ? "Finish your room scan" : "Review your spoken room checklist";
    nextCopy.textContent = mediaReady ? "Add room photos, check the spoken-note summary and submit the private request." : "Your draft is safe. Photo upload and matching will unlock only after private storage is verified.";
    nextButton.textContent = "Continue room scan";
    nextButton.dataset.nextAction = "draft";
    nextButton.hidden = false;
    return;
  }
  nextTitle.textContent = "Speak and scan your rooms";
  nextCopy.textContent = "Choose the property, say what needs cleaning, then review the concise checklist.";
  nextButton.textContent = "Start cleaning request";
  nextButton.dataset.nextAction = "request";
  nextButton.hidden = false;
}

async function loadWorkspace() {
  if (loading) return;
  loading = true;
  showState("Checking secure Landlord access…", "Your properties and drafts open only inside an authenticated Landlord session.");
  try {
    const [accountResult, profileResult, propertyResult, requestResult, bookingResult, healthResult] = await Promise.all([
      requestJson("/api/marketplace/account"),
      requestJson("/api/marketplace/landlord/profile"),
      requestJson("/api/marketplace/properties"),
      requestJson("/api/marketplace/cleaning-requests"),
      requestJson("/api/marketplace/bookings?limit=50"),
      requestJson("/api/health")
    ]);
    const account = accountResult.account;
    if (account?.selectedRole !== "landlord" || !account?.roles?.includes("landlord")) return showState("This is not a Landlord account.", "Use the workspace selected during onboarding or sign in with a Landlord/Property Manager account.", { kind: "authentication", allowSignIn: true });
    properties = Array.isArray(propertyResult.properties) ? propertyResult.properties : [];
    requests = Array.isArray(requestResult.cleaningRequests) ? requestResult.cleaningRequests : [];
    bookings = Array.isArray(bookingResult.bookings) ? bookingResult.bookings : [];
    landlordProfile = profileResult.profile || { organisationName: null, biography: "" };
    landlordProfileForm.elements.organisationName.value = landlordProfile.organisationName || "";
    landlordProfileForm.elements.biography.value = landlordProfile.biography || "";
    landlordProfileDirty = false;
    mediaReady = healthResult?.marketplace?.mediaReady === true;
    mediaReadiness.hidden = mediaReady;
    document.querySelector("[data-landlord-name]").textContent = account.displayName || "Landlord";
    renderAccountAvatar(account);
    renderProperties();
    restoreWorkingRequest();
    renderRequests();
    renderBookings();
    state.hidden = true;
    workspace.hidden = false;
    if (location.hash === "#landlord-account-title") selectWorkspaceTab("account");
    continueBookingStart();
  } catch (error) {
    if (error.code === "browser-offline") showState("You are offline.", "Your unfinished room walkthrough stays in this tab. Reconnect and Homle will safely reopen the private workspace; no change will be retried automatically.", { kind: "offline", allowRetry: true });
    else if (error.statusCode === 401) showState("Sign in as a Landlord to open this workspace.", "Your properties and request drafts are private to your verified account.", { kind: "authentication", allowSignIn: true });
    else if (error.statusCode === 403) showState("This account cannot open the Landlord workspace.", "Use a Landlord/Property Manager account selected during onboarding.", { kind: "authentication", allowSignIn: true });
    else if (error.statusCode === 404 || error.statusCode === 503) showState("Landlord accounts are not connected yet.", "The workspace is ready but remains closed until Homle's secure marketplace database and account runtime are activated.", { kind: "unavailable", allowRetry: true });
    else showState("The Landlord workspace is temporarily unavailable.", "No property or request was changed. Check the connection and try again.", { kind: "error", allowRetry: true });
  } finally {
    loading = false;
  }
}

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
    openRequestScan(result.cleaningRequest.requestId);
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

function summariseSpeech({ automatic = false } = {}) {
  const tasks = checklistFromTranscript(requestForm.elements.transcript.value);
  if (!tasks.length) return showFeedback(requestFeedback, "No cleaning tasks could be summarised. Name each room and describe the cleaning action clearly.");
  const value = tasks.join("\n");
  if (!automatic && requestForm.elements.tasks.value.trim() && !window.confirm("Replace the current room tasks with this new concise speech summary?")) return;
  invalidateScopeReview("The concise checklist changed. Review every room task again before saving.");
  requestForm.elements.tasks.value = value;
  renderTaskPreview();
  requestDirty = true;
  scheduleWorkingRequestRecovery();
  showFeedback(requestFeedback, `${tasks.length} concise room ${tasks.length === 1 ? "task" : "tasks"} prepared${automatic ? " automatically" : ""}. Review every bullet before confirming.`, "success");
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
  recognition.onerror = () => { listening = false; speechFailed = true; speechButton.textContent = "Start speaking"; speechStatus.textContent = "Speech capture stopped. Your existing transcript is still here; type or try again."; };
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
    }
    speechStatus.textContent = interimText ? `Listening: ${interimText.slice(0, 160)}` : "Listening…";
    requestDirty = true;
  };
  speechStatus.textContent = "Speech is available. Your browser may use its own speech-to-text service.";
}

document.querySelectorAll("[data-landlord-tab]").forEach((button) => button.addEventListener("click", () => { selectWorkspaceTab(button.dataset.landlordTab); }));
document.querySelector("[data-open-account-tab]").addEventListener("click", () => {
  selectWorkspaceTab("account");
  document.querySelector("[data-account-menu]").open = false;
  document.querySelector("[data-landlord-panel=\"account\"]").scrollIntoView({ behavior: "smooth", block: "start" });
});
document.querySelector("[data-open-request-tab]").addEventListener("click", () => {
  document.querySelector('[data-landlord-tab="requests"]').click();
  document.querySelector('[data-landlord-panel="requests"]').scrollIntoView({ behavior: "smooth", block: "start" });
});
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
requestForm.elements.transcript.addEventListener("input", () => { invalidateScopeReview("The walkthrough changed. Summarise again or manually reconcile every room task before confirming."); });
requestForm.elements.tasks.addEventListener("input", () => { renderTaskPreview(); invalidateScopeReview("The concise checklist changed. Review every room task again before saving."); });
nextButton.addEventListener("click", () => {
  const action = nextButton.dataset.nextAction;
  if (action === "property") {
    openPropertyEditor();
    return;
  }
  selectWorkspaceTab("requests");
  if (action === "submitted") {
    openRequestScan(nextButton.dataset.nextRequestId);
    return;
  }
  if (action === "dispatch") {
    const panel = [...document.querySelectorAll("[data-dispatch-request-id]")].find((candidate) => candidate.dataset.dispatchRequestId === nextButton.dataset.nextRequestId);
    panel?.scrollIntoView({ behavior: "smooth", block: "center" });
    panel?.querySelector("button")?.focus({ preventScroll: true });
    return;
  }
  if (action === "draft") {
    requestList.scrollIntoView({ behavior: "smooth", block: "start" });
    requestList.querySelector("details")?.setAttribute("open", "");
    return;
  }
  if (properties.length === 1) propertySelect.value = properties[0].propertyId;
  requestForm.scrollIntoView({ behavior: "smooth", block: "start" });
  (propertySelect.value ? requestForm.elements.requestedDate : propertySelect).focus({ preventScroll: true });
});
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
window.addEventListener("pagehide", closeInvitationStream);
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
