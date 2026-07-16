const stripeApiVersion = "2026-03-25.dahlia";
const testKeyPattern = /^sk_test_[A-Za-z0-9_]{16,200}$/;
const webhookSecretPattern = /^whsec_[A-Za-z0-9_]{16,200}$/;
const providerReferencePattern = /^(?:pi|re|tr|ch|acct|evt)_[A-Za-z0-9_]{3,250}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function reference(value, label) {
  if (!providerReferencePattern.test(value || "")) throw new TypeError(`Stripe returned an invalid ${label}.`);
  return value;
}

function paymentInput(input) {
  if (!input || !uuidPattern.test(input.paymentId || "") || !uuidPattern.test(input.bookingId || "") || !Number.isInteger(input.amountPence) || input.amountPence < 1 || input.amountPence > 10_000_000 || input.currency !== "gbp" || !/^tideway_(?:payment|payment_command)_[0-9a-f-]{36}$/.test(input.idempotencyKey || "")) throw new TypeError("A complete Tideway payment request is required.");
  return input;
}

function commandInput(input) {
  paymentInput(input);
  if (!uuidPattern.test(input.commandId || "")) throw new TypeError("A Tideway payment command reference is required.");
  return input;
}

function metadata(input) {
  return {
    tideway_payment_id: input.paymentId,
    tideway_booking_id: input.bookingId,
    ...(input.commandId ? { tideway_command_id: input.commandId } : {})
  };
}

function authorizationResult(intent) {
  const statuses = {
    requires_action: "requires-customer-action",
    requires_confirmation: "requires-customer-action",
    requires_payment_method: "requires-customer-action",
    processing: "processing",
    requires_capture: "authorized",
    succeeded: "authorized",
    canceled: "failed"
  };
  const status = statuses[intent?.status];
  if (!status || !Number.isInteger(intent.amount) || intent.currency !== "gbp") throw new TypeError("Stripe returned an unsupported PaymentIntent state.");
  return Object.freeze({
    id: reference(intent.id, "PaymentIntent id"),
    status,
    clientSecret: typeof intent.client_secret === "string" ? intent.client_secret : null,
    amountPence: intent.amount,
    currency: intent.currency
  });
}

function commandResult(object, successStatus, pendingStatuses = []) {
  const status = object?.status === successStatus ? "succeeded" : pendingStatuses.includes(object?.status) ? "pending" : "failed";
  return Object.freeze({ id: reference(object?.id, "payment command id"), status });
}

function objectReference(value) {
  return typeof value === "string" ? value : value?.id;
}

function eventTime(value) {
  if (!Number.isInteger(value) || value < 1) throw new TypeError("Stripe returned an invalid event timestamp.");
  return new Date(value * 1000).toISOString();
}

function metadataReferences(value) {
  const supplied = value?.metadata && typeof value.metadata === "object" ? value.metadata : {};
  const paymentId = supplied.tideway_payment_id;
  const commandId = supplied.tideway_command_id;
  const hasAnyTidewayReference = Object.keys(supplied).some((key) => key.startsWith("tideway_"));
  if (!hasAnyTidewayReference) return null;
  if (!uuidPattern.test(paymentId || "") || (commandId != null && !uuidPattern.test(commandId))) throw new TypeError("Stripe event metadata contains an invalid Tideway reference.");
  return { paymentId: paymentId.toLowerCase(), commandId: commandId ? commandId.toLowerCase() : null };
}

function normalizedEvent(event, kind, object, references, overrides = {}) {
  return Object.freeze({
    eventId: reference(event.id, "event id"),
    kind,
    objectId: reference(overrides.objectId || object.id, "event object id"),
    paymentId: references.paymentId,
    commandId: references.commandId,
    amountPence: overrides.amountPence ?? (Number.isInteger(object.amount) ? object.amount : null),
    currency: overrides.currency ?? (object.currency === "gbp" ? "gbp" : null),
    occurredAt: eventTime(event.created)
  });
}

export async function createStripePaymentProvider(configuration = {}, options = {}) {
  const secretKey = String(configuration.secretKey || "").trim();
  const webhookSecret = String(configuration.webhookSecret || "").trim();
  if (!testKeyPattern.test(secretKey)) throw new TypeError("A Stripe test secret key is required; live keys are prohibited by this adapter.");
  if (!webhookSecretPattern.test(webhookSecret)) throw new TypeError("A valid Stripe webhook signing secret is required.");
  let stripe = options.stripeClient;
  if (!stripe) {
    const imported = await import("stripe");
    const Stripe = imported.default || imported.Stripe;
    if (typeof Stripe !== "function") throw new TypeError("The reviewed Stripe SDK is unavailable.");
    stripe = new Stripe(secretKey, { apiVersion: stripeApiVersion, maxNetworkRetries: 2, timeout: 10_000, telemetry: false });
  }
  const required = ["accounts", "paymentIntents", "refunds", "transfers", "charges", "webhooks"];
  if (!required.every((key) => stripe?.[key])) throw new TypeError("The Stripe SDK client is incomplete.");

  async function eventWithDisputePayment(event, dispute) {
    let charge = typeof dispute.charge === "object" ? dispute.charge : await stripe.charges.retrieve(reference(dispute.charge, "dispute charge id"));
    const paymentIntentId = objectReference(charge?.payment_intent);
    if (!paymentIntentId) return { ignored: true, eventId: event.id };
    const intent = await stripe.paymentIntents.retrieve(reference(paymentIntentId, "dispute PaymentIntent id"));
    const references = metadataReferences(intent);
    if (!references) return { ignored: true, eventId: event.id };
    return normalizedEvent(event, event.type === "charge.dispute.created" ? "dispute-opened" : "dispute-closed", dispute, references, { objectId: intent.id, amountPence: null, currency: null });
  }

  async function verifiedEvent(event) {
    if (!event || event.livemode !== false) throw new TypeError("Live Stripe webhook events are prohibited by this adapter.");
    if (event.api_version && event.api_version !== stripeApiVersion) throw new TypeError("Stripe webhook API version does not match the reviewed adapter.");
    const object = event.data?.object;
    if (!object || typeof object !== "object") throw new TypeError("Stripe webhook event data is missing.");
    if (["charge.dispute.created", "charge.dispute.closed"].includes(event.type)) return eventWithDisputePayment(event, object);
    const references = metadataReferences(object);
    if (!references) return Object.freeze({ ignored: true, eventId: reference(event.id, "event id") });
    if (event.type === "payment_intent.amount_capturable_updated" && object.status === "requires_capture") return normalizedEvent(event, "authorization-succeeded", object, references);
    if (event.type === "payment_intent.requires_action") return normalizedEvent(event, "authorization-requires-action", object, references);
    if (event.type === "payment_intent.processing") return normalizedEvent(event, "authorization-processing", object, references);
    if (event.type === "payment_intent.payment_failed") return normalizedEvent(event, references.commandId ? "capture-failed" : "authorization-failed", object, references);
    if (event.type === "payment_intent.succeeded") return normalizedEvent(event, references.commandId ? "capture-succeeded" : "authorization-succeeded", object, references, { amountPence: object.amount_received });
    if (event.type === "payment_intent.canceled") return normalizedEvent(event, references.commandId ? "cancellation-succeeded" : "authorization-failed", object, references);
    if (["refund.created", "refund.updated", "refund.failed"].includes(event.type)) {
      if (object.status === "succeeded") return normalizedEvent(event, "refund-succeeded", object, references);
      if (object.status === "failed" || object.status === "canceled" || event.type === "refund.failed") return normalizedEvent(event, "refund-failed", object, references);
      return Object.freeze({ ignored: true, eventId: reference(event.id, "event id") });
    }
    if (event.type === "transfer.created") return normalizedEvent(event, "transfer-succeeded", object, references);
    if (event.type === "transfer.failed") return normalizedEvent(event, "transfer-failed", object, references);
    if (event.type === "transfer.reversed") return normalizedEvent(event, "transfer-reversed", object, references);
    return Object.freeze({ ignored: true, eventId: reference(event.id, "event id") });
  }

  return Object.freeze({
    name: "stripe",
    apiVersion: stripeApiVersion,
    async verify() {
      const account = await stripe.accounts.retrieve();
      if (!/^acct_[A-Za-z0-9_]{3,250}$/.test(account?.id || "") || account?.charges_enabled !== true) throw new TypeError("The Stripe test platform is not ready to create charges.");
      return Object.freeze({ ready: true, testMode: true });
    },
    async createAuthorization(input) {
      const selected = paymentInput(input);
      const intent = await stripe.paymentIntents.create({
        amount: selected.amountPence,
        currency: "gbp",
        capture_method: "manual",
        automatic_payment_methods: { enabled: true },
        transfer_group: selected.transferGroup,
        metadata: metadata(selected)
      }, { idempotencyKey: selected.idempotencyKey });
      return authorizationResult(intent);
    },
    async retrieveAuthorization(input) {
      const intent = await stripe.paymentIntents.retrieve(reference(input?.providerPaymentId, "PaymentIntent id"));
      return authorizationResult(intent);
    },
    async capture(input) {
      const selected = commandInput(input);
      const intent = await stripe.paymentIntents.capture(reference(selected.providerPaymentId, "PaymentIntent id"), { amount_to_capture: selected.amountPence, metadata: metadata(selected) }, { idempotencyKey: selected.idempotencyKey });
      return commandResult(intent, "succeeded", ["processing"]);
    },
    async cancel(input) {
      const selected = commandInput(input);
      const paymentIntentId = reference(selected.providerPaymentId, "PaymentIntent id");
      await stripe.paymentIntents.update(paymentIntentId, { metadata: metadata(selected) }, { idempotencyKey: `${selected.idempotencyKey}_metadata` });
      const intent = await stripe.paymentIntents.cancel(paymentIntentId, { cancellation_reason: "requested_by_customer" }, { idempotencyKey: selected.idempotencyKey });
      return commandResult(intent, "canceled");
    },
    async refund(input) {
      const selected = commandInput(input);
      const refund = await stripe.refunds.create({ payment_intent: reference(selected.providerPaymentId, "PaymentIntent id"), amount: selected.amountPence, metadata: metadata(selected) }, { idempotencyKey: selected.idempotencyKey });
      return commandResult(refund, "succeeded", ["pending", "requires_action"]);
    },
    async transfer(input) {
      const selected = commandInput(input);
      const intent = await stripe.paymentIntents.retrieve(reference(selected.providerPaymentId, "PaymentIntent id"), { expand: ["latest_charge"] });
      const chargeId = objectReference(intent?.latest_charge);
      if (intent?.status !== "succeeded" || intent?.currency !== selected.currency || !Number.isInteger(intent?.amount_received) || intent.amount_received < selected.amountPence || !chargeId) throw new TypeError("The captured Stripe charge is not ready for Cleaner transfer.");
      const transfer = await stripe.transfers.create({
        amount: selected.amountPence,
        currency: selected.currency,
        destination: reference(selected.destinationAccountId, "Cleaner destination account id"),
        source_transaction: reference(chargeId, "source charge id"),
        transfer_group: `tideway_booking_${selected.bookingId}`,
        metadata: metadata(selected)
      }, { idempotencyKey: selected.idempotencyKey });
      return Object.freeze({ id: reference(transfer?.id, "transfer id"), status: "pending" });
    },
    async verifyWebhook(rawBody, signature) {
      let event;
      try {
        event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
      } catch (cause) {
        throw Object.assign(new Error("The payment webhook could not be verified."), { statusCode: 400, code: "invalid-payment-webhook", cause });
      }
      return verifiedEvent(event);
    }
  });
}

export const stripePaymentApiVersion = stripeApiVersion;
