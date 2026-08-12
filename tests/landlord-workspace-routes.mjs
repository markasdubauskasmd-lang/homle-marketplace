import { readFile } from "node:fs/promises";

function assert(condition, message) { if (!condition) throw new Error(message); }

const [script, markup, styles, server] = await Promise.all([
  readFile(new URL("../public/landlord-dashboard.js", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-dashboard.html", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-dashboard.css", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8"),
]);

/* ── The workspace panels are real destinations ────────────────────────────
   Properties, Requests and Account were in-page anchors. The address bar never
   changed, so a Landlord could not bookmark a view, send one to a colleague, or
   use Back to return to the previous panel — the whole workspace was one URL.

   The panels still live in one document; only the addressing changed. */

// Home, Bookings and Messages joined these in the v2 dashboard. They are listed
// separately because the assertions below about the *default* view changed with
// them: the dashboard now lands on Home, not Properties.
const panels = ["properties", "requests", "account", "home", "bookings", "messages"];
for (const panel of panels) {
  assert(server.includes(`"/landlord/${panel}": "landlord-dashboard.html"`),
    `/landlord/${panel} is not served, so opening or refreshing that URL is a 404.`);
}

// The pathname must be what the script reads, or a direct visit lands on the
// default panel and the URL silently lies about what is on screen.
assert(script.includes("function workspaceTabFromLocation()"),
  "The location parser was renamed away; routing may no longer read the pathname.");
assert(script.includes("location.pathname"),
  "The dashboard never reads location.pathname, so a direct visit to a panel URL cannot select it.");
// The pathname is matched against the same three panels the routes serve.
for (const panel of panels) {
  assert(new RegExp(`landlord\\\\/\\\\?\\(?[^)]*${panel}`).test(script) || script.includes(`${panel}|`) || script.includes(`|${panel}`),
    `The pathname parser does not recognise the ${panel} panel.`);
}

// Both entry points into panel selection must use it: first paint and Back.
// Back prefers the history entry's own landlordTab, because Places and Bookings
// share the address /landlord/bookings and the pathname alone cannot tell them
// apart; workspaceTabFromHash stays as the fallback for entries written before
// that state existed, and for a cold load of a pasted URL.
assert(/window\.addEventListener\("popstate", \(event\) => selectWorkspaceTab\(event\.state\?\.landlordTab \|\| workspaceTabFromHash\(\)/.test(script),
  "Back does not reselect the panel for the entry being returned to.");
// First paint replaces rather than pushes, so an address that resolves to a
// view but is not that view's own address — /landlord/properties, the legacy
// #landlord-* anchors — is rewritten to the canonical one instead of leaving a
// shared link pointing somewhere the sender never saw.
assert(/selectWorkspaceTab\(workspaceTabFromHash\(\) \|\| "home", \{ historyMode: "replace" \}\);/.test(script),
  "The first paint does not select the panel named by the URL, or does not canonicalise the address.");

// History entries must carry the path, not a fragment.
assert((script.includes("const url = `/landlord/${selected}`") || script.includes('const url = selected === "places" ? "/landlord/bookings" : `/landlord/${selected}`')) &&
  script.includes('history.pushState({ landlordTab: selected }, "", url)') &&
  script.includes('history.replaceState({ landlordTab: selected }, "", url)'),
  "Panel changes still write a #fragment, so the address bar does not name the panel.");

/* ── Old links keep working ───────────────────────────────────────────────
   The hash form is what the dashboard used until now. Anything already saved or
   already open in a tab must not break. */
assert(/#landlord-\(properties\|requests\|account/.test(script),
  "The previous #landlord-* links are no longer understood, so saved links break.");

/* ── Navigation points at the destinations, without a page reload ──────────
   The href makes it a real link — middle-click, copy link, open in new tab all
   behave. The click handler must still preventDefault so an in-page switch does
   not become a full document load of the same 144KB script. */
for (const panel of ["requests", "account"]) {
  assert(markup.includes(`href="/landlord/${panel}"`),
    `Nothing navigates to /landlord/${panel}, so the route is unreachable from the UI.`);
}
assert(!markup.includes('href="/landlord/properties"') && markup.includes('href="/landlord/bookings#your-places"'),
  "Properties returned as a separate destination instead of the reviewed Your places section inside Bookings.");
assert(!markup.includes('href="#landlord-properties"') && !markup.includes('href="#landlord-account"') && !markup.includes('href="#landlord-requests"'),
  "A navigation entry still points at an in-page anchor instead of the panel route.");
for (const hook of ["data-open-landlord-section", "data-open-request-tab"]) {
  const handler = script.slice(script.indexOf(`[${hook}]`), script.indexOf(`[${hook}]`) + 260);
  assert(handler.includes("event.preventDefault()"),
    `${hook} no longer prevents default, so every panel click reloads the whole dashboard.`);
}

/* ── The workspace shows that it is loading ───────────────────────────────
   loadWorkspace() has always set aria-busy while seven parallel reads are in
   flight, and every aria-busy rule in the app styled a BUTTON. The dashboard
   region itself had no loading treatment: a blank area, then everything.

   That is not merely slow-feeling. The empty states are in the markup from the
   first paint, so a Landlord who owns six properties is told they own none
   until the data lands. */
assert(script.includes('workspace.setAttribute("aria-busy", "true")') && script.includes('workspace.removeAttribute("aria-busy")'),
  "The workspace no longer marks itself busy while loading, so the loading treatment can never appear or can never clear.");
assert(styles.includes('[data-landlord-workspace][aria-busy="true"]'),
  "The busy workspace has no visible loading treatment, so empty states read as real answers while data is still arriving.");
assert(/\[data-landlord-workspace\]\[aria-busy="true"\][\s\S]{0,400}opacity:/.test(styles),
  "The loading treatment does not visually distinguish the region.");
// The shimmer is decoration; the signal must survive without motion.
const reducedMotion = styles.slice(styles.lastIndexOf("prefers-reduced-motion"));
assert(reducedMotion.includes("landlord-workspace") || reducedMotion.includes('[aria-busy="true"]::after'),
  "The loading shimmer ignores prefers-reduced-motion.");

/* ── The stepped wizard stays off the critical path ───────────────────────
   23KB that only the Prepare-a-clean panel uses was parsed on every dashboard
   load, including the far more common visits that only check a booking. It is
   progressive enhancement by its own description — the request builder is a
   complete working form without it — so it loads when its panel first opens. */
assert(!markup.includes("landlord-prepare-wizard.js"),
  "The stepped wizard is back in the initial page load, so every Landlord parses 23KB they may never use.");
assert(script.includes('import("./landlord-prepare-wizard.js'),
  "The wizard is neither eagerly loaded nor lazily imported, so the Prepare-a-clean panel would never be enhanced at all.");
assert(script.includes("if (prepareWizardLoad) return prepareWizardLoad"),
  "The wizard import is not memoised, so reopening the panel re-imports it.");
assert(/import\("\.\/landlord-prepare-wizard\.js[^)]*\)\.catch\(/.test(script),
  "A failed wizard load is unhandled; the panel below is a working form and must survive it.");
assert(script.includes('if (selected === "requests") loadPrepareWizard()'),
  "Opening the Prepare-a-clean panel does not trigger the wizard load.");

console.log("Landlord workspace route tests passed: old Properties links resolve into Bookings, Requests and Account remain bookmarkable, old #landlord-* links still resolve, panel clicks stay in-page, and the workspace shows a reduced-motion-safe loading state instead of empty states standing in for data.");
