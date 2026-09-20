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
  // The actor is the platform acting as itself. It must genuinely carry the
  // administrator role, because the database checks the role rather than
  // trusting the caller — which is the property that makes reusing the manual
  // path safe rather than a way around it.
  if (!actor?.userId || !Array.isArray(actor.roles) || !actor.roles.includes("administrator")) {
    throw new TypeError("Payment settlement requires a platform administrator actor.");
  }
  const batchLimit = boundedInteger(options.batchLimit, 1, 100, 25, "Settlement batch limit");
  const onUnexpectedError = typeof options.onUnexpectedError === "function" ? options.onUnexpectedError : () => {};

  return Object.freeze({
    async runOnce() {
      let captured = 0;
      let transferred = 0;
      let failed = 0;
      const page = await payments.listForAdministrator(actor, { status: "actionable", limit: batchLimit });
      const queue = Array.isArray(page?.payments) ? page.payments : [];
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
      return Object.freeze({
        inspected: queue.length,
        captured,
        transferred,
        failed,
        moreMayRemain: queue.length === batchLimit
      });
    }
  });
}

/**
 * Whether automatic settlement is switched on.
 *
 * Default off, like every other money-touching capability here. Turning it on
 * needs a real platform administrator account id, because the database resolves
 * the role from the account rather than from configuration — there is no way to
 * assert the role from an environment variable, which is the point.
 */
export function paymentSettlementEnabled(env = process.env) {
  return String(env.WORKER_PAYMENT_SETTLEMENT_ENABLED || "").trim().toLowerCase() === "true";
}

export function platformSettlementUserId(env = process.env) {
  const supplied = String(env.PLATFORM_SETTLEMENT_USER_ID || "").trim();
  return supplied === "" ? null : supplied;
}
