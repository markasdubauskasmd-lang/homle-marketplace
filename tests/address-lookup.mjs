import assert from "node:assert/strict";
import { addressLookupFromEnvironment, createGooglePlacesAddressLookup } from "../src/marketplace/address-lookup.mjs";

const token = "9f35fdc8-e349-4bd2-b30f-f90dd3aa77cc";
function jsonResponse(status, body) { return { status, async text() { return JSON.stringify(body); } }; }

{
  const calls = [];
  const lookup = createGooglePlacesAddressLookup({
    apiKey: "server-key",
    fetch: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(200, { suggestions: [{ placePrediction: { placeId: "ChIJ12345678", text: { text: "10 Watkin Terrace, Northampton NN1 3ER, UK" } } }] });
    }
  });
  const result = await lookup.searchAddresses("10 Watkin Terrace", token);
  assert.deepEqual(result, { suggestions: [{ id: "ChIJ12345678", address: "10 Watkin Terrace, Northampton NN1 3ER, UK" }] });
  assert.equal(calls[0].url, "https://places.googleapis.com/v1/places:autocomplete");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["X-Goog-Api-Key"], "server-key");
  assert.equal(calls[0].init.headers["X-Goog-FieldMask"], "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text");
  assert.deepEqual(JSON.parse(calls[0].init.body), { input: "10 Watkin Terrace", sessionToken: token, includedRegionCodes: ["gb"], regionCode: "uk", languageCode: "en-GB" });
  assert.ok(calls[0].init.signal);
}

{
  const calls = [];
  const lookup = createGooglePlacesAddressLookup({
    apiKey: "server-key",
    fetch: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(200, { id: "ChIJ12345678", formattedAddress: "Flat 2, Homle House, 10 Example Road, Wallington SM6 7LQ, UK", addressComponents: [
        { longText: "Flat 2", types: ["subpremise"] },
        { longText: "Homle House", types: ["premise"] },
        { longText: "10", types: ["street_number"] },
        { longText: "Example Road", types: ["route"] },
        { longText: "Wallington", types: ["postal_town"] },
        { longText: "Greater London", types: ["administrative_area_level_2"] },
        { longText: "SM6 7LQ", types: ["postal_code"] }
      ], location: { latitude: 51.3, longitude: -0.1 } });
    }
  });
  const address = await lookup.resolveAddress("ChIJ12345678", token);
  assert.deepEqual(address, { postcode: "SM6 7LQ", houseNumber: "Flat 2, Homle House, 10", street: "Example Road", town: "Wallington", county: "Greater London", country: "United Kingdom" });
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/v1/places/ChIJ12345678");
  assert.equal(url.searchParams.get("sessionToken"), token);
  assert.equal(calls[0].init.headers["X-Goog-FieldMask"], "id,formattedAddress,addressComponents,location");
  assert(!JSON.stringify(address).includes("ChIJ") && !JSON.stringify(address).includes("latitude"), "Google-only place data escaped into the stored onboarding projection.");
}

{
  let calls = 0;
  const lookup = createGooglePlacesAddressLookup({ apiKey: "server-key", fetch: async () => { calls += 1; return jsonResponse(200, {}); } });
  await assert.rejects(() => lookup.searchAddresses("x", token), (error) => error.statusCode === 422 && error.code === "invalid-address-query");
  await assert.rejects(() => lookup.searchAddresses("valid query", "not-a-token"), (error) => error.statusCode === 422 && error.code === "invalid-address-session");
  await assert.rejects(() => lookup.resolveAddress("bad!", token), (error) => error.statusCode === 422 && error.code === "invalid-address-selection");
  assert.equal(calls, 0);
}

{
  const noResults = createGooglePlacesAddressLookup({ apiKey: "key", fetch: async () => jsonResponse(200, { suggestions: [] }) });
  await assert.rejects(() => noResults.searchAddresses("Homle House", token), (error) => error.statusCode === 404 && error.code === "address-not-found");
  const unavailable = createGooglePlacesAddressLookup({ apiKey: "key", fetch: async () => { throw new Error("secret network detail"); } });
  await assert.rejects(() => unavailable.searchAddresses("Homle House", token), (error) => error.statusCode === 503 && !error.message.includes("secret"));
}

assert.equal(addressLookupFromEnvironment({}), null);
assert.equal(addressLookupFromEnvironment({ ADDRESS_LOOKUP_PROVIDER: "none" }), null);
assert.throws(() => addressLookupFromEnvironment({ ADDRESS_LOOKUP_PROVIDER: "google-maps" }), /server API key/);
assert.throws(() => addressLookupFromEnvironment({ ADDRESS_LOOKUP_PROVIDER: "invented", GOOGLE_MAPS_SERVER_API_KEY: "key" }), /google-maps/);
assert.ok(addressLookupFromEnvironment({ ADDRESS_LOOKUP_PROVIDER: "google-maps", GOOGLE_MAPS_SERVER_API_KEY: "key" }, { fetch: async () => jsonResponse(200, {}) }));

console.log("Google address lookup tests passed: session-scoped search, safe address projection, validation and fail-closed errors.");
