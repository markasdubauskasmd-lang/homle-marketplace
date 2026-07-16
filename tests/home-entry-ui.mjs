import { readFile } from "node:fs/promises";
import { homeEntryMode, homeEntryPresentation } from "../public/home-entry-model.js";

function assert(condition, message) { if (!condition) throw new Error(message); }

const readyHealth = { ok: true, service: "tideway-marketplace", marketplace: { enabled: true, ready: true, authenticationReady: true } };
assert(homeEntryMode(readyHealth) === "account", "A fully attached marketplace does not open account-first booking.");
for (const unsafe of [null, {}, { ...readyHealth, marketplace: { ...readyHealth.marketplace, enabled: false } }, { ...readyHealth, marketplace: { ...readyHealth.marketplace, ready: false } }, { ...readyHealth, marketplace: { ...readyHealth.marketplace, authenticationReady: false } }]) {
  assert(homeEntryMode(unsafe) === "concierge", "An incomplete or untrusted health response exposed disabled marketplace entry.");
}
const account = homeEntryPresentation("account");
const concierge = homeEntryPresentation("concierge");
assert(account.bookingPath === "/signup?intent=book" && account.cleanerPath === "/cleaners" && account.accountAccess === true, "Ready account entry lost its direct routes.");
assert(concierge.bookingPath === "/request" && concierge.cleanerPath === "/request" && concierge.accountAccess === false, "Detached mode does not fail safely into the working request journey.");
assert(concierge.statusCopy.includes("Coverage") && concierge.statusCopy.includes("price are confirmed before any booking"), "Pilot fallback copy invents availability or a confirmed booking.");

const [page, script, server, packageFile] = await Promise.all([
  readFile(new URL("../public/home.html", import.meta.url), "utf8"),
  readFile(new URL("../public/home.js", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8")
]);

assert((page.match(/data-book-entry/g) || []).length >= 4 && !page.includes('href="/signup?intent=book">Book a clean</a>'), "The no-script homepage can still send visitors into disabled registration.");
assert(page.includes('href="/request" data-book-entry') && page.includes("Homle is accepting guided pilot requests") && page.includes("data-entry-status aria-live=\"polite\""), "The default guided-request route or accessible truth state is missing.");
assert(page.includes("data-account-entry hidden") && page.includes('href="/request" data-cleaner-entry'), "Detached mode exposes unusable account or directory entry.");
assert(script.includes('fetch("/api/health"') && script.includes('credentials: "omit"') && script.includes('cache: "no-store"') && script.includes('applyEntryMode("concierge")'), "Capability discovery is not public, non-cacheable and fail-closed.");
assert(script.includes("homeEntryMode(health)") && script.includes("textContent") && !script.includes("innerHTML") && !script.includes("/api/cleaning-requests"), "Homepage upgrade uses unsafe rendering or pulls intake behavior into the lightweight page.");
assert(server.includes('requestUrl.pathname === "/api/health"') && server.includes("authenticationReady: marketplaceAttachment.authenticationHttpReady"), "Homepage capability mode is not backed by the public health contract.");
assert(packageFile.includes("tests/home-entry-ui.mjs"), "Capability-aware homepage verification is not part of the project gate.");

console.log("Homepage entry tests passed: working concierge fallback, verified account upgrade, honest copy, no-script safety and lightweight rendering.");
