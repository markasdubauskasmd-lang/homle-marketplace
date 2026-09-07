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
  console.log("Journey step focus passed: forward/back/history target the revealed heading; initial and same-step updates preserve focus.");
}
