import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { adminPaymentBookingFilter, adminPaymentFilter, adminPaymentQueue, paymentActionLabel, paymentActionPayload, paymentStatusLabel, shortPaymentBookingReference, shortPaymentReference } from "../public/admin-payments-model.js";

const paymentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const bookingId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const record = { paymentId, bookingId, paymentStatus: "captured", bookingStatus: "completed", scheduledStartAt: "2026-07-20T09:00:00.000Z", scheduledEndAt: "2026-07-20T12:00:00.000Z", amountPence: 12_000, currency: "gbp", amountCapturedPence: 12_000, amountRefundedPence: 0, cleanerPayPence: 7_200, payoutReady: true, canCapture: false, canCancel: false, canRefund: true, canTransfer: true, awaitingProvider: false, updatedAt: "2026-07-20T12:10:00.000Z" };
const queue = adminPaymentQueue({ ok: true, payments: [record], limit: 50, offset: 0, testMode: true });
assert(queue.testMode && queue.payments[0].canTransfer && queue.payments[0].canRefund && queue.payments[0].amountPence === 12_000 && Object.isFrozen(queue.payments), "The Administrator queue lost exact economics, actionability or test-mode proof.");
assert.equal(adminPaymentFilter(""), "actionable");
assert.equal(adminPaymentFilter("AUTHORIZED"), "authorized");
assert.throws(() => adminPaymentFilter("all-secrets"), /valid payment status/i);
assert.equal(shortPaymentReference(paymentId), "Payment AAAAAAAA");
assert.equal(adminPaymentBookingFilter(bookingId.toUpperCase()), bookingId);
assert.equal(adminPaymentBookingFilter(""), null);
assert.equal(shortPaymentBookingReference(bookingId), "BKG-BBBBBBBB");
assert.throws(() => adminPaymentBookingFilter("not-a-booking"), /related booking payment link/i);
assert.equal(paymentStatusLabel("captured"), "Captured");
assert.equal(paymentActionLabel("transfer"), "Pay Cleaner");
const key = "admin_payment_retry_key_123456789012345";
assert.deepEqual(paymentActionPayload("capture", { idempotencyKey: key, confirmed: true }), { idempotencyKey: key });
assert.deepEqual(paymentActionPayload("refund", { idempotencyKey: key, amountPence: 1500, confirmed: true }), { idempotencyKey: key, amountPence: 1500 });
assert.throws(() => paymentActionPayload("transfer", { idempotencyKey: key, confirmed: false }), /Confirm this test payment action/i);
assert.throws(() => paymentActionPayload("refund", { idempotencyKey: key, amountPence: 0, confirmed: true }), /Refund amount/i);
assert.throws(() => adminPaymentQueue({ payments: [{ ...record, amountCapturedPence: 12_001 }], limit: 50, offset: 0, testMode: true }), /Captured amount/i);

const [page, script, caseScript, styles, server, admin, packageJson, router, service, repository, migration, handoffMigration, grants] = await Promise.all([
  readFile(new URL("../public/admin-payments.html", import.meta.url), "utf8"),
  readFile(new URL("../public/admin-payments.js", import.meta.url), "utf8"),
  readFile(new URL("../public/admin-cases.js", import.meta.url), "utf8"),
  readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8"),
  readFile(new URL("../public/admin.html", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../src/marketplace/marketplace-http.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/marketplace/payment-service.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/marketplace/payment-repository.mjs", import.meta.url), "utf8"),
  readFile(new URL("../db/migrations/050_administrator_payment_operations.sql", import.meta.url), "utf8"),
  readFile(new URL("../db/migrations/051_administrator_case_payment_handoff.sql", import.meta.url), "utf8"),
  readFile(new URL("../db/runtime-role-grants.sql", import.meta.url), "utf8")
]);

assert(page.includes("Administrator · test payments only") && page.includes("Every button contacts the configured test payment provider") && page.includes("Live Stripe keys remain rejected") && page.includes("data-admin-payments-workspace hidden"), "The payment screen lost its truthful, fail-closed test-provider boundary.");
assert(page.includes("data-admin-payment-dialog") && page.includes("data-admin-payment-refund-field") && page.includes("I reviewed the exact server totals") && page.includes("data-network-status"), "The payment screen omitted exact confirmation, bounded refund or offline controls.");
assert(page.includes("data-admin-payment-related") && page.includes("Review the booking case evidence first") && page.includes('name="referrer" content="no-referrer"'), "The related-case payment view lost its evidence-first or referrer-private boundary.");
assert(!page.includes("provider_payment_id") && !page.includes("destination_account_id") && !page.includes("client_secret"), "The Administrator page exposes private payment-provider material.");
assert(script.includes('requestJson("/api/marketplace/auth/session"') && script.includes('"X-CSRF-Token": csrf') && script.includes("60_000") && script.includes("uncertainPayments.add") && script.includes("refresh the signed status") && script.includes("crypto.randomUUID"), "Administrator payment actions lost CSRF recovery, bounded waits, uncertain-result protection or private idempotency.");
assert(script.includes("accepted by Homle") && script.includes("queue = previousQueue") && script.includes("locked until you refresh the queue successfully"), "An accepted payment command can be mistaken for a failed command when its read-only status refresh loses connection.");
assert(script.includes("adminPaymentBookingFilter") && script.includes("bookingId: selectedBookingId") && script.includes("Invalid related payment link") && caseScript.includes("Review related test payment") && caseScript.includes("/admin/payments?bookingId="), "The booking-case handoff is not exact, fail-closed or discoverable only after review starts.");
assert(script.includes("amountCapturedPence - actionRecord.amountRefundedPence") && script.includes("amountPence > maximumRefund") && script.includes("paymentActionPayload") && script.includes("textContent"), "Refunds lost the remaining-capture boundary or the page stopped using validated/safe rendering.");
assert(styles.includes(".admin-payment-confirmation-facts") && styles.includes(".admin-payment-warning") && styles.includes("@media (max-width: 680px)") && styles.includes("min-height: 3rem"), "Payment operations lost mobile, uncertainty or one-hand action styling.");
assert(server.includes('"/admin/payments": "admin-payments.html"') && admin.includes('href="/admin/payments"'), "The protected settlement route is not served or linked from the control desk.");
assert(packageJson.includes('"check:admin-payments"') && packageJson.includes('"test:admin-payments"') && packageJson.includes("tests/admin-payments-ui.mjs"), "Payment-operation UI checks are absent from repository quality gates.");
assert(router.includes("adminPaymentCommandPath") && router.includes('pathname === "/api/marketplace/admin/payments"') && router.includes('roles: ["administrator"]') && router.includes("await payments[kind]") && router.includes("amountPence: input.amountPence"), "Administrator payment HTTP routes lost strict role, command or refund-amount routing.");
assert(service.includes("listForAdministrator") && service.includes("requireRole(actor, \"administrator\")") && service.includes("testMode: true") && repository.includes("list_administrator_payment_operations"), "Payment operations lost service-level Administrator enforcement, test-mode proof or the narrow repository projection.");
for (const expected of ["administrator-required", "canCapture", "canTransfer", "canRefund", "awaitingProvider", "cleaner_pay_pence", "REVOKE ALL ON FUNCTION"]) assert(migration.includes(expected), `Administrator payment migration omitted ${expected}.`);
assert(!migration.includes("provider_payment_id") && !migration.includes("destination_account_id") && grants.includes("list_administrator_payment_operations(text,integer,integer)"), "Payment queue SQL exposes provider identifiers or lacks the restricted runtime grant.");
assert(handoffMigration.includes("get_administrator_booking_payment_operation") && handoffMigration.includes("payment.booking_id=selected_booking_id") && handoffMigration.includes("administrator-required") && !handoffMigration.includes("provider_payment_id") && !handoffMigration.includes("destination_account_id") && grants.includes("get_administrator_booking_payment_operation(uuid)"), "The case-payment lookup is not exact, Administrator-only, provider-private and function-granted.");

console.log("Administrator payment-operation UI tests passed: exact frozen economics, role/CSRF gates, deliberate test-provider actions, idempotency, uncertain-result recovery, provider privacy and mobile controls.");
