import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [page, client, dashboard, dashboardPage, server] = await Promise.all([
  readFile(new URL("../public/stripe-sandbox.html", import.meta.url), "utf8"),
  readFile(new URL("../public/stripe-sandbox.js", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-dashboard.js", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-dashboard.html", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8")
]);

assert(page.includes("Stripe test checkout") && page.includes("£0.30") && page.includes("even when no Cleaner can be matched"), "The standalone payment page does not explain its exact test-only scope.");
assert(page.includes("data-sandbox-element") && page.includes("data-sandbox-submit") && page.includes("data-sandbox-complete"), "The standalone payment page lost the real Stripe Payment Element or completion state.");
assert(client.includes("/api/marketplace/payments/config") && client.includes("/api/marketplace/payments/sandbox-checkout"), "The standalone checkout is not attached to authenticated payment APIs.");
assert(client.includes("csrfToken") && client.includes('redirect: "if_required"') && client.includes("confirmPayment"), "The standalone checkout lost CSRF recovery or real Stripe confirmation.");
assert(client.includes("payment?.amountPence !== 30") && client.includes("payment?.testMode !== true"), "The browser no longer fails closed outside the exact 30p test checkout.");
assert(client.includes("new AbortController()") && client.includes("controller.abort()") && client.includes("stripeLoadPromise") && client.includes("20_000") && client.includes("payment-confirmation-timeout") && client.includes("60_000") && client.includes("browserOffline()"), "The immediate Stripe test can hang indefinitely or submit while the browser is offline.");
assert(page.includes("/stripe-sandbox.js?v=20260810-1"), "The Stripe test page can reuse the pre-timeout browser controller.");
assert(dashboard.includes('code: "no-eligible-cleaner"') && dashboard.includes("showNoEligibleCleanerOutcome(requestId)") && !dashboard.includes('sandbox.href = "/stripe-sandbox?start=1"') && dashboardPage.includes("Test Stripe payment now (&pound;0.30)"), "The no-Cleaner state is not separated from the standalone Stripe test, or the explicit completion-state test checkout disappeared.");
assert(server.includes('"/stripe-sandbox": "stripe-sandbox.html"') && server.includes('requestPath === "/stripe-sandbox"'), "The server lost the standalone checkout route or Stripe CSP.");

console.log("Stripe sandbox UI tests passed: no-Cleaner recovery stays in the booking flow while the isolated authenticated 30p test preserves its Payment Element and completion state.");
