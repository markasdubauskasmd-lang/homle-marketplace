import { readFile } from "node:fs/promises";
import { homeEntryMode, homeEntryPresentation } from "../public/home-entry-model.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const readyHealth = { ok: true, service: "tideway-marketplace", marketplace: { enabled: true, ready: true, authenticationReady: true } };
const authenticationHealth = { ...readyHealth, marketplace: { enabled: false, ready: false, authenticationReady: true } };
assert(homeEntryMode(readyHealth) === "account", "A ready marketplace does not open account-first entry.");
assert(homeEntryMode(authenticationHealth) === "authentication", "Authentication-only mode is not preserved.");
assert(homeEntryMode(null) === "concierge", "Missing health does not fail closed.");

for (const mode of ["account", "authentication", "concierge"]) {
  const presentation = homeEntryPresentation(mode);
  assert(presentation.bookingPath === "/signup?intent=book", `${mode} mode retained a deleted request page.`);
  assert(presentation.cleanerPath === "/signup?intent=work", `${mode} mode retained a deleted Cleaner application page.`);
  assert(presentation.directoryPath === "/landlord/dashboard", `${mode} mode retained the deleted Cleaner directory.`);
  assert(presentation.accountAccess === true, `${mode} mode hides the account entry needed to reach the dashboards.`);
}

const [page, script, accountPage, server, packageFile] = await Promise.all([
  readFile(new URL("../public/home.html", import.meta.url), "utf8"),
  readFile(new URL("../public/home.js", import.meta.url), "utf8"),
  readFile(new URL("../public/account.html", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8")
]);

// The cinematic design carries fewer, larger calls to action than the page it
// replaced. The one header Sign up action must expose both account intents,
// while the closing and footer actions preserve the same direct routes.
assert((page.match(/data-book-entry/g) || []).length >= 2, "Homepage lost its account-first Landlord entry points.");
assert(page.includes('href="/signup?intent=book" data-book-entry') && page.includes('href="/signup?intent=work" data-cleaner-entry'), "Homepage still points at retired pages.");
assert(!page.includes('href="/request"') && !page.includes('href="/join"') && !page.includes('href="/cleaners"'), "Homepage exposes a retired route.");
assert(page.includes('/account-menu.js?') && script.includes('window.addEventListener("homle:account-ready"'), "Homepage session recovery or account menu was removed.");
assert(page.includes('class="ci-signup-menu" data-signup-menu') && page.includes('<summary class="ci-signup">Sign up</summary>'), "The homepage lost its one-action role chooser.");
assert(page.includes('data-book-entry data-entry-label-fixed') && page.includes('data-cleaner-entry data-entry-label-fixed'), "The homepage lost a fixed-label role entry, so home.js can overwrite the CTA wording.");
assert(/>Work as a cleaner</.test(page), "The homepage no longer offers cleaners a way to sign up.");
assert(script.includes("signupMenu.open = false"), "home.js lost its dismissible role-selection menu handling.");
assert(script.includes('signedInWorkspace?.role === "landlord" ? "/landlord/book"') && script.includes('signedInWorkspace?.role === "cleaner" ? "/cleaner/dashboard"'), "Signed-in roles do not open their current workspaces.");
assert(!accountPage.includes('href="/landlord/dashboard"') && !accountPage.includes('href="/cleaner/dashboard"'), "Unsigned account entry still exposes cross-role dashboard shortcuts.");
assert(server.includes('"/landlord/dashboard": "landlord-dashboard.html"') && server.includes('"/cleaner/dashboard": "cleaner-dashboard.html"'), "Current role dashboards are not served.");
assert(packageFile.includes("tests/home-entry-ui.mjs") && packageFile.includes("tests/retired-pages.mjs"), "Dashboard-first entry verification is not part of the project gate.");

console.log("Homepage entry tests passed: every mode uses account-first role dashboards and no retired public journey.");
