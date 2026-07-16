import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { bookingIdFromSearch, formatPaymentAmount, paymentPresentation, paymentRetryStorageKey } from "../public/booking-payment-model.js";

const bookingId = "55555555-5555-4555-8555-555555555555";
assert.equal(bookingIdFromSearch(`?bookingId=${bookingId}`), bookingId);
assert.equal(bookingIdFromSearch("?bookingId=not-private"), "");
assert.equal(bookingIdFromSearch("?bookingId=11111111-1111-1111-1111-111111111111"), "");
assert.equal(formatPaymentAmount(12_000), "£120.00");
assert.equal(formatPaymentAmount(0), "Amount unavailable");
assert.equal(paymentPresentation(null).action, "prepare");
assert.equal(paymentPresentation({ status: "requires-customer-action" }).action, "continue");
assert.equal(paymentPresentation({ status: "authorization-failed" }).action, "retry");
assert.equal(paymentPresentation({ status: "processing" }).action, "waiting");
assert.equal(paymentPresentation({ status: "authorized" }).action, "complete");
assert.equal(paymentPresentation({ status: "disputed" }).action, "blocked");
assert.equal(paymentPresentation({ status: "unknown-provider-state" }).action, "blocked");
assert.equal(paymentRetryStorageKey(bookingId), `tideway_payment_retry_${bookingId}`);
assert.throws(() => paymentRetryStorageKey("bad"), /valid booking reference/i);

const [page, script, server, styles, migration] = await Promise.all([
  readFile(new URL("../public/booking-payment.html", import.meta.url), "utf8"),
  readFile(new URL("../public/booking-payment.js", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8"),
  readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../db/migrations/024_resumable_booking_payment_authorization.sql", import.meta.url), "utf8")
]);

assert(page.includes("Test mode only") && page.includes("temporary authorization only") && page.includes("No card storage"), "Checkout did not state its test-only authorization and card-data boundaries.");
assert(page.includes("data-payment-card hidden") && page.includes("data-payment-form hidden") && !page.includes("js.stripe.com"), "Checkout exposed a payment control or loaded Stripe before capability checks.");
assert(script.includes('const stripeScriptUrl = "https://js.stripe.com/clover/stripe.js"') && script.includes('document.createElement("script")'), "Stripe.js is not loaded dynamically from the pinned first-party URL.");
assert(script.includes('requestJson("/api/marketplace/account")') && script.indexOf('requestJson("/api/marketplace/payments/config")') < script.indexOf("await loadStripe()"), "Checkout did not authenticate the Landlord and obtain a server capability before loading Stripe.");
assert(script.indexOf("prepare.hidden = true") < script.indexOf("form.hidden = false"), "Checkout leaves a duplicate authorization control visible after mounting the secure form.");
assert(script.includes("crypto.getRandomValues") && script.includes('"X-CSRF-Token": csrf') && script.includes("idempotencyKey: retryKey()"), "Checkout omitted secure retry material, CSRF or idempotent authorization.");
assert(script.includes('redirect: "if_required"') && !script.includes("return_url") && !script.includes("payment_intent_client_secret"), "Checkout risks putting payment secrets in navigation history.");
assert(!/sessionStorage\.(?:setItem|getItem)\([^\n]*clientSecret/i.test(script) && !script.includes("console.") && !script.includes("innerHTML"), "Checkout stores, logs or renders private payment material unsafely.");
assert(server.includes('requestPath === "/booking-payment"') && server.includes("script-src 'self' https://js.stripe.com") && server.includes("connect-src 'self' https://api.stripe.com") && server.includes('"/booking-payment": "booking-payment.html"'), "Checkout route or Stripe-specific CSP is missing.");
assert(styles.includes(".booking-payment-page") && styles.includes("@media (max-width: 720px)") && styles.includes(".booking-payment-form .button") && styles.includes("min-height: 52px"), "Checkout is missing its mobile-first, touch-sized presentation.");
assert(migration.includes("CREATE OR REPLACE FUNCTION tideway_private.begin_booking_payment_authorization") && migration.includes("WHERE booking_id=booking_record.id FOR UPDATE") && migration.includes("IF FOUND THEN RETURN payment_record") && migration.trimEnd().endsWith("COMMIT;"), "Fresh-browser payment recovery is not locked into an atomic database migration.");

console.log("Booking payment UI tests passed: fail-closed capability loading, protected test checkout, mobile controls, secret handling and fresh-browser authorization recovery.");
