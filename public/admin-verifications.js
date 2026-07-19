import { adminVerificationQueue, adminVerificationView, backgroundStatuses, cleanerVerificationState, identityStatuses, verificationChange, verificationStatusLabel } from "./admin-verifications-model.js";

const pageSize = 50;
const gate = document.querySelector("[data-admin-verifications-gate]");
const workspace = document.querySelector("[data-admin-verifications-workspace]");
const list = document.querySelector("[data-admin-verifications-list]");
const empty = document.querySelector("[data-admin-verifications-empty]");
const feedback = document.querySelector("[data-admin-verifications-feedback]");
const filter = document.querySelector("[data-admin-verifications-filter]");
const previous = document.querySelector("[data-admin-verifications-previous]");
const next = document.querySelector("[data-admin-verifications-next]");
let queue = { cleaners: [], limit: pageSize, offset: 0 };
let loading = false;

document.querySelector("[data-year]").textContent = String(new Date().getFullYear());

function node(name, className, text) { const result = document.createElement(name); if (className) result.className = className; if (text != null) result.textContent = text; return result; }
function showFeedback(message, kind = "info") { feedback.hidden = !message; feedback.dataset.kind = kind; feedback.textContent = message; if (message) feedback.focus(); }
function showGate(title, copy, { signIn = false, retry = false } = {}) { gate.hidden = false; workspace.hidden = true; document.querySelector("[data-admin-verifications-gate-title]").textContent = title; document.querySelector("[data-admin-verifications-gate-copy]").textContent = copy; document.querySelector("[data-admin-verifications-sign-in]").hidden = !signIn; document.querySelector("[data-admin-verifications-retry]").hidden = !retry; }

async function requestJson(path, init = {}) {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...init, headers: { Accept: "application/json", ...(init.headers || {}) } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok !== true) throw Object.assign(new Error(result.error || "Cleaner verification could not be loaded."), { statusCode: response.status });
  return result;
}

async function recoverCsrf() {
  const result = await requestJson("/api/marketplace/auth/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  if (typeof result.csrfToken !== "string" || !result.csrfToken) throw new Error("Secure Administrator editing access could not be restored. Sign in again.");
  return result.csrfToken;
}

function statusSelect(label, options, current) {
  const wrap = node("label", "admin-verification-select");
  wrap.append(node("span", "", label));
  const select = node("select");
  select.append(new Option("Keep current", ""));
  for (const option of options) select.append(new Option(verificationStatusLabel(option), option, false, false));
  select.value = "";
  wrap.append(select);
  wrap.append(node("small", "", `Now: ${verificationStatusLabel(current)}`));
  return { wrap, select };
}

function cleanerCard(record) {
  const state = cleanerVerificationState(record);
  const card = node("article", `admin-case-card admin-booking-card${state.awaiting ? " admin-booking-card-attention" : ""}`);
  const heading = node("div", "admin-case-card-heading");
  const title = node("div");
  title.append(
    node("span", "booking-status-pill", state.fullyVerified ? "Fully verified" : "Awaiting review"),
    node("h3", "", record.displayName || "Cleaner"),
    node("p", "", `Identity: ${verificationStatusLabel(record.identityCheckStatus)} · Background: ${verificationStatusLabel(record.backgroundCheckStatus)} · ${record.isPublic ? "Profile is public" : "Profile not public"}`)
  );
  heading.append(title);
  card.append(heading);

  const form = node("div", "admin-verification-form");
  const identity = statusSelect("Identity check", identityStatuses, record.identityCheckStatus);
  const background = statusSelect("Background check", backgroundStatuses, record.backgroundCheckStatus);
  const noteWrap = node("label", "admin-verification-note");
  noteWrap.append(node("span", "", "Evidence note (required, no personal detail)"));
  const note = node("textarea");
  note.maxLength = 500; note.rows = 2; note.placeholder = "For example: Passport and proof of address reviewed on a video call.";
  noteWrap.append(note);
  const save = node("button", "button", "Record decision");
  save.type = "button";
  save.addEventListener("click", async () => {
    if (!navigator.onLine) return showFeedback("Reconnect before recording a decision. Nothing was saved.", "error");
    let change;
    try { change = verificationChange(identity.select.value, background.select.value, note.value); }
    catch (error) { return showFeedback(error.message, "error"); }
    save.disabled = true; save.setAttribute("aria-busy", "true"); save.textContent = "Recording…"; showFeedback("");
    try {
      const csrf = await recoverCsrf();
      await requestJson(`/api/marketplace/admin/cleaner-verifications/${encodeURIComponent(record.cleanerId)}`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify(change) });
      showFeedback("Verification decision recorded and audit-logged.", "success");
      await loadQueue(queue.offset);
    } catch (error) {
      showFeedback(error.message, "error");
      save.disabled = false; save.removeAttribute("aria-busy"); save.textContent = "Record decision";
    }
  });
  form.append(identity.wrap, background.wrap, noteWrap, save);
  card.append(form);
  return card;
}

function render() {
  list.replaceChildren(...queue.cleaners.map(cleanerCard)); list.hidden = queue.cleaners.length === 0; empty.hidden = queue.cleaners.length > 0; list.setAttribute("aria-busy", "false");
  document.querySelector("[data-admin-verifications-count]").textContent = String(queue.cleaners.length);
  document.querySelector("[data-admin-verifications-awaiting]").textContent = String(queue.cleaners.filter((item) => cleanerVerificationState(item).awaiting).length);
  document.querySelector("[data-admin-verifications-verified]").textContent = String(queue.cleaners.filter((item) => cleanerVerificationState(item).fullyVerified).length);
  document.querySelector("[data-admin-verifications-page]").textContent = `Page ${Math.floor(queue.offset / queue.limit) + 1}`;
  previous.disabled = queue.offset === 0; next.disabled = queue.cleaners.length < queue.limit;
}

async function loadQueue(offset = 0) {
  list.setAttribute("aria-busy", "true"); previous.disabled = next.disabled = true;
  const query = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
  const view = adminVerificationView(filter.value); if (view) query.set("view", view);
  queue = adminVerificationQueue(await requestJson(`/api/marketplace/admin/cleaner-verifications?${query}`)); render();
}

async function load() {
  if (loading) return; loading = true;
  showGate("Checking secure Administrator access…", "Cleaner vetting opens only inside an authenticated Homle Administrator account.");
  try {
    const account = (await requestJson("/api/marketplace/account")).account;
    if (!account?.roles?.includes("administrator")) return showGate("Administrator account required", "This account cannot review cleaner verification.", { signIn: true });
    gate.hidden = true; workspace.hidden = false; await loadQueue(0);
  } catch (error) {
    if ([401, 403].includes(error.statusCode)) showGate("Sign in as a Homle Administrator", "Private cleaner vetting is not available to Landlords, Cleaners or signed-out visitors.", { signIn: true });
    else showGate("Cleaner vetting could not be opened", navigator.onLine ? "Try again. No decision was recorded." : "Reconnect, then try again.", { retry: true });
  } finally { loading = false; }
}

document.querySelector("[data-admin-verifications-retry]").addEventListener("click", load);
document.querySelector("[data-admin-verifications-refresh]").addEventListener("click", async () => { try { await loadQueue(queue.offset); showFeedback("Verification queue refreshed. No decision was recorded.", "success"); } catch (error) { showFeedback(error.message, "error"); } });
filter.addEventListener("change", () => loadQueue(0).catch((error) => showFeedback(error.message, "error")));
previous.addEventListener("click", () => loadQueue(Math.max(0, queue.offset - queue.limit)).catch((error) => showFeedback(error.message, "error")));
next.addEventListener("click", () => loadQueue(queue.offset + queue.limit).catch((error) => showFeedback(error.message, "error")));
function network() { document.querySelector("[data-network-status]").hidden = navigator.onLine; } window.addEventListener("online", network); window.addEventListener("offline", network); network(); load();
