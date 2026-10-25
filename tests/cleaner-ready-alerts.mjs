import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Day 4: the Cleaner dashboard names everything that stops requests reaching
// a Cleaner, the same things the matcher checks: a complete profile, a live
// (approved) profile, future availability, and payouts. Runs the real
// renderAlerts from cleaner-dashboard.js.
const source = readFileSync(new URL("../public/cleaner-dashboard.js", import.meta.url), "utf8");
const renderer = source.slice(source.indexOf("function renderAlerts("), source.indexOf("function renderMessages("));
assert(renderer.startsWith("function renderAlerts("), "renderAlerts moved.");

function alertsFor(summary, pending = 0) {
  let rows = [];
  const element = (tag, className = "", text = "") => {
    const node = { tag, className, text, children: [], href: "", append(...items) { this.children.push(...items); } };
    return node;
  };
  const host = { replaceChildren: (...items) => { rows = items; } };
  const context = { element, document: { querySelector: () => host } };
  vm.runInNewContext(`${renderer}\nrenderAlerts(summary, buckets);`, Object.assign(context, { summary, buckets: { pending: Array.from({ length: pending }) } }));
  return rows.map((row) => {
    const body = row.children.find((child) => child.className === "hc-alert-body");
    const link = row.children.find((child) => child.tag === "a");
    return { tone: row.className.replace("hc-alert hc-alert-", ""), title: body.children[0].text, href: link?.href || "" };
  });
}
const ready = { profileCompletionPercent: 100, profilePublished: true, availableWindowCount: 2, payoutState: "ready" };

const waiting = alertsFor({ ...ready, profilePublished: false });
assert(waiting.some((alert) => /approve your profile/.test(alert.title) && alert.href === "/cleaner/profile/preview"), "A complete but unapproved profile is not explained.");
assert(!waiting.some((alert) => /Nothing needs your attention/.test(alert.title)), "An unapproved profile was told it is ready for requests.");
assert(!alertsFor({ ...ready, profileCompletionPercent: 80, profilePublished: false }).some((alert) => /approve/.test(alert.title)), "An incomplete profile was told it only needs approval.");
assert(alertsFor({ ...ready, profileCompletionPercent: 80 }).some((alert) => /registration is not complete/.test(alert.title)));
assert(alertsFor({ ...ready, availableWindowCount: 0 }).some((alert) => /No future availability/.test(alert.title)));
assert(alertsFor({ ...ready, payoutState: "not-started" }).some((alert) => /Payout account not set up/.test(alert.title)));
const allClear = alertsFor(ready);
assert(allClear.some((alert) => /public profile is live/.test(alert.title)) && !allClear.some((alert) => alert.tone !== "green"), "A ready Cleaner was shown a problem.");
console.log("Cleaner readiness alerts passed: incomplete, awaiting approval, no availability and no payouts each named; a ready Cleaner sees only green.");
