import assert from "node:assert/strict";
import { createStripePaymentProvider, stripePaymentApiVersion } from "../src/marketplace/stripe-payment-provider.mjs";

const paymentId = "55555555-5555-4555-8555-555555555555";
const commandId = "66666666-6666-4666-8666-666666666666";
const refund = { id: "re_external_refund", object: "refund", amount: 1000, currency: "gbp", status: "succeeded", charge: "ch_original_charge", payment_intent: "pi_original_payment", metadata: {} };
const charge = { id: refund.charge, object: "charge", payment_intent: refund.payment_intent, livemode: false, currency: "gbp" };
const intent = { id: refund.payment_intent, object: "payment_intent", amount: 12000, currency: "gbp", livemode: false, status: "canceled", metadata: { tideway_payment_id: paymentId, tideway_command_id: commandId } };
let event, returnedCharge = charge, returnedIntent = intent, lookupError;
const reads = [];
const provider = await createStripePaymentProvider({ secretKey: "sk_test_" + "a".repeat(32), webhookSecret: "whsec_" + "b".repeat(32) }, { stripeClient: {
  accounts: {}, accountLinks: {}, refunds: {}, transfers: {},
  charges: { async retrieve(id, parameters, options) { reads.push({ kind: "charge", id, parameters, options }); if (lookupError) throw lookupError; return returnedCharge; } },
  paymentIntents: { async retrieve(id, parameters, options) { reads.push({ kind: "intent", id, parameters, options }); if (lookupError) throw lookupError; return returnedIntent; } },
  webhooks: { constructEvent(body, signature) { assert(Buffer.isBuffer(body)); if (signature !== "signed") throw Error("invalid signature"); return event; } }
}});
function select(type, object, patch = {}) { event = { id: "evt_external_observation", type, data: { object }, livemode: false, api_version: stripePaymentApiVersion, created: 1783000000, ...patch }; }
const read = () => provider.verifyWebhook(Buffer.from("synthetic signed fixture"), "signed");
for (const [status, expected] of [["pending", "refund-pending"], ["requires_action", "refund-pending"], ["succeeded", "refund-succeeded"], ["failed", "refund-failed"], ["canceled", "refund-failed"]]) {
  select("refund.updated", { ...refund, status });
  const result = await read();
  assert.equal(result.kind, expected);
  assert.equal(result.paymentId, paymentId);
  assert.equal(result.commandId, null, "Parent capture metadata must not manufacture a refund command");
  assert.equal(result.amountPence, 1000, "Mutable parent amount must not replace signed refund amount");
  assert.equal(result.providerPaymentId, intent.id);
  assert.equal(result.sourceChargeId, charge.id);
  assert.deepEqual(reads.at(-1), { kind: "intent", id: intent.id, parameters: {}, options: { timeout: 10000, maxNetworkRetries: 0 } });
}
returnedIntent = { ...intent, metadata: {} };
select("refund.updated", refund);
assert.equal((await read()).paymentId, null, "Database must resolve exact provider identity when metadata is absent");
for (const patch of [{ id: "pi_other_payment" }, { object: "charge" }, { livemode: true }, { livemode: undefined }, { currency: "usd" }, { metadata: { tideway_payment_id: "invalid" } }]) {
  returnedIntent = { ...intent, ...patch };
  await assert.rejects(read(), /invalid|reference/);
}
returnedIntent = intent;
for (const metadata of [{ tideway_payment_id: "invalid" }, { tideway_command_id: commandId }, { tideway_payment_id: paymentId, tideway_command_id: "invalid" }]) {
  select("refund.updated", { ...refund, metadata });
  await assert.rejects(read(), /reference/);
}
for (const patch of [{ livemode: true }, { api_version: "unknown" }]) {
  select("refund.updated", refund, patch);
  const before = reads.length;
  await assert.rejects(read());
  assert.equal(reads.length, before);
}
select("refund.updated", refund);
lookupError = Object.assign(Error("parent unavailable"), { code: "ETIMEDOUT" });
await assert.rejects(read(), error => error === lookupError);
lookupError = null;
for (const metadata of [{}, intent.metadata]) {
  select("payment_intent.canceled", { ...intent, metadata });
  const before = reads.length;
  const result = await read();
  assert.equal(result.kind, "intent-cancelled-observed");
  assert.equal(result.commandId, null);
  assert.equal(result.providerPaymentId, intent.id);
  assert.equal(reads.length, before, "Signed cancellation must not be replaced by a GET snapshot");
}
for (const patch of [{ status: "succeeded" }, { livemode: true }, { livemode: undefined }, { amount: 0 }, { object: "charge" }]) {
  select("payment_intent.canceled", { ...intent, ...patch });
  await assert.rejects(read());
}
console.log("External payment adapter checks passed: metadata-less refund lifecycle, exact parent identity, bounded reads, signed amount preservation, cancellation independent of stale command metadata.");
