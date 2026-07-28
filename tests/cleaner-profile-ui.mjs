import { access, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function fileExists(url) {
  try {
    await access(url, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

const publicUrl = new URL("../public/", import.meta.url);
const removedAssets = [
  new URL("cleaner-profile.html", publicUrl),
  new URL("cleaner-profile.js", publicUrl),
  new URL("cleaner-profile-model.js", publicUrl)
];
const [server, marketplaceHttp, publicFiles] = await Promise.all([
  readFile(new URL("../server.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/marketplace/marketplace-http.mjs", import.meta.url), "utf8"),
  readdir(publicUrl)
]);

assert((await Promise.all(removedAssets.map(fileExists))).every((exists) => !exists), "A removed Cleaner profile-builder asset is still shipped.");
assert(!server.includes('"/cleaner/profile": "cleaner-profile.html"'), "The removed Cleaner profile-builder route is still served.");
assert(server.includes('"/cleaner/profile/preview": "cleaner-public-profile.html"'), "Removing the editor also removed the separate public-profile preview.");

const publicSources = await Promise.all(
  publicFiles
    .filter((name) => name.endsWith(".html") || name.endsWith(".js"))
    .map(async (name) => [name, await readFile(new URL(name, publicUrl), "utf8")])
);
const staleLinks = publicSources.flatMap(([name, source]) => {
  const matches = [...source.matchAll(/(?:href\s*=\s*|\.href\s*=\s*|href\s*:\s*)["']\/cleaner\/profile["']/g)];
  return matches.map(() => name);
});
assert(staleLinks.length === 0, `Public navigation still opens the removed Cleaner profile-builder route: ${[...new Set(staleLinks)].join(", ")}`);

assert(marketplaceHttp.includes('pathname === "/api/marketplace/cleaner/profile"') && marketplaceHttp.includes('request.method === "PUT"'), "Removing the page accidentally removed the protected Cleaner profile backend.");

console.log("Cleaner profile UI removal tests passed: page assets, route and entry points are gone while the profile preview and backend remain.");
