import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Day 1a: the shared header and footer on the public document pages are built
// from the hs-* component system. These guard the pieces that fail silently:
// an undefined token, an icon id that is not in the sprite, a sheet loaded in
// an order where older rules win, and a menu toggle nobody can operate.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const tokens = read("public/homle-tokens.css");
const ui = read("public/homle-ui.css");
const sprite = read("public/icons.svg");
const toggleScript = read("public/site-header.js");

const defined = new Set([...tokens.matchAll(/(--hs-[a-z0-9-]+)\s*:/g)].map((match) => match[1]));
const used = new Set([...ui.matchAll(/var\((--hs-[a-z0-9-]+)/g)].map((match) => match[1]));
assert.deepEqual([...used].filter((name) => !defined.has(name)), [], "homle-ui.css reads hs tokens that homle-tokens.css does not define.");

const symbols = new Set([...sprite.matchAll(/<symbol id="([a-z0-9-]+)"/g)].map((match) => match[1]));
assert(symbols.size >= 20, "The icon sprite lost its symbols.");

const pages = ["for-landlords.html", "for-cleaners.html", "how-homle-works.html", "service-regular-clean.html", "service-deep-clean.html", "service-end-of-tenancy.html", "service-rental-turnover.html", "cookies.html", "privacy.html", "terms.html"];
for (const page of pages) {
  const html = read(`public/${page}`);
  const head = html.slice(0, html.indexOf("</head>"));
  const sheets = [...head.matchAll(/<link rel="stylesheet" href="([^"?]+)/g)].map((match) => match[1]);
  assert.equal(sheets.at(-1), "/homle-ui.css", `${page} does not load the component sheet last, so older rules restyle the header.`);
  assert(sheets.indexOf("/homle-tokens.css") > -1, `${page} does not load the tokens the components read.`);
  assert(!html.includes("legal-header") && !html.includes("legal-footer"), `${page} still carries the old header or footer.`);

  const header = html.match(/<header class="hs-site-header" data-site-header>[\s\S]*?<\/header>/)?.[0];
  const footer = html.match(/<footer class="hs-site-footer">[\s\S]*?<\/footer>/)?.[0];
  assert(header && footer, `${page} is missing the shared header or footer.`);
  assert.equal(html.match(/data-site-header/g).length, 1, `${page} has more than one site header.`);
  assert(header.includes('aria-expanded="false"') && header.includes('aria-controls="site-nav"') && header.includes('id="site-nav"'), `${page}'s menu button does not name what it opens.`);
  assert(header.includes('aria-label="Main"'), `${page}'s main navigation has no accessible name.`);
  assert(html.includes('<script src="/site-header.js'), `${page} cannot open its menu on a phone.`);
  for (const href of ["/privacy", "/terms", "/cookies", "/landlord/help"]) {
    assert(footer.includes(`href="${href}"`), `${page}'s footer lost the ${href} link.`);
  }
  for (const [, id] of `${header}${footer}`.matchAll(/icons\.svg#([a-z0-9-]+)/g)) {
    assert(symbols.has(id), `${page} uses icon "${id}", which is not in icons.svg.`);
  }
  for (const svg of `${header}${footer}`.match(/<svg[^>]*>/g) ?? []) {
    assert(svg.includes('aria-hidden="true"'), `${page} has an icon that a screen reader would announce.`);
  }
  assert(!/\p{Extended_Pictographic}/u.test(`${header}${footer}`), `${page}'s header or footer uses an emoji instead of an icon.`);
}

const trust = read("public/how-homle-works.html");
const claims = trust.slice(0, trust.indexOf("<h2>What we do not claim</h2>"));
assert(!/insured|vetted|DBS|\d+\+? (reviews|cleans|customers)|star rating|trusted by/i.test(claims), "The trust page makes a claim before saying what Homle does not claim.");
assert(trust.includes("<h2>What we do not claim</h2>"), "The trust page lost its list of what Homle does not claim.");
assert(toggleScript.includes('setAttribute("aria-expanded"') && toggleScript.includes('"Escape"'), "The menu toggle no longer reports its state or closes on Escape.");
console.log("Shared site header and footer use defined tokens, real icons, the component sheet last, and an operable menu.");
