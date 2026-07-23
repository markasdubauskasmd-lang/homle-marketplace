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
  durationChoices,
  suggestedDurationMinutes,
  matchingProperties,
  journeyAccountState,
  rankedAvailableCleaners,
  bestAvailableCleaner,
  firstQuoteVerifiedCleaner,
  canLeaveStep,
  blockedReason,
  checkoutMode,
  checkoutCopy
} from "./landlord-journey-model.js?v=journey7";
import { openRoomScan } from "./room-scan-overlay.js";
import { requestTasksFromLines, requestedWindow } from "./landlord-dashboard-model.js?v=20260719-1";
import { isUkPostcode } from "./contact-validation.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const el = {
  accessGate: $("[data-access-gate]"),
  accessTitle: $("[data-access-title]"),
  accessCopy: $("[data-access-copy]"),
  accessSignIn: $("[data-access-sign-in]"),
  accessRetry: $("[data-access-retry]"),
  journeyShell: $$("[data-journey-shell]"),
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
  duration: $("[data-duration]"),
  cleaners: $("[data-cleaners]"),
  cleanerState: $("[data-cleaner-state]"),
  cleanerLede: $("[data-cleaner-lede]"),
  checkoutLede: $("[data-checkout-lede]"),
  summary: $("[data-summary]"),
  checkoutNote: $("[data-checkout-note]"),
  propertyAccountState: $("[data-property-account-state]"),
  propertyOptions: $("[data-property-options]"),
  propertyNewToggle: $("[data-property-new-toggle]"),
  propertyNew: $("[data-property-new]"),
  propertyType: $("[data-property-type]"),
  addressLine1: $("[data-address-line-1]"),
  locality: $("[data-locality]"),
  fullPostcode: $("[data-full-postcode]"),
  propertySignIn: $("[data-property-sign-in]"),
  propertyState: $("[data-property-state]"),
  cleanerPhotoPreview: $("[data-cleaner-photo-preview]"),
  mediaState: $("[data-media-state]"),
  confirm: $("[data-confirm]"),
  checkoutState: $("[data-checkout-state]"),
  doneTitle: $("[data-done-title]"),
  doneBody: $("[data-done-body]"),
  toast: $("[data-toast]")
};

const draftKey = "homle_journey_draft";
const state = {
  step: "postcode",
  capabilities: { mediaReady: false, matchingReady: false },
  signedIn: false,
  properties: [],
  scanPhotos: [],
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
    durationMinutes: 120,
    propertyId: "",
    propertyDraftId: "",
    requestId: "",
    cleanerId: "marketplace",
    cleanerName: "Best available Cleaner"
  },
  confirming: false
};

function toast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.toast.hidden = true; }, 3000);
}

function saveCsrf(token) {
  try {
    if (!token) return false;
    sessionStorage.setItem("tideway_csrf", token);
    return sessionStorage.getItem("tideway_csrf") === token;
  } catch { return false; }
}

function randomId() {
  if (typeof crypto?.randomUUID !== "function") throw new Error("Secure retry protection is unavailable in this browser.");
  return crypto.randomUUID();
}

function browserOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

async function requestJson(path, options = {}) {
  const mutation = Boolean(options.method && options.method !== "GET");
  if (browserOffline()) throw Object.assign(new Error(mutation
    ? "You are offline. Nothing was sent; your answers are still here."
    : "You are offline. Reconnect to open your private account."), { code: "browser-offline" });
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(path, {
      credentials: "same-origin",
      cache: "no-store",
      ...options,
      headers: { Accept: "application/json", ...(options.headers || {}) },
      signal: controller.signal
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(result.error || result.message || "That account action could not be completed."), { statusCode: response.status, code: result.code });
    return result;
  } catch (error) {
    if (error?.name === "AbortError") throw Object.assign(new Error(mutation
      ? "The connection took too long. This action may have completed. Open your dashboard to check before trying again."
      : "The connection took too long. Check the connection and try again."), { code: "request-timeout" });
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

async function recoverCsrf() {
  const result = await requestJson("/api/marketplace/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
  if (!result.csrfToken || !saveCsrf(result.csrfToken)) throw new Error("This browser could not keep the renewed secure editing token.");
  return result.csrfToken;
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
    if (!durationChoices.includes(Number(state.draft.durationMinutes))) state.draft.durationMinutes = 120;
    for (const key of ["propertyDraftId", "requestId"]) {
      if (!/^[0-9a-f-]{36}$/i.test(state.draft[key] || "")) state.draft[key] = "";
    }
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
  state.scanPhotos = Array.isArray(scan?.photos)
    ? scan.photos.filter((photo) => photo?.roomName && /^data:image\/jpeg;base64,/i.test(photo?.dataUrl || ""))
    : [];
  state.draft.durationMinutes = suggestedDurationMinutes(tasks);
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
  if (state.step === "when") state.draft.durationMinutes = Number(el.duration.value);
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
  if (parsed) {
    if (state.draft.propertyId && !matchingProperties(state.properties, el.postcode.value).some((property) => property.propertyId === state.draft.propertyId)) state.draft.propertyId = "";
    supplyTimer = setTimeout(() => checkSupply(parsed.outward), 500);
  }
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
    state.scanPhotos = Array.isArray(result.photos) ? result.photos : [];
    state.draft.durationMinutes = suggestedDurationMinutes(state.draft.tasks);
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
  if (!durationChoices.includes(Number(state.draft.durationMinutes))) state.draft.durationMinutes = suggestedDurationMinutes(state.draft.tasks);
  el.duration.value = String(state.draft.durationMinutes);
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
  renderCleaner({ cleanerId: "marketplace", displayName: "Find the best available Cleaner", marketplaceChoice: true });
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
  if (cleaner.marketplaceChoice) {
    meta.textContent = "Homle checks live service fit, distance, availability and price before any invitation";
  } else {
  const parts = [];
  if (Number(cleaner.reviewCount) > 0) parts.push(`${Number(cleaner.averageRating).toFixed(1)} ★ (${Number(cleaner.reviewCount)})`);
  else parts.push("New to Homle");
  if (cleaner.verified === true) parts.push("Verified");
  if (Number(cleaner.completedJobCount) > 0) parts.push(`${Number(cleaner.completedJobCount)} jobs`);
  meta.textContent = parts.join(" · ");

  }
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
function propertyLabel(property) {
  const address = property?.exactAddress || {};
  return [property?.name, address.locality, address.postcode].filter(Boolean).join(" · ") || "Saved property";
}

function renderPropertyChoice() {
  el.propertyOptions.replaceChildren();
  el.propertyState.hidden = true;
  el.propertySignIn.hidden = state.signedIn;
  if (!state.signedIn) {
    el.propertyAccountState.textContent = "Sign in before any address or request can be saved.";
    el.propertyNew.hidden = true;
    el.propertyNewToggle.hidden = true;
    el.confirm.disabled = true;
    return;
  }

  const eligible = matchingProperties(state.properties, state.draft.postcode);
  if (state.draft.propertyId && !eligible.some((property) => property.propertyId === state.draft.propertyId)) state.draft.propertyId = "";
  if (!state.draft.propertyId && eligible.length === 1) state.draft.propertyId = eligible[0].propertyId;
  el.propertyAccountState.textContent = eligible.length
    ? `${eligible.length} saved ${eligible.length === 1 ? "property matches" : "properties match"} this postcode.`
    : "No saved property matches this postcode.";

  for (const property of eligible) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "journey-property-option";
    option.setAttribute("role", "radio");
    option.setAttribute("aria-checked", String(state.draft.propertyId === property.propertyId));
    option.classList.toggle("on", state.draft.propertyId === property.propertyId);
    option.textContent = propertyLabel(property);
    option.addEventListener("click", () => {
      state.draft.propertyId = property.propertyId;
      saveDraft();
      renderPropertyChoice();
    });
    el.propertyOptions.append(option);
  }

  el.propertyNewToggle.hidden = false;
  el.propertyNewToggle.textContent = eligible.length ? "Use another property" : "Add this property";
  const useNew = !state.draft.propertyId;
  el.propertyNew.hidden = !useNew;
  const parsed = normalisedPostcode(state.draft.postcode);
  if (useNew && parsed?.full && !el.fullPostcode.value) el.fullPostcode.value = parsed.full;
  el.confirm.disabled = false;
}

function renderMediaState() {
  if (state.scanPhotos.length) {
    el.mediaState.textContent = `${state.scanPhotos.length} room ${state.scanPhotos.length === 1 ? "photo is" : "photos are"} ready in this tab. They will be uploaded privately only after you confirm.`;
    el.cleanerPhotoPreview.disabled = !state.capabilities.mediaReady;
  } else {
    el.mediaState.textContent = "No room photo is available in this tab. Homle can save a private draft, but it cannot submit the request for matching until at least one current room photo is attached.";
    el.cleanerPhotoPreview.checked = false;
    el.cleanerPhotoPreview.disabled = true;
  }
}

function renderCheckout() {
  const mode = checkoutMode(state.capabilities);
  const copy = checkoutCopy(mode);
  el.confirm.textContent = copy.action;
  el.checkoutNote.textContent = copy.note;
  el.checkoutLede.textContent = "Check everything over before you save it. No payment is taken on this screen.";

  const rows = [
    ["Duration", `${Number(state.draft.durationMinutes) / 60} hours`],
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
  renderPropertyChoice();
  renderMediaState();
}

/* ── Capabilities ───────────────────────────────────── */
function dataUrlFile(photo) {
  const [header, encoded] = String(photo?.dataUrl || "").split(",", 2);
  if (!/^data:image\/jpeg;base64$/i.test(header || "") || !encoded) throw new TypeError(`The ${photo?.roomName || "room"} photo is no longer available. Scan that room again.`);
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], `${String(photo.roomName || "room").replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "room"}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
}

async function sha256(file) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function createOrRecoverProperty(csrf) {
  if (state.draft.propertyId) return state.draft.propertyId;
  const propertyType = el.propertyType.value;
  const addressLine1 = el.addressLine1.value.trim();
  const locality = el.locality.value.trim();
  const postcode = el.fullPostcode.value.trim();
  if (!propertyType || !addressLine1 || !locality || !isUkPostcode(postcode)) throw new TypeError("Choose the property type and enter its address, town and full UK postcode.");
  const entered = normalisedPostcode(postcode);
  const searched = normalisedPostcode(state.draft.postcode);
  if (!entered?.full || entered.outward !== searched?.outward) throw new TypeError("The cleaning address must be inside the postcode area you searched.");
  if (!state.draft.propertyDraftId) state.draft.propertyDraftId = randomId();
  saveDraft();
  try {
    const result = await requestJson("/api/marketplace/properties", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({
        id: state.draft.propertyDraftId,
        propertyType,
        addressLine1,
        locality,
        postcode
      })
    });
    if (!result.property?.propertyId) throw new Error("The saved property could not be verified.");
    state.properties.push(result.property);
    state.draft.propertyId = result.property.propertyId;
    saveDraft();
    return state.draft.propertyId;
  } catch (error) {
    if (!["request-timeout", "browser-offline"].includes(error?.code) && error?.statusCode !== 409) throw error;
    const result = await requestJson("/api/marketplace/properties");
    const recovered = (result.properties || []).find((property) => property.propertyId === state.draft.propertyDraftId);
    if (!recovered) throw error;
    state.properties = result.properties;
    state.draft.propertyId = recovered.propertyId;
    saveDraft();
    return recovered.propertyId;
  }
}

async function createOrRecoverRequest(csrf, propertyId) {
  if (!state.draft.requestId) state.draft.requestId = randomId();
  saveDraft();
  const window = requestedWindow(state.draft.date, state.draft.time, state.draft.durationMinutes);
  const tasks = requestTasksFromLines(state.draft.tasks.join("\n"));
  const payload = {
    id: state.draft.requestId,
    propertyId,
    ...window,
    cleaningType: state.draft.serviceCode,
    requiredServices: [state.draft.serviceCode],
    specialInstructions: state.draft.transcript,
    budgetPence: null,
    frequency: state.draft.frequency,
    tasks,
    submit: false
  };
  try {
    const result = await requestJson("/api/marketplace/cleaning-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify(payload)
    });
    if (result.cleaningRequest?.requestId !== state.draft.requestId) throw new Error("The saved request could not be verified.");
    return result.cleaningRequest;
  } catch (error) {
    if (!["request-timeout", "browser-offline"].includes(error?.code) && error?.statusCode !== 409) throw error;
    const result = await requestJson("/api/marketplace/cleaning-requests");
    const recovered = (result.cleaningRequests || []).find((request) => request.requestId === state.draft.requestId);
    if (!recovered) throw error;
    return recovered;
  }
}

async function uploadRoomPhotos(csrf, requestId) {
  const existing = await requestJson(`/api/marketplace/cleaning-requests/${encodeURIComponent(requestId)}/scan`);
  const attachedRooms = new Set((existing.scan?.photos || []).map((photo) => String(photo.roomName || "").trim().toLowerCase()));
  const reviewedRooms = new Set(requestTasksFromLines(state.draft.tasks.join("\n")).map((task) => task.roomName.toLowerCase()));
  const photos = state.scanPhotos.filter((photo) => reviewedRooms.has(String(photo.roomName || "").trim().toLowerCase()));
  let scan = existing.scan;
  for (let index = 0; index < photos.length; index += 1) {
    const photo = photos[index];
    if (attachedRooms.has(String(photo.roomName).trim().toLowerCase())) continue;
    el.checkoutState.textContent = `Securing room photo ${index + 1} of ${photos.length}…`;
    const file = dataUrlFile(photo);
    const intent = await requestJson(`/api/marketplace/cleaning-requests/${encodeURIComponent(requestId)}/photos/intents`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({
        roomName: photo.roomName,
        note: photo.note || "",
        mimeType: file.type,
        byteSize: file.size,
        checksumSha256: await sha256(file)
      })
    });
    const signed = intent.upload;
    if (signed?.method !== "PUT" || !signed.uploadId || !signed.uploadUrl || !signed.requiredHeaders) throw new Error("The secure room-photo instructions were incomplete.");
    const destination = new URL(signed.uploadUrl);
    if (destination.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(destination.hostname)) throw new Error("The secure room-photo destination was unsafe.");
    const uploadController = new AbortController();
    const uploadTimer = window.setTimeout(() => uploadController.abort(), 120_000);
    let uploaded;
    try {
      uploaded = await fetch(destination, {
        method: "PUT",
        headers: signed.requiredHeaders,
        body: file,
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: uploadController.signal
      });
    } catch (error) {
      if (error?.name === "AbortError") throw new Error(`The ${photo.roomName} photo upload took too long. Check your connection and try again.`);
      throw error;
    } finally {
      window.clearTimeout(uploadTimer);
    }
    if (!uploaded.ok) throw new Error(`The ${photo.roomName} photo did not reach private storage.`);
    const completed = await requestJson(`/api/marketplace/cleaning-requests/${encodeURIComponent(requestId)}/photos/${encodeURIComponent(signed.uploadId)}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: "{}"
    });
    scan = completed.scan;
    attachedRooms.add(String(photo.roomName).trim().toLowerCase());
  }
  if (!scan?.photos?.length) throw new Error("At least one current room photo is required before matching.");
  return scan;
}

function exactPriceLabel(pence) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(Number(pence) / 100);
}

function cleanerInvitationRecovery(error) {
  if (error?.code === "cleaner-payout-not-ready") {
    return "The request is safely submitted, but no payout-ready alternative Cleaner could be verified for this paid booking. No invitation or payment was created. Open your dashboard to keep matching.";
  }
  return `The request is safely submitted, but no Cleaner invitation was verified: ${error.message}`;
}

async function loadBestEligibleCleaner(requestId, excludeCleanerId = "") {
  const matches = await requestJson(`/api/marketplace/cleaning-requests/${encodeURIComponent(requestId)}/matches`);
  return bestAvailableCleaner(matches, { excludeCleanerId });
}

async function loadQuoteVerifiedAlternative(csrf, requestId, excludeCleanerIds = []) {
  const matches = await requestJson(`/api/marketplace/cleaning-requests/${encodeURIComponent(requestId)}/matches`);
  const candidates = rankedAvailableCleaners(matches, { excludeCleanerIds });
  return firstQuoteVerifiedCleaner(candidates, (candidate) => loadInvitationQuote(csrf, requestId, candidate.cleanerId));
}

async function loadInvitationQuote(csrf, requestId, cleanerId) {
  const quoted = await requestJson(`/api/marketplace/cleaning-requests/${encodeURIComponent(requestId)}/invitation-quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: JSON.stringify({ cleanerId })
  });
  const price = Number(quoted.quote?.customerPricePence);
  if (!Number.isInteger(price) || price < 1) throw new Error("The exact Cleaner invitation total could not be verified.");
  return price;
}

async function sendCleanerInvitation(csrf, requestId, cleanerId, approvedCustomerPricePence) {
  const result = await requestJson(`/api/marketplace/cleaning-requests/${encodeURIComponent(requestId)}/invitations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: JSON.stringify({ cleanerId, approvedCustomerPricePence })
  });
  if (Number(result.booking?.customerPricePence) !== approvedCustomerPricePence) throw new Error("The saved Cleaner invitation total could not be verified.");
  return result;
}

async function inviteSelectedCleaner(csrf, requestId) {
  if (!state.capabilities.matchingReady) return { invited: false, reason: "The reviewed request is safely open, but live Cleaner matching is temporarily unavailable. No invitation or payment was created." };
  let cleanerId = state.draft.cleanerId;
  let cleanerName = state.draft.cleanerName || "this Cleaner";
  if (cleanerId === "marketplace") {
    el.checkoutState.textContent = "Checking the best currently eligible Cleaner…";
    const best = await loadBestEligibleCleaner(requestId);
    if (!best) return { invited: false, reason: "No eligible Cleaner is available for the exact time and scope yet. Your reviewed request remains open and no payment was taken." };
    cleanerId = best.cleanerId;
    cleanerName = best.displayName;
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cleanerId)) return { invited: false, reason: "The reviewed request is safely open, but the selected Cleaner could not be verified. No invitation or payment was created." };
  const initiallySelectedCleanerId = cleanerId;
  const initiallySelectedCleanerName = cleanerName;
  let usedAlternative = false;
  let price;
  try {
    price = await loadInvitationQuote(csrf, requestId, cleanerId);
  } catch (error) {
    if (error?.code !== "cleaner-payout-not-ready") throw error;
    el.checkoutState.textContent = "That Cleaner cannot receive this paid booking. Checking the next eligible match…";
    const alternative = await loadQuoteVerifiedAlternative(csrf, requestId, [initiallySelectedCleanerId]);
    if (!alternative) throw error;
    cleanerId = alternative.cleaner.cleanerId;
    cleanerName = alternative.cleaner.displayName;
    price = alternative.customerPricePence;
    usedAlternative = true;
  }
  const approvalMessage = usedAlternative
    ? `${initiallySelectedCleanerName} cannot currently receive this paid booking.\n\nInvite ${cleanerName} instead for exactly ${exactPriceLabel(price)}?\n\nThis sends the frozen time, checklist and price for acceptance. No payment is taken now.`
    : `Invite ${cleanerName} for exactly ${exactPriceLabel(price)}?\n\nThis sends the frozen time, checklist and price for acceptance. No payment is taken now.`;
  const approved = window.confirm(approvalMessage);
  if (!approved) return { invited: false, reason: usedAlternative ? `You kept the submitted request open instead of inviting ${cleanerName}. No booking or payment exists.` : "You kept the submitted request open without inviting this Cleaner. No booking or payment exists." };
  try {
    await sendCleanerInvitation(csrf, requestId, cleanerId, price);
  } catch (error) {
    if (error?.code !== "cleaner-payout-not-ready") throw error;
    const unavailableCleanerName = cleanerName;
    el.checkoutState.textContent = "That Cleaner became unavailable before the offer was sent. Checking one final replacement...";
    const replacement = await loadQuoteVerifiedAlternative(csrf, requestId, [initiallySelectedCleanerId, cleanerId]);
    if (!replacement) throw error;
    const replacementName = replacement.cleaner.displayName;
    const replacementPrice = replacement.customerPricePence;
    const replacementApproved = window.confirm(`${unavailableCleanerName} became unavailable before Homle could send the offer.\n\nInvite ${replacementName} instead for exactly ${exactPriceLabel(replacementPrice)}?\n\nNo invitation or payment was created for ${unavailableCleanerName}. This sends the frozen time, checklist and price only if you approve.`);
    if (!replacementApproved) return { invited: false, reason: `You kept the submitted request open instead of inviting ${replacementName}. No invitation, booking or payment exists.` };
    await sendCleanerInvitation(csrf, requestId, replacement.cleaner.cleanerId, replacementPrice);
    cleanerId = replacement.cleaner.cleanerId;
    cleanerName = replacementName;
    price = replacementPrice;
    usedAlternative = true;
  }
  return { invited: true, reason: usedAlternative ? `${initiallySelectedCleanerName} was unavailable for this paid booking. ${cleanerName} now has the exact ${exactPriceLabel(price)} offer to accept or decline.` : `${cleanerName} has the exact ${exactPriceLabel(price)} offer to accept or decline.` };
}

async function confirmJourney() {
  if (state.confirming) return;
  state.confirming = true;
  el.confirm.disabled = true;
  el.checkoutState.hidden = false;
  el.checkoutState.textContent = "Checking your private account…";
  try {
    if (!state.signedIn) throw Object.assign(new Error("Sign in before saving this private request. Your answers remain in this tab."), { code: "sign-in-required" });
    const csrf = await recoverCsrf();
    const propertyId = await createOrRecoverProperty(csrf);
    el.checkoutState.textContent = "Saving the private request…";
    const request = await createOrRecoverRequest(csrf, propertyId);
    let submitted = false;
    let invitation = { invited: false, reason: "" };
    if (state.capabilities.mediaReady && state.scanPhotos.length) {
      await uploadRoomPhotos(csrf, request.requestId);
      el.checkoutState.textContent = "Submitting your reviewed room scope…";
      const result = await requestJson(`/api/marketplace/cleaning-requests/${encodeURIComponent(request.requestId)}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ scopeReviewed: true, cleanerPreviewAuthorized: el.cleanerPhotoPreview.checked })
      });
      submitted = result.submission?.status === "searching-for-cleaner";
      if (!submitted) throw new Error("The submitted request could not be verified.");
      try { invitation = await inviteSelectedCleaner(csrf, request.requestId); }
      catch (error) { invitation.reason = cleanerInvitationRecovery(error); }
    }

    try { sessionStorage.removeItem(draftKey); } catch {}
    state.draft.requestId = "";
    state.draft.propertyDraftId = "";
    state.scanPhotos = [];
    el.doneTitle.textContent = invitation.invited ? "Your Cleaner has been invited." : submitted ? "Your request is ready for matching." : "Your private draft is saved.";
    el.doneBody.textContent = invitation.reason || (submitted
      ? "The reviewed room photos and checklist are saved. A booking exists only after an eligible Cleaner accepts the exact time, work and price. No payment was taken."
      : "The checklist is on your dashboard. Add a current room photo there before submitting it for matching. Nothing was sent to a Cleaner and no payment was taken.");
    show("done");
  } catch (error) {
    const signInRequired = error?.code === "sign-in-required" || error?.code === "authentication-required" || error?.statusCode === 401;
    el.checkoutState.textContent = signInRequired
      ? "Your session ended while you were preparing this request. Sign in in the new tab, return here and press confirm again. Your room photos and answers remain in this tab."
      : `${error.message} No unverified invitation or payment was created. Your answers are still here.`;
    el.propertySignIn.hidden = !signInRequired;
  } finally {
    state.confirming = false;
    if (state.step !== "done") el.confirm.disabled = !state.signedIn;
  }
}

async function loadCapabilities() {
  try {
    const response = await fetch("/api/health", { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    state.capabilities = {
      mediaReady: payload?.marketplace?.mediaReady === true,
      matchingReady: payload?.marketplace?.matchingReady === true
    };
  } catch {}
}

async function loadAccount() {
  try {
    const accountResult = await requestJson("/api/marketplace/account");
    const accountState = journeyAccountState(accountResult.account);
    if (accountState !== "ready") return { status: accountState };
    const [propertyResult] = await Promise.all([
      requestJson("/api/marketplace/properties"),
      recoverCsrf()
    ]);
    state.signedIn = true;
    state.properties = Array.isArray(propertyResult.properties) ? propertyResult.properties : [];
    return { status: "ready" };
  } catch (error) {
    state.signedIn = false;
    state.properties = [];
    if (error?.statusCode === 401) return { status: "signed-out" };
    const message = [404, 503].includes(error?.statusCode)
      ? "Homle's private booking service is temporarily unavailable."
      : error?.message || "Your secure account could not be checked.";
    return { status: "unavailable", message };
  }
}

function showJourneyAccessFailure(message) {
  el.journeyShell.forEach((section) => { section.hidden = true; });
  el.accessGate.hidden = false;
  el.accessTitle.textContent = "Your secure account could not be checked.";
  el.accessCopy.textContent = `${message} Nothing was submitted. Check your connection and try again.`;
  el.accessRetry.hidden = false;
  el.accessSignIn.hidden = false;
}

async function openAuthenticatedJourney() {
  el.accessRetry.disabled = true;
  el.accessRetry.hidden = true;
  el.accessSignIn.hidden = true;
  el.accessTitle.textContent = "Checking your secure account…";
  el.accessCopy.textContent = "Your room scan opens only after Homle confirms this browser has a signed-in Landlord workspace.";
  const access = await loadAccount();
  if (access.status === "signed-out") {
    location.replace("/signup?intent=book");
    return false;
  }
  if (access.status === "role-required") {
    location.replace("/onboarding?intent=book");
    return false;
  }
  if (access.status !== "ready") {
    showJourneyAccessFailure(access.message);
    el.accessRetry.disabled = false;
    return false;
  }
  el.accessGate.hidden = true;
  el.journeyShell.forEach((section) => { section.hidden = false; });
  return true;
}

/* ── Wiring ─────────────────────────────────────────── */
for (const button of $$("[data-next]")) button.addEventListener("click", goNext);
el.confirm.addEventListener("click", confirmJourney);
el.duration.addEventListener("change", () => {
  state.draft.durationMinutes = Number(el.duration.value);
  saveDraft();
});
el.propertyNewToggle.addEventListener("click", () => {
  state.draft.propertyId = "";
  saveDraft();
  renderPropertyChoice();
  el.propertyType.focus();
});
el.accessRetry.addEventListener("click", async () => {
  if (await openAuthenticatedJourney()) show(state.step);
});
el.back.addEventListener("click", () => {
  readCurrentStep();
  const previous = previousStep(state.step);
  if (previous) show(previous);
});

restoreDraft();
if (!state.draft.cleanerId) {
  state.draft.cleanerId = "marketplace";
  state.draft.cleanerName = "Best available Cleaner";
}
const cameFromScan = adoptScan();
renderServices();
if (state.draft.postcode) {
  el.postcode.value = state.draft.postcode;
  const parsed = normalisedPostcode(state.draft.postcode);
  if (parsed) checkSupply(parsed.outward);
}
await loadCapabilities();
if (await openAuthenticatedJourney()) {
  show(state.step);
  if (cameFromScan) toast("Your scan is here. Check the checklist before continuing.");
}
