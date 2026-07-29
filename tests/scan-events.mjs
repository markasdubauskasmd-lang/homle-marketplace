import { readFile } from "node:fs/promises";
import { createScanEventReporter, elapsedSince } from "../public/scan-events.js";
import { scanMetrics, scanTimings, createScanTelemetry } from "../src/marketplace/scan-telemetry.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }

function harness({ token = "csrf-token-value-long-enough" } = {}) {
  const sent = [];
  const timers = [];
  const scheduler = {
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout: () => {}
  };
  const reporter = createScanEventReporter({
    send: (path, options) => { sent.push({ path, body: JSON.parse(options.body), headers: options.headers }); return Promise.resolve(); },
    token, scheduler
  });
  return { reporter, sent, fireTimer: () => timers.forEach((fn) => fn()) };
}

/* ── Nothing about the customer's home can be sent ─────────────────────── */

// This module never has a room name, an object label or a note to send. The
// only shape it can construct is a name, a number and three known dimensions.
{
  const { reporter, sent } = harness();
  reporter.record("scan.room.completed", {
    dimensions: { deviceClass: "guided-web", roomName: "Kitchen", note: "the oven is disgusting", accountId: "u-1" },
    count: 1
  });
  await reporter.flush();
  const [event] = sent[0].body.events;
  assert(Object.keys(event.dimensions).length === 1 && event.dimensions.deviceClass === "guided-web",
    `A dimension the server does not recognise was constructed: ${JSON.stringify(event.dimensions)}`);
  const serialised = JSON.stringify(sent[0].body);
  assert(!/Kitchen|disgusting|u-1/.test(serialised), `Customer content was sent to telemetry: ${serialised}`);
}

// And the server refuses anything this module could get wrong anyway, so the two
// layers have to agree about what exists.
{
  const collector = createScanTelemetry();
  const { reporter, sent } = harness();
  for (const metric of ["scan.session.started", "scan.room.completed", "scan.redaction.applied", "scan.camera.unavailable", "scan.session.abandoned", "scan.redaction.frame_rejected"]) {
    assert(scanMetrics.includes(metric), `The overlay emits "${metric}", which the server does not recognise.`);
    reporter.record(metric);
  }
  for (const timing of ["scan.room.duration_ms", "scan.session.duration_ms"]) {
    assert(scanTimings.includes(timing), `The overlay emits "${timing}", which the server does not recognise.`);
    reporter.record(timing, { durationMs: 1200 });
  }
  await reporter.flush();
  for (const event of sent[0].body.events) {
    assert(collector.record(event.metric, event) === true, `The server rejected an event the client sent: ${event.metric}`);
  }
}

/* ── Batched, so measuring never slows down what it measures ────────────── */

// A metric costing a network round-trip inside a viewfinder loop would make the
// thing it measures worse.
{
  const { reporter, sent, fireTimer } = harness();
  reporter.record("scan.redaction.applied");
  reporter.record("scan.redaction.applied");
  reporter.record("scan.session.started");
  assert(sent.length === 0, "An event was sent immediately rather than queued.");
  assert(reporter.pendingCount() === 3, "Events were not queued.");
  fireTimer();
  await Promise.resolve();
  assert(sent.length === 1 && sent[0].body.events.length === 3, "The queued batch was not sent as one request.");
  assert(reporter.pendingCount() === 0, "The queue was not drained after sending.");
}

// Flushing an empty queue is a no-op, not an empty request.
{
  const { reporter, sent } = harness();
  assert(await reporter.flush() === false, "An empty flush reported success.");
  assert(sent.length === 0, "An empty queue produced a request.");
}

/* ── Every failure is swallowed ────────────────────────────────────────── */

// A dropped batch is a lost data point, not a broken scan.
{
  const reporter = createScanEventReporter({
    send: () => Promise.reject(new Error("offline")),
    token: "csrf-token-value-long-enough",
    scheduler: { setTimeout: () => 1, clearTimeout: () => {} }
  });
  reporter.record("scan.session.started");
  assert(await reporter.flush() === false, "A failed send was reported as success.");
}
{
  const reporter = createScanEventReporter({
    send: () => { throw new Error("synchronous failure"); },
    token: "csrf-token-value-long-enough",
    scheduler: { setTimeout: () => 1, clearTimeout: () => {} }
  });
  reporter.record("scan.session.started");
  assert(await reporter.flush() === false, "A synchronous send failure escaped.");
}

// No token means no session to attribute this to. Dropped rather than queued,
// because telemetry must never be the reason a token-recovery flow runs.
{
  const { reporter, sent } = harness({ token: "" });
  reporter.record("scan.session.started");
  assert(await reporter.flush() === false, "A batch was sent with no CSRF token.");
  assert(sent.length === 0, "A tokenless batch reached the network.");
}
{
  const { reporter, sent } = harness({ token: () => "fresh-token-value-long-enough" });
  reporter.record("scan.session.started");
  await reporter.flush();
  assert(sent[0].headers["X-CSRF-Token"] === "fresh-token-value-long-enough", "The token was not read at send time.");
}

/* ── A runaway queue is dropped, not grown ─────────────────────────────── */

// A scan that somehow produced hundreds of events has a bug worth noticing, not
// a backlog worth delivering.
{
  const { reporter } = harness();
  for (let index = 0; index < 200; index += 1) reporter.record("scan.redaction.applied");
  assert(reporter.pendingCount() <= 60, `The queue grew to ${reporter.pendingCount()}.`);
  assert(reporter.droppedAny() === true, "The queue silently discarded events without recording that it had.");
}

assert(createScanEventReporter({ send: () => {}, token: "t" }).record("") === false, "An unnamed event was queued.");

/* ── Durations ─────────────────────────────────────────────────────────── */

assert(elapsedSince(1000, 3400) === 2400, "Elapsed time was wrong.");
assert(elapsedSince(0) === null && elapsedSince(null) === null && elapsedSince("soon") === null, "A missing start marker produced a duration.");
// A clock that jumps backwards must not produce a negative duration.
assert(elapsedSince(5000, 1000) === null, "A backwards clock produced a negative duration.");

/* ── The overlay actually emits, and flushes before it disappears ───────── */

const overlay = await readFile(new URL("../public/room-scan-overlay.js", import.meta.url), "utf8");
assert(overlay.includes("createScanEventReporter"), "The scanner reports nothing.");
for (const metric of ["scan.session.started", "scan.room.completed", "scan.session.abandoned", "scan.redaction.applied", "scan.camera.unavailable"]) {
  assert(overlay.includes(`"${metric}"`), `The scanner never emits ${metric}.`);
}
// An unsent batch would simply vanish when the overlay is torn down.
assert(/scanEvents\.flush\(\)/.test(overlay), "The scanner never flushes its queue.");
// The reporter is created per scan, so a queue cannot outlive the overlay that
// filled it.
assert(/const scanEvents = createScanEventReporter\(\{[\s\S]{0,300}\}\);[\s\S]{0,200}const state = \{/.test(overlay),
  "The event reporter is not created per scan.");
// Releasing the camera comes before reporting anything about the scan that ended.
assert(/function close\(result\)[\s\S]{0,400}stopCamera\(\)/.test(overlay), "Closing the scan no longer releases the camera first.");

console.log("Scan event reporting checks passed.");
