import { readFile } from "node:fs/promises";
import {
  chromiumExecutableCandidates,
  launchBrowser,
  resolveChromiumPath,
  serveStatic
} from "../tools/browser-harness.mjs";

// What the page does with each answer Stripe can give.
//
// The server side of this payment is covered elsewhere and covered well:
// stripe-payment-provider rejects live keys and pins the exact commands sent,
// payment-service pins the frozen amount, private idempotency and signed
// webhook reconciliation, payment-repository pins function-only money
// mutation. tests/landlord-request-flow drives the checkout ladder — open,
// begin, reload, fail, retry, late webhook.
//
// The gap between them was the confirm step itself: what the browser does the
// moment Stripe answers. That could not be reached, because reaching it means
// mounting Stripe's card iframe, and no honest harness can type into a
// cross-origin iframe belonging to a payment provider.
//
// It does not need to. loadStripe() returns globalThis.Stripe when one already
// exists, so an inline script defined before the page's module runs supplies a
// stub, and every line of OUR confirm handling runs for real against the
// documented shapes Stripe returns. This tests our code, not Stripe's — which
// is the only part that was ever untested.
//
// The third case is the one that matters most. A resolved confirmPayment() is
// not payment: the page must go and read the signed server status, and must
// keep saying "being verified" while the server still says processing, however
// happily the browser reports success. Frontend-declared payment is the defect
// this asserts cannot return.

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const chromiumPath = resolveChromiumPath();
if (!chromiumPath) {
  console.log(`Landlord checkout-confirm checks SKIPPED: no Chromium executable found. Checked ${chromiumExecutableCandidates().join(", ")}.`);
  process.exit(0);
}

const rawCheckout = await readFile(new URL("../public/landlord-checkout.html", import.meta.url), "utf8");

/* A stub standing exactly where Stripe.js would. It mounts nothing visible and
   answers confirmPayment() with whatever the test has staged, so the page's own
   branches run unchanged. */
const STRIPE_STUB = `<script>
  window.__confirmResult = { paymentIntent: { status: "succeeded" } };
  window.__confirmCalls = 0;
  window.Stripe = function () {
    return {
      elements() {
        return { create() { return { mount(selector) { document.querySelector(selector).textContent = "card fields"; } }; } };
      },
      confirmPayment() {
        window.__confirmCalls += 1;
        return Promise.resolve(window.__confirmResult);
      }
    };
  };
</script>`;
const checkoutHtml = rawCheckout.replace("</head>", `${STRIPE_STUB}\n</head>`);

const BOOKING_ID = "77777777-7777-4777-8777-777777777777";
const AMOUNT = 16800;
const json = (value) => JSON.stringify(value);

let paymentStatus = "not-started";
const paymentView = () => ({
  status: paymentStatus,
  amountPence: AMOUNT,
  currency: "gbp",
  requiresCustomerAction: paymentStatus === "requires-customer-action",
  clientSecret: paymentStatus === "requires-customer-action" ? "pi_test_secret_confirm" : null
});

const server = await serveStatic({
  extraFiles: {
    "/landlord/checkout": checkoutHtml,
    "/api/marketplace/account": json({ ok: true, account: { roles: ["landlord"], selectedRole: "landlord", displayName: "Confirm Landlord" } }),
    "/api/marketplace/auth/session": json({ ok: true, csrfToken: "confirm-token" }),
    "/api/marketplace/bookings": json({ ok: true, bookings: [] }),
    "/api/marketplace/payments/config": json({ ok: true, payment: { testMode: true, publishableKey: `pk_test_${"c".repeat(24)}` } }),
    [`/api/marketplace/bookings/${BOOKING_ID}/payment`]: ({ method }) => {
      if (method === "POST" && paymentStatus === "not-started") paymentStatus = "requires-customer-action";
      return { status: method === "POST" ? 201 : 200, body: { ok: true, payment: paymentView() } };
    }
  }
});

const browser = await launchBrowser();
let failure = null;
const proved = [];

const openForm = `
  const deadline = Date.now() + 15000;
  for (;;) {
    if (!document.querySelector("[data-payment-form]").hidden) return true;
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
`;

async function openCheckout(stagedResult) {
  paymentStatus = "not-started";
  await browser.goto(`${server.origin}/landlord/checkout?bookingId=${BOOKING_ID}`);
  await browser.evaluate(`
    const deadline = Date.now() + 15000;
    for (;;) {
      const card = document.querySelector("[data-payment-card]");
      if (card && !card.hidden) return true;
      if (Date.now() > deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  `);
  await browser.evaluate(`window.__confirmResult = ${JSON.stringify(stagedResult)}; return true;`);
  await browser.evaluate(`document.querySelector("[data-payment-prepare]").click(); return true;`);
  const opened = await browser.evaluate(openForm);
  assert(opened, "the payment form never opened against the stubbed provider.");
}

const readCard = `({
  title: document.querySelector("[data-payment-message-title]").textContent.trim(),
  copy: document.querySelector("[data-payment-message-copy]").textContent.trim(),
  status: document.querySelector("[data-payment-status]").textContent.trim(),
  feedback: document.querySelector("[data-payment-feedback]").hidden ? "" : document.querySelector("[data-payment-feedback]").textContent.trim(),
  formOpen: !document.querySelector("[data-payment-form]").hidden,
  completeShown: !document.querySelector("[data-payment-complete]").hidden,
  refreshShown: !document.querySelector("[data-payment-status-refresh]").hidden
})`;

try {
  await browser.setViewport({ width: 1440, height: 900, mobile: false });

  /* ── 1 · A declined card ─────────────────────────────────────────────── */
  await openCheckout({ error: { message: "Your card was declined." } });
  await browser.evaluate(`
    document.querySelector("[data-payment-submit]").click();
    const deadline = Date.now() + 10000;
    for (;;) {
      const feedback = document.querySelector("[data-payment-feedback]");
      if (feedback && !feedback.hidden && feedback.textContent.trim()) return true;
      if (Date.now() > deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  `);
  const declined = await browser.evaluate(readCard);
  assert(/declined/i.test(declined.feedback),
    `declined card: the page reported "${declined.feedback}" instead of the provider's reason.`);
  assert(declined.formOpen,
    "declined card: the payment form closed, so there is no way to try another card.");
  assert(!declined.completeShown,
    "declined card: the page offers the confirmed booking after a decline.");
  proved.push("a declined card keeps the form open with the provider's own reason");

  /* ── 2 · Confirm resolves, server still processing ───────────────────── */
  // The important one. The browser says the intent succeeded; the signed
  // server status has not caught up. Payment is what the server says.
  await openCheckout({ paymentIntent: { status: "succeeded" } });
  paymentStatus = "processing";
  await browser.evaluate(`
    document.querySelector("[data-payment-submit]").click();
    const deadline = Date.now() + 12000;
    for (;;) {
      const title = document.querySelector("[data-payment-message-title]").textContent.trim();
      if (/verified|submitted/i.test(title)) return true;
      if (Date.now() > deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  `);
  // Let the page finish its whole polling ladder before judging it.
  await browser.evaluate(`await new Promise((resolve) => setTimeout(resolve, 5200)); return true;`);
  const pending = await browser.evaluate(readCard);
  const confirmCalls = await browser.evaluate(`window.__confirmCalls`);
  assert(confirmCalls === 1,
    `processing: confirmPayment ran ${confirmCalls} times for one submission.`);
  assert(!pending.completeShown,
    "processing: the page shows the confirmed booking while the server still reports processing — a payment declared by the browser alone.");
  assert(/verified|submitted/i.test(pending.title),
    `processing: the card reads "${pending.title}" rather than waiting on the signed status.`);
  assert(/do not submit another payment/i.test(pending.copy),
    `processing: the waiting copy no longer warns against a second submission — it reads "${pending.copy}".`);
  assert(pending.refreshShown,
    "processing: there is no way to re-check the signed status.");
  assert(!pending.formOpen,
    "processing: the payment form is still open, inviting a second authorization for the same booking.");
  proved.push("a browser-reported success with the server still processing never reads as paid");

  /* ── 3 · The server confirms ─────────────────────────────────────────── */
  paymentStatus = "authorized";
  const settled = await browser.evaluate(`
    document.querySelector("[data-payment-status-refresh]").click();
    const deadline = Date.now() + 10000;
    for (;;) {
      if (!document.querySelector("[data-payment-complete]").hidden) return ${readCard};
      if (Date.now() > deadline) return ${readCard};
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  `);
  assert(settled.completeShown,
    `server authorized: the page still withholds the confirmed booking — it reads "${settled.title}".`);
  assert(/authorized/i.test(settled.title),
    `server authorized: the card reads "${settled.title}".`);
  proved.push("the signed server status, once it lands, is what completes the payment");

  /* ── 4 · An uncertain confirm ────────────────────────────────────────── */
  // Stripe answered neither yes nor no. The page must not guess in either
  // direction, and must not let a second authorization be sent.
  await openCheckout({ error: { message: "A network error occurred." } });
  paymentStatus = "processing";
  await browser.evaluate(`
    document.querySelector("[data-payment-submit]").click();
    const deadline = Date.now() + 10000;
    for (;;) {
      const feedback = document.querySelector("[data-payment-feedback]");
      if (feedback && !feedback.hidden && feedback.textContent.trim()) return true;
      if (Date.now() > deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  `);
  const uncertain = await browser.evaluate(readCard);
  assert(!uncertain.completeShown,
    "uncertain confirm: the page claims completion after an error from the provider.");
  assert(uncertain.feedback.length > 0,
    "uncertain confirm: nothing was reported to the Landlord.");
  proved.push("an errored confirm reports itself and claims nothing");
} catch (error) {
  failure = error;
} finally {
  await browser.close();
  await server.close();
}

if (failure) throw failure;

console.log(`Landlord checkout-confirm tests passed:\n  ${proved.join("\n  ")}`);
