import { supportCategoryLabels, supportRequestPage, supportRequestPayload, supportStatusLabels } from "./landlord-help-model.js";
import { createRequestJson } from "./request-json.js";
import { storedCsrf } from "./session-csrf.js";

const requestJson = createRequestJson({ failureMessage: "The support request could not be completed." });
const gate = document.querySelector("[data-support-gate]");
const workspace = document.querySelector("[data-support-workspace]");
const form = document.querySelector("[data-support-form]");
const submit = document.querySelector("[data-support-submit]");
const feedback = document.querySelector("[data-support-form-feedback]");
const list = document.querySelector("[data-support-list]");
const empty = document.querySelector("[data-support-empty]");
let retryId = crypto.randomUUID();
let busy = false;

function showGate(title, copy, { signIn = false, retry = false } = {}) {
  gate.hidden = false; workspace.hidden = true;
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

async function load() {
  showGate("Checking secure Landlord access…", "Your support history opens only inside your Landlord account.");
  try {
    const account = (await requestJson("/api/marketplace/account")).account;
    if (!account?.roles?.includes("landlord")) return showGate("Landlord account required", "Use the Landlord workspace to ask about a property, room scan or booking preparation.", { signIn: true });
    gate.hidden = true; workspace.hidden = false; await loadRequests();
  } catch (error) {
    if (error.statusCode === 401) showGate("Sign in to your Landlord account", "Your private support history is not available while signed out.", { signIn: true });
    else showGate("Support could not be opened", navigator.onLine ? "Try again. No request was sent." : "Reconnect to the internet, then try again.", { retry: true });
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault(); if (busy) return;
  const csrf = storedCsrf();
  if (!csrf) return showFeedback("Your secure editing token is missing. Sign in again before sending this request.");
  busy = true; submit.disabled = true; submit.setAttribute("aria-busy", "true"); showFeedback("");
  let sent = false;
  try {
    const values = Object.fromEntries(new FormData(form));
    values.confirmNoSensitiveData = form.elements.confirmNoSensitiveData.checked;
    const payload = supportRequestPayload(values, retryId);
    await requestJson("/api/marketplace/landlord/support-requests", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify(payload) });
    sent = true; form.reset(); retryId = crypto.randomUUID(); await loadRequests();
    showFeedback("Your request was sent securely. Its status now appears in your request history.", "success");
  } catch (error) {
    showFeedback(sent ? "Your request was sent, but the history could not refresh. Refresh before sending it again." : error.message);
  } finally {
    busy = false; submit.disabled = false; submit.removeAttribute("aria-busy");
  }
});

document.querySelector("[data-support-retry]").addEventListener("click", load);
document.querySelector("[data-support-refresh]").addEventListener("click", async () => { try { await loadRequests(); } catch (error) { showFeedback(error.message); } });
load();
