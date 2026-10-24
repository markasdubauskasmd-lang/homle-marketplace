/**
 * Settle completed bookings without a human pressing a button.
 *
 * Capture and transfer were administrator-only actions reachable from one
 * screen, so every completed job needed a person to open `/admin/payments` and
 * click twice: once to take the customer's money, once to pay the Cleaner. At
 * any real volume that does not work, and it is worse than merely slow — Stripe
 * releases an uncaptured authorization after about a week, so a missed click
 * does not delay the money, it loses it.
 *
 * This worker performs those same two actions on a schedule. It deliberately
 * reuses `paymentService.capture` and `paymentService.transfer` rather than
 * reaching into the database with a parallel settlement path. Every guard the
 * manual route has — booking must be `completed`, payment must be `authorized`,
 * no dispute hold, no reconciliation hold, verified payout destination, one
 * live command per kind — lives in `begin_payment_command`, and money movement
 * is the last place in a codebase that should have two implementations able to
 * drift apart.
 *
 * What it does NOT do:
 *
 * - It never decides eligibility itself. `canCapture` and `canTransfer` come
 *   from the administrator projection, which derives them in SQL from the same
 *   record the command guard re-checks under lock.
 * - It never captures and transfers the same payment in one pass. A transfer is
 *   funded by a captured charge and requires that capture to be reconciled,
 *   which happens when the signed webhook arrives. The next pass picks it up.
 * - It never retries a failed item within a pass, and never lets one failure
 *   end the batch. A payment that cannot settle is reported and left for the
 *   administrator queue, which still exists and is still authoritative.
 */

function boundedInteger(value, minimum, maximum, fallback, label) {
  if (value == null) return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new TypeError(`${label} is outside the supported range.`);
  return value;
}

export function createPaymentSettlementWorker(options = {}) {
  const payments = options.payments;
  if (!payments || typeof payments.listForAdministrator !== "function" || typeof payments.capture !== "function" || typeof payments.transfer !== "function") {
    throw new TypeError("Payment settlement requires a payment service with an administrator queue, capture and transfer.");
  }
  const actor = options.actor;
  // The actor is the platform acting as itself.
  //
  // This check is a guard against a programming mistake, NOT a security
  // boundary. `tideway_private.has_role` reads the roles the application hands
  // the database, so the database trusts this actor rather than resolving it
  // from the account. The account is verified against `user_roles` in
  // attachment.mjs before a worker is ever constructed; that is where the real
  // check lives, and it has to, because this one is only checking a literal
  // written two lines away from it.
  if (!actor?.userId || !Array.isArray(actor.roles) || !actor.roles.includes("administrator")) {
    throw new TypeError("Payment settlement requires a platform administrator actor.");
  }
  const batchLimit = boundedInteger(options.batchLimit, 1, 100, 100, "Settlement batch limit");
  // Bounded so one pass cannot run unbounded against the database. Twenty pages
  // of a hundred covers far more than the pilot will hold; exceeding it is
  // reported rather than silently truncated.
  const maximumPages = boundedInteger(options.maximumPages, 1, 200, 20, "Settlement page limit");
  const onUnexpectedError = typeof options.onUnexpectedError === "function" ? options.onUnexpectedError : () => {};

  return Object.freeze({
    async runOnce() {
      let captured = 0;
      let transferred = 0;
      let failed = 0;
      let inspected = 0;
      let pages = 0;
      let exhausted = false;

      // The queue must be paged, not sampled.
      //
      // "Actionable" includes `canCancel`, which is true for every live
      // confirmed booking with an authorization — and the queue orders ties by
      // most recently updated. A booking authorized this morning therefore
      // sorts above a completed job awaiting capture, whose payment last
      // changed days ago. Reading one fixed first page meant that once enough
      // upcoming bookings existed, the page contained nothing settleable and
      // the worker quietly settled nothing at all, for ever, reporting a
      // perfectly healthy `captured: 0`.
      //
      // That is precisely the volume this worker exists for, and the outcome it
      // exists to prevent: authorizations expiring uncaptured.
      while (pages < maximumPages && !exhausted) {
        const page = await payments.listForAdministrator(actor, { status: "actionable", limit: batchLimit, offset: pages * batchLimit });
        const queue = Array.isArray(page?.payments) ? page.payments : [];
        pages += 1;
        inspected += queue.length;
        exhausted = queue.length < batchLimit;
        for (const payment of queue) {
          // Anything the queue has flagged for human review stays for a human.
          // These are exactly the cases where moving money automatically is most
          // likely to be wrong.
          if (payment.reconciliationReviewRequired === true || payment.disputeReviewRequired === true) continue;
          try {
            if (payment.canCapture === true) {
              // A stable key means a repeated pass, a restart mid-flight, or two
              // workers racing all resolve to the same command rather than a
              // second charge.
              await payments.capture(actor, { paymentId: payment.paymentId, idempotencyKey: `settle_capture_${payment.paymentId}` });
              captured += 1;
              continue;
            }
            if (payment.canTransfer === true) {
              await payments.transfer(actor, { paymentId: payment.paymentId, idempotencyKey: `settle_transfer_${payment.paymentId}` });
              transferred += 1;
            }
          } catch (error) {
            failed += 1;
            // A refusal is information, not a crash. The administrator queue is
            // still there and still shows this payment; reporting keeps it
            // visible in monitoring rather than only in a log nobody reads.
            onUnexpectedError(error);
          }
        }
      }

      // Running out of pages before running out of queue is a capacity signal,
      // not a routine outcome: something settleable may be sitting past the
      // last page this pass reached.
      if (!exhausted) onUnexpectedError(new RangeError(`Payment settlement stopped after ${pages} pages without reaching the end of the actionable queue.`));

      return Object.freeze({
        inspected,
        pages,
        captured,
        transferred,
        failed,
        moreMayRemain: !exhausted
      });
    }
  });
}

/**
 * Whether automatic settlement is switched on.
 *
 * Default off, like every other money-touching capability here. Turning it on
 * also needs `PLATFORM_SETTLEMENT_USER_ID`, and that account is verified
 * against `user_roles` before anything is scheduled — see `attachment.mjs`.
 * The database does not resolve the role itself; it trusts the roles the
 * application hands it, which is exactly why that check has to exist.
 */
export function paymentSettlementEnabled(env = process.env) {
  return String(env.WORKER_PAYMENT_SETTLEMENT_ENABLED || "").trim().toLowerCase() === "true";
}

export function platformSettlementUserId(env = process.env) {
  const supplied = String(env.PLATFORM_SETTLEMENT_USER_ID || "").trim();
  return supplied === "" ? null : supplied;
}
