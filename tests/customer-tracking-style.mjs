import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { launchBrowser, resolveChromiumPath, serveStatic } from "../tools/browser-harness.mjs";

// Exercise actual HTTP file rendering for every alias. Booking mutations are absent.
const source = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const html = await readFile(new URL("../public/active-job.html", import.meta.url), "utf8");
const start = source.indexOf("async function serveFile(");
const end = source.indexOf("\nasync function handleHttpRequest(", start);
assert(start >= 0 && end > start);
const publicDir = path.resolve("public");
const render = vm.runInNewContext(source.slice(start, end) + "\nserveFile", {
  path, publicDir, Buffer, stat: async () => ({ isFile: () => true }),
  readFile: async () => Buffer.from(html), mimeTypes: { ".html": "text/html" },
  immutableStaticAssets: new Set()
});
const id = "55555555-5555-4555-8555-555555555555";
let served;
for (const route of ["/bookings/" + id, "/bookings/" + id + "/tracking", "/bookings/" + id + "/cleaning-progress", "/active-job.html"]) {
  let body;
  assert(await render(route, { writeHead() {}, end(value) { body = value.toString(); } }));
  assert.equal((body.match(/customer-active-job.css/g) || []).length, 1, route);
  served = body;
}
for (const route of ["/cleaner/dashboard", "/cleaner/onboarding", "/landlord/home"]) {
  let body;
  await render(route, { writeHead() {}, end(value) { body = value.toString(); } });
  assert(!body.includes("customer-active-job.css"), route + " must not load tracking styles");
}
if (!resolveChromiumPath()) {
  if (process.env.CI) throw new Error("Customer tracking style verification requires Chromium in CI.");
  console.log("Customer tracking route checks passed; browser checks skipped without Chromium.");
  process.exit(0);
}
const fixture = served.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "") +
  "<style>*,*::before,*::after { animation: none !important; transition: none !important; }</style>";
const server = await serveStatic({ extraFiles: { "/tracking-style-fixture": fixture } });
const browser = await launchBrowser();
const snapshot = [
  'await document.fonts.ready;',
  'await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));',
  'return [...document.querySelectorAll("body,body *")].map(el =>',
  '["", "::before", "::after"].map(pseudo => {',
  'const css = getComputedStyle(el, pseudo || null);',
  'return Object.fromEntries([...css].map(key => [key, css.getPropertyValue(key)]));',
  '}));'
].join("\n");
try {
  for (const width of [390, 1280]) {
    await browser.setViewport({ width, height: 844, mobile: width < 700 });
    await browser.goto(server.origin + "/tracking-style-fixture");
    const loaded = await browser.evaluate([
      'const link = document.querySelector(\'link[href*="customer-active-job.css"]\');',
      'const deadline = Date.now() + 10000;',
      'while (!link.sheet) { if (Date.now() > deadline) return false; await new Promise(r => setTimeout(r, 50)); }',
      'return link.sheet.cssRules.length > 0;'
    ].join("\n"));
    assert(loaded, "Customer stylesheet failed to load");
    await browser.evaluate([
      'document.querySelector("[data-job-workspace]").hidden = false;',
      'document.querySelector("[data-job-gate]").hidden = true;',
      'document.querySelector("[data-status-heading]").textContent = "Cleaning in progress";',
      'document.querySelector("[data-booking-reference]").textContent = "55555555";',
      'document.querySelector("[data-stage=confirmed]").className = "complete";',
      'document.querySelector("[data-stage=cleaning-in-progress]").className = "current";',
      'document.querySelector("[data-review-card]").hidden = false;',
      'document.querySelector("[data-review-form]").hidden = false;',
      'return true;'
    ].join("\n"));
    for (const href of ["/login", "/cleaner/dashboard", "/landlord/dashboard"]) {
      await browser.evaluate('document.querySelector("[data-workspace-link]").setAttribute("href",' + JSON.stringify(href) + '); return true;');
      await browser.evaluate('document.querySelector(\'link[href*="customer-active-job.css"]\').sheet.disabled = true; return true;');
      const before = await browser.evaluate(snapshot);
      await browser.evaluate('document.querySelector(\'link[href*="customer-active-job.css"]\').sheet.disabled = false; return true;');
      const after = await browser.evaluate(snapshot);
      if (href !== "/landlord/dashboard") {
        assert(JSON.stringify(after) === JSON.stringify(before), href + " computed styles changed at " + width);
      } else {
        assert(JSON.stringify(after) !== JSON.stringify(before), "Customer styling did not apply");
        const result = await browser.evaluate([
          'const style = selector => getComputedStyle(document.querySelector(selector));',
          'return { canvas: style("body").backgroundColor, font: style("h1").fontFamily,',
          'title: style("h1").fontSize, card: style(".active-journey-card").borderRadius,',
          'primary: style(".button").backgroundColor,',
          'overflow: document.documentElement.scrollWidth > innerWidth + 1 };'
        ].join("\n"));
        assert.equal(result.canvas, "rgb(247, 246, 245)");
        assert(result.font.includes("DM Sans"));
        assert.equal(result.title, width < 700 ? "26px" : "30px");
        assert.equal(result.card, "16px");
        assert.equal(result.primary, "rgb(225, 27, 34)");
        assert(!result.overflow, "Customer tracking overflows at " + width);
        const dialog = await browser.evaluate([
          'const dialog = document.querySelector(".active-job-dialog");',
          'dialog.showModal();',
          'const fits = dialog.getBoundingClientRect().width <= innerWidth;',
          'dialog.close(); return fits && !dialog.open;'
        ].join("\n"));
        assert(dialog, "Tracking dialog failed to fit/open/close");
      }
    }
  }
} finally {
  await browser.close();
  await server.close();
}
console.log("Customer tracking: all route aliases, 390/1280 layout, dialog and exact Cleaner/signed-out computed-style isolation passed.");
