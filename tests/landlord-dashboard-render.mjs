import { readFile } from "node:fs/promises";
import {
  chromiumExecutableCandidates,
  launchBrowser,
  resolveChromiumPath,
  serveStatic
} from "../tools/browser-harness.mjs";

// Boots the real landlord-dashboard.html against stubbed endpoints and looks at
// what it actually renders.
//
// Every other landlord suite asserts on SOURCE TEXT: it greps the shipped
// modules for a string. That is worth having, but it cannot see a render fail,
// and twice now it has not. `renderNextClean` read two identifiers that were
// declared nowhere in the tree; the function returns early without an accepted
// booking, so the lines never ran for an account that only had requests in
// matching, and the first confirmed booking threw a ReferenceError that replaced
// the entire workspace with a connectivity message. Separately, a fix for one
// clean rendering twice matched `booking.requestId` — a field
// list_my_booking_summaries does not build — so the filter never fired while its
// assertion, which matched the filter's source text, passed.
//
// Both are render-path defects on the happy path. Both are invisible to grep and
// obvious to a browser. So: every view, every account state, one assertion set.
//
// This is desktop Chromium at three viewports against a local static server. It
// is not a device trial and does not claim to be one.

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const chromiumPath = resolveChromiumPath();
if (!chromiumPath) {
  console.log(`Landlord dashboard render checks SKIPPED: no Chromium executable found. Checked ${chromiumExecutableCandidates().join(", ")}.`);
  process.exit(0);
}

const dashboardHtml = await readFile(new URL("../public/landlord-dashboard.html", import.meta.url), "utf8");

/* ── Fixtures ──────────────────────────────────────────────────────────────
 *
 * Shapes copied from the server projections rather than invented, so a change
 * that breaks the real contract breaks this too:
 *   account            -> public/workspace-access.js dashboardWorkspaceAccess
 *   properties         -> src/marketplace/property-service.mjs projection
 *   cleaningRequests   -> src/marketplace/cleaning-request-service.mjs projection
 *   bookings           -> db/migrations/091 list_my_booking_summaries
 *
 * Note what the booking summary does NOT carry: any id naming the request
 * behind it. That absence is the whole reason the duplicate-card fix failed, so
 * these fixtures must never gain a `requestId` for convenience.
 */

const PROPERTY_ID = "44444444-4444-4444-8444-444444444444";
const REQUEST_ID = "66666666-6666-4666-8666-666666666666";
const BOOKING_ID = "77777777-7777-4777-8777-777777777777";

// Fixed instants, so a rerun renders the same words. Far enough ahead that the
// "future work" branches stay selected.
const START_AT = "2099-08-20T09:00:00.000Z";
const END_AT = "2099-08-20T11:00:00.000Z";

const property = {
  propertyId: PROPERTY_ID,
  name: "House in London",
  propertyType: "flat",
  bedrooms: 2,
  bathrooms: 1,
  approximateSizeSqM: 68,
  cleaningPreferences: "",
  savedChecklist: [{ roomName: "Kitchen", description: "Wipe the worktops", sortOrder: 0 }],
  exactAddress: null,
  accessInstructions: null,
  parkingInstructions: null,
  specialNotes: null
};

function request(status) {
  return {
    requestId: REQUEST_ID,
    propertyId: PROPERTY_ID,
    status,
    requestedStartAt: START_AT,
    requestedEndAt: END_AT,
    cleaningType: "regular-domestic",
    requiredServices: [],
    specialInstructions: "",
    budgetPence: null,
    quotedTotalPence: 6800,
    quotedMinutes: 120,
    pricingConfigVersion: 1,
    quotedAt: "2026-08-01T09:00:00.000Z",
    frequency: "one-time",
    tasks: [{ roomName: "Kitchen", description: "Wipe the worktops", sortOrder: 0 }],
    scopeFingerprint: "fingerprint",
    scanFingerprint: null,
    scopeConfirmedAt: "2026-08-01T09:00:00.000Z",
    cleanerPreviewAuthorized: true,
    submittedAt: "2026-08-01T09:00:00.000Z",
    createdAt: "2026-08-01T08:00:00.000Z",
    automaticDispatch: {
      enabled: false, attemptLimit: null, attemptCount: 0,
      authorizedAt: null, revokedAt: null, nextAttemptAt: null, lastResult: null
    }
  };
}

function booking(status) {
  return {
    bookingId: BOOKING_ID,
    participantRole: "landlord",
    status,
    scheduledStartAt: START_AT,
    scheduledEndAt: END_AT,
    propertyName: "House in London",
    propertyArea: "London",
    cleaningType: "regular-domestic",
    counterpartyName: "Assigned Cleaner",
    taskCount: 1,
    pricePence: 6800,
    pricePerspective: "customer-total",
    confirmed: status !== "pending-cleaner-acceptance",
    completed: status === "completed",
    canRespond: false,
    activeJobAvailable: ["confirmed", "cleaner-en-route", "cleaner-arrived", "cleaning-in-progress", "awaiting-review", "completed"].includes(status),
    respondedAt: "2026-08-01T10:00:00.000Z",
    confirmedAt: "2026-08-01T10:00:00.000Z",
    responseDeadline: null,
    paymentAuthorizationReady: false,
    paymentStepAvailable: false,
    paymentStepOpensAt: null
  };
}

const account = {
  ok: true,
  account: { roles: ["landlord"], selectedRole: "landlord", displayName: "Test Landlord", email: "landlord@example.com" }
};

const health = {
  ok: true,
  marketplace: { mediaReady: true, matchingReady: true, geocodingReady: true, automaticDispatchReady: true }
};

/**
 * `care-summary` is deliberately absent from every scenario. When that call
 * fails the dashboard sets careSummary to null and the section keeps its honest
 * starting copy — a real, code-supported state. Inventing a shape here would
 * risk asserting against a contract that does not exist.
 */
function endpoints({ properties = [], cleaningRequests = [], bookings = [], omit = [] } = {}) {
  const files = {
    "/api/marketplace/account": account,
    "/api/marketplace/landlord/profile": { ok: true, profile: { organisationName: null, biography: "" } },
    "/api/marketplace/properties": { ok: true, properties },
    "/api/marketplace/properties/archived": { ok: true, properties: [] },
    "/api/marketplace/cleaning-requests": { ok: true, cleaningRequests },
    "/api/marketplace/bookings": { ok: true, bookings },
    "/api/marketplace/landlord/support-requests": { ok: true, supportRequests: [] },
    "/api/marketplace/landlord/favourite-cleaners": { ok: true, cleaners: [] },
    "/api/health": health
  };
  // An omitted endpoint 404s, which is the rejection branch of loadWorkspace's
  // Promise.allSettled — the same path a 500 takes.
  for (const path of omit) delete files[path];
  return Object.fromEntries(Object.entries(files).map(([path, body]) => [path, JSON.stringify(body)]));
}

const VIEWS = ["home", "bookings", "properties", "messages", "account", "payments", "requests"];

const SCENARIOS = [
  {
    key: "no data",
    files: endpoints()
  },
  {
    key: "request matching",
    files: endpoints({ properties: [property], cleaningRequests: [request("searching-for-cleaner")] })
  },
  {
    key: "booking confirmed",
    // The state that took the whole workspace down: the first accepted booking.
    files: endpoints({ properties: [property], cleaningRequests: [request("matched")], bookings: [booking("confirmed")] })
  },
  {
    key: "booking in progress",
    files: endpoints({ properties: [property], cleaningRequests: [request("matched")], bookings: [booking("cleaning-in-progress")] })
  },
  {
    key: "booking completed",
    files: endpoints({ properties: [property], cleaningRequests: [request("completed")], bookings: [booking("completed")] })
  },
  {
    key: "bookings endpoint down",
    files: endpoints({ properties: [property], cleaningRequests: [request("searching-for-cleaner")], omit: ["/api/marketplace/bookings"] })
  }
];

const VIEWPORTS = [
  { label: "phone", width: 390, height: 844 },
  { label: "desktop", width: 1440, height: 900 }
];

const browser = await launchBrowser();
let failure = null;
const checked = [];

try {
  for (const scenario of SCENARIOS) {
    // The dashboard reads its view from location.pathname, so the real routes
    // are served rather than the bare file. Assets are absolute, so they still
    // resolve from the root.
    const routes = Object.fromEntries(VIEWS.map((view) => [`/landlord/${view}`, dashboardHtml]));
    const server = await serveStatic({ extraFiles: { ...routes, ...scenario.files } });

    try {
      for (const viewport of VIEWPORTS) {
        await browser.setViewport({ width: viewport.width, height: viewport.height, mobile: viewport.width < 700 });

        for (const view of VIEWS) {
          const where = `${scenario.key} · ${view} · ${viewport.label}`;
          const errorsBefore = browser.pageErrors.length;

          await browser.goto(`${server.origin}/landlord/${view}`);

          // loadWorkspace clears aria-busy when every settled request has been
          // rendered. Waiting on that rather than a timer keeps this stable.
          const ready = await browser.evaluate(`
            const deadline = Date.now() + 15000;
            for (;;) {
              const workspace = document.querySelector("[data-landlord-workspace]");
              if (workspace && !workspace.hidden && !workspace.hasAttribute("aria-busy")) return "ready";
              if (Date.now() > deadline) {
                const state = document.querySelector("[data-landlord-state-title]");
                return "stuck: " + (state && !state.closest("[data-landlord-state]")?.hidden ? state.textContent.trim() : "workspace never became ready");
              }
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
          `);
          assert(ready === "ready", `${where}: the workspace never finished loading — ${ready}`);

          const view_ = await browser.evaluate(`
            const main = document.querySelector("#landlord-main");
            const doc = document.documentElement;
            return {
              text: main ? main.innerText.replace(/\\s+/g, " ").trim() : "",
              overflow: doc.scrollWidth - doc.clientWidth,
              visiblePanels: [...document.querySelectorAll("[data-landlord-panel]")]
                .filter((panel) => !panel.hidden).map((panel) => panel.dataset.landlordPanel)
            };
          `);

          const pageErrors = browser.pageErrors.slice(errorsBefore);
          assert(pageErrors.length === 0,
            `${where}: the page threw during render — ${pageErrors.join(" | ")}`);

          // A view that renders almost nothing is a failure the eye would catch
          // instantly and a source grep never will.
          assert(view_.text.length > 40,
            `${where}: the main region rendered ${view_.text.length} characters, so the view is effectively blank.`);

          const leak = /\bundefined\b|\bNaN\b|\[object Object\]/.exec(view_.text);
          assert(!leak,
            `${where}: "${leak?.[0]}" reached the rendered text — ${view_.text.slice(Math.max(0, (leak?.index || 0) - 60), (leak?.index || 0) + 60)}`);

          assert(view_.overflow <= 1,
            `${where}: the page scrolls sideways by ${view_.overflow}px.`);

          checked.push(where);
        }
      }

      /* ── One clean, one card ──────────────────────────────────────────────
       *
       * The regression that source-text assertions could not see. With a matched
       * request and its confirmed booking, the property used to be named twice:
       * once by a request card hardcoded to "Matching in progress" and once by
       * the booking card reading the real status.
       */
      if (scenario.key === "booking confirmed") {
        await browser.setViewport({ width: 1440, height: 900, mobile: false });
        await browser.goto(`${server.origin}/landlord/bookings`);
        await browser.evaluate(`
          const deadline = Date.now() + 15000;
          for (;;) {
            const workspace = document.querySelector("[data-landlord-workspace]");
            if (workspace && !workspace.hidden && !workspace.hasAttribute("aria-busy")) return true;
            if (Date.now() > deadline) return false;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        `);
        const naming = await browser.evaluate(`
          const main = document.querySelector("#landlord-main");
          const text = main ? main.innerText : "";
          return {
            propertyMentions: (text.match(/House in London/g) || []).length,
            saysMatching: /Matching in progress/i.test(text)
          };
        `);
        assert(naming.propertyMentions === 1,
          `booking confirmed: "House in London" is named ${naming.propertyMentions} times on Bookings — one clean is rendering as more than one card.`);
        assert(!naming.saysMatching,
          `booking confirmed: the Bookings view still claims "Matching in progress" for a clean that already has a confirmed booking.`);
        checked.push("booking confirmed · one clean one card");

        // A place with a clean booked is deliberately absent from Your places,
        // so the featured card's Place details button is the only route left to
        // its access details — the door code a Cleaner needs to get in
        // tomorrow. It matched on booking.propertyId, which the booking summary
        // does not carry, so it was hidden on every booking there has ever been.
        const placeRoute = await browser.evaluate(`
          const button = document.querySelector("[data-ld-next-place]");
          const box = button ? button.getBoundingClientRect() : null;
          return {
            present: Boolean(button),
            // Measured rather than checkVisibility(): the section it sits in
            // fades in, so an opacity check here races the animation.
            reachable: Boolean(button) && !button.hidden && box.width > 0 && box.height > 0,
            label: button ? (button.getAttribute("aria-label") || "") : ""
          };
        `);
        assert(placeRoute.present, "booking confirmed: the featured clean has no Place details control at all.");
        assert(placeRoute.reachable,
          "booking confirmed: Place details is hidden on the featured clean, so a place booked for tomorrow has no route to its access details.");
        assert(/House in London/.test(placeRoute.label),
          `booking confirmed: Place details does not name the place it opens — its label is "${placeRoute.label}".`);
        checked.push("booking confirmed · access details reachable");
      }

      /* ── An empty state must not assert a fact the server never sent ──────
       *
       * STATE-01: when the bookings call fails, bookings stays [] and the view
       * renders as though the server had answered "none".
       */
      if (scenario.key === "bookings endpoint down") {
        await browser.setViewport({ width: 1440, height: 900, mobile: false });
        await browser.goto(`${server.origin}/landlord/bookings`);
        await browser.evaluate(`
          const deadline = Date.now() + 15000;
          for (;;) {
            const workspace = document.querySelector("[data-landlord-workspace]");
            if (workspace && !workspace.hidden && !workspace.hasAttribute("aria-busy")) return true;
            if (Date.now() > deadline) return false;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        `);
        // Asserted against the partial-load banner itself, not against any
        // sentence containing "refresh" — the Bookings view carries a permanent
        // "Refresh booking status" button that would satisfy a loose match
        // whether or not anything admitted the failure.
        const honesty = await browser.evaluate(`
          const banner = document.querySelector("[data-landlord-load-status]");
          return {
            bannerShown: Boolean(banner) && !banner.hidden,
            bannerText: banner ? banner.innerText.replace(/\\s+/g, " ").trim() : ""
          };
        `);
        assert(honesty.bannerShown,
          "bookings endpoint down: the partial-load banner stayed hidden, so an empty Bookings view reports zero bookings as a fact about the account rather than a call that failed.");
        assert(/could not be refreshed/i.test(honesty.bannerText),
          `bookings endpoint down: the partial-load banner no longer says what went wrong — it reads "${honesty.bannerText}".`);

        // The banner is global. The list itself must also stop stating a fact
        // the server never sent: "No confirmed bookings yet" is a claim about
        // the account, not about a request that failed.
        const emptyState = await browser.evaluate(`
          const empty = document.querySelector("[data-landlord-booking-empty]");
          return { text: empty ? empty.innerText.replace(/\s+/g, " ").trim() : "" };
        `);
        assert(!/No confirmed bookings yet/i.test(emptyState.text),
          `bookings endpoint down: the Bookings list still says "No confirmed bookings yet" after the bookings call failed, which asserts a fact the server never sent.`);
        assert(/could not be loaded/i.test(emptyState.text),
          `bookings endpoint down: the empty state does not say the bookings could not be loaded — it reads "${emptyState.text}".`);
        checked.push("bookings endpoint down · says so");
      }
    } finally {
      await server.close();
    }
  }
} catch (error) {
  failure = error;
} finally {
  await browser.close();
}

if (failure) throw failure;

console.log(`Landlord dashboard render checks passed: ${checked.length} rendered states across ${SCENARIOS.length} account states, ${VIEWS.length} views and ${VIEWPORTS.length} viewports — workspace reached, nothing blank, no page errors, no undefined/NaN leakage, no sideways scroll, one clean rendered once, and a failed bookings call admitted rather than reported as zero.`);
