import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  chromiumExecutableCandidates,
  launchBrowser,
  resolveChromiumPath,
  serveStatic
} from "../tools/browser-harness.mjs";
import { defaultPricingConfig, normalizedPricingConfig } from "../public/pricing-config.js";
import { quoteRooms } from "../public/pricing-engine.js";
import { optionalRequestScope, pricingRequestFromManualTasks } from "../public/landlord-dashboard-model.js";

// The complete manual-request journey, driven twice with different selections.
//
// Every landlord suite until now proved single states: the form exists, a view
// renders, a payment status maps to the right words. None of them proved the
// sequence — that changing a selection changes the live price, that the payload
// the page finally posts is the payload the Landlord built rather than a
// default or a leftover from the previous request, and that the checkout state
// machine survives failure, retry, refresh, duplicates and a webhook that
// arrives after the page stopped looking.
//
// Two design points make this an end-to-end rather than a mock parade:
//
// 1. The pricing stub runs the REAL engine — public/pricing-engine.js under
//    public/pricing-config.js defaults, the same modules the server imports. A
//    quote shown in the UI is compared against the engine called directly with
//    the same inputs, so the test fails if the page misroutes, caches or
//    invents a price.
// 2. The create stub records exactly what the page sent, and the second run's
//    record is compared field-by-field against the first. "Dynamic" is proven
//    by difference, not asserted by adjective.
//
// What this deliberately does NOT cover: the Stripe element itself. The
// harness serves only local files, so js.stripe.com is unreachable and
// mounting the element is impossible here. The test drives the page to that
// exact boundary and asserts the failure is honest — visible feedback, a
// retry, no hang and no fabricated success. Everything after the element
// (processing, authorized, failed, late reconciliation) is real page code
// rendering real server states.

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const chromiumPath = resolveChromiumPath();
if (!chromiumPath) {
  console.log(`Landlord request-flow checks SKIPPED: no Chromium executable found. Checked ${chromiumExecutableCandidates().join(", ")}.`);
  process.exit(0);
}

const dashboardHtml = await readFile(new URL("../public/landlord-dashboard.html", import.meta.url), "utf8");
const checkoutHtml = await readFile(new URL("../public/landlord-checkout.html", import.meta.url), "utf8");

const pricingConfig = normalizedPricingConfig(defaultPricingConfig);

/* The two journeys. Different property, service, length, date, time, tasks and
   notes — if any of these leaks from run 1 into run 2's record, the comparison
   at the end names the field. */
const PROPERTIES = [
  {
    propertyId: "44444444-4444-4444-8444-444444444444",
    name: "House in London", propertyType: "house", bedrooms: 3, bathrooms: 2,
    approximateSizeSqM: 104, cleaningPreferences: "", savedChecklist: [],
    exactAddress: null, accessInstructions: null, parkingInstructions: null, specialNotes: null
  },
  {
    propertyId: "55555555-5555-4555-8555-555555555555",
    name: "Flat in Manchester", propertyType: "flat", bedrooms: 1, bathrooms: 1,
    approximateSizeSqM: 46, cleaningPreferences: "", savedChecklist: [],
    exactAddress: null, accessInstructions: null, parkingInstructions: null, specialNotes: null
  }
];

/* The page validates that the requested window sits within the next year, so
   the two journeys book 3 and 6 weeks out from whenever the test runs. */
function dateWeeksAhead(weeks) {
  const date = new Date(Date.now() + weeks * 7 * 24 * 3600 * 1000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const RUNS = [
  {
    label: "run 1 · house, regular, 2h",
    propertyId: PROPERTIES[0].propertyId,
    cleaningType: "regular-domestic",
    durationMinutes: "120",
    requestedDate: dateWeeksAhead(3),
    requestedTime: "09:00",
    frequency: "one-time",
    tasks: "Kitchen: wipe the worktops\nKitchen: clean the hob\nBathroom: scrub the bath",
    instructions: "The key safe code will be shared after matching."
  },
  {
    label: "run 2 · flat, end of tenancy, 4h",
    propertyId: PROPERTIES[1].propertyId,
    cleaningType: "end-of-tenancy",
    durationMinutes: "240",
    requestedDate: dateWeeksAhead(6),
    requestedTime: "13:30",
    frequency: "one-time",
    tasks: "Living room: wipe the window sills\nBedroom: vacuum the carpet\nBedroom: dust the skirting boards\nHallway: mop the floor",
    instructions: "Meter cupboard is behind the front door."
  }
];

/* ── In-memory backend ─────────────────────────────────────────────────────
 *
 * Small enough to read, real enough to prove the sequence: requests are
 * created from whatever the page posts, and the payment walks the same status
 * ladder the production provider reports through its webhook.
 */
const createdRequests = [];
const quoteCalls = [];
/* A handler that throws answers 500, which the page reports in its own
   guarded words. Keeping the real reason makes a red run debuggable. */
const handlerErrors = [];

function engineQuote({ body }) {
  let parsed;
  try { parsed = JSON.parse(body); } catch { return { status: 400, body: { ok: false } }; }
  quoteCalls.push(parsed);
  try {
    const quote = quoteRooms(parsed, pricingConfig);
    return { body: { ok: true, quote } };
  } catch (error) {
    handlerErrors.push(`quote: ${error.message} for ${body.slice(0, 300)}`);
    throw error;
  }
}

function createRequest(rawBody) {
  const body = JSON.parse(rawBody);
  const quote = quoteRooms(body.pricingRequest || {}, pricingConfig);
  const record = {
    requestId: randomUUID(),
    propertyId: body.propertyId,
    status: "draft",
    requestedStartAt: body.requestedStartAt,
    requestedEndAt: body.requestedEndAt,
    cleaningType: body.cleaningType,
    requiredServices: body.requiredServices || [],
    specialInstructions: body.specialInstructions || "",
    budgetPence: body.budgetPence ?? null,
    quotedTotalPence: quote.priceable ? quote.totalPence : null,
    quotedMinutes: quote.priceable ? quote.estimatedMinutes : null,
    pricingConfigVersion: 1,
    quotedAt: "2026-08-13T12:00:00.000Z",
    frequency: body.frequency || "one-time",
    tasks: body.tasks || [],
    scopeFingerprint: "fp",
    scanFingerprint: null,
    scopeConfirmedAt: "2026-08-13T12:00:00.000Z",
    cleanerPreviewAuthorized: true,
    submittedAt: null,
    createdAt: "2026-08-13T12:00:00.000Z",
    automaticDispatch: { enabled: false, attemptLimit: null, attemptCount: 0, authorizedAt: null, revokedAt: null, nextAttemptAt: null, lastResult: null }
  };
  createdRequests.push({ posted: body, record });
  return { status: 201, body: { ok: true, cleaningRequest: record } };
}

/* The payment state machine behind checkout. `paymentState` is mutated by the
   test to simulate what the provider's signed webhook would have reconciled
   server-side; the page only ever reads it back, which is the whole point —
   nothing the browser says moves this object. */
const BOOKING_ID = "77777777-7777-4777-8777-777777777777";
const AMOUNT = 16800;
const paymentState = { status: "not-started", amountPence: AMOUNT, currency: "gbp" };
const paymentPosts = [];

/* The page's openPaymentForm gates on `requiresCustomerAction`, a field the
   real begin-authorization response derives from the status — omitting it
   makes the page return silently, which is how the stub's first draft turned
   a page behaviour into a phantom bug. Shape it like the server does. */
function paymentView() {
  return {
    ...paymentState,
    requiresCustomerAction: paymentState.status === "requires-customer-action"
  };
}

function paymentEndpoint({ method, body }) {
  if (method === "POST") {
    const parsed = JSON.parse(body || "{}");
    paymentPosts.push(parsed);
    // Idempotent begin: one payment per booking however many times the page
    // asks, matching the production repository's beginAuthorization contract.
    if (paymentState.status === "not-started" || paymentState.status === "authorization-failed") {
      paymentState.status = "requires-customer-action";
      paymentState.clientSecret = "pi_test_secret_measurement";
    }
    return { status: 201, body: { ok: true, payment: paymentView() } };
  }
  return { body: { ok: true, payment: paymentView() } };
}

const staticFiles = {
  "/landlord/requests": dashboardHtml,
  "/landlord/bookings": dashboardHtml,
  "/landlord/checkout": checkoutHtml,
  "/api/marketplace/account": JSON.stringify({ ok: true, account: { roles: ["landlord"], selectedRole: "landlord", displayName: "Journey Landlord", email: "landlord@example.com" } }),
  "/api/marketplace/landlord/profile": JSON.stringify({ ok: true, profile: { organisationName: null, biography: "" } }),
  "/api/marketplace/properties": JSON.stringify({ ok: true, properties: PROPERTIES }),
  "/api/marketplace/properties/archived": JSON.stringify({ ok: true, properties: [] }),
  "/api/marketplace/bookings": JSON.stringify({ ok: true, bookings: [] }),
  "/api/marketplace/landlord/support-requests": JSON.stringify({ ok: true, supportRequests: [] }),
  "/api/marketplace/landlord/favourite-cleaners": JSON.stringify({ ok: true, cleaners: [] }),
  "/api/marketplace/auth/session": JSON.stringify({ ok: true, csrfToken: "journey-token" }),
  /* A key that fails the page's own publishable-key gate. This makes the
     provider-failure branch deterministic wherever the test runs: with real
     network access a plausible test key lets Stripe's script load and mount an
     element against the stubbed secret, which is a different (and less
     interesting) boundary than the one this run must prove — that a payment
     provider failure surfaces visibly instead of leaving a dead button. */
  "/api/marketplace/payments/config": JSON.stringify({ ok: true, payment: { testMode: true, publishableKey: "pk_test_short" } }),
  "/api/health": JSON.stringify({ ok: true, marketplace: { mediaReady: true, matchingReady: true, geocodingReady: true, automaticDispatchReady: true } })
};

const server = await serveStatic({
  extraFiles: {
    ...staticFiles,
    "/api/marketplace/landlord/bootstrap": () => ({ body: {
      ok: true,
      account: { roles: ["landlord"], selectedRole: "landlord", displayName: "Journey Landlord", email: "landlord@example.com" },
      profile: { organisationName: null, biography: "" },
      properties: PROPERTIES,
      archivedProperties: [],
      cleaningRequests: createdRequests.map((entry) => entry.record),
      bookings: [],
      supportRequests: [],
      unavailable: []
    } }),
    "/api/marketplace/pricing/quote": engineQuote,
    "/api/marketplace/cleaning-requests": ({ method, body }) => method === "POST"
      ? createRequest(body)
      : { body: { ok: true, cleaningRequests: createdRequests.map((entry) => entry.record) } },
    [`/api/marketplace/bookings/${BOOKING_ID}/payment`]: paymentEndpoint
  }
});
const browser = await launchBrowser();
let failure = null;
const proved = [];

const waitForWorkspace = `
  const deadline = Date.now() + 15000;
  for (;;) {
    const workspace = document.querySelector("[data-landlord-workspace]");
    if (workspace && !workspace.hidden && !workspace.hasAttribute("aria-busy")) return true;
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
`;

/* Fills the real request form the way scripts legitimately can — through the
   form controls plus the change events the page already listens for. The
   enhanced wizard chrome (cards, calendar) drives these same controls. */
function fillForm(run) {
  return `
    const form = document.querySelector("[data-landlord-request-form]") || document.forms[0];
    const set = (name, value) => {
      const control = document.querySelector('[data-landlord-panel="requests"]').querySelector(\`[name="\${name}"]\`);
      if (!control) return \`missing control: \${name}\`;
      control.value = value;
      control.dispatchEvent(new Event("input", { bubbles: true }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
      return "";
    };
    const problems = [
      set("propertyId", ${JSON.stringify(run.propertyId)}),
      set("cleaningType", ${JSON.stringify(run.cleaningType)}),
      set("durationMinutes", ${JSON.stringify(run.durationMinutes)}),
      set("requestedDate", ${JSON.stringify(run.requestedDate)}),
      set("requestedTime", ${JSON.stringify(run.requestedTime)}),
      set("frequency", ${JSON.stringify(run.frequency)}),
      set("tasks", ${JSON.stringify(run.tasks)}),
      set("specialInstructions", ${JSON.stringify(run.instructions)})
    ].filter(Boolean);
    return problems.join("; ");
  `;
}

const readQuote = `
  const deadline = Date.now() + 8000;
  for (;;) {
    const price = document.querySelector("[data-manual-quote-price]");
    const text = price ? price.textContent.trim() : "";
    if (/£\\d/.test(text)) return text;
    if (Date.now() > deadline) {
      const status = document.querySelector("[data-manual-quote-status]");
      return "no price: " + (status ? status.textContent.trim() : "no status either");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
`;

/* Expectations derived through the page's own public model, so what is being
   proven is the whole wiring: textarea -> model -> endpoint -> engine ->
   display. If the model and the page ever disagree about how typed lines
   become rooms, the shown price stops matching this and the test names it. */
function enginePriceFor(run, cleaningType) {
  const scope = optionalRequestScope(run.tasks, { cleaningType });
  const pricing = pricingRequestFromManualTasks(scope.tasks, { cleaningType, frequency: run.frequency });
  return quoteRooms(pricing, pricingConfig);
}

try {
  for (const run of RUNS) {
    await browser.setViewport({ width: 1440, height: 900, mobile: false });
    await browser.goto(`${server.origin}/landlord/requests`);
    assert(await browser.evaluate(waitForWorkspace), `${run.label}: the workspace never loaded.`);

    const fillProblems = await browser.evaluate(fillForm(run));
    assert(!fillProblems, `${run.label}: the request form has drifted — ${fillProblems}`);

    /* Live price, checked against the engine called directly. The page builds
       its pricing payload from the tasks textarea via its own model; the test
       independently derives the same room grouping and prices it. */
    const shownPrice = await browser.evaluate(readQuote);
    assert(shownPrice.startsWith("£"), `${run.label}: no live estimate appeared — ${shownPrice}`);
    const direct = enginePriceFor(run, run.cleaningType);
    assert(direct.priceable === true, `${run.label}: the engine itself refused to price this configuration — the fixture is wrong, not the page.`);
    const expected = `£${(direct.totalPence / 100).toFixed(2)}`;
    assert(shownPrice === expected,
      `${run.label}: the page shows ${shownPrice} but the real engine prices these selections at ${expected} — the live estimate is not tracking the actual selections.`);
    proved.push(`${run.label}: live price ${shownPrice} matches the engine`);

    /* Change one selection and watch the number move. This is the "dynamic"
       claim at its sharpest: same page, one different choice, different price
       — again matching the engine, not merely different. */
    const flippedType = run.cleaningType === "regular-domestic" ? "end-of-tenancy" : "regular-domestic";
    await browser.evaluate(`
      const panel = document.querySelector('[data-landlord-panel="requests"]');
      const control = panel.querySelector('[name="cleaningType"]');
      control.value = ${JSON.stringify(flippedType)};
      control.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    `);
    const movedPrice = await browser.evaluate(readQuote);
    const directFlipped = enginePriceFor(run, flippedType);
    const expectedFlipped = `£${(directFlipped.totalPence / 100).toFixed(2)}`;
    assert(movedPrice === expectedFlipped && movedPrice !== shownPrice,
      `${run.label}: changing the service should move the price from ${shownPrice} to ${expectedFlipped}, but the page shows ${movedPrice}.`);
    /* Flip back so the submitted record matches the run's selections. */
    await browser.evaluate(`
      const panel = document.querySelector('[data-landlord-panel="requests"]');
      const control = panel.querySelector('[name="cleaningType"]');
      control.value = ${JSON.stringify(run.cleaningType)};
      control.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    `);
    await browser.evaluate(readQuote);
    proved.push(`${run.label}: changing the service moved the price to ${movedPrice}`);

    /* Submit, and confirm the page acknowledges the draft it created. */
    const before = createdRequests.length;
    const submitted = await browser.evaluate(`
      const panel = document.querySelector('[data-landlord-panel="requests"]');
      const continueButton = panel.querySelector("[data-continue-request]");
      if (!continueButton) return "no continue button";
      continueButton.click();
      const deadline = Date.now() + 10000;
      for (;;) {
        const dialog = document.querySelector(".landlord-photo-dialog");
        if (dialog && dialog.open) return "";
        if (Date.now() > deadline) {
          const feedback = document.querySelector("[data-request-feedback]");
          const invalid = document.querySelector("[data-request-form] :invalid:not([disabled])");
          return "the continuation dialog never opened"
            + (feedback && !feedback.hidden ? \` · feedback: "\${feedback.textContent.trim()}"\` : "")
            + (invalid ? \` · first invalid control: \${invalid.name || invalid.id || invalid.tagName}\` : "")
            + \` · validity: \${document.querySelector("[data-request-form]").checkValidity()}\`;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    `);
    assert(!submitted, `${run.label}: submitting failed — ${submitted}`);
    assert(createdRequests.length === before + 1, `${run.label}: expected exactly one new request, got ${createdRequests.length - before}.`);

    const { posted } = createdRequests[createdRequests.length - 1];
    assert(posted.propertyId === run.propertyId, `${run.label}: posted propertyId ${posted.propertyId} is not the selected property.`);
    assert(posted.cleaningType === run.cleaningType, `${run.label}: posted cleaningType ${posted.cleaningType} is not the selected service.`);
    assert(posted.specialInstructions.includes(run.instructions), `${run.label}: the typed instructions did not reach the payload.`);
    const postedWindowMinutes = (Date.parse(posted.requestedEndAt) - Date.parse(posted.requestedStartAt)) / 60000;
    assert(postedWindowMinutes === Number(run.durationMinutes), `${run.label}: the posted window is ${postedWindowMinutes} minutes, the Landlord chose ${run.durationMinutes}.`);
    assert(posted.tasks.length === run.tasks.split("\n").length, `${run.label}: ${posted.tasks.length} tasks were posted for ${run.tasks.split("\n").length} typed lines.`);
    proved.push(`${run.label}: the posted payload matches every selection`);
  }

  /* Two journeys, two records, nothing reused. */
  const [first, second] = createdRequests.map((entry) => entry.record);
  assert(first.requestId !== second.requestId, "Both runs produced the same request id.");
  for (const field of ["propertyId", "cleaningType", "requestedStartAt", "requestedEndAt", "quotedTotalPence", "specialInstructions"]) {
    assert(JSON.stringify(first[field]) !== JSON.stringify(second[field]),
      `Field "${field}" is identical across two different journeys (${JSON.stringify(first[field])}) — a value is being reused instead of captured.`);
  }
  proved.push("two journeys produced two fully distinct records");

  /* Abandonment: the drafts persist as drafts. Nothing was booked or paid by
     walking away, and reloading shows both saved requests. */
  await browser.goto(`${server.origin}/landlord/requests`);
  assert(await browser.evaluate(waitForWorkspace), "abandonment: the workspace never reloaded.");
  const draftIds = await browser.evaluate(`
    [...document.querySelectorAll("[data-request-list] article[data-cleaning-request-id]")]
      .map((card) => card.dataset.cleaningRequestId)
  `);
  for (const entry of createdRequests) {
    assert(draftIds.includes(entry.record.requestId),
      `abandonment: draft ${entry.record.requestId} did not survive a reload — the saved list shows [${draftIds.join(", ")}].`);
  }
  assert(createdRequests.every((entry) => entry.record.status === "draft"), "abandonment: a record left the draft state without the Landlord submitting it.");
  proved.push("abandoned journeys persist as private drafts, not bookings");

  /* ── Checkout: the same machine the webhook drives ──────────────────────── */

  const checkoutUrl = `${server.origin}/landlord/checkout?bookingId=${BOOKING_ID}`;
  const waitForCard = `
    const deadline = Date.now() + 10000;
    for (;;) {
      const card = document.querySelector("[data-payment-card]");
      if (card && !card.hidden) return true;
      if (Date.now() > deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  `;

  await browser.goto(checkoutUrl);
  assert(await browser.evaluate(waitForCard), "checkout: the payment card never rendered for a not-started payment.");
  const opening = await browser.evaluate(`({
    amount: document.querySelector("[data-payment-amount]").textContent.trim(),
    title: document.querySelector("[data-payment-message-title]").textContent.trim(),
    prepareVisible: !document.querySelector("[data-payment-prepare]").hidden
  })`);
  assert(opening.amount === "£168.00", `checkout: the amount shows ${opening.amount}, the frozen total is £168.00.`);
  assert(opening.prepareVisible, "checkout: a not-started payment offers no way to begin.");
  proved.push(`checkout: opens on the frozen total ${opening.amount}`);

  /* Duplicate protection: hammer the prepare action; the state machine may be
     asked twice but must hold one payment, and the page must not error. */
  await browser.evaluate(`
    const prepare = document.querySelector("[data-payment-prepare]");
    prepare.click(); prepare.click(); prepare.click();
    // The begin call resolves quickly; the Stripe script load that follows has
    // to actually fail before the page can report anything, so wait for the
    // feedback rather than for a fixed pause.
    const deadline = Date.now() + 15000;
    for (;;) {
      const feedback = document.querySelector("[data-payment-feedback]");
      if (feedback && !feedback.hidden && feedback.textContent.trim()) return true;
      if (Date.now() > deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  `);
  assert(paymentState.status === "requires-customer-action",
    `checkout: after preparing, the payment sits at ${paymentState.status} instead of requires-customer-action.`);
  const distinctKeys = new Set(paymentPosts.map((post) => post.idempotencyKey));
  assert(paymentPosts.length >= 1 && distinctKeys.size === 1,
    `checkout: ${paymentPosts.length} begin calls carried ${distinctKeys.size} different idempotency keys — a retry would create a second payment server-side.`);
  proved.push(`checkout: ${paymentPosts.length} begin call(s), one idempotency key, one payment`);

  /* The Stripe boundary. Depending on where this runs, js.stripe.com is either
     unreachable (the provider-down condition) or reachable, in which case the
     real script mounts an element against the stubbed client secret. Both are
     legitimate outcomes with the same invariants: the page must land in a
     state with a visible next action — an error with a retry, or the open
     payment form — and must never claim completion, because nothing has been
     authorized. Which branch ran is recorded in the pass message. */
  const boundary = await browser.evaluate(`
    const deadline = Date.now() + 20000;
    for (;;) {
      const feedback = document.querySelector("[data-payment-feedback]");
      const failed = feedback && !feedback.hidden && feedback.textContent.trim();
      const formOpen = !document.querySelector("[data-payment-form]").hidden;
      if (failed || formOpen) return {
        branch: failed ? "provider-failure-surfaced" : "element-open",
        failureText: failed ? feedback.textContent.trim() : "",
        retryAvailable: !document.querySelector("[data-payment-prepare]").hidden || !document.querySelector("[data-payment-status-refresh]").hidden || formOpen,
        fabricatedSuccess: !document.querySelector("[data-payment-complete]").hidden
      };
      if (Date.now() > deadline) return { branch: "hung", retryAvailable: false, fabricatedSuccess: false, failureText: "" };
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  `);
  assert(boundary.branch !== "hung",
    "checkout: preparing the payment reached neither an open form nor a visible failure — the Landlord is left staring at a button that did nothing.");
  assert(boundary.retryAvailable, `checkout: the ${boundary.branch} state left no available next action.`);
  assert(!boundary.fabricatedSuccess, "checkout: the page claims completion while nothing has been authorized.");
  if (boundary.branch === "provider-failure-surfaced") {
    assert(/could not load|too long to load|unavailable/i.test(boundary.failureText),
      `checkout: the provider-failure message does not explain itself — "${boundary.failureText}".`);
  }
  proved.push(`checkout: the Stripe boundary resolved honestly (${boundary.branch})`);

  /* Refresh mid-checkout. The payment is already requires-customer-action
     server-side; a reload must resume it — same amount, continue action —
     rather than starting over or double-charging. */
  const postsBeforeReload = paymentPosts.length;
  await browser.goto(checkoutUrl);
  assert(await browser.evaluate(waitForCard), "checkout: the card did not render after a mid-payment reload.");
  const resumed = await browser.evaluate(`({
    amount: document.querySelector("[data-payment-amount]").textContent.trim(),
    title: document.querySelector("[data-payment-message-title]").textContent.trim()
  })`);
  assert(resumed.amount === "£168.00", `checkout: the amount changed across a reload — ${resumed.amount}.`);
  assert(/payment details needed/i.test(resumed.title), `checkout: a reload lost the in-progress payment — the card says "${resumed.title}".`);
  assert(paymentPosts.length === postsBeforeReload, "checkout: merely reloading the page created another payment begin call.");
  proved.push("checkout: a reload resumes the in-flight payment without a new begin");

  /* Failure and retry: the webhook reconciles a failed authorization; the
     page's next look must present the retry, and retrying must reuse the same
     payment rather than open a second one. */
  paymentState.status = "authorization-failed";
  await browser.goto(checkoutUrl);
  assert(await browser.evaluate(waitForCard), "checkout: the card did not render for a failed payment.");
  const failed = await browser.evaluate(`({
    title: document.querySelector("[data-payment-message-title]").textContent.trim(),
    prepareLabel: document.querySelector("[data-payment-prepare]").textContent.trim(),
    prepareVisible: !document.querySelector("[data-payment-prepare]").hidden
  })`);
  assert(/not authorized/i.test(failed.title), `checkout: a failed authorization reads "${failed.title}".`);
  assert(failed.prepareVisible && /try payment details again/i.test(failed.prepareLabel),
    `checkout: the failed state offers "${failed.prepareLabel}" instead of a retry.`);
  proved.push("checkout: a failed authorization presents an honest retry");

  /* The late webhook. The Landlord authorized, closed the tab before Stripe's
     webhook landed, and comes back: the server has since reconciled
     "authorized". The page must read that from the server and complete —
     never from anything the previous browser session claimed. */
  paymentState.status = "processing";
  await browser.goto(checkoutUrl);
  assert(await browser.evaluate(waitForCard), "checkout: the card did not render for a processing payment.");
  const processing = await browser.evaluate(`({
    title: document.querySelector("[data-payment-message-title]").textContent.trim(),
    refreshVisible: !document.querySelector("[data-payment-status-refresh]").hidden,
    completeVisible: !document.querySelector("[data-payment-complete]").hidden
  })`);
  assert(/being verified/i.test(processing.title), `checkout: a processing payment reads "${processing.title}".`);
  assert(processing.refreshVisible && !processing.completeVisible,
    "checkout: a processing payment should offer a status refresh and must not claim completion yet.");
  paymentState.status = "authorized";
  const settled = await browser.evaluate(`
    document.querySelector("[data-payment-status-refresh]").click();
    const deadline = Date.now() + 8000;
    for (;;) {
      const complete = document.querySelector("[data-payment-complete]");
      if (!complete.hidden) return {
        title: document.querySelector("[data-payment-message-title]").textContent.trim(),
        completeLabel: complete.textContent.trim()
      };
      if (Date.now() > deadline) return { title: "timed out waiting for completion", completeLabel: "" };
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  `);
  assert(/payment authorized/i.test(settled.title),
    `checkout: after the late webhook reconciled, the page says "${settled.title}" instead of confirming authorization.`);
  assert(/open confirmed booking/i.test(settled.completeLabel),
    `checkout: the completed state offers "${settled.completeLabel}" instead of the confirmed booking.`);
  proved.push("checkout: a webhook arriving after the page stopped looking still completes on refresh");
} catch (error) {
  failure = error;
} finally {
  await browser.close();
  await server.close();
}

if (failure) {
  if (handlerErrors.length) failure.message += `\n\nServer-side handler errors during the run:\n  ${handlerErrors.join("\n  ")}`;
  throw failure;
}

console.log(`Landlord request-flow tests passed:\n  ${proved.join("\n  ")}`);
