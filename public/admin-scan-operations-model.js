// The telemetry endpoint deliberately returns only anonymous counters and
// bucketed timings. Keep the interpretation here pure so the operational page
// can be tested without a browser or access to private marketplace records.

const latencyBuckets = [
  "0-250ms", "250-500ms", "500-1000ms", "1000-2000ms", "2000-4000ms",
  "4000-8000ms", "8000-15000ms", "15000-30000ms", "30000-60000ms",
  "60000-120000ms", "120000-300000ms", "300000ms+"
];

function countForPrefix(values, metric) {
  return Object.entries(values || {}).reduce((total, [key, value]) => {
    if (key !== metric && !key.startsWith(`${metric}|`)) return total;
    const count = Number(value);
    return Number.isFinite(count) && count >= 0 ? total + count : total;
  }, 0);
}

export function scanTimingSummary(snapshot, metric = "scan.reading.latency_ms") {
  const totals = new Map(latencyBuckets.map((bucket) => [bucket, 0]));
  for (const [key, value] of Object.entries(snapshot?.timings || {})) {
    if (!key.startsWith(`${metric}|`)) continue;
    const bucket = key.slice(key.lastIndexOf("|") + 1);
    if (!totals.has(bucket)) continue;
    const count = Number(value);
    if (Number.isFinite(count) && count >= 0) totals.set(bucket, totals.get(bucket) + count);
  }
  const buckets = latencyBuckets.map((bucket) => ({ bucket, count: totals.get(bucket) }));
  const total = buckets.reduce((sum, entry) => sum + entry.count, 0);
  // Eight seconds is the first bucket where a person is likely to wonder if a
  // room read stalled. This is an operational attention threshold, not an SLA.
  const slowCount = buckets.slice(latencyBuckets.indexOf("8000-15000ms"))
    .reduce((sum, entry) => sum + entry.count, 0);
  return { total, slowCount, slowRate: total ? slowCount / total : null, buckets };
}

export function scanOperationalWarnings(snapshot) {
  const counters = snapshot?.counters || {};
  const definitions = [
    ["scan.camera.denied", "camera-denied", "Camera permission was denied", "Check the mobile permission guidance before changing detection."],
    ["scan.camera.unavailable", "camera-unavailable", "The camera could not open", "Check browser and device compatibility before asking the customer to retry."],
    ["scan.detector.unavailable", "detector-unavailable", "On-device detection did not start", "Guided capture can continue, but automatic item feedback may be missing."],
    ["scan.reading.unavailable", "reading-unavailable", "Assisted room reading was unavailable", "Check provider readiness and model access."],
    ["scan.reading.failed", "reading-failed", "Assisted room reading failed", "Inspect provider and timeout logs before changing the customer flow."],
    ["scan.upload.failed", "upload-failed", "Private photo upload failed", "Rehearse object storage and the mobile network path."],
    ["scan.crash", "scanner-crash", "A scanner crash was recorded", "Inspect the release and browser evidence before the next rollout."]
  ];
  return definitions.flatMap(([metric, code, title, guidance]) => {
    const count = countForPrefix(counters, metric);
    return count ? [{ metric, code, title, guidance, count }] : [];
  });
}
