import { checklistFromTranscript } from "./checklist.js";
import { isUkPostcode } from "./contact-validation.js";
import { moneyToPence, requestStatusLabel, requestTasksFromLines, requestedWindow, tasksToLines } from "./landlord-dashboard-model.js";
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
    card.append(heading, facts, boundary);
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
    showFeedback(requestFeedback, `Private draft ${result.request.requestId} saved. It was not sent for matching.`, "success");
    dirty = false;
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
  requestForm.elements.tasks.value = value;
  dirty = true;
  showFeedback(requestFeedback, "Saved checklist copied. Review every task against the current room scan before saving.", "success");
}

function summariseSpeech() {
  const tasks = checklistFromTranscript(requestForm.elements.transcript.value);
  if (!tasks.length) return showFeedback(requestFeedback, "No cleaning tasks could be summarised. Name each room and describe the cleaning action clearly.");
  const value = tasks.join("\n");
  if (requestForm.elements.tasks.value.trim() && !window.confirm("Replace the current room tasks with this new concise speech summary?")) return;
  requestForm.elements.tasks.value = value;
  requestForm.elements.scopeReviewed.checked = false;
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
    if (finalText) requestForm.elements.transcript.value = `${requestForm.elements.transcript.value.trim()} ${finalText}`.trim().slice(0, 5000);
    speechStatus.textContent = interimText ? `Listening: ${interimText.slice(0, 160)}` : "Listening…";
    dirty = true;
  };
  speechStatus.textContent = "Speech is available. Your browser may use its own speech-to-text service.";
}

document.querySelectorAll("[data-landlord-tab]").forEach((button) => button.addEventListener("click", () => {
  const name = button.dataset.landlordTab;
  document.querySelectorAll("[data-landlord-tab]").forEach((item) => { const active = item === button; item.classList.toggle("current", active); item.setAttribute("aria-selected", String(active)); });
  document.querySelectorAll("[data-landlord-panel]").forEach((panel) => { panel.hidden = panel.dataset.landlordPanel !== name; });
}));
document.querySelector("[data-toggle-property-form]").addEventListener("click", () => { propertyForm.hidden = false; propertyForm.querySelector("input")?.focus(); });
document.querySelector("[data-close-property-form]").addEventListener("click", () => { if (!dirty || window.confirm("Close the property form and keep unsaved entries on this page?")) propertyForm.hidden = true; });
document.querySelector("[data-use-saved-checklist]").addEventListener("click", useSavedChecklist);
document.querySelector("[data-summarise-speech]").addEventListener("click", summariseSpeech);
speechButton.addEventListener("click", () => { if (!recognition) return; if (listening) recognition.stop(); else { try { recognition.start(); } catch { speechStatus.textContent = "Speech is already starting. Try again in a moment."; } } });
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
