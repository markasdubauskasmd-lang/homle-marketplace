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
assert(page.includes("data-directory-primary") && page.includes("data-directory-advanced") && page.includes("More filters") && page.indexOf('name="serviceCode"') < page.indexOf("data-directory-advanced") && script.includes('accountEntryPath("book", cleaner.cleanerId)') && script.includes('"button directory-cleaner-action"') && script.includes('aria-label'), "The directory still exposes every optional decision at once, buries the booking action or loses the selected Cleaner before account creation.");
assert(script.includes('privateRequestJson("/api/marketplace/account"') && script.includes('privateRequestJson("/api/marketplace/landlord/favourite-cleaners"') && script.includes('/api/marketplace/landlord/favourite-cleaners/${encodeURIComponent(cleanerId)}') && script.includes('"X-CSRF-Token": csrf') && script.includes('credentials: "same-origin"') && script.includes('aria-pressed') && script.includes('No change will be retried automatically') && script.includes('await readFavouriteCleanerIds()') && styles.includes('.directory-favourite-button.is-saved'), "The directory cannot privately save a Cleaner for the active Landlord with role checks, CSRF protection, accessible state and uncertainty reconciliation.");
assert(script.includes('No public profiles match these filters') && script.includes('Cleaner accounts are not open yet') && script.includes('No completed-job reviews yet') && script.includes('Requesting a Cleaner does not confirm a booking'), "The directory lacks honest empty, unavailable, new-profile or booking-boundary language.");
assert(page.includes('data-state-action hidden') && page.includes('href="/request"') && script.includes('stateAction.hidden = !actionLabel') && script.includes('"Request a clean instead"') && script.includes('"Request guided matching"'), "Unavailable, empty and interrupted Cleaner searches do not offer the working guided-request fallback.");
assert(!/(Jane|Sarah|Maria|John|five-star|fully insured|background checked|DBS checked|thousands of)/i.test(`${page}\n${script}`), "The real directory contains an invented person or unsupported business claim.");
assert(styles.includes('.cleaner-directory-page') && styles.includes('.directory-advanced-filters') && styles.includes('.directory-cleaner-action') && styles.includes('.directory-cleaner-actions') && styles.includes('@media (max-width: 680px)') && page.includes('aria-live="polite"') && page.includes('Skip to Cleaner search'), "The directory is missing responsive, one-action or accessible presentation.");

// Written reviews were collected, moderated and never shown. Trust in a
// marketplace depends on customers actually being able to read them.
assert(script.includes("function reviewsSection(cleaner)") && script.includes("/reviews`") && script.includes("function reviewEntry(review)") && styles.includes(".directory-review-body"), "A customer cannot read the moderated written reviews for a profile.");
assert(script.includes('details.addEventListener("toggle"') && script.includes("if (loaded) return;"), "Reviews are not loaded lazily per expanded profile, so the directory would issue a request for every Cleaner it lists.");
// A reply is written after the review passed moderation and is screened only
// for contact details, so publishing it could still name the customer.
assert(!script.includes("review.cleanerResponse") && !script.includes("Cleaner replied"), "An unmoderated Cleaner reply is published publicly, where it could still identify the customer who left the review.");
// A stalled request must be able to retry, and an unfetched later page must
// never be reported as the Cleaner having no written reviews.
assert(script.includes("AbortSignal.timeout(8000)") && script.includes("Reviews could not be loaded right now") && script.includes("loaded = false;"), "A stalled review request cannot time out and retry, leaving the panel loading forever.");
assert(!script.includes("has ratings but no written reviews yet") && script.includes("No published reviews yet."), "The review panel claims a Cleaner has no written reviews without having paged through the reviews that exist.");

console.log("Cleaner directory UI tests passed: two-field primary search, optional filter disclosure, selected-Cleaner account handoff, safe API rendering and mobile accessibility.");
