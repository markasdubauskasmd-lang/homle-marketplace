// Reports what only the browser can see: a denied camera, an unavailable
// detector, a redaction, an abandoned scan.
//
// Three rules, all about this never mattering more than the scan it observes:
//
//   1. **Batched and deferred.** Events queue and flush on a timer or at the end
//      of the scan. A metric that costs a network round-trip in the middle of a
//      viewfinder loop would make the thing it measures worse.
//   2. **Fire-and-forget.** Every failure is swallowed. There is no retry, and a
//      dropped batch is a lost data point rather than a broken scan.
//   3. **Names only.** Nothing here accepts free text. The server checks every
//      name and label against its own allowlist, and this module never has a
//      room name, an object label or a note to send in the first place.

const endpoint = "/api/marketplace/landlord/scan-events";
const flushAfterMs = 8000;
// Past this the queue is dropped rather than grown. A scan that somehow produced
// hundreds of events has a bug worth noticing, not a backlog worth delivering.
const maximumQueued = 60;

export function createScanEventReporter({ send, token, now = () => Date.now(), scheduler = globalThis } = {}) {
  const queue = [];
  let timer = null;
  let dropped = false;

  function flush() {
    if (timer) { scheduler.clearTimeout?.(timer); timer = null; }
    if (!queue.length) return Promise.resolve(false);
    const batch = queue.splice(0, queue.length);
    const csrf = typeof token === "function" ? token() : token;
    // No token means no session to attribute this to. Dropped rather than
    // queued: telemetry must never be the reason a token-recovery flow runs.
    if (!csrf) return Promise.resolve(false);
    try {
      return Promise.resolve(send(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ events: batch })
      })).then(() => true, () => false);
    } catch { return Promise.resolve(false); }
  }

  return Object.freeze({
    record(metric, options = {}) {
      const name = String(metric || "");
      if (!name) return false;
      if (queue.length >= maximumQueued) {
        dropped = true;
        return false;
      }
      const event = { metric: name };
      if (Number.isFinite(Number(options.durationMs))) event.durationMs = Math.max(0, Math.round(Number(options.durationMs)));
      if (Number.isInteger(options.count) && options.count > 0) event.count = options.count;
      // Only the three dimension names the server recognises are even offered.
      // Anything else is not passed through and rejected later — it is never
      // constructed.
      const dimensions = {};
      for (const name_ of ["deviceClass", "outcome", "level"]) {
        if (options.dimensions?.[name_] !== undefined) dimensions[name_] = String(options.dimensions[name_]);
      }
      if (Object.keys(dimensions).length) event.dimensions = dimensions;
      queue.push(event);
      if (!timer) timer = scheduler.setTimeout?.(() => { timer = null; flush(); }, flushAfterMs);
      return true;
    },
    // Called when the scan ends, so the last events are not lost to the timer
    // never firing.
    flush,
    pendingCount: () => queue.length,
    droppedAny: () => dropped
  });
}

// A duration measured from a start marker, so a caller never has to hold a clock.
export function elapsedSince(startedAt, now = Date.now()) {
  const started = Number(startedAt);
  if (!Number.isFinite(started) || started <= 0) return null;
  const elapsed = now - started;
  return elapsed >= 0 ? elapsed : null;
}
