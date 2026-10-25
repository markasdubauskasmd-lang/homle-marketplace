import { cancellationOutcome } from "./payment-command-dispatch.mjs";

// Mirrors the statuses begin_payment_command accepts for a cancel. A payment
// already captured, refunded or cancelled has nothing to release.
const releasablePaymentStatuses = new Set(["creating", "requires-customer-action", "processing", "authorized"]);

// Release the card hold on a booking the Landlord is cancelling. It resolves
// only when the hold is gone or there never was one; anything else throws, and
// the caller then leaves the booking alive with its money reachable (D9).
export function createAuthorizationRelease(paymentService) {
  return async (actor, bookingId) => {
    const payment = await paymentService.getForBooking(actor, bookingId);
    // `getForBooking` answers for any booking the caller owns, with a
    // synthetic `not-started` record when no payment row exists, so a null
    // paymentId — not a null record — is what "nothing was taken" looks
    // like here.
    if (!payment || payment.paymentId == null) return Object.freeze({ released: false, message: "No payment had been taken, so there is nothing to release.", code: "no-payment" });
    if (!releasablePaymentStatuses.has(payment.status)) return Object.freeze({ released: false, message: "There was no card hold left to release.", code: "nothing-to-release" });
    let release;
    try {
      release = await paymentService.cancel(actor, { paymentId: payment.paymentId, idempotencyKey: `booking_cancel_${bookingId}` });
    } catch (error) {
      // The database owns the real guard, and it can legitimately refuse
      // for reasons this projection cannot see. A refusal means there is
      // nothing to release; anything else is a genuine failure and must
      // stop the cancellation rather than strand the money.
      if (error?.code === "payment-not-cancellable") return Object.freeze({ released: false, message: "There was no card hold left to release.", code: "nothing-to-release" });
      throw error;
    }
    // A cancel that resolves is not necessarily a release (D9): an unknown
    // provider outcome, a refusal or an unsent command all resolve. Only a
    // confirmed release lets the booking end; an unsent command is fine
    // only if the hold is already gone, which the payment itself says.
    const outcome = cancellationOutcome(release);
    if (outcome === "not-released") {
      const current = await paymentService.getForBooking(actor, bookingId);
      if (current && !releasablePaymentStatuses.has(current.status)) return Object.freeze({ released: false, message: "There was no card hold left to release.", code: "nothing-to-release" });
    }
    if (outcome !== "released") throw Object.assign(new Error("The card hold was not confirmed released."), { code: "payment-release-unconfirmed", outcome });
    return Object.freeze({ released: true, message: "Your card hold has been released. You have not been charged.", code: "released" });
  };
}
