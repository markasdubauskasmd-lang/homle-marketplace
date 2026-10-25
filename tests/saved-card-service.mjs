import assert from "node:assert/strict";
import { createSavedCardService, createSavedCardAuthorizationWorker, savedCardAuthorizationEnabled } from "../src/marketplace/saved-card-service.mjs";
import { createStripePaymentProvider } from "../src/marketplace/stripe-payment-provider.mjs";

const bookingId = "57575757-5757-4575-8575-575757575757";
const landlord = Object.freeze({ userId: "11111111-1111-4111-8111-111111111111", roles: ["landlord"] });
const administrator = Object.freeze({ userId: "22222222-2222-4222-8222-222222222222", roles: ["administrator"] });
const paymentId = "33333333-3333-4333-8333-333333333333";

assert.equal(savedCardAuthorizationEnabled({}), false, "Saved cards must be off by default.");
assert.equal(savedCardAuthorizationEnabled({ SAVED_CARD_AUTHORIZATION_ENABLED: "true" }), true);
assert.equal(savedCardAuthorizationEnabled({ SAVED_CARD_AUTHORIZATION_ENABLED: "1" }), false, "Only an explicit true switches saved cards on.");

/* ── Provider: the Stripe calls and what is trusted back ── */

function stripeClient(overrides = {}) {
  const calls = [];
  const setup = (status, extra = {}) => ({ id: "seti_test_1", object: "setup_intent", livemode: false, usage: "off_session", customer: "cus_test_1", status, client_secret: "seti_test_1_secret", metadata: { tideway_booking_id: bookingId }, ...extra });
  const client = {
    accounts: {}, accountLinks: {}, refunds: {}, transfers: {}, charges: {}, webhooks: {},
    customers: { async create(body, options) { calls.push({ kind: "customer", body, options }); return { id: "cus_test_1", livemode: false }; } },
    setupIntents: {
      async create(body, options) { calls.push({ kind: "setup", body, options }); return setup("requires_payment_method"); },
      async retrieve(id) { calls.push({ kind: "setup-retrieve", id }); return overrides.retrieved ?? setup("succeeded", { payment_method: "pm_test_1" }); }
    },
    paymentMethods: { async detach(id) { calls.push({ kind: "detach", id }); return { id, livemode: false }; } },
    paymentIntents: {
      async create(body, options) {
        calls.push({ kind: "intent", body, options });
        if (overrides.intentError) throw overrides.intentError;
        return { id: "pi_test_1", status: "requires_capture", amount: body.amount, currency: "gbp", livemode: false, metadata: body.metadata };
      },
      async retrieve() { throw new Error("unused"); }
    }
  };
  return { client, calls };
}

const providerConfig = { secretKey: "sk_test_" + "a".repeat(24), webhookSecret: "whsec_" + "b".repeat(24) };
{
  const { client, calls } = stripeClient();
  const provider = await createStripePaymentProvider(providerConfig, { stripeClient: client });
  const key = `tideway_saved_card_${bookingId}_0123456789abcdef`;
  const setup = await provider.createSavedCardSetup({ bookingId, landlordHash: "c".repeat(64), idempotencyKey: key });
  assert.deepEqual({ ...setup }, { customerId: "cus_test_1", setupId: "seti_test_1", status: "requires-customer-action", paymentMethodId: null, clientSecret: "seti_test_1_secret" });
  assert.equal(calls[0].options.idempotencyKey, `${key}_customer`, "The Customer was created without its own stable idempotency key.");
  assert.equal(calls[1].body.usage, "off_session", "The card was not saved for off-session use.");
  assert.equal(calls[1].body.customer, "cus_test_1");
  assert.equal(calls[1].options.idempotencyKey, key);
  await assert.rejects(provider.createSavedCardSetup({ bookingId, landlordHash: "c".repeat(64), idempotencyKey: "anything" }), /complete Homle saved-card request/);

  const saved = await provider.retrieveSavedCardSetup({ bookingId, setupId: "seti_test_1", customerId: "cus_test_1" });
  assert.equal(saved.status, "saved");
  assert.equal(saved.paymentMethodId, "pm_test_1");
  assert.equal(await provider.detachSavedCard({ paymentMethodId: "pm_test_1" }), true);
}
// The setup is read back and checked against this booking, this customer and test mode.
for (const [label, retrieved] of [
  ["another booking's setup", { id: "seti_test_1", object: "setup_intent", livemode: false, usage: "off_session", customer: "cus_test_1", status: "succeeded", payment_method: "pm_test_9", metadata: { tideway_booking_id: "58585858-5858-4585-8585-585858585858" } }],
  ["another customer's setup", { id: "seti_test_1", object: "setup_intent", livemode: false, usage: "off_session", customer: "cus_other", status: "succeeded", payment_method: "pm_test_9", metadata: { tideway_booking_id: bookingId } }],
  ["a live-mode setup", { id: "seti_test_1", object: "setup_intent", livemode: true, usage: "off_session", customer: "cus_test_1", status: "succeeded", payment_method: "pm_test_9", metadata: { tideway_booking_id: bookingId } }],
  ["an on-session setup", { id: "seti_test_1", object: "setup_intent", livemode: false, usage: "on_session", customer: "cus_test_1", status: "succeeded", payment_method: "pm_test_9", metadata: { tideway_booking_id: bookingId } }],
  ["a saved setup with no card", { id: "seti_test_1", object: "setup_intent", livemode: false, usage: "off_session", customer: "cus_test_1", status: "succeeded", payment_method: null, metadata: { tideway_booking_id: bookingId } }]
]) {
  const { client } = stripeClient({ retrieved });
  const provider = await createStripePaymentProvider(providerConfig, { stripeClient: client });
  await assert.rejects(provider.retrieveSavedCardSetup({ bookingId, setupId: "seti_test_1", customerId: "cus_test_1" }), TypeError, `${label} was accepted.`);
}
// Off-session authorization: the request, and the bank's refusal as a result rather than a crash.
const authorizationRequest = { idempotencyKey: `tideway_payment_${paymentId}`, paymentId, bookingId, amountPence: 9000, currency: "gbp", transferGroup: `tideway_booking_${bookingId}`, customerId: "cus_test_1", paymentMethodId: "pm_test_1" };
{
  const { client, calls } = stripeClient();
  const provider = await createStripePaymentProvider(providerConfig, { stripeClient: client });
  const result = await provider.createSavedCardAuthorization(authorizationRequest);
  assert.equal(result.status, "authorized");
  const body = calls.at(-1).body;
  assert(body.off_session === true && body.confirm === true && body.capture_method === "manual" && body.customer === "cus_test_1" && body.payment_method === "pm_test_1" && body.amount === 9000, "The off-session authorization was not a manual-capture hold for the frozen total.");
  assert.equal(calls.at(-1).options.idempotencyKey, `tideway_payment_${paymentId}`, "The off-session authorization did not reuse the ledger payment's idempotency key.");
  await assert.rejects(provider.createSavedCardAuthorization({ ...authorizationRequest, paymentMethodId: null }), /saved card is required/);
}
{
  const needsCustomer = Object.assign(new Error("authentication required"), { type: "StripeCardError", code: "authentication_required",
    payment_intent: { id: "pi_test_2", status: "requires_payment_method", amount: 9000, currency: "gbp", livemode: false, client_secret: "pi_test_2_secret", metadata: { tideway_payment_id: paymentId } } });
  const { client } = stripeClient({ intentError: needsCustomer });
  const provider = await createStripePaymentProvider(providerConfig, { stripeClient: client });
  const result = await provider.createSavedCardAuthorization(authorizationRequest);
  assert.equal(result.status, "requires-customer-action", "A bank asking for the customer was not handed to the in-app payment step.");
  assert.equal(result.id, "pi_test_2");
}
{
  const outage = Object.assign(new Error("connection reset"), { type: "StripeConnectionError" });
  const { client } = stripeClient({ intentError: outage });
  const provider = await createStripePaymentProvider(providerConfig, { stripeClient: client });
  await assert.rejects(provider.createSavedCardAuthorization(authorizationRequest), /connection reset/, "A transport failure was reported as an outcome.");
}

/* ── Service ── */

function fakes({ card = null, providerResult, authorization } = {}) {
  const calls = [];
  let stored = card;
  const repository = {
    async begin(actor, id) { calls.push({ kind: "begin", actor, id }); stored = stored ?? { bookingId: id, status: "creating", amountPence: 9000, currency: "gbp", providerCustomerId: null, providerSetupId: null, consentedAt: "2026-10-25T09:00:00.000Z" }; return stored; },
    async record(actor, id, input) { calls.push({ kind: "record", input }); stored = { ...stored, status: input.status, providerCustomerId: input.customerId, providerSetupId: input.setupId }; return stored; },
    async get() { return stored; },
    async withdraw(actor, id) { calls.push({ kind: "withdraw" }); stored = { ...stored, status: "withdrawn" }; return { ...stored, detachPaymentMethodId: "pm_test_1" }; },
    async listDue() { return [bookingId]; },
    async beginAuthorization(actor, input) { calls.push({ kind: "begin-authorization", input }); return { paymentId: input.paymentId, bookingId: input.bookingId, status: "creating", amountPence: 9000, currency: "gbp", providerPaymentId: null, providerCustomerId: "cus_test_1", providerPaymentMethodId: "pm_test_1" }; },
    async recordAuthorization(actor, id, status) { calls.push({ kind: "card-outcome", status }); return { ...stored, status: status === "authorized" ? "authorized" : "action-required" }; }
  };
  const paymentRepository = { async recordAuthorization(actor, id, input) { calls.push({ kind: "ledger", id, input }); return {}; } };
  const provider = {
    async createSavedCardSetup(input) { calls.push({ kind: "provider-setup", input }); return { customerId: "cus_test_1", setupId: "seti_test_1", status: "requires-customer-action", paymentMethodId: null, clientSecret: "seti_secret" }; },
    async retrieveSavedCardSetup(input) { calls.push({ kind: "provider-retrieve", input }); return providerResult ?? { customerId: "cus_test_1", setupId: "seti_test_1", status: "saved", paymentMethodId: "pm_test_1", clientSecret: null }; },
    async detachSavedCard(input) { calls.push({ kind: "detach", input }); if (input.fail) throw new Error("x"); return true; },
    async createSavedCardAuthorization(input) { calls.push({ kind: "provider-authorize", input }); return authorization ?? { id: "pi_test_1", status: "authorized", amountPence: 9000, currency: "gbp" }; },
    async retrieveAuthorization() { throw new Error("unused"); }
  };
  return { calls, repository, paymentRepository, provider };
}

{
  const { calls, repository, paymentRepository, provider } = fakes();
  const service = createSavedCardService({ repository, paymentRepository, provider, createId: () => paymentId });
  await assert.rejects(service.begin(landlord, { bookingId }), (error) => error.code === "saved-card-consent-required", "A card was saved without explicit consent.");
  await assert.rejects(service.begin(administrator, { bookingId, consent: true }), (error) => error.statusCode === 403);
  const begun = await service.begin(landlord, { bookingId, consent: true });
  assert(begun.requiresCustomerAction && begun.clientSecret === "seti_secret", "The customer was not handed the setup to complete.");
  assert(!("providerCustomerId" in begun) && !("providerSetupId" in begun), "Provider identifiers reached the browser.");
  assert.match(calls.find((call) => call.kind === "provider-setup").input.idempotencyKey, new RegExp(`^tideway_saved_card_${bookingId}_[0-9a-f]{16}$`));
  // A retry resumes the recorded setup rather than creating another.
  await service.begin(landlord, { bookingId, consent: true });
  assert.equal(calls.filter((call) => call.kind === "provider-setup").length, 1, "A retried save created a second provider setup.");
  const confirmed = await service.confirm(landlord, { bookingId });
  assert.equal(confirmed.status, "saved", "A setup the provider reports as succeeded was not recorded as saved.");
}
{
  const { calls, repository, paymentRepository, provider } = fakes({ card: { bookingId, status: "saved", amountPence: 9000, currency: "gbp", providerCustomerId: "cus_test_1", providerSetupId: "seti_test_1" } });
  const reported = [];
  provider.detachSavedCard = async () => { throw new Error("provider down"); };
  const service = createSavedCardService({ repository, paymentRepository, provider, createId: () => paymentId, onUnexpectedError: (error) => reported.push(error) });
  const withdrawn = await service.withdraw(landlord, { bookingId });
  assert.equal(withdrawn.status, "withdrawn", "A provider failure undid the customer's withdrawal.");
  assert.equal(reported[0]?.code, "saved-card-detach-failed", "A card left attached at the provider was not reported.");
  assert(!("detachPaymentMethodId" in withdrawn), "The payment method id reached the browser.");
}
{
  const { calls, repository, paymentRepository, provider } = fakes();
  const service = createSavedCardService({ repository, paymentRepository, provider, createId: () => paymentId });
  await assert.rejects(service.authorizeDue(landlord, bookingId), (error) => error.statusCode === 403, "A Landlord used the platform's off-session authorization.");
  const result = await service.authorizeDue(administrator, bookingId);
  assert.equal(result.status, "authorized");
  const order = calls.map((call) => call.kind).filter((kind) => ["begin-authorization", "provider-authorize", "ledger", "card-outcome"].includes(kind));
  assert.deepEqual(order, ["begin-authorization", "provider-authorize", "ledger", "card-outcome"], "The authorization was not recorded on the ledger before the card's outcome.");
  const sent = calls.find((call) => call.kind === "provider-authorize").input;
  assert(sent.customerId === "cus_test_1" && sent.paymentMethodId === "pm_test_1" && sent.idempotencyKey === `tideway_payment_${paymentId}`, "The off-session request did not carry the saved card and the ledger payment's key.");
}
{
  const { calls, repository, paymentRepository, provider } = fakes({ authorization: { id: "pi_test_1", status: "authorized", amountPence: 9500, currency: "gbp" } });
  const service = createSavedCardService({ repository, paymentRepository, provider, createId: () => paymentId });
  await assert.rejects(service.authorizeDue(administrator, bookingId), TypeError);
  assert(!calls.some((call) => call.kind === "ledger"), "An authorization for a different amount reached the ledger.");
}

/* ── Worker ── */
{
  const outcomes = ["authorized", "requires-customer-action"];
  const reported = [];
  const service = {
    async listDue() { return ["a", "b", "c"]; },
    async authorizeDue(actor, id) { if (id === "b") throw new Error("provider down"); return { status: outcomes.shift() }; }
  };
  const worker = createSavedCardAuthorizationWorker({ savedCards: service, actor: administrator, onUnexpectedError: (error) => reported.push(error) });
  const outcome = await worker.runOnce();
  assert.deepEqual({ ...outcome }, { due: 3, authorized: 1, actionRequired: 1, failed: 1, paused: false }, "One failure stopped the batch or was miscounted.");
  assert.equal(reported.length, 1);
  const paused = await createSavedCardAuthorizationWorker({ savedCards: service, actor: administrator, isPaused: () => true }).runOnce();
  assert.equal(paused.paused, true, "Saved cards were used while payment writes were paused for a deploy.");
  assert.throws(() => createSavedCardAuthorizationWorker({ savedCards: service, actor: landlord }), /administrator/);
}

console.log("Saved-card tests passed: explicit consent, off-session setup verified against booking, customer and test mode, one setup per consent, a hold only for the frozen total recorded on the ledger first, the bank's refusal handed to the in-app step, withdrawal that survives a provider failure, and a worker that pauses and isolates failures.");
