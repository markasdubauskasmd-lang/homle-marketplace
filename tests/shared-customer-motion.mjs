import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { launchBrowser, resolveChromiumPath, serveStatic } from "../tools/browser-harness.mjs";

const scrollSource = await readFile(new URL("../public/landlord-dashboard.js", import.meta.url), "utf8");
let homeHidden = false, reducePreference = false;
const scrollContext = vm.createContext({
  document: { querySelector: () => ({ hidden: homeHidden }) },
  matchMedia: () => ({ matches: reducePreference })
});
vm.runInContext(scrollSource.slice(scrollSource.indexOf("function customerScrollBehavior()"), scrollSource.indexOf("function element(")), scrollContext);
for (homeHidden of [false, true]) for (reducePreference of [false, true]) {
  assert.equal(scrollContext.customerScrollBehavior(), homeHidden && reducePreference ? "instant" : "smooth");
}
const explicitScrollCalls = [...scrollSource.matchAll(/scrollIntoView\(\{ behavior: ([^,]+)/g)];
assert.equal(explicitScrollCalls.length, 12);
assert(explicitScrollCalls.every(call => call[1] === "customerScrollBehavior()"), "A dashboard scroll bypasses the current preference.");

if (!resolveChromiumPath()) {
  if (process.env.CI) throw new Error("Shared customer motion requires Chromium.");
  process.exit(0);
}
const dashboardSource = await readFile(new URL("./landlord-dashboard-render.mjs", import.meta.url), "utf8");
const fixtures = new Function(dashboardSource.slice(dashboardSource.indexOf("const PROPERTY_ID ="),
  dashboardSource.indexOf("const VIEWS =")) + "\nreturn { endpoints, account };")();
const dashboard = await readFile(new URL("../public/landlord-dashboard.html", import.meta.url), "utf8");
const tracking = (await readFile(new URL("../public/active-job.html", import.meta.url), "utf8"))
  .replace("</head>", '<link rel="stylesheet" href="/customer-active-job.css"></head>');
const views = ["home", "bookings", "properties", "messages", "account", "payments", "requests"];
const id = "55555555-5555-4555-8555-555555555555";
let role = "landlord";
const extraFiles = { ...fixtures.endpoints(),
  ...Object.fromEntries(views.map(view => ["/landlord/" + view, dashboard])),
  ["/bookings/" + id]: tracking,
  "/api/marketplace/account": () => ({ body: { ok: true, account: {
    roles: [role], selectedRole: role, displayName: "Synthetic motion participant" } } }),
  ["/api/marketplace/bookings/" + id + "/tracking"]: JSON.stringify({ ok: true, tracking: {
    bookingId: id, status: "cleaning-in-progress", sharingState: "stopped", propertyName: "Synthetic property" } }),
  ["/api/marketplace/bookings/" + id + "/cleaning-progress"]: JSON.stringify({ ok: true, progress: {
    bookingId: id, status: "cleaning-in-progress", totalTasks: 0, resolvedTasks: 0, tasks: [], photos: [] } }),
  ["/api/marketplace/bookings/" + id + "/messages"]: JSON.stringify({ ok: true, bookingId: id, messages: [], hasMore: false }),
  ["/api/marketplace/bookings/" + id + "/dispute"]: JSON.stringify({ ok: true, dispute: null }),
  ["/api/marketplace/bookings/" + id + "/events"]: () => ({ status: 204, body: "" })
};
const server = await serveStatic({ extraFiles });
const browser = await launchBrowser();
const rows = [];
const scrollRows = [];
const descendantRows = [];
async function waitFor(expression) {
  const deadline = Date.now() + 12000;
  while (!(await browser.evaluate(expression))) {
    if (Date.now() > deadline) throw new Error("Renderer not ready: " + expression + "\\n" + await browser.evaluate("document.body.innerText") + "\\n" + JSON.stringify(browser.pageErrors));
    await new Promise(r => setTimeout(r, 50));
  }
}
async function measure(name, width, reduce) {
  const result = await browser.evaluate(`
    const transition = document.startViewTransition(() => { document.body.dataset.motionProbe = String(Date.now()); });
    await transition.ready;
    const old = getComputedStyle(document.documentElement, "::view-transition-old(root)").animationDuration;
    const next = getComputedStyle(document.documentElement, "::view-transition-new(root)").animationDuration;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    transition.skipTransition(); await transition.finished;
    return { old, next, reduced, path: location.pathname };
  `);
  assert.equal(result.reduced, reduce);
  rows.push({ name, width, reduce, ...result });
  if (reduce && !["home", "tracking-cleaner"].includes(name)) {
    const descendants = await browser.evaluate(`
      const seconds = value => value.split(",").map(v => parseFloat(v) * (v.trim().endsWith("ms") ? .001 : 1));
      const findings = [];
      let inspected = 0;
      for (const el of document.querySelectorAll("body,body *")) {
        const closedDetails = el.closest("details:not([open])");
        if (closedDetails && !closedDetails.querySelector(":scope > summary")?.contains(el)) continue;
        const rect = el.getBoundingClientRect();
        if (!rect.width || !rect.height || getComputedStyle(el).visibility === "hidden") continue;
        for (const pseudo of [null,"::before","::after"]) {
          const style = getComputedStyle(el,pseudo);
          if (pseudo && ["none","normal"].includes(style.content)) continue;
          inspected++;
          const label = el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + "." + [...el.classList].join(".") + (pseudo || "");
          if (style.animationName !== "none" && seconds(style.animationDuration).some(n => n > .00001))
            findings.push({label,kind:"animation",name:style.animationName,duration:style.animationDuration});
          const properties = style.transitionProperty.split(",").map(p => p.trim());
          const durations = seconds(style.transitionDuration);
          if (properties.some((p,i) => /^(all|transform|translate|scale|rotate|width|height|top|left|right|bottom)$/.test(p) && durations[i % durations.length] > .00001))
            findings.push({label,kind:"movement transition",properties,duration:style.transitionDuration});
        }
      }
      return {inspected,findings};
    `);
    assert(descendants.inspected > 10, "Missing rendered customer content: " + name);
    descendantRows.push({name,width,...descendants});
  }

}
try {
  for (const width of [390, 768, 1280, 1440]) {
    await browser.setViewport({ width, height: width === 768 ? 1024 : width === 1440 ? 900 : 844, mobile: width === 390 });
    for (const reduce of [false, true]) {
      await browser.setReducedMotion(reduce);
      role = "landlord";
      for (const view of views) {
        await browser.goto(server.origin + "/landlord/" + view);
        await waitFor('location.pathname === ' + JSON.stringify("/landlord/" + (view === "properties" ? "bookings" : view)) +
          ' && document.querySelector("[data-landlord-panel=home]")?.hidden === ' + (view !== "home") +
          ' && document.querySelector("[data-landlord-workspace]")?.hidden !== true');
        await measure(view, width, reduce);
        if (view === "bookings") {
          await browser.evaluate('[...document.querySelectorAll(".landlord-account-menu > summary")].find(el => el.getBoundingClientRect().width > 0).click()');
          await waitFor('[...document.querySelectorAll(".landlord-account-menu[open] .account-menu-panel")].some(el => el.getBoundingClientRect().width > 0 && !el.closest("[hidden]"))');
          await measure("bookings-menu", width, reduce);
          await browser.evaluate('[...document.querySelectorAll(".landlord-account-menu > summary")].find(el => el.getBoundingClientRect().width > 0).click()');
        }

        if (view === "account") {
          const calls = await browser.evaluate(`
            const calls = [], original = Element.prototype.scrollIntoView;
            Element.prototype.scrollIntoView = function(options) { calls.push(options); };
            try { document.querySelector("[data-account-personal-toggle]").click(); }
            finally { Element.prototype.scrollIntoView = original; }
            return calls;
          `);
          scrollRows.push({width, reduce, calls});
        }
      }
      for (role of ["landlord", "cleaner"]) {
        await browser.goto(server.origin + "/bookings/" + id);
        await waitFor('document.querySelector("[data-workspace-link]")?.getAttribute("href") === ' +
          JSON.stringify("/" + role + "/dashboard") + ' && document.querySelector("[data-job-workspace]")?.hidden === false');
        await measure("tracking-" + role, width, reduce);
      }
    }
  }
  console.log(JSON.stringify(rows));
  console.log(JSON.stringify({scrollRows}));
  console.log(JSON.stringify({descendantRows}));
  assert.deepEqual(descendantRows.filter(row => row.findings.length), [], "Rendered customer descendants ignore reduced motion");
  for (const row of scrollRows) {
    assert.equal(row.calls.length, 1, "Edit profile did not scroll to its details.");
    assert.equal(row.calls[0].behavior, row.reduce ? "instant" : "smooth", "Explicit account scroll ignores reduced motion.");
    assert.equal(row.calls[0].block, "start");
  }
  const seconds = value => Number.parseFloat(value) * (value.endsWith("ms") ? .001 : 1);
  const failures = rows.filter(r => r.reduce && !["home", "tracking-cleaner"].includes(r.name)
    && [r.old, r.next].some(value => seconds(value) > .001));
  assert.deepEqual(failures, [], "Customer workspace/tracking ignores reduced motion");
  for (const row of rows.filter(r => !r.reduce || ["home", "tracking-cleaner"].includes(r.name))) {
    assert.deepEqual([row.old, row.next], ["0.25s", "0.25s"], "Protected or normal motion changed: " + row.name);
  }
  assert.deepEqual(browser.pageErrors, []);
} finally { await browser.close(); await server.close(); }
console.log("Actual workspace and tracking renderers respect customer motion preference and retain Home/Cleaner behavior.");
