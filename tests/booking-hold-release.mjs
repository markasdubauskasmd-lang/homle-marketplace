import { createAuthorizationRelease } from "../src/marketplace/booking-hold-release.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }

const landlord = Object.freeze({ userId: "11111111-1111-4111-8111-111111111111", roles: ["landlord"] });
const bookingId = "22222222-2222-4222-8222-222222222222";
const paymentId = "33333333-3333-4333-8333-333333333333";

// Results shaped as `paymentService.cancel` really resolves. A cancel does not
// throw when it goes wrong, so a fake that returns nothing hides the failures.
const accepted = { commandId: "c-1", paymentId, kind: "cancel", status: "provider-pending", providerResult: "succeeded" };
const refused = { commandId: "c-2", paymentId, kind: "cancel", status: "provider-pending", providerResult: "failed" };
const unknown = { commandId: "c-3", paymentId, kind: "cancel", status: "provider-pending", recoveryRequired: true, recoveryReason: "provider-command-outcome-unknown", signedEventsReplayed: 0 };
const unsent = { commandId: "c-4", paymentId, kind: "cancel", status: "provider-failed", recoveryRequired: false, recoveryReason: "superseded-before-dispatch", signedEventsReplayed: 0 };

function service(result, statuses = ["authorized", "authorized"]) {
  const reads = [...statuses];
  return {
    cancels: [],
    async getForBooking() { return { paymentId, status: reads.length > 1 ? reads.shift() : reads[0] }; },
    async cancel(actor, input) { this.cancels.push(input); if (result instanceof Error) throw result; return result; }
  };
}

async function code(promise) { try { await promise; return null; } catch (error) { return error.code; } }

{
  const payments = service(accepted);
  const outcome = await createAuthorizationRelease(payments)(landlord, bookingId);
  assert(outcome.released === true && outcome.code === "released", `An accepted release was not reported as released: ${JSON.stringify(outcome)}`);
  assert(payments.cancels[0].idempotencyKey === `booking_cancel_${bookingId}`, "The release key is not stable per booking.");
}

// Each of these resolves without throwing, and none of them released the hold.
// Reporting any as released would let the booking end with the money held.
for (const [label, result] of [["refused by the provider", refused], ["of unknown outcome", unknown], ["never sent while the hold is live", unsent]]) {
  const failure = await code(createAuthorizationRelease(service(result))(landlord, bookingId));
  assert(failure === "payment-release-unconfirmed", `A release ${label} let the cancellation proceed (${failure}).`);
}

// An unsent command is fine once the payment shows the hold is already gone.
{
  const outcome = await createAuthorizationRelease(service(unsent, ["authorized", "cancelled"]))(landlord, bookingId);
  assert(outcome.code === "nothing-to-release", `An already-released hold blocked the cancellation: ${JSON.stringify(outcome)}`);
}

// No payment, or nothing left to release, needs no provider call.
{
  const none = { cancels: [], async getForBooking() { return { paymentId: null, status: "not-started" }; }, async cancel() { throw new Error("called"); } };
  assert((await createAuthorizationRelease(none)(landlord, bookingId)).code === "no-payment", "A booking with no payment was not released cleanly.");
  const captured = service(accepted, ["captured"]);
  assert((await createAuthorizationRelease(captured)(landlord, bookingId)).code === "nothing-to-release" && captured.cancels.length === 0, "A captured payment was sent a cancel.");
  const raced = service(Object.assign(new Error("not cancellable"), { code: "payment-not-cancellable" }));
  assert((await createAuthorizationRelease(raced)(landlord, bookingId)).code === "nothing-to-release", "A database refusal was treated as a failure.");
  const down = service(Object.assign(new Error("Stripe unavailable"), { code: "provider-unavailable" }));
  assert(await code(createAuthorizationRelease(down)(landlord, bookingId)) === "provider-unavailable", "A thrown provider failure was swallowed.");
}

console.log("Booking hold release passed: only an accepted cancel releases the hold; refused, unknown and unsent cancels stop the cancellation unless the payment shows the hold is already gone.");
