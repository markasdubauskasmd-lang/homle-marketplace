import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
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
    renderPremiumChoices() {},
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
