import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [sidebar, motion, page, registration, documents, training, contracts] = await Promise.all([
  read("public/cleaner-sidebar.js"),
  read("public/cleaner-design-preview-motion.css"),
  read("public/cleaner-page.js"),
  read("public/cleaner-registration.html"),
  read("public/cleaner-documents.html"),
  read("public/cleaner-training.html"),
  read("public/cleaner-contracts.html"),
]);

assert.match(sidebar, /prefetchOnboardingPage/, "Onboarding destinations should preload on intent");
assert.match(sidebar, /requestIdleCallback\(warmOnboardingPages/, "Touch navigation should warm every onboarding destination while idle");
assert.match(sidebar, /requestAnimationFrame\(\(\) => location\.assign\(destination\.href\)\)/, "Navigation should start on the next frame");
assert.doesNotMatch(sidebar, /setTimeout\(\(\) => location\.assign\(destination\.href\),\s*620\)/, "Navigation must not wait for the sidebar animation");

assert.match(motion, /@view-transition\s*\{\s*navigation:\s*auto;/, "Cross-document transitions should be enabled");
assert.match(motion, /view-transition-name:\s*hc-onboarding-selection/, "The selected sidebar surface should glide across pages");
assert.match(motion, /view-transition-name:\s*hc-onboarding-content/, "Page content should swap without a visible refresh");

for (const [name, html] of Object.entries({ registration, documents, training, contracts })) {
  assert.match(html, /cleaner-design-preview-motion\.css\?v=20260816-seamless-nav-1/, `${name} should load the seamless navigation styles`);
}

assert.match(page, /cleaner-sidebar\.js\?v=20260816-2/, "All onboarding pages should load the new navigation controller");

console.log("Cleaner onboarding navigation UI checks passed");
