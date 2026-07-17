import { createHash, randomUUID } from "node:crypto";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const referencePattern = /^[A-Za-z0-9_:-]{3,255}$/;
const idempotencyPattern = /^[A-Za-z0-9_-]{32,128}$/;
const commandKinds = new Set(["capture", "cancel", "refund", "transfer"]);
const paymentStatuses = new Set(["creating", "requires-customer-action", "processing", "authorized", "authorization-failed", "captured", "partially-refunded", "refunded", "cancelled", "disputed"]);
const bookingStatuses = new Set(["confirmed", "cleaner-en-route", "cleaner-arrived", "cleaning-in-progress", "awaiting-review", "completed", "cancelled", "disputed"]);
const commandStatuses = new Set(["created", "provider-pending", "provider-failed", "reconciled"]);
const eventKinds = new Set([
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

function uuid(value, label) {
  if (!uuidPattern.test(value || "")) throw new TypeError(`A valid ${label} is required.`);
  return value.toLowerCase();
}

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

function administratorPaymentOperation(value) {
  const record = object(value);
  if (!record || typeof record !== "object" || !paymentStatuses.has(record.paymentStatus) || !bookingStatuses.has(record.bookingStatus)) throw new Error("The payment operation is unavailable.");
  const amountPence = positiveInteger(record.amountPence, "Payment amount");
  const captured = exactInteger(record.amountCapturedPence, 0, amountPence, "Captured amount");
  const refunded = exactInteger(record.amountRefundedPence, 0, captured, "Refunded amount");
  const cleanerPay = positiveInteger(record.cleanerPayPence, "Cleaner pay");
  if (cleanerPay > amountPence) throw new Error("The payment operation economics are unavailable.");
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
    canCapture: record.canCapture === true,
    canCancel: record.canCancel === true,
    canRefund: record.canRefund === true,
    canTransfer: record.canTransfer === true,
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
  return Object.freeze(result);
}

export function createPaymentService(repository, provider, options = {}) {
  const requiredRepository = ["getByBooking", "listForAdministrator", "beginAuthorization", "recordAuthorization", "beginCommand", "recordCommand", "reconcileEvent"];
  const requiredProvider = ["createAuthorization", "retrieveAuthorization", "capture", "cancel", "refund", "transfer", "verifyWebhook"];
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

  async function runCommand(actor, kind, input) {
    if (!commandKinds.has(kind)) throw new TypeError("A supported payment command is required.");
    if (kind === "cancel") requireRole(actor, "landlord", "administrator");
    else requireRole(actor, "administrator");
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
    if (prepared.providerCommandId) return Object.freeze({ commandId: prepared.commandId, paymentId: prepared.paymentId, kind, status: prepared.status });
    const request = {
      idempotencyKey: `tideway_payment_command_${prepared.commandId}`,
      commandId: prepared.commandId,
      paymentId: prepared.paymentId,
      bookingId: prepared.bookingId,
      providerPaymentId: reference(prepared.providerPaymentId, "provider payment id"),
      amountPence: positiveInteger(prepared.amountPence, "Payment command amount"),
      currency: currency(prepared.currency)
    };
    if (kind === "transfer") request.destinationAccountId = reference(prepared.destinationAccountId, "Cleaner destination account id");
    const result = providerCommand(await provider[kind](request));
    const recorded = await repository.recordCommand(actor, prepared.commandId, result);
    return Object.freeze({ commandId: recorded.commandId, paymentId: recorded.paymentId, kind: recorded.kind, status: recorded.status });
  }

  return Object.freeze({
    getClientConfiguration(actor) {
      requireRole(actor, "landlord");
      return Object.freeze({ publishableKey, testMode: true });
    },
    async getForBooking(actor, bookingId) {
      requireRole(actor, "landlord", "administrator");
      const record = await repository.getByBooking(actor, uuid(bookingId, "booking id"));
      return record ? publicPayment(record) : null;
    },
    async listForAdministrator(actor, input = {}) {
      requireRole(actor, "administrator");
      const status = input.status == null || input.status === "" ? "actionable" : String(input.status).trim().toLowerCase();
      if (status !== "actionable" && !paymentStatuses.has(status)) throw new TypeError("Choose a valid payment queue status.");
      const limit = boundedInteger(input.limit, 1, 100, 50, "Payment page size");
      const offset = boundedInteger(input.offset, 0, 10000, 0, "Payment page offset");
      const page = object(await repository.listForAdministrator(actor, { status, limit, offset }));
      if (!page || !Array.isArray(page.payments)) throw new Error("The payment operations queue is unavailable.");
      return Object.freeze({ payments: Object.freeze(page.payments.map(administratorPaymentOperation)), limit: boundedInteger(page.limit, 1, 100, limit, "Payment page size"), offset: boundedInteger(page.offset, 0, 10000, offset, "Payment page offset"), testMode: true });
    },
    beginAuthorization,
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
