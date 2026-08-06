import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { bookingIdFromSearch, formatPaymentAmount, paymentPresentation, paymentRetryStorageKey } from "../public/landlord-checkout-model.js";

const bookingId = "55555555-5555-4555-8555-555555555555";
assert.equal(bookingIdFromSearch(`?bookingId=${bookingId}`), bookingId);
assert.equal(bookingIdFromSearch("?bookingId=not-a-booking"), "");
assert.equal(formatPaymentAmount(12345), "£123.45");
assert.equal(formatPaymentAmount(0), "Amount unavailable");
assert.equal(paymentPresentation({ status: "not-started" }).action, "prepare");
assert.equal(paymentPresentation({ status: "processing" }).action, "waiting");
assert.equal(paymentPresentation({ status: "authorized" }).action, "complete");
assert.equal(paymentPresentation({ status: "disputed" }).action, "blocked");
assert.equal(paymentRetryStorageKey(bookingId), `homle_landlord_payment_retry_${bookingId}`);
assert.throws(() => paymentRetryStorageKey("bad"), /valid booking reference/i);

const [html, script, server, landlordDashboard, retiredPages] = await Promise.all([
  readFile(new URL("../public/landlord-checkout.html", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-checkout.js", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-dashboard.js", import.meta.url), "utf8"),
  readFile(new URL("./retired-pages.mjs", import.meta.url), "utf8")
]);

assert.match(html, /Protected booking step/);
assert.match(html, /Stripe's secure element/);
assert.match(html, /Stripe test mode · no real money moves/);
assert.match(html, /simulated Stripe test authorization—your card is not charged/);
assert.match(html, /\/landlord-checkout\.js\?v=20260806-2/);
assert.match(script, /selectedRole !== "landlord"/);
assert.match(script, /X-CSRF-Token/);
assert.match(script, /idempotencyKey: retryKey\(\)/);
assert.match(script, /payment-amount-mismatch/);
assert.match(script, /stripe\.confirmPayment/);
assert.match(server, /paymentPage = requestPath === "\/landlord\/checkout"/);
assert.match(server, /"\/landlord\/checkout": "landlord-checkout\.html"/);
assert.match(landlordDashboard, /\/landlord\/checkout\?bookingId=/);
assert.match(retiredPages, /booking-payment\.html/);

console.log("Landlord checkout UI tests passed.");
