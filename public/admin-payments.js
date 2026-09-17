import { adminPaymentBookingFilter, adminPaymentFilter, adminPaymentQueue, paymentActionLabel, paymentActionPayload, paymentDisputeHeld, paymentDisputeStatusLabel, paymentRecoveryHeld, paymentRecoveryReasonLabel, paymentNextAction, paymentStatusLabel, shortPaymentBookingReference, shortPaymentReference } from "./admin-payments-model.js";
import { storedCsrf } from "./session-csrf.js";

const pageSize = 50;
const gate = document.querySelector("[data-admin-payments-gate]");
const workspace = document.querySelector("[data-admin-payments-workspace]");
const list = document.querySelector("[data-admin-payments-list]");
const empty = document.querySelector("[data-admin-payments-empty]");
const feedback = document.querySelector("[data-admin-payments-feedback]");
const filter = document.querySelector("[data-admin-payments-filter]");
const previous = document.querySelector("[data-admin-payments-previous]");
const next = document.querySelector("[data-admin-payments-next]");
const dialog = document.querySelector("[data-admin-payment-dialog]");
const form = document.querySelector("[data-admin-payment-form]");
const submit = document.querySelector("[data-admin-payment-submit]");
const cancel = document.querySelector("[data-admin-payment-cancel]");
const refundField = document.querySelector("[data-admin-payment-refund-field]");
const dialogFeedback = document.querySelector("[data-admin-payment-dialog-feedback]");
const related = document.querySelector("[data-admin-payment-related]");
const queueControls = document.querySelector("[data-admin-payments-queue-controls]");
const pagination = document.querySelector("[data-admin-payments-pagination]");
const uncertainPayments = new Set();
const recoveringCommands = new Set();
let queueRevision = 0;
let queue = { payments: [], limit: pageSize, offset: 0, testMode: false };
let selected = null;
let selectedKind = "";
let loading = false;
let commanding = false;
let selectedBookingId = null;
let bookingLinkError = null;

try { selectedBookingId = adminPaymentBookingFilter(new URLSearchParams(location.search).get("bookingId")); }
catch (error) { bookingLinkError = error; }

if (selectedBookingId) {
  related.hidden = false;
  related.querySelector("[data-admin-payment-related-reference]").textContent = shortPaymentBookingReference(selectedBookingId);
  queueControls.hidden = true;
  pagination.hidden = true;
  document.querySelector("#admin-payments-heading").textContent = "Related payment status";
  document.querySelector("[data-admin-payments-empty] strong").textContent = "No payment record for this booking";
  document.querySelector("[data-admin-payments-empty] p").textContent = "Return to the booking case. No payment action is available from this link.";
}

document.querySelector("[data-year]").textContent = String(new Date().getFullYear());

function element(name, className, text) {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function showFeedback(target, message, kind = "info") {
  target.hidden = !message;
  target.dataset.kind = kind;
  target.textContent = message;
  if (message) target.focus?.();
}

function showGate(title, copy, { kind = "info", signIn = false, retry = false } = {}) {
  gate.hidden = false;
  gate.dataset.kind = kind;
  document.querySelector("[data-admin-payments-gate-title]").textContent = title;
  document.querySelector("[data-admin-payments-gate-copy]").textContent = copy;
  document.querySelector("[data-admin-payments-sign-in]").hidden = !signIn;
  document.querySelector("[data-admin-payments-retry]").hidden = !retry;
  workspace.hidden = true;
}


function saveCsrf(value) {
  if (typeof value !== "string" || value.length < 20 || value.length > 512) return false;
  try { sessionStorage.setItem("tideway_csrf", value); return true; } catch { return false; }
}

async function requestJson(path, options = {}) {
  const mutation = options.method && options.method !== "GET";
  if (!navigator.onLine) throw Object.assign(new Error("You are offline. No payment action was sent."), { code: "offline" });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), mutation ? 60_000 : 30_000);
  try {
    const { headers = {}, ...rest } = options;
    const response = await fetch(path, { credentials: "same-origin", cache: "no-store", signal: controller.signal, ...rest, headers: { Accept: "application/json", ...headers } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok !== true) throw Object.assign(new Error(result.error || "The payment operation could not be completed."), { statusCode: response.status, code: result.code || "" });
    return result;
  } catch (error) {
    if (error?.name === "AbortError") throw Object.assign(new Error(mutation ? "The provider action did not return in time. It may have reached Homle; refresh the signed status before doing anything else." : "The payment queue took too long to load. Try refreshing it."), { code: mutation ? "uncertain-payment-action" : "request-timeout", uncertain: mutation });
    if (mutation && !error.statusCode && error.code !== "offline") error.uncertain = true;
    throw error;
  } finally { clearTimeout(timeout); }
}

async function recoverCsrf() {
  if (storedCsrf()) return storedCsrf();
  const result = await requestJson("/api/marketplace/auth/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  if (!saveCsrf(result.csrfToken)) throw new Error("Secure Administrator editing access could not be restored. Sign in again.");
  return result.csrfToken;
}

function money(pence) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(pence / 100);
}

function date(value) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }).format(new Date(value));
}

function fact(label, value) {
  const wrapper = element("div");
  wrapper.append(element("dt", "", label), element("dd", "", value));
  return wrapper;
}

function retryStorageKey(record, kind, amountPence = 0) {
  return `homle_admin_payment_retry:${record.paymentId}:${kind}:${amountPence}`;
}

function retryKey(record, kind, amountPence = 0) {
  const key = retryStorageKey(record, kind, amountPence);
  try {
    const saved = sessionStorage.getItem(key);
    if (/^[A-Za-z0-9_-]{32,128}$/.test(saved || "")) return saved;
    const created = `admin_${crypto.randomUUID()}_${crypto.randomUUID()}`;
    sessionStorage.setItem(key, created);
    return created;
  } catch { throw new Error("This browser cannot create a secure payment retry key. No action was sent."); }
}

function clearRetryKey(record, kind, amountPence = 0) {
  try { sessionStorage.removeItem(retryStorageKey(record, kind, amountPence)); } catch {}
}

function openAction(record, kind) {
  if (commanding || recoveringCommands.size || uncertainPayments.has(record.paymentId) || paymentDisputeHeld(record) || paymentRecoveryHeld(record)) return;
  selected = record;
  selectedKind = kind;
  form.reset();
  refundField.hidden = kind !== "refund";
  refundField.querySelector("input").required = kind === "refund";
  const refundable = record.amountCapturedPence - record.amountRefundedPence;
  if (kind === "refund") refundField.querySelector("input").placeholder = (refundable / 100).toFixed(2);
  document.querySelector("[data-admin-payment-dialog-title]").textContent = paymentActionLabel(kind);
  document.querySelector("[data-admin-payment-dialog-copy]").textContent = kind === "capture" ? "Capture the exact frozen customer total only after the completed clean has been reviewed." : kind === "transfer" ? "Send the exact frozen Cleaner pay to the provider-verified payout account only after capture is reconciled." : kind === "cancel" ? "Cancel this unused authorization before the Cleaner journey begins." : `Refund no more than the remaining captured amount of ${money(refundable)}. A refund blocks Cleaner transfer until separately resolved.`;
  document.querySelector("[data-admin-payment-dialog-total]").textContent = money(record.amountPence);
  document.querySelector("[data-admin-payment-dialog-cleaner-pay]").textContent = money(record.cleanerPayPence);
  document.querySelector("[data-admin-payment-dialog-refunded]").textContent = money(record.amountRefundedPence);
  document.querySelector("[data-admin-payment-confirmation-copy]").textContent = `I reviewed the exact server totals and intend to ${paymentActionLabel(kind).toLowerCase()} once in Stripe test mode.`;
  submit.textContent = paymentActionLabel(kind);
  showFeedback(dialogFeedback, "");
  dialog.showModal();
}

function actionButton(record, kind, secondary = false) {
  const button = element("button", secondary ? "button button-outline" : "button", paymentActionLabel(kind));
  button.type = "button";
  button.disabled = commanding || recoveringCommands.size > 0 || uncertainPayments.has(record.paymentId) || paymentDisputeHeld(record) || paymentRecoveryHeld(record);
  button.addEventListener("click", () => openAction(record, kind));
  return button;
}

async function recoverCommand(record, command) {
  if (commanding || recoveringCommands.size) return;
  const current = queue.payments.find(item => item.paymentId === record.paymentId);
  if (!current?.recoveryCommands?.some(item => item.commandId === command.commandId)) return;
  recoveringCommands.add(command.commandId);
  renderQueue();
  showFeedback(feedback, "Checking the provider outcome. No money action is being repeated.");
  try {
    const csrf = await recoverCsrf();
    const result = await requestJson(`/api/marketplace/admin/payment-commands/${command.commandId}/recover`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: "{}"
    });
    const recovery = result.recovery;
    if (recovery?.commandId !== command.commandId || recovery.paymentId !== record.paymentId
      || typeof recovery.recoveryRequired !== "boolean") throw new Error("The recovery result could not be verified. Refresh the payment queue before continuing.");
    // Successful discovery alone is not proof of financial success. The fresh
    // server queue remains the authority for both balances and action controls.
    uncertainPayments.add(record.paymentId);
    if (!await loadQueue(queue.offset)) throw new Error("A newer payment status request is still pending.");
    showFeedback(feedback, recovery.recoveryRequired
      ? paymentRecoveryReasonLabel(recovery.recoveryReason)
      : "Verified payment evidence reconciled. The current ledger status is shown below.", recovery.recoveryRequired ? "info" : "success");
  } catch (error) {
    uncertainPayments.add(record.paymentId);
    showFeedback(feedback, "The recovery check could not be completed or refreshed. No charge, refund or payout was repeated. Refresh the queue and check again.", "error");
  } finally {
    recoveringCommands.delete(command.commandId);
    list.setAttribute("aria-busy", "false");
    renderQueue();
  }
}

function recoveryPanel(record) {
  const panel = element("section", "admin-payment-next");
  panel.append(element("strong", "", "Earlier payment actions"));
  for (const command of record.recoveryCommands || []) {
    const row = element("div", "admin-payment-recovery");
    row.append(element("p", "", `${paymentActionLabel(command.kind)} · ${command.recoveryRequired ? paymentRecoveryReasonLabel(command.recoveryReason) : "Verified outcome recorded."}`));
    row.append(element("p", "", command.checkedAt ? `Last checked ${date(command.checkedAt)}` : "Not checked yet"));
    const button = element("button", "button button-outline", recoveringCommands.has(command.commandId) ? "Checking provider…" : "Check provider outcome");
    button.type = "button";
    button.disabled = commanding || recoveringCommands.size > 0;
    button.addEventListener("click", () => recoverCommand(record, command));
    row.append(button);
    panel.append(row);
  }
  return panel;
}

function paymentCard(record) {
  const card = element("article", "admin-case-card admin-payment-card");
  const heading = element("div", "admin-case-card-heading");
  const title = element("div");
  title.append(element("span", "booking-status-pill", paymentStatusLabel(record.paymentStatus)), element("h3", "", shortPaymentReference(record.paymentId)), element("p", "", `Booking ${record.bookingId.slice(0, 8).toUpperCase()} · ${record.bookingStatus.replaceAll("-", " ")}`));
  heading.append(title, element("time", "", date(record.updatedAt)));
  const facts = element("dl", "admin-case-facts admin-payment-facts");
  facts.append(fact("Customer total", money(record.amountPence)), fact("Captured", money(record.amountCapturedPence)), fact("Refunded", money(record.amountRefundedPence)), fact("Cleaner pay", money(record.cleanerPayPence)), fact("Clean starts", date(record.scheduledStartAt)), fact("Payout account", record.payoutReady ? "Provider verified" : "Not ready"));
  const guidance = paymentNextAction(record);
  const nextAction = element("div", `admin-payment-next admin-payment-next-${guidance.kind}`);
  nextAction.append(element("strong", "", guidance.title), element("p", "", guidance.copy));
  card.append(heading, facts, nextAction);
  if (record.disputes?.length) {
    const evidence = element("details", "admin-payment-next");
    evidence.append(element("summary", "", `Payment dispute evidence (${record.disputes.length})`));
    const entries = element("dl", "admin-case-facts");
    for (const dispute of record.disputes) {
      entries.append(fact(dispute.providerDisputeId || "Earlier dispute — identity unverified", `${paymentDisputeStatusLabel(dispute.status)} · ${dispute.requiresReview ? "Review required" : "Recorded outcome"} · Event ${dispute.lastEventId}`));
    }
    evidence.append(entries);
    card.append(evidence);
  }
  if (record.awaitingProvider) card.append(element("p", "admin-payment-waiting", "Waiting for a signed provider update. Refresh status; do not repeat the action."));
  if (record.recoveryCommands?.length) card.append(recoveryPanel(record));
  if (uncertainPayments.has(record.paymentId)) card.append(element("p", "admin-payment-warning", "The previous action has an uncertain result. Refresh the signed status before any retry."));
  const actions = element("div", "booking-summary-actions");
  if (record.canCapture) actions.append(actionButton(record, "capture"));
  if (record.canTransfer) actions.append(actionButton(record, "transfer"));
  if (record.canRefund) actions.append(actionButton(record, "refund", true));
  if (record.canCancel) actions.append(actionButton(record, "cancel", true));
  if (actions.childElementCount) card.append(actions);
  return card;
}

function renderQueue() {
  list.replaceChildren(...queue.payments.map(paymentCard));
  list.hidden = queue.payments.length === 0;
  empty.hidden = queue.payments.length > 0;
  list.setAttribute("aria-busy", "false");
  document.querySelector("[data-admin-payments-count]").textContent = String(queue.payments.length);
  document.querySelector("[data-admin-payments-actionable-count]").textContent = String(queue.payments.filter((item) => item.canCapture || item.canCancel || item.canRefund || item.canTransfer || item.recoveryCommands?.length).length);
  document.querySelector("[data-admin-payments-waiting-count]").textContent = String(queue.payments.filter((item) => item.awaitingProvider).length);
  document.querySelector("[data-admin-payments-page]").textContent = selectedBookingId ? "One related booking" : `Page ${Math.floor(queue.offset / queue.limit) + 1}`;
  previous.disabled = queue.offset === 0;
  next.disabled = queue.payments.length < queue.limit;
}

async function loadQueue(offset = 0) {
  const revision = ++queueRevision;
  const query = selectedBookingId
    ? new URLSearchParams({ bookingId: selectedBookingId, limit: "1", offset: "0" })
    : new URLSearchParams({ status: adminPaymentFilter(filter.value), limit: String(pageSize), offset: String(offset) });
  list.setAttribute("aria-busy", "true");
  const result = await requestJson(`/api/marketplace/admin/payments?${query}`);
  const refreshed = adminPaymentQueue(result);
  if (!refreshed.testMode) throw new Error("The Administrator payment queue did not prove test mode.");
  if (revision !== queueRevision) return false;
  queue = refreshed;
  uncertainPayments.clear();
  renderQueue();
  return true;
}

async function load() {
  if (loading) return;
  loading = true;
  showGate("Checking secure Administrator access…", "Payment operations open only inside an authenticated Homle Administrator account when test payments are connected.");
  try {
    const account = (await requestJson("/api/marketplace/account")).account;
    if (!account?.roles?.includes("administrator")) return showGate("Administrator account required", "Landlord, Cleaner and unrelated accounts cannot operate booking payments.", { kind: "authentication", signIn: true });
    if (bookingLinkError) return showGate("Invalid related payment link", "Return to Booking cases and open the payment review from the current case. No payment action was taken.", { kind: "error" });
    gate.hidden = true;
    workspace.hidden = false;
    await loadQueue(0);
  } catch (error) {
    if (error.statusCode === 401) showGate("Sign in as a Homle Administrator", "Payment operations are not available without an authenticated Administrator account.", { kind: "authentication", signIn: true });
    else if (error.statusCode === 403) showGate("Administrator account required", "This account is not authorised to operate booking payments.", { kind: "authentication", signIn: true });
    else if ([404, 503].includes(error.statusCode)) showGate("Test payment operations are not connected", "This protected screen stays closed until Homle’s payment ledger, test Stripe adapter and Administrator account pass staging.", { kind: "unavailable", retry: true });
    else showGate("Payment operations could not be opened", navigator.onLine ? "Try again. No payment action was taken." : "Reconnect, then try again. No payment action was taken.", { kind: "error", retry: true });
  } finally { loading = false; }
}

async function runSelectedAction() {
  if (commanding || recoveringCommands.size || !selected || !selectedKind) return;
  const actionRecord = selected;
  const actionKind = selectedKind;
  function ensureNoDisputeHold() {
    const current = queue.payments.find((item) => item.paymentId === actionRecord.paymentId);
    if (paymentDisputeHeld(actionRecord) || paymentDisputeHeld(current)) throw new Error("This payment requires dispute review. No payment action was sent.");
    if (paymentRecoveryHeld(actionRecord) || paymentRecoveryHeld(current)) throw new Error("This payment requires recovery review. No payment action was sent.");
    if (!current || uncertainPayments.has(actionRecord.paymentId)) throw new Error("Refresh the current payment status before continuing.");
    const allowed = {capture: "canCapture", cancel: "canCancel", refund: "canRefund", transfer: "canTransfer"}[actionKind];
    if (!allowed || current[allowed] !== true) throw new Error("This payment action is no longer available. Refresh the payment status.");
  }
  ensureNoDisputeHold();
  const refundText = String(new FormData(form).get("refundAmount") || "").trim();
  const amountPence = actionKind === "refund" && /^\d+(?:\.\d{1,2})?$/.test(refundText) ? Math.round(Number(refundText) * 100) : actionKind === "refund" ? NaN : 0;
  const maximumRefund = actionRecord.amountCapturedPence - actionRecord.amountRefundedPence;
  if (actionKind === "refund" && (!Number.isInteger(amountPence) || amountPence < 1 || amountPence > maximumRefund)) throw new TypeError(`Enter a refund between £0.01 and ${money(maximumRefund)}.`);
  const key = retryKey(actionRecord, actionKind, amountPence);
  const payload = paymentActionPayload(actionKind, { amountPence, idempotencyKey: key, confirmed: new FormData(form).get("confirmed") === "on" });
  commanding = true;
  submit.disabled = cancel.disabled = true;
  submit.textContent = "Contacting test provider…";
  try {
    const csrf = await recoverCsrf();
    ensureNoDisputeHold();
    const result = await requestJson(`/api/marketplace/admin/payments/${actionRecord.paymentId}/${actionKind}`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify(payload) });
    if (result.command?.recoveryRequired !== true) clearRetryKey(actionRecord, actionKind, amountPence);
    uncertainPayments.add(actionRecord.paymentId);
    dialog.close();
    renderQueue();
    try {
      if (!await loadQueue(queue.offset)) throw new Error("A newer payment status request is pending.");
      showFeedback(feedback, result.command?.recoveryRequired
        ? paymentRecoveryReasonLabel(result.command.recoveryReason)
        : `${paymentActionLabel(actionKind)} was accepted once. Homle is waiting for the signed provider status before any next action.`, result.command?.recoveryRequired ? "info" : "success");
    } catch {
      uncertainPayments.add(actionRecord.paymentId);
      list.setAttribute("aria-busy", "false");
      renderQueue();
      showFeedback(feedback, `${paymentActionLabel(actionKind)} was accepted by Homle, but its signed status could not be refreshed. This payment is locked until you refresh the queue successfully.`, "error");
    }
    return result;
  } catch (error) {
    if (error.uncertain === true) {
      uncertainPayments.add(actionRecord.paymentId);
      dialog.close();
      renderQueue();
      showFeedback(feedback, error.message, "error");
      return;
    }
    throw error;
  } finally {
    commanding = false;
    submit.disabled = cancel.disabled = false;
    submit.textContent = paymentActionLabel(actionKind);
    renderQueue();
  }
}

form.addEventListener("submit", async (event) => { event.preventDefault(); try { showFeedback(dialogFeedback, ""); await runSelectedAction(); } catch (error) { showFeedback(dialogFeedback, error.message, "error"); } });
cancel.addEventListener("click", () => { if (!commanding) dialog.close(); });
dialog.addEventListener("cancel", (event) => { if (commanding) event.preventDefault(); });
document.querySelector("[data-admin-payments-retry]").addEventListener("click", load);
document.querySelector("[data-admin-payments-refresh]").addEventListener("click", async () => { if (loading) return; loading = true; try { await loadQueue(queue.offset); showFeedback(feedback, "Signed payment status refreshed. No payment action was taken.", "success"); } catch (error) { showFeedback(feedback, error.message, "error"); } finally { loading = false; } });
filter.addEventListener("change", async () => { try { await loadQueue(0); } catch (error) { showFeedback(feedback, error.message, "error"); } });
previous.addEventListener("click", async () => { try { await loadQueue(Math.max(0, queue.offset - queue.limit)); } catch (error) { showFeedback(feedback, error.message, "error"); } });
next.addEventListener("click", async () => { try { await loadQueue(queue.offset + queue.limit); } catch (error) { showFeedback(feedback, error.message, "error"); } });
function networkState() { document.querySelector("[data-network-status]").hidden = navigator.onLine; }
window.addEventListener("offline", networkState);
window.addEventListener("online", () => { networkState(); if (!workspace.hidden) loadQueue(queue.offset).catch(() => {}); });
networkState();
load();
