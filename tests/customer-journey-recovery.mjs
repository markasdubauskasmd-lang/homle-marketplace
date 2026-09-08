import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { requestedWindow, requestTasksFromLines } from "../public/landlord-dashboard-model.js";
import { premiumBaseTasks } from "../public/scan-premium-selection.js";

// Exercise the actual customer handlers with deferred directory responses.
// No browser, account, network requests or booking mutations are involved.
const script = await readFile(new URL("../public/landlord-journey.js", import.meta.url), "utf8");
const section = (from, until) => script.slice(script.indexOf(from), script.indexOf(until, script.indexOf(from)));
function element() {
  return {
    textContent: "", innerHTML: "", hidden: false, disabled: false, dataset: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {} },
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; },
    setAttribute() {}, addEventListener() {}
  };
}
function harness() {
  const requests = [];
  const state = { scanPremiumPlan: { options: [], groups: [], baseTasks: [] }, draft: { outward: "SM4", propertyId: "one", cleanerId: "marketplace", tasks: [], rooms: [], transcript: "" } };
  const el = Object.fromEntries(["propertyNext", "supply", "supplyHead", "supplyDetail", "cleaners", "cleanerState", "cleanerLede", "resultsEyebrow", "resultsTitle", "resultsIntro", "resultsSource", "tasks"].map(key => [key, element()]));
  const context = vm.createContext({
    state, el, URLSearchParams, premiumBaseTasks,
    renderPremiumChoices() {}, renderRoomNotes() {},
    DIRECTORY_REQUEST_TIMEOUT_MS: 8000,
    requestJson(url) { return new Promise((resolve, reject) => requests.push({ url, resolve, reject })); },
    supplyMessage(count, outward) { return { headline: count + " near " + outward, detail: "Checked", available: count > 0 }; },
    renderScanPropertyChoice() { el.propertyNext.disabled = !state.draft.propertyId || state.supplyPending; },
    renderCleaner() {}, saveDraft() {}, updateResultTotals() {},
    document: { createElement: element }
  });
  vm.runInContext(section("let supplyLookup", "/* ── Step 2") + section("let cleanerLookup", "function renderCleaner(") + section("function renderResults()", "function updateResultTotals()"), context);
  return { context, state, el, requests };
}
{
  const { context, state, el, requests } = harness();
  const first = context.checkSupply("SM4");
  assert.equal(el.propertyNext.disabled, true);
  state.draft.outward = "SW1";
  const second = context.checkSupply("SW1");
  requests[0].resolve({ cleaners: [] });
  await first;
  assert.equal(el.propertyNext.disabled, true, "An old response unlocked the newer property's pending check.");
  assert.match(el.supplyHead.textContent, /SW1/);
  requests[1].resolve({ cleaners: [{}] });
  await second;
  assert.equal(el.supplyHead.textContent, "1 near SW1");
  assert.equal(el.propertyNext.disabled, false);
}
{
  const { context, state, el, requests } = harness();
  const first = context.checkSupply("SM4");
  state.draft.outward = "SW1";
  const second = context.checkSupply("SW1");
  requests[1].resolve({ cleaners: [] });
  await second;
  requests[0].reject(new Error("late timeout"));
  await first;
  assert.equal(el.supplyHead.textContent, "0 near SW1", "A stale failure replaced the current coverage result.");
  const failed = context.checkSupply("SW1");
  requests[2].reject(new Error("timeout"));
  await failed;
  assert.match(el.supplyHead.textContent, /could not be checked/);
  assert.equal(el.propertyNext.disabled, false, "A timeout trapped the customer.");
}
{
  const { context, state, el, requests } = harness();
  state.draft.cleanerId = "old-profile";
  const first = context.loadCleaners();
  assert.equal(state.cleanersPending, true);
  const second = context.loadCleaners();
  requests[1].resolve({ cleaners: [] });
  await second;
  requests[0].resolve({ cleaners: [{ cleanerId: "old-profile" }] });
  await first;
  assert.equal(state.draft.cleanerId, "marketplace", "An unavailable profile stayed selected.");
  assert.equal(state.cleanersPending, false);
  assert.equal(el.cleanerState.children[2].href, "/landlord/help");
  assert.doesNotMatch(el.cleanerLede.textContent, /are free/);
  const failed = context.loadCleaners();
  requests[2].reject(new Error("timeout"));
  await failed;
  assert.equal(state.cleanersPending, false);
  assert.equal(el.cleanerState.children.at(-1).textContent, "Try again");
}
{
  const { context, state, el } = harness();
  state.draft.tasks = ["Kitchen: clean surfaces"];
  context.renderResults();
  assert.match(el.resultsTitle.innerHTML, /What needs/);
  assert.equal(el.resultsSource.textContent, "Written by you");
  assert.equal(el.tasks.value, "Kitchen: clean surfaces");
  state.draft.rooms = [{}];
  context.renderResults();
  assert.match(el.resultsTitle.innerHTML, /we found/);
  assert.match(el.resultsSource.textContent, /scan/);
}
console.log("Customer journey recovery: stale success/failure, timeout recovery, selection fallback and manual entry passed.");

const initialCleaner = "22222222-2222-4222-8222-222222222222";
const replacementCleaner = "33333333-3333-4333-8333-333333333333";
const savedRequest = "66666666-6666-4666-8666-666666666666";
function invitationHarness({ found = true, approve = true, invitationError = null, changedPrice = false, replacement = null } = {}) {
  const network = [], approvals = [];
  let writes = 0;
  const ctx = vm.createContext({
    state: { capabilities: { matchingReady: true }, draft: { cleanerId: "marketplace", cleanerName: "Best available Cleaner" } },
    el: { checkoutState: { textContent: "" } },
    exactPriceLabel: pence => "GBP " + (pence / 100).toFixed(2),
    loadBestEligibleCleaner: async () => found ? { cleanerId: initialCleaner, displayName: "First Cleaner" } : null,
    loadQuoteVerifiedAlternative: async () => replacement,
    window: { confirm(message) { approvals.push(message); return typeof approve === "function" ? approve(approvals.length) : approve; } },
    requestJson: async (url, options) => {
      const body = JSON.parse(options.body);
      network.push({ url, body });
      if (url.endsWith("/invitation-quote")) return { quote: { customerPricePence: 7300 } };
      if (url.endsWith("/invitations")) {
        writes += 1;
        if (invitationError && writes === 1) throw invitationError;
        return { booking: { customerPricePence: changedPrice ? 7400 : body.approvedCustomerPricePence } };
      }
      throw Error("Unexpected route");
    }
  });
  vm.runInContext(section("function cleanerInvitationRecovery(", "async function loadBestEligibleCleaner(") + section("async function loadInvitationQuote(", "async function confirmJourney("), ctx);
  return { ctx, network, approvals, writes: () => writes };
}
{
  const h = invitationHarness({ found: false });
  const outcome = await h.ctx.inviteSelectedCleaner("csrf", savedRequest);
  assert.equal(outcome.invited, false);
  assert.match(outcome.reason, /No eligible Cleaner/);
  assert.equal(h.network.length, 0, "Empty capacity wrote an invitation or manufactured a quote.");
  assert.equal(h.approvals.length, 0);
}
{
  const h = invitationHarness({ approve: false });
  const outcome = await h.ctx.inviteSelectedCleaner("csrf", savedRequest);
  assert.equal(outcome.invited, false);
  assert.equal(h.network.length, 1, "Declining exact terms sent an invitation.");
  assert.match(h.approvals[0], /exactly GBP 73.00/);
}
{
  const h = invitationHarness();
  const outcome = await h.ctx.inviteSelectedCleaner("csrf", savedRequest);
  assert.equal(outcome.invited, true);
  assert.equal(h.writes(), 1);
  assert.equal(h.network[1].body.cleanerId, initialCleaner);
  assert.equal(h.network[1].body.approvedCustomerPricePence, 7300, "Invitation did not use the exact approved quote.");
}
{
  const h = invitationHarness({ changedPrice: true });
  await assert.rejects(() => h.ctx.inviteSelectedCleaner("csrf", savedRequest), /saved Cleaner invitation total could not be verified/);
  assert.equal(h.writes(), 1, "Mismatched response triggered another invitation.");
}
{
  const h = invitationHarness({ invitationError: Object.assign(Error("response may have reached Homle"), { code: "request-timeout" }) });
  let caught;
  try { await h.ctx.inviteSelectedCleaner("csrf", savedRequest); } catch (error) { caught = error; }
  assert(caught);
  assert.equal(h.writes(), 1, "Uncertain invitation was automatically repeated.");
  assert.match(h.ctx.cleanerInvitationRecovery(caught), /no Cleaner invitation was verified/);
}
{
  const h = invitationHarness({
    invitationError: Object.assign(Error("payout changed"), { code: "cleaner-payout-not-ready" }),
    replacement: { cleaner: { cleanerId: replacementCleaner, displayName: "Replacement Cleaner" }, customerPricePence: 8900 },
    approve: n => n === 1
  });
  const outcome = await h.ctx.inviteSelectedCleaner("csrf", savedRequest);
  assert.equal(outcome.invited, false);
  assert.equal(h.writes(), 1, "Replacement was invited without fresh price approval.");
  assert.equal(h.approvals.length, 2);
  assert.match(h.approvals[1], /Replacement Cleaner.*exactly GBP 89.00/s);
}
console.log("Customer invitation contract passed: empty capacity, declined exact price, approved amount, mismatch, uncertainty and replacement consent.");


// Run the actual step transition. Forward, in-app Back and browser history
// must leave focus in the revealed step, not on a hidden button or body.
{
  let focused = null;
  const headings = Object.fromEntries(["postcode", "service", "results", "when", "cleaner", "checkout", "done"].map(id => [id, {
    attributes: {}, setAttribute(key, value) { this.attributes[key] = value; },
    focus(options) { assert.equal(options.preventScroll, true); focused = id; }
  }]));
  const sections = Object.entries(headings).map(([id, heading]) => ({
    dataset: { step: id }, hidden: id !== "postcode",
    querySelector(selector) { assert.equal(selector, "h2"); return heading; }
  }));
  const state = { step: "postcode" };
  const el = { rail: { innerHTML: "", appendChild() {}, setAttribute() {} },
    stepLabel: {}, back: {}, exit: {} };
  const history = [];
  const context = vm.createContext({
    state, el, $$: () => sections,
    document: { createElement: () => ({ appendChild() {} }) },
    window: { scrollTo() {} }, railState: () => [true, false],
    stepIndex: id => Object.keys(headings).indexOf(id), stepLabel: id => id,
    previousStep: id => id === "postcode" ? null : "previous",
    saveDraft() {}, renderResults() {}, renderScanPropertyChoice() {},
    renderWhen() {}, loadCleaners() {}, renderCheckout() {},
    syncJourneyHistory: (id, mode) => history.push({ id, mode })
  });
  vm.runInContext(section("function show(", "function goNext("), context);
  context.show("postcode", "replace");
  assert.equal(focused, null, "Initial same-step rendering stole focus");
  for (const id of ["service", "results", "when", "cleaner", "checkout", "done"]) {
    context.show(id);
    assert.equal(focused, id);
    assert.equal(headings[id].attributes.tabindex, "-1");
    assert.equal(sections.filter(s => !s.hidden).length, 1);
  }
  context.show("results", "replace");
  assert.equal(focused, "results", "In-app Back lost the step heading");
  context.show("service", "none");
  assert.equal(focused, "service", "Browser history lost the step heading");
  focused = "typed-input";
  context.show("service", "replace");
  assert.equal(focused, "typed-input", "Same-step refresh stole focus from an input");
  assert.equal(history.at(-2).mode, "none");
  assert.equal(history.at(-1).mode, "replace");
  state.confirming = true;
  context.show("when");
  assert.equal(state.step, "service", "Pending confirmation allowed a direct step transition");
  context.show("done");
  assert.equal(state.step, "done", "Pending confirmation blocked its completion");
  console.log("Journey step focus passed: forward/back/history target the revealed heading; initial and same-step updates preserve focus.");
}


// Empty scope is a persistent field error. Run the actual Continue and input
// handlers so correction, repeated attempts and focus use the real wiring.
{
  const attributes = {};
  let focused = false, inputHandler, next = null, toastCalls = 0;
  const el = { tasksError: { textContent: "", hidden: true }, tasks: {
    value: "", setAttribute(name, value) { attributes[name] = value; },
    removeAttribute(name) { delete attributes[name]; },
    focus() { focused = true; }, setCustomValidity() {},
    addEventListener(name, handler) { assert.equal(name, "input"); inputHandler = handler; }
  } };
  const state = { step: "results", draft: { tasks: [] } };
  const context = vm.createContext({
    el, state, validatePremiumChecklist: () => true,
    readCurrentStep: () => { state.draft.tasks = el.tasks.value.split("\n").map(s => s.trim()).filter(Boolean); },
    canLeaveStep: () => state.draft.tasks.length > 0,
    blockedReason: () => "Add at least one room task before continuing.",
    toast() { toastCalls++; }, stepIndex: () => 0, journeySteps: [{ id: "results" }, { id: "when" }],
    show: id => { next = id; }, invalidateScanRequest() {}, updateResultTotals() {}
  });
  vm.runInContext(section("function setChecklistError(", "function readCurrentStep(")
    + section('el.tasks.addEventListener("input"', "function eligiblePremiumSelections("), context);
  context.goNext();
  assert.equal(next, null);
  assert.equal(focused, true);
  assert.equal(attributes["aria-invalid"], "true");
  assert.equal(el.tasksError.hidden, false);
  assert.equal(el.tasksError.textContent, "Add at least one room task before continuing.");
  assert.equal(toastCalls, 0, "Blocking checklist error still relies on a disappearing toast");
  el.tasks.value = " \n ";
  inputHandler();
  assert.equal(el.tasksError.hidden, false, "Whitespace cleared the unresolved validation error");
  context.goNext();
  assert.equal(next, null, "Repeated attempts bypassed empty scope validation");
  el.tasks.value = "Kitchen: clean worktops";
  inputHandler();
  assert.equal(el.tasksError.hidden, true);
  assert.equal(el.tasksError.textContent, "");
  assert.equal(attributes["aria-invalid"], undefined);
  context.goNext();
  assert.equal(next, "when", "A corrected checklist could not continue");
  const html = await readFile(new URL("../public/landlord-journey.html", import.meta.url), "utf8");
  assert.match(html, /data-tasks aria-describedby="tasks-hint tasks-error"/);
  assert.match(html, /id="tasks-hint" data-task-hint/);
  assert.match(html, /id="tasks-error" data-tasks-error hidden/);
  console.log("Checklist validation passed: persistent associated error, focus, whitespace/retry blocking and correction recovery.");
}


// A scope edit after a saved request must not recover the old request by ID.
// Exercise the actual duration handler and request save/recovery path together.
{
  let durationChange, sequence = 0;
  const records = new Map(), payloads = [];
  const state = {
    scanSessionId: "", scanRooms: [],
    draft: { requestId: "", propertyId: "20000000-0000-4000-8000-000000000001",
      serviceCode: "regular-domestic", date: "2026-10-08", time: "09:00",
      durationMinutes: 120, frequency: "one-time", tasks: ["Kitchen: clean worktops"], transcript: "" }
  };
  const el = { duration: { value: "120", addEventListener(name, handler) { assert.equal(name, "change"); durationChange = handler; } } };
  const context = vm.createContext({
    state, el, requestedWindow, requestTasksFromLines, saveDraft() {},
    randomId: () => "30000000-0000-4000-8000-" + String(++sequence).padStart(12, "0"),
    requestJson: async (url, options) => {
      if (!options) return { cleaningRequests: [...records.values()] };
      const payload = JSON.parse(options.body);
      payloads.push(payload);
      if (records.has(payload.id)) throw Object.assign(new Error("Already saved"), { statusCode: 409 });
      const record = { requestId: payload.id, requestedStartAt: payload.requestedStartAt, requestedEndAt: payload.requestedEndAt };
      records.set(payload.id, record);
      return { cleaningRequest: record };
    }
  });
  vm.runInContext(section("function setRequestScopeValue(", "function currentNoteLines(")
    + section('el.duration.addEventListener("change"', "el.propertyNewToggle.addEventListener")
    + section("async function createOrRecoverRequest(", "// Saves what the scan actually saw"), context);
  const first = await context.createOrRecoverRequest("test-csrf", state.draft.propertyId);
  state.scanSessionId = "scan-for-two-hour-request";
  el.duration.value = "240";
  durationChange();
  assert.equal(state.draft.requestId, "");
  assert.equal(state.scanSessionId, "");
  const second = await context.createOrRecoverRequest("test-csrf", state.draft.propertyId);
  assert.notEqual(first.requestId, second.requestId, "An edited request reused the old saved identity");
  assert.equal(new Date(first.requestedEndAt) - new Date(first.requestedStartAt), 120 * 60000);
  assert.equal(new Date(second.requestedEndAt) - new Date(second.requestedStartAt), 240 * 60000);
  state.scanSessionId = "scan-for-four-hour-request";
  durationChange(); // Same value: a harmless event must preserve retry identity.
  assert.equal(state.draft.requestId, second.requestId);
  assert.equal(state.scanSessionId, "scan-for-four-hour-request");
  const retry = await context.createOrRecoverRequest("test-csrf", state.draft.propertyId);
  assert.equal(retry.requestId, second.requestId);
  assert.equal(records.size, 2, "An unchanged retry created another draft");
  assert.equal(payloads.at(-1).id, second.requestId);

  for (const [field, value] of Object.entries({
    propertyId: "20000000-0000-4000-8000-000000000002", serviceCode: "deep-cleans",
    date: "2026-10-09", time: "10:00", frequency: "weekly", durationMinutes: 180
  })) {
    state.draft.requestId = "old-request"; state.scanSessionId = "old-scan";
    context.setRequestScopeValue(field, value);
    assert.equal(state.draft[field], value);
    assert.equal(state.draft.requestId, "", field + " retained an old request");
    assert.equal(state.scanSessionId, "", field + " retained an old scan");
    state.draft.requestId = "unchanged-request"; state.scanSessionId = "unchanged-scan";
    context.setRequestScopeValue(field, value);
    assert.equal(state.draft.requestId, "unchanged-request", field + " broke unchanged retries");
    assert.equal(state.scanSessionId, "unchanged-scan");
  }
  // Every direct assignment for these fields must pass through the same helper,
  // including automatic stale-date/property corrections and chip selection.
  assert.doesNotMatch(script, /state\.draft\.(propertyId|serviceCode|date|time|frequency|durationMinutes) = /);
  assert.match(script, /setRequestScopeValue\(field, item.code\)/);
  console.log("Journey scope recovery passed: edits create a new exact-scope request; unchanged retry recovers the same record, and all scoped fields clear stale scan identity.");
}


// Optional photos use the existing submission contract. Test the actual final
// handler, with explicit fixture services and no real requests or invitations.
function confirmationHarness({ matchingReady = true, mediaReady = false, photos = [], uploadError = null, submitStatus = "searching-for-cleaner", csrfRecovery = async () => "fixture-csrf" } = {}) {
  const calls = [];
  const state = { signedIn: true, confirming: false, step: "checkout", scanRooms: [],
    scanPhotos: [...photos], capabilities: { matchingReady, mediaReady }, draft: {} };
  const el = Object.fromEntries(["back", "confirm", "checkoutState", "cleanerPhotoPreview", "doneTitle", "doneBody", "propertySignIn", "propertyType"].map(key => [key, { disabled: false }]));
  el.cleanerPhotoPreview.checked = true; // Stale UI consent cannot authorize absent photos.
  const ctx = vm.createContext({
    state, el,
    recoverCsrf: csrfRecovery,
    $$: () => [el.confirm, el.cleanerPhotoPreview, el.propertyType],
    createOrRecoverProperty: async () => "fixture-property",
    createOrRecoverRequest: async () => { calls.push({ kind: "save" }); return { requestId: "fixture-request" }; },
    saveStructuredScanWithRetry: async () => true,
    uploadRoomPhotos: async () => { calls.push({ kind: "upload" }); if (uploadError) throw uploadError; },
    requestJson: async (url, options) => { calls.push({ kind: "submit", url, body: JSON.parse(options.body) }); return { submission: { status: submitStatus } }; },
    inviteSelectedCleaner: async () => { calls.push({ kind: "invitation-review" }); return { invited: false, reason: "" }; },
    cleanerInvitationRecovery: error => error.message,
    discardDraft: () => calls.push({ kind: "discard" }),
    show: step => { state.step = step; }
  });
  vm.runInContext(section("function lockConfirmationControls()", "async function loadCapabilities()"), ctx);
  return { ctx, calls, state, el };
}
{
  const { ctx, calls, state, el } = confirmationHarness();
  await Promise.all([ctx.confirmJourney(), ctx.confirmJourney()]);
  assert.deepEqual(calls.map(c => c.kind), ["save", "submit", "invitation-review", "discard"]);
  assert.deepEqual(calls.find(c => c.kind === "submit").body, { scopeReviewed: true, cleanerPreviewAuthorized: false });
  assert.equal(state.step, "done");
  assert.equal(el.doneTitle.textContent, "Your request is ready for matching.");
  assert(!/photo.*required|Add a current room photo/.test(el.doneBody.textContent));
}
for (const photos of [[], [{ id: "synthetic-photo" }]]) {
  const { ctx, calls, el } = confirmationHarness({ matchingReady: false, mediaReady: true, photos });
  await ctx.confirmJourney();
  assert.equal(calls.some(c => c.kind === "submit" || c.kind === "invitation-review"), false, "Draft-only mode submitted a request");
  assert.equal(calls.filter(c => c.kind === "upload").length, photos.length ? 1 : 0);
  assert.equal(el.doneTitle.textContent, "Your private draft is saved.");
}
{
  const { ctx, calls } = confirmationHarness({ mediaReady: true, photos: [{ id: "synthetic-photo" }] });
  await ctx.confirmJourney();
  assert.deepEqual(calls.map(c => c.kind), ["save", "upload", "submit", "invitation-review", "discard"]);
  assert.equal(calls.find(c => c.kind === "submit").body.cleanerPreviewAuthorized, true);
}
for (const options of [
  { mediaReady: false },
  { mediaReady: true, uploadError: new Error("Upload failed") }
]) {
  const { ctx, calls, state, el } = confirmationHarness({ ...options, photos: [{ id: "synthetic-photo" }] });
  await ctx.confirmJourney();
  assert.equal(calls.some(c => ["submit", "invitation-review", "discard"].includes(c.kind)), false);
  assert.equal(state.scanPhotos.length, 1, "Unavailable or failed upload discarded selected photos");
  assert.equal(state.step, "checkout");
  assert.equal(state.confirming, false);
  assert.equal(el.confirm.disabled, false);
}
{
  const { ctx, calls, state } = confirmationHarness({ submitStatus: "draft" });
  await ctx.confirmJourney();
  assert.equal(calls.some(c => ["invitation-review", "discard"].includes(c.kind)), false);
  assert.equal(state.step, "checkout", "Unverified submission looked successful");
}
console.log("Manual fallback submission passed: optional photos, no implicit preview consent, draft-only mode, upload order/failure retention, verified submission and double-click lock.");


// Delay the account response while exercising the actual Back/history wiring.
// The pending save owns its reviewed scope; failure must release all controls.
for (const fail of [false, true]) {
  let settle, backHandler, historyHandler;
  const { ctx, calls, state, el } = confirmationHarness({
    matchingReady: false, csrfRecovery: () => new Promise((resolve, reject) => {
      settle = () => fail ? reject(new Error("Account response failed")) : resolve("fixture-csrf");
    })
  });
  el.cleanerPhotoPreview.disabled = true; // Preserve an already unavailable control.
  let reads = 0;
  const history = [];
  el.back.addEventListener = (_name, handler) => { backHandler = handler; };
  Object.assign(ctx, {
    window: { addEventListener: (_name, handler) => { historyHandler = handler; } },
    readCurrentStep: () => { reads++; },
    previousStep: () => "cleaner",
    stepIndex: () => 1,
    syncJourneyHistory: (step, mode) => history.push({ step, mode })
  });
  vm.runInContext(section('el.back.addEventListener(', "restoreDraft();"), ctx);
  const pending = ctx.confirmJourney();
  assert.equal(state.confirming, true);
  for (const control of [el.back, el.confirm, el.cleanerPhotoPreview, el.propertyType]) {
    assert.equal(control.disabled, true, "A pending request left a scope control enabled");
  }
  backHandler();
  historyHandler({ state: { journeyStep: "when" } });
  assert.equal(state.step, "checkout", "Pending confirmation allowed a scope edit step");
  assert.equal(reads, 0);
  assert.deepEqual(history, [{ step: "checkout", mode: "replace" }]);
  assert.equal(calls.length, 0, "The deferred account response was bypassed");
  settle();
  await pending;
  assert.equal(state.confirming, false);
  assert.equal(el.back.disabled, false);
  assert.equal(el.propertyType.disabled, false);
  assert.equal(el.cleanerPhotoPreview.disabled, true, "Recovery enabled an unavailable choice");
  assert.equal(state.step, fail ? "checkout" : "done");
  if (fail) {
    assert.equal(calls.length, 0);
    assert.equal(el.confirm.disabled, false);
    backHandler();
    assert.equal(state.step, "cleaner", "Failed confirmation left Back locked");
    assert.equal(reads, 1, "Recovered Back did not preserve current answers");
    historyHandler({ state: { journeyStep: "when" } });
    assert.equal(state.step, "when", "Recovered history remained locked");
    assert.equal(reads, 2, "Recovered history did not preserve current answers");
  }
}
console.log("Pending confirmation passed: scope controls and Back/history lock before await, and failure restores editing without enabling unavailable choices.");
