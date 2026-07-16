import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createPaymentService } from "../src/marketplace/payment-service.mjs";

const landlord = { userId: "11111111-1111-4111-8111-111111111111", roles: ["landlord"] };
const administrator = { userId: "22222222-2222-4222-8222-222222222222", roles: ["administrator"] };
const cleaner = { userId: "33333333-3333-4333-8333-333333333333", roles: ["cleaner"] };
const bookingId = "44444444-4444-4444-8444-444444444444";
const paymentId = "55555555-5555-4555-8555-555555555555";
const commandIds = [
  "66666666-6666-4666-8666-666666666666",
  "77777777-7777-4777-8777-777777777777",
  "88888888-8888-4888-8888-888888888888",
  "99999999-9999-4999-8999-999999999999"
];
const calls = [];
let idIndex = 0;

const repository = {
  async getByBooking(actor, selectedBookingId) {
    calls.push({ kind: "get-payment", actor, selectedBookingId });
    return { paymentId, bookingId: selectedBookingId, status: "authorized", amountPence: 12_000, currency: "gbp", amountCapturedPence: 0, amountRefundedPence: 0, providerPaymentId: "pi_test_private" };
  },
  async beginAuthorization(actor, input) {
    calls.push({ kind: "begin-authorization", actor, input });
    return { paymentId: input.paymentId, bookingId: input.bookingId, status: "creating", amountPence: 12_000, currency: "gbp", amountCapturedPence: 0, amountRefundedPence: 0, providerPaymentId: null };
  },
  async recordAuthorization(actor, selectedPaymentId, result) {
    calls.push({ kind: "record-authorization", actor, selectedPaymentId, result });
    return { paymentId: selectedPaymentId, bookingId, status: result.status, amountPence: 12_000, currency: "gbp", amountCapturedPence: 0, amountRefundedPence: 0, providerPaymentId: result.providerPaymentId };
  },
  async beginCommand(actor, input) {
    calls.push({ kind: "begin-command", actor, input });
    const amountPence = input.kind === "refund" ? input.amountPence : input.kind === "transfer" ? 7_200 : 12_000;
    return { commandId: input.commandId, paymentId: input.paymentId, bookingId, kind: input.kind, status: "created", amountPence, currency: "gbp", providerPaymentId: "pi_test_private", providerCommandId: null, destinationAccountId: input.kind === "transfer" ? "acct_cleaner_private" : null };
  },
  async recordCommand(actor, selectedCommandId, result) {
    calls.push({ kind: "record-command", actor, selectedCommandId, result });
    const prepared = calls.findLast((call) => call.kind === "begin-command" && call.input.commandId === selectedCommandId);
    return { commandId: selectedCommandId, paymentId: prepared.input.paymentId, kind: prepared.input.kind, status: result.status };
  },
  async reconcileEvent(event) {
    calls.push({ kind: "reconcile", event });
    return { accepted: true, duplicate: false };
  }
};

const provider = {
  name: "stripe",
  async createAuthorization(input) {
    calls.push({ kind: "provider-authorization", input });
    return { id: "pi_test_private", status: "requires-customer-action", clientSecret: "pi_secret_private", amountPence: input.amountPence, currency: input.currency };
  },
  async retrieveAuthorization(input) {
    calls.push({ kind: "provider-retrieve-authorization", input });
    return { id: input.providerPaymentId, status: "requires-customer-action", clientSecret: "pi_secret_private", amountPence: 12_000, currency: "gbp" };
  },
  async capture(input) { calls.push({ kind: "provider-capture", input }); return { id: "pi_test_private", status: "pending" }; },
  async cancel(input) { calls.push({ kind: "provider-cancel", input }); return { id: "pi_test_private", status: "succeeded" }; },
  async refund(input) { calls.push({ kind: "provider-refund", input }); return { id: "re_test_private", status: "pending" }; },
  async transfer(input) { calls.push({ kind: "provider-transfer", input }); return { id: "tr_test_private", status: "pending" }; },
  async verifyWebhook(body, signature) {
    calls.push({ kind: "verify-webhook", body: body.toString("utf8"), signature });
    return {
      eventId: "evt_test_private",
      kind: "authorization-succeeded",
      objectId: "pi_test_private",
      paymentId,
      amountPence: 12_000,
      currency: "gbp",
      occurredAt: new Date().toISOString(),
      payloadHash: createHash("sha256").update(body).digest("hex")
    };
  }
};

const service = createPaymentService(repository, provider, { createId: () => idIndex++ === 0 ? paymentId : commandIds[idIndex - 2] });
const paymentStatus = await service.getForBooking(landlord, bookingId);
assert(paymentStatus.paymentId === paymentId && paymentStatus.bookingId === bookingId && paymentStatus.status === "authorized" && !Object.hasOwn(paymentStatus, "providerPaymentId") && !JSON.stringify(paymentStatus).includes("pi_test_private"), "Landlord payment status lost its booking scope or exposed the provider reference.");
await assert.rejects(service.getForBooking(cleaner, bookingId), (error) => error.code === "payment-role-required");
const authorization = await service.beginAuthorization(landlord, { bookingId, idempotencyKey: "authorization_retry_key_1234567890", amountPence: 1 });
assert.deepEqual(authorization, { paymentId, bookingId, status: "requires-customer-action", amountPence: 12_000, currency: "gbp", amountCapturedPence: 0, amountRefundedPence: 0, requiresCustomerAction: true, clientSecret: "pi_secret_private" });
const preparedAuthorization = calls.find((call) => call.kind === "begin-authorization");
assert(Buffer.isBuffer(preparedAuthorization.input.idempotencyKeyHash) && preparedAuthorization.input.idempotencyKeyHash.length === 32 && !JSON.stringify(preparedAuthorization.input).includes("authorization_retry_key"), "Raw payment idempotency material crossed the repository boundary.");
const providerAuthorizationCall = calls.find((call) => call.kind === "provider-authorization");
assert(providerAuthorizationCall.input.amountPence === 12_000 && providerAuthorizationCall.input.currency === "gbp" && providerAuthorizationCall.input.bookingId === bookingId && !Object.hasOwn(providerAuthorizationCall.input, "customerEmail"), "Authorization did not use frozen server terms or leaked account contact data.");

await assert.rejects(service.beginAuthorization(cleaner, { bookingId, idempotencyKey: "authorization_retry_key_1234567890" }), (error) => error.code === "payment-role-required");
await assert.rejects(service.beginAuthorization(landlord, { bookingId, idempotencyKey: "weak" }), /strong payment idempotency key/i);

const captured = await service.capture(administrator, { paymentId, idempotencyKey: "capture_retry_key_123456789012345" });
const refunded = await service.refund(administrator, { paymentId, amountPence: 2_000, idempotencyKey: "refund_retry_key_1234567890123456" });
const transferred = await service.transfer(administrator, { paymentId, destinationAccountId: "acct_browser_attack", idempotencyKey: "transfer_retry_key_12345678901234" });
const cancelled = await service.cancel(landlord, { paymentId, idempotencyKey: "cancel_retry_key_1234567890123456" });
assert(captured.kind === "capture" && refunded.kind === "refund" && transferred.kind === "transfer" && cancelled.kind === "cancel", "Payment commands were not recorded through their exact command types.");
assert(calls.find((call) => call.kind === "provider-capture").input.bookingId === bookingId && calls.find((call) => call.kind === "provider-capture").input.commandId === commandIds[0], "Payment command lost its server-owned booking or command reference.");
assert(calls.find((call) => call.kind === "provider-refund").input.amountPence === 2_000, "The repository-approved refund amount was not sent to the provider.");
assert(calls.find((call) => call.kind === "provider-transfer").input.amountPence === 7_200 && calls.find((call) => call.kind === "provider-transfer").input.destinationAccountId === "acct_cleaner_private" && !JSON.stringify(calls.find((call) => call.kind === "provider-transfer")).includes("acct_browser_attack"), "Cleaner payout economics or destination were trusted from the browser.");
await assert.rejects(service.capture(landlord, { paymentId, idempotencyKey: "capture_retry_key_123456789012345" }), (error) => error.code === "payment-role-required");
await assert.rejects(service.refund(administrator, { paymentId, amountPence: 0, idempotencyKey: "refund_retry_key_1234567890123456" }), /Refund amount/);

const webhook = await service.handleWebhook(Buffer.from('{"id":"evt_test_private"}'), "t=1,v1=signed");
assert(webhook.accepted === true && calls.find((call) => call.kind === "reconcile").event.providerEventId === "evt_test_private" && calls.find((call) => call.kind === "reconcile").event.payloadHash.length === 64, "Verified provider webhook did not reconcile through the allowlisted event projection.");
await assert.rejects(service.handleWebhook(Buffer.alloc(0), "signature"), (error) => error.code === "invalid-payment-webhook");
await assert.rejects(service.handleWebhook(Buffer.alloc(1024 * 1024 + 1), "signature"), (error) => error.code === "invalid-payment-webhook");

const reconcilesBeforeIgnored = calls.filter((call) => call.kind === "reconcile").length;
const ignoredService = createPaymentService(repository, { ...provider, async verifyWebhook() { return { ignored: true, eventId: "evt_unrelated_signed" }; } }, { createId: () => paymentId });
assert.equal((await ignoredService.handleWebhook(Buffer.from("{}"), "signed")).ignored, true);
assert.equal(calls.filter((call) => call.kind === "reconcile").length, reconcilesBeforeIgnored, "A signed unrelated Stripe event entered payment reconciliation.");

const mismatchedProvider = { ...provider, async createAuthorization(input) { return { id: "pi_bad_amount", status: "authorized", amountPence: input.amountPence - 1, currency: input.currency }; } };
const mismatchService = createPaymentService(repository, mismatchedProvider, { createId: () => paymentId });
await assert.rejects(mismatchService.beginAuthorization(landlord, { bookingId, idempotencyKey: "mismatch_retry_key_123456789012345" }), /invalid authorization result/i);

const retryRepository = { ...repository, async beginAuthorization() { return { paymentId, bookingId, status: "requires-customer-action", amountPence: 12_000, currency: "gbp", amountCapturedPence: 0, amountRefundedPence: 0, providerPaymentId: "pi_test_private" }; } };
const retryService = createPaymentService(retryRepository, provider, { createId: () => paymentId });
const resumed = await retryService.beginAuthorization(landlord, { bookingId, idempotencyKey: "resume_retry_key_123456789012345678" });
assert(resumed.clientSecret === "pi_secret_private" && calls.some((call) => call.kind === "provider-retrieve-authorization"), "An interrupted customer-action authorization could not be resumed safely from the provider.");

console.log("Payment service tests passed: server-frozen authorization, role-bound capture/cancel/refund/transfer, private idempotency, server-owned payout destination and verified webhook reconciliation.");
