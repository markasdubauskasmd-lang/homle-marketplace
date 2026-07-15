import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTrackingTestStore } from "../tracking-test-store.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectError(operation, statusCode, phrase) {
  try {
    operation();
  } catch (error) {
    return error.statusCode === statusCode && error.message.includes(phrase);
  }
  return false;
}

let time = Date.parse("2026-07-15T12:00:00.000Z");
const tokens = ["A".repeat(43), "B".repeat(43), "C".repeat(43), "D".repeat(43)];
let tokenIndex = 0;
let idIndex = 0;
const store = createTrackingTestStore({
  now: () => time,
  createToken: () => tokens[tokenIndex++],
  createId: () => `TST-TEST000${++idIndex}`,
  sessionTtlMs: 10_000,
  pointTtlMs: 1_000,
  maximumSessions: 2,
  maximumSubscribers: 2
});

const created = store.createSession();
assert(created.reference === "TST-TEST0001" && created.snapshot.state === "waiting" && store.activeSessionCount() === 1, "A bounded in-memory tracking test was not created.");
assert(!JSON.stringify(created.snapshot).includes(created.controllerToken) && !JSON.stringify(created.snapshot).includes(created.viewerToken), "A tracking snapshot exposed its private tokens.");
assert(store.getSnapshot(created.controllerToken).role === "cleaner" && store.getSnapshot(created.viewerToken).role === "landlord", "Separate controller and viewer tokens did not preserve their roles.");
assert(expectError(() => store.getSnapshot("wrong"), 401, "invalid or expired"), "An invalid private tracking-test token was accepted.");
assert(expectError(() => store.updateLocation(created.viewerToken, { latitude: 51.5, longitude: -0.1, accuracyMetres: 8 }), 403, "Only the Cleaner"), "A Landlord viewer updated the Cleaner location.");
assert(expectError(() => store.updateLocation(created.controllerToken, { latitude: 200, longitude: -0.1, accuracyMetres: 8 }), 422, "Latitude"), "An impossible latitude was accepted.");

const viewerEvents = [];
const unsubscribe = store.subscribe(created.viewerToken, (snapshot) => viewerEvents.push(snapshot));
const updated = store.updateLocation(created.controllerToken, { latitude: 51.50123, longitude: -0.14123, accuracyMetres: 8.456 });
assert(updated.state === "live" && updated.location.latitude === 51.50123 && updated.location.accuracyMetres === 8.5, "The current test point was not normalized or made live.");
assert(viewerEvents.length === 2 && viewerEvents.at(-1).role === "landlord" && viewerEvents.at(-1).location.longitude === -0.14123, "The authorized viewer did not receive the current location update.");

time += 1_500;
const stale = store.getSnapshot(created.viewerToken);
assert(stale.state === "stale" && stale.location === null, "An expired current point remained visible or became route history.");
const refreshed = store.updateLocation(created.controllerToken, { latitude: 51.50124, longitude: -0.1412, accuracyMetres: 10 });
assert(refreshed.location.latitude === 51.50124 && !JSON.stringify(refreshed).includes("51.50123"), "The store retained prior route points instead of replacing the current point.");

const stopped = store.stop(created.controllerToken);
assert(stopped.state === "stopped" && stopped.location === null && viewerEvents.at(-1).state === "stopped", "Stopping did not delete the current point or notify the viewer.");
assert(expectError(() => store.updateLocation(created.controllerToken, { latitude: 51.5, longitude: -0.1, accuracyMetres: 8 }), 409, "has stopped"), "A stopped test accepted another point.");
assert(expectError(() => store.destroy(created.viewerToken), 403, "Only the Cleaner"), "A viewer deleted the private test.");
const destroyed = store.destroy(created.controllerToken);
assert(destroyed.state === "deleted" && viewerEvents.at(-1).state === "deleted" && store.activeSessionCount() === 0, "Controller deletion did not notify viewers and remove the in-memory session.");
assert(expectError(() => store.getSnapshot(created.viewerToken), 401, "invalid or expired"), "A deleted viewer token remained authorized.");
unsubscribe();

const expiring = store.createSession();
time += 10_001;
assert(store.activeSessionCount() === 0 && expectError(() => store.getSnapshot(expiring.viewerToken), 401, "invalid or expired"), "A test session survived its hard expiry.");
store.close();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pagePath = path.join(root, "public", "tracking-test.html");
const scriptPath = path.join(root, "public", "tracking-test.js");
const server = await readFile(path.join(root, "server.mjs"), "utf8");
const page = await readFile(pagePath, "utf8").catch(() => "");
const script = await readFile(scriptPath, "utf8").catch(() => "");
assert(server.includes('"/tracking-test": "tracking-test.html"') && server.includes("createTrackingTestStore") && server.includes("trackingTestViewerOrigins") && server.includes('geolocation=(self)'), "The private functional tracking page, phone-view origin or geolocation permission boundary is not registered.");
assert(page.includes("Real location test") && page.includes("foreground") && page.includes("latest point") && page.includes("I consent") && page.includes("Same-Wi-Fi phone viewer link"), "The tracking test page is missing real-location consent, current-only limitations or its read-only phone viewer.");
assert(script.includes("navigator.geolocation.watchPosition") && script.includes("navigator.geolocation.clearWatch") && script.includes("history.replaceState") && script.includes('"X-Tracking-Test-Token"'), "The browser controller does not request, stop or privately authorize real geolocation.");
assert(script.includes("response.body.getReader") && !script.includes("EventSource") && !/(google|mapbox|openstreetmap|leaflet)/i.test(`${page}\n${script}`), "The authorized live stream is missing or the test leaks location to an external map provider.");
assert(script.includes("result.viewerOrigins") && script.includes("phoneViewerLink") && script.includes("Private same-Wi-Fi phone viewer link copied"), "The loopback controller does not prepare a private read-only phone viewer link.");

console.log("Tracking test passed: separate private roles, current-point-only memory, authorization, expiry, stop/delete, consent-bound browser control and header-authorized streaming.");
