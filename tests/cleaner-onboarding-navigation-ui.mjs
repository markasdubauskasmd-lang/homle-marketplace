import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [sidebar, motion, page, registrationJs, registration, documentsJs, documents, trainingJs, training, contractsJs, contracts] = await Promise.all([
  read("public/cleaner-sidebar.js"),
  read("public/cleaner-design-preview-motion.css"),
  read("public/cleaner-page.js"),
  read("public/cleaner-registration.js"),
  read("public/cleaner-registration.html"),
  read("public/cleaner-documents.js"),
  read("public/cleaner-documents.html"),
  read("public/cleaner-training.js"),
  read("public/cleaner-training.html"),
  read("public/cleaner-contracts.js"),
  read("public/cleaner-contracts.html"),
]);

assert.match(sidebar, /prefetchOnboardingPage/, "Onboarding destinations should preload on intent");
assert.match(sidebar, /requestIdleCallback\(warmOnboardingPages/, "Touch navigation should warm every onboarding destination while idle");
assert.match(sidebar, /requestAnimationFrame\(\(\) => location\.assign\(destination\.href\)\)/, "Navigation should start on the next frame");
assert.doesNotMatch(sidebar, /setTimeout\(\(\) => location\.assign\(destination\.href\),\s*620\)/, "Navigation must not wait for the sidebar animation");

assert.match(motion, /@view-transition\s*\{\s*navigation:\s*auto;/, "Cross-document transitions should be enabled");
assert.match(motion, /view-transition-name:\s*hc-onboarding-selection/, "The selected sidebar surface should glide across pages");
assert.match(motion, /view-transition-name:\s*hc-onboarding-content/, "Page content should swap without a visible refresh");
assert.match(motion, /right:\s*-45px[^\n]*[\s\S]*width:\s*105px/, "The active tab should extend beyond the page seam without shifting its pill");
assert.match(motion, /clip-path:\s*path\("M 105 0 V 112 C 90\.088 112 78 99\.912 78 85/, "The active tab should enter from beyond the page seam with a complete upper curve");
assert.doesNotMatch(motion, /clip-path:\s*path\("M 78 0 H 93/, "The active tab must not leave a clipped square corner above the selected step");

for (const [name, html] of Object.entries({ registration, documents, training, contracts })) {
  assert.match(html, /cleaner-design-preview-motion\.css\?v=20260816-seamless-nav-1/, `${name} should load the seamless navigation styles`);
}

assert.match(page, /cleaner-sidebar\.js\?v=20260816-2/, "All onboarding pages should load the new navigation controller");
assert.match(page, /silentInitialLoad = false/, "The access bootstrap should support an invisible initial check");
assert.match(page, /if \(!silentInitialLoad \|\| !initialLoad\)/, "The initial loading gate should be skipped only for opted-in pages");

assert.match(registrationJs, /prepareRegistrationRouteShell\(\);[\s\S]*createCleanerPage\("reg"/, "The destination shell should be revealed before the access request starts");
assert.match(registration, /<div data-registration-overview hidden>/, "The generic Complete registration overview must be hidden before the destination route is prepared");
assert.match(registrationJs, /"\/cleaner\/banking", \["\[data-banking-topbar\]", "\[data-banking\]"\]/, "Banking navigation should reveal the banking shell immediately");
assert.match(registrationJs, /\{ silentInitialLoad: true \}\);/, "Registration pages should run their first access check invisibly");

for (const [name, html] of Object.entries({ registration, documents, training, contracts })) {
  assert.match(html, /data-(?:reg|documents|training|contracts)-gate[^>]* hidden>/, `${name} should not paint the access-check message initially`);
  assert.doesNotMatch(html, /data-(?:reg|documents|training|contracts) hidden>/, `${name} should paint its page shell immediately`);
}

for (const [name, script] of Object.entries({ documents: documentsJs, training: trainingJs, contracts: contractsJs })) {
  assert.match(script, /\{ silentInitialLoad: true \}\);/, `${name} should verify access without replacing the page with a loader`);
}

console.log("Cleaner onboarding navigation UI checks passed");
