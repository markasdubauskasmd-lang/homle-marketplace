import assert from "node:assert/strict";
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
  charges: { async retrieve(id) { calls.push({ kind: "charge", id }); return { id, payment_intent: "pi_test_authorization" }; } },
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

const resumed = await provider.retrieveAuthorization({ providerPaymentId: "pi_test_authorization" });
assert.equal(resumed.status, "requires-customer-action");
const command = { ...shared, commandId, providerPaymentId: "pi_test_authorization", idempotencyKey: `tideway_payment_command_${commandId}` };
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
nextEvent = stripeEvent("refund.updated", { id: "re_test_refund", status: "succeeded", amount: 2_000, currency: "gbp", metadata: { tideway_payment_id: paymentId, tideway_booking_id: bookingId, tideway_command_id: commandId } });
assert.equal((await provider.verifyWebhook(rawBody, "signed")).kind, "refund-succeeded");
nextEvent = stripeEvent("transfer.created", { id: "tr_test_transfer", amount: 7_200, currency: "gbp", metadata: { tideway_payment_id: paymentId, tideway_booking_id: bookingId, tideway_command_id: commandId } });
assert.equal((await provider.verifyWebhook(rawBody, "signed")).kind, "transfer-succeeded");
nextEvent = stripeEvent("customer.created", { id: "cus_unrelated", metadata: {} });
assert.equal((await provider.verifyWebhook(rawBody, "signed")).ignored, true);
nextEvent = stripeEvent("customer.created", { id: "cus_live", metadata: {} }, { livemode: true });
await assert.rejects(provider.verifyWebhook(rawBody, "signed"), /Live Stripe webhook events are prohibited/);
nextEvent = stripeEvent("customer.created", { id: "cus_version", metadata: {} }, { api_version: "2025-01-01.old" });
await assert.rejects(provider.verifyWebhook(rawBody, "signed"), /API version/);
assert(!JSON.stringify(provider).includes(secretKey) && !JSON.stringify(provider).includes(webhookSecret));

console.log("Stripe payment provider tests passed: test-key-only adapter, hosted Cleaner payout onboarding, manual authorization, exact server commands, source-backed transfer and raw signed event projection.");
