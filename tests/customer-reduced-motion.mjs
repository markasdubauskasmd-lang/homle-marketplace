import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { launchBrowser, resolveChromiumPath, serveStatic } from "../tools/browser-harness.mjs";

if (!resolveChromiumPath()) {
  if (process.env.CI) throw new Error("Reduced-motion checks require Chromium in CI.");
  console.log("Reduced-motion browser check skipped without Chromium.");
  process.exit(0);
}
const documents = ["account.html", "privacy.html", "terms.html", "facebook-data-deletion.html",
  "landlord-journey.html", "landlord-help.html", "landlord-checkout.html", "room-scan.html"];
const excluded = ["landlord-dashboard.html", "cleaner-dashboard.html", "cleaner-registration.html"];
const extraFiles = {};
for (const name of [...documents, ...excluded]) {
  const source = await readFile(new URL("../public/" + name, import.meta.url), "utf8");
  const links = [...source.matchAll(/<link\b[^>]*>/g)].map(m => m[0]).filter(s => /rel="stylesheet"/.test(s)).join("\n");
  const body = source.match(/<body\b[^>]*>/)?.[0];
  assert(body, name + " has no body");
  extraFiles["/motion-" + name] = '<!doctype html><html><head><meta name="viewport" content="width=device-width">' + links +
    "</head>" + body + '<main><h1>Motion verification</h1><p>Same page stylesheet and body classes, synthetic content.</p></main></body></html>';
}
const server = await serveStatic({ extraFiles });
const browser = await launchBrowser();
const results = [];
try {
  for (const width of [390, 1280]) {
    await browser.setViewport({ width, height: 844, mobile: width === 390 });
    for (const reduce of [false, true]) {
      await browser.setReducedMotion(reduce);
      for (const name of [...documents, ...excluded]) {
        await browser.goto(server.origin + "/motion-" + name);
        const result = await browser.evaluate(`
          await document.fonts.ready;
          if (!document.startViewTransition) throw new Error("View transitions unsupported");
          const transition = document.startViewTransition(() => { document.querySelector("h1").textContent += " updated"; });
          await transition.ready;
          const old = getComputedStyle(document.documentElement, "::view-transition-old(root)").animationDuration;
          const next = getComputedStyle(document.documentElement, "::view-transition-new(root)").animationDuration;
          const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
          transition.skipTransition();
          await transition.finished;
          return { old, next, reduced };
        `);
        assert.equal(result.reduced, reduce);
        results.push({ name, width, reduce, ...result });
      }
    }
  }
  console.log(JSON.stringify(results));
  const failures = results.filter(r => r.reduce && !excluded.includes(r.name) && [r.old, r.next].some(v =>
    v.split(",").some(part => parseFloat(part) * (part.trim().endsWith("ms") ? 0.001 : 1) > 0.001)));
  assert.deepEqual(failures, [], "Reduced-motion root fades still last longer than 1ms");
  assert(results.filter(r => !r.reduce && !excluded.includes(r.name)).every(r => r.old === "0.25s" && r.next === "0.25s"),
    "Normal motion should retain the existing fade");
  for (const reduced of results.filter(r => r.reduce && excluded.includes(r.name))) {
    const normal = results.find(r => !r.reduce && r.name === reduced.name && r.width === reduced.width);
    assert.deepEqual([reduced.old, reduced.next], [normal.old, normal.next], reduced.name + " root fade changed");
  }
  assert.deepEqual(browser.pageErrors, []);
} finally { await browser.close(); await server.close(); }
console.log("Customer root transitions respect reduced motion at 390/1280 with original normal-motion fades.");
