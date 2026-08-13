import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  chromiumExecutableCandidates,
  launchBrowser,
  resolveChromiumPath,
  serveStatic
} from "../tools/browser-harness.mjs";

// What the cascade actually resolves to, held still.
//
// Removing 92 dead declarations was safe because it was checked against
// full-page screenshots. Nothing in the repo can repeat that check, so the next
// stylesheet change is back to being hopeful: every landlord suite reads CSS as
// TEXT and asserts on substrings, which cannot see a specificity change, a load
// order change, or a token that stopped resolving.
//
// This records the resolved value of the properties a redesign actually moves,
// for every styled element the dashboard renders, and compares against a
// committed baseline. A diff is not automatically a failure — it is the change
// made visible in review, which is the thing that was missing.
//
// Regenerate deliberately, and read the diff:
//   node tests/landlord-computed-styles.mjs --update
//
// It is a companion to landlord-dashboard-render.mjs, not a replacement: that
// one proves the page renders, this one proves it renders the same.

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const update = process.argv.includes("--update");

const chromiumPath = resolveChromiumPath();
if (!chromiumPath) {
  console.log(`Landlord computed-style checks SKIPPED: no Chromium executable found. Checked ${chromiumExecutableCandidates().join(", ")}.`);
  process.exit(0);
}

const baselineUrl = new URL("./fixtures/landlord-computed-styles.json", import.meta.url);
const dashboardHtml = await readFile(new URL("../public/landlord-dashboard.html", import.meta.url), "utf8");

/* The same fixtures the render suite uses, and for the same reason: a booking
   present means the booked-state components are in the tree and therefore
   measured. Fixed instants keep the DOM identical between runs. */
const PROPERTY_ID = "44444444-4444-4444-8444-444444444444";
const START_AT = "2099-08-20T09:00:00.000Z";
const END_AT = "2099-08-20T11:00:00.000Z";

const property = {
  propertyId: PROPERTY_ID, name: "House in London", propertyType: "flat",
  bedrooms: 2, bathrooms: 1, approximateSizeSqM: 68, cleaningPreferences: "",
  savedChecklist: [{ roomName: "Kitchen", description: "Wipe the worktops", sortOrder: 0 }],
  exactAddress: null, accessInstructions: null, parkingInstructions: null, specialNotes: null
};

const request = {
  requestId: "66666666-6666-4666-8666-666666666666", propertyId: PROPERTY_ID, status: "matched",
  requestedStartAt: START_AT, requestedEndAt: END_AT, cleaningType: "regular-domestic",
  requiredServices: [], specialInstructions: "", budgetPence: null, quotedTotalPence: 6800,
  quotedMinutes: 120, pricingConfigVersion: 1, quotedAt: "2026-08-01T09:00:00.000Z",
  frequency: "one-time", tasks: [{ roomName: "Kitchen", description: "Wipe the worktops", sortOrder: 0 }],
  scopeFingerprint: "fingerprint", scanFingerprint: null, scopeConfirmedAt: "2026-08-01T09:00:00.000Z",
  cleanerPreviewAuthorized: true, submittedAt: "2026-08-01T09:00:00.000Z", createdAt: "2026-08-01T08:00:00.000Z",
  automaticDispatch: { enabled: false, attemptLimit: null, attemptCount: 0, authorizedAt: null, revokedAt: null, nextAttemptAt: null, lastResult: null }
};

const booking = {
  bookingId: "77777777-7777-4777-8777-777777777777", participantRole: "landlord", status: "confirmed",
  scheduledStartAt: START_AT, scheduledEndAt: END_AT, propertyName: "House in London",
  propertyArea: "London", cleaningType: "regular-domestic", counterpartyName: "Assigned Cleaner",
  taskCount: 1, pricePence: 6800, pricePerspective: "customer-total", confirmed: true, completed: false,
  canRespond: false, activeJobAvailable: true, respondedAt: "2026-08-01T10:00:00.000Z",
  confirmedAt: "2026-08-01T10:00:00.000Z", responseDeadline: null,
  paymentAuthorizationReady: false, paymentStepAvailable: true, paymentStepOpensAt: null
};

const files = {
  "/api/marketplace/account": { ok: true, account: { roles: ["landlord"], selectedRole: "landlord", displayName: "Test Landlord", email: "landlord@example.com" } },
  "/api/marketplace/landlord/profile": { ok: true, profile: { organisationName: null, biography: "" } },
  "/api/marketplace/properties": { ok: true, properties: [property] },
  "/api/marketplace/properties/archived": { ok: true, properties: [] },
  "/api/marketplace/cleaning-requests": { ok: true, cleaningRequests: [request] },
  "/api/marketplace/bookings": { ok: true, bookings: [booking] },
  "/api/marketplace/landlord/support-requests": { ok: true, supportRequests: [] },
  "/api/marketplace/landlord/favourite-cleaners": { ok: true, cleaners: [] },
  "/api/health": { ok: true, marketplace: { mediaReady: true, matchingReady: true, geocodingReady: true, automaticDispatchReady: true } }
};

const VIEWS = ["home", "bookings", "properties", "messages", "account", "payments"];
const VIEWPORTS = [{ label: "phone", width: 390, height: 844 }, { label: "desktop", width: 1440, height: 900 }];

/* The properties a restyle moves. Deliberately excludes anything that animates
   (opacity, transform) or depends on layout position, so a diff always means a
   rule changed rather than a frame landing differently. */
const PROBE = `
  const PROPERTIES = [
    "font-family", "font-size", "font-weight", "letter-spacing", "line-height",
    "color", "background-color",
    "border-top-width", "border-top-style", "border-top-color", "border-radius",
    "box-shadow", "padding-top", "padding-right", "padding-bottom", "padding-left",
    "min-height", "outline-width", "outline-style", "outline-color", "display"
  ];
  const snapshot = {};
  // A stable key: the element's own identity plus how many identical siblings
  // preceded it. Independent of text content, so a clock in a card cannot move
  // an entry, and independent of source order elsewhere in the tree.
  const seen = new Map();
  for (const el of document.querySelectorAll("*")) {
    if (!el.className || typeof el.className !== "string") continue;
    const classes = el.className.trim().split(/\\s+/).filter(Boolean).sort().join(".");
    if (!classes) continue;
    // Only the landlord design systems. Shared site chrome is covered elsewhere
    // and would make this file churn on unrelated work.
    if (!/^(ld-|hub-|pac-|landlord-|booking-dashboard|dashboard-)/.test(classes)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    const base = el.tagName.toLowerCase() + "." + classes;
    const index = seen.get(base) || 0;
    seen.set(base, index + 1);
    const style = getComputedStyle(el);
    const entry = {};
    for (const property of PROPERTIES) {
      // Two glows here are keyframed, so a reading taken one frame later
      // differs in the fifth decimal of a pixel. Lengths are rounded to 0.1px
      // so that noise cannot read as a cascade change, while any real edit —
      // the smallest being a 1px border — still shows. Only px is touched:
      // colour alpha keeps its full precision.
      entry[property] = style.getPropertyValue(property)
        .replace(/([0-9]+[.][0-9]+)px/g, (whole, number) => String(Math.round(Number(number) * 10) / 10) + "px");
    }
    snapshot[base + "#" + index] = entry;
  }
  return snapshot;
`;

const server = await serveStatic({
  extraFiles: {
    ...Object.fromEntries(VIEWS.map((view) => [`/landlord/${view}`, dashboardHtml])),
    ...Object.fromEntries(Object.entries(files).map(([path, body]) => [path, JSON.stringify(body)]))
  }
});
const browser = await launchBrowser();
const captured = {};
let failure = null;

try {
  for (const viewport of VIEWPORTS) {
    await browser.setViewport({ width: viewport.width, height: viewport.height, mobile: viewport.width < 700 });
    for (const view of VIEWS) {
      await browser.goto(`${server.origin}/landlord/${view}`);
      const ready = await browser.evaluate(`
        const deadline = Date.now() + 15000;
        for (;;) {
          const workspace = document.querySelector("[data-landlord-workspace]");
          if (workspace && !workspace.hidden && !workspace.hasAttribute("aria-busy")) return true;
          if (Date.now() > deadline) return false;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      `);
      assert(ready, `${view} at ${viewport.label}: the workspace never finished loading, so nothing could be measured.`);
      captured[`${viewport.label} · ${view}`] = await browser.evaluate(PROBE);
    }
  }
} catch (error) {
  failure = error;
} finally {
  await browser.close();
  await server.close();
}

if (failure) throw failure;

const measuredElements = Object.values(captured).reduce((total, group) => total + Object.keys(group).length, 0);
assert(measuredElements > 300, `Only ${measuredElements} styled elements were measured; the probe has drifted away from the markup and this check is no longer covering the design system.`);

if (update || !existsSync(baselineUrl)) {
  await writeFile(baselineUrl, `${JSON.stringify(captured, null, 1)}\n`);
  console.log(`Landlord computed-style baseline written: ${measuredElements} styled elements across ${VIEWS.length} views and ${VIEWPORTS.length} viewports. Read the diff before committing it.`);
  process.exit(0);
}

const baseline = JSON.parse(await readFile(baselineUrl, "utf8"));
const differences = [];
const groups = new Set([...Object.keys(baseline), ...Object.keys(captured)]);
for (const group of groups) {
  const before = baseline[group] || {};
  const after = captured[group] || {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!before[key]) { differences.push(`${group} :: ${key} is new`); continue; }
    if (!after[key]) { differences.push(`${group} :: ${key} no longer renders`); continue; }
    for (const property of Object.keys(before[key])) {
      if (before[key][property] !== after[key][property]) {
        differences.push(`${group} :: ${key} :: ${property}: "${before[key][property]}" -> "${after[key][property]}"`);
      }
    }
  }
}

assert(differences.length === 0, `The Landlord design system resolves differently than the committed baseline in ${differences.length} place${differences.length === 1 ? "" : "s"}. If the change was intended, rerun with --update and review the diff; if it was not, this is a cascade regression a source-text assertion could not have seen.\n\n${differences.slice(0, 40).join("\n")}${differences.length > 40 ? `\n… and ${differences.length - 40} more` : ""}`);

console.log(`Landlord computed-style tests passed: ${measuredElements} styled elements across ${VIEWS.length} views and ${VIEWPORTS.length} viewports resolve exactly as the committed baseline, so a specificity, load-order or token change cannot land unseen.`);
