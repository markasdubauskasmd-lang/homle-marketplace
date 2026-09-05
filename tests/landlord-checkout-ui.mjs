import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { bookingIdFromSearch, formatPaymentAmount, paymentPresentation, paymentRetryStorageKey } from "../public/landlord-checkout-model.js";
import { launchBrowser, resolveChromiumPath, serveStatic } from "../tools/browser-harness.mjs";

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

assert.match(html, /homle-workspace/);
assert.match(html, /data-workspace-main/);
assert.match(script, /eyebrow: "Protected booking step"/);
assert.match(script, /Stripe's secure element/);
assert.match(html, /Stripe test mode · no real money moves/);
assert.match(html, /simulated Stripe test authorization—your card is not charged/);
assert.match(html, /\/landlord-checkout\.js\?v=20260905-1/);
assert.match(script, /renderWorkspaceShell/);
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

// Exercise the real page while its session endpoint is slow. Idempotency on
// the server does not prevent concurrent browser calls from rotating CSRF or
// mounting competing Stripe elements.
if (resolveChromiumPath()) {
  let sessionCalls = 0;
  let failSession = false;
  const paymentWrites = [];
  const server = await serveStatic({ extraFiles: {
    "/api/marketplace/account": () => ({ body: { account: { selectedRole: "landlord", roles: ["landlord"], name: "Checkout test" } } }),
    "/api/marketplace/bookings": () => ({ body: { bookings: [] } }),
    "/api/marketplace/auth/session": async () => {
      sessionCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 250));
      return failSession ? { status: 503, body: { error: "Session unavailable" } } : { body: { csrfToken: "test-session-token" } };
    },
    [`/api/marketplace/bookings/${bookingId}/payment`]: ({ method, body }) => {
      if (method === "POST") {
        paymentWrites.push(JSON.parse(body));
        return { status: 503, body: { error: "Payment provider unavailable for this test" } };
      }
      return { body: { payment: { status: "not-started", amountPence: 5600 } } };
    }
  } });
  const browser = await launchBrowser();
  try {
    for (const width of [390, 1280]) {
      await browser.setViewport({ width, height: 844, mobile: width === 390 });
      await browser.goto(`${server.origin}/landlord-checkout.html?bookingId=${bookingId}`);
      await browser.evaluate(`
        const deadline = Date.now() + 5000;
        while (document.querySelector('[data-payment-prepare]').hidden) {
          if (Date.now() > deadline) throw new Error('Checkout did not become ready');
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        return null;
      `);
      const attempt = async () => browser.evaluate(`
        sessionStorage.removeItem('tideway_csrf');
        const button = document.querySelector('[data-payment-prepare]');
        button.click(); button.click(); button.click();
        const lockedImmediately = button.disabled && button.getAttribute('aria-busy') === 'true';
        await new Promise(resolve => setTimeout(resolve, 800));
        return { lockedImmediately, disabled: button.disabled, busy: button.hasAttribute('aria-busy'),
          feedback: document.querySelector('[data-payment-feedback]').textContent,
          feedbackVisible: document.querySelector('[data-payment-feedback]').checkVisibility() };
      `);
      const beforeSession = sessionCalls;
      const beforeWrites = paymentWrites.length;
      failSession = true;
      const failed = await attempt();
      assert.equal(sessionCalls - beforeSession, 1, `${width}px: repeated clicks started overlapping session recovery`);
      assert.equal(paymentWrites.length, beforeWrites, "Failed session recovery sent a payment action");
      assert(failed.lockedImmediately && !failed.disabled && !failed.busy && failed.feedbackVisible && failed.feedback.includes("could not be recovered"), "Session failure did not unlock checkout and explain recovery");

      failSession = false;
      const recovered = await attempt();
      assert.equal(sessionCalls - beforeSession, 2, "Retry did not perform exactly one session recovery");
      assert.equal(paymentWrites.length - beforeWrites, 1, "Repeated clicks sent duplicate payment preparations");
      assert(recovered.lockedImmediately && !recovered.disabled && !recovered.busy && recovered.feedbackVisible && recovered.feedback.includes("Payment provider unavailable"), "Provider failure did not leave a visible, retryable checkout");
      await attempt();
      assert.equal(paymentWrites.length - beforeWrites, 2, "A deliberate retry did not send one payment preparation");
      assert.equal(paymentWrites.at(-1).idempotencyKey, paymentWrites.at(-2).idempotencyKey, "A deliberate retry changed the booking's idempotency key");
    }
    assert.deepEqual(browser.pageErrors, [], "Checkout raised an unhandled browser error");
  } finally {
    await browser.close();
    await server.close();
  }
  console.log("Checkout browser recovery passed at 390px and 1280px: repeated clicks, delayed/failed session recovery, provider failure and idempotent retry.");
} else {
  console.log("Checkout browser recovery SKIPPED: Chromium unavailable.");
}
