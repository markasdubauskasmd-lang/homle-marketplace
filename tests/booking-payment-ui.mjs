import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { bookingIdFromSearch, formatPaymentAmount, paymentPresentation, paymentRetryStorageKey } from "../public/booking-payment-model.js";

const bookingId = "55555555-5555-4555-8555-555555555555";
assert.equal(bookingIdFromSearch(`?bookingId=${bookingId}`), bookingId);
assert.equal(bookingIdFromSearch("?bookingId=not-private"), "");
assert.equal(bookingIdFromSearch("?bookingId=11111111-1111-1111-1111-111111111111"), "");
assert.equal(formatPaymentAmount(12_000), "£120.00");
assert.equal(formatPaymentAmount(0), "Amount unavailable");
assert.equal(paymentPresentation(null).action, "blocked");
assert.equal(paymentPresentation({ status: "not-started" }).action, "prepare");
assert.equal(paymentPresentation({ status: "requires-customer-action" }).action, "continue");
assert.equal(paymentPresentation({ status: "authorization-failed" }).action, "retry");
assert.equal(paymentPresentation({ status: "processing" }).action, "waiting");
assert.equal(paymentPresentation({ status: "authorized" }).action, "complete");
assert.equal(paymentPresentation({ status: "disputed" }).action, "blocked");
assert.equal(paymentPresentation({ status: "unknown-provider-state" }).action, "blocked");
assert.equal(paymentRetryStorageKey(bookingId), `tideway_payment_retry_${bookingId}`);
assert.throws(() => paymentRetryStorageKey("bad"), /valid booking reference/i);

const [page, script, server, styles, migration, preAuthorizationMigration] = await Promise.all([
  readFile(new URL("../public/booking-payment.html", import.meta.url), "utf8"),
  readFile(new URL("../public/booking-payment.js", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8"),
  readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../db/migrations/024_resumable_booking_payment_authorization.sql", import.meta.url), "utf8"),
  readFile(new URL("../db/migrations/037_pre_authorization_booking_total.sql", import.meta.url), "utf8")
]);

assert(page.includes("Test mode only") && page.includes("temporary authorization only") && page.includes("No card storage"), "Checkout did not state its test-only authorization and card-data boundaries.");
assert(page.includes("data-payment-network") && page.includes("data-payment-status-refresh") && page.includes("will not start or repeat a payment action while offline"), "Checkout does not preserve a visible offline boundary or offer a read-only status recovery action.");
assert(page.includes("/booking-payment.js?v=20260723-1") && page.includes("data-payment-complete") && script.includes('completion.href = `/bookings/${encodeURIComponent(bookingId)}`') && script.includes('"Open confirmed booking"') && script.includes('completion.hidden = view.action !== "complete"'), "A verified test authorization does not provide one direct, status-gated handoff to the confirmed booking.");
assert(page.includes("data-payment-card hidden") && page.includes("data-payment-form hidden") && !page.includes("js.stripe.com"), "Checkout exposed a payment control or loaded Stripe before capability checks.");
assert(script.includes('const stripeScriptUrl = "https://js.stripe.com/clover/stripe.js"') && script.includes('document.createElement("script")'), "Stripe.js is not loaded dynamically from the pinned first-party URL.");
assert(script.includes('requestJson("/api/marketplace/account")') && script.indexOf('requestJson("/api/marketplace/payments/config")') < script.indexOf("await loadStripe()"), "Checkout did not authenticate the Landlord and obtain a server capability before loading Stripe.");
assert(script.indexOf("prepare.hidden = true") < script.indexOf("form.hidden = false"), "Checkout leaves a duplicate authorization control visible after mounting the secure form.");
assert(page.includes("Enter secure payment details") && page.includes("Why this payment is protected") && script.includes('`Authorize ${formattedAmount}`') && !script.includes("Confirmed amount pending"), "Checkout does not lead with one exact-price action or still asks a Landlord to start without the frozen total.");
assert(script.includes("crypto.getRandomValues") && script.includes('"X-CSRF-Token": csrf') && script.includes("idempotencyKey: retryKey()"), "Checkout omitted secure retry material, CSRF or idempotent authorization.");
assert(script.includes("new AbortController()") && script.includes("30_000") && script.includes('code: "request-timeout"') && script.includes("uncertain: mutation") && script.includes("async function recoverCsrf()") && script.includes('requestJson("/api/marketplace/auth/session"') && script.includes("saveCsrf(result.csrfToken)"), "Payment preparation can hang indefinitely or a reopened tab cannot recover its secure editing token.");
assert(script.includes("function verifyFrozenAmount") && script.includes('code: "payment-amount-unavailable"') && script.includes('code: "payment-amount-mismatch"') && script.includes("frozenAmountPence !== amount"), "Checkout can open payment details without one stable server-frozen total.");
assert(script.includes("stripeLoadPromise") && script.includes("20_000") && script.includes("script.remove()") && script.includes("destroyPaymentElement()"), "Stripe.js or its secure element can load forever or be mounted repeatedly after a retry.");
assert(script.includes("async function readPaymentStatus()") && script.includes("The existing secure payment step was recovered") && script.includes("Homle did not create a duplicate") && script.includes("refreshStatus({ manual: true })"), "An uncertain payment-preparation response cannot reconcile through the idempotent server record and read-only status endpoint.");
assert(script.includes('redirect: "if_required"') && !script.includes("return_url") && !script.includes("payment_intent_client_secret"), "Checkout risks putting payment secrets in navigation history.");
assert(script.includes("async function confirmStripePayment()") && script.includes("60_000") && script.includes('code: "payment-confirmation-timeout"') && script.includes("if (browserOffline()) return showFeedback") && script.includes("error.uncertain === true || browserOffline()") && script.includes("Do not submit again") && script.includes("prepare.hidden = true") && script.includes("statusRefresh.hidden = false"), "An offline or uncertain Stripe confirmation can spin forever or expose a duplicate submission before signed status recovery.");
assert(!/sessionStorage\.(?:setItem|getItem)\([^\n]*clientSecret/i.test(script) && !script.includes("console.") && !script.includes("innerHTML"), "Checkout stores, logs or renders private payment material unsafely.");
assert(server.includes('requestPath === "/booking-payment"') && server.includes("script-src 'self' https://js.stripe.com") && server.includes("connect-src 'self' https://api.stripe.com") && server.includes('"/booking-payment": "booking-payment.html"'), "Checkout route or Stripe-specific CSP is missing.");
assert(styles.includes(".booking-payment-page") && styles.includes("@media (max-width: 720px)") && styles.includes(".booking-payment-form .button") && styles.includes("min-height: 52px"), "Checkout is missing its mobile-first, touch-sized presentation.");
assert(styles.includes(".booking-payment-network") && styles.includes(".booking-payment-refresh") && styles.includes(".booking-payment-complete"), "Payment connection, status recovery or confirmed-booking handoff lacks mobile-readable styling.");
assert(migration.includes("CREATE OR REPLACE FUNCTION tideway_private.begin_booking_payment_authorization") && migration.includes("WHERE booking_id=booking_record.id FOR UPDATE") && migration.includes("IF FOUND THEN RETURN payment_record") && migration.trimEnd().endsWith("COMMIT;"), "Fresh-browser payment recovery is not locked into an atomic database migration.");
assert(preAuthorizationMigration.includes("CREATE OR REPLACE FUNCTION tideway_private.read_booking_payment") && preAuthorizationMigration.includes("COALESCE(payment.amount_pence, booking.customer_price_pence)") && preAuthorizationMigration.includes("LEFT JOIN booking_payments") && preAuthorizationMigration.includes("payment-role-required") && preAuthorizationMigration.trimEnd().endsWith("COMMIT;"), "The exact frozen booking total is not owner-authorized and available before payment creation.");

console.log("Booking payment UI tests passed: exact pre-authorization total, one clear payment action, fail-closed capability loading, mobile controls, secret handling and fresh-browser recovery.");
