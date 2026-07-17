import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createPaymentRepository } from "../src/marketplace/payment-repository.mjs";

const actor = { userId: "11111111-1111-4111-8111-111111111111", roles: ["landlord"] };
const calls = [];
let failure = null;
const rows = [];
const database = {
  withUserTransaction(selectedActor, operation) { calls.push({ transaction: "user", actor: selectedActor }); return operation(client); },
  withAuthenticationTransaction(operation) { calls.push({ transaction: "authentication" }); return operation(client); }
};
const client = {
  async query(text, values) {
    calls.push({ text, values });
    if (failure) { const error = failure; failure = null; throw error; }
    return { rows: [rows.shift() || {}] };
  }
};
const repository = createPaymentRepository(database);
const paymentId = "22222222-2222-4222-8222-222222222222";
const bookingId = "33333333-3333-4333-8333-333333333333";
const commandId = "44444444-4444-4444-8444-444444444444";
const hash = Buffer.alloc(32, 7);

rows.push({ id: paymentId, booking_id: bookingId, status: "authorized", amount_pence: 12000, currency: "gbp", amount_captured_pence: 0, amount_refunded_pence: 0 });
const readable = await repository.getByBooking(actor, bookingId);
assert(readable.paymentId === paymentId && readable.bookingId === bookingId && readable.providerPaymentId === null && calls.at(-1).text.includes("read_booking_payment"), "Landlord payment status did not use the narrow actor-bound projection.");

rows.push({ id: null, booking_id: bookingId, status: "not-started", amount_pence: 12000, currency: "gbp", amount_captured_pence: 0, amount_refunded_pence: 0 });
const beforeAuthorization = await repository.getByBooking(actor, bookingId);
assert(beforeAuthorization.paymentId === null && beforeAuthorization.bookingId === bookingId && beforeAuthorization.status === "not-started" && beforeAuthorization.amountPence === 12000, "The narrow repository lost the frozen total before a payment row exists.");

rows.push({ id: paymentId, booking_id: bookingId, status: "creating", amount_pence: 12000, currency: "gbp", amount_captured_pence: 0, amount_refunded_pence: 0, provider_payment_id: null });
const begun = await repository.beginAuthorization(actor, { paymentId, bookingId, provider: "stripe", idempotencyKeyHash: hash });
assert(begun.paymentId === paymentId && begun.amountPence === 12000 && calls.at(-1).text.includes("begin_booking_payment_authorization") && calls.at(-1).values[3] === hash, "Payment authorization did not use the actor-bound function and hashed retry key.");

rows.push({ id: paymentId, booking_id: bookingId, status: "authorized", amount_pence: 12000, currency: "gbp", amount_captured_pence: 0, amount_refunded_pence: 0, provider_payment_id: "pi_test_private" });
const attached = await repository.recordAuthorization(actor, paymentId, { providerPaymentId: "pi_test_private", status: "authorized" });
assert(attached.status === "authorized" && calls.at(-1).text.includes("record_booking_payment_authorization"), "Provider authorization was not attached through the guarded function.");

rows.push({ command_id: commandId, payment_id: paymentId, booking_id: bookingId, kind: "transfer", status: "created", amount_pence: 7200, currency: "gbp", provider_payment_id: "pi_test_private", provider_command_id: null, destination_account_id: "acct_cleaner_private" });
const command = await repository.beginCommand(actor, { commandId, paymentId, kind: "transfer", amountPence: null, idempotencyKeyHash: hash });
assert(command.amountPence === 7200 && command.destinationAccountId === "acct_cleaner_private" && calls.at(-1).text.includes("begin_booking_payment_command"), "Payment command omitted server-owned payout terms.");

rows.push({ command_id: commandId, payment_id: paymentId, kind: "transfer", status: "provider-pending" });
const recorded = await repository.recordCommand(actor, commandId, { providerCommandId: "tr_test_private", status: "pending" });
assert.deepEqual(recorded, { commandId, paymentId, kind: "transfer", status: "provider-pending" });

rows.push({ result: { accepted: true, duplicate: false } });
const reconciled = await repository.reconcileEvent({ provider: "stripe", providerEventId: "evt_private", kind: "transfer-succeeded", providerObjectId: "tr_test_private", paymentId, commandId, amountPence: 7200, currency: "gbp", occurredAt: "2026-07-16T00:00:00.000Z", payloadHash: "a".repeat(64) });
assert(reconciled.accepted === true && calls.at(-2).transaction === "authentication" && calls.at(-1).text.includes("reconcile_payment_provider_event") && calls.at(-1).values.length === 10, "Verified webhook reconciliation did not use the no-browser-actor transaction and narrow function.");

failure = Object.assign(new Error("payment-not-refundable"), { code: "P0001" });
await assert.rejects(repository.beginCommand(actor, { commandId, paymentId, kind: "refund", amountPence: 500, idempotencyKeyHash: hash }), (error) => error.code === "payment-not-refundable" && error.statusCode === 409);

const migration = await readFile(new URL("../db/migrations/022_marketplace_payment_ledger.sql", import.meta.url), "utf8");
const paymentStatusMigration = await readFile(new URL("../db/migrations/023_landlord_payment_status.sql", import.meta.url), "utf8");
const preAuthorizationMigration = await readFile(new URL("../db/migrations/037_pre_authorization_booking_total.sql", import.meta.url), "utf8");
const payoutMigration = await readFile(new URL("../db/migrations/036_cleaner_payout_onboarding.sql", import.meta.url), "utf8");
const orderingMigration = await readFile(new URL("../db/migrations/040_payment_reconciliation_ordering.sql", import.meta.url), "utf8");
const grants = await readFile(new URL("../db/runtime-role-grants.sql", import.meta.url), "utf8");
const runtime = await readFile(new URL("../src/marketplace/runtime.mjs", import.meta.url), "utf8");
const attachment = await readFile(new URL("../src/marketplace/attachment.mjs", import.meta.url), "utf8");
for (const required of [
  "booking_payments", "payment_commands", "payment_status_history", "cleaner_payout_accounts", "payment_provider_events",
  "idempotency_key_hash bytea NOT NULL UNIQUE", "amount_captured_pence <= amount_pence", "amount_refunded_pence <= amount_captured_pence",
  "begin_booking_payment_authorization", "begin_booking_payment_command", "record_booking_payment_command", "reconcile_payment_provider_event",
  "booking_record.customer_price_pence", "booking_record.cleaner_pay_pence", "booking_record.terms_fingerprint",
  "booking_record.status <> 'completed'", "account.payouts_enabled", "supplied_payload_hash", "ON CONFLICT(provider,provider_event_id) DO NOTHING",
  "payment_one_live_capture_idx", "payment_one_live_transfer_idx", "ENABLE ROW LEVEL SECURITY"
]) assert(migration.includes(required), `Payment migration omitted ${required}.`);
assert(!migration.includes("client_secret") && !migration.includes("card_number") && !migration.includes("raw_payload"), "Payment migration attempted to persist client secrets, card details or raw provider payloads.");
for (const required of ["payment_one_live_refund_idx", "command-already-reconciled", "invalid-state-transition", "supplied_amount_pence IS DISTINCT FROM command_record.amount_pence", "command_kind='transfer' AND command.status <> 'provider-failed'", "command_kind='refund' AND command.status IN ('created','provider-pending')", "payment_record.amount_captured_pence <> payment_record.amount_pence", "provider_command_id=COALESCE(provider_command_id,supplied_object_id)"]) assert(orderingMigration.includes(required), `Payment ordering hardening omitted ${required}.`);
assert(orderingMigration.includes("IF command_record.status IN ('reconciled','provider-failed')") && orderingMigration.includes("IF supplied_kind='transfer-reversed'") && orderingMigration.trimEnd().endsWith("COMMIT;"), "A late provider return can reopen a final command, webhook reconciliation can double-apply a command, a legitimate reversal is blocked or the locked transaction boundary is missing.");
for (const required of ["begin_booking_payment_authorization", "reconcile_payment_provider_event", "get_my_cleaner_payout_onboarding", "begin_my_cleaner_payout_onboarding", "attach_my_cleaner_payout_account", "sync_my_cleaner_payout_account", "REVOKE SELECT, INSERT, UPDATE, DELETE ON booking_payments", "REVOKE ALL ON TABLE tideway_private.cleaner_payout_accounts"]) assert(grants.includes(required), `Runtime payment grants omitted ${required}.`);
for (const required of ["cleaner_payout_onboarding", "pg_advisory_xact_lock", "payout-account-conflict", "sync_my_cleaner_payout_account", "REVOKE ALL ON TABLE"]) assert(payoutMigration.includes(required), `Cleaner payout migration omitted ${required}.`);
for (const required of ["read_booking_payment", "booking.landlord_user_id = actor_id", "payment.amount_captured_pence", "REVOKE ALL ON FUNCTION"]) assert(paymentStatusMigration.includes(required), `Landlord payment-status migration omitted ${required}.`);
for (const required of ["read_booking_payment", "LEFT JOIN booking_payments", "booking.customer_price_pence", "payment-role-required", "REVOKE ALL ON FUNCTION"]) assert(preAuthorizationMigration.includes(required), `Pre-authorization payment-total migration omitted ${required}.`);
assert(!paymentStatusMigration.includes("provider_payment_id") && !paymentStatusMigration.includes("idempotency_key_hash") && grants.includes("read_booking_payment(uuid)"), "Landlord payment status exposed private provider/idempotency material or lacked its narrow grant.");
assert(runtime.includes("createPaymentRepository(database)") && runtime.includes("options.paymentProvider ? createPaymentService") && runtime.includes("createCleanerPayoutRepository(database)") && runtime.includes("options.paymentProvider ? createCleanerPayoutService") && runtime.includes("paymentReady: paymentService !== null"), "Marketplace runtime did not keep checkout and Cleaner payout composition explicitly detached behind a provider adapter.");
assert(attachment.includes("payment_ledger_ready") && attachment.includes("payment_access_ready") && attachment.includes("begin_booking_payment_authorization(uuid,uuid,text,bytea)") && attachment.includes("read_booking_payment(uuid)"), "Marketplace startup could attach against a database missing the locked payment ledger or Landlord status projection.");

console.log("Payment repository tests passed: frozen booking money, function-only mutations, server-owned payout terms, idempotent event ledger, safe error mapping and least-privilege grants.");
