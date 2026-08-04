import { supportCategoryLabels, supportQueueFilter, supportRequestPage, supportReviewPayload, supportStatusLabels } from "./admin-support-model.js";
import { createRequestJson } from "./request-json.js";
import { storedCsrf } from "./session-csrf.js";

const requestJson = createRequestJson({ failureMessage: "The Landlord support action could not be completed." });
const gate = document.querySelector("[data-admin-support-gate]");
const workspace = document.querySelector("[data-admin-support-workspace]");
const list = document.querySelector("[data-admin-support-list]");
const empty = document.querySelector("[data-admin-support-empty]");
const feedback = document.querySelector("[data-admin-support-feedback]");
const statusFilter = document.querySelector("[data-admin-support-status]");
const categoryFilter = document.querySelector("[data-admin-support-category]");
const dialog = document.querySelector("[data-admin-support-dialog]");
const form = document.querySelector("[data-admin-support-form]");
const dialogFeedback = document.querySelector("[data-admin-support-dialog-feedback]");
let selectedId = "";
let busy = false;

function showGate(title, copy, { signIn = false, retry = false } = {}) {
  gate.hidden = false; workspace.hidden = true;
  document.querySelector("[data-admin-support-gate-title]").textContent = title;
  document.querySelector("[data-admin-support-gate-copy]").textContent = copy;
  document.querySelector("[data-admin-support-sign-in]").hidden = !signIn;
  document.querySelector("[data-admin-support-retry]").hidden = !retry;
}
function showFeedback(target, message, kind = "error") { target.hidden = !message; target.textContent = message; target.dataset.kind = kind; if (message) target.focus?.(); }
function formatDate(value) { return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }).format(new Date(value)); }
function button(label, className, handler) { const result = document.createElement("button"); result.type = "button"; result.className = className; result.textContent = label; result.addEventListener("click", handler); return result; }

async function update(id, payload, control) {
  if (busy) return false;
  const csrf = storedCsrf(); if (!csrf) { showFeedback(feedback, "The secure editing token is missing. Sign in again."); return false; }
  busy = true; control.disabled = true;
  try {
    await requestJson(`/api/marketplace/admin/support-requests/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify(payload) });
    await loadQueue(); showFeedback(feedback, payload.status === "reviewing" ? "Review started." : "The private final response was recorded.", "success"); return true;
  } catch (error) { showFeedback(feedback, error.message); return false; }
  finally { busy = false; control.disabled = false; }
}

function openResolution(record) {
  selectedId = record.supportRequestId; form.reset(); showFeedback(dialogFeedback, "");
  document.querySelector("[data-admin-support-dialog-copy]").textContent = `Answer “${record.subject}”. The Landlord will see this inside their private Homle account.`;
  dialog.showModal(); form.elements.resolutionSummary.focus();
}

function requestCard(record) {
  const card = document.createElement("article"); card.className = "support-request-card";
  const status = document.createElement("span"); status.className = `support-status support-status-${record.status}`; status.textContent = supportStatusLabels[record.status];
  const title = document.createElement("h3"); title.textContent = record.subject;
  const meta = document.createElement("small"); meta.textContent = `${supportCategoryLabels[record.category]} · ${formatDate(record.createdAt)}`;
  const description = document.createElement("p"); description.textContent = record.description;
  card.append(status, title, meta, description);
  if (record.category === "booking-change") {
    const details = document.createElement("div"); details.className = "support-response";
    const reference = document.createElement("strong"); reference.className = "support-booking-reference"; reference.textContent = `Booking ${record.bookingId.slice(0, 8).toUpperCase()}`;
    const requested = document.createElement("p"); requested.textContent = record.bookingChangeKind === "reschedule" ? `Requested reschedule: ${formatDate(record.proposedStartAt)}` : "Cancellation requested. The confirmed booking is still unchanged.";
    details.append(reference, requested); card.append(details);
  }
  if (record.resolutionSummary) { const answer = document.createElement("div"); answer.className = "support-response"; const strong = document.createElement("strong"); strong.textContent = "Recorded response"; const copy = document.createElement("p"); copy.textContent = record.resolutionSummary; answer.append(strong, copy); card.append(answer); }
  if (record.status === "open") card.append(button("Start review", "button button-outline", (event) => update(record.supportRequestId, { status: "reviewing" }, event.currentTarget)));
  if (record.status !== "resolved") card.append(button("Record final response", "button", () => openResolution(record)));
  return card;
}

async function loadQueue() {
  const filters = supportQueueFilter({ status: statusFilter.value, category: categoryFilter.value });
  const query = new URLSearchParams({ limit: "50", offset: "0" }); if (filters.status) query.set("status", filters.status); if (filters.category) query.set("category", filters.category);
  list.setAttribute("aria-busy", "true");
  const result = supportRequestPage(await requestJson(`/api/marketplace/admin/support-requests?${query}`));
  list.replaceChildren(...result.supportRequests.map(requestCard)); list.hidden = result.supportRequests.length === 0; empty.hidden = result.supportRequests.length > 0; list.setAttribute("aria-busy", "false");
}

async function load() {
  showGate("Checking secure Administrator access…", "Landlord support messages are private.");
  try {
    const account = (await requestJson("/api/marketplace/account")).account;
    if (!account?.roles?.includes("administrator")) return showGate("Administrator account required", "This account cannot read or answer Landlord support requests.", { signIn: true });
    gate.hidden = true; workspace.hidden = false; await loadQueue();
  } catch (error) {
    if ([401, 403].includes(error.statusCode)) showGate("Sign in as a Homle Administrator", "Landlord support messages are unavailable to unrelated accounts.", { signIn: true });
    else showGate("Support queue could not be opened", "Try again. No request was changed.", { retry: true });
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault(); if (busy) return;
  try {
    const values = Object.fromEntries(new FormData(form)); values.privacyConfirmed = form.elements.privacyConfirmed.checked; values.noExternalActionConfirmed = form.elements.noExternalActionConfirmed.checked; values.status = "resolved";
    const payload = supportReviewPayload(values);
    if (await update(selectedId, payload, document.querySelector("[data-admin-support-resolve]"))) dialog.close();
  } catch (error) { showFeedback(dialogFeedback, error.message); }
});
document.querySelector("[data-admin-support-cancel]").addEventListener("click", () => dialog.close());
document.querySelector("[data-admin-support-retry]").addEventListener("click", load);
document.querySelector("[data-admin-support-refresh]").addEventListener("click", async () => { try { await loadQueue(); showFeedback(feedback, "Support queue refreshed.", "success"); } catch (error) { showFeedback(feedback, error.message); } });
statusFilter.addEventListener("change", () => loadQueue().catch((error) => showFeedback(feedback, error.message)));
categoryFilter.addEventListener("change", () => loadQueue().catch((error) => showFeedback(feedback, error.message)));
load();
