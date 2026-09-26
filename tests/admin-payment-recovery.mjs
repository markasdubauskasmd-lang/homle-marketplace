import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as model from "../public/admin-payments-model.js";

const paymentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const bookingId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const commandId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const command = { commandId, kind: "refund", status: "provider-pending", recoveryRequired: true,
  recoveryReason: "awaiting-signed-evidence", checkedAt: "2026-09-16T12:00:00Z" };
const record = { paymentId, bookingId, paymentStatus: "captured", bookingStatus: "completed", scheduledStartAt: "2026-09-15T09:00:00Z",
  scheduledEndAt: "2026-09-15T12:00:00Z", updatedAt: "2026-09-16T12:00:00Z", amountPence: 10000, amountCapturedPence: 10000,
  amountRefundedPence: 0, cleanerPayPence: 7000, currency: "gbp", payoutReady: true, canRefund: true, canTransfer: true };
const page = (payment = record, offset = 0) => ({ ok: true, payments: [payment], limit: 50, offset, testMode: true });
const held = { ...record, recoveryCommands: [command], reconciliationReviewRequired: true };
for (const [reason, explanation] of [
  ["awaiting-event-parent-identity", /Retry its delivery from Stripe/],
  ["payment-event-parent-mismatch", /different payment or payout instructions/],
  ["transfer-attempt-identity-unavailable", /original payout source or destination is unavailable/]
]) {
  const normalized = model.adminPaymentQueue(page({...record,
    recoveryCommands:[{...command,status:"reconciled",recoveryReason:reason}]})).payments[0];
  assert.equal(model.paymentNextAction(normalized).kind,"reconciliation-review");
  assert.equal(normalized.canRefund,false,"An earlier reconciled command bypassed a new identity hold");
  assert.equal(normalized.canTransfer,false);
  assert.match(model.paymentRecoveryReasonLabel(normalized.recoveryCommands[0].recoveryReason),explanation);
}
for (const value of [held, { ...record, recoveryCommands: [command] }, { ...record, reconciliationReviewRequired: true }]) {
  const normalized = model.adminPaymentQueue(page(value)).payments[0];
  assert.equal(model.paymentNextAction(normalized).kind, "reconciliation-review");
  assert.equal(normalized.canRefund, false);
  assert.equal(normalized.canTransfer, false);
  assert.equal(model.paymentDisputeHeld(normalized), false, "Reconciliation was mislabeled as a dispute");
}
const sanitized = model.adminPaymentQueue(page({ ...held, recoveryCommands: [{ ...command,
  providerPaymentId: "pi_private", sourceChargeId: "ch_private", token: "secret" }] })).payments[0];
assert.deepEqual(Object.keys(sanitized.recoveryCommands[0]).sort(), ["commandId", "kind", "status", "recoveryRequired", "recoveryReason", "checkedAt"].sort());
for (const commands of [[{ ...command, commandId: "bad" }], [command, command], [{ ...command, checkedAt: "bad" }],
  [{ ...command, recoveryRequired: "false" }], [{ ...command, recoveryReason: "<script>" }], Array(101).fill(command)]) {
  assert.throws(() => model.adminPaymentQueue(page({ ...record, recoveryCommands: commands })));
}

const source = readFileSync(new URL("../public/admin-payments.js", import.meta.url), "utf8");
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const recoverySource = extract("async function recoverCommand(", "function recoveryPanel(");
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
const observation = { providerObjectId: "re_external_review", kind: "refund", status: "pending", amountPence: 1000, appliedPence: 0, reason: null, lastEventId: "evt_external_review", requiresReview: true };
const observationHeld = { ...record, observations: [observation] };
const observedNormalized = model.adminPaymentQueue(page(observationHeld)).payments[0];
assert.equal(observedNormalized.canTransfer, false);
assert.equal(observedNormalized.canRefund, false);
// Run the actual queue renderer: a review-only external observation is an
// attention item even when it has neither a money action nor an app command.
for (const [requiresReview, expectedCount] of [[true, "1"], [false, "0"]]) {
  const nodes = new Map();
  const payment = model.adminPaymentQueue(page({ ...record, canRefund: false, canTransfer: false,
    observations: [{ ...observation, status: "succeeded", appliedPence: 1000, requiresReview }] })).payments[0];
  const context = vm.createContext({ ...model, queue: { payments: [payment], offset: 0, limit: 50 },
    list: { replaceChildren(){}, setAttribute(){} }, empty: {}, previous: {}, next: {},
    selectedBookingId: null, paymentCard: () => ({}), document: { querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, {}); return nodes.get(selector);
    } }
  });
  vm.runInContext(extract("function renderQueue()", "async function loadQueue("), context);
  context.renderQueue();
  assert.equal(nodes.get("[data-admin-payments-actionable-count]").textContent, expectedCount,
    "Observation-only review was omitted from the attention count, or settled history was counted");
}
for (const invalid of [{ ...observation, appliedPence: 1001 }, { ...observation, providerObjectId: "pi_wrong_kind" }, { ...observation, requiresReview: "false" }, { ...observation, lastEventId: "bad" }]) {
  assert.throws(() => model.adminPaymentQueue(page({ ...record, observations: [invalid] })));
}
for (const outcome of ["pending", "settled", "network", "wrong-payment", "refresh-failed", "refresh-superseded"]) {
  const auth = deferred(), calls = [], messages = [];
  const context = vm.createContext({ ...model, commanding: false, recoveringCommands: new Set(), uncertainPayments: new Set(),
    queue: { payments: [observationHeld], offset: 0 }, feedback: {}, renderQueue(){},
    showFeedback: (_target, message, kind) => messages.push({ message, kind }), recoverCsrf: () => auth.promise,
    requestJson: async (path, options) => {
      calls.push({ path, options });
      if (outcome === "network") throw Error("Synthetic timeout");
      return { recovery: { paymentId: outcome === "wrong-payment" ? bookingId : paymentId, recoveryRequired: outcome !== "settled" } };
    },
    loadQueue: async () => {
      if (outcome === "refresh-failed") throw Error("Synthetic refresh failure");
      if (outcome === "refresh-superseded") return false;
      context.uncertainPayments.clear(); return true;
    }
  });
  vm.runInContext(extract("async function replayObservations(", "function observationPanel("), context);
  const first = context.replayObservations(observationHeld);
  await context.replayObservations(observationHeld);
  assert.equal(calls.length, 0);
  auth.resolve("synthetic-csrf"); await first;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, `/api/marketplace/admin/payments/${paymentId}/observations/replay`);
  assert.equal(calls[0].options.body, "{}");
  assert.equal(calls[0].options.headers["X-CSRF-Token"], "synthetic-csrf");
  assert.equal(context.recoveringCommands.size, 0);
  assert.equal(messages.at(-1).kind, outcome === "settled" ? "success" : outcome === "pending" ? "info" : "error");
  if (!["settled", "pending"].includes(outcome)) assert(context.uncertainPayments.has(paymentId));
}
for (const outcome of ["pending", "settled", "network", "wrong-command", "refresh-failed", "refresh-superseded"]) {
  const auth = deferred(), calls = [], messages = [];
  const context = vm.createContext({ ...model, commanding: false, recoveringCommands: new Set(), uncertainPayments: new Set(),
    queue: { payments: [held], offset: 0 }, feedback: {}, list: { setAttribute(){} }, renderQueue(){},
    showFeedback: (_target, message, kind) => messages.push({message, kind}), recoverCsrf: () => auth.promise,
    requestJson: async (path, options) => {
      calls.push({path, options});
      if (outcome === "network") throw Error("Synthetic timeout");
      return {ok: true, recovery: { commandId: outcome === "wrong-command" ? bookingId : commandId, paymentId,
        recoveryRequired: outcome !== "settled", recoveryReason: command.recoveryReason }};
    },
    loadQueue: async () => {
      if (outcome === "refresh-failed") throw Error("Queue unavailable");
      if (outcome === "refresh-superseded") return false;
      context.queue = model.adminPaymentQueue(page(outcome === "settled" ? record : held));
      context.uncertainPayments.clear(); return true;
    }
  });
  vm.runInContext(recoverySource, context);
  const first = context.recoverCommand(held, command);
  await context.recoverCommand(held, command);
  assert.equal(calls.length, 0, "A repeat click passed session recovery");
  auth.resolve("synthetic-csrf"); await first;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, `/api/marketplace/admin/payment-commands/${commandId}/recover`);
  assert.equal(calls[0].options.body, "{}", "Browser supplied monetary or provider parameters");
  assert.equal(calls[0].options.headers["X-CSRF-Token"], "synthetic-csrf");
  assert.equal(context.recoveringCommands.size, 0);
  assert.equal(messages.at(-1).kind, outcome === "settled" ? "success" : outcome === "pending" ? "info" : "error");
  if (!["settled", "pending"].includes(outcome)) assert(context.uncertainPayments.has(paymentId));
  if (outcome === "pending") assert.equal(context.queue.payments[0].canRefund, false);
}

// A late queue response cannot replace newer holds, clear uncertainty or repaint
// money buttons using stale provider state.
{
  const waits = [], rendered = [];
  const context = vm.createContext({ ...model, queueRevision: 0, selectedBookingId: null, URLSearchParams, filter: {value: "actionable"},
    pageSize: 50, list: {setAttribute(){}}, uncertainPayments: new Set([paymentId]), queue: {},
    requestJson: () => { const wait = deferred(); waits.push(wait); return wait.promise; },
    renderQueue: () => rendered.push(context.queue)
  });
  vm.runInContext(extract("async function loadQueue(", "async function load()"), context);
  const first = context.loadQueue(), second = context.loadQueue();
  waits[1].resolve(page(held)); assert.equal(await second, true);
  waits[0].resolve(page(record)); assert.equal(await first, false);
  assert.equal(context.queue.payments[0].reconciliationReviewRequired, true);
  assert.equal(rendered.length, 1);
}

// The actual monetary submit is locked before asynchronous CSRF restoration,
// and it rechecks server-derived hold state before sending anything.
for (const newHold of [false, true]) {
  const auth = deferred(), calls = [];
  const context = vm.createContext({ ...model, commanding: false, recoveringCommands: new Set(), uncertainPayments: new Set(),
    selected: record, selectedKind: "transfer", queue: {payments: [record], offset: 0}, form: {}, submit: {}, cancel: {},
    FormData: class {get(name){return name === "confirmed" ? "on" : "";}}, retryKey: () => "a".repeat(40),
    recoverCsrf: () => auth.promise, clearRetryKey(){}, dialog: {close(){}}, renderQueue(){}, showFeedback(){}, feedback:{}, list:{setAttribute(){}},
    requestJson: async path => {calls.push(path);return {ok:true,command:{status:"provider-pending"}};}, loadQueue: async()=>true
  });
  vm.runInContext(extract("async function runSelectedAction(", 'form.addEventListener("submit"'), context);
  const first = context.runSelectedAction();
  await context.runSelectedAction();
  assert.equal(context.commanding, true);
  if (newHold) context.queue.payments = [held];
  auth.resolve("synthetic-csrf");
  if (newHold) await assert.rejects(first, /requires recovery review/); else await first;
  assert.equal(calls.length, newHold ? 0 : 1);
  assert.equal(context.commanding, false);
}
console.log("Administrator recovery checks passed: durable holds, safe evidence, GET-only route action, double clicks, failed refresh and stale-response guards.");

// A failing older refresh must not restore the pre-command queue over a newer
// signed ledger response. Repaint after releasing the shared command lock too.
for (const outcome of ["failed", "superseded", "success"]) {
  const refreshed = {...record,amountRefundedPence:2000,paymentStatus:"partially-refunded"};
  const rendered=[];
  const context=vm.createContext({...model,commanding:false,recoveringCommands:new Set(),uncertainPayments:new Set(),
    selected:record,selectedKind:"transfer",queue:{payments:[record],offset:0},form:{},submit:{},cancel:{},
    FormData:class{get(name){return name==="confirmed"?"on":"";}},retryKey:()=>"a".repeat(40),
    recoverCsrf:async()=>"synthetic-csrf",clearRetryKey(){},dialog:{close(){}},showFeedback(){},feedback:{},list:{setAttribute(){}},
    renderQueue:()=>rendered.push({locked:context.commanding,queue:context.queue}),
    requestJson:async()=>({ok:true,command:{status:"provider-pending"}}),
    loadQueue:async()=>{context.queue={payments:[refreshed],offset:0};context.uncertainPayments.clear();
      if(outcome==="failed")throw Error("Older refresh failed");return outcome==="success";}
  });
  vm.runInContext(extract("async function runSelectedAction(", 'form.addEventListener("submit"'),context);
  await context.runSelectedAction();
  assert.equal(context.queue.payments[0].amountRefundedPence,2000,"An older command refresh restored stale ledger totals");
  assert.equal(context.uncertainPayments.has(paymentId),outcome!=="success");
  assert.equal(rendered.at(-1).locked,false,"All queue controls stayed disabled after a completed action");
}
