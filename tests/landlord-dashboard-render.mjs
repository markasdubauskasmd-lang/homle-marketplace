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
  const unavailable = [];
  if (omit.includes("/api/marketplace/bookings")) unavailable.push("bookings");
  const files = {
    "/api/marketplace/landlord/bootstrap": {
      ...account,
      profile: { organisationName: null, biography: "" },
      properties,
      archivedProperties: [],
      cleaningRequests,
      bookings: unavailable.includes("bookings") ? [] : bookings,
      supportRequests: [],
      unavailable
    },
    "/api/marketplace/landlord/favourite-cleaners": { ok: true, cleaners: [] },
    "/api/health": health
  };
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
          assert(ready === "ready", `${where}: the workspace never finished loading — ${ready}; page errors: ${browser.pageErrors.slice(errorsBefore).join(" | ") || "none"}`);

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
      /* ── Dismissing a dialog actually runs its teardown ──────────────────
       *
       * Every assertion covering dialog dismissal was a source-text match,
       * which passes whatever the engine does. A report of the deployed site
       * claimed the close event had stopped being delivered in Chrome 151,
       * leaving seven consequences dead — including two price-approval
       * Promises that would never resolve. It did not reproduce, and this is
       * the check that settles such a question either way: it dismisses a real
       * dialog in a real engine and looks at where the Landlord ends up.
       *
       * It also guards the live risk in the current implementation. Chrome
       * delivers BOTH toggle and close for one dismissal, so every handler
       * registered through onDialogDismissal runs twice. That is only safe
       * while each guards on the state it changes, and the teardown here would
       * navigate twice if that stopped being true.
       */
      if (scenario.key === "no data") {
        await browser.setViewport({ width: 1440, height: 900, mobile: false });
        await browser.goto(`${server.origin}/landlord/requests`);
        await browser.evaluate(`
          const deadline = Date.now() + 15000;
          for (;;) {
            const workspace = document.querySelector("[data-landlord-workspace]");
            if (workspace && !workspace.hidden && !workspace.hasAttribute("aria-busy")) return true;
            if (Date.now() > deadline) return false;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        `);
        const dismissal = await browser.evaluate(`
          const dialog = document.querySelector("[data-request-builder-dialog]");
          if (!dialog) return { error: "the request builder dialog is not in the markup" };
          if (!dialog.open) return { error: "opening /landlord/requests did not open the builder dialog" };
          const signals = [];
          dialog.addEventListener("close", () => signals.push("close"));
          dialog.addEventListener("toggle", (event) => { if (event.newState === "closed") signals.push("toggle"); });
          const startLength = history.length;
          dialog.close();
          // toggle is dispatched as a task, so let the loop turn before looking.
          await new Promise((resolve) => setTimeout(resolve, 300));
          const bookings = document.querySelector('[data-landlord-panel="bookings"]');
          return {
            path: location.pathname,
            dialogOpen: dialog.open,
            bookingsVisible: Boolean(bookings) && !bookings.hidden,
            signals,
            // The teardown replaces rather than pushes, so a correct dismissal
            // adds no entries however many signals arrive.
            historyGrowth: history.length - startLength
          };
        `);
        assert(!dismissal.error, `no data · builder dismissal: ${dismissal.error}`);
        assert(dismissal.dialogOpen === false,
          "no data · builder dismissal: the dialog is still open after close().");
        // The teardown's whole purpose: never strand the Landlord on the empty
        // page behind the builder.
        assert(dismissal.path === "/landlord/bookings",
          `no data · builder dismissal: closing the builder left the address at "${dismissal.path}" instead of /landlord/bookings, so the Landlord is on the empty page the teardown exists to prevent.`);
        assert(dismissal.bookingsVisible,
          "no data · builder dismissal: the address moved to /landlord/bookings but the Bookings panel is not visible, so the view behind the dialog is blank.");
        assert(dismissal.signals.length > 0,
          "no data · builder dismissal: neither close nor toggle was delivered, so no dismissal signal exists for the teardown to hang on at all.");
        assert(dismissal.historyGrowth === 0,
          `no data · builder dismissal: the teardown added ${dismissal.historyGrowth} history entr${dismissal.historyGrowth === 1 ? "y" : "ies"}, so it ran more than once in a way the Landlord would feel when pressing Back. Signals delivered: ${dismissal.signals.join(", ")}.`);
        checked.push(`no data · dialog dismissal runs its teardown once (signals: ${dismissal.signals.join("+")})`);
      }

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
        /* Counts CARDS FOR THE CLEAN, not mentions of the property name.
           Your places lives inside this view, and a place with live work now
           keeps its card there by design, so the place card names the property
           legitimately — the defect this guards against is one clean drawn as
           two work cards under progress rails that disagree. The property grid
           is therefore excluded, and the request-card count is what matters. */
        const naming = await browser.evaluate(`
          const main = document.querySelector("#landlord-main");
          const grid = document.querySelector("[data-property-list]");
          const workText = [...main.querySelectorAll(":scope *")]
            .filter((node) => !grid || !grid.contains(node))
            .map((node) => node.children.length === 0 ? node.textContent : "")
            .join(" ");
          return {
            requestCards: document.querySelectorAll(".ld-request-now").length,
            workMentions: (workText.match(/House in London/g) || []).length,
            placeCards: grid ? grid.querySelectorAll("article.landlord-property-card").length : 0,
            saysMatching: /Matching in progress/i.test(workText)
          };
        `);
        assert(naming.requestCards === 0,
          `booking confirmed: ${naming.requestCards} request card(s) are still drawn for a clean that already has a confirmed booking — the booking owns it.`);
        assert(naming.placeCards === 1,
          `booking confirmed: Your places shows ${naming.placeCards} card(s) for the one saved property.`);
        assert(naming.workMentions === 1,
          `booking confirmed: outside Your places, "House in London" is named ${naming.workMentions} times on Bookings — one clean is rendering as more than one work card.`);
        assert(!naming.saysMatching,
          `booking confirmed: the Bookings view still claims "Matching in progress" for a clean that already has a confirmed booking.`);
        checked.push("booking confirmed · one clean one card");

        // A second, independent route to the same place's access details. The
        // place card carries one now that blocked places stay in the grid, but
        // this button on the featured clean matched on booking.propertyId,
        // which the booking summary
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

        /* ── A place with cleaning work is still in Your places ──────────────
         *
         * The grid used to filter it out, so asking for a clean looked like
         * the property being deleted. This scenario has exactly one property
         * and one confirmed booking against it: the card must be present, must
         * say what the work is, and must not offer to book a second clean on
         * top of the one already running.
         */
        await browser.goto(`${server.origin}/landlord/properties`);
        await browser.evaluate(`
          const deadline = Date.now() + 15000;
          for (;;) {
            const workspace = document.querySelector("[data-landlord-workspace]");
            if (workspace && !workspace.hidden && !workspace.hasAttribute("aria-busy")) return true;
            if (Date.now() > deadline) return false;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        `);
        const places = await browser.evaluate(`
          const cards = [...document.querySelectorAll("[data-property-list] article.landlord-property-card")];
          const card = cards[0];
          const actionLabels = card ? [...card.querySelectorAll(".landlord-property-actions > button, .landlord-property-actions > a")].map((control) => control.textContent.trim()) : [];
          return {
            cardCount: cards.length,
            names: cards.map((item) => (item.querySelector("h3") || {}).textContent || ""),
            flaggedAsWorking: Boolean(card && card.dataset.propertyCleaningBlocker),
            pill: card ? (card.querySelector(".ld-prop-work-pill") || {}).textContent || "" : "",
            summary: card ? (card.querySelector(".ld-prop-summary") || {}).textContent || "" : "",
            actionLabels,
            hasWorkPanel: Boolean(card && card.querySelector("[data-property-cleaning-blocker], .landlord-property-work")),
            emptyShown: !document.querySelector("[data-property-empty]").hidden
          };
        `);
        assert(places.cardCount === 1,
          `booking confirmed · your places: expected the one property to still have a card, found ${places.cardCount}. Names: [${places.names.join(", ")}].`);
        assert(/House in London/.test(places.names[0]),
          `booking confirmed · your places: the card does not name the property — "${places.names[0]}".`);
        assert(!places.emptyShown,
          "booking confirmed · your places: the empty state is showing while the account has a saved property.");
        assert(places.flaggedAsWorking && /booked/i.test(places.pill),
          `booking confirmed · your places: the card does not mark its live work — pill "${places.pill}".`);
        assert(!/nothing booked/i.test(places.summary),
          `booking confirmed · your places: a place with a confirmed booking summarises itself as "${places.summary}".`);
        assert(!places.actionLabels.some((label) => /^book clean$/i.test(label)),
          `booking confirmed · your places: the card still offers "Book clean" on a place whose clean is already booked — actions [${places.actionLabels.join(", ")}].`);
        assert(places.actionLabels.some((label) => /view booking/i.test(label)),
          `booking confirmed · your places: no route into the live work — actions [${places.actionLabels.join(", ")}].`);
        assert(places.hasWorkPanel,
          "booking confirmed · your places: the detailed work panel (renderPropertyBlocker) is not on the card.");
        checked.push("booking confirmed · the place stays in Your places, marked as booked");
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

  /* A signed-out visit must stop at the secure Landlord bootstrap. The unread
     badge is private too, but it used to race that boundary on module load and
     create an avoidable 401 (plus potential EventSource reconnect work) before
     the sign-in gate appeared. */
  let signedOutNotificationReads = 0;
  const signedOutServer = await serveStatic({
    extraFiles: {
      "/landlord/home": dashboardHtml,
      "/api/marketplace/landlord/bootstrap": () => ({ status: 401, body: { ok: false, error: "Authentication required." } }),
      "/api/marketplace/notifications": () => {
        signedOutNotificationReads += 1;
        return { status: 401, body: { ok: false, error: "Authentication required." } };
      },
      "/api/health": JSON.stringify(health)
    }
  });
  try {
    await browser.setViewport({ width: 390, height: 844, mobile: true });
    await browser.goto(`${signedOutServer.origin}/landlord/home`);
    const signedOutState = await browser.evaluate(`
      const deadline = Date.now() + 3000;
      for (;;) {
        const state = document.querySelector("[data-landlord-state]");
        const title = document.querySelector("[data-landlord-state-title]");
        if (state && !state.hidden && /Sign in as a Landlord/i.test(title?.textContent || "")) {
          await new Promise((resolve) => setTimeout(resolve, 300));
          return {
            title: title.textContent.trim(),
            notificationHidden: document.querySelector("[data-notification-link]")?.hidden === true
          };
        }
        if (Date.now() > deadline) return { title: "timeout", notificationHidden: false };
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    `);
    assert(/Sign in as a Landlord/i.test(signedOutState.title),
      `signed-out notification gate: the secure sign-in state did not render — got "${signedOutState.title}".`);
    assert(signedOutState.notificationHidden,
      "signed-out notification gate: the private notification shortcut became visible without an authorised Landlord session.");
    assert(signedOutNotificationReads === 0,
      `signed-out notification gate: the page made ${signedOutNotificationReads} private notification read(s) before Landlord access was authorised.`);
    checked.push("signed-out session · zero private notification reads");
  } finally {
    await signedOutServer.close();
  }

  /* Saved Cleaners is an optional account enhancement, not a prerequisite for
     opening the Landlord workspace. Prove that a slow response there cannot
     keep every dashboard control aria-busy after the primary records render. */
  const slowFavouriteFiles = endpoints();
  slowFavouriteFiles["/api/marketplace/landlord/favourite-cleaners"] = async () => {
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    return { body: { ok: true, cleaners: [] } };
  };
  const slowFavouriteServer = await serveStatic({
    extraFiles: {
      "/landlord/home": dashboardHtml,
      ...slowFavouriteFiles
    }
  });
  try {
    await browser.setViewport({ width: 390, height: 844, mobile: true });
    const startedAt = Date.now();
    await browser.goto(`${slowFavouriteServer.origin}/landlord/home`);
    const optionalRead = await browser.evaluate(`
      const deadline = Date.now() + 1800;
      for (;;) {
        const workspace = document.querySelector("[data-landlord-workspace]");
        if (workspace && !workspace.hidden && !workspace.hasAttribute("aria-busy")) {
          return {
            ready: true,
            bodyText: document.querySelector("#landlord-main")?.innerText || ""
          };
        }
        if (Date.now() > deadline) return { ready: false, bodyText: "" };
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    `);
    const elapsedMs = Date.now() - startedAt;
    assert(optionalRead.ready,
      `slow saved-Cleaners read: the primary Landlord workspace stayed busy for at least 1.8 seconds (${elapsedMs}ms observed).`);
    assert(/What do you need cleaned|Your places|Bookings/i.test(optionalRead.bodyText),
      "slow saved-Cleaners read: the workspace stopped reporting busy before its primary content rendered.");
    checked.push("slow saved-Cleaners read · primary workspace stays interactive");
  } finally {
    await slowFavouriteServer.close();
  }

  /* The server-authorised bootstrap and public health read may overlap, but
     owner data must reach the browser through one private request. Capture
     arrival times so this stays deterministic without a render stopwatch. */
  const primaryReadStarts = { bootstrap: 0, health: 0 };
  const overlappingPrimaryFiles = endpoints();
  overlappingPrimaryFiles["/api/marketplace/landlord/bootstrap"] = async () => {
    primaryReadStarts.bootstrap = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 650));
    return { body: endpoints()["/api/marketplace/landlord/bootstrap"] };
  };
  overlappingPrimaryFiles["/api/health"] = async () => {
    primaryReadStarts.health = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { body: endpoints()["/api/health"] };
  };
  const overlappingPrimaryServer = await serveStatic({
    extraFiles: {
      "/landlord/home": dashboardHtml,
      ...overlappingPrimaryFiles
    }
  });
  try {
    await browser.setViewport({ width: 390, height: 844, mobile: true });
    await browser.goto(`${overlappingPrimaryServer.origin}/landlord/home`);
    const workspaceReady = await browser.evaluate(`
      const deadline = Date.now() + 3000;
      for (;;) {
        const workspace = document.querySelector("[data-landlord-workspace]");
        if (workspace && !workspace.hidden && !workspace.hasAttribute("aria-busy")) return true;
        if (Date.now() > deadline) return false;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    `);
    assert(workspaceReady, "overlapping primary reads: the Landlord workspace did not finish opening.");
    assert(primaryReadStarts.bootstrap > 0 && primaryReadStarts.health > 0,
      "overlapping primary reads: the Landlord bootstrap or health request never reached the server.");
    assert(Math.abs(primaryReadStarts.health - primaryReadStarts.bootstrap) < 300,
      `overlapping primary reads: health started ${Math.abs(primaryReadStarts.health - primaryReadStarts.bootstrap)}ms away from the secure bootstrap instead of concurrently.`);
    checked.push("one secure bootstrap + public health · overlap safely");
  } finally {
    await overlappingPrimaryServer.close();
  }
} catch (error) {
  failure = error;
} finally {
  await browser.close();
}

if (failure) throw failure;

console.log(`Landlord dashboard render checks passed: ${checked.length} rendered states across ${SCENARIOS.length} account states, ${VIEWS.length} views and ${VIEWPORTS.length} viewports — workspace reached, nothing blank, no page errors, no undefined/NaN leakage, no sideways scroll, one clean rendered once, and a failed bookings call admitted rather than reported as zero.`);
