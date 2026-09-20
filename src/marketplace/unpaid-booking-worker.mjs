/**
 * End bookings nobody ever paid for, and give the Cleaner their day back.
 *
 * The reminders already exist: migration 041 queues one when the five-day
 * authorization window opens, 043 adds a second twenty-four hours before the
 * slot, and 117/123 mail the outcome when an authorization fails. Nothing
 * finished the story. A booking that was never paid for stayed `confirmed`
 * indefinitely, and migration 025 would never have let the job start.
 *
 * The cost of that lands on the Cleaner, not on the platform: their calendar
 * is held for a job that cannot legally begin, and nobody tells them. With
 * almost no supply in the pilot, that is the most expensive silent failure in
 * the system, which is why this exists before anything cosmetic.
 *
 * ORDERING. The provider hold is released FIRST, and only then is the booking
 * cancelled. This is not a preference. `begin_payment_command` will not cancel
 * a hold on a booking that has already left `confirmed`, so ending the booking
 * first would strand the customer's money with no route out -- the exact defect
 * a review found in the Landlord cancellation path before it shipped. If the
 * release fails, the booking is left untouched and the item is reported; a
 * booking that still holds somebody's money is safer left alive.
 *
 * What it does NOT do:
 *
 * - It never decides eligibility in JavaScript. The queue is SQL and every
 *   condition in it is re-made under lock inside `expire_unpaid_booking`, so a
 *   payment that lands between reading the queue and acting on it means the
 *   booking is left alone and reported as no longer expirable.
 * - It never retries an item within a pass, and one failure never ends the
 *   batch. A booking that cannot be ended is reported and picked up next pass.
 * - It never charges anything. Nothing was authorized, so there is nothing to
 *   charge and no approved terms to charge it under.
 */

function boundedInteger(value, minimum, maximum, fallback, label) {
  if (value == null) return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new TypeError(`${label} is outside the supported range.`);
  return value;
}

export function createUnpaidBookingWorker(options = {}) {
  const repository = options.repository;
  if (!repository || typeof repository.listExpirable !== "function" || typeof repository.expire !== "function") {
    throw new TypeError("Unpaid-booking expiry requires a complete expiry repository.");
  }
  // Optional. With payments unattached there is no provider hold to release and
  // nothing in the queue can carry one, so expiry still works -- it just has
  // nothing to cancel first.
  const payments = options.payments || null;
  if (payments && typeof payments.cancel !== "function") {
    throw new TypeError("Unpaid-booking expiry requires a payment service that can cancel an authorization.");
  }
  const actor = options.actor;
  // A guard against a programming mistake, not a security boundary.
  // `tideway_private.has_role` reads the roles the application hands the
  // database, so the real verification of this account happens in
  // attachment.mjs against `user_roles` before a worker is ever constructed.
  if (!actor?.userId || !Array.isArray(actor.roles) || !actor.roles.includes("administrator")) {
    throw new TypeError("Unpaid-booking expiry requires a platform administrator actor.");
  }
  const batchLimit = boundedInteger(options.batchLimit, 1, 200, 100, "Expiry batch limit");
  const onUnexpectedError = typeof options.onUnexpectedError === "function" ? options.onUnexpectedError : () => {};

  return Object.freeze({
    async runOnce() {
      const due = await repository.listExpirable(actor, batchLimit);
      let expired = 0;
      let released = 0;
      let skipped = 0;
      let failed = 0;

      for (const booking of due) {
        try {
          if (booking.paymentId) {
            if (!payments) {
              // A live intent with no way to cancel it. Leaving the booking
              // alive is the safe answer: it still has somebody's money
              // attached, and ending it here would remove the only route back.
              skipped += 1;
              continue;
            }
            try {
              // Stable key, so a pass that dies after the provider call and
              // before the booking update does not cancel twice on the retry.
              await payments.cancel(actor, { paymentId: booking.paymentId, idempotencyKey: `expire_unpaid_${booking.paymentId}` });
              released += 1;
            } catch (error) {
              // The attempt reached a state that cannot be cancelled between
              // the queue being read and now -- most often because it already
              // was. There is no hold to release, so ending the booking is
              // still correct; anything else is a real failure and is rethrown
              // so the booking is left alive with its money intact.
              if (error?.code !== "payment-not-cancellable") throw error;
            }
          }
          const outcome = await repository.expire(actor, booking.bookingId);
          if (outcome.expired) expired += 1;
          else skipped += 1;
        } catch (error) {
          // Per item, so one booking that cannot be ended does not stop the
          // rest. Reported rather than swallowed: this moves somebody's
          // booking, and a failure here is an operational fact.
          failed += 1;
          onUnexpectedError(error);
          // Except when money movement is paused for maintenance, which is not
          // an item failing but the whole pass being told to stand down.
          // Continuing would release nothing and report the same fault once per
          // booking in the queue.
          if (error?.code === "payment-command-writes-paused") break;
        }
      }

      return Object.freeze({ considered: due.length, expired, released, skipped, failed, batchFull: due.length === batchLimit });
    }
  });
}
