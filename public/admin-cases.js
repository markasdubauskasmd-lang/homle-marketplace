import { adminCaseFilter, adminCaseQueue, adminCaseResolutionPayload, adminCaseReviewPayload, caseCategoryLabel, casePolicyForCategory, caseStatusLabel, shortBookingReference } from "./admin-cases-model.js";

const pageSize = 50;
const gate = document.querySelector("[data-admin-cases-gate]");
const workspace = document.querySelector("[data-admin-cases-workspace]");
const list = document.querySelector("[data-admin-cases-list]");
const empty = document.querySelector("[data-admin-cases-empty]");
const feedback = document.querySelector("[data-admin-cases-feedback]");
const filter = document.querySelector("[data-admin-cases-filter]");
const previous = document.querySelector("[data-admin-cases-previous]");
const next = document.querySelector("[data-admin-cases-next]");
const dialog = document.querySelector("[data-admin-case-dialog]");
const dialogForm = document.querySelector("[data-admin-case-form]");
const dialogFeedback = document.querySelector("[data-admin-case-dialog-feedback]");
const dialogSubmit = document.querySelector("[data-admin-case-submit]");
const dialogCancel = document.querySelector("[data-admin-case-cancel]");
let queue = { disputes: [], limit: pageSize, offset: 0 };
let selectedDisputeId = "";
let loading = false;
let updating = false;
let queueLoading = false;

document.querySelector("[data-year]").textContent = String(new Date().getFullYear());

function element(name, className, text) {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function storedCsrf() {
  try { return sessionStorage.getItem("tideway_csrf") || ""; } catch { return ""; }
}

function showGate(title, copy, { kind = "info", allowSignIn = false, allowRetry = false } = {}) {
  gate.hidden = false;
  gate.dataset.kind = kind;
  document.querySelector("[data-admin-cases-gate-title]").textContent = title;
  document.querySelector("[data-admin-cases-gate-copy]").textContent = copy;
  document.querySelector("[data-admin-cases-sign-in]").hidden = !allowSignIn;
  document.querySelector("[data-admin-cases-retry]").hidden = !allowRetry;
  workspace.hidden = true;
}

function showFeedback(target, message, kind = "info") {
  target.hidden = !message;
  target.dataset.kind = kind;
  target.textContent = message;
  if (message) target.focus?.();
}

async function requestJson(path, options = {}) {
  const { headers = {}, ...rest } = options;
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...rest, headers: { Accept: "application/json", ...headers } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok !== true) throw Object.assign(new Error(result.error || "The booking-case action could not be completed."), { statusCode: response.status, code: result.code || "" });
  return result;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function fact(label, value) {
  const wrapper = element("div");
  wrapper.append(element("dt", "", label), element("dd", "", value));
  return wrapper;
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  if (busy) button.setAttribute("aria-busy", "true"); else button.removeAttribute("aria-busy");
  if (label) button.textContent = label;
}

async function updateCase(disputeId, payload, button) {
  if (updating) return;
  const csrf = storedCsrf();
  if (!csrf) return showFeedback(feedback, "Your secure editing token is missing. Sign in again before changing a case.", "error");
  updating = true;
  const original = button?.textContent || "";
  if (button) setBusy(button, true, "Saving…");
  showFeedback(feedback, "");
  let saved = false;
  try {
    await requestJson(`/api/marketplace/admin/disputes/${encodeURIComponent(disputeId)}`, { method: "PATCH", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify(payload) });
    saved = true;
    await loadQueue(queue.offset);
    showFeedback(feedback, payload.status === "reviewing" ? "The case is now under review." : "The audited resolution was recorded. No payment action was taken.", "success");
  } catch (error) {
    showFeedback(feedback, saved ? "The decision was recorded, but the queue could not refresh. Refresh before taking another action." : error.statusCode === 409 ? "This case changed in another session. Refresh and review the latest status." : error.message, saved ? "success" : "error");
    if (saved) return;
    throw error;
  } finally {
    updating = false;
    if (button) setBusy(button, false, original);
  }
}

function openResolution(record) {
  selectedDisputeId = record.disputeId;
  dialogForm.reset();
  showFeedback(dialogFeedback, "");
  const policy = casePolicyForCategory(record.category);
  document.querySelector("[data-admin-case-dialog-copy]").textContent = `Resolve ${shortBookingReference(record.bookingId)} only after reviewing the available evidence. This decision changes the recorded booking outcome, not money.`;
  document.querySelector("[data-admin-case-priority]").textContent = policy.priority;
  document.querySelector("[data-admin-case-policy-title]").textContent = `${caseCategoryLabel(record.category)} review`;
  document.querySelector("[data-admin-case-policy-summary]").textContent = policy.summary;
  document.querySelector("[data-admin-case-policy-evidence]").replaceChildren(...policy.evidence.map((item) => element("li", "", item)));
  document.querySelector("[data-admin-case-policy-boundary]").textContent = policy.boundary;
  dialog.showModal();
  dialogForm.elements.resolutionOutcome.focus();
}

function caseCard(record) {
  const card = element("article", "admin-case-card");
  const heading = element("div", "admin-case-card-heading");
  const title = element("div");
  const status = element("span", `booking-status-pill admin-case-status admin-case-status-${record.status}`, caseStatusLabel(record.status));
  title.append(status, element("h3", "", shortBookingReference(record.bookingId)), element("p", "", `${caseCategoryLabel(record.category)} case opened by the ${record.openedByRole === "cleaner" ? "Cleaner" : "Landlord"}`));
  heading.append(title, element("time", "", formatDate(record.createdAt)));
  const description = element("p", "admin-case-description", record.description);
  const facts = element("dl", "admin-case-facts");
  facts.append(fact("Category", caseCategoryLabel(record.category)), fact("Opened", formatDate(record.createdAt)), fact("Participant", record.openedByRole === "cleaner" ? "Cleaner" : "Landlord"));
  card.append(heading, description, facts);

  if (record.resolutionNote) {
    const resolution = element("div", "admin-case-resolution");
    resolution.append(element("strong", "", record.resolutionOutcome === "cancelled" ? "Resolved — booking cancelled" : "Resolved — booking completed"), element("p", "", record.resolutionNote));
    if (record.resolvedAt) resolution.append(element("small", "", `Recorded ${formatDate(record.resolvedAt)}`));
    card.append(resolution);
  }

  if (["open", "reviewing"].includes(record.status)) {
    const actions = element("div", "booking-summary-actions");
    if (record.status === "open") {
      const review = element("button", "button button-outline", "Start review");
      review.type = "button";
      review.addEventListener("click", async () => { try { await updateCase(record.disputeId, adminCaseReviewPayload(), review); } catch {} });
      actions.append(review);
    }
    const resolve = element("button", "button", "Resolve case");
    resolve.type = "button";
    resolve.addEventListener("click", () => openResolution(record));
    actions.append(resolve);
    card.append(actions);
  }
  return card;
}

function renderQueue() {
  list.replaceChildren(...queue.disputes.map(caseCard));
  list.hidden = queue.disputes.length === 0;
  empty.hidden = queue.disputes.length > 0;
  list.setAttribute("aria-busy", "false");
  document.querySelector("[data-admin-cases-count]").textContent = String(queue.disputes.length);
  document.querySelector("[data-admin-cases-open-count]").textContent = String(queue.disputes.filter((item) => item.status === "open").length);
  document.querySelector("[data-admin-cases-reviewing-count]").textContent = String(queue.disputes.filter((item) => item.status === "reviewing").length);
  document.querySelector("[data-admin-cases-page]").textContent = `Page ${Math.floor(queue.offset / queue.limit) + 1}`;
  previous.disabled = queue.offset === 0;
  next.disabled = queue.disputes.length < queue.limit;
}

async function loadQueue(offset = 0) {
  if (queueLoading) return;
  queueLoading = true;
  previous.disabled = true;
  next.disabled = true;
  list.setAttribute("aria-busy", "true");
  try {
    const status = adminCaseFilter(filter.value);
    const query = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
    if (status) query.set("status", status);
    const result = await requestJson(`/api/marketplace/admin/disputes?${query}`);
    queue = adminCaseQueue(result);
    renderQueue();
  } finally {
    queueLoading = false;
    previous.disabled = queue.offset === 0;
    next.disabled = queue.disputes.length < queue.limit;
  }
}

async function load() {
  if (loading) return;
  loading = true;
  showGate("Checking secure Administrator access…", "Booking cases open only inside an authenticated Tideway Administrator account.");
  try {
    const account = (await requestJson("/api/marketplace/account")).account;
    if (!account?.roles?.includes("administrator")) return showGate("Administrator account required", "Landlord, Cleaner and unrelated accounts cannot view or change booking cases.", { kind: "authentication", allowSignIn: true });
    gate.hidden = true;
    workspace.hidden = false;
    await loadQueue(0);
  } catch (error) {
    if (error.statusCode === 401) showGate("Sign in as a Tideway Administrator", "Booking cases contain private participant reports and are not available without an authenticated Administrator account.", { kind: "authentication", allowSignIn: true });
    else if (error.statusCode === 403) showGate("Administrator account required", "This account is not authorised to view or change booking cases.", { kind: "authentication", allowSignIn: true });
    else if ([404, 503].includes(error.statusCode)) showGate("Secure marketplace administration is not connected yet", "The case screen is ready, but it remains closed until Tideway’s protected database and account runtime pass staging.", { kind: "unavailable", allowRetry: true });
    else showGate("Booking cases could not be opened", navigator.onLine ? "Try again. No case was changed." : "Reconnect to the internet, then try again. No case was changed.", { kind: "error", allowRetry: true });
  } finally { loading = false; }
}

document.querySelector("[data-admin-cases-retry]").addEventListener("click", load);
document.querySelector("[data-admin-cases-refresh]").addEventListener("click", async () => {
  if (loading) return;
  loading = true;
  try { await loadQueue(queue.offset); showFeedback(feedback, "Case queue refreshed.", "success"); }
  catch (error) { showFeedback(feedback, error.message, "error"); }
  finally { loading = false; }
});
filter.addEventListener("change", async () => { try { await loadQueue(0); } catch (error) { showFeedback(feedback, error.message, "error"); } });
previous.addEventListener("click", async () => { try { await loadQueue(Math.max(0, queue.offset - queue.limit)); } catch (error) { showFeedback(feedback, error.message, "error"); } });
next.addEventListener("click", async () => { try { await loadQueue(queue.offset + queue.limit); } catch (error) { showFeedback(feedback, error.message, "error"); } });
dialogCancel.addEventListener("click", () => dialog.close());
dialog.addEventListener("cancel", (event) => { if (updating) event.preventDefault(); });
dialogForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (updating) return;
  try {
    const data = new FormData(dialogForm);
    const payload = adminCaseResolutionPayload({
      resolutionOutcome: data.get("resolutionOutcome"),
      resolutionNote: data.get("resolutionNote"),
      confirmed: data.get("confirmed") === "on",
      policyVersion: data.get("policyVersion"),
      evidenceReviewed: data.get("evidenceReviewed") === "on",
      sensitiveDataMinimised: data.get("sensitiveDataMinimised") === "on",
      noExternalActionConfirmed: data.get("noExternalActionConfirmed") === "on"
    });
    dialogSubmit.disabled = dialogCancel.disabled = true;
    dialogSubmit.textContent = "Recording…";
    await updateCase(selectedDisputeId, payload, null);
    dialog.close();
  } catch (error) { showFeedback(dialogFeedback, error.message, "error"); }
  finally { dialogSubmit.disabled = dialogCancel.disabled = false; dialogSubmit.textContent = "Record resolution"; }
});

function updateNetworkState() {
  document.querySelector("[data-network-status]").hidden = navigator.onLine;
}
window.addEventListener("online", () => { updateNetworkState(); if (!workspace.hidden) loadQueue(queue.offset).catch(() => {}); });
window.addEventListener("offline", updateNetworkState);
updateNetworkState();
load();
