import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { launchBrowser, resolveChromiumPath, serveStatic } from "../tools/browser-harness.mjs";
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
  ["/api/marketplace/bookings/" + id + "/messages"]: JSON.stringify({ ok: true, messages: [], hasMore: false }),
  ["/api/marketplace/bookings/" + id + "/dispute"]: JSON.stringify({ ok: true, dispute: null }),
  ["/api/marketplace/bookings/" + id + "/events"]: () => ({ status: 204, body: "" })
};
const server = await serveStatic({ extraFiles });
const browser = await launchBrowser();
const rows = [];
async function waitFor(expression) {
  const deadline = Date.now() + 12000;
  while (!(await browser.evaluate(expression))) {
    if (Date.now() > deadline) throw new Error("Renderer not ready: " + expression);
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
}
try {
  for (const width of [390, 1280]) {
    await browser.setViewport({ width, height: 844, mobile: width === 390 });
    for (const reduce of [false, true]) {
      await browser.setReducedMotion(reduce);
      role = "landlord";
      for (const view of views) {
        await browser.goto(server.origin + "/landlord/" + view);
        await waitFor('location.pathname === ' + JSON.stringify("/landlord/" + view) +
          ' && document.querySelector("[data-landlord-panel=home]")?.hidden === ' + (view !== "home") +
          ' && document.querySelector("[data-landlord-workspace]")?.hidden !== true');
        await measure(view, width, reduce);
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
