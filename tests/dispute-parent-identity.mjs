import assert from "node:assert/strict";
import { createStripePaymentProvider, stripePaymentApiVersion } from "../src/marketplace/stripe-payment-provider.mjs";

const paymentId = "55555555-5555-4555-8555-555555555555";
const commandId = "66666666-6666-4666-8666-666666666666";
const charge = { id: "ch_signed_charge", object: "charge", livemode: false, currency: "gbp", payment_intent: "pi_signed_payment" };
const intent = { id: charge.payment_intent, object: "payment_intent", livemode: false, currency: "gbp",
  status: "canceled", metadata: { tideway_payment_id: paymentId, tideway_command_id: commandId, private: "MUST_NOT_PROJECT" } };
const dispute = { id: "du_signed_case", object: "dispute", livemode: false, charge: charge.id, payment_intent: intent.id,
  status: "won", currency: "gbp", amount: 2000 };
let event, returnedCharge = charge, returnedIntent = intent, chargeError = null, intentError = null;
const reads = [];
const provider = await createStripePaymentProvider({secretKey: "sk_test_" + "a".repeat(32), webhookSecret: "whsec_" + "b".repeat(32)}, {stripeClient: {
  accounts: {}, accountLinks: {}, refunds: {}, transfers: {},
  charges: {async retrieve(id, parameters, options) { reads.push({kind: "charge", id, parameters, options}); if (chargeError) throw chargeError; return returnedCharge; }},
  paymentIntents: {async retrieve(id, parameters, options) { reads.push({kind: "intent", id, parameters, options}); if (intentError) throw intentError; return returnedIntent; }},
  webhooks: {constructEvent(body, signature) {assert(Buffer.isBuffer(body)); if (signature !== "signed") throw Error("bad signature"); return event;}}
}});
function select(object = dispute, type = "charge.dispute.closed") {
  event = {id: "evt_signed_dispute", type, livemode: false, api_version: stripePaymentApiVersion,
    created: 1783000000, data: {object}};
}
const read = () => provider.verifyWebhook(Buffer.from("signed synthetic dispute"), "signed");
select();

// These wrong-parent responses were previously accepted and could project a
// dispute onto whichever PaymentIntent the response happened to contain.
returnedCharge = {...charge, id: "ch_different_charge"};
await assert.rejects(read(), /invalid dispute parent charge/, "A different charge was accepted as the signed dispute's parent");
returnedCharge = charge;
returnedIntent = {...intent, id: "pi_different_payment"};
await assert.rejects(read(), /invalid dispute parent PaymentIntent/, "A different PaymentIntent was accepted as the requested parent");
returnedIntent = intent;

for (const type of ["charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed"]) {
  for (const status of ["won", "lost", "warning_closed", "prevented", "under_review", "future_status"]) {
    select({...dispute, status}, type);
    const result = await read();
    assert.deepEqual(result, {eventId: event.id, kind: type.endsWith("closed") ? "dispute-closed" : "dispute-opened",
      objectId: intent.id, paymentId, commandId: null, amountPence: null, currency: null,
      occurredAt: new Date(event.created * 1000).toISOString(), disputeId: dispute.id,
      disputeStatus: status === "future_status" ? "unknown" : status});
    assert(!JSON.stringify(result).includes("MUST_NOT_PROJECT"));
    assert.deepEqual(reads.slice(-2), [
      {kind: "charge", id: charge.id, parameters: {}, options: {timeout: 10000, maxNetworkRetries: 0}},
      {kind: "intent", id: intent.id, parameters: {}, options: {timeout: 10000, maxNetworkRetries: 0}}
    ]);
  }
}
select();
for (const patch of [{id: "ch_wrong_charge"}, {object: "payment_intent"}, {object: undefined}, {livemode: true},
  {livemode: undefined}, {currency: "usd"}, {currency: undefined}]) {
  returnedCharge = {...charge, ...patch};
  const count = reads.filter(item => item.kind === "intent").length;
  await assert.rejects(read(), /invalid dispute parent charge/);
  assert.equal(reads.filter(item => item.kind === "intent").length, count, "Invalid charge reached the PaymentIntent lookup");
}
returnedCharge = charge;
for (const patch of [{id: "pi_wrong_payment"}, {object: "charge"}, {object: undefined}, {livemode: true},
  {livemode: undefined}, {currency: "usd"}, {currency: undefined}]) {
  returnedIntent = {...intent, ...patch};
  await assert.rejects(read(), /invalid dispute parent PaymentIntent/);
}
returnedIntent = intent;
for (const patch of [{charge: null}, {charge: "pi_wrong_type"}, {payment_intent: "ch_wrong_type"},
  {id: "pi_not_a_dispute"}, {object: "refund"}, {livemode: true}]) {
  select({...dispute, ...patch});
  const count = reads.length;
  await assert.rejects(read(), /invalid dispute/);
  assert.equal(reads.length, count, "Invalid signed dispute reached a provider lookup");
}
select();
for (const payment_intent of ["pi_another_payment", null, undefined, "ch_wrong_type"]) {
  returnedCharge = {...charge, payment_intent};
  const count = reads.filter(item => item.kind === "intent").length;
  await assert.rejects(read(), /dispute.*parent|dispute PaymentIntent/);
  assert.equal(reads.filter(item => item.kind === "intent").length, count);
}
returnedCharge = {...charge, payment_intent: {id: intent.id}};
select({...dispute, charge: {id: charge.id}, payment_intent: {id: intent.id}});
assert.equal((await read()).objectId, intent.id, "Expanded signed references must preserve the exact chain");
returnedCharge = charge;
for (const payment_intent of [null, undefined]) {
  select({...dispute, payment_intent});
  assert.equal((await read()).objectId, intent.id, "A nullable signed dispute PI must still resolve through the charge");
}
returnedCharge = {...charge, payment_intent: null};
const beforeLegacy = reads.length;
assert.equal((await read()).ignored, true, "An unrelated legacy charge without any PaymentIntent remains ignored");
assert.equal(reads.length, beforeLegacy + 1);
returnedCharge = charge;
returnedIntent = {...intent, metadata: {}};
assert.equal((await read()).ignored, true, "Verified unrelated disputes must remain ignored");
returnedIntent = intent;
select();
for (const resource of ["charge", "intent"]) {
  const error = Object.assign(Error("Provider unavailable"), {code: "ETIMEDOUT"});
  if (resource === "charge") chargeError = error; else intentError = error;
  await assert.rejects(read(), selected => selected === error, "A failed parent lookup must not acknowledge reconciliation");
  chargeError = intentError = null;
}
const beforeUnsigned = reads.length;
await assert.rejects(provider.verifyWebhook(Buffer.from("unsigned"), "invalid"), error => error.code === "invalid-payment-webhook");
assert.equal(reads.length, beforeUnsigned);
console.log("Dispute parent identity passed: exact signed charge/PI chain, type/mode/currency, bounded GETs, expanded/nullable references and unchanged signed accounting.");
