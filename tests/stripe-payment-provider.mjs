import assert from "node:assert/strict";
import "./external-payment-observations.mjs";
import "./payment-event-identity.mjs";
import { performance } from "node:perf_hooks";
import { createStripePaymentProvider, stripePaymentApiVersion } from "../src/marketplace/stripe-payment-provider.mjs";

const paymentId = "55555555-5555-4555-8555-555555555555";
const bookingId = "44444444-4444-4444-8444-444444444444";
const commandId = "66666666-6666-4666-8666-666666666666";
const secretKey = `sk_test_${"a".repeat(32)}`;
const webhookSecret = `whsec_${"b".repeat(32)}`;
const calls = [];
let nextEvent;
const payoutRequestId = "77777777-7777-4777-8777-777777777777";

const client = {
  accounts: {
    async create(input, options) { calls.push({ kind: "payout-account-create", input, options }); return { id: "acct_test_cleaner", charges_enabled: false, payouts_enabled: false, details_submitted: false, requirements: { currently_due: ["external_account"] } }; },
    async retrieve(id) { calls.push({ kind: id ? "payout-account-retrieve" : "account", id }); return id ? { id, charges_enabled: false, payouts_enabled: true, details_submitted: true, requirements: { currently_due: [] } } : { id: "acct_test_platform", charges_enabled: true }; }
  },
  accountLinks: { async create(input) { calls.push({ kind: "payout-link", input }); return { url: "https://connect.stripe.com/setup/c/acct_test_cleaner/secret", expires_at: Math.floor(Date.now() / 1000) + 300 }; } },
  paymentIntents: {
    async create(input, options) { calls.push({ kind: "intent-create", input, options }); return { id: "pi_test_authorization", status: "requires_payment_method", amount: input.amount, currency: input.currency, client_secret: "pi_test_client_secret" }; },
    async retrieve(id, options) {
      calls.push({ kind: "intent-retrieve", id, options });
      return options?.expand ? { id, status: "succeeded", currency: "gbp", amount_received: 12_000, latest_charge: { id: "ch_test_captured" } } : { id, status: "requires_action", amount: 12_000, currency: "gbp", client_secret: "pi_test_client_secret" };
    },
    async capture(id, input, options) { calls.push({ kind: "intent-capture", id, input, options }); return { id, status: "processing" }; },
    async update(id, input, options) { calls.push({ kind: "intent-update", id, input, options }); return { id, status: "requires_capture" }; },
    async cancel(id, input, options) { calls.push({ kind: "intent-cancel", id, input, options }); return { id, status: "canceled" }; }
  },
  refunds: { async create(input, options) { calls.push({ kind: "refund", input, options }); return { id: "re_test_refund", status: "pending" }; } },
  transfers: { async create(input, options) { calls.push({ kind: "transfer", input, options }); return { id: "tr_test_transfer" }; } },
  charges: { async retrieve(id) { calls.push({ kind: "charge", id }); return { id, object: "charge", livemode: false, currency: "gbp", payment_intent: "pi_test_authorization" }; } },
  webhooks: { constructEvent(body, signature, secret) { calls.push({ kind: "webhook", body, signature, secret }); if (signature === "bad") throw new Error("private signature diagnostic"); return nextEvent; } }
};

await assert.rejects(createStripePaymentProvider({ secretKey: `sk_live_${"x".repeat(32)}`, webhookSecret }, { stripeClient: client }), /live keys are prohibited/);
await assert.rejects(createStripePaymentProvider({ secretKey, webhookSecret: "wrong" }, { stripeClient: client }), /webhook signing secret/);

const provider = await createStripePaymentProvider({ secretKey, webhookSecret }, { stripeClient: client });
assert.deepEqual(await provider.verify(), { ready: true, testMode: true });
const payoutAccount = await provider.createPayoutAccount({ requestId: payoutRequestId, idempotencyKey: `tideway_cleaner_payout_${payoutRequestId}` });
assert.deepEqual(payoutAccount, { id: "acct_test_cleaner", testMode: true, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false, remainingRequirements: 1 });
const payoutCreate = calls.find((call) => call.kind === "payout-account-create");
assert.deepEqual(payoutCreate.input, { type: "express", country: "GB", capabilities: { transfers: { requested: true } }, metadata: { tideway_payout_request_id: payoutRequestId } });
assert.equal(payoutCreate.options.idempotencyKey, `tideway_cleaner_payout_${payoutRequestId}`);
assert.deepEqual(await provider.retrievePayoutAccount({ accountId: "acct_test_cleaner" }), { id: "acct_test_cleaner", testMode: true, chargesEnabled: false, payoutsEnabled: true, detailsSubmitted: true, remainingRequirements: 0 });
const payoutLink = await provider.createPayoutOnboardingLink({ accountId: "acct_test_cleaner", refreshUrl: "https://tideway.example/cleaner/payouts?resume=1", returnUrl: "https://tideway.example/cleaner/payouts?returned=1" });
assert.equal(payoutLink.url, "https://connect.stripe.com/setup/c/acct_test_cleaner/secret");
assert.deepEqual(calls.find((call) => call.kind === "payout-link").input, { account: "acct_test_cleaner", refresh_url: "https://tideway.example/cleaner/payouts?resume=1", return_url: "https://tideway.example/cleaner/payouts?returned=1", type: "account_onboarding" });
await assert.rejects(provider.createPayoutOnboardingLink({ accountId: "acct_test_cleaner", refreshUrl: "http://tideway.example/cleaner/payouts", returnUrl: "https://tideway.example/cleaner/payouts" }), /safe HTTPS/);
const shared = { paymentId, bookingId, amountPence: 12_000, currency: "gbp" };
const authorization = await provider.createAuthorization({ ...shared, idempotencyKey: `tideway_payment_${paymentId}`, transferGroup: `tideway_booking_${bookingId}` });
assert.equal(authorization.status, "requires-customer-action");
const authorizationCall = calls.find((call) => call.kind === "intent-create");
assert.deepEqual(authorizationCall.input, {
  amount: 12_000,
  currency: "gbp",
  capture_method: "manual",
  payment_method_types: ["card"],
  transfer_group: `tideway_booking_${bookingId}`,
  metadata: { tideway_payment_id: paymentId, tideway_booking_id: bookingId }
});
assert.equal(authorizationCall.options.idempotencyKey, `tideway_payment_${paymentId}`);
assert(!JSON.stringify(authorizationCall).includes("email") && !Object.hasOwn(authorizationCall.input, "payment_method") && !Object.hasOwn(authorizationCall.input, "payment_method_data"), "Authorization included customer identity or browser-collected card details.");

const sandboxActorHash = "c".repeat(64);
const sandboxCheckout = await provider.createSandboxCheckout({ amountPence: 30, currency: "gbp", actorHash: sandboxActorHash, idempotencyKey: `homle_sandbox_${"d".repeat(64)}` });
assert.equal(sandboxCheckout.status, "requires-customer-action");
const sandboxIntent = calls.filter((call) => call.kind === "intent-create").at(-1);
assert.deepEqual(sandboxIntent.input, {
  amount: 30,
  currency: "gbp",
  payment_method_types: ["card"],
  metadata: { homle_checkout_preview: "true", homle_actor_hash: sandboxActorHash }
});
assert.equal(sandboxIntent.options.idempotencyKey, `homle_sandbox_${"d".repeat(64)}`);
assert(!JSON.stringify(sandboxIntent.input).includes("tideway_payment_id") && !JSON.stringify(sandboxIntent.input).includes("tideway_booking_id"), "A standalone sandbox checkout could enter the booking payment ledger.");
await assert.rejects(provider.createSandboxCheckout({ amountPence: 1, currency: "gbp", actorHash: sandboxActorHash, idempotencyKey: `homle_sandbox_${"e".repeat(64)}` }), /sandbox payment request/i);

const resumed = await provider.retrieveAuthorization({ providerPaymentId: "pi_test_authorization" });
assert.equal(resumed.status, "requires-customer-action");
const command = { ...shared, commandId, providerPaymentId: "pi_test_authorization", idempotencyKey: `tideway_payment_command_${commandId}`, postDeadline: performance.now() + 120_000, sourceChargeId: "ch_test_captured" };
assert.equal((await provider.capture(command)).status, "pending");
assert.equal((await provider.cancel(command)).status, "succeeded");
assert.equal((await provider.refund({ ...command, amountPence: 2_000 })).status, "pending");
assert.equal((await provider.transfer({ ...command, amountPence: 7_200, destinationAccountId: "acct_test_cleaner" })).status, "pending");
const capture = calls.find((call) => call.kind === "intent-capture");
assert.equal(capture.input.amount_to_capture, 12_000);
assert.equal(capture.input.metadata.tideway_command_id, commandId);
const cancelUpdateIndex = calls.findIndex((call) => call.kind === "intent-update");
const cancelIndex = calls.findIndex((call) => call.kind === "intent-cancel");
assert(cancelUpdateIndex >= 0 && cancelUpdateIndex < cancelIndex, "Cancellation metadata was not attached before cancellation.");
const refund = calls.find((call) => call.kind === "refund");
assert.equal(refund.input.amount, 2_000);
const transfer = calls.find((call) => call.kind === "transfer");
for (const kind of ["intent-capture", "intent-update", "intent-cancel", "refund", "transfer"]) {
  const options = calls.find(call => call.kind === kind).options;
  assert.equal(options.timeout, 10000, "Monetary commands must have a bounded per-request timeout.");
  assert.equal(options.maxNetworkRetries, 0, "Implicit SDK retries can outlive the reserved dispatch deadline.");
}
assert.equal(transfer.input.amount, 7_200);
assert.equal(transfer.input.destination, "acct_test_cleaner");
assert.equal(transfer.input.source_transaction, "ch_test_captured");

function stripeEvent(type, object, overrides = {}) {
  return { id: "evt_test_signed", type, livemode: false, api_version: stripePaymentApiVersion, created: 1_783_000_000, data: { object }, ...overrides };
}
const rawBody = Buffer.from('{"preserve":" exact bytes "}');
nextEvent = stripeEvent("payment_intent.amount_capturable_updated", { id: "pi_test_authorization", status: "requires_capture", amount: 12_000, currency: "gbp", metadata: { tideway_payment_id: paymentId, tideway_booking_id: bookingId } });
const verified = await provider.verifyWebhook(rawBody, "t=1,v1=signed");
assert.equal(verified.kind, "authorization-succeeded");
const webhook = calls.findLast((call) => call.kind === "webhook");
assert.strictEqual(webhook.body, rawBody);
assert.equal(webhook.signature, "t=1,v1=signed");
assert.equal(webhook.secret, webhookSecret);
await assert.rejects(provider.verifyWebhook(rawBody, "bad"), (error) => error.statusCode === 400 && error.code === "invalid-payment-webhook" && !error.message.includes("private signature diagnostic"));

nextEvent = stripeEvent("payment_intent.succeeded", { id: "pi_test_authorization", status: "succeeded", amount: 12_000, amount_received: 12_000, currency: "gbp", metadata: { tideway_payment_id: paymentId, tideway_booking_id: bookingId, tideway_command_id: commandId } });
assert.equal((await provider.verifyWebhook(rawBody, "signed")).kind, "capture-succeeded");
nextEvent = stripeEvent("refund.updated", { id: "re_test_refund", status: "succeeded", amount: 2_000, currency: "gbp", charge: "ch_test_captured", payment_intent: "pi_test_authorization", metadata: { tideway_payment_id: paymentId, tideway_booking_id: bookingId, tideway_command_id: commandId } });
assert.equal((await provider.verifyWebhook(rawBody, "signed")).kind, "refund-succeeded");
nextEvent = stripeEvent("transfer.created", { id: "tr_test_transfer", amount: 7_200, currency: "gbp", livemode: false, source_transaction: "ch_test_captured", destination: "acct_test_cleaner", metadata: { tideway_payment_id: paymentId, tideway_booking_id: bookingId, tideway_command_id: commandId } });
assert.equal((await provider.verifyWebhook(rawBody, "signed")).kind, "transfer-succeeded");
const reversedTransfer = { id: "tr_test_transfer", amount: 7_200, amount_reversed: 7_200, reversed: true, currency: "gbp", livemode: false, source_transaction: "ch_test_captured", destination: "acct_test_cleaner", metadata: { tideway_payment_id: paymentId, tideway_booking_id: bookingId, tideway_command_id: commandId } };
nextEvent = stripeEvent("transfer.reversed", reversedTransfer);
const fullReversal = await provider.verifyWebhook(rawBody, "signed");
assert.deepEqual(fullReversal, {
  eventId: "evt_test_signed", kind: "transfer-reversed", objectId: "tr_test_transfer",
  paymentId, commandId, amountPence: 7_200, currency: "gbp", occurredAt: new Date(1_783_000_000 * 1000).toISOString(),
  providerPaymentId: "pi_test_authorization", sourceChargeId: "ch_test_captured", destinationAccountId: "acct_test_cleaner"
});
assert.deepEqual(await provider.verifyWebhook(rawBody, "signed"), fullReversal, "Repeated full reversals must retain the event identity for database deduplication.");
for (const patch of [
  { amount_reversed: 1_000, reversed: false },
  { amount_reversed: 0, reversed: false },
  { amount_reversed: 1_000, reversed: true },
  { amount_reversed: 7_200, reversed: false },
  { amount_reversed: 7_201 },
  { amount_reversed: -1 },
  { amount_reversed: "7200" },
  { amount_reversed: 7_199.5 },
  { amount_reversed: undefined },
  { reversed: undefined },
  { reversed: "true" },
  { amount: 0, amount_reversed: 0 },
  { amount: -1, amount_reversed: -1 },
  { amount: "7200", amount_reversed: "7200" },
  { amount: 7_199.5, amount_reversed: 7_199.5 }
]) {
  nextEvent = stripeEvent("transfer.reversed", { ...reversedTransfer, ...patch });
  await assert.rejects(provider.verifyWebhook(rawBody, "signed"), /not a verified full reversal/, "Partial or inconsistent reversals must not release the full transfer in the ledger.");
  await assert.rejects(provider.verifyWebhook(rawBody, "signed"), /not a verified full reversal/, "Retrying an unsupported reversal must not silently acknowledge it.");
}
nextEvent = stripeEvent("transfer.reversed", reversedTransfer, { id: "evt_test_full_reversal_after_partial" });
assert.equal((await provider.verifyWebhook(rawBody, "signed")).amountPence, 7_200, "A later fully reversed event must still reconcile the full transfer.");
nextEvent = stripeEvent("customer.created", { id: "cus_unrelated", metadata: {} });
assert.equal((await provider.verifyWebhook(rawBody, "signed")).ignored, true);
nextEvent = stripeEvent("customer.created", { id: "cus_live", metadata: {} }, { livemode: true });
await assert.rejects(provider.verifyWebhook(rawBody, "signed"), /Live Stripe webhook events are prohibited/);
nextEvent = stripeEvent("customer.created", { id: "cus_version", metadata: {} }, { api_version: "2025-01-01.old" });
await assert.rejects(provider.verifyWebhook(rawBody, "signed"), /API version/);

// Signed monetary snapshots must retain verifiable identities and economics.
// A valid signature cannot make missing/contradictory fields safe to apply.
const eventMetadata = { tideway_payment_id: paymentId, tideway_booking_id: bookingId, tideway_command_id: commandId };
const intentSnapshot = { id: "pi_test_authorization", object: "payment_intent", livemode: false, status: "succeeded", amount: 12_000, amount_received: 12_000, currency: "gbp", metadata: eventMetadata };
const refundSnapshot = { id: "re_test_refund", object: "refund", status: "succeeded", amount: 2_000, currency: "gbp", charge: "ch_test_captured", payment_intent: intentSnapshot.id, metadata: eventMetadata };
const transferSnapshot = { ...reversedTransfer, object: "transfer" };
for (const [type, snapshot, wrongPrefix] of [
  ["payment_intent.succeeded", intentSnapshot, "re_not_an_intent"],
  ["refund.updated", refundSnapshot, "tr_not_a_refund"],
  ["transfer.created", transferSnapshot, "pi_not_a_transfer"],
  ["transfer.reversed", transferSnapshot, "re_not_a_transfer"]
]) {
  for (const patch of [{ currency: "usd" }, { currency: null }, { currency: undefined },
    { amount: undefined }, { amount: "2000" }, { amount: -1 }, { amount: 2.5 },
    { id: wrongPrefix }, { object: "customer" }]) {
    nextEvent = stripeEvent(type, { ...snapshot, ...patch });
    await assert.rejects(provider.verifyWebhook(rawBody, "signed"), /invalid|unsupported|not a verified full reversal/, `${type} accepted malformed monetary evidence: ${JSON.stringify(patch)}`);
  }
  nextEvent = stripeEvent(type, snapshot, { id: "pi_not_an_event" });
  await assert.rejects(provider.verifyWebhook(rawBody, "signed"), /invalid event id/);
}
for (const amount_received of [undefined, null, 0, -1, 12_001, 3.5, "12000"]) {
  nextEvent = stripeEvent("payment_intent.succeeded", { ...intentSnapshot, amount_received });
  await assert.rejects(provider.verifyWebhook(rawBody, "signed"), /captured event amount/,
    "Missing capture amount must not fall back to the amount originally requested.");
}
for (const [type, status, kind] of [
  ["payment_intent.requires_action", "requires_action", "authorization-requires-action"],
  ["payment_intent.processing", "processing", "authorization-processing"],
  ["payment_intent.payment_failed", "requires_payment_method", "capture-failed"],
  ["payment_intent.succeeded", "succeeded", "capture-succeeded"],
  ["payment_intent.canceled", "canceled", "intent-cancelled-observed"]
]) {
  nextEvent = stripeEvent(type, { ...intentSnapshot, status });
  assert.equal((await provider.verifyWebhook(rawBody, "signed")).kind, kind);
  nextEvent = stripeEvent(type, { ...intentSnapshot, status: "contradictory" });
  await assert.rejects(provider.verifyWebhook(rawBody, "signed"), /contradictory PaymentIntent|invalid canceled PaymentIntent/);
}
for (const type of ["refund.created", "refund.updated", "refund.failed"]) {
  for (const status of ["failed", "canceled"]) {
    nextEvent = stripeEvent(type, { ...refundSnapshot, status, failure_balance_transaction: "txn_refund_returned" });
    const failed = await provider.verifyWebhook(rawBody, "signed");
    assert.equal(failed.kind, "refund-failed");
    assert.equal(failed.objectId, refundSnapshot.id);
    assert.equal(failed.amountPence, refundSnapshot.amount);
    assert.equal(failed.currency, "gbp");
  }
  for (const status of [undefined, "future_unknown_status"]) {
    nextEvent = stripeEvent(type, { ...refundSnapshot, status });
    await assert.rejects(provider.verifyWebhook(rawBody, "signed"), /contradictory refund/);
  }
}
for (const status of ["pending", "requires_action", "succeeded"]) {
  nextEvent = stripeEvent("refund.failed", { ...refundSnapshot, status });
  await assert.rejects(provider.verifyWebhook(rawBody, "signed"), /contradictory refund/);
  for (const type of ["refund.created", "refund.updated"]) {
    nextEvent = stripeEvent(type, { ...refundSnapshot, status });
    const projected = await provider.verifyWebhook(rawBody, "signed");
    if (status === "succeeded") assert.equal(projected.kind, "refund-succeeded");
    else assert.equal(projected.kind, "refund-pending", "A pending refund must retain evidence without applying a money delta.");
  }
}
nextEvent = stripeEvent("transfer.failed", transferSnapshot);
await assert.rejects(provider.verifyWebhook(rawBody, "signed"), /unsupported transfer failure event/);
assert(!JSON.stringify(provider).includes(secretKey) && !JSON.stringify(provider).includes(webhookSecret));

console.log("Stripe payment provider tests passed: test-key-only adapter, hosted Cleaner payout onboarding, manual authorization, exact server commands, source-backed transfer and raw signed event projection.");

/* Read-only receipts: verify identity, capture, currency and destination. */
{
  const input = { paymentId, bookingId, providerPaymentId: "pi_test_receipt", amountCapturedPence: 12000, currency: "gbp" };
  const charge = { id: "ch_test_receipt", payment_intent: input.providerPaymentId, livemode: false,
    currency: "gbp", amount_captured: 12000, amount_refunded: 0, paid: true, captured: true,
    status: "succeeded", receipt_url: "https://pay.stripe.com/receipts/payment/synthetic" };
  const intent = { id: input.providerPaymentId, livemode: false, currency: "gbp", status: "succeeded",
    amount_received: 12000, metadata: { tideway_payment_id: paymentId, tideway_booking_id: bookingId }, latest_charge: charge };
  let returned = structuredClone(intent);
  const reads = [];
  const receiptProvider = await createStripePaymentProvider({ secretKey, webhookSecret }, { stripeClient: {
    ...client, paymentIntents: { ...client.paymentIntents, async retrieve(id, options) { reads.push({ id, options }); return returned; } },
    charges: { async retrieve(id) { assert.equal(id, charge.id); return charge; } }
  } });
  assert.deepEqual(await receiptProvider.retrieveReceipt(input), { url: charge.receipt_url, amountCapturedPence: 12000, amountRefundedPence: 0, currency: "gbp", testMode: true });
  assert.deepEqual(reads[0], { id: input.providerPaymentId, options: { expand: ["latest_charge"] } });
  returned = { ...intent, latest_charge: charge.id };
  assert.equal((await receiptProvider.retrieveReceipt(input)).url, charge.receipt_url);
  for (const patch of [{ status: "requires_capture" }, { latest_charge: null }]) {
    returned = { ...intent, ...patch };
    assert.equal(await receiptProvider.retrieveReceipt(input), null);
  }
  returned = { ...intent, latest_charge: { ...charge, receipt_url: null } };
  assert.equal(await receiptProvider.retrieveReceipt(input), null);
  for (const patch of [{ id: "pi_wrong_payment" }, { livemode: true }, { currency: "eur" }, { amount_received: 11000 }, { metadata: {} }]) {
    returned = { ...intent, ...patch };
    await assert.rejects(receiptProvider.retrieveReceipt(input), /could not be verified/);
  }
  for (const patch of [{ payment_intent: "pi_wrong_payment" }, { livemode: true }, { currency: "eur" }, { amount_captured: 11000 },
    { paid: false }, { captured: false }, { status: "failed" }, { amount_refunded: 13000 },
    { receipt_url: "https://pay.stripe.com.evil.example/receipts/x" }, { receipt_url: "http://pay.stripe.com/receipts/x" },
    { receipt_url: "https://someone@pay.stripe.com/receipts/x" }, { receipt_url: "https://pay.stripe.com/not-a-receipt" }]) {
    returned = { ...intent, latest_charge: { ...charge, ...patch } };
    await assert.rejects(receiptProvider.retrieveReceipt(input), /could not be verified/);
  }
  returned = { ...intent, latest_charge: { ...charge, amount_refunded: 12000 } };
  assert.equal((await receiptProvider.retrieveReceipt(input)).amountRefundedPence, 12000);
  const before = reads.length;
  await assert.rejects(receiptProvider.retrieveReceipt({ ...input, amountCapturedPence: 0 }), /captured Homle payment/);
  assert.equal(reads.length, before);
}
