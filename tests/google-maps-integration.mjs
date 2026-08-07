import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mapsClientConfigurationFromEnvironment } from "../src/marketplace/maps-client-config.mjs";

const [mapPage, mapScript, loader, registration, personalScript, server, privacy, terms, renderBlueprint] = await Promise.all([
  "cleaner-jobs-map.html", "cleaner-jobs-map.js", "google-maps-loader.js", "cleaner-registration.html", "cleaner-personal-details.js", "../server.mjs", "privacy.html", "terms.html", "../render.yaml"
].map((name) => readFile(new URL(name.startsWith("../") ? name : `../public/${name}`, import.meta.url), "utf8")));

const config = mapsClientConfigurationFromEnvironment({ MAP_PROVIDER: "google-maps", GOOGLE_MAPS_BROWSER_API_KEY: "restricted-browser-key-123", GOOGLE_MAPS_MAP_ID: "DEMO_MAP_ID" });
assert.equal(config.apiKey, "restricted-browser-key-123");
assert(!Object.hasOwn(config, "serverKey") && !JSON.stringify(config).includes("GOOGLE_MAPS_SERVER_API_KEY"), "The browser map configuration exposed a server credential.");
assert.equal(mapsClientConfigurationFromEnvironment({ MAP_PROVIDER: "none" }), null);

assert(mapPage.includes("data-map-tiles") && mapPage.includes("data-map-pins") && mapPage.includes("data-map-list") && mapPage.includes("OpenStreetMap contributors") && !mapPage.includes("data-google-map") && mapPage.includes('__CSP_NONCE__'), "The Cleaner Jobs Map lacks its postcode-centred street map or still mounts Google Maps.");
assert(mapScript.includes('/api/marketplace/bookings?limit=50') && mapScript.includes('bookingSummaryBuckets(bookings, "cleaner").pending') && mapScript.includes("openStreetMapTileUrl") && mapScript.includes("/outcodes/") && !mapScript.includes('/api/marketplace/maps/config') && !mapScript.includes('importLibrary("maps")') && !mapScript.includes("navigator.geolocation"), "The Jobs Map is not driven by private Cleaner offers and outward postcodes, or still starts dormant Google/GPS code.");
assert(loader.includes("https://maps.googleapis.com/maps/api/js") && !loader.includes("GOOGLE_MAPS_SERVER_API_KEY"), "The browser loader is not pinned to Google Maps JavaScript or contains a server key name.");
assert(!registration.includes("data-address-query") && !registration.includes("data-address-lookup") && !personalScript.includes("address-lookup/resolve") && registration.includes('name="postcode"') && registration.includes('name="street"'), "Cleaner onboarding still exposes the removed address lookup or lost manual address entry.");
assert(server.includes('const postcodeMapPage = requestPath === "/cleaner/work-areas" || requestPath === "/cleaner/jobs-map"') && server.includes("https://tile.openstreetmap.org") && server.includes("https://api.postcodes.io") && server.includes("replaceAll(\"__CSP_NONCE__\", cspNonce)") && !server.includes("googleMapPage"), "The Jobs Map does not use the restricted postcode-map policy or still grants dormant Google/geolocation permissions.");
assert(privacy.includes("Google Maps Platform") && privacy.includes("Google Privacy Policy") && terms.includes("Google Maps/Google Earth Additional Terms of Service"), "Google Maps data processing or required user terms are not disclosed.");
for (const provider of ["MAP_PROVIDER", "GEOCODING_PROVIDER", "ADDRESS_LOOKUP_PROVIDER", "ETA_PROVIDER"]) {
  assert(renderBlueprint.includes(`key: ${provider}\n        sync: false`), `Render blueprint did not leave ${provider} under existing-service control.`);
}
for (const privateKey of ["GOOGLE_MAPS_BROWSER_API_KEY", "GOOGLE_MAPS_SERVER_API_KEY"]) assert(!renderBlueprint.includes(`key: ${privateKey}`), `Render blueprint still requests unused ${privateKey}.`);

console.log("Dormant Google Maps integration tests passed: the Jobs Map stays first-party while optional provider code remains isolated and Render does not request keys.");
