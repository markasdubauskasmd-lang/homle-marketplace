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

assert(mapPage.includes("data-google-map") && mapPage.includes("Show my location") && mapPage.includes("Google Maps") && mapPage.includes('__CSP_NONCE__'), "The Cleaner Jobs Map lacks its real map surface, optional GPS control, provider attribution or CSP nonce.");
assert(mapScript.includes('/api/marketplace/maps/config') && mapScript.includes('importLibrary("maps")') && mapScript.includes('importLibrary("geocoding")') && mapScript.includes("navigator.geolocation.getCurrentPosition") && mapScript.includes("propertyArea"), "The Jobs Map is not driven by protected configuration, Google libraries, user-requested GPS and privacy-safe job areas.");
assert(loader.includes("https://maps.googleapis.com/maps/api/js") && !loader.includes("GOOGLE_MAPS_SERVER_API_KEY"), "The browser loader is not pinned to Google Maps JavaScript or contains a server key name.");
assert(!registration.includes("data-address-query") && !registration.includes("data-address-lookup") && !personalScript.includes("address-lookup/resolve") && registration.includes('name="postcode"') && registration.includes('name="street"'), "Cleaner onboarding still exposes the removed address lookup or lost manual address entry.");
assert(server.includes('googleMapPage = requestPath === "/cleaner/jobs-map"') && server.includes("'strict-dynamic'") && server.includes("replaceAll(\"__CSP_NONCE__\", cspNonce)") && server.includes('requestPath === "/tracking-test" || googleMapPage'), "The map page lacks a nonce-protected Google CSP or page-scoped geolocation permission.");
assert(privacy.includes("Google Maps Platform") && privacy.includes("Google Privacy Policy") && terms.includes("Google Maps/Google Earth Additional Terms of Service"), "Google Maps data processing or required user terms are not disclosed.");
for (const required of ["MAP_PROVIDER", "GOOGLE_MAPS_BROWSER_API_KEY", "GOOGLE_MAPS_SERVER_API_KEY", "GEOCODING_PROVIDER", "ADDRESS_LOOKUP_PROVIDER", "ETA_PROVIDER"]) assert(renderBlueprint.includes(`key: ${required}`), `Render blueprint omitted ${required}.`);

console.log("Google Maps integration tests passed: key separation, jobs map, GPS consent, manual onboarding address entry, CSP and legal disclosures.");
