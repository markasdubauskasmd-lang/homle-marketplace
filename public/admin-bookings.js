import { adminBookingQueue, adminBookingView, operationStatusLabel, plannedMarginPercent, shortOperationReference } from "./admin-bookings-model.js";

const pageSize = 50;
const gate = document.querySelector("[data-admin-bookings-gate]");
const workspace = document.querySelector("[data-admin-bookings-workspace]");
const list = document.querySelector("[data-admin-bookings-list]");
const empty = document.querySelector("[data-admin-bookings-empty]");
const feedback = document.querySelector("[data-admin-bookings-feedback]");
const filter = document.querySelector("[data-admin-bookings-filter]");
const previous = document.querySelector("[data-admin-bookings-previous]");
const next = document.querySelector("[data-admin-bookings-next]");
let queue = { operations: [], limit: pageSize, offset: 0 };
let loading = false;

document.querySelector("[data-year]").textContent = String(new Date().getFullYear());
const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

function node(name, className, text) { const result = document.createElement(name); if (className) result.className = className; if (text != null) result.textContent = text; return result; }
function moneyPence(value) { return money.format(value / 100); }
function date(value) { return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function fact(label, value) { const item = node("div"); item.append(node("dt", "", label), node("dd", "", value)); return item; }
function showFeedback(message, kind = "info") { feedback.hidden = !message; feedback.dataset.kind = kind; feedback.textContent = message; if (message) feedback.focus(); }
function showGate(title, copy, { signIn = false, retry = false } = {}) { gate.hidden = false; workspace.hidden = true; document.querySelector("[data-admin-bookings-gate-title]").textContent = title; document.querySelector("[data-admin-bookings-gate-copy]").textContent = copy; document.querySelector("[data-admin-bookings-sign-in]").hidden = !signIn; document.querySelector("[data-admin-bookings-retry]").hidden = !retry; }
async function requestJson(path) { const response = await fetch(path, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } }); const result = await response.json().catch(() => ({})); if (!response.ok || result.ok !== true) throw Object.assign(new Error(result.error || "Booking operations could not be loaded."), { statusCode: response.status }); return result; }

function operationCard(record) {
  const card = node("article", `admin-case-card admin-booking-card${record.needsAttention ? " admin-booking-card-attention" : ""}`);
  const heading = node("div", "admin-case-card-heading");
  const title = node("div");
  title.append(node("span", "booking-status-pill", operationStatusLabel(record.status)), node("h3", "", shortOperationReference(record)), node("p", "", `${record.cleaningType} · ${record.serviceCount} service${record.serviceCount === 1 ? "" : "s"}`));
  heading.append(title, node("time", "", date(record.scheduledStartAt)));
  const nextAction = node("div", "admin-booking-next");
  nextAction.append(node("strong", "", record.needsAttention ? "Attention needed" : "Next"), node("p", "", record.nextAction));
  const facts = node("dl", "admin-case-facts");
  facts.append(fact("Window", `${date(record.scheduledStartAt)} – ${date(record.scheduledEndAt)}`), fact("Tasks", `${record.completedTaskCount} of ${record.taskCount} complete`));
  if (record.bookingId) {
    const margin = plannedMarginPercent(record);
    facts.append(fact("Customer total", moneyPence(record.customerPricePence)), fact("Cleaner pay", moneyPence(record.cleanerPayPence)), fact("Planned direct costs", moneyPence(record.plannedCostsPence)), fact("Planned contribution", `${moneyPence(record.plannedContributionPence)}${margin == null ? "" : ` (${margin.toFixed(1)}%)`}`), fact("Payment", record.paymentStatus || "Not started"), fact("Case", record.caseStatus || "None"));
  }
  const actions = node("div", "booking-summary-actions");
  if (record.caseStatus || record.status === "disputed") { const link = node("a", "button button-outline", "Open booking cases"); link.href = "/admin/cases"; actions.append(link); }
  if (record.bookingId && (record.paymentStatus || ["confirmed", "completed", "cancelled"].includes(record.status))) { const link = node("a", "button button-outline", "Open related test payment"); link.href = `/admin/payments?bookingId=${encodeURIComponent(record.bookingId)}`; actions.append(link); }
  card.append(heading, nextAction, facts); if (actions.childElementCount) card.append(actions); return card;
}

function render() {
  list.replaceChildren(...queue.operations.map(operationCard)); list.hidden = queue.operations.length === 0; empty.hidden = queue.operations.length > 0; list.setAttribute("aria-busy", "false");
  document.querySelector("[data-admin-bookings-count]").textContent = String(queue.operations.length);
  document.querySelector("[data-admin-bookings-attention]").textContent = String(queue.operations.filter((item) => item.needsAttention).length);
  document.querySelector("[data-admin-bookings-active]").textContent = String(queue.operations.filter((item) => ["confirmed", "cleaner-en-route", "cleaner-arrived", "cleaning-in-progress", "awaiting-review"].includes(item.status)).length);
  document.querySelector("[data-admin-bookings-page]").textContent = `Page ${Math.floor(queue.offset / queue.limit) + 1}`; previous.disabled = queue.offset === 0; next.disabled = queue.operations.length < queue.limit;
}

async function loadQueue(offset = 0) {
  list.setAttribute("aria-busy", "true"); previous.disabled = next.disabled = true;
  const query = new URLSearchParams({ limit: String(pageSize), offset: String(offset) }); const view = adminBookingView(filter.value); if (view) query.set("view", view);
  queue = adminBookingQueue(await requestJson(`/api/marketplace/admin/bookings?${query}`)); render();
}

async function load() {
  if (loading) return; loading = true; showGate("Checking secure Administrator access…", "Booking operations open only inside an authenticated Homle Administrator account.");
  try { const account = (await requestJson("/api/marketplace/account")).account; if (!account?.roles?.includes("administrator")) return showGate("Administrator account required", "This account cannot view internal booking economics.", { signIn: true }); gate.hidden = true; workspace.hidden = false; await loadQueue(0); }
  catch (error) { if ([401, 403].includes(error.statusCode)) showGate("Sign in as a Homle Administrator", "Private booking operations are not available to Landlords, Cleaners or signed-out visitors.", { signIn: true }); else showGate("Booking operations could not be opened", navigator.onLine ? "Try again. No booking was changed." : "Reconnect, then try again.", { retry: true }); }
  finally { loading = false; }
}

document.querySelector("[data-admin-bookings-retry]").addEventListener("click", load);
document.querySelector("[data-admin-bookings-refresh]").addEventListener("click", async () => { try { await loadQueue(queue.offset); showFeedback("Booking operations refreshed. No action was taken.", "success"); } catch (error) { showFeedback(error.message, "error"); } });
filter.addEventListener("change", () => loadQueue(0).catch((error) => showFeedback(error.message, "error")));
previous.addEventListener("click", () => loadQueue(Math.max(0, queue.offset - queue.limit)).catch((error) => showFeedback(error.message, "error")));
next.addEventListener("click", () => loadQueue(queue.offset + queue.limit).catch((error) => showFeedback(error.message, "error")));
function network() { document.querySelector("[data-network-status]").hidden = navigator.onLine; } window.addEventListener("online", network); window.addEventListener("offline", network); network(); load();
