import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";

function assert(condition, message) { if (!condition) throw new Error(message); }

const publicRoot = new URL("../public/", import.meta.url);
const publicFiles = (await readdir(publicRoot, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && /\.(?:html|js|svg|webmanifest)$/.test(entry.name))
  .map((entry) => entry.name);
const visibleOldBrand = /(?<![A-Za-z0-9_-])Tideway(?![A-Za-z0-9_-])/;
const sharedStyleAsset = '/styles.css?v=20260723-1';

for (const name of publicFiles) {
  const source = await readFile(new URL(name, publicRoot), "utf8");
  assert(!visibleOldBrand.test(source), `Public asset ${name} still exposes the old Tideway brand.`);
  if (name.endsWith(".html")) {
    assert(!source.includes('/favicon.svg'), `Public page ${name} still references the removed fallback favicon instead of the approved Homle logo.`);
    assert(source.includes('<link rel="icon" href="/homle-logo.png" type="image/png">'), `Public page ${name} omitted the exact approved Homle tab icon.`);
    assert(source.includes(sharedStyleAsset), `Public page ${name} does not load the current shared design and animation asset.`);
  }
}

const [home, account, landlordDashboard, cleanerDashboard, landlordJourney, roomScan, activeJob, logo, manifest, server, emailWorker] = await Promise.all([
  readFile(new URL("../public/home.html", import.meta.url), "utf8"),
  readFile(new URL("../public/account.html", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-dashboard.html", import.meta.url), "utf8"),
  readFile(new URL("../public/cleaner-dashboard.html", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-journey.html", import.meta.url), "utf8"),
  readFile(new URL("../public/room-scan.html", import.meta.url), "utf8"),
  readFile(new URL("../public/active-job.html", import.meta.url), "utf8"),
  readFile(new URL("../public/homle-logo.png", import.meta.url)),
  readFile(new URL("../public/site.webmanifest", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/marketplace/email-notification-worker.mjs", import.meta.url), "utf8")
]);

assert(home.includes("Homle") && account.includes("Homle") && home.includes('/homle-logo.png') && account.includes('/homle-logo.png'), "The homepage or account entry does not use the Homle public brand and approved logo.");
assert([landlordJourney, roomScan].every((page) => page.includes('<link rel="icon" href="/homle-logo.png" type="image/png">')), "The guided booking or scanner surface does not use the exact approved Homle tab icon.");
assert(createHash("sha256").update(logo).digest("hex") === "cd2edfaae101cc579a97d3dce3743b0c7971b29345db240730be58681b475f36", "The public logo differs from the exact artwork approved by the owner.");
const parsedManifest = JSON.parse(manifest);
assert(parsedManifest.name === "Homle Cleaning" && parsedManifest.short_name === "Homle", "The installable web-app name is not Homle.");
assert(parsedManifest.id === "/" && parsedManifest.scope === "/" && parsedManifest.display === "standalone" && parsedManifest.lang === "en-GB", "The installed Homle identity or navigation scope is incomplete.");
assert(parsedManifest.icons.some((icon) => icon.src === "/app-icon-192.png" && icon.sizes === "192x192") && parsedManifest.icons.some((icon) => icon.src === "/app-icon-512.png" && icon.sizes === "512x512") && parsedManifest.icons.some((icon) => icon.src === "/app-icon-maskable-512.png" && icon.purpose === "maskable"), "The web-app manifest omitted required phone icons or its maskable icon.");
const shortcutUrls = parsedManifest.shortcuts.map((shortcut) => shortcut.url);
assert(["/landlord/book", "/cleaner/dashboard", "/request", "/join"].every((url) => shortcutUrls.includes(url)), "The installed app omitted a secure room-scan, Cleaner-jobs or account-entry shortcut.");
assert(parsedManifest.shortcuts.find((shortcut) => shortcut.url === "/landlord/book")?.icons?.some((icon) => icon.src === "/app-icon-192.png"), "The one-tap room-scan shortcut omitted its local app icon.");
for (const iconName of ["app-icon-192.png", "app-icon-512.png", "app-icon-maskable-512.png", "apple-touch-icon.png"]) {
  const icon = await stat(new URL(`../public/${iconName}`, import.meta.url));
  assert(icon.isFile() && icon.size > 1000, `Installed-app icon ${iconName} is missing or empty.`);
}
assert(home.includes('name="apple-mobile-web-app-capable" content="yes"') && home.includes('rel="apple-touch-icon" href="/apple-touch-icon.png"'), "The homepage omitted iPhone home-screen metadata.");
for (const [name, page] of [
  ["Landlord dashboard", landlordDashboard],
  ["Cleaner dashboard", cleanerDashboard],
  ["Landlord booking journey", landlordJourney],
  ["room scanner", roomScan],
  ["active job", activeJob]
]) {
  assert(page.includes('name="apple-mobile-web-app-capable" content="yes"') && page.includes('rel="apple-touch-icon" href="/apple-touch-icon.png"') && page.includes('rel="manifest" href="/site.webmanifest"'), `${name} omitted the shared installable-app metadata.`);
}
assert(!visibleOldBrand.test(server) && !visibleOldBrand.test(emailWorker) && emailWorker.includes("Homle:"), "Server-generated customer or notification copy still exposes the old public brand.");
assert(server.includes("TidewayScopeTimeBreakdown") && server.includes("tideway-marketplace"), "The visual rebrand renamed stable internal runtime contracts.");

console.log("Public brand tests passed: Homle is visible across web, account and notification surfaces while stable internal contracts remain unchanged.");
