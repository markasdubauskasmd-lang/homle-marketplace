import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  chromiumExecutableCandidates,
  launchBrowser,
  resolveChromiumPath,
  serveStatic
} from "../tools/browser-harness.mjs";
import { defaultPricingConfig } from "../public/pricing-config.js";
import { quoteRooms } from "../public/pricing-engine.js";
import { roomsFor } from "../public/quick-quote.js";

// Day 2 (DECISIONS D29): a visitor gets a price from the landing page in
// three answers, before any account. Proven in a real browser against stubs
// that run the real pricing engine, so the number on screen is the number the
// engine produces for exactly what the page sent.

const home = readFileSync(new URL("../public/home.html", import.meta.url), "utf8");
const section = home.match(/<section class="hs-quote" id="quote"[\s\S]*?<\/section>/)?.[0];
assert(section, "The landing page has no get-a-price section.");
assert(home.indexOf('id="quote"') < home.indexOf('data-stage="scan"'), "The price form comes after the scanner; the brief puts the price first.");
assert(/<a class="ci-btn-primary" href="#quote"[^>]*>Get a price<\/a>/.test(home), "The hero's main button does not lead to the price form.");
assert(home.includes('href="/landlord/book">Scan your home</a>'), "The scanner is no longer offered from the hero.");
for (const name of ["postcode", "serviceType", "bedrooms", "bathrooms", "livingRooms"]) {
  assert(section.includes(`name="${name}"`), `The price form lost its ${name} field.`);
}
assert(!/no account (required|needed)|vetted|insured|DBS|star rating|rated \d|\d+\+? (reviews|cleans|customers)|trusted by/i.test(section), "The price section makes a claim Homle cannot back.");
const more = home.match(/<section class="hs-more"[\s\S]*?<\/section>/)?.[0];
assert(more && more.includes('href="/for-landlords"'), "The landing page lost its landlords section.");
assert((more.match(/<details>/g) || []).length >= 5, "The landing page lost its plain-English questions.");
assert(!/vetted|insured|DBS|guarantee|star rating|\d+\+? (reviews|cleans|customers)|trusted by/i.test(more), "An answer on the landing page makes a claim Homle cannot back.");
assert(home.indexOf('class="hs-more"') < home.indexOf('data-stage="join"'), "The questions come after the closing call to action.");
assert.equal(roomsFor({ bedrooms: 2, bathrooms: 1, livingRooms: 0 }).map((room) => room.roomType).join(","), "kitchen,bedroom,bedroom,bathroom");

const chromiumPath = resolveChromiumPath();
if (!chromiumPath) {
  console.log(`Browser quick-quote checks SKIPPED: no Chromium executable found. Checked ${chromiumExecutableCandidates().join(", ")}.`);
  process.exit(0);
}

const sent = { quotes: [], coverage: [], interest: [] };
const server = await serveStatic({
  extraFiles: {
    "/api/public/pricing": () => ({ body: { ok: true, config: defaultPricingConfig } }),
    "/api/public/quote": ({ body }) => {
      const request = JSON.parse(body);
      sent.quotes.push(request);
      return { body: { ok: true, estimate: true, quote: quoteRooms(request, defaultPricingConfig), note: "An estimate from Homle's standard price list." } };
    },
    "/api/public/coverage": ({ url }) => {
      const postcode = url.searchParams.get("postcode");
      sent.coverage.push(postcode);
      const area = postcode.toUpperCase().replace(/\s+/g, "").slice(0, -3);
      return { body: { ok: true, covered: area === "SW1A", area } };
    },
    "/api/public/launch-interest": ({ body }) => { sent.interest.push(JSON.parse(body)); return { status: 202, body: { ok: true } }; },
    "/api/health": () => ({ status: 404, body: {} })
  }
});
const browser = await launchBrowser();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(expression, label) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await browser.evaluate(expression)) return;
    await wait(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    await browser.setViewport(viewport);
    await browser.goto(`${server.origin}/home.html`);
    await until(`document.querySelector('[data-from-price="standard"]')?.textContent.startsWith("From £")`, "the from prices");
    const fromStandard = quoteRooms({ serviceType: "standard", rooms: roomsFor() }, defaultPricingConfig).totalPence;
    const initial = await browser.evaluate(`return (() => {
      const result = document.querySelector("[data-quote-result]");
      const controls = [...document.querySelectorAll("#quote :is(button, input:not([type=radio]):not([type=checkbox]), .hs-choice > span)")]
        .filter((element) => element.getClientRects().length)
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.height < 44 || rect.width < 44).length;
      return { resultShown: getComputedStyle(result).display !== "none", from: document.querySelector('[data-from-price="standard"]').textContent, smallControls: controls };
    })()`);
    assert.equal(initial.resultShown, false, `${viewport.width}px: an empty estimate shows before the visitor has asked.`);
    assert(initial.from.includes((fromStandard / 100).toFixed(2).replace(/\.00$/, "")), `${viewport.width}px: the from price ${initial.from} is not the engine's ${fromStandard}p.`);
    assert.equal(initial.smallControls, 0, `${viewport.width}px: a price-form control is under 44px.`);

    // A wrong postcode is caught on the page, before any request.
    const before = sent.quotes.length;
    await browser.evaluate(`return (() => { const form = document.querySelector("[data-quote-form]"); form.elements.postcode.value = "hello"; form.requestSubmit(); })()`);
    await until(`!document.querySelector("[data-quote-error]").hidden`, "the postcode error");
    assert.equal(await browser.evaluate(`document.querySelector("#quote-postcode").getAttribute("aria-invalid")`), "true");
    assert.equal(sent.quotes.length, before, "An invalid postcode still asked for a quote.");

    // Covered: a deep clean, two bedrooms, priced exactly as the engine prices it.
    await browser.evaluate(`return (() => {
      const form = document.querySelector("[data-quote-form]");
      form.elements.postcode.value = "sw1a 1aa";
      form.querySelector('input[value="deep"]').click();
      document.querySelector('[data-stepper]:has(#quote-bedrooms) [data-step="1"]').click();
      form.requestSubmit();
    })()`);
    await until(`!document.querySelector("[data-quote-result]").hidden && document.querySelector("[data-quote-total]").textContent`, "the estimate");
    const posted = sent.quotes.at(-1);
    assert.equal(posted.serviceType, "deep");
    assert.equal(posted.rooms.filter((room) => room.roomType === "bedroom").length, 2);
    const expected = quoteRooms(posted, defaultPricingConfig).totalPence;
    const covered = await browser.evaluate(`return (() => ({
      total: document.querySelector("[data-quote-total]").textContent,
      area: document.querySelector("[data-quote-area]").textContent,
      book: !document.querySelector("[data-quote-book]").hidden && document.querySelector("[data-quote-book]").getAttribute("href"),
      notYet: !document.querySelector("[data-quote-not-yet]").hidden,
      stored: sessionStorage.getItem("homleGuestQuoteV1"),
      overflow: document.documentElement.scrollWidth > innerWidth + 1
    }))()`);
    assert.equal(covered.total, `£${(expected / 100).toFixed(2).replace(/\.00$/, "")}`, `${viewport.width}px: the page shows ${covered.total}, the engine says ${expected}p.`);
    assert.equal(covered.book, "/signup?intent=book", "A covered estimate does not offer to book.");
    assert.equal(covered.notYet, false);
    assert(covered.area.includes("SW1A"));
    const stored = JSON.parse(covered.stored);
    assert.equal(stored.area, "SW1A");
    assert(!covered.stored.includes("1AA"), "The full postcode was kept in the browser; only the area is needed.");
    assert.equal(covered.overflow, false, `${viewport.width}px: the estimate overflows the page.`);

    // Not covered: no booking button, an honest "not yet", and a sign-up that
    // sends nothing without the box ticked.
    await browser.evaluate(`return (() => { const form = document.querySelector("[data-quote-form]"); form.elements.postcode.value = "ZE9 1AA"; form.requestSubmit(); })()`);
    await until(`!document.querySelector("[data-quote-not-yet]").hidden`, "the not-yet message");
    const notCovered = await browser.evaluate(`return (() => ({
      book: !document.querySelector("[data-quote-book]").hidden,
      area: document.querySelector("[data-quote-area]").textContent,
      overflow: document.documentElement.scrollWidth > innerWidth + 1
    }))()`);
    assert.equal(notCovered.book, false, "Booking was offered where Homle has no Cleaner.");
    assert(/do not have a Cleaner in ZE9 yet/.test(notCovered.area), notCovered.area);
    assert.equal(notCovered.overflow, false, `${viewport.width}px: the not-yet form overflows the page.`);
    const interestBefore = sent.interest.length;
    await browser.evaluate(`return (() => { const form = document.querySelector("[data-interest-form]"); form.elements.email.value = "visitor@example.invalid"; form.requestSubmit(); })()`);
    await wait(300);
    assert.equal(sent.interest.length, interestBefore, "Launch news was requested without consent.");
    await browser.evaluate(`return (() => { const form = document.querySelector("[data-interest-form]"); form.elements.consent.checked = true; form.requestSubmit(); })()`);
    await until(`document.querySelector("[data-interest-status]").textContent.startsWith("Thanks")`, "the sign-up confirmation");
    assert.deepEqual(sent.interest.at(-1), { postcode: "ZE9 1AA", email: "visitor@example.invalid", consent: true });
  }
  console.log("Landing quick quote passed at 390/1280: engine-exact estimate and from prices, postcode caught before any request, booking offered only where covered, consent-gated launch news, area-only memory, 44px controls, no overflow.");
} finally {
  await browser.close();
  await server.close();
}
