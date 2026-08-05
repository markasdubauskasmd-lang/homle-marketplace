import {
  allowedDimensions, createScanTelemetry, durationBucket, scanEvent, scanMetrics, scanRates, scanTimings
} from "../src/marketplace/scan-telemetry.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }

/* ── An image, a label or a note must be unable to get out ─────────────── */

// The rule from the brief: never send raw customer images to analytics. This
// module is built so breaking it means deleting code, not forgetting to add it.
for (const attempt of [
  "scan.image",
  "scan.room.Kitchen",
  "data:image/jpeg;base64,AAAA",
  "scan.object.label",
  ""
]) {
  assert(scanEvent(attempt) === null, `An unlisted metric was emitted: ${attempt}`);
}

// A room name or an object label is a description of somebody's home, so a
// free-text dimension is refused even under an allowed metric name.
{
  const event = scanEvent("scan.room.completed", {
    dimensions: { deviceClass: "guided-web", roomName: "Kitchen", note: "the oven is disgusting", accountId: "u-1" }
  });
  assert(event, "A valid event was refused.");
  assert(Object.keys(event.dimensions).length === 1 && event.dimensions.deviceClass === "guided-web",
    `A free-text dimension survived: ${JSON.stringify(event.dimensions)}`);
  const serialised = JSON.stringify(event);
  assert(!/Kitchen|disgusting|u-1/.test(serialised), `Customer content reached a telemetry event: ${serialised}`);
}

// An unrecognised dimension value is dropped rather than passed through, so a
// caller cannot smuggle text into an allowed field.
{
  const event = scanEvent("scan.room.completed", { dimensions: { deviceClass: "Kitchen worktop" } });
  assert(Object.keys(event.dimensions).length === 0, "An unrecognised dimension value was kept.");
}
assert(allowedDimensions.deviceClass.every((value) => typeof value === "string"), "The dimension allowlist is not a fixed list of names.");

/* ── Timings are bucketed, never exact ─────────────────────────────────── */

// An exact duration is a weak identifier when joined against anything else.
{
  const event = scanEvent("scan.reading.latency_ms", { durationMs: 1847 });
  assert(event.bucket === "1000-2000ms", `A timing was not bucketed: ${event.bucket}`);
  assert(!Object.hasOwn(event, "durationMs") && !JSON.stringify(event).includes("1847"),
    "An exact duration survived bucketing.");
  assert(durationBucket(0) === "0-250ms" && durationBucket(999999) === "300000ms+", "Bucket edges are wrong.");
  assert(durationBucket(-1) === "invalid" && durationBucket("soon") === "invalid", "An impossible duration produced a bucket.");
  assert(scanEvent("scan.reading.latency_ms", { durationMs: -5 }) === null, "An impossible duration produced an event.");
}

/* ── Counts are bounded and cannot go backwards ────────────────────────── */

assert(scanEvent("scan.crash", { count: 0 }) === null, "A zero count was emitted.");
assert(scanEvent("scan.crash", { count: -3 }) === null, "A negative count could decrement a counter.");
assert(scanEvent("scan.crash", { count: 1e9 }).count === 10000, "A runaway count was not bounded.");
assert(scanEvent("scan.crash", { count: 1.5 }) === null, "A fractional count was emitted.");

/* ── Aggregation ───────────────────────────────────────────────────────── */

{
  const telemetry = createScanTelemetry();
  assert(telemetry.record("scan.session.started", { dimensions: { deviceClass: "guided-web" } }), "A valid event was not recorded.");
  telemetry.record("scan.session.started", { dimensions: { deviceClass: "guided-web" } });
  telemetry.record("scan.session.started", { dimensions: { deviceClass: "camera-fallback" } });
  telemetry.record("scan.reading.latency_ms", { durationMs: 1500 });
  assert(telemetry.record("scan.image.raw") === false, "An unlisted metric was accepted by the collector.");

  const snapshot = telemetry.snapshot();
  assert(snapshot.counters["scan.session.started|deviceClass=guided-web"] === 2, "Events with the same labels were not aggregated.");
  assert(snapshot.counters["scan.session.started|deviceClass=camera-fallback"] === 1, "Events with different labels were merged.");
  assert(Object.keys(snapshot.timings).some((key) => key.includes("1000-2000ms")), "A timing was not aggregated into its bucket.");

  telemetry.reset();
  assert(Object.keys(telemetry.snapshot().counters).length === 0, "Reset did not clear the collector.");
}

// A dimension combination nobody anticipated must not grow the map without
// limit in a long-running process.
{
  const telemetry = createScanTelemetry({ maximumSeries: 2 });
  telemetry.record("scan.session.started", { dimensions: { deviceClass: "guided-web" } });
  telemetry.record("scan.session.started", { dimensions: { deviceClass: "camera-fallback" } });
  const rejected = telemetry.record("scan.session.started", { dimensions: { deviceClass: "unknown" } });
  assert(rejected === false, "The collector grew past its series limit.");
  // An existing series still accepts values after the cap is reached.
  assert(telemetry.record("scan.session.started", { dimensions: { deviceClass: "guided-web" } }) === true,
    "The series cap stopped an already-tracked series from being counted.");
}

/* ── The acceptance criteria the audit set ─────────────────────────────── */

{
  const telemetry = createScanTelemetry();
  for (let index = 0; index < 10; index += 1) telemetry.record("scan.session.started");
  for (let index = 0; index < 8; index += 1) telemetry.record("scan.session.completed");
  for (let index = 0; index < 40; index += 1) telemetry.record("scan.room.completed");
  for (let index = 0; index < 4; index += 1) telemetry.record("scan.object.corrected");
  telemetry.record("scan.object.removed", { count: 4 });
  telemetry.record("scan.crash");
  for (let index = 0; index < 9; index += 1) telemetry.record("scan.reading.succeeded");
  telemetry.record("scan.reading.failed");

  const rates = scanRates(telemetry.snapshot());
  assert(rates.completionRate === 0.8, `Completion rate was ${rates.completionRate}.`);
  // Against rooms, not sessions: dividing by sessions would make a thorough
  // five-room scan look worse than a careless one-room scan.
  assert(rates.correctionRate === 0.2, `Correction rate was ${rates.correctionRate}.`);
  assert(rates.readingFailureRate === 0.1, `Reading failure rate was ${rates.readingFailureRate}.`);
  assert(rates.crashFreeRate === 0.9, `Crash-free rate was ${rates.crashFreeRate}.`);
}

// "No scans completed" and "no scans started" are different facts, and a zero
// would conflate them into a false alarm.
{
  const rates = scanRates(createScanTelemetry().snapshot());
  assert(rates.completionRate === null && rates.crashFreeRate === null && rates.correctionRate === null,
    "A rate with no denominator was reported as zero rather than as unknown.");
  assert(rates.startedSessions === 0, "The started count was not reported.");
}

// Labelled and unlabelled events of the same metric both count toward a rate.
{
  const telemetry = createScanTelemetry();
  telemetry.record("scan.session.started", { dimensions: { deviceClass: "guided-web" } });
  telemetry.record("scan.session.started");
  telemetry.record("scan.session.completed", { dimensions: { deviceClass: "guided-web" } });
  assert(scanRates(telemetry.snapshot()).completionRate === 0.5, "Labelled and unlabelled events were not summed for a rate.");
}

assert(scanMetrics.length > 0 && scanTimings.length > 0, "The metric allowlist is empty.");
assert(scanMetrics.every((name) => /^scan\.[a-z_.]+$/.test(name)), "A metric name does not follow the scan namespace.");

console.log("Scan telemetry checks passed.");
