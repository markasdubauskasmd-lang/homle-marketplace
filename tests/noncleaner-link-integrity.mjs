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
const adminPrivateNavigation = await readFile(path.join(publicDirectory, "admin-private-navigation.js"), "utf8");
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
  assert(source.includes("data-admin-private-navigation hidden") && /data-admin-private-workspace[^>]*\shidden(?:\s|>)/.test(source) && source.includes('/admin-private-navigation.js?v=20260805-1'), `${page} exposes private Administrator navigation before its server-backed workspace gate succeeds.`);
}
assert(adminPrivateNavigation.includes("privateNavigation.hidden = privateWorkspace.hidden") && adminPrivateNavigation.includes('attributeFilter: ["hidden"]'), "The Administrator navigation synchronizer no longer mirrors only the authoritative private-workspace gate.");

console.log(`Non-Cleaner link integrity tests passed: ${checkedReferences} local route and asset references across ${pages.length} shipped pages resolve without entering the Cleaner workspace.`);
