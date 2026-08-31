import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const publicDirectory = path.resolve(fileURLToPath(new URL("../public/", import.meta.url)));
const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const routes = new Set(
  [...server.matchAll(/^\s*"(?<route>\/[^"]*)":\s*"[^"]+\.html",?$/gm)]
    .map((match) => match.groups.route)
);
const pages = (await readdir(publicDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".html") && !entry.name.startsWith("cleaner-"))
  .map((entry) => entry.name)
  .sort();
const facebookDeletionPage = await readFile(path.join(publicDirectory, "facebook-data-deletion.html"), "utf8");
const adminNavigation = await readFile(path.join(publicDirectory, "admin-navigation.js"), "utf8");
const unresolved = [];
let checkedReferences = 0;

for (const page of pages) {
  const source = await readFile(path.join(publicDirectory, page), "utf8");
  for (const match of source.matchAll(/\b(?:href|src)=["'](?<target>\/[^"'?#]*)(?:[?#][^"']*)?["']/g)) {
    const target = match.groups.target;
    if (target.startsWith("/api/") || target.startsWith("/cleaner/")) continue;
    checkedReferences += 1;
    if (routes.has(target)) continue;
    const relative = target.replace(/^\/+/, "");
    const candidate = path.resolve(publicDirectory, relative);
    if (candidate !== publicDirectory && !candidate.startsWith(`${publicDirectory}${path.sep}`)) {
      unresolved.push(`${page}: ${target} escapes the public directory`);
      continue;
    }
    try {
      await access(candidate);
    } catch {
      unresolved.push(`${page}: ${target}`);
    }
  }
}

assert(pages.length >= 17, "The non-Cleaner page integrity scan stopped covering the shipped customer, Landlord, account and Administrator surfaces.");
assert(checkedReferences >= 130, "The non-Cleaner page integrity scan stopped covering the expected local routes and assets.");
assert.deepEqual(unresolved, [], `Non-Cleaner pages reference missing local routes or assets:\n${unresolved.join("\n")}`);
assert(facebookDeletionPage.includes('class="shell account-card"'), "The Facebook deletion status page lost its bounded responsive account layout.");
for (const page of [
  "admin-cases.html",
  "admin-coverage.html",
  "admin-funnel.html",
  "admin-payments.html",
  "admin-scan-pricing.html",
  "admin-scan-operations.html",
  "admin-bookings.html",
  "admin-verifications.html"
]) {
  const source = await readFile(path.join(publicDirectory, page), "utf8");
  assert(source.includes("data-admin-private-navigation hidden") && /data-admin-private-workspace[^>]*\shidden(?:\s|>)/.test(source) && source.includes('/admin-navigation.js?v=20260831-1'), `${page} exposes private Administrator navigation before its server-backed workspace gate succeeds.`);
}
// The strip answers to the role, asked directly — not to `[data-admin-private-workspace]`.
// Mirroring that element conflated "you are not an administrator" with "this
// desk's data did not load", so /admin/payments (unconfigured, 404) and
// /admin/pricing (403 on its preview call) hid the whole strip and left an
// operator on a dead screen with no way out but the URL bar.
assert(!adminNavigation.includes("container.hidden = workspace.hidden"), "The Administrator navigation mirrors the per-desk workspace gate again, so a desk whose data fails to load strands the operator with no navigation to the desks that work.");
assert(adminNavigation.includes('fetch("/api/marketplace/account"') && adminNavigation.includes("adminNavigationVerdict(result)"), "The Administrator navigation no longer verifies the Administrator role against the server before revealing eleven internal desk names.");

// The real decision, executed. A reimplementation here would prove only that
// the copy is self-consistent.
const { adminNavigationVerdict } = await import("../public/admin-navigation-decision.js");
for (const [result, expected, why] of [
  [{ failed: true }, "leave", "a request that threw"],
  [{ status: 500 }, "leave", "a 5xx"],
  [{ status: 502 }, "leave", "a bad gateway"],
  [{ status: 200, malformed: true }, "leave", "a body that could not be read"],
  [{ status: 401 }, "remove", "an unauthenticated reader"],
  [{ status: 403 }, "remove", "a forbidden reader"],
  [{ status: 200, account: { roles: ["landlord"] } }, "remove", "a Landlord"],
  [{ status: 200, account: { roles: ["cleaner", "landlord"] } }, "remove", "a dual-role non-administrator"],
  [{ status: 200, account: {} }, "remove", "an account with no roles"],
  [{ status: 200, account: { roles: "administrator" } }, "remove", "a roles field that is a string, not a list"],
  [{ status: 200, account: { roles: ["administrator"] } }, "reveal", "an administrator"],
  [{ status: 200, account: { roles: ["landlord", "administrator"] } }, "reveal", "an administrator who is also a Landlord"]
]) {
  assert(adminNavigationVerdict(result) === expected, `The Administrator navigation answers "${adminNavigationVerdict(result)}" for ${why}; it must answer "${expected}".`);
}

// One list for eleven desks. They each hard-coded their own and had drifted
// into nine shapes, between three and seven destinations, with
// /admin/scan-operations reachable only by typing the URL.
const adminDesks = [...adminNavigation.matchAll(/\{ href: "(\/admin[^"]*)", label: "([^"]+)" \}/g)].map((m) => m[1]);
assert(adminDesks.length === 11, `The shared Administrator navigation lists ${adminDesks.length} desks; there are eleven admin routes.`);
for (const desk of ["/admin", "/admin/bookings", "/admin/cases", "/admin/support", "/admin/verifications", "/admin/coverage", "/admin/funnel", "/admin/payments", "/admin/pricing", "/admin/scan-pricing", "/admin/scan-operations"]) {
  assert(adminDesks.includes(desk), `The shared Administrator navigation omits ${desk}, so it is reachable only by typing the URL.`);
}
// `/admin` is a prefix of every other desk, so a startsWith test would mark the
// control desk current on all eleven.
assert(adminNavigation.includes("destination.href === currentPath"), "The Administrator navigation matches the current desk by prefix, which marks the control desk current everywhere.");

console.log(`Non-Cleaner link integrity tests passed: ${checkedReferences} local route and asset references across ${pages.length} shipped pages resolve without entering the Cleaner workspace.`);
