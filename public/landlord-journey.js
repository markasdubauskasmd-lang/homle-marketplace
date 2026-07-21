import {
  journeySteps,
  stepIndex,
  stepLabel,
  railState,
  previousStep,
  normalisedPostcode,
  postcodeMessage,
  supplyMessage,
  services,
  bookableDays,
  arrivalWindows,
  frequencies,
  canLeaveStep,
  blockedReason,
  checkoutMode,
  checkoutCopy
} from "./landlord-journey-model.js";
import { openRoomScan } from "./room-scan-overlay.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const el = {
  rail: $("[data-rail]"),
  stepLabel: $("[data-step-label]"),
  back: $("[data-back]"),
  postcode: $("[data-postcode]"),
  postcodeError: $("[data-postcode-error]"),
  supply: $("[data-supply]"),
  supplyHead: $("[data-supply-head]"),
  supplyDetail: $("[data-supply-detail]"),
  services: $("[data-services]"),
  scanLink: $("[data-scan-link]"),
  scanPrereq: $("[data-scan-prereq]"),
  skipScan: $("[data-skip-scan]"),
  resultsEyebrow: $("[data-results-eyebrow]"),
  resultsSource: $("[data-results-source]"),
  resultsTime: $("[data-results-time]"),
  resultsRooms: $("[data-results-rooms]"),
  resultsTasks: $("[data-results-tasks]"),
  tasks: $("[data-tasks]"),
  days: $("[data-days]"),
  times: $("[data-times]"),
  frequencies: $("[data-frequencies]"),
  cleaners: $("[data-cleaners]"),
  cleanerState: $("[data-cleaner-state]"),
  cleanerLede: $("[data-cleaner-lede]"),
  checkoutLede: $("[data-checkout-lede]"),
  summary: $("[data-summary]"),
  checkoutNote: $("[data-checkout-note]"),
  confirm: $("[data-confirm]"),
  checkoutState: $("[data-checkout-state]"),
  doneTitle: $("[data-done-title]"),
  doneBody: $("[data-done-body]"),
  toast: $("[data-toast]")
};

const draftKey = "homle_journey_draft";
const state = {
  step: "postcode",
  capabilities: { paymentsReady: false, matchingReady: false },
  draft: {
    postcode: "",
    outward: "",
    serviceCode: "",
    tasks: [],
    transcript: "",
    rooms: [],
    guideTime: "",
    date: "",
    time: "",
    frequency: "fortnightly",
    cleanerId: "",
    cleanerName: ""
  },
  confirming: false
};

function toast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.toast.hidden = true; }, 3000);
}

function storedCsrf() {
  try { return sessionStorage.getItem("tideway_csrf") || ""; } catch { return ""; }
}

// The journey is long enough that losing it to a refresh or a phone call would
// be a real cost, so every answered step is kept locally until it is submitted.
function saveDraft() {
  try { sessionStorage.setItem(draftKey, JSON.stringify({ step: state.step, draft: state.draft })); } catch {}
}

function restoreDraft() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(draftKey) || "null");
    if (stored?.draft && typeof stored.draft === "object") Object.assign(state.draft, stored.draft);
    if (typeof stored?.step === "string" && stepIndex(stored.step) >= 0) state.step = stored.step;
  } catch {}
}

// A finished room scan hands its checklist here.
function adoptScan() {
  let scan = null;
  try {
    const stored = sessionStorage.getItem("homle_scan_result");
    if (!stored) return false;
    sessionStorage.removeItem("homle_scan_result");
    scan = JSON.parse(stored);
  } catch { return false; }
  const tasks = Array.isArray(scan?.tasks) ? scan.tasks.filter((task) => typeof task === "string" && task.trim()) : [];
  const transcript = typeof scan?.transcript === "string" ? scan.transcript.trim() : "";
  if (!tasks.length && !transcript) return false;
  state.draft.tasks = tasks;
  state.draft.transcript = transcript;
  state.draft.rooms = Array.isArray(scan?.rooms) ? scan.rooms : [];
  state.draft.guideTime = typeof scan?.guideTime === "string" ? scan.guideTime : "";
  state.step = "results";
  return true;
}

/* ── Navigation ─────────────────────────────────────── */
function show(stepId) {
  state.step = stepId;
  for (const section of $$(".jstep")) section.hidden = section.dataset.step !== stepId;
  const rail = railState(stepId);
  el.rail.innerHTML = "";
  for (const status of rail) {
    const segment = document.createElement("div");
    segment.className = `rail-seg${status ? ` ${status}` : ""}`;
    segment.appendChild(document.createElement("i"));
    el.rail.appendChild(segment);
  }
  const index = stepIndex(stepId);
  el.rail.setAttribute("aria-valuenow", String(Math.max(1, index + 1)));
  el.stepLabel.textContent = stepId === "done" ? "Complete" : stepLabel(stepId);
  el.back.hidden = !previousStep(stepId) || stepId === "done";
  window.scrollTo({ top: 0, behavior: "instant" });
  saveDraft();
  if (stepId === "results") renderResults();
  if (stepId === "when") renderWhen();
  if (stepId === "cleaner") loadCleaners();
  if (stepId === "checkout") renderCheckout();
}

function goNext() {
  readCurrentStep();
  if (!canLeaveStep(state.step, state.draft)) return toast(blockedReason(state.step, state.draft));
  const index = stepIndex(state.step);
  const next = journeySteps[index + 1];
  if (next) show(next.id);
}

function readCurrentStep() {
  if (state.step === "postcode") {
    const parsed = normalisedPostcode(el.postcode.value);
    state.draft.postcode = el.postcode.value.trim();
    state.draft.outward = parsed?.outward || "";
  }
  if (state.step === "results") {
    state.draft.tasks = el.tasks.value.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 40);
  }
  saveDraft();
}

/* ── Step 1: postcode ───────────────────────────────── */
let supplyTimer = null;
el.postcode.addEventListener("input", () => {
  const message = postcodeMessage(el.postcode.value);
  el.postcodeError.textContent = message;
  el.postcodeError.hidden = !message;
  el.postcode.classList.toggle("ok", Boolean(normalisedPostcode(el.postcode.value)));
  clearTimeout(supplyTimer);
  el.supply.hidden = true;
  const parsed = normalisedPostcode(el.postcode.value);
  if (parsed) supplyTimer = setTimeout(() => checkSupply(parsed.outward), 500);
});

// Real coverage from the live Cleaner directory. If the lookup fails the step
// stays usable and simply says nothing, rather than inventing a count.
async function checkSupply(outward) {
  try {
    const response = await fetch(`/api/marketplace/cleaners?outwardPostcode=${encodeURIComponent(outward)}&limit=50`, {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store"
    });
    if (!response.ok) return;
    const payload = await response.json();
    const count = Array.isArray(payload?.cleaners) ? payload.cleaners.length : 0;
    const message = supplyMessage(count, outward);
    el.supplyHead.textContent = message.headline;
    el.supplyDetail.textContent = message.detail;
    el.supply.classList.toggle("none", !message.available);
    el.supply.hidden = false;
  } catch {}
}

/* ── Step 2: service ────────────────────────────────── */
function renderServices() {
  el.services.innerHTML = "";
  for (const service of services) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "opt";
    option.setAttribute("role", "radio");
    option.setAttribute("aria-checked", String(state.draft.serviceCode === service.code));
    option.classList.toggle("on", state.draft.serviceCode === service.code);
    option.innerHTML = `<span class="opt-name"></span><span class="opt-detail"></span>`;
    option.querySelector(".opt-name").textContent = service.name;
    option.querySelector(".opt-detail").textContent = service.detail;
    option.addEventListener("click", () => {
      state.draft.serviceCode = service.code;
      saveDraft();
      renderServices();
    });
    el.services.appendChild(option);
  }
  const serviceSelected = Boolean(state.draft.serviceCode);
  el.scanLink.disabled = !serviceSelected;
  el.scanPrereq.hidden = serviceSelected;
}

// The scan opens over the journey rather than navigating away, so the answers
// already given stay on screen behind it and the result comes straight back
// instead of being handed through storage across a page load.
el.scanLink.addEventListener("click", async () => {
  readCurrentStep();
  if (!canLeaveStep("service", state.draft)) {
    toast(blockedReason("service", state.draft));
    el.services.querySelector(".opt")?.focus();
    return;
  }
  el.scanLink.disabled = true;
  try {
    const result = await openRoomScan();
    // Closed without finishing: the journey is exactly where it was left.
    if (!result) return;
    state.draft.tasks = Array.isArray(result.tasks) ? result.tasks : [];
    state.draft.transcript = typeof result.transcript === "string" ? result.transcript : "";
    state.draft.rooms = Array.isArray(result.rooms) ? result.rooms : [];
    state.draft.guideTime = typeof result.guideTime === "string" ? result.guideTime : "";
    saveDraft();
    show("results");
    toast(state.draft.tasks.length
      ? `${state.draft.tasks.length} ${state.draft.tasks.length === 1 ? "task" : "tasks"} from your scan. Check them before continuing.`
      : "Your scan is saved. Add the checklist below before continuing.");
  } finally {
    el.scanLink.disabled = false;
  }
});
el.skipScan.addEventListener("click", () => {
  if (!canLeaveStep("service", state.draft)) return toast(blockedReason("service", state.draft));
  show("results");
});

/* ── Step 3: results ────────────────────────────────── */
function renderResults() {
  const scanned = Boolean(state.draft.rooms.length || state.draft.transcript);
  el.resultsEyebrow.textContent = scanned ? "Scan complete" : "Your checklist";
  el.resultsSource.textContent = scanned
    ? `Scoped from your ${state.draft.rooms.length || "room"} scan${state.draft.transcript ? " + voice note" : ""}`
    : "Written by you";
  el.tasks.value = state.draft.tasks.join("\n");
  updateResultTotals();
}

function updateResultTotals() {
  const tasks = el.tasks.value.split("\n").map((line) => line.trim()).filter(Boolean);
  const rooms = new Set(tasks.map((task) => (task.includes(":") ? task.split(":")[0].trim().toLowerCase() : "")).filter(Boolean));
  el.resultsTasks.textContent = String(tasks.length);
  el.resultsRooms.textContent = String(rooms.size || state.draft.rooms.length || 0);
  el.resultsTime.textContent = state.draft.guideTime || (tasks.length ? guideRange(tasks.length) : "—");
}

// Same honesty as the scan: a range from the work listed, never a single
// confident figure a checklist cannot support.
function guideRange(taskCount) {
  const minutes = Math.max(60, Math.round((taskCount * 12) / 5) * 5);
  const low = Math.max(60, Math.round((minutes * 0.65) / 15) * 15);
  const high = Math.round((minutes * 1.35) / 15) * 15;
  const clock = (value) => (value % 60 ? `${Math.floor(value / 60)}h ${value % 60}m` : `${Math.floor(value / 60)}h`);
  return low >= high ? clock(minutes) : `${clock(low)}–${clock(high)}`;
}

el.tasks.addEventListener("input", updateResultTotals);

/* ── Step 4: when ───────────────────────────────────── */
function renderWhen() {
  const days = bookableDays(new Date());
  if (!state.draft.date) state.draft.date = days[0].iso;
  el.days.innerHTML = "";
  for (const day of days) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "day";
    option.setAttribute("role", "radio");
    option.setAttribute("aria-checked", String(state.draft.date === day.iso));
    option.classList.toggle("on", state.draft.date === day.iso);
    option.innerHTML = `<span></span><b></b>`;
    option.querySelector("span").textContent = day.weekday;
    option.querySelector("b").textContent = day.dayOfMonth;
    option.addEventListener("click", () => { state.draft.date = day.iso; saveDraft(); renderWhen(); });
    el.days.appendChild(option);
  }
  renderChips(el.times, arrivalWindows.map((time) => ({ code: time, label: time })), "time");
  renderChips(el.frequencies, frequencies, "frequency");
}

function renderChips(container, items, field) {
  container.innerHTML = "";
  for (const item of items) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.setAttribute("role", "radio");
    chip.setAttribute("aria-checked", String(state.draft[field] === item.code));
    chip.classList.toggle("on", state.draft[field] === item.code);
    chip.textContent = item.label;
    chip.addEventListener("click", () => {
      state.draft[field] = item.code;
      saveDraft();
      renderChips(container, items, field);
    });
    container.appendChild(chip);
  }
}

/* ── Step 5: cleaner ────────────────────────────────── */
async function loadCleaners() {
  el.cleaners.innerHTML = "";
  el.cleanerState.hidden = false;
  el.cleanerState.textContent = "Finding cleaners who cover your area…";
  try {
    const params = new URLSearchParams({ limit: "12" });
    if (state.draft.outward) params.set("outwardPostcode", state.draft.outward);
    if (state.draft.serviceCode) params.set("serviceCode", state.draft.serviceCode);
    const response = await fetch(`/api/marketplace/cleaners?${params}`, { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw new Error("unavailable");
    const payload = await response.json();
    const cleaners = Array.isArray(payload?.cleaners) ? payload.cleaners : [];
    if (!cleaners.length) {
      el.cleanerState.textContent = `No cleaners cover ${state.draft.outward || "your area"} yet. You can still save this request — we'll tell you when someone does.`;
      return;
    }
    el.cleanerState.hidden = true;
    for (const cleaner of cleaners) renderCleaner(cleaner);
  } catch {
    el.cleanerState.textContent = "We couldn't load cleaners just now. Your answers are saved — try again in a moment.";
  }
}

function renderCleaner(cleaner) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "cleaner";
  card.setAttribute("role", "radio");
  const selected = state.draft.cleanerId === cleaner.cleanerId;
  card.setAttribute("aria-checked", String(selected));
  card.classList.toggle("on", selected);

  const name = document.createElement("p");
  name.className = "cleaner-name";
  name.textContent = cleaner.displayName || "Cleaner";

  const meta = document.createElement("p");
  meta.className = "cleaner-meta";
  const parts = [];
  if (Number(cleaner.reviewCount) > 0) parts.push(`${Number(cleaner.averageRating).toFixed(1)} ★ (${Number(cleaner.reviewCount)})`);
  else parts.push("New to Homle");
  if (cleaner.verified === true) parts.push("Verified");
  if (Number(cleaner.completedJobCount) > 0) parts.push(`${Number(cleaner.completedJobCount)} jobs`);
  meta.textContent = parts.join(" · ");

  card.append(name, meta);
  card.addEventListener("click", () => {
    state.draft.cleanerId = cleaner.cleanerId;
    state.draft.cleanerName = cleaner.displayName || "";
    saveDraft();
    loadCleaners();
  });
  el.cleaners.appendChild(card);
}

/* ── Step 6: checkout ───────────────────────────────── */
function renderCheckout() {
  const mode = checkoutMode(state.capabilities);
  const copy = checkoutCopy(mode);
  el.confirm.textContent = copy.action;
  el.checkoutNote.textContent = copy.note;
  el.checkoutLede.textContent = mode === "pay"
    ? "Check everything over. Your card is only authorised once you confirm."
    : "Check everything over before you save it.";

  const rows = [
    ["Area", state.draft.outward || "—"],
    ["Clean", (services.find((service) => service.code === state.draft.serviceCode) || {}).name || "—"],
    ["Tasks", `${state.draft.tasks.length}`],
    ["Day", state.draft.date || "—"],
    ["Arrival", state.draft.time || "—"],
    ["How often", (frequencies.find((frequency) => frequency.code === state.draft.frequency) || {}).label || "—"],
    ["Cleaner", state.draft.cleanerName || "—"]
  ];
  el.summary.innerHTML = "";
  for (const [label, value] of rows) {
    const term = document.createElement("dt");
    term.textContent = label;
    const detail = document.createElement("dd");
    detail.textContent = value;
    el.summary.append(term, detail);
  }
}

async function confirmJourney() {
  if (state.confirming) return;
  state.confirming = true;
  el.confirm.disabled = true;
  el.checkoutState.hidden = false;
  el.checkoutState.textContent = "Saving your request…";
  const csrf = storedCsrf();
  if (!csrf) {
    el.checkoutState.textContent = "Your secure session expired. Sign in again — your answers are saved.";
    state.confirming = false;
    el.confirm.disabled = false;
    return;
  }
  try {
    const response = await fetch("/api/marketplace/cleaning-requests", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({
        serviceCode: state.draft.serviceCode,
        requestedDate: state.draft.date,
        requestedTime: state.draft.time,
        frequency: state.draft.frequency,
        transcript: state.draft.transcript,
        tasks: state.draft.tasks
      })
    });
    if (!response.ok) throw new Error("save-failed");
    try { sessionStorage.removeItem(draftKey); } catch {}
    const mode = checkoutMode(state.capabilities);
    el.doneTitle.textContent = mode === "pay" ? "You're booked." : "That's everything.";
    el.doneBody.textContent = mode === "pay"
      ? "Your cleaner has been booked and your card authorised. You'll see them on your dashboard."
      : "Your request and checklist are saved on your dashboard. Nothing has been sent to a cleaner and no payment has been taken.";
    show("done");
  } catch {
    el.checkoutState.textContent = "That didn't save. Nothing was sent and your answers are still here — try again.";
  } finally {
    state.confirming = false;
    el.confirm.disabled = false;
  }
}

/* ── Capabilities ───────────────────────────────────── */
async function loadCapabilities() {
  try {
    const response = await fetch("/api/health", { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    state.capabilities = {
      paymentsReady: payload?.marketplace?.paymentsReady === true,
      matchingReady: payload?.marketplace?.matchingReady === true
    };
  } catch {}
}

/* ── Wiring ─────────────────────────────────────────── */
for (const button of $$("[data-next]")) button.addEventListener("click", goNext);
el.confirm.addEventListener("click", confirmJourney);
el.back.addEventListener("click", () => {
  readCurrentStep();
  const previous = previousStep(state.step);
  if (previous) show(previous);
});

restoreDraft();
const cameFromScan = adoptScan();
renderServices();
if (state.draft.postcode) {
  el.postcode.value = state.draft.postcode;
  const parsed = normalisedPostcode(state.draft.postcode);
  if (parsed) checkSupply(parsed.outward);
}
await loadCapabilities();
show(state.step);
if (cameFromScan) toast("Your scan is here. Check the checklist before continuing.");
