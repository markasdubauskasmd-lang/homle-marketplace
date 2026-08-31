/*
 * Every hook a Cleaner page dereferences without a guard must actually exist.
 *
 * `cleaner-dashboard.js` did this, in the middle of the dashboard's render:
 *
 *   document.querySelector("[data-cleaner-profile-link]").textContent = …
 *
 * Consolidating the hand-copied Cleaner navigation into `cleaner-sidebar.js`
 * removed that hook from all nineteen pages, and nothing recreates it. So the
 * line threw a TypeError on EVERY load of the Cleaner's own dashboard, the
 * catch turned it into "The Cleaner dashboard is temporarily unavailable", and
 * a CSS rule then hid that message. Nothing after that line ever ran: no
 * welcome, no heading, no pending offers, no bookings — on a page that still
 * showed its calendar, so it looked like a half-loaded dashboard rather than a
 * crash. Measured before the fix: 1571 characters and no visible h1. After:
 * 4002 characters and "Welcome, …".
 *
 * Four other pages touch the same family of hooks and all four guard with
 * `if (link)`. The dashboard was the one that did not, and no test noticed,
 * because a source-text assertion about a selector string cannot tell whether
 * anything creates it.
 *
 * So this checks the join: for every unguarded `document.querySelector("[…]")`
 * dereference in the Cleaner scripts, something in the shipped product must
 * create that attribute — in markup, or as a `dataset` assignment in a script.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const publicDirectory = new URL("../public/", import.meta.url);
const read = (name) => readFileSync(new URL(name, publicDirectory), "utf8");
const names = readdirSync(publicDirectory);

/* ── What the product actually provides ── */

const provided = new Set();
for (const name of names.filter((entry) => entry.endsWith(".html"))) {
  for (const match of read(name).matchAll(/\s(data-[a-z0-9-]+)/g)) provided.add(match[1]);
}
for (const name of names.filter((entry) => entry.endsWith(".js"))) {
  const source = read(name);
  // `element.dataset.cleanerPayoutLink = ""` provides `data-cleaner-payout-link`.
  for (const match of source.matchAll(/\.dataset\.([A-Za-z0-9]+)\s*=/g)) {
    provided.add(`data-${match[1].replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
  }
  // `setAttribute("data-…", …)` provides it too.
  for (const match of source.matchAll(/setAttribute\(\s*"(data-[a-z0-9-]+)"/g)) provided.add(match[1]);
}

assert.ok(provided.size > 100, `Only ${provided.size} data hooks were found across the shipped pages and scripts, which means this scan is not reading the product and would pass whatever the code did.`);

/* ── What the Cleaner scripts dereference without checking ── */

// `document.querySelector("[data-x]").y` — the result used immediately, with no
// null check between. `?.` is a guard, `const x = …` then `if (x)` is a guard;
// a bare `.` is not.
const unguarded = /document\.querySelector\(\s*"\[(data-[a-z0-9-]+)\]"\s*\)\s*\.\s*(?!\s*\?)/g;

const findings = [];
for (const name of names.filter((entry) => entry.startsWith("cleaner-") && entry.endsWith(".js"))) {
  const source = read(name);
  for (const match of source.matchAll(unguarded)) {
    const attribute = match[1];
    if (!provided.has(attribute)) findings.push(`${name} dereferences [${attribute}], which nothing in public/ creates`);
  }
}

assert.deepEqual(
  findings,
  [],
  `A Cleaner page dereferences a hook that does not exist. That is not a missing feature — it is a TypeError in the middle of a render, and everything after it silently stops:\n  ${findings.join("\n  ")}`
);

/* ── The specific hook that caused it stays gone or stays real ── */

// Reading the CODE, not the comment that records why this rule exists.
const dashboardCode = read("cleaner-dashboard.js").replace(/^\s*\/\/.*$/gm, "");
assert.ok(
  !dashboardCode.includes("data-cleaner-profile-link") || provided.has("data-cleaner-profile-link"),
  "cleaner-dashboard.js refers to [data-cleaner-profile-link] again while nothing creates it. The shared sidebar already shows profile-completion marks; a per-page label would be the navigation drift consolidating it existed to end."
);

/* ── An access refusal must never be hidden ── */

// cleaner-schedule.js lifts the activity schedule out of the guarded dashboard
// payload so a connection failure does not take the calendar down with it, and
// a CSS rule suppresses the error panel that would otherwise sit above a
// working calendar. Without the :not() that rule hid EVERY gate state — so a
// signed-out visitor and an account with no Cleaner workspace both got a page
// with no heading, no message and no way to sign in. Measured at 142 and 157
// characters respectively; 273 and 300 with the refusals visible again.
const cleanerStyles = read("homle-cleaner.css");
const rule = /\.hc-main-inner\[data-activity-schedule-ready="true"\] > \[data-cleaner-dashboard-gate\](:not\(\[data-kind="authentication"\]\))?\s*\{/.exec(cleanerStyles);
assert.ok(rule, "The rule that suppresses the Cleaner dashboard gate above a working calendar has been rewritten. Whatever replaced it must still keep access refusals visible.");
assert.ok(
  rule[1],
  'The activity-schedule rule hides EVERY Cleaner dashboard gate state again, including the access refusals. A signed-out visitor and an account with no Cleaner workspace then get a page with no heading, no explanation and no way to sign in. It needs :not([data-kind="authentication"]).'
);

// And the refusals must actually carry that kind, or the :not() guards nothing.
const dashboardScript = read("cleaner-dashboard.js");
for (const [snippet, why] of [
  ["error.statusCode === 401", "a signed-out visitor"],
  ["error.statusCode === 403", "a forbidden account"],
  ['"different-workspace"', "an account in its other workspace"]
]) {
  assert.ok(dashboardScript.includes(snippet), `cleaner-dashboard.js no longer handles ${why}.`);
}
assert.ok(
  (dashboardScript.match(/kind: "authentication"/g) || []).length >= 4,
  'Fewer than four Cleaner dashboard gate states are marked kind: "authentication". Any access refusal that loses that kind becomes invisible above a working calendar.'
);

console.log(`Cleaner dashboard hook tests passed: no Cleaner page dereferences a hook the product does not create (${provided.size} hooks provided), and an access refusal stays visible above the activity schedule while a connection failure may hide behind it.`);
