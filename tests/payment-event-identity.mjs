import assert from "node:assert/strict";
import { createStripePaymentProvider, stripePaymentApiVersion } from "../src/marketplace/stripe-payment-provider.mjs";

const paymentId = "55555555-5555-4555-8555-555555555555", commandId = "66666666-6666-4666-8666-666666666666";
const metadata = { tideway_payment_id: paymentId, tideway_command_id: commandId };
const refund = { id: "re_signed_refund", object: "refund", amount: 2000, currency: "gbp", status: "succeeded",
  charge: "ch_original_charge", payment_intent: "pi_original_payment", metadata };
const transfer = { id: "tr_signed_transfer", object: "transfer", amount: 7200, currency: "gbp", livemode: false,
  source_transaction: refund.charge, destination: "acct_original_cleaner", metadata, reversed: true, amount_reversed: 7200 };
const charge = { id: refund.charge, object: "charge", payment_intent: refund.payment_intent, livemode: false, currency: "gbp",
  refunded: true, amount_refunded: 12000, metadata: { private: "never projected" } };
let event, returnedCharge = charge, lookupError = null;
const reads = [];
const provider = await createStripePaymentProvider({ secretKey: "sk_test_" + "a".repeat(32), webhookSecret: "whsec_" + "b".repeat(32) }, {stripeClient: {
  accounts: {}, accountLinks: {}, paymentIntents: {}, refunds: {}, transfers: {},
  charges: { async retrieve(id, parameters, options) { reads.push({id, parameters, options}); if (lookupError) throw lookupError; return returnedCharge; } },
  webhooks: { constructEvent(body, signature) { assert(Buffer.isBuffer(body)); if (signature !== "signed") throw Error("invalid signature"); return event; } }
}});
function select(type, object, patch = {}) {
  event = { id: "evt_signed_parent_check", type, data: {object}, livemode: false, api_version: stripePaymentApiVersion, created: 1783000000, ...patch };
}
const read = () => provider.verifyWebhook(Buffer.from("signed synthetic event"), "signed");

// Copied Homlle metadata must not replace the immutable signed parent chain.
select("refund.updated", refund);
returnedCharge = {...charge, payment_intent: "pi_different_payment"};
await assert.rejects(read(), /parent identities do not match/, "Copied metadata attached a refund to a different charge's PaymentIntent");
returnedCharge = charge;
for (const [type, object, expected] of [
  ["refund.updated", refund, "refund-succeeded"],
  ["refund.failed", {...refund, status: "failed"}, "refund-failed"],
  ["transfer.created", transfer, "transfer-succeeded"],
  ["transfer.reversed", transfer, "transfer-reversed"]
]) {
  select(type, object);
  const result = await read();
  assert.equal(result.kind, expected);
  assert.equal(result.providerPaymentId, refund.payment_intent);
  assert.equal(result.sourceChargeId, refund.charge);
  assert.equal(result.destinationAccountId, type.startsWith("refund.") ? null : transfer.destination);
  assert.equal(result.amountPence, object.amount, "Current GET totals replaced the signed event amount");
  assert.equal(result.occurredAt, new Date(event.created * 1000).toISOString());
  assert(!JSON.stringify(result).includes("never projected"));
  assert.deepEqual(reads.at(-1), {id: refund.charge, parameters: {}, options: {timeout: 10000, maxNetworkRetries: 0}});
}

for (const patch of [{id: "ch_different_charge"}, {object: "payment_intent"}, {object: undefined}, {livemode: true},
  {livemode: undefined}, {currency: "usd"}, {currency: undefined}, {payment_intent: "ch_not_an_intent"}, {payment_intent: null}]) {
  returnedCharge = {...charge, ...patch};
  for (const [type, object] of [["refund.updated", refund], ["transfer.created", transfer]]) {
    select(type, object);
    await assert.rejects(read(), /invalid event parent/, "Unverified GET parent identity was accepted");
  }
}
returnedCharge = charge;
for (const [type, object, patches] of [
  ["refund.updated", refund, [{charge: null}, {charge: "pi_not_a_charge"}, {payment_intent: null}, {payment_intent: "ch_not_an_intent"}]],
  ["transfer.created", transfer, [{source_transaction: null}, {source_transaction: "pi_not_a_charge"}, {destination: null}, {destination: "ch_not_an_account"}, {livemode: true}, {livemode: undefined}]]
]) {
  for (const patch of patches) {
    select(type, {...object, ...patch});
    const count = reads.length;
    await assert.rejects(read(), /invalid|non-test/);
    assert.equal(reads.length, count, "Invalid signed references reached the parent lookup");
  }
}
for (const [type, object] of [
  ["refund.updated", {...refund, charge: {id: refund.charge}, payment_intent: {id: refund.payment_intent}}],
  ["transfer.created", {...transfer, source_transaction: {id: refund.charge}, destination: {id: transfer.destination}}]
]) {
  returnedCharge = {...charge, payment_intent: {id: refund.payment_intent}};
  select(type, object);
  assert.equal((await read()).providerPaymentId, refund.payment_intent);
}
returnedCharge = charge;
lookupError = Object.assign(Error("Provider unavailable"), {code: "ETIMEDOUT"});
select("refund.updated", refund);
await assert.rejects(read(), error => error === lookupError, "A failed lookup was acknowledged as a successful webhook");
lookupError = null;
const beforeSignature = reads.length;
await assert.rejects(provider.verifyWebhook(Buffer.from("bad"), "invalid"), error => error.code === "invalid-payment-webhook");
assert.equal(reads.length, beforeSignature);
select("refund.updated", {...refund, metadata: {}});
assert.equal((await read()).ignored, true);
assert.equal(reads.length, beforeSignature, "Unrelated refunds must not trigger parent reads");
console.log("Signed payment parent checks passed: exact charge/mode/currency/PI chain, expanded references, bounded lookup, signed outcomes and failure retryability.");
