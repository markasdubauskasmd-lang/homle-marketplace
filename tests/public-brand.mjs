import { readFile, readdir, stat } from "node:fs/promises";

function assert(condition, message) { if (!condition) throw new Error(message); }

const publicRoot = new URL("../public/", import.meta.url);
const publicFiles = (await readdir(publicRoot, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && /\.(?:html|js|svg|webmanifest)$/.test(entry.name))
  .map((entry) => entry.name);
const visibleOldBrand = /(?<![A-Za-z0-9_-])Tideway(?![A-Za-z0-9_-])/;

for (const name of publicFiles) {
  const source = await readFile(new URL(name, publicRoot), "utf8");
  assert(!visibleOldBrand.test(source), `Public asset ${name} still exposes the old Tideway brand.`);
}

const [home, account, logo, manifest, server, emailWorker] = await Promise.all([
  readFile(new URL("../public/home.html", import.meta.url), "utf8"),
  readFile(new URL("../public/account.html", import.meta.url), "utf8"),
  readFile(new URL("../public/logo.svg", import.meta.url), "utf8"),
  readFile(new URL("../public/site.webmanifest", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/marketplace/email-notification-worker.mjs", import.meta.url), "utf8")
]);

assert(home.includes("Homle") && account.includes("Homle") && logo.includes("<title id=\"title\">Homle</title>"), "The homepage, account entry or logo does not use the Homle public brand.");
assert(logo.includes('id="brand-red"') && logo.includes('id="mark-shadow"') && !logo.includes('<rect x="14.6"'), "The public logo fell back to the flat placeholder instead of the reviewed curved split-home mark.");
const parsedManifest = JSON.parse(manifest);
assert(parsedManifest.name === "Homle Cleaning" && parsedManifest.short_name === "Homle", "The installable web-app name is not Homle.");
assert(parsedManifest.id === "/" && parsedManifest.scope === "/" && parsedManifest.display === "standalone" && parsedManifest.lang === "en-GB", "The installed Homle identity or navigation scope is incomplete.");
assert(parsedManifest.icons.some((icon) => icon.src === "/app-icon-192.png" && icon.sizes === "192x192") && parsedManifest.icons.some((icon) => icon.src === "/app-icon-512.png" && icon.sizes === "512x512") && parsedManifest.icons.some((icon) => icon.src === "/app-icon-maskable-512.png" && icon.purpose === "maskable"), "The web-app manifest omitted required phone icons or its maskable icon.");
assert(parsedManifest.shortcuts.some((shortcut) => shortcut.url === "/request") && parsedManifest.shortcuts.some((shortcut) => shortcut.url === "/join"), "The installed app omitted its two safe primary shortcuts.");
for (const iconName of ["app-icon-192.png", "app-icon-512.png", "app-icon-maskable-512.png", "apple-touch-icon.png"]) {
  const icon = await stat(new URL(`../public/${iconName}`, import.meta.url));
  assert(icon.isFile() && icon.size > 1000, `Installed-app icon ${iconName} is missing or empty.`);
}
assert(home.includes('name="apple-mobile-web-app-capable" content="yes"') && home.includes('rel="apple-touch-icon" href="/apple-touch-icon.png"'), "The homepage omitted iPhone home-screen metadata.");
assert(!visibleOldBrand.test(server) && !visibleOldBrand.test(emailWorker) && emailWorker.includes("Homle:"), "Server-generated customer or notification copy still exposes the old public brand.");
assert(server.includes("TidewayScopeTimeBreakdown") && server.includes("tideway-marketplace"), "The visual rebrand renamed stable internal runtime contracts.");

console.log("Public brand tests passed: Homle is visible across web, account and notification surfaces while stable internal contracts remain unchanged.");
