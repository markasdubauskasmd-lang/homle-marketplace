import { inspectCustomerMotion, assertCustomerMotion } from "./customer-motion-state-helper.mjs";
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
assert.match(html, /\/landlord-checkout\.js\?v=20261025-saved-card-1/);
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
const motionRows = [];
  try {
    for (const width of [390, 768, 1280, 1440]) {
      await browser.setViewport({ width, height: width === 768 ? 1024 : width === 1440 ? 900 : 844, mobile: width === 390 });
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
      motionRows.push(await inspectCustomerMotion(browser, "checkout-ready " + width));
      const beforeWrites = paymentWrites.length;
      failSession = true;
      const failed = await attempt();
      assert.equal(sessionCalls - beforeSession, 1, `${width}px: repeated clicks started overlapping session recovery`);
      assert.equal(paymentWrites.length, beforeWrites, "Failed session recovery sent a payment action");
      assert(failed.lockedImmediately && !failed.disabled && !failed.busy && failed.feedbackVisible && failed.feedback.includes("could not be recovered"), "Session failure did not unlock checkout and explain recovery");
      motionRows.push(await inspectCustomerMotion(browser, "checkout-session-error " + width));

      failSession = false;
      const recovered = await attempt();
      assert.equal(sessionCalls - beforeSession, 2, "Retry did not perform exactly one session recovery");
      assert.equal(paymentWrites.length - beforeWrites, 1, "Repeated clicks sent duplicate payment preparations");
      assert(recovered.lockedImmediately && !recovered.disabled && !recovered.busy && recovered.feedbackVisible && recovered.feedback.includes("Payment provider unavailable"), "Provider failure did not leave a visible, retryable checkout");
      motionRows.push(await inspectCustomerMotion(browser, "checkout-provider-error " + width));
      await attempt();
      assert.equal(paymentWrites.length - beforeWrites, 2, "A deliberate retry did not send one payment preparation");
      assert.equal(paymentWrites.at(-1).idempotencyKey, paymentWrites.at(-2).idempotencyKey, "A deliberate retry changed the booking's idempotency key");
    }
    assert.deepEqual(browser.pageErrors, [], "Checkout raised an unhandled browser error");
    assertCustomerMotion(motionRows);
  } finally {
    await browser.close();
    await server.close();
  }
  console.log("Checkout browser recovery passed at 390px and 1280px: repeated clicks, delayed/failed session recovery, provider failure and idempotent retry.");
} else {
  console.log("Checkout browser recovery SKIPPED: Chromium unavailable.");
}

// Pay at booking (M4): offered only before the window opens, for a booking
// with no payment yet, and every state says what will happen to the money.
{
  const { paymentWindowOpensAt, savedCardOffered, savedCardPresentation } = await import("../public/landlord-checkout-model.js");
  const now = Date.parse("2026-11-01T09:00:00.000Z");
  assert.equal(paymentWindowOpensAt("2026-11-20T09:00:00.000Z").toISOString(), "2026-11-15T09:00:00.000Z");
  assert.equal(paymentWindowOpensAt("not a date"), null);
  assert.equal(savedCardOffered({ status: "not-started" }, "2026-11-20T09:00:00.000Z", now), true);
  assert.equal(savedCardOffered({ status: "not-started" }, "2026-11-05T09:00:00.000Z", now), false, "A saved card was offered inside the payment window.");
  assert.equal(savedCardOffered({ status: "creating" }, "2026-11-20T09:00:00.000Z", now), false, "A saved card was offered for a booking that already has a payment.");
  assert.equal(savedCardOffered({ status: "not-started" }, "bad", now), false);
  assert.equal(savedCardPresentation(null).offer, true);
  assert.equal(savedCardPresentation({ status: "saved" }).canWithdraw, true);
  for (const status of ["authorizing", "authorized", "action-required"]) assert.equal(savedCardPresentation({ status }).canWithdraw, false, `A card could be withdrawn while ${status}.`);
  for (const status of ["saved", "authorized"]) assert.match(savedCardPresentation({ status }).copy, /not (charged|captured)|captured only after/i);
  console.log("Saved-card checkout model passed: offered only before the window, never alongside a payment, and every state names what happens to the money.");
}

// Pay at booking (M4) in the real page: offered only when the server answers
// the saved-card route, consent gates the action, and with the route absent the
// ordinary payment step is untouched.
if (resolveChromiumPath()) {
  const farStart = new Date(Date.now() + 20 * 86_400_000).toISOString();
  const savedWrites = [];
  let savedRoute = true;
  const server = await serveStatic({ extraFiles: {
    "/api/marketplace/account": () => ({ body: { account: { selectedRole: "landlord", roles: ["landlord"], name: "Saved card test" } } }),
    "/api/marketplace/bookings": () => ({ body: { bookings: [{ bookingId, scheduledStartAt: farStart, propertyName: "Flat", cleaningType: "regular-domestic" }] } }),
    "/api/marketplace/auth/session": () => ({ body: { csrfToken: "test-session-token" } }),
    [`/api/marketplace/bookings/${bookingId}/payment`]: () => ({ body: { payment: { status: "not-started", amountPence: 5600 } } }),
    [`/api/marketplace/bookings/${bookingId}/saved-card`]: ({ method, body }) => {
      if (!savedRoute) return { status: 404, body: { ok: false, code: "not-found" } };
      if (method === "POST") { savedWrites.push(JSON.parse(body)); return { status: 201, body: { savedCard: { bookingId, status: "saved", amountPence: 5600, currency: "gbp" } } }; }
      return { body: { savedCard: null } };
    }
  } });
  const browser = await launchBrowser();
  try {
    for (const width of [390, 1280]) {
      await browser.setViewport({ width, height: 844, mobile: width === 390 });
      savedRoute = true;
      await browser.goto(`${server.origin}/landlord-checkout.html?bookingId=${bookingId}`);
      const offered = await browser.evaluate(`
        const deadline = Date.now() + 5000;
        while (!document.querySelector('[data-saved-card]')) {
          if (Date.now() > deadline) throw new Error('The saved-card offer never appeared');
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        const start = document.querySelector('[data-saved-card-start]');
        const consent = document.querySelector('[data-saved-card-consent]');
        const before = { disabled: start.disabled, prepareHidden: document.querySelector('[data-payment-prepare]').hidden,
          consentText: consent.closest('label').textContent };
        start.click();
        await new Promise(resolve => setTimeout(resolve, 100));
        consent.click();
        const enabledAfterConsent = !start.disabled;
        start.click();
        const deadline2 = Date.now() + 3000;
        while (!document.querySelector('[data-saved-card-withdraw]') || document.querySelector('[data-saved-card-withdraw]').hidden) {
          if (Date.now() > deadline2) break;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        return { ...before, enabledAfterConsent, title: document.querySelector('#saved-card-title').textContent,
          withdrawVisible: !document.querySelector('[data-saved-card-withdraw]').hidden };
      `);
      assert(offered.disabled && offered.prepareHidden, `${width}px: the saved-card offer was not consent-gated, or the unusable payment step stayed visible.`);
      assert(/£56\.00/.test(offered.consentText) && /without me being present/.test(offered.consentText), `${width}px: the consent did not name the total and that the hold is placed without the customer.`);
      assert(offered.enabledAfterConsent && offered.title === "Card saved for this booking" && offered.withdrawVisible, `${width}px: saving with consent did not reach the saved state: ${JSON.stringify(offered)}`);
      assert.deepEqual(savedWrites.at(-1), { consent: true }, "The saved-card request did not carry explicit consent.");

      savedRoute = false;
      await browser.goto(`${server.origin}/landlord-checkout.html?bookingId=${bookingId}`);
      const ordinary = await browser.evaluate(`
        const deadline = Date.now() + 5000;
        while (document.querySelector('[data-payment-prepare]').hidden) {
          if (Date.now() > deadline) throw new Error('Checkout did not become ready');
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        await new Promise(resolve => setTimeout(resolve, 300));
        return { panel: Boolean(document.querySelector('[data-saved-card]')), prepareHidden: document.querySelector('[data-payment-prepare]').hidden };
      `);
      assert(!ordinary.panel && !ordinary.prepareHidden, `${width}px: with saved cards off the checkout changed.`);
    }
    assert.equal(savedWrites.length, 2, "Clicking before consent sent a saved-card request.");
    assert.deepEqual(browser.pageErrors, [], "The saved-card checkout raised an unhandled browser error");
  } finally {
    await browser.close();
    await server.close();
  }
  console.log("Saved-card checkout browser checks passed at 390px and 1280px: offered only when the route answers, consent-gated, named total, and the ordinary step untouched when off.");
}
