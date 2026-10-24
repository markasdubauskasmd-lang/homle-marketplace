import { dispatchPersistedPaymentCommand, recoverPersistedPaymentCommand } from "./payment-command-dispatch.mjs";
import { createHash, randomUUID } from "node:crypto";
import { uuid, uuidPattern } from "./validation.mjs";

const referencePattern = /^[A-Za-z0-9_:-]{3,255}$/;
const idempotencyPattern = /^[A-Za-z0-9_-]{32,128}$/;
const commandKinds = new Set(["capture", "cancel", "refund", "transfer"]);
const paymentStatuses = new Set(["creating", "requires-customer-action", "processing", "authorized", "authorization-failed", "captured", "partially-refunded", "refunded", "cancelled", "disputed"]);
const bookingStatuses = new Set(["confirmed", "cleaner-en-route", "cleaner-arrived", "cleaning-in-progress", "awaiting-review", "completed", "cancelled", "disputed"]);
const commandStatuses = new Set(["created", "provider-pending", "provider-failed", "reconciled"]);
const disputeStatuses = new Set(["warning_needs_response", "warning_under_review", "needs_response", "under_review", "won", "lost", "warning_closed", "prevented", "unknown", "conflict"]);
const eventKinds = new Set([
  "refund-pending",
  "intent-cancelled-observed",
  "authorization-requires-action",
  "authorization-processing",
  "authorization-succeeded",
  "authorization-failed",
  "capture-succeeded",
  "capture-failed",
  "cancellation-succeeded",
  "cancellation-failed",
  "refund-succeeded",
  "refund-failed",
  "transfer-succeeded",
  "transfer-failed",
  "transfer-reversed",
  "dispute-opened",
  "dispute-closed"
]);

function reference(value, label) {
  if (!referencePattern.test(value || "")) throw new TypeError(`A valid ${label} is required.`);
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1 || value > 10_000_000) throw new TypeError(`${label} is outside the supported range.`);
  return value;
}

function keyHash(value) {
  if (!idempotencyPattern.test(value || "")) throw new TypeError("A strong payment idempotency key is required.");
  return createHash("sha256").update(value).digest();
}

function actorHas(actor, role) {
  return uuidPattern.test(actor?.userId || "") && Array.isArray(actor.roles) && actor.roles.includes(role);
}

function object(value) {
  if (typeof value === "string") { try { return JSON.parse(value); } catch { return null; } }
  return value;
}

function timestamp(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`${label} is unavailable.`);
  return new Date(value).toISOString();
}

function boundedInteger(value, minimum, maximum, fallback, label) {
  if (value == null || value === "") return fallback;
  const selected = Number(value);
  if (!Number.isInteger(selected) || selected < minimum || selected > maximum) throw new TypeError(`${label} is outside the supported range.`);
  return selected;
}

function exactInteger(value, minimum, maximum, label) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${label} is unavailable.`);
  return value;
}

function optionalCommandStatus(value) {
  if (value == null) return null;
  if (!commandStatuses.has(value)) throw new Error("A payment action status is unavailable.");
  return value;
}

function recoveryReason(value) {
  if (value == null) return null;
  if (typeof value !== "string" || !/^[a-z][a-z0-9-]{0,119}$/.test(value)) throw new Error("Payment recovery details are unavailable.");
  return value;
}

function publicCommandRecovery(record) {
  if (!record || !commandKinds.has(record.kind) || !commandStatuses.has(record.status)
    || typeof record.recoveryRequired !== "boolean") throw new Error("Payment recovery details are unavailable.");
  return Object.freeze({ commandId: uuid(record.commandId, "payment command id"), paymentId: uuid(record.paymentId, "payment id"),
    kind: record.kind, status: record.status, recoveryRequired: record.recoveryRequired, recoveryReason: recoveryReason(record.recoveryReason),
    signedEventsReplayed: exactInteger(record.signedEventsReplayed, 0, 100, "Replayed payment events") });
}

function administratorPaymentOperation(value) {
  const record = object(value);
  if (!record || typeof record !== "object" || !paymentStatuses.has(record.paymentStatus) || !bookingStatuses.has(record.bookingStatus)) throw new Error("The payment operation is unavailable.");
  const amountPence = positiveInteger(record.amountPence, "Payment amount");
  const captured = exactInteger(record.amountCapturedPence, 0, amountPence, "Captured amount");
  const refunded = exactInteger(record.amountRefundedPence, 0, captured, "Refunded amount");
  const cleanerPay = positiveInteger(record.cleanerPayPence, "Cleaner pay");
  if (cleanerPay > amountPence) throw new Error("The payment operation economics are unavailable.");
  const disputes = (record.disputes || []).map((dispute) => {
    if (!disputeStatuses.has(dispute.status) || dispute.providerDisputeId != null && !/^du_[A-Za-z0-9_]{3,250}$/.test(dispute.providerDisputeId)
      || typeof dispute.requiresReview !== "boolean") throw new Error("Dispute reconciliation details are unavailable.");
    return Object.freeze({ providerDisputeId: dispute.providerDisputeId ?? null, status: dispute.status,
      lastEventId: reference(dispute.lastEventId, "dispute event id"), requiresReview: dispute.requiresReview });
  });
  const disputeReviewRequired = record.disputeReviewRequired === true || record.paymentStatus === "disputed" || disputes.some(dispute => dispute.requiresReview);
  if (!Array.isArray(record.recoveryCommands || []) || (record.recoveryCommands || []).length > 100) throw new Error("Payment recovery details are unavailable.");
  const recoveryCommands = (record.recoveryCommands || []).map(command => {
    if (!commandKinds.has(command.kind) || !commandStatuses.has(command.status) || typeof command.recoveryRequired !== "boolean") throw new Error("Payment recovery details are unavailable.");
    return Object.freeze({ commandId: uuid(command.commandId, "payment command id"), kind: command.kind, status: command.status,
      recoveryRequired: command.recoveryRequired, recoveryReason: recoveryReason(command.recoveryReason),
      checkedAt: command.checkedAt == null ? null : timestamp(command.checkedAt, "Payment recovery check") });
  });
  if (!Array.isArray(record.observations || []) || (record.observations || []).length > 100) throw new Error("Payment observation details are unavailable.");
  const observations = (record.observations || []).map(item => {
    if (!["refund", "cancellation"].includes(item.kind) || !["pending", "succeeded", "failed", "cancelled", "unresolved"].includes(item.status)
      || !new RegExp(`^${item.kind === "refund" ? "re" : "pi"}_[A-Za-z0-9_]{3,250}$`).test(item.providerObjectId || "")
      || !/^evt_[A-Za-z0-9_]{3,250}$/.test(item.lastEventId || "") || typeof item.requiresReview !== "boolean") throw new Error("Payment observation details are unavailable.");
    const amount = positiveInteger(item.amountPence, "Observed amount");
    return Object.freeze({ providerObjectId: item.providerObjectId, kind: item.kind, status: item.status, amountPence: amount,
      appliedPence: exactInteger(item.appliedPence, 0, amount, "Observed applied amount"), reason: recoveryReason(item.reason),
      lastEventId: item.lastEventId, requiresReview: item.requiresReview });
  });
  const reconciliationReviewRequired = record.reconciliationReviewRequired === true || recoveryCommands.some(command => command.recoveryRequired) || observations.some(item => item.requiresReview);
  const result = {
    paymentId: uuid(record.paymentId, "payment id"),
    bookingId: uuid(record.bookingId, "booking id"),
    paymentStatus: record.paymentStatus,
    bookingStatus: record.bookingStatus,
    scheduledStartAt: timestamp(record.scheduledStartAt, "Booking start time"),
    scheduledEndAt: timestamp(record.scheduledEndAt, "Booking end time"),
    amountPence,
    currency: currency(record.currency),
    amountCapturedPence: captured,
    amountRefundedPence: refunded,
    cleanerPayPence: cleanerPay,
    payoutReady: record.payoutReady === true,
    canCapture: !disputeReviewRequired && !reconciliationReviewRequired && record.canCapture === true,
    canCancel: !disputeReviewRequired && !reconciliationReviewRequired && record.canCancel === true,
    canRefund: !disputeReviewRequired && !reconciliationReviewRequired && record.canRefund === true,
    canTransfer: !disputeReviewRequired && !reconciliationReviewRequired && record.canTransfer === true,
    reconciliationReviewRequired,
    recoveryCommands: Object.freeze(recoveryCommands),
    observations: Object.freeze(observations),
    disputeReviewRequired,
    disputes: Object.freeze(disputes),
    awaitingProvider: record.awaitingProvider === true,
    captureStatus: optionalCommandStatus(record.captureStatus),
    cancelStatus: optionalCommandStatus(record.cancelStatus),
    refundStatus: optionalCommandStatus(record.refundStatus),
    transferStatus: optionalCommandStatus(record.transferStatus),
    updatedAt: timestamp(record.updatedAt, "Payment update time")
  };
  return Object.freeze(result);
}

function requireRole(actor, ...roles) {
  if (!roles.some((role) => actorHas(actor, role))) throw Object.assign(new Error("You are not allowed to perform this payment action."), { statusCode: 403, code: "payment-role-required" });
}

function currency(value) {
  if (value !== "gbp") throw new TypeError("Only GBP payments are supported in the Homle pilot.");
  return value;
}

function publicPayment(record, clientSecret = null) {
  if (!record) throw new TypeError("A payment record is required.");
  const notStarted = record.paymentId == null && record.status === "not-started";
  return Object.freeze({
    paymentId: notStarted ? null : uuid(record.paymentId, "payment id"),
    bookingId: uuid(record.bookingId, "booking id"),
    status: String(record.status || ""),
    amountPence: positiveInteger(record.amountPence, "Payment amount"),
    currency: currency(record.currency),
    amountCapturedPence: Number.isInteger(record.amountCapturedPence) ? record.amountCapturedPence : 0,
    amountRefundedPence: Number.isInteger(record.amountRefundedPence) ? record.amountRefundedPence : 0,
    requiresCustomerAction: record.status === "requires-customer-action",
    clientSecret: record.status === "requires-customer-action" && typeof clientSecret === "string" && clientSecret.length <= 512 ? clientSecret : null
  });
}

function providerAuthorization(result, expected) {
  const allowed = new Set(["requires-customer-action", "processing", "authorized", "failed"]);
  if (!result || !allowed.has(result.status) || result.amountPence !== expected.amountPence || result.currency !== expected.currency) throw new TypeError("The payment provider returned an invalid authorization result.");
  return Object.freeze({
    providerPaymentId: reference(result.id, "provider payment id"),
    status: result.status,
    clientSecret: typeof result.clientSecret === "string" && result.clientSecret.length <= 512 ? result.clientSecret : null
  });
}

function providerCommand(result) {
  const allowed = new Set(["pending", "succeeded", "failed"]);
  if (!result || !allowed.has(result.status)) throw new TypeError("The payment provider returned an invalid command result.");
  return Object.freeze({ providerCommandId: reference(result.id, "provider command id"), status: result.status });
}

function normalizedEvent(value, payloadHash) {
  if (!value || !eventKinds.has(value.kind)) throw new TypeError("The payment provider returned an unsupported event.");
  const occurredAt = new Date(value.occurredAt);
  if (!Number.isFinite(occurredAt.getTime()) || occurredAt.getTime() > Date.now() + 5 * 60_000) throw new TypeError("The payment provider event time is invalid.");
  const amountPence = value.amountPence == null ? null : positiveInteger(value.amountPence, "Provider event amount");
  const result = {
    provider: "stripe",
    providerEventId: reference(value.eventId, "provider event id"),
    kind: value.kind,
    providerObjectId: reference(value.objectId, "provider object id"),
    paymentId: value.paymentId == null ? null : uuid(value.paymentId, "payment id"),
    commandId: value.commandId == null ? null : uuid(value.commandId, "payment command id"),
    amountPence,
    currency: value.currency == null ? null : currency(value.currency),
    occurredAt: occurredAt.toISOString(),
    payloadHash
  };
  if (value.kind.startsWith("refund-") || value.kind.startsWith("transfer-")) {
    for (const [field, prefix] of [["providerPaymentId", "pi"], ["sourceChargeId", "ch"]]) {
      if (typeof value[field] !== "string" || !new RegExp(`^${prefix}_[A-Za-z0-9_]{3,250}$`).test(value[field])) throw new TypeError("The payment provider returned an invalid event parent identity.");
      result[field] = value[field];
    }
    if (value.kind.startsWith("transfer-")) {
      if (typeof value.destinationAccountId !== "string" || !/^acct_[A-Za-z0-9_]{3,250}$/.test(value.destinationAccountId)) throw new TypeError("The payment provider returned an invalid event destination identity.");
      result.destinationAccountId = value.destinationAccountId;
    } else {
      if (value.destinationAccountId != null) throw new TypeError("The payment provider returned an unexpected refund destination identity.");
      result.destinationAccountId = null;
    }
  }
  if (value.kind === "intent-cancelled-observed") {
    if (!/^pi_[A-Za-z0-9_]{3,250}$/.test(value.providerPaymentId || "") || value.providerPaymentId !== value.objectId
      || value.sourceChargeId != null || value.destinationAccountId != null) throw new TypeError("The cancellation parent identity is invalid.");
    result.commandId = null;
    result.providerPaymentId = value.providerPaymentId;
    result.sourceChargeId = null;
    result.destinationAccountId = null;
  }
  if (value.kind === "dispute-opened" || value.kind === "dispute-closed") {
    if (value.disputeId != null && !/^du_[A-Za-z0-9_]{3,250}$/.test(value.disputeId)) throw new TypeError("The payment provider returned an invalid dispute identity.");
    result.commandId = null;
    result.amountPence = null;
    result.currency = null;
    result.disputeId = value.disputeId ?? null;
    result.disputeStatus = disputeStatuses.has(value.disputeStatus) ? value.disputeStatus : "unknown";
  }
  return Object.freeze(result);
}

export function createPaymentService(repository, provider, options = {}) {
  if (options.commandWritesPaused !== undefined && typeof options.commandWritesPaused !== "boolean") throw new TypeError("Payment command pause must be a boolean.");
  const commandWritesPaused = options.commandWritesPaused === true;
  const requiredRepository = ["getByBooking", "listForAdministrator", "getForAdministratorBooking", "beginAuthorization", "recordAuthorization", "beginCommand", "recordCommand", "reconcileEvent", "claimCommandAttempt", "recordCommandRecovery", "getCommandAttempt", "getAdministratorCommandRecovery"];
  const requiredProvider = ["createAuthorization", "createSandboxCheckout", "retrieveAuthorization", "capture", "cancel", "refund", "transfer", "verifyWebhook", "prepareCommandAttempt", "discoverCommandObject"];
  if (!repository || requiredRepository.some((method) => typeof repository[method] !== "function")) throw new TypeError("A complete payment repository is required.");
  if (!provider || provider.name !== "stripe" || requiredProvider.some((method) => typeof provider[method] !== "function")) throw new TypeError("A complete Stripe payment adapter is required.");
  const publishableKey = String(options.publishableKey || "").trim();
  if (!/^pk_test_[A-Za-z0-9_]{16,200}$/.test(publishableKey)) throw new TypeError("A Stripe test publishable key is required for the payment client.");
  const createId = typeof options.createId === "function" ? options.createId : randomUUID;

  async function beginAuthorization(actor, input) {
    requireRole(actor, "landlord");
    const bookingId = uuid(input?.bookingId, "booking id");
    const idempotencyKeyHash = keyHash(input?.idempotencyKey);
    const paymentId = uuid(createId(), "generated payment id");
    const prepared = await repository.beginAuthorization(actor, { paymentId, bookingId, provider: "stripe", idempotencyKeyHash });
    if (prepared.providerPaymentId) {
      if (!["requires-customer-action", "authorization-failed", "processing"].includes(prepared.status)) return publicPayment(prepared);
      const refreshed = providerAuthorization(await provider.retrieveAuthorization({ providerPaymentId: prepared.providerPaymentId }), prepared);
      if (refreshed.providerPaymentId !== prepared.providerPaymentId) throw new TypeError("The payment provider returned the wrong authorization.");
      return publicPayment(await repository.recordAuthorization(actor, prepared.paymentId, refreshed), refreshed.clientSecret);
    }
    const result = providerAuthorization(await provider.createAuthorization({
      idempotencyKey: `tideway_payment_${prepared.paymentId}`,
      paymentId: prepared.paymentId,
      bookingId: prepared.bookingId,
      amountPence: prepared.amountPence,
      currency: prepared.currency,
      transferGroup: `tideway_booking_${prepared.bookingId}`
    }), prepared);
    const recorded = await repository.recordAuthorization(actor, prepared.paymentId, result);
    return publicPayment(recorded, result.clientSecret);
  }

  async function beginSandboxCheckout(actor, input) {
    requireRole(actor, "landlord");
    keyHash(input?.idempotencyKey);
    const actorHash = createHash("sha256").update(actor.userId).digest("hex");
    const idempotencyKey = `homle_sandbox_${createHash("sha256").update(`${actor.userId}:${input.idempotencyKey}`).digest("hex")}`;
    const result = providerAuthorization(await provider.createSandboxCheckout({
      idempotencyKey,
      actorHash,
      amountPence: 30,
      currency: "gbp"
    }), { amountPence: 30, currency: "gbp" });
    return Object.freeze({
      status: result.status,
      amountPence: 30,
      currency: "gbp",
      requiresCustomerAction: result.status === "requires-customer-action",
      clientSecret: result.status === "requires-customer-action" ? result.clientSecret : null,
      testMode: true
    });
  }

  async function runCommand(actor, kind, input) {
    if (!commandKinds.has(kind)) throw new TypeError("A supported payment command is required.");
    if (kind === "cancel") requireRole(actor, "landlord", "administrator");
    else requireRole(actor, "administrator");
    if (commandWritesPaused) throw Object.assign(new Error("Payment settlement is temporarily paused for maintenance. No payment action was sent. Try again later."), {statusCode:503,code:"payment-command-writes-paused"});
    const paymentId = uuid(input?.paymentId, "payment id");
    const amountPence = kind === "refund" ? positiveInteger(input?.amountPence, "Refund amount") : null;
    const idempotencyKeyHash = keyHash(input?.idempotencyKey);
    const commandId = uuid(createId(), "generated payment command id");
    const prepared = await repository.beginCommand(actor, {
      commandId,
      paymentId,
      kind,
      amountPence,
      idempotencyKeyHash
    });
    const request = {
      idempotencyKey: `tideway_payment_command_${prepared.commandId}`,
      commandId: prepared.commandId,
      paymentId: prepared.paymentId,
      bookingId: prepared.bookingId,
      providerPaymentId: reference(prepared.providerPaymentId, "provider payment id"),
      amountPence: positiveInteger(prepared.amountPence, "Payment command amount"),
      currency: currency(prepared.currency)
    };
    const result = await dispatchPersistedPaymentCommand({ actor, prepared, kind, request, repository, provider, normalizeProviderCommand: providerCommand });
    return Object.hasOwn(result, "recoveryRequired") ? publicCommandRecovery(result) : result;
  }

  return Object.freeze({
    async replayObservations(actor, paymentId) {
      requireRole(actor, "administrator");
      const id = uuid(paymentId, "payment id");
      const result = await repository.replayObservations(actor, id);
      if (!result || result.paymentId !== id || typeof result.recoveryRequired !== "boolean") throw new Error("Payment observation recovery is unavailable.");
      return Object.freeze({ paymentId: id, recoveryRequired: result.recoveryRequired,
        signedEventsReplayed: exactInteger(result.signedEventsReplayed, 0, 100, "Replayed payment events") });
    },
    async recoverCommand(actor, commandId) {
      requireRole(actor, "administrator");
      const selectedId = uuid(commandId, "payment command id");
      const command = object(await repository.getAdministratorCommandRecovery(actor, selectedId));
      if (!command || command.commandId !== selectedId) throw Object.assign(new Error("The payment action was not found."), { code: "payment-command-not-found", statusCode: 404 });
      return publicCommandRecovery(await recoverPersistedPaymentCommand({ actor, command, repository, provider }));
    },
    getClientConfiguration(actor) {
      requireRole(actor, "landlord");
      return Object.freeze({ publishableKey, testMode: true });
    },
    async getReceiptForBooking(actor, bookingId) {
      requireRole(actor, "landlord");
      const selectedBookingId = uuid(bookingId, "booking id");
      if (typeof repository.getForReceipt !== "function" || typeof provider.retrieveReceipt !== "function") {
        throw Object.assign(new Error("Receipts are temporarily unavailable. Try again later."), { statusCode: 503, code: "receipt-unavailable" });
      }
      // The database verifies ownership before any external provider lookup.
      const record = await repository.getForReceipt(actor, selectedBookingId);
      if (!record || !record.providerPaymentId || !Number.isInteger(record.amountCapturedPence) || record.amountCapturedPence < 1) {
        return Object.freeze({ available: false, reason: "not-captured" });
      }
      try {
        const receipt = await provider.retrieveReceipt(record);
        return receipt ? Object.freeze({ available: true, ...receipt }) : Object.freeze({ available: false, reason: "not-ready" });
      } catch {
        throw Object.assign(new Error("The payment receipt could not be verified. Try again later."), { statusCode: 503, code: "receipt-unavailable" });
      }
    },
    async getForBooking(actor, bookingId) {
      requireRole(actor, "landlord", "administrator");
      const record = await repository.getByBooking(actor, uuid(bookingId, "booking id"));
      return record ? publicPayment(record) : null;
    },
    async listForAdministrator(actor, input = {}) {
      requireRole(actor, "administrator");
      const bookingId = input.bookingId == null || input.bookingId === "" ? null : uuid(String(input.bookingId).trim(), "booking id");
      const status = input.status == null || input.status === "" ? "actionable" : String(input.status).trim().toLowerCase();
      if (status !== "actionable" && !paymentStatuses.has(status)) throw new TypeError("Choose a valid payment queue status.");
      const limit = boundedInteger(input.limit, 1, 100, 50, "Payment page size");
      const offset = boundedInteger(input.offset, 0, 10000, 0, "Payment page offset");
      const page = bookingId
        ? { payments: [object(await repository.getForAdministratorBooking(actor, bookingId))].filter(Boolean), limit: 1, offset: 0 }
        : object(await repository.listForAdministrator(actor, { status, limit, offset }));
      if (!page || !Array.isArray(page.payments)) throw new Error("The payment operations queue is unavailable.");
      return Object.freeze({ payments: Object.freeze(page.payments.map(administratorPaymentOperation)), limit: boundedInteger(page.limit, 1, 100, limit, "Payment page size"), offset: boundedInteger(page.offset, 0, 10000, offset, "Payment page offset"), testMode: true });
    },
    beginAuthorization,
    beginSandboxCheckout,
    capture(actor, input) { return runCommand(actor, "capture", input); },
    cancel(actor, input) { return runCommand(actor, "cancel", input); },
    refund(actor, input) { return runCommand(actor, "refund", input); },
    transfer(actor, input) { return runCommand(actor, "transfer", input); },
    async handleWebhook(rawBody, signature) {
      const bytes = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(typeof rawBody === "string" ? rawBody : "");
      if (!bytes.length || bytes.length > 1024 * 1024 || typeof signature !== "string" || !signature.trim() || signature.length > 2048) throw Object.assign(new Error("The payment webhook could not be verified."), { statusCode: 400, code: "invalid-payment-webhook" });
      const verified = await provider.verifyWebhook(bytes, signature);
      if (verified?.ignored === true) return Object.freeze({ accepted: true, duplicate: false, ignored: true });
      const event = normalizedEvent(verified, createHash("sha256").update(bytes).digest("hex"));
      return repository.reconcileEvent(event);
    }
  });
}
