import { performance } from "node:perf_hooks";

const id = (value, prefix) => typeof value === "string" && new RegExp(`^${prefix}_[A-Za-z0-9_]{3,250}$`).test(value);
const ref = value => typeof value === "string" ? value : value?.id;
const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || "");
const review = (reason, details = {}) => Object.freeze({ outcome: "operator-required", reason, ...details });

// This grant uses the DB's remaining interval and the client's monotonic elapsed
// time, not an absolute wall-clock comparison across potentially skewed hosts.
// The DB grants no more than 23h from the FIRST reservation. Never renew it.
export function canDispatchCommand(grant, requestedAt, now = performance.now()) {
  return grant?.action === "post" && Number.isFinite(grant.remainingMs)
    && grant.remainingMs <= 23 * 60 * 60 * 1000 && Number.isFinite(requestedAt) && Number.isFinite(now)
    && grant.remainingMs > Math.max(0, now - requestedAt) + 60_000;
}

export function assertCommandPostWindow(request) {
  if (!Number.isFinite(request?.postDeadline) || performance.now() + 60_000 >= request.postDeadline) {
    throw Object.assign(new Error("This payment attempt requires reconciliation before another provider request."),
      { code: "payment-attempt-deadline", statusCode: 409 });
  }
}

function exactMetadata(object, expected) {
  return object?.metadata?.tideway_command_id === expected.commandId
    && object.metadata.tideway_payment_id === expected.paymentId
    && object.metadata.tideway_booking_id === expected.bookingId;
}

function validateInput(expected) {
  if (!["capture", "cancel", "refund", "transfer"].includes(expected?.kind)
    || !uuid(expected.paymentId) || !uuid(expected.bookingId) || !uuid(expected.commandId)
    || !id(expected.providerPaymentId, "pi") || expected.currency !== "gbp"
    || !Number.isInteger(expected.amountPence) || expected.amountPence < 1 || expected.amountPence > 10_000_000) {
    throw new TypeError("A persisted payment command identity is required for recovery.");
  }
}

// GET-only discovery. No synthetic events, new provider keys, POSTs, or changes
// to captured/refunded balances are possible through this module.
export async function discoverCommandObject(stripe, expected, options = {}) {
  validateInput(expected);
  const maximumPages = options.maximumPages ?? 10;
  if (!Number.isInteger(maximumPages) || maximumPages < 1 || maximumPages > 10) throw new TypeError("Invalid recovery page bound.");
  const requestOptions = { timeout: 10_000, maxNetworkRetries: 0 };
  const now = options.now || (() => performance.now());
  const started = now();
  if (expected.kind === "transfer" && !id(expected.destinationAccountId, "acct")) return review("original-destination-unavailable");
  if (expected.kind === "transfer" && !id(expected.sourceChargeId, "ch")) return review("original-source-unavailable");
  const intent = await stripe.paymentIntents.retrieve(expected.providerPaymentId, {}, requestOptions);
  if (intent?.id !== expected.providerPaymentId || intent.livemode !== false || intent.currency !== "gbp"
    || intent.metadata?.tideway_payment_id !== expected.paymentId || intent.metadata?.tideway_booking_id !== expected.bookingId) {
    return review("parent-identity-conflict");
  }
  if (expected.kind === "capture" || expected.kind === "cancel") {
    if (intent.object !== "payment_intent" || intent.amount !== expected.amountPence
      || expected.providerCommandId && expected.providerCommandId !== intent.id
      || !exactMetadata(intent, expected)) return review("command-object-conflict");
    if (!["requires_payment_method", "requires_confirmation", "requires_action", "requires_capture", "processing", "succeeded", "canceled"].includes(intent.status)) return review("unsupported-payment-intent-state");
    if (intent.status === "succeeded" && intent.amount_received !== expected.amountPence) return review("captured-amount-conflict");
    return Object.freeze({ outcome: "found-awaiting-signed-evidence", providerObjectId: intent.id,
      evidence: Object.freeze({ source: "stripe-api-discovery", amountPence: expected.amountPence, currency: expected.currency,
        providerPaymentId: intent.id, sourceChargeId: null, destinationAccountId: null,
        observedStatus: intent.status, observedReversedAmount: null }) });
  }
  const resource = expected.kind === "refund" ? stripe.refunds : stripe.transfers;
  const prefix = expected.kind === "refund" ? "re" : "tr";
  const filters = expected.kind === "refund"
    ? { payment_intent: expected.providerPaymentId }
    : { transfer_group: `tideway_booking_${expected.bookingId}`, destination: expected.destinationAccountId };
  const matches = [];
  const visited = new Set();
  let cursor;
  let complete = false;
  // No created-date ceiling: an indeterminate request can be rolled forward by
  // Stripe later. A bounded search must never pretend it exhausted the ledger.
  for (let pageNumber = 0; pageNumber < maximumPages; pageNumber++) {
    if (now() - started >= 25_000) return review("provider-search-time-bound", { examined: visited.size });
    const page = await resource.list({ ...filters, limit: 100, ...(cursor ? { starting_after: cursor } : {}) }, requestOptions);
    if (page?.object !== "list" || !Array.isArray(page.data) || typeof page.has_more !== "boolean" || page.data.length > 100) {
      return review("invalid-provider-page");
    }
    for (const object of page.data) {
      if (!id(object?.id, prefix) || visited.has(object.id)) return review("non-progressing-provider-page");
      visited.add(object.id);
      if (object.metadata?.tideway_command_id !== expected.commandId) continue;
      if (!exactMetadata(object, expected) || object.amount !== expected.amountPence || object.currency !== expected.currency
        || object.object !== (expected.kind === "refund" ? "refund" : "transfer")) return review("command-object-conflict");
      if (expected.kind === "refund") {
        if (ref(object.payment_intent) !== expected.providerPaymentId || !id(ref(object.charge), "ch")) return review("refund-parent-conflict");
        if (!["pending","requires_action","succeeded","failed","canceled"].includes(object.status)) return review("unsupported-refund-state");
      } else {
        if (object.livemode !== false || ref(object.destination) !== expected.destinationAccountId
          || object.transfer_group !== filters.transfer_group || !id(ref(object.source_transaction), "ch")
          || expected.sourceChargeId && ref(object.source_transaction) !== expected.sourceChargeId) return review("transfer-parent-conflict");
        if (!Number.isInteger(object.amount_reversed) || object.amount_reversed < 0 || object.amount_reversed > object.amount
          || typeof object.reversed !== "boolean" || object.reversed !== (object.amount_reversed === object.amount)) return review("invalid-transfer-reversal-state");
        if (object.amount_reversed > 0 && object.amount_reversed < object.amount) return review("partial-transfer-reversal-requires-accounting");
      }
      matches.push(object);
      if (matches.length > 1) return review("multiple-command-objects", { providerObjectIds: matches.map(item => item.id) });
    }
    if (!page.has_more) { complete = true; break; }
    if (!page.data.length) return review("non-progressing-provider-page");
    cursor = page.data.at(-1).id;
  }
  if (!complete) return review("provider-pagination-bound", { examined: visited.size });
  if (!matches.length) return review("no-object-found-is-not-proof-of-no-effect", { examined: visited.size });
  const match = matches[0];
  if (expected.providerCommandId && match.id !== expected.providerCommandId) return review("bound-object-conflict");
  if (now() - started >= 25_000) return review("provider-search-time-bound", { examined: visited.size });
  const chargeId = ref(expected.kind === "refund" ? match.charge : match.source_transaction);
  const charge = await stripe.charges.retrieve(chargeId, {}, requestOptions);
  if (charge?.id !== chargeId || charge.livemode !== false || ref(charge.payment_intent) !== expected.providerPaymentId
    || charge.currency !== expected.currency || charge.paid !== true || charge.captured !== true
    || !Number.isInteger(charge.amount_captured) || charge.amount_captured < expected.amountPence) return review("charge-parent-conflict");
  return Object.freeze({ outcome: "found-awaiting-signed-evidence", providerObjectId: match.id,
    evidence: Object.freeze({ source: "stripe-api-discovery", amountPence: match.amount, currency: match.currency,
      providerPaymentId: expected.providerPaymentId, sourceChargeId: chargeId,
      destinationAccountId: expected.kind === "transfer" ? expected.destinationAccountId : null,
      observedStatus: typeof match.status === "string" ? match.status : null,
      observedReversedAmount: Number.isInteger(match.amount_reversed) ? match.amount_reversed : null }) });
}
