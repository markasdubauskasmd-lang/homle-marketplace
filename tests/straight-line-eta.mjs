import assert from "node:assert/strict";
import { createStraightLineEtaProvider, etaProviderFromEnvironment } from "../src/marketplace/straight-line-eta.mjs";

const fixedNow = new Date("2026-07-19T12:00:00.000Z");
const provider = createStraightLineEtaProvider({ clock: () => fixedNow });

// Westminster to a point ~5.6 km north-east: estimate lands in a sane band
// (route factor 1.35, 22 km/h, 3-minute buffer => roughly 24 minutes).
const origin = { latitude: 51.5010, longitude: -0.1416 };
const destination = { latitude: 51.5450, longitude: -0.1050 };
const eta = await provider.estimateArrival({ origin, destination });
const minutes = (eta.getTime() - fixedNow.getTime()) / 60_000;
assert(eta instanceof Date && minutes > 15 && minutes < 40, `A ~5.6 km urban journey produced an implausible estimate of ${minutes.toFixed(1)} minutes.`);

// Same point: the minimum applies (never an instant arrival).
const samePoint = await provider.estimateArrival({ origin, destination: origin });
assert((samePoint.getTime() - fixedNow.getTime()) / 60_000 >= 4, "A zero-distance journey lost its minimum arrival window.");

// Estimates never exceed the journey service's 24-hour acceptance bound.
const antipodal = await provider.estimateArrival({ origin, destination: { latitude: -51.5, longitude: 179.8 } });
assert(antipodal.getTime() - fixedNow.getTime() < 24 * 60 * 60 * 1000, "An extreme distance escaped the 24-hour estimate cap.");

// Invalid coordinates resolve to null rather than throwing into the journey path.
for (const bad of [null, {}, { latitude: 91, longitude: 0 }, { latitude: 10, longitude: 181 }, { latitude: "10", longitude: 0 }]) {
  assert.equal(await provider.estimateArrival({ origin: bad, destination }), null, "An invalid origin was estimated.");
  assert.equal(await provider.estimateArrival({ origin, destination: bad }), null, "An invalid destination was estimated.");
}

// Longer distances estimate later arrivals (monotonic in distance).
const near = await provider.estimateArrival({ origin, destination: { latitude: 51.5050, longitude: -0.1400 } });
const far = await provider.estimateArrival({ origin, destination: { latitude: 51.6000, longitude: -0.0500 } });
assert(near.getTime() < far.getTime(), "A farther destination did not produce a later estimate.");

// Environment selection: default on, explicit none disables, unknown rejected.
assert.ok(etaProviderFromEnvironment({}), "The provider-free estimator was not enabled by default.");
assert.equal(etaProviderFromEnvironment({ ETA_PROVIDER: "none" }), null);
assert.throws(() => etaProviderFromEnvironment({ ETA_PROVIDER: "mapbox" }), /straight-line/);

// Bounded configuration falls back to safe defaults on out-of-range values.
const misconfigured = createStraightLineEtaProvider({ speedKmh: 900, bufferMinutes: -5, minimumMinutes: 0, routeFactor: 9, clock: () => fixedNow });
const fallbackEta = await misconfigured.estimateArrival({ origin, destination });
const fallbackMinutes = (fallbackEta.getTime() - fixedNow.getTime()) / 60_000;
assert(fallbackMinutes > 15 && fallbackMinutes < 40, "Out-of-range configuration was not replaced by safe defaults.");

console.log("Straight-line ETA tests passed: plausible urban estimates, minimum window, 24-hour cap, invalid-input isolation, monotonic distance and bounded configuration.");
