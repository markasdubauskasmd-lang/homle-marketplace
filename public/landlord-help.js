import { supportCategoryLabels, supportRequestPage, supportRequestPayload, supportStatusLabels } from "./landlord-help-model.js";
import { createRequestJson } from "./request-json.js";
import { saveCsrf, storedCsrf } from "./session-csrf.js";

const requestJson = createRequestJson({ failureMessage: "The support request could not be completed." });
const gate = document.querySelector("[data-support-gate]");
const workspace = document.querySelector("[data-support-workspace]");
const privateNavigation = document.querySelector("[data-support-private-navigation]");
const form = document.querySelector("[data-support-form]");
const submit = document.querySelector("[data-support-submit]");
const feedback = document.querySelector("[data-support-form-feedback]");
const list = document.querySelector("[data-support-list]");
const empty = document.querySelector("[data-support-empty]");
let retryId = crypto.randomUUID();
let busy = false;

/**
 * Mints a CSRF token when this tab has none.
 *
 * This page was the only landlord surface that read storedCsrf() and gave up if
 * it was empty. The token lives in sessionStorage, which is per-tab, so opening
 * Help in a new tab — or from an email, or after the tab was restored — meant a
 * signed-in Landlord filled the whole form, pressed Send, and was told their
 * "secure editing token is missing" and to sign in again. They were already
 * signed in; nothing was wrong except that nobody had asked the server for a
 * token. The dashboard, checkout and journey all recover here instead.
 */
async function recoverCsrf() {
  const current = storedCsrf();
  if (current) return current;
  try {
    const result = await requestJson("/api/marketplace/auth/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!result.csrfToken || !saveCsrf(result.csrfToken)) throw new Error("The secure editing token could not be stored in this browser.");
    return result.csrfToken;
  } catch (error) {
    showFeedback(error.code === "browser-offline"
      ? "You are offline. No support request was sent; reconnect and try again."
      : "Your secure session could not be recovered. Sign in again before sending this request.");
    return "";
  }
}

function showGate(title, copy, { signIn = false, retry = false } = {}) {
  gate.hidden = false; workspace.hidden = true;
  privateNavigation.hidden = true;
  document.querySelector("[data-support-gate-title]").textContent = title;
  document.querySelector("[data-support-gate-copy]").textContent = copy;
  document.querySelector("[data-support-sign-in]").hidden = !signIn;
  document.querySelector("[data-support-retry]").hidden = !retry;
}

function showFeedback(message, kind = "error") {
  feedback.hidden = !message; feedback.textContent = message; feedback.dataset.kind = kind;
  if (message) feedback.focus();
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }).format(new Date(value));
}

function supportCard(record) {
  const card = document.createElement("article"); card.className = "support-request-card";
  const heading = document.createElement("div"); heading.className = "support-request-heading";
  const copy = document.createElement("div");
  const status = document.createElement("span"); status.className = `support-status support-status-${record.status}`; status.textContent = supportStatusLabels[record.status];
  const title = document.createElement("h3"); title.textContent = record.subject;
  const category = document.createElement("small"); category.textContent = `${supportCategoryLabels[record.category]} · ${formatDate(record.createdAt)}`;
  copy.append(status, title, category); heading.append(copy); card.append(heading);
  if (record.category === "booking-change") {
    const booking = document.createElement("div"); booking.className = "support-response";
    const label = document.createElement("strong"); label.textContent = record.bookingChangeKind === "reschedule" ? "Reschedule requested" : "Cancellation requested";
    const detail = document.createElement("p"); detail.textContent = record.bookingChangeKind === "reschedule" ? `Preferred start: ${formatDate(record.proposedStartAt)}` : "The confirmed booking remains in place until Homle responds.";
    booking.append(label, detail); card.append(booking);
  }
  const description = document.createElement("p"); description.textContent = record.description; card.append(description);
  if (record.resolutionSummary) {
    const response = document.createElement("div"); response.className = "support-response";
    const label = document.createElement("strong"); label.textContent = "Homle response";
    const answer = document.createElement("p"); answer.textContent = record.resolutionSummary;
    response.append(label, answer); card.append(response);
  }
  return card;
}

async function loadRequests() {
  list.setAttribute("aria-busy", "true");
  const result = supportRequestPage(await requestJson("/api/marketplace/landlord/support-requests?limit=25&offset=0"));
  list.replaceChildren(...result.supportRequests.map(supportCard));
  list.hidden = result.supportRequests.length === 0; empty.hidden = result.supportRequests.length > 0;
  list.setAttribute("aria-busy", "false");
}

function bookingLabel(booking) {
  const start = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }).format(new Date(booking.scheduledStartAt));
  return `${booking.cleaningType || "Cleaning"} · ${start}`;
}

async function loadConfirmedBookings() {
  const select = document.querySelector("[data-support-booking]");
  try {
    const result = await requestJson("/api/marketplace/bookings?limit=50");
    const now = Date.now();
    const confirmedBookings = (Array.isArray(result.bookings) ? result.bookings : []).filter((booking) => booking.status === "confirmed" && Date.parse(booking.scheduledStartAt) > now);
    select.disabled = false;
    select.replaceChildren(new Option(confirmedBookings.length ? "Choose a booking" : "No changeable confirmed bookings", ""), ...confirmedBookings.map((booking) => new Option(bookingLabel(booking), booking.bookingId)));
    const requested = new URLSearchParams(location.search).get("bookingId") || "";
    if (confirmedBookings.some((booking) => booking.bookingId === requested)) select.value = requested;
    return true;
  } catch {
    select.disabled = true;
    select.replaceChildren(new Option("Bookings could not be loaded", ""));
    return false;
  }
}

function syncSupportKind() {
  const bookingChange = form.elements.category.value === "booking-change";
  document.querySelector("[data-support-generic-fields]").hidden = bookingChange;
  document.querySelector("[data-support-booking-change]").hidden = !bookingChange;
  form.elements.subject.required = !bookingChange;
  form.elements.bookingId.required = bookingChange;
  form.elements.bookingChangeKind.required = bookingChange;
  const reschedule = bookingChange && form.elements.bookingChangeKind.value === "reschedule";
  document.querySelector("[data-support-proposed-time]").hidden = !reschedule;
  form.elements.proposedStartLocal.required = reschedule;
  void syncCancellationCost(bookingChange && form.elements.bookingChangeKind.value === "cancel");
}

/**
 * What cancelling the chosen booking would cost.
 *
 * Shown BEFORE the request is sent, because a fee a customer discovers
 * afterwards is the kind that produces a chargeback rather than an
 * understanding. Fetched per booking rather than stated once: the charge rises
 * as the visit approaches, and "25% if you cancel inside two days" is not an
 * answer to "what will this cost me now".
 *
 * Silent on failure. This is disclosure, not a gate — a customer who genuinely
 * needs to cancel must never be blocked because a quote endpoint was slow.
 */
let cancellationToken = 0;
async function syncCancellationCost(applies) {
  const host = document.querySelector("[data-support-cancellation]");
  if (!host) return;
  const bookingId = form.elements.bookingId.value;
  const generation = (cancellationToken += 1);
  if (!applies || !bookingId) { host.hidden = true; return; }

  host.hidden = false;
  document.querySelector("[data-support-cancellation-fee]").textContent = "Checking…";
  document.querySelector("[data-support-cancellation-band]").textContent = "";
  document.querySelector("[data-support-cancellation-detail]").textContent = "";

  try {
    const result = await requestJson(`/api/marketplace/bookings/${encodeURIComponent(bookingId)}/cancellation-quote`);
    if (generation !== cancellationToken) return;
    const fee = result.cancellation;
    document.querySelector("[data-support-cancellation-fee]").textContent = fee.chargeable
      ? formatMoney(fee.feePence)
      : "No charge";
    document.querySelector("[data-support-cancellation-band]").textContent = fee.chargeable ? `— ${fee.label.toLowerCase()}` : "";
    document.querySelector("[data-support-cancellation-detail]").textContent = fee.chargeable
      ? "Cancelling this close to the visit means the Cleaner has already turned down other work for it."
      : fee.explanation;
    const policy = document.querySelector("[data-support-cancellation-policy]");
    policy.replaceChildren(...(result.policy || []).map((row) => {
      const item = document.createElement("li");
      item.textContent = `${row.when}: ${row.charge}`;
      return item;
    }));
  } catch {
    if (generation !== cancellationToken) return;
    // Never a blocker. The request can still be sent; Homle confirms the
    // outcome in the account either way.
    host.hidden = true;
  }
}

function formatMoney(pence) {
  return pence % 100 === 0 ? `£${pence / 100}` : `£${(pence / 100).toFixed(2)}`;
}

async function load() {
  showGate("Checking secure Landlord access…", "Your support history opens only inside your Landlord account.");
  try {
    const account = (await requestJson("/api/marketplace/account")).account;
    if (!account?.roles?.includes("landlord")) return showGate("Landlord account required", "Use the Landlord workspace to ask about a property, room scan or booking preparation.", { signIn: true });
    gate.hidden = true; privateNavigation.hidden = false; workspace.hidden = false;
    await loadRequests();
    const bookingsAvailable = await loadConfirmedBookings();
    if (new URLSearchParams(location.search).has("bookingId")) {
      form.elements.category.value = "booking-change";
      if (!bookingsAvailable) showFeedback("Your support history is available, but confirmed bookings could not be loaded. Refresh before requesting a change.");
    }
    syncSupportKind();
  } catch (error) {
    if (error.statusCode === 401) showGate("Sign in to your Landlord account", "Your private support history is not available while signed out.", { signIn: true });
    else showGate("Support could not be opened", navigator.onLine ? "Try again. No request was sent." : "Reconnect to the internet, then try again.", { retry: true });
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault(); if (busy) return;
  busy = true; submit.disabled = true; submit.setAttribute("aria-busy", "true"); showFeedback("");
  let sent = false;
  try {
    const csrf = await recoverCsrf();
    if (!csrf) return;
    const values = Object.fromEntries(new FormData(form));
    values.confirmNoSensitiveData = form.elements.confirmNoSensitiveData.checked;
    values.proposedStartAt = values.proposedStartLocal || null;
    const payload = supportRequestPayload(values, retryId);
    await requestJson("/api/marketplace/landlord/support-requests", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify(payload) });
    sent = true; form.reset(); syncSupportKind(); retryId = crypto.randomUUID(); await loadRequests();
    showFeedback("Your request was sent securely. Its status now appears in your request history.", "success");
  } catch (error) {
    showFeedback(sent ? "Your request was sent, but the history could not refresh. Refresh before sending it again." : error.message);
  } finally {
    busy = false; submit.disabled = false; submit.removeAttribute("aria-busy");
  }
});

document.querySelector("[data-support-retry]").addEventListener("click", load);
document.querySelector("[data-support-refresh]").addEventListener("click", async () => { try { await loadRequests(); } catch (error) { showFeedback(error.message); } });
form.elements.category.addEventListener("change", syncSupportKind);
form.elements.bookingChangeKind.addEventListener("change", syncSupportKind);
// The fee depends on WHICH booking, so changing the booking re-asks.
form.elements.bookingId.addEventListener("change", syncSupportKind);
load();
