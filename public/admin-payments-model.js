const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const paymentStatuses = new Set(["creating", "requires-customer-action", "processing", "authorized", "authorization-failed", "captured", "partially-refunded", "refunded", "cancelled", "disputed"]);
const bookingStatuses = new Set(["confirmed", "cleaner-en-route", "cleaner-arrived", "cleaning-in-progress", "awaiting-review", "completed", "cancelled", "disputed"]);
const commandKinds = new Set(["capture", "cancel", "refund", "transfer"]);

function integer(value, minimum, maximum, label) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${label} is unavailable.`);
  return value;
}

function timestamp(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`${label} is unavailable.`);
  return new Date(value).toISOString();
}

export function adminPaymentFilter(value) {
  const selected = String(value || "actionable").trim().toLowerCase();
  if (selected === "actionable" || paymentStatuses.has(selected)) return selected;
  throw new TypeError("Choose a valid payment status.");
}

export function adminPaymentBookingFilter(value) {
  if (value == null || value === "") return null;
  if (!uuidPattern.test(value)) throw new TypeError("The related booking payment link is invalid.");
  return value.toLowerCase();
}

export function adminPaymentQueue(value) {
  if (!value || !Array.isArray(value.payments)) throw new Error("The payment queue is unavailable.");
  const limit = integer(Number(value.limit), 1, 100, "Payment page size");
  const offset = integer(Number(value.offset), 0, 10000, "Payment page offset");
  const payments = value.payments.map((record) => {
    if (!record || !uuidPattern.test(record.paymentId || "") || !uuidPattern.test(record.bookingId || "") || !paymentStatuses.has(record.paymentStatus) || !bookingStatuses.has(record.bookingStatus) || record.currency !== "gbp") throw new Error("A payment queue item is unavailable.");
    const amountPence = integer(record.amountPence, 1, 10_000_000, "Payment amount");
    const amountCapturedPence = integer(record.amountCapturedPence, 0, amountPence, "Captured amount");
    const amountRefundedPence = integer(record.amountRefundedPence, 0, amountCapturedPence, "Refunded amount");
    return Object.freeze({
      paymentId: record.paymentId.toLowerCase(), bookingId: record.bookingId.toLowerCase(), paymentStatus: record.paymentStatus, bookingStatus: record.bookingStatus,
      scheduledStartAt: timestamp(record.scheduledStartAt, "Booking start time"), scheduledEndAt: timestamp(record.scheduledEndAt, "Booking end time"), updatedAt: timestamp(record.updatedAt, "Payment update time"),
      amountPence, amountCapturedPence, amountRefundedPence, cleanerPayPence: integer(record.cleanerPayPence, 1, amountPence, "Cleaner pay"), currency: "gbp",
      payoutReady: record.payoutReady === true, canCapture: record.canCapture === true, canCancel: record.canCancel === true, canRefund: record.canRefund === true, canTransfer: record.canTransfer === true, awaitingProvider: record.awaitingProvider === true
    });
  });
  return Object.freeze({ payments: Object.freeze(payments), limit, offset, testMode: value.testMode === true });
}

export function paymentActionPayload(kind, { amountPence, idempotencyKey, confirmed } = {}) {
  if (!commandKinds.has(kind)) throw new TypeError("Choose a valid payment action.");
  if (confirmed !== true) throw new TypeError("Confirm this test payment action before continuing.");
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(idempotencyKey || "")) throw new TypeError("A secure payment retry key is required.");
  const payload = { idempotencyKey };
  if (kind === "refund") payload.amountPence = integer(amountPence, 1, 10_000_000, "Refund amount");
  return Object.freeze(payload);
}

export function paymentStatusLabel(value) {
  return ({ creating: "Starting authorization", "requires-customer-action": "Landlord action required", processing: "Authorization processing", authorized: "Authorized", "authorization-failed": "Authorization failed", captured: "Captured", "partially-refunded": "Partially refunded", refunded: "Refunded", cancelled: "Cancelled", disputed: "Disputed" })[value] || "Unavailable";
}

export function paymentActionLabel(value) {
  return ({ capture: "Capture completed clean", cancel: "Cancel authorization", refund: "Issue refund", transfer: "Pay Cleaner" })[value] || "Payment action";
}

export function paymentNextAction(record) {
  if (!record || !paymentStatuses.has(record.paymentStatus) || !bookingStatuses.has(record.bookingStatus)) {
    return Object.freeze({ kind: "refresh", title: "Refresh verified status", copy: "No payment action is safe until Homle can verify the current booking and provider state." });
  }
  if (record.awaitingProvider === true) {
    return Object.freeze({ kind: "refresh", title: "Refresh signed provider status", copy: "A previous command is still being reconciled. Do not repeat it or start another payment action." });
  }
  if (record.canCapture === true) {
    return Object.freeze({ kind: "capture", title: "Next: capture the completed clean", copy: "Confirm the Landlord has completed the job review, then capture the exact frozen customer total once." });
  }
  if (record.canTransfer === true) {
    return Object.freeze({ kind: "transfer", title: "Next: pay the Cleaner", copy: "Customer capture is reconciled and the Cleaner payout account is provider verified. Transfer only the frozen Cleaner pay." });
  }
  if (record.bookingStatus === "completed" && record.paymentStatus === "captured" && record.payoutReady !== true) {
    return Object.freeze({ kind: "payout-wait", title: "Waiting for Cleaner payout setup", copy: "The customer total is captured. Do not refund as routine settlement; wait until the Cleaner finishes the secure payout form, then refresh." });
  }
  if (record.canCancel === true) {
    return Object.freeze({ kind: "cancel", title: "Next: cancel the unused authorization", copy: "The journey has not started. Cancel only this unused authorization after confirming the booking will not proceed." });
  }
  if (record.canRefund === true) {
    return Object.freeze({ kind: "refund-review", title: "Refund is an exception, not settlement", copy: "Review the booking case and captured balance before issuing any refund. Cleaner payout must not be treated as a refund." });
  }
  return Object.freeze({ kind: "none", title: "No payment action is currently due", copy: "This verified state has no eligible Administrator command. Refresh after the booking or provider state changes." });
}

export function shortPaymentReference(value) {
  if (!uuidPattern.test(value || "")) return "Payment";
  return `Payment ${value.slice(0, 8).toUpperCase()}`;
}

export function shortPaymentBookingReference(value) {
  if (!uuidPattern.test(value || "")) return "Booking";
  return `BKG-${value.slice(0, 8).toUpperCase()}`;
}
