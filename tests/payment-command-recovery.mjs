import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { canDispatchCommand, discoverCommandObject } from "../src/marketplace/payment-command-recovery.mjs";
import { dispatchPersistedPaymentCommand, recoverPersistedPaymentCommand } from "../src/marketplace/payment-command-dispatch.mjs";
import { createPaymentService } from "../src/marketplace/payment-service.mjs";
import { createStripePaymentProvider } from "../src/marketplace/stripe-payment-provider.mjs";

const commandId = "66666666-6666-4666-8666-666666666666";
const paymentId = "55555555-5555-4555-8555-555555555555";
const bookingId = "44444444-4444-4444-8444-444444444444";
const administrator = { userId: "22222222-2222-4222-8222-222222222222", roles: ["administrator"] };
const expected = { commandId, paymentId, bookingId, kind: "refund", amountPence: 2000, currency: "gbp", providerPaymentId: "pi_original_payment" };
const metadata = { tideway_command_id: commandId, tideway_payment_id: paymentId, tideway_booking_id: bookingId };
const originalRefund = { id: "re_original_refund", object: "refund", amount: 2000, currency: "gbp", metadata, payment_intent: expected.providerPaymentId, charge: "ch_original_charge", status: "succeeded" };
let calls, pages, intent, charge;
const stripe = {
  accounts: {}, accountLinks: {}, webhooks: {},
  paymentIntents: { async retrieve(id, params, options) { calls.push({ method: "GET-intent", id, options }); return intent; } },
  refunds: { async list(params, options) { calls.push({ method: "GET-refunds", params, options }); return pages.shift(); } },
  transfers: { async list(params, options) { calls.push({ method: "GET-transfers", params, options }); return pages.shift(); } },
  charges: { async retrieve(id, params, options) { calls.push({ method: "GET-charge", id, options }); return charge; } }
};
function reset(objects = [originalRefund]) {
  calls = []; pages = [{ object: "list", data: objects, has_more: false }];
  intent = { id: expected.providerPaymentId, object: "payment_intent", status: "succeeded", amount: 2000, amount_received: 2000, currency: "gbp", livemode: false, metadata };
  charge = { id: "ch_original_charge", payment_intent: intent.id, currency: "gbp", livemode: false, paid: true, captured: true, amount_captured: 12000 };
}
reset();
let found = await discoverCommandObject(stripe, expected);
assert.equal(found.outcome, "found-awaiting-signed-evidence");
assert.equal(found.providerObjectId, originalRefund.id);
assert.equal(found.evidence.source, "stripe-api-discovery");
assert(calls.every(call => call.method.startsWith("GET-")), "Recovery must never issue a provider mutation.");
assert(calls.every(call => call.options.timeout === 10000 && call.options.maxNetworkRetries === 0));
for (const status of ["pending", "requires_action", "failed", "canceled"]) {
  reset([{ ...originalRefund, status }]);
  found = await discoverCommandObject(stripe, expected);
  assert.equal(found.evidence.observedStatus, status);
  assert.equal(found.outcome, "found-awaiting-signed-evidence", "Unsigned snapshot must not fabricate a terminal ledger event.");
}
for (const patch of [{ amount: 1 }, { currency: "usd" }, { object: "transfer" },
  { metadata: { ...metadata, tideway_payment_id: bookingId } }, { payment_intent: "pi_wrong_payment" }, { status: "unknown" }]) {
  reset([{ ...originalRefund, ...patch }]);
  assert.equal((await discoverCommandObject(stripe, expected)).outcome, "operator-required");
}
reset(); intent.livemode = true;
assert.equal((await discoverCommandObject(stripe, expected)).reason, "parent-identity-conflict");
reset(); charge.payment_intent = "pi_other_payment";
assert.equal((await discoverCommandObject(stripe, expected)).reason, "charge-parent-conflict");
reset([]);
assert.equal((await discoverCommandObject(stripe, expected)).reason, "no-object-found-is-not-proof-of-no-effect");
reset(); pages = [{ object: "list", data: [{ ...originalRefund, id: "re_other_refund", metadata: {} }], has_more: true }, { object: "list", data: [originalRefund], has_more: false }];
assert.equal((await discoverCommandObject(stripe, expected)).providerObjectId, originalRefund.id);
assert.equal(calls.filter(call => call.method === "GET-refunds")[1].params.starting_after, "re_other_refund");
reset(); pages = [{ object: "list", data: [originalRefund], has_more: true }, { object: "list", data: [{ ...originalRefund, id: "re_duplicate_refund" }], has_more: false }];
assert.equal((await discoverCommandObject(stripe, expected)).reason, "multiple-command-objects");
reset(); pages[0].has_more = true; pages.push(pages[0]);
assert.equal((await discoverCommandObject(stripe, expected)).reason, "non-progressing-provider-page");
reset([]); pages[0].has_more = true;
assert.equal((await discoverCommandObject(stripe, expected)).reason, "non-progressing-provider-page");
reset(); pages[0].has_more = true;
assert.equal((await discoverCommandObject(stripe, expected, { maximumPages: 1 })).reason, "provider-pagination-bound");
reset(); let clockReads = 0;
assert.equal((await discoverCommandObject(stripe, expected, { now: () => clockReads++ ? 25001 : 0 })).reason, "provider-search-time-bound");
assert.equal(calls.filter(call => call.method === "GET-refunds").length, 0);
reset();
assert.equal((await discoverCommandObject(stripe, { ...expected, providerCommandId: "re_other_bound" })).reason, "bound-object-conflict");

const transferExpected = { ...expected, kind: "transfer", destinationAccountId: "acct_original_destination", sourceChargeId: "ch_original_charge" };
const transferObject = { id: "tr_original_transfer", object: "transfer", amount: 2000, currency: "gbp", metadata, livemode: false,
  destination: transferExpected.destinationAccountId, source_transaction: transferExpected.sourceChargeId,
  transfer_group: `tideway_booking_${bookingId}`, amount_reversed: 0, reversed: false };
for (const amount_reversed of [0, 2000]) {
  reset([{ ...transferObject, amount_reversed, reversed: amount_reversed === 2000 }]);
  found = await discoverCommandObject(stripe, transferExpected);
  assert.equal(found.evidence.observedReversedAmount, amount_reversed);
  assert.equal(found.outcome, "found-awaiting-signed-evidence");
}
reset([{ ...transferObject, amount_reversed: 1000 }]);
assert.equal((await discoverCommandObject(stripe, transferExpected)).reason, "partial-transfer-reversal-requires-accounting");
reset();
assert.equal((await discoverCommandObject(stripe, { ...transferExpected, sourceChargeId: null })).reason, "original-source-unavailable");
assert.equal(calls.length, 0, "Historical transfers cannot infer a new current source.");
reset([{ ...transferObject, destination: "acct_changed_destination" }]);
assert.equal((await discoverCommandObject(stripe, transferExpected)).reason, "transfer-parent-conflict");
for (const kind of ["capture", "cancel"]) {
  for (const status of ["succeeded", "canceled", "requires_capture", "processing", "requires_payment_method"]) {
    reset(); intent.status = status;
    found = await discoverCommandObject(stripe, { ...expected, kind });
    assert.equal(found.providerObjectId, expected.providerPaymentId);
    assert.equal(found.evidence.observedStatus, status);
    assert.equal(calls.length, 1);
  }
  reset(); intent.metadata = { ...metadata, tideway_command_id: bookingId };
  assert.equal((await discoverCommandObject(stripe, { ...expected, kind })).reason, "command-object-conflict");
}

assert.equal(canDispatchCommand({ action: "post", remainingMs: 61000 }, 100, 1100), false);
assert.equal(canDispatchCommand({ action: "post", remainingMs: 61001 }, 100, 1100), true);
assert.equal(canDispatchCommand({ action: "post", remainingMs: 24 * 3600000 }, 0, 0), false);
assert.equal(canDispatchCommand({ action: "recover", remainingMs: 999999 }, 0, 0), false);

let monetaryCalls = [], audited = [], hashes = [], preparedLookups = 0, discoveryReads = 0;
const request = { ...transferExpected, idempotencyKey: `tideway_payment_command_${commandId}` };
const persisted = { ...transferExpected, status: "created", providerCommandId: null, hasAttemptWindow: true, requestIdentity: request, legacyUnknown: false };
let state = persisted, remainingMs = 120000;
const repository = {
  async getCommandAttempt() { return state; },
  async getAdministratorCommandRecovery() { return state; },
  async claimCommandAttempt(actor, id, input) { assert.equal(id, commandId); hashes.push(input.requestHash.toString("hex")); return { action: remainingMs > 0 ? "post" : "recover", remainingMs, requestIdentity: input.identity }; },
  async recordCommand(actor, id, result) { return { commandId: id, paymentId, kind: state.kind, status: "provider-pending" }; },
  async recordCommandRecovery(actor, id, discovery) { audited.push(discovery); return { status: state.status, recoveryRequired: true, recoveryReason: discovery.reason || "awaiting-signed-evidence", signedEventsReplayed: 0 }; },
  async getByBooking() {}, async listForAdministrator() {}, async getForAdministratorBooking() {}, async beginAuthorization() {}, async recordAuthorization() {},
  async beginCommand() { throw Error("Recovery must not start a command"); }, async reconcileEvent() { throw Error("Recovery must not fabricate a webhook"); }
};
const provider = { name: "stripe", async prepareCommandAttempt() { preparedLookups++; throw Error("Current source must not be fetched on retry"); },
  async transfer(input) { monetaryCalls.push(input); return { id: "tr_original_transfer", status: "pending" }; },
  async discoverCommandObject(input) { discoveryReads++; return { outcome: "operator-required", reason: "awaiting-signed-evidence" }; },
  async createAuthorization() {}, async createSandboxCheckout() {}, async retrieveAuthorization() {}, async capture() {}, async cancel() {}, async refund() {}, async verifyWebhook() {}
};
const dispatch = () => dispatchPersistedPaymentCommand({ actor: administrator, prepared: { ...state, destinationAccountId: "acct_changed_current" }, kind: state.kind,
  request: { ...request, destinationAccountId: "acct_changed_current", sourceChargeId: "ch_changed_current" }, repository, provider,
  normalizeProviderCommand: result => ({ providerCommandId: result.id, status: result.status }) });
await dispatch();
state = { ...persisted, requestIdentity: Object.fromEntries(Object.entries(request).reverse()) };
await dispatch();
assert.equal(hashes[0], hashes[1], "JSONB property order must not change the immutable request hash.");
assert.equal(preparedLookups, 0);
assert.equal(monetaryCalls.length, 2);
assert(monetaryCalls.every(call => call.destinationAccountId === "acct_original_destination" && call.sourceChargeId === "ch_original_charge" && call.idempotencyKey === request.idempotencyKey));
remainingMs = 0;
await dispatch();
assert.equal(monetaryCalls.length, 2, "Expired commands must not make a monetary POST.");
state = { ...persisted, legacyUnknown: true, requestIdentity: null };
await dispatch();
assert.equal(monetaryCalls.length, 2);
state = { ...persisted, status: "reconciled", providerCommandId: "tr_original_transfer" };
await dispatch();
assert.equal(discoveryReads, 3, "Terminal local status cannot bypass recovery evidence.");
state = persisted;
const service = createPaymentService(repository, provider, { publishableKey: "pk_test_" + "p".repeat(32) });
await assert.rejects(service.recoverCommand({ ...administrator, roles: ["landlord"] }, commandId), error => error.statusCode === 403);
await assert.rejects(service.recoverCommand(administrator, "not-a-command"));
const result = await service.recoverCommand(administrator, commandId);
assert.deepEqual(Object.keys(result), ["commandId", "paymentId", "kind", "status", "recoveryRequired", "recoveryReason", "signedEventsReplayed"]);
assert.equal(monetaryCalls.length, 2);
const operation = { paymentId, bookingId, paymentStatus: "captured", bookingStatus: "completed", scheduledStartAt: "2026-09-20T09:00:00.000Z", scheduledEndAt: "2026-09-20T12:00:00.000Z",
  amountPence: 12000, currency: "gbp", amountCapturedPence: 12000, amountRefundedPence: 0, cleanerPayPence: 7200, payoutReady: true,
  canCapture: true, canCancel: true, canRefund: true, canTransfer: true, awaitingProvider: false, updatedAt: "2026-09-16T12:00:00.000Z",
  reconciliationReviewRequired: false, recoveryCommands: [{ commandId, kind: "transfer", status: "provider-pending", recoveryRequired: true,
    recoveryReason: "awaiting-signed-evidence", checkedAt: "2026-09-16T12:00:00.000Z", privateIdentity: "acct_do_not_expose" }] };
const queueService = createPaymentService({ ...repository, async listForAdministrator() { return { payments: [operation], limit: 50, offset: 0 }; },
  async getForAdministratorBooking() { return operation; } }, provider, { publishableKey: "pk_test_" + "p".repeat(32) });
for (const input of [{}, { bookingId }]) {
  const row = (await queueService.listForAdministrator(administrator, input)).payments[0];
  assert.equal(row.reconciliationReviewRequired, true);
  assert(!row.canCapture && !row.canCancel && !row.canRefund && !row.canTransfer);
  assert.equal(row.recoveryCommands[0].commandId, commandId);
  assert(!JSON.stringify(row).includes("acct_do_not_expose"));
}
const failedProvider = { ...provider, async discoverCommandObject() { throw Error("Bearer secret-private-provider-text"); } };
const failed = await recoverPersistedPaymentCommand({ actor: administrator, command: state, repository, provider: failedProvider });
assert.equal(failed.recoveryReason, "provider-recovery-unavailable");
assert(!JSON.stringify(audited).includes("secret-private"));
remainingMs = 120000;
const throwingDispatch = { ...provider, async transfer() { throw Error("indeterminate Stripe timeout"); } };
await dispatchPersistedPaymentCommand({ actor: administrator, prepared: state, kind: state.kind, request, repository, provider: throwingDispatch, normalizeProviderCommand: value => value });
assert.equal(audited.at(-1).reason, "provider-command-outcome-unknown");
const callsBeforeLostRecord = monetaryCalls.length;
const lostRecordRepository = { ...repository, async recordCommand() { throw Error("Database write lost after provider acceptance"); } };
const lostRecord = await dispatchPersistedPaymentCommand({ actor: administrator, prepared: state, kind: state.kind, request,
  repository: lostRecordRepository, provider, normalizeProviderCommand: value => value });
assert.equal(lostRecord.recoveryReason, "provider-command-outcome-unknown", "A failed post-provider ledger write must persist an indeterminate-outcome audit.");
assert.equal(monetaryCalls.length, callsBeforeLostRecord + 1, "Recording failure must not trigger a second monetary POST.");

// Real adapter command calls pin timeout/no implicit retry, and cancellation
// rechecks its budget after the first metadata POST consumes time.
reset(); const mutations = [];
const adapterClient = { ...stripe, paymentIntents: { ...stripe.paymentIntents,
  async capture(id, params, options) { mutations.push({ id, options }); return { id, status: "succeeded" }; },
  async update(id, params, options) { mutations.push({ id, options }); cancelInput.postDeadline = 0; return { id }; },
  async cancel(id, params, options) { mutations.push({ id, options }); return { id, status: "canceled" }; }
} };
const adapter = await createStripePaymentProvider({ secretKey: "sk_test_" + "a".repeat(32), webhookSecret: "whsec_" + "b".repeat(32) }, { stripeClient: adapterClient });
const captureInput = { ...expected, idempotencyKey: `tideway_payment_command_${commandId}`, postDeadline: performance.now() + 120000 };
await adapter.capture(captureInput);
assert.deepEqual(mutations[0].options, { timeout: 10000, maxNetworkRetries: 0, idempotencyKey: captureInput.idempotencyKey });
const cancelInput = { ...captureInput };
await assert.rejects(adapter.cancel(cancelInput), error => error.code === "payment-attempt-deadline");
assert.equal(mutations.length, 2, "Cancellation must stop after metadata POST if dispatch window expires.");
await assert.rejects(adapter.capture({ ...captureInput, postDeadline: 0 }), error => error.code === "payment-attempt-deadline");
await assert.rejects(adapter.refund({ ...captureInput, postDeadline: 0 }), error => error.code === "payment-attempt-deadline");
await assert.rejects(adapter.transfer({ ...captureInput, sourceChargeId: "ch_original_charge", destinationAccountId: "acct_original_destination", postDeadline: 0 }), error => error.code === "payment-attempt-deadline");
assert.equal(mutations.length, 2);
console.log("Payment command recovery passed: GET-only bounded discovery, signed-evidence boundary, frozen retries, deadline/SDK guards, durable failure audit and administrator-only service.");
