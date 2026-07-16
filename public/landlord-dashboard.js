import { checklistFromTranscript } from "./checklist.js";
import { isUkPostcode } from "./contact-validation.js";
import { landlordStartFromSearch, moneyToPence, requestStatusLabel, requestTasksFromLines, requestedWindow, tasksToLines } from "./landlord-dashboard-model.js?v=20260716-3";
import { bookingSummaryBuckets, bookingSummaryPriceLabel, bookingSummaryStatusLabels, formatBookingMoney, formatBookingWindow } from "./booking-summary-model.js";

const state = document.querySelector("[data-landlord-state]");
const stateTitle = document.querySelector("[data-landlord-state-title]");
const stateCopy = document.querySelector("[data-landlord-state-copy]");
const signIn = document.querySelector("[data-landlord-sign-in]");
const retry = document.querySelector("[data-landlord-retry]");
const workspace = document.querySelector("[data-landlord-workspace]");
const propertyForm = document.querySelector("[data-property-form]");
const requestForm = document.querySelector("[data-request-form]");
const propertyList = document.querySelector("[data-property-list]");
const propertyEmpty = document.querySelector("[data-property-empty]");
const requestList = document.querySelector("[data-request-list]");
const requestEmpty = document.querySelector("[data-request-empty]");
const propertySelect = document.querySelector("[data-property-select]");
const propertyFeedback = document.querySelector("[data-property-feedback]");
const requestFeedback = document.querySelector("[data-request-feedback]");
const propertySave = document.querySelector("[data-save-property]");
const requestSave = document.querySelector("[data-save-request]");
const speechButton = document.querySelector("[data-speech-toggle]");
const speechStatus = document.querySelector("[data-speech-status]");
let properties = [];
let requests = [];
let bookings = [];
let recognition = null;
let listening = false;
let dirty = false;
let loading = false;
const requestScans = new Map();
const bookingStart = landlordStartFromSearch(location.search) === "booking";

function storedCsrf() {
  try { return sessionStorage.getItem("tideway_csrf") || ""; } catch { return ""; }
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
    selectWorkspaceTab("properties");
    propertyForm.hidden = false;
    propertyForm.scrollIntoView({ behavior: "smooth", block: "start" });
    propertyForm.querySelector("input")?.focus({ preventScroll: true });
    return;
  }
  selectWorkspaceTab("requests");
  if (properties.length === 1) propertySelect.value = properties[0].propertyId;
  requestForm.scrollIntoView({ behavior: "smooth", block: "start" });
  (propertySelect.value ? requestForm.elements.requestedDate : propertySelect).focus({ preventScroll: true });
}

async function requestJson(path, options = {}) {
  const { headers = {}, ...rest } = options;
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...rest, headers: { Accept: "application/json", ...headers } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.error || result.message || "The account action could not be completed."), { statusCode: response.status, code: result.code });
  return result;
}

function exactAddress(property) {
  const address = property.exactAddress || {};
  return [address.addressLine1, address.addressLine2, address.locality, address.postcode].filter(Boolean).join(", ") || "Exact address unavailable";
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
    card.append(heading, facts, details);
    propertyList.append(card);
    const option = element("option", "", property.name || "Saved property");
    option.value = property.propertyId;
    propertySelect.append(option);
  }
  propertyEmpty.hidden = properties.length > 0;
  propertyList.hidden = properties.length === 0;
  requestForm.querySelector("[data-request-controls]").disabled = properties.length === 0;
  document.querySelector("[data-property-count]").textContent = String(properties.length);
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
    copy.append(element("strong", "", photo.roomName), element("span", "", photo.note), element("small", "", `${humanFileSize(photo.byteSize)} · metadata removed · private JPEG`));
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
  const intro = element("p", "landlord-request-scan-copy", request.status === "draft" ? "Choose the checklist room, add a clear note and take a current photo. Tideway strips metadata and keeps the sanitized image private." : "This is the reviewed room-scan handoff attached to the request.");
  const feedback = element("div", "landlord-form-feedback");
  feedback.hidden = true;
  feedback.tabIndex = -1;
  const count = element("strong", "landlord-scan-count", "Loading private room photos…");
  const list = element("ul", "landlord-scan-photo-list");
  list.hidden = true;
  panel.append(intro, count, list);
  let loaded = false;

  async function loadScan() {
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
    const noteLabel = element("label", "", "What this photo shows");
    const note = element("textarea");
    note.name = "note";
    note.rows = 3;
    note.maxLength = 1000;
    note.required = true;
    note.placeholder = "For example: Grease around the hob and splashback";
    noteLabel.append(note);
    const pickerActions = element("div", "landlord-scan-picker-actions");
    const cameraButton = element("button", "button", "Open rear camera");
    const libraryButton = element("button", "button button-outline", "Choose existing photo");
    cameraButton.type = libraryButton.type = "button";
    const cameraInput = element("input");
    cameraInput.type = "file";
    cameraInput.accept = "image/*";
    cameraInput.setAttribute("capture", "environment");
    cameraInput.hidden = true;
    const libraryInput = element("input");
    libraryInput.type = "file";
    libraryInput.accept = "image/jpeg,image/png,image/webp,image/heic,.heic,.heif";
    libraryInput.hidden = true;
    const selected = element("span", "landlord-scan-selected", "No photo selected");
    let file = null;
    function choose(event) {
      const candidate = event.target.files?.[0] || null;
      event.target.value = "";
      if (!candidate) return;
      if (!new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]).has(candidate.type) || candidate.size < 1 || candidate.size > 15_000_000) {
        file = null;
        return showFeedback(feedback, "Choose one JPEG, PNG, WebP or HEIC image up to 15 MB.");
      }
      file = candidate;
      selected.textContent = `${candidate.name || "Camera photo"} · ${humanFileSize(candidate.size)}`;
      feedback.hidden = true;
    }
    cameraInput.addEventListener("change", choose);
    libraryInput.addEventListener("change", choose);
    cameraButton.addEventListener("click", () => cameraInput.click());
    libraryButton.addEventListener("click", () => libraryInput.click());
    pickerActions.append(cameraButton, libraryButton, cameraInput, libraryInput);
    const upload = element("button", "button", "Upload private room photo");
    upload.type = "submit";
    form.append(roomLabel, noteLabel, pickerActions, selected, upload);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      feedback.hidden = true;
      if (!form.reportValidity()) return;
      if (!file) return showFeedback(feedback, "Take a current room photo or choose one from this device.");
      const csrf = storedCsrf();
      if (!csrf) return showFeedback(feedback, "Your secure editing token is missing. Sign in again before uploading.");
      setPending(upload, true, "Checking and uploading…");
      try {
        const checksumSha256 = await sha256(file);
        const intent = await requestJson(`/api/marketplace/cleaning-requests/${encodeURIComponent(request.requestId)}/photos/intents`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ roomName: room.value, note: note.value, mimeType: file.type, byteSize: file.size, checksumSha256 }) });
        const signed = intent.upload;
        if (signed?.method !== "PUT" || !signed.uploadId || !signed.uploadUrl || !signed.requiredHeaders || Object.keys(signed.requiredHeaders).length !== 4) throw new Error("The secure upload instructions were incomplete.");
        const destination = new URL(signed.uploadUrl);
        if (destination.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(destination.hostname)) throw new Error("The secure upload destination was unsafe.");
        checkedUploadResponse(await fetch(destination, { method: "PUT", headers: signed.requiredHeaders, body: file, credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer" }));
        const completed = await requestJson(`/api/marketplace/cleaning-requests/${encodeURIComponent(request.requestId)}/photos/${encodeURIComponent(signed.uploadId)}/complete`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: "{}" });
        requestScans.set(request.requestId, completed.scan);
        renderScanPhotos(request.requestId, completed.scan, list, count);
        file = null;
        selected.textContent = "No photo selected";
        note.value = "";
        loaded = true;
        showFeedback(feedback, "Private room photo checked, sanitized and attached.", "success");
      } catch (error) { showFeedback(feedback, error.message); }
      finally { setPending(upload, false, "Upload private room photo"); }
    });
    panel.append(form);

    const submitForm = element("form", "landlord-request-submit-form");
    const confirmLabel = element("label", "checkbox landlord-review-confirmation");
    const confirm = element("input");
    confirm.type = "checkbox";
    confirm.required = true;
    confirm.name = "scopeReviewed";
    confirmLabel.append(confirm, element("span", "", "I reviewed the concise Cleaner checklist and every attached room photo. This is the exact work I want Tideway to match and quote."));
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
    const attemptsLabel = element("label", "landlord-attempt-limit", "Maximum Cleaner invitations");
    const attempts = element("select");
    attempts.name = "attemptLimit";
    attempts.disabled = true;
    for (const value of [1, 2, 3, 4, 5]) { const option = element("option", "", String(value)); option.value = String(value); if (value === 3) option.selected = true; attempts.append(option); }
    attemptsLabel.append(attempts);
    auto.addEventListener("change", () => { attempts.disabled = !auto.checked; });
    const submit = element("button", "button", "Submit cleaning request");
    submit.type = "submit";
    submitForm.append(confirmLabel, previewLabel, autoLabel, attemptsLabel, submit);
    submitForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      feedback.hidden = true;
      if (!submitForm.reportValidity()) return;
      if (!(requestScans.get(request.requestId)?.photos?.length > 0)) return showFeedback(feedback, "Upload and finish at least one current room photo before submission.");
      const csrf = storedCsrf();
      if (!csrf) return showFeedback(feedback, "Your secure editing token is missing. Sign in again before submitting.");
      setPending(submit, true, "Submitting reviewed scan…");
      let submitted = false;
      try {
        const result = await requestJson(`/api/marketplace/cleaning-requests/${encodeURIComponent(request.requestId)}/submit`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ scopeReviewed: true, cleanerPreviewAuthorized: preview.checked }) });
        submitted = result.submission?.status === "searching-for-cleaner";
        if (!submitted) throw new Error("The submitted request could not be verified.");
        const index = requests.findIndex((item) => item.requestId === request.requestId);
        if (index >= 0) requests[index] = { ...requests[index], status: "searching-for-cleaner", submittedAt: result.submission.submittedAt, cleanerPreviewAuthorized: preview.checked };
        if (auto.checked) await requestJson(`/api/marketplace/cleaning-requests/${encodeURIComponent(request.requestId)}/automatic-dispatch`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify({ enabled: true, attemptLimit: Number(attempts.value) }) });
        renderRequests();
        showFeedback(requestFeedback, auto.checked ? "Room scan submitted and automatic matching authorized. No booking exists until an eligible Cleaner accepts." : "Room scan submitted for matching. No Cleaner has been invited automatically and no booking or payment exists.", "success");
      } catch (error) {
        showFeedback(requestFeedback, submitted ? `The room scan was submitted, but automatic matching was not enabled: ${error.message}` : error.message);
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
    const boundary = element("p", "landlord-request-boundary", request.status === "draft" ? "Private draft only — no Cleaner has been invited and no booking or payment exists." : "This request has entered the account workflow.");
    card.append(heading, facts, boundary, requestScanPanel(request));
    requestList.append(card);
  }
  requestEmpty.hidden = requests.length > 0;
  requestList.hidden = requests.length === 0;
  const draftCount = requests.filter((request) => request.status === "draft").length;
  document.querySelector("[data-draft-count]").textContent = String(draftCount);
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
  if (actions.childElementCount) card.append(actions);
  return card;
}

function renderBookings() {
  const buckets = bookingSummaryBuckets(bookings, "landlord");
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
}

async function loadWorkspace() {
  if (loading) return;
  loading = true;
  showState("Checking secure Landlord access…", "Your properties and drafts open only inside an authenticated Landlord session.");
  try {
    const [accountResult, propertyResult, requestResult, bookingResult] = await Promise.all([
      requestJson("/api/marketplace/account"),
      requestJson("/api/marketplace/properties"),
      requestJson("/api/marketplace/cleaning-requests"),
      requestJson("/api/marketplace/bookings?limit=50")
    ]);
    const account = accountResult.account;
    if (account?.selectedRole !== "landlord" || !account?.roles?.includes("landlord")) return showState("This is not a Landlord account.", "Use the workspace selected during onboarding or sign in with a Landlord/Property Manager account.", { kind: "authentication", allowSignIn: true });
    properties = Array.isArray(propertyResult.properties) ? propertyResult.properties : [];
    requests = Array.isArray(requestResult.cleaningRequests) ? requestResult.cleaningRequests : [];
    bookings = Array.isArray(bookingResult.bookings) ? bookingResult.bookings : [];
    document.querySelector("[data-landlord-name]").textContent = account.displayName || "Landlord";
    renderProperties();
    renderRequests();
    renderBookings();
    state.hidden = true;
    workspace.hidden = false;
    continueBookingStart();
  } catch (error) {
    if (error.statusCode === 401) showState("Sign in as a Landlord to open this workspace.", "Your properties and request drafts are private to your verified account.", { kind: "authentication", allowSignIn: true });
    else if (error.statusCode === 403) showState("This account cannot open the Landlord workspace.", "Use a Landlord/Property Manager account selected during onboarding.", { kind: "authentication", allowSignIn: true });
    else if (error.statusCode === 404 || error.statusCode === 503) showState("Landlord accounts are not connected yet.", "The workspace is ready but remains closed until Tideway's secure marketplace database and account runtime are activated.", { kind: "unavailable", allowRetry: true });
    else showState("The Landlord workspace is temporarily unavailable.", "No property or request was changed. Check the connection and try again.", { kind: "error", allowRetry: true });
  } finally {
    loading = false;
  }
}

function optionalNumber(value) {
  return String(value || "").trim() === "" ? null : Number(value);
}

async function createProperty(event) {
  event.preventDefault();
  propertyFeedback.hidden = true;
  if (!propertyForm.reportValidity()) return;
  const data = new FormData(propertyForm);
  const postcode = String(data.get("postcode") || "").trim();
  if (!isUkPostcode(postcode)) return showFeedback(propertyFeedback, "Enter a valid UK postcode.");
  let savedChecklist = [];
  try { if (String(data.get("savedChecklist") || "").trim()) savedChecklist = requestTasksFromLines(data.get("savedChecklist")); } catch (error) { return showFeedback(propertyFeedback, error.message); }
  const csrf = storedCsrf();
  if (!csrf) return showFeedback(propertyFeedback, "Your secure editing token is missing. Sign in again before saving.");
  const body = {
    name: String(data.get("name") || ""), propertyType: String(data.get("propertyType") || ""), addressLine1: String(data.get("addressLine1") || ""), addressLine2: String(data.get("addressLine2") || ""), locality: String(data.get("locality") || ""), postcode,
    bedrooms: optionalNumber(data.get("bedrooms")), bathrooms: optionalNumber(data.get("bathrooms")), approximateSizeSqM: optionalNumber(data.get("approximateSizeSqM")),
    accessInstructions: String(data.get("accessInstructions") || ""), parkingInstructions: String(data.get("parkingInstructions") || ""), cleaningPreferences: String(data.get("cleaningPreferences") || ""), savedChecklist, specialNotes: String(data.get("specialNotes") || "")
  };
  setPending(propertySave, true, "Saving…");
  try {
    const result = await requestJson("/api/marketplace/properties", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify(body) });
    properties.push(result.property);
    properties.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    renderProperties();
    propertyForm.reset();
    propertyForm.hidden = true;
    dirty = false;
    if (bookingStart) {
      selectWorkspaceTab("requests");
      propertySelect.value = result.property.propertyId;
      requestForm.scrollIntoView({ behavior: "smooth", block: "start" });
      requestForm.elements.requestedDate.focus({ preventScroll: true });
    }
  } catch (error) { showFeedback(propertyFeedback, error.statusCode === 401 || error.statusCode === 403 ? "Your secure session expired or cannot save this property. Sign in again." : error.message); }
  finally { setPending(propertySave, false, "Save property privately"); }
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
  const requiredServices = data.getAll("requiredServices").map(String);
  if (!requiredServices.includes(cleaningType)) return showFeedback(requestFeedback, "Select the primary cleaning type in Required services as well.");
  if (data.get("scopeReviewed") !== "on") return showFeedback(requestFeedback, "Review and confirm the concise room checklist before saving this draft.");
  const csrf = storedCsrf();
  if (!csrf) return showFeedback(requestFeedback, "Your secure editing token is missing. Sign in again before saving.");
  const body = { propertyId: String(data.get("propertyId") || ""), ...window, cleaningType, requiredServices, specialInstructions: String(data.get("specialInstructions") || ""), budgetPence, frequency: String(data.get("frequency") || "one-time"), tasks, submit: false };
  setPending(requestSave, true, "Saving draft…");
  try {
    const result = await requestJson("/api/marketplace/cleaning-requests", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify(body) });
    if (!result.cleaningRequest?.requestId) throw new Error("The saved cleaning-request draft could not be verified.");
    requests.unshift(result.cleaningRequest);
    renderRequests();
    requestForm.reset();
    initialiseRequestDefaults();
    showFeedback(requestFeedback, `Private draft ${result.cleaningRequest.requestId} saved. It was not sent for matching.`, "success");
    dirty = false;
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
}

function useSavedChecklist() {
  const property = properties.find((item) => item.propertyId === propertySelect.value);
  if (!property) return showFeedback(requestFeedback, "Choose a saved property first.");
  const value = tasksToLines(property.savedChecklist);
  if (!value) return showFeedback(requestFeedback, "This property has no reusable checklist. Add tasks from the current room walkthrough.");
  if (requestForm.elements.tasks.value.trim() && !window.confirm("Replace the current room tasks with this property's saved checklist?")) return;
  invalidateScopeReview("The checklist changed. Review every room task again before saving.");
  requestForm.elements.tasks.value = value;
  dirty = true;
  showFeedback(requestFeedback, "Saved checklist copied. Review every task against the current room scan before saving.", "success");
}

function summariseSpeech() {
  const tasks = checklistFromTranscript(requestForm.elements.transcript.value);
  if (!tasks.length) return showFeedback(requestFeedback, "No cleaning tasks could be summarised. Name each room and describe the cleaning action clearly.");
  const value = tasks.join("\n");
  if (requestForm.elements.tasks.value.trim() && !window.confirm("Replace the current room tasks with this new concise speech summary?")) return;
  invalidateScopeReview("The concise checklist changed. Review every room task again before saving.");
  requestForm.elements.tasks.value = value;
  dirty = true;
  showFeedback(requestFeedback, `${tasks.length} concise room ${tasks.length === 1 ? "task" : "tasks"} prepared. Review every bullet before confirming.`, "success");
}

function configureSpeech() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    speechButton.disabled = true;
    speechStatus.textContent = "Speech capture is not supported in this browser. Type the walkthrough instead.";
    return;
  }
  recognition = new Recognition();
  recognition.lang = "en-GB";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onstart = () => { listening = true; speechButton.textContent = "Stop speaking"; speechStatus.textContent = "Listening… Describe each room and the cleaning needed."; };
  recognition.onend = () => { listening = false; speechButton.textContent = "Start speaking"; speechStatus.textContent = "Speech stopped. Review the transcript, then summarise it."; };
  recognition.onerror = () => { listening = false; speechButton.textContent = "Start speaking"; speechStatus.textContent = "Speech capture stopped. Your existing transcript is still here; type or try again."; };
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
    }
    speechStatus.textContent = interimText ? `Listening: ${interimText.slice(0, 160)}` : "Listening…";
    dirty = true;
  };
  speechStatus.textContent = "Speech is available. Your browser may use its own speech-to-text service.";
}

document.querySelectorAll("[data-landlord-tab]").forEach((button) => button.addEventListener("click", () => { selectWorkspaceTab(button.dataset.landlordTab); }));
document.querySelector("[data-open-request-tab]").addEventListener("click", () => {
  document.querySelector('[data-landlord-tab="requests"]').click();
  document.querySelector('[data-landlord-panel="requests"]').scrollIntoView({ behavior: "smooth", block: "start" });
});
document.querySelector("[data-toggle-property-form]").addEventListener("click", () => { propertyForm.hidden = false; propertyForm.querySelector("input")?.focus(); });
document.querySelector("[data-close-property-form]").addEventListener("click", () => { if (!dirty || window.confirm("Close the property form and keep unsaved entries on this page?")) propertyForm.hidden = true; });
document.querySelector("[data-use-saved-checklist]").addEventListener("click", useSavedChecklist);
document.querySelector("[data-summarise-speech]").addEventListener("click", summariseSpeech);
speechButton.addEventListener("click", () => { if (!recognition) return; if (listening) recognition.stop(); else { try { recognition.start(); } catch { speechStatus.textContent = "Speech is already starting. Try again in a moment."; } } });
requestForm.elements.transcript.addEventListener("input", () => { invalidateScopeReview("The walkthrough changed. Summarise again or manually reconcile every room task before confirming."); });
requestForm.elements.tasks.addEventListener("input", () => { invalidateScopeReview("The concise checklist changed. Review every room task again before saving."); });
requestForm.elements.cleaningType.addEventListener("change", () => { const checkbox = [...requestForm.querySelectorAll('[name="requiredServices"]')].find((input) => input.value === requestForm.elements.cleaningType.value); if (checkbox) checkbox.checked = true; });
propertyForm.addEventListener("input", () => { dirty = true; });
requestForm.addEventListener("input", () => { dirty = true; });
propertyForm.addEventListener("submit", createProperty);
requestForm.addEventListener("submit", createRequestDraft);
retry.addEventListener("click", loadWorkspace);
window.addEventListener("beforeunload", (event) => { if (dirty) event.preventDefault(); });
document.querySelector("[data-year]").textContent = new Date().getFullYear();
initialiseRequestDefaults();
configureSpeech();
loadWorkspace();
