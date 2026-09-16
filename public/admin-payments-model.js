const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const paymentStatuses = new Set(["creating", "requires-customer-action", "processing", "authorized", "authorization-failed", "captured", "partially-refunded", "refunded", "cancelled", "disputed"]);
const bookingStatuses = new Set(["confirmed", "cleaner-en-route", "cleaner-arrived", "cleaning-in-progress", "awaiting-review", "completed", "cancelled", "disputed"]);
const commandKinds = new Set(["capture", "cancel", "refund", "transfer"]);
const commandStatuses = new Set(["created", "provider-pending", "provider-failed", "reconciled"]);
const disputeStatuses = new Set(["warning_needs_response", "warning_under_review", "needs_response", "under_review", "won", "lost", "warning_closed", "prevented", "unknown", "conflict"]);
const resolvedDisputeStatuses = new Set(["won", "warning_closed", "prevented"]);

export function paymentDisputeHeld(record) {
  return record?.paymentStatus === "disputed" || record?.disputeReviewRequired === true
    || (Array.isArray(record?.disputes) && record.disputes.some((item) => item.requiresReview === true || !resolvedDisputeStatuses.has(item.status) || item.providerDisputeId == null));
}

export function paymentRecoveryHeld(record) {
  return record?.reconciliationReviewRequired === true
    || (Array.isArray(record?.recoveryCommands) && record.recoveryCommands.some(command => command.recoveryRequired === true));
}

function recoveryCommands(value) {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > 100) throw new Error("Payment recovery evidence is unavailable.");
  const identities = new Set();
  return Object.freeze(value.map(command => {
    if (!command || !uuidPattern.test(command.commandId || "") || identities.has(command.commandId.toLowerCase())
      || !commandKinds.has(command.kind) || !commandStatuses.has(command.status)
      || typeof command.recoveryRequired !== "boolean"
      || (command.recoveryReason != null && !/^[a-z0-9-]{1,120}$/.test(command.recoveryReason))) {
      throw new Error("Payment recovery evidence is unavailable.");
    }
    identities.add(command.commandId.toLowerCase());
    return Object.freeze({ commandId: command.commandId.toLowerCase(), kind: command.kind, status: command.status,
      recoveryRequired: command.recoveryRequired, recoveryReason: command.recoveryReason || null,
      checkedAt: command.checkedAt == null ? null : timestamp(command.checkedAt, "Recovery check time") });
  }));
}

export function paymentRecoveryReasonLabel(reason) {
  if (["awaiting-signed-evidence", "awaiting-signed-terminal-evidence", "found-awaiting-signed-evidence"].includes(reason))
    return "Provider record found. Waiting for verified payment events before the ledger can be settled.";
  if (["provider-unavailable", "provider-search-failed", "provider-request-failed", "provider-search-time-bound", "provider-pagination-bound"].includes(reason))
    return "The provider check could not finish. Check again; no money action is repeated.";
  if (reason === "no-object-found-is-not-proof-of-no-effect")
    return "No matching provider record was found. This does not prove the earlier action failed. Review the original request with Stripe.";
  if (["original-destination-unavailable", "original-source-unavailable", "legacy-attempt-unknown"].includes(reason))
    return "The original payment instructions are incomplete. Review the original request with Stripe before proceeding.";
  if (reason === "partial-transfer-reversal-requires-accounting")
    return "A partial payout reversal needs reconciliation before another money action.";
  return "This earlier action needs reconciliation. Check the provider outcome and review the recorded evidence before continuing.";
}

export function paymentDisputeStatusLabel(value) {
  return ({ warning_needs_response: "Inquiry needs response", warning_under_review: "Inquiry under review", needs_response: "Dispute needs response", under_review: "Dispute under review", won: "Won", lost: "Lost — reconcile funds", warning_closed: "Inquiry closed", prevented: "Chargeback prevented", unknown: "Outcome unverified", conflict: "Conflicting outcomes — review required" })[value] || "Outcome unverified";
}

function paymentDisputes(value) {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) throw new Error("Payment dispute evidence is unavailable.");
  return Object.freeze(value.map((item) => {
    if (!item || !disputeStatuses.has(item.status) || (item.providerDisputeId !== null && !/^du_[A-Za-z0-9_]{1,252}$/.test(item.providerDisputeId || ""))
      || !/^evt_[A-Za-z0-9_]{1,251}$/.test(item.lastEventId || "") || typeof item.requiresReview !== "boolean") throw new Error("Payment dispute evidence is unavailable.");
    return Object.freeze({ providerDisputeId: item.providerDisputeId, status: item.status, lastEventId: item.lastEventId, requiresReview: item.requiresReview || !resolvedDisputeStatuses.has(item.status) || item.providerDisputeId == null });
  }));
}

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
    const disputes = paymentDisputes(record.disputes);
    if (record.disputeReviewRequired !== undefined && typeof record.disputeReviewRequired !== "boolean") throw new Error("Payment dispute review status is unavailable.");
    const disputeReviewRequired = paymentDisputeHeld({ ...record, disputes });
    const commands = recoveryCommands(record.recoveryCommands);
    if (record.reconciliationReviewRequired !== undefined && typeof record.reconciliationReviewRequired !== "boolean") throw new Error("Payment recovery status is unavailable.");
    const reconciliationReviewRequired = paymentRecoveryHeld({ ...record, recoveryCommands: commands });
    const held = disputeReviewRequired || reconciliationReviewRequired;
    return Object.freeze({
      paymentId: record.paymentId.toLowerCase(), bookingId: record.bookingId.toLowerCase(), paymentStatus: record.paymentStatus, bookingStatus: record.bookingStatus,
      scheduledStartAt: timestamp(record.scheduledStartAt, "Booking start time"), scheduledEndAt: timestamp(record.scheduledEndAt, "Booking end time"), updatedAt: timestamp(record.updatedAt, "Payment update time"),
      amountPence, amountCapturedPence, amountRefundedPence, cleanerPayPence: integer(record.cleanerPayPence, 1, amountPence, "Cleaner pay"), currency: "gbp",
      payoutReady: record.payoutReady === true, canCapture: !held && record.canCapture === true, canCancel: !held && record.canCancel === true, canRefund: !held && record.canRefund === true, canTransfer: !held && record.canTransfer === true, awaitingProvider: record.awaitingProvider === true,
      disputeReviewRequired, disputes, reconciliationReviewRequired, recoveryCommands: commands
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
  if (paymentDisputeHeld(record)) {
    return Object.freeze({ kind: "dispute-review", title: "Review the payment dispute", copy: "Payment actions are on hold. Check the dispute outcome and reconcile the provider balance before continuing. Money already transferred to a Cleaner is not automatically recovered." });
  }
  if (paymentRecoveryHeld(record)) {
    return Object.freeze({ kind: "reconciliation-review", title: "Check the earlier payment action", copy: "Money actions are on hold until the earlier outcome is verified. Checking the provider outcome does not send another charge, refund or payout." });
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
