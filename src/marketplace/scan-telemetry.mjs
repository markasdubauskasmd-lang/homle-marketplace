// Privacy-safe measurement of how the scanner is actually doing.
//
// Phase 8 of docs/ROOM_SCAN_ARCHITECTURE_AUDIT.md. The audit set acceptance
// criteria — completion rate, correction rate, crash-free sessions, latency —
// and then noted that none of them could be measured, because nothing was
// recorded. This records them.
//
// THE RULE, from the brief: never send raw customer images to analytics. This
// module is built so that breaking that rule requires deleting code rather than
// forgetting to add it — the allowed shape is an explicit list of counter names
// and bounded numbers, and everything else is dropped before it can be emitted.
//
// What is deliberately NOT recorded:
//   * no image, thumbnail, crop or data URL;
//   * no object label, room name, note or transcript — "Kitchen: the oven is
//     disgusting" is a description of somebody's home;
//   * no request id, property id, account id or session id, because a counter
//     tied to an identity is no longer a counter;
//   * no free text of any kind. Every field below is a number or a name from a
//     fixed list.

// The full set. A metric that is not here cannot be emitted, which is what
// makes "we never sent an image" checkable rather than merely intended.
export const scanMetrics = Object.freeze([
  // Funnel
  "scan.session.started",
  "scan.session.completed",
  "scan.session.abandoned",
  "scan.room.completed",
  // Quality
  "scan.reading.succeeded",
  "scan.reading.failed",
  "scan.reading.unavailable",
  "scan.object.corrected",
  "scan.object.removed",
  "scan.condition.unresolved",
  // Privacy
  "scan.redaction.applied",
  "scan.redaction.frame_rejected",
  // Device and reliability
  "scan.camera.denied",
  "scan.camera.unavailable",
  // The automatic capture assists. Counting them answers "how often is a room
  // too dark or too far for the phone" — which is what decides whether the
  // capture guidance needs more work — without recording anything about the
  // room itself.
  "scan.assist.torch",
  "scan.assist.zoom",
  "scan.detector.unavailable",
  "scan.upload.failed",
  "scan.crash",
  // Pricing
  "scan.estimate.produced",
  "scan.estimate.refused"
]);

// Timings, in milliseconds, bucketed rather than exact. An exact duration is a
// weak identifier when joined against anything else; a bucket is not.
export const scanTimings = Object.freeze([
  "scan.room.duration_ms",
  "scan.reading.latency_ms",
  "scan.session.duration_ms"
]);

// Only values from a fixed list may label a metric. A free-text dimension is
// how a room name ends up in an analytics pipeline.
export const allowedDimensions = Object.freeze({
  deviceClass: Object.freeze(["guided-web", "camera-fallback", "unknown"]),
  outcome: Object.freeze(["ok", "timeout", "provider-error", "offline", "declined"]),
  level: Object.freeze(["0", "1", "2", "3", "4", "5"])
});

const buckets = Object.freeze([250, 500, 1000, 2000, 4000, 8000, 15000, 30000, 60000, 120000, 300000]);

/**
 * The bucket a duration falls in, as a label.
 *
 * Returned as a range string rather than a number so nothing downstream can
 * average buckets back into something that looks like a precise timing.
 */
export function durationBucket(milliseconds) {
  const value = Number(milliseconds);
  if (!Number.isFinite(value) || value < 0) return "invalid";
  let previous = 0;
  for (const edge of buckets) {
    if (value < edge) return `${previous}-${edge}ms`;
    previous = edge;
  }
  return `${previous}ms+`;
}

function boundedDimensions(supplied) {
  const kept = {};
  for (const [name, allowed] of Object.entries(allowedDimensions)) {
    const value = supplied?.[name];
    if (value === undefined || value === null) continue;
    const text = String(value);
    // Silently dropped rather than rejected: telemetry must never be the reason
    // a scan fails. An unrecognised dimension is a bug worth losing a label
    // over, not one worth losing a customer's booking over.
    if (allowed.includes(text)) kept[name] = text;
  }
  return kept;
}

/**
 * One telemetry event, or null.
 *
 * Null rather than a throw for the same reason: nothing here is important
 * enough to interrupt a scan.
 */
export function scanEvent(metric, { count = 1, durationMs, dimensions } = {}) {
  const name = String(metric || "");
  const isTiming = scanTimings.includes(name);
  if (!isTiming && !scanMetrics.includes(name)) return null;
  const event = { metric: name, dimensions: boundedDimensions(dimensions) };
  if (isTiming) {
    const bucket = durationBucket(durationMs);
    if (bucket === "invalid") return null;
    event.bucket = bucket;
  } else {
    const amount = Number(count);
    // Bounded so a runaway loop reports a large number rather than an
    // unbounded one, and so a negative count cannot decrement a counter.
    if (!Number.isInteger(amount) || amount < 1) return null;
    event.count = Math.min(amount, 10000);
  }
  return Object.freeze({ ...event, dimensions: Object.freeze(event.dimensions) });
}

/**
 * Collects events and reports them as counts.
 *
 * In-memory and additive by design: the scanner emits and this aggregates.
 * The durable adapter below may copy only this normalized shape to storage,
 * asynchronously, so telemetry can never slow down or fail a scan.
 */
export function createScanTelemetry({ maximumSeries = 500 } = {}) {
  const counters = new Map();
  const timings = new Map();

  const key = (event) => {
    const labels = Object.entries(event.dimensions).sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => `${name}=${value}`).join(",");
    return labels ? `${event.metric}|${labels}` : event.metric;
  };

  return Object.freeze({
    record(metric, options) {
      const event = scanEvent(metric, options);
      if (!event) return false;
      const target = event.bucket ? timings : counters;
      const seriesKey = event.bucket ? `${key(event)}|${event.bucket}` : key(event);
      // Bounded so a dimension combination nobody anticipated cannot grow the
      // map without limit in a long-running process.
      if (!target.has(seriesKey) && target.size >= maximumSeries) return false;
      target.set(seriesKey, (target.get(seriesKey) || 0) + (event.count ?? 1));
      return true;
    },
    snapshot() {
      return Object.freeze({
        counters: Object.freeze(Object.fromEntries([...counters.entries()].sort(([left], [right]) => left.localeCompare(right)))),
        timings: Object.freeze(Object.fromEntries([...timings.entries()].sort(([left], [right]) => left.localeCompare(right))))
      });
    },
    reset() {
      counters.clear();
      timings.clear();
    }
  });
}

function eventKey(event) {
  const labels = Object.entries(event.dimensions).sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${value}`).join(",");
  return `${event.releaseCommit || "unknown"}|${event.metric}|${labels}|${event.bucket || ""}`;
}

function normalizedReleaseCommit(value) {
  const supplied = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{8}$/.test(supplied) ? supplied : "unknown";
}

/**
 * Adds durable, privacy-minimal aggregation without putting storage on the
 * scanner's critical path. record() remains synchronous and best-effort. A
 * failed database write is retried from a bounded queue; a failed read falls
 * back to the current process snapshot and says explicitly that it did so.
 */
export function createDurableScanTelemetry(repository, {
  maximumSeries = 500,
  flushDelayMs = 1000,
  scheduler = globalThis,
  windowDays = 30,
  releaseCommit
} = {}) {
  if (!repository || typeof repository.recordBatch !== "function" || typeof repository.snapshot !== "function") {
    throw new TypeError("A complete scan telemetry repository is required.");
  }
  const local = createScanTelemetry({ maximumSeries });
  // A fixed server-owned label. Callers of record() cannot override it, so a
  // crafted scanner request cannot move broken traffic into another release.
  const packagedReleaseCommit = normalizedReleaseCommit(releaseCommit);
  const pending = new Map();
  let timer = null;
  let flushing = null;

  const schedule = () => {
    if (timer || !pending.size || typeof scheduler?.setTimeout !== "function") return;
    timer = scheduler.setTimeout(() => {
      timer = null;
      void flush();
    }, flushDelayMs);
    timer?.unref?.();
  };

  const restore = (events) => {
    for (const event of events) {
      const key = eventKey(event);
      if (!pending.has(key) && pending.size >= maximumSeries) continue;
      const previous = pending.get(key);
      pending.set(key, Object.freeze({ ...event, count: Math.min(10000, (previous?.count || 0) + event.count) }));
    }
  };

  async function flush() {
    if (flushing) return flushing;
    if (!pending.size) return true;
    const events = [...pending.values()];
    pending.clear();
    flushing = (async () => {
      try {
        await repository.recordBatch(events);
        return true;
      } catch {
        restore(events);
        schedule();
        return false;
      } finally {
        flushing = null;
        // Events may arrive while the previous batch is in flight. If its
        // timer fired during that flush it correctly joined the in-flight
        // promise, but the new batch still needs its own later attempt.
        if (pending.size) schedule();
      }
    })();
    return flushing;
  }

  return Object.freeze({
    record(metric, options) {
      const event = scanEvent(metric, options);
      if (!event || !local.record(metric, options)) return false;
      const durableEvent = Object.freeze({ ...event, count: event.count ?? 1, releaseCommit: packagedReleaseCommit });
      const key = eventKey(durableEvent);
      if (!pending.has(key) && pending.size >= maximumSeries) return true;
      const previous = pending.get(key);
      pending.set(key, Object.freeze({ ...durableEvent, count: Math.min(10000, (previous?.count || 0) + durableEvent.count) }));
      schedule();
      return true;
    },
    snapshot: () => local.snapshot(),
    async durableSnapshot(actor, requestedWindowDays = windowDays) {
      await flush();
      try {
        return Object.freeze({
          snapshot: await repository.snapshot(actor, requestedWindowDays),
          durable: true,
          windowDays: requestedWindowDays,
          currentRelease: packagedReleaseCommit
        });
      } catch {
        return Object.freeze({ snapshot: local.snapshot(), durable: false, windowDays: null, currentRelease: packagedReleaseCommit });
      }
    },
    flush,
    reset() {
      local.reset();
      pending.clear();
      if (timer && typeof scheduler?.clearTimeout === "function") scheduler.clearTimeout(timer);
      timer = null;
    }
  });
}

/**
 * Derived rates, from counters alone.
 *
 * The acceptance criteria in the audit are ratios, and computing them here
 * rather than in a dashboard means the definition lives with the data. A rate
 * with no denominator is reported as null rather than as zero: "no scans were
 * completed" and "no scans were started" are different facts, and a zero would
 * conflate them into a false alarm.
 */
export function scanRates(snapshot) {
  const counters = snapshot?.counters || {};
  const total = (prefix) => Object.entries(counters)
    .filter(([name]) => name === prefix || name.startsWith(`${prefix}|`))
    .reduce((sum, [, value]) => sum + value, 0);

  const started = total("scan.session.started");
  const completed = total("scan.session.completed");
  const rooms = total("scan.room.completed");
  const corrections = total("scan.object.corrected") + total("scan.object.removed");
  const readings = total("scan.reading.succeeded") + total("scan.reading.failed");
  const ratio = (numerator, denominator) => (denominator > 0 ? Math.round((numerator / denominator) * 10000) / 10000 : null);

  return Object.freeze({
    startedSessions: started,
    completionRate: ratio(completed, started),
    // Against rooms, not sessions: a correction is something a customer does to
    // an object in a room, and dividing by sessions would make a thorough
    // five-room scan look worse than a careless one-room scan.
    correctionRate: ratio(corrections, rooms),
    readingFailureRate: ratio(total("scan.reading.failed"), readings),
    crashFreeRate: started > 0 ? Math.round((1 - Math.min(total("scan.crash") / started, 1)) * 10000) / 10000 : null,
    redactionRate: ratio(total("scan.redaction.applied"), rooms),
    estimateRefusalRate: ratio(total("scan.estimate.refused"), total("scan.estimate.produced") + total("scan.estimate.refused"))
  });
}

/** Rates for each bounded release aggregate returned by PostgreSQL. */
export function scanReleaseRates(snapshot) {
  const releases = Array.isArray(snapshot?.releases) ? snapshot.releases : [];
  return Object.freeze(releases.map((release) => Object.freeze({
    releaseCommit: normalizedReleaseCommit(release?.releaseCommit),
    firstObservedHour: release?.firstObservedHour || null,
    lastObservedHour: release?.lastObservedHour || null,
    rates: scanRates(release)
  })));
}
