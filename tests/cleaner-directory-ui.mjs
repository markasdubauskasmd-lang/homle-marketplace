import { readFile } from "node:fs/promises";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const [page, script, styles, server, home] = await Promise.all([
  readFile(new URL("../public/cleaners.html", import.meta.url), "utf8"),
  readFile(new URL("../public/cleaners.js", import.meta.url), "utf8"),
  readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8"),
  readFile(new URL("../public/index.html", import.meta.url), "utf8")
]);

assert(server.includes('"/cleaners": "cleaners.html"') && home.includes('href="/cleaners">Find a Cleaner</a>') && page.includes('data-directory-form') && page.includes('data-cleaner-results hidden'), "The public Cleaner directory route, homepage entry point or safe initial state is missing.");
assert(script.includes('/api/marketplace/cleaners?') && script.includes('cache: "no-store"') && script.includes('AbortController') && script.includes('response.status === 404 || response.status === 503'), "The directory is not connected to the real fail-closed marketplace API.");
assert(script.includes('textContent') && script.includes('replaceChildren') && !script.includes('innerHTML') && script.includes('referrerPolicy = "no-referrer"') && script.includes('parsed.protocol !== "https:" || parsed.origin !== location.origin'), "Cleaner data can enter unsafe HTML or an unsafe remote-image boundary.");
assert(page.includes('name="outwardPostcode"') && page.includes('name="serviceCode"') && page.includes('name="minimumRating"') && page.includes('name="maximumPrice"') && page.includes('name="verifiedOnly"') && page.includes('name="startTime"') && page.includes('name="endTime"'), "A required discovery filter is missing from the directory.");
assert(page.includes("data-directory-primary") && page.includes("data-directory-advanced") && page.includes("More filters") && page.indexOf('name="serviceCode"') < page.indexOf("data-directory-advanced") && script.includes('requestLink.href = "/signup?intent=book"') && script.includes('"button directory-cleaner-action"'), "The directory still exposes every optional decision at once, buries the booking action or hands users to the legacy form.");
assert(script.includes('No public profiles match these filters') && script.includes('Cleaner accounts are not open yet') && script.includes('No completed-job reviews yet') && script.includes('Requesting a Cleaner does not confirm a booking'), "The directory lacks honest empty, unavailable, new-profile or booking-boundary language.");
assert(!/(Jane|Sarah|Maria|John|five-star|fully insured|background checked|DBS checked|thousands of)/i.test(`${page}\n${script}`), "The real directory contains an invented person or unsupported business claim.");
assert(styles.includes('.cleaner-directory-page') && styles.includes('.directory-advanced-filters') && styles.includes('.directory-cleaner-action') && styles.includes('@media (max-width: 680px)') && page.includes('aria-live="polite"') && page.includes('Skip to Cleaner search'), "The directory is missing responsive, one-action or accessible presentation.");

console.log("Cleaner directory UI tests passed: two-field primary search, optional filter disclosure, direct account-first booking, safe API rendering and mobile accessibility.");
