import { readFile, readdir } from "node:fs/promises";

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
assert(JSON.parse(manifest).name === "Homle Cleaning" && JSON.parse(manifest).short_name === "Homle", "The installable web-app name is not Homle.");
assert(!visibleOldBrand.test(server) && !visibleOldBrand.test(emailWorker) && emailWorker.includes("Homle:"), "Server-generated customer or notification copy still exposes the old public brand.");
assert(server.includes("TidewayScopeTimeBreakdown") && server.includes("tideway-marketplace"), "The visual rebrand renamed stable internal runtime contracts.");

console.log("Public brand tests passed: Homle is visible across web, account and notification surfaces while stable internal contracts remain unchanged.");
