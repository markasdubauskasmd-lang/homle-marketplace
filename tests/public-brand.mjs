import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";

function assert(condition, message) { if (!condition) throw new Error(message); }

const publicRoot = new URL("../public/", import.meta.url);
const publicFiles = (await readdir(publicRoot, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && /\.(?:html|js|svg|webmanifest)$/.test(entry.name))
  .map((entry) => entry.name);
const visibleOldBrand = /(?<![A-Za-z0-9_-])Tideway(?![A-Za-z0-9_-])/;
// Derived, not pinned. The version is bumped on every deployment that touches
// styles.css (docs/BRAND_AND_UI.md rule 4), and hard-coding it here meant a
// routine cache bump failed a brand test. What this guarantees is unchanged and
// is the thing that actually matters: every public page loads the SAME current
// version, so none of them serves a stale stylesheet.
// The landing page is deliberately outside the shared sheet: it is a
// self-contained dark cinematic design with its own scoped landing.css, and
// loading styles.css on top of it would fight its typography and surface. The
// version is therefore anchored on account.html, the first page every visitor
// reaches after it, and home.html is exempted from the shared-sheet rule alone.
const standaloneDesignPages = new Set(["home.html"]);
// Public and Landlord pages display the approved 1254 px artwork at no more than
// 54 CSS pixels. Loading the 1.97 MB source there delayed the first useful paint
// on mobile. These pages use a locked 128 px lossless derivative; Cleaner pages
// deliberately retain their existing asset and are outside this performance edit.
const compactLogoPages = new Set([
  "facebook-data-deletion.html",
  "home.html",
  "landlord-dashboard.html",
  "landlord-help.html",
  "landlord-journey.html",
  "privacy.html",
  "terms.html"
]);
const anchorMarkup = await readFile(new URL("account.html", publicRoot), "utf8");
const sharedStyleVersion = /\/styles\.css\?v=([\w-]+)/.exec(anchorMarkup);
if (!sharedStyleVersion) throw new Error("account.html no longer loads a versioned styles.css, so no page can be checked against it.");
const sharedStyleAsset = `/styles.css?v=${sharedStyleVersion[1]}`;

for (const name of publicFiles) {
  const source = await readFile(new URL(name, publicRoot), "utf8");
  assert(!visibleOldBrand.test(source), `Public asset ${name} still exposes the old Tideway brand.`);
  if (name.endsWith(".html")) {
    assert(!source.includes('/favicon.svg'), `Public page ${name} still references the removed fallback favicon instead of the approved Homle logo.`);
    const expectedLogo = compactLogoPages.has(name) ? "/homle-logo-128.png" : "/homle-logo.png";
    assert(source.includes(`<link rel="icon" href="${expectedLogo}" type="image/png">`), `Public page ${name} omitted its approved Homle tab icon.`);
    if (standaloneDesignPages.has(name)) {
      assert(!source.includes("/styles.css"), `Public page ${name} is a standalone design and must not load the shared sheet.`);
      continue;
    }
    assert(source.includes(sharedStyleAsset), `Public page ${name} does not load the current shared design and animation asset.`);
  }
}

const [home, account, landlordDashboard, cleanerDashboard, landlordJourney, roomScan, activeJob, logo, compactLogo, manifest, server, emailWorker] = await Promise.all([
  readFile(new URL("../public/home.html", import.meta.url), "utf8"),
  readFile(new URL("../public/account.html", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-dashboard.html", import.meta.url), "utf8"),
  readFile(new URL("../public/cleaner-dashboard.html", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-journey.html", import.meta.url), "utf8"),
  readFile(new URL("../public/room-scan.html", import.meta.url), "utf8"),
  readFile(new URL("../public/active-job.html", import.meta.url), "utf8"),
  readFile(new URL("../public/homle-logo.png", import.meta.url)),
  readFile(new URL("../public/homle-logo-128.png", import.meta.url)),
  readFile(new URL("../public/site.webmanifest", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/marketplace/email-notification-worker.mjs", import.meta.url), "utf8")
]);

assert(home.includes("Homle") && account.includes("Homle") && home.includes('/homle-logo-128.png') && account.includes('/homle-logo.png'), "The homepage or account entry does not use its approved Homle brand asset.");
assert(landlordJourney.includes('<link rel="icon" href="/homle-logo-128.png" type="image/png">') && roomScan.includes('<link rel="icon" href="/homle-logo.png" type="image/png">'), "The guided booking or legacy scanner surface does not use its approved Homle tab icon.");
assert(createHash("sha256").update(logo).digest("hex") === "cd2edfaae101cc579a97d3dce3743b0c7971b29345db240730be58681b475f36", "The public logo differs from the exact artwork approved by the owner.");
assert(createHash("sha256").update(compactLogo).digest("hex") === "4f82ebad6fe8c81f219b9691ce5c38e371998facdec074e57df3457d8d6a6568" && compactLogo.length <= 20_000, "The compact public logo is not the reviewed lossless derivative or has regained excessive transfer weight.");
assert(cleanerDashboard.includes('/homle-logo.png') && !cleanerDashboard.includes('/homle-logo-128.png'), "The public-page logo optimisation changed the Cleaner Dashboard asset boundary.");
const parsedManifest = JSON.parse(manifest);
assert(parsedManifest.name === "Homle Cleaning" && parsedManifest.short_name === "Homle", "The installable web-app name is not Homle.");
assert(parsedManifest.id === "/" && parsedManifest.scope === "/" && parsedManifest.display === "standalone" && parsedManifest.lang === "en-GB", "The installed Homle identity or navigation scope is incomplete.");
assert(parsedManifest.icons.some((icon) => icon.src === "/app-icon-192.png" && icon.sizes === "192x192") && parsedManifest.icons.some((icon) => icon.src === "/app-icon-512.png" && icon.sizes === "512x512") && parsedManifest.icons.some((icon) => icon.src === "/app-icon-maskable-512.png" && icon.purpose === "maskable"), "The web-app manifest omitted required phone icons or its maskable icon.");
const shortcutUrls = parsedManifest.shortcuts.map((shortcut) => shortcut.url);
assert(["/landlord/book", "/landlord/dashboard", "/cleaner/dashboard"].every((url) => shortcutUrls.includes(url)) && !shortcutUrls.includes("/request") && !shortcutUrls.includes("/join"), "The installed app omitted a secure dashboard shortcut or retained a retired public journey.");
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
