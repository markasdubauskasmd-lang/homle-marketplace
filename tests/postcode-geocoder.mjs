import assert from "node:assert/strict";
import { createPostcodesIoGeocoder, geocoderFromEnvironment } from "../src/marketplace/postcode-geocoder.mjs";

function jsonResponse(status, body) {
  return { status, async text() { return JSON.stringify(body); } };
}

// A valid full postcode resolves to bounded coordinates from the exact endpoint.
{
  const calls = [];
  const geocoder = createPostcodesIoGeocoder({
    fetch: async (url, init) => { calls.push({ url, init }); return jsonResponse(200, { status: 200, result: { latitude: 51.501009, longitude: -0.141588 } }); }
  });
  const result = await geocoder.geocodePostcode("sw1a 1aa");
  assert.deepEqual(result, { latitude: 51.501009, longitude: -0.141588 });
  assert.equal(calls[0].url, "https://api.postcodes.io/postcodes/SW1A1AA", "Postcode was not normalised into the exact lookup URL.");
  assert.equal(calls[0].init.redirect, "error", "Geocoder followed redirects instead of failing closed.");
  assert.ok(calls[0].init.signal, "Geocoder issued a request without a timeout abort signal.");
}

// Outward-code lookup uses the outcodes endpoint.
{
  const calls = [];
  const geocoder = createPostcodesIoGeocoder({ fetch: async (url) => { calls.push(url); return jsonResponse(200, { status: 200, result: { latitude: 53.4, longitude: -2.2 } }); } });
  assert.deepEqual(await geocoder.geocodeOutcode("m1"), { latitude: 53.4, longitude: -2.2 });
  assert.equal(calls[0], "https://api.postcodes.io/outcodes/M1");
}

// Invalid input never reaches the network.
{
  let called = false;
  const geocoder = createPostcodesIoGeocoder({ fetch: async () => { called = true; return jsonResponse(200, { status: 200, result: { latitude: 1, longitude: 1 } }); } });
  assert.equal(await geocoder.geocodePostcode("not-a-postcode"), null);
  assert.equal(await geocoder.geocodePostcode(""), null);
  assert.equal(await geocoder.geocodePostcode(null), null);
  assert.equal(await geocoder.geocodeOutcode("SW1A1AA"), null, "A full postcode must not be accepted as an outward code.");
  assert.equal(called, false, "Malformed postcodes reached the geocoding provider.");
}

// Fail-safe: not-found, non-200, null coordinates, oversized body, bad JSON, out-of-range and network errors all resolve to null.
{
  const cases = [
    async () => jsonResponse(404, { status: 404, error: "Postcode not found" }),
    async () => jsonResponse(200, { status: 404, error: "Postcode not found" }),
    async () => jsonResponse(200, { status: 200, result: { latitude: null, longitude: null } }),
    async () => jsonResponse(200, { status: 200, result: { latitude: 200, longitude: 0 } }),
    async () => ({ status: 200, async text() { return "x".repeat(70_000); } }),
    async () => ({ status: 200, async text() { return "{not json"; } }),
    async () => { throw new Error("network down"); },
    async () => ({ status: 500 })
  ];
  for (const fetchImpl of cases) {
    const geocoder = createPostcodesIoGeocoder({ fetch: fetchImpl });
    assert.equal(await geocoder.geocodePostcode("SW1A1AA"), null, "A degraded geocoder response was not treated as unresolved.");
  }
}

// Environment factory selects the provider or stays disabled, and rejects unknown providers.
assert.equal(geocoderFromEnvironment({}), null);
assert.equal(geocoderFromEnvironment({ GEOCODING_PROVIDER: "none" }), null);
assert.throws(() => geocoderFromEnvironment({ GEOCODING_PROVIDER: "mapbox" }), /postcodes-io/);
assert.ok(geocoderFromEnvironment({ GEOCODING_PROVIDER: "postcodes-io" }, { fetch: async () => jsonResponse(200, { status: 200, result: {} }) }));

// Falls back to the platform fetch when none is supplied; only errors when no fetch exists at all.
assert.ok(createPostcodesIoGeocoder({}), "Geocoder did not fall back to the platform fetch.");
const savedFetch = globalThis.fetch;
try {
  globalThis.fetch = undefined;
  assert.throws(() => createPostcodesIoGeocoder({}), /fetch implementation/);
} finally {
  globalThis.fetch = savedFetch;
}

console.log("Postcode geocoder tests passed: exact endpoint, normalisation, invalid-input isolation, fail-safe degradation and provider selection.");
