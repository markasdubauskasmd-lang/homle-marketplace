import { readFile } from "node:fs/promises";
import { homeEntryMode, homeEntryPresentation } from "../public/home-entry-model.js";

function assert(condition, message) { if (!condition) throw new Error(message); }

const readyHealth = { ok: true, service: "tideway-marketplace", marketplace: { enabled: true, ready: true, authenticationReady: true } };
assert(homeEntryMode(readyHealth) === "account", "A fully attached marketplace does not open account-first booking.");
const authenticationHealth = { ...readyHealth, marketplace: { enabled: false, ready: false, authenticationReady: true } };
assert(homeEntryMode(authenticationHealth) === "authentication", "A verified account-only service did not expose its sign-in entry.");
for (const unsafe of [null, {}, { ...readyHealth, marketplace: { ...readyHealth.marketplace, authenticationReady: false } }]) {
  assert(homeEntryMode(unsafe) === "concierge", "An incomplete or untrusted health response exposed disabled marketplace entry.");
}
const account = homeEntryPresentation("account");
const authentication = homeEntryPresentation("authentication");
const concierge = homeEntryPresentation("concierge");
assert(account.bookingPath === "/signup?intent=book" && account.cleanerPath === "/signup?intent=work" && account.directoryPath === "/cleaners" && account.accountAccess === true, "Ready account entry lost its role-aware direct routes.");
assert(authentication.bookingPath === "/signup?intent=book" && authentication.cleanerPath === "/signup?intent=work" && authentication.accountAccess === true && authentication.statusCopy.includes("Landlord or Cleaner profile") && authentication.statusCopy.includes("remain closed"), "Account-only mode did not open both approved profile roles or misstated booking availability.");
assert(concierge.bookingPath === "/request" && concierge.cleanerPath === "/join" && concierge.directoryPath === "/request" && concierge.accountAccess === false, "Detached mode does not fail safely into the working request and Cleaner application journeys.");
assert(concierge.statusCopy.includes("Coverage") && concierge.statusCopy.includes("price are confirmed before any booking"), "Pilot fallback copy invents availability or a confirmed booking.");

const [page, script, accountPage, pilotPage, briefPage, statusPage, directoryPage, server, packageFile] = await Promise.all([
  readFile(new URL("../public/home.html", import.meta.url), "utf8"),
  readFile(new URL("../public/home.js", import.meta.url), "utf8"),
  readFile(new URL("../public/account.html", import.meta.url), "utf8"),
  readFile(new URL("../public/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/brief.html", import.meta.url), "utf8"),
  readFile(new URL("../public/request-status.html", import.meta.url), "utf8"),
  readFile(new URL("../public/cleaners.html", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8")
]);

assert((page.match(/data-book-entry/g) || []).length >= 4 && !page.includes('href="/signup?intent=book">Book a clean</a>'), "The no-script homepage can still send visitors into disabled registration.");
assert(page.includes('href="/request" data-book-entry') && page.includes("Homle is accepting guided pilot requests") && page.includes("data-entry-status aria-live=\"polite\""), "The default guided-request route or accessible truth state is missing.");
assert(page.includes("data-account-entry hidden") && page.includes('href="/request" data-directory-entry') && (page.match(/data-cleaner-entry/g) || []).length >= 4, "Detached mode exposes unusable account entry or omits role-aware Cleaner entry.");
assert(page.includes('/account-menu.js?') && page.includes('data-account-menu hidden') && page.includes('data-account-dashboard') && page.includes('data-account-avatar') && script.includes('window.addEventListener("homle:account-ready"') && script.includes('signedInWorkspace?.role === "landlord"') && script.includes('signedInWorkspace?.role === "cleaner"'), "The real homepage cannot recognise a saved session, show the provider photo or reopen the exact active role dashboard without another sign-in.");
assert(script.includes('signedInWorkspace?.role === "landlord" ? "/landlord/book"'), "A signed-in Landlord still detours through the management dashboard instead of opening the guided booking journey.");
assert(script.includes('fetch("/api/health"') && script.includes('credentials: "omit"') && script.includes('cache: "no-store"') && script.includes('applyEntryMode("concierge")'), "Capability discovery is not public, non-cacheable and fail-closed.");
assert(script.includes("homeEntryMode(health)") && script.includes("presentation.directoryPath") && script.includes("textContent") && !script.includes("innerHTML") && !script.includes("/api/cleaning-requests"), "Homepage upgrade uses unsafe rendering, conflates Cleaner onboarding with directory search or pulls intake behavior into the lightweight page.");
assert(accountPage.includes('href="/request">Request a clean</a>') && briefPage.includes('href="/request">Start a cleaning request</a>') && statusPage.includes('href="/request">Start a new cleaning request</a>') && directoryPage.includes('href="/request">Request a clean</a>'), "A detached account, scan, tracker or directory recovery path still enters unavailable registration.");
assert(accountPage.includes("data-account-ready") && accountPage.includes("data-account-ready-logout") && server.includes('"/account-ready": "account.html"') && server.includes('requestUrl.pathname === "/api/marketplace/account"') && server.includes('requestUrl.pathname === "/api/marketplace/onboarding"'), "Authentication-only onboarding has no verified completion page or the server does not forward its account/onboarding endpoints.");
assert((pilotPage.match(/href="\/request#request-cleaning"/g) || []).length >= 4 && !pilotPage.includes('href="/signup?intent=book"'), "The guided pilot page reloads or leaves its working request form for disabled registration.");
assert(pilotPage.includes('/account-menu.js?') && pilotPage.includes('data-account-sign-in') && pilotPage.includes('data-account-menu hidden') && pilotPage.includes('data-account-dashboard') && pilotPage.includes('data-account-avatar'), "The public Homle page cannot recognise a saved signed-in session, show the provider photo or reopen the correct dashboard.");
assert(server.includes('requestUrl.pathname === "/api/health"') && server.includes("authenticationReady: accountAttachment.authenticationHttpReady"), "Homepage capability mode is not backed by the public health contract.");
assert(packageFile.includes("tests/home-entry-ui.mjs"), "Capability-aware homepage verification is not part of the project gate.");

console.log("Homepage entry tests passed: working concierge fallback, approved-tester sign-in, full marketplace upgrade, honest copy, no-script safety and lightweight rendering.");
