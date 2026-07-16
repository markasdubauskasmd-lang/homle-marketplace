import assert from "node:assert/strict";
import {
  builtInMonitoringAdapter,
  createMarketplaceDeploymentAdapters,
  createMonitoringWebhook,
  validateMonitoringWebhookEnvironment
} from "../src/marketplace/monitoring-webhook.mjs";

assert.equal(builtInMonitoringAdapter, "homle:monitoring-webhook");
assert.equal(validateMonitoringWebhookEnvironment({}).ok, false);
assert.equal(validateMonitoringWebhookEnvironment({
  MONITORING_WEBHOOK_URL: "https://monitoring.example.com/events",
  MONITORING_WEBHOOK_TOKEN: "private-monitoring-token-with-32-characters",
  MONITORING_WEBHOOK_TIMEOUT_MS: "5000"
}).ok, true);
assert(validateMonitoringWebhookEnvironment({
  MONITORING_WEBHOOK_URL: "http://monitoring.example.com/events#secret",
  MONITORING_WEBHOOK_TOKEN: "short",
  MONITORING_WEBHOOK_TIMEOUT_MS: "50"
}).errors.length === 3);

const requests = [];
const fallbacks = [];
const monitoring = createMonitoringWebhook({
  endpoint: "https://monitoring.example.com/homle/events",
  token: "private-monitoring-token-with-32-characters",
  timeoutMs: 1000,
  now: () => new Date("2026-07-17T00:00:00.000Z"),
  eventId: () => "11111111-1111-4111-8111-111111111111",
  fallback: (value) => fallbacks.push(value),
  async fetch(url, options) {
    requests.push({ url, options });
    return new Response(null, { status: 202 });
  }
});
const privateError = Object.assign(new Error("SMTP rejected customer@example.com using secret abc123 for booking 22222222-2222-4222-8222-222222222222"), { code: "ECONNRESET" });
assert.equal(await monitoring.onUnexpectedError(privateError, {
  component: "marketplace-worker",
  operation: "deliver-email",
  job: "email-notifications",
  consecutiveFailures: 2,
  customerEmail: "customer@example.com",
  bookingId: "22222222-2222-4222-8222-222222222222"
}), true);
assert.equal(requests.length, 1);
assert.equal(requests[0].url, "https://monitoring.example.com/homle/events");
assert.equal(requests[0].options.method, "POST");
assert.equal(requests[0].options.redirect, "error");
assert.equal(requests[0].options.headers.authorization, "Bearer private-monitoring-token-with-32-characters");
const payload = JSON.parse(requests[0].options.body);
assert.deepEqual(payload, {
  schemaVersion: 1,
  eventId: "11111111-1111-4111-8111-111111111111",
  eventType: "unexpected-error",
  service: "homle-marketplace",
  environment: "production",
  occurredAt: "2026-07-17T00:00:00.000Z",
  error: {
    type: "error",
    fingerprintSha256: payload.error.fingerprintSha256,
    code: "econnreset"
  },
  context: {
    component: "marketplace-worker",
    operation: "deliver-email",
    job: "email-notifications",
    consecutiveFailures: 2
  }
});
assert.match(payload.error.fingerprintSha256, /^[0-9a-f]{64}$/);
const serialized = JSON.stringify(payload);
for (const privateValue of ["customer@example.com", "abc123", "22222222-2222-4222-8222-222222222222", "customerEmail", "bookingId"]) {
  assert.equal(serialized.includes(privateValue), false, `Monitoring payload exposed ${privateValue}.`);
}
assert.deepEqual(fallbacks, []);
await monitoring.close();
assert.equal(await monitoring.onUnexpectedError(new Error("after close")), false);

const failedFallbacks = [];
const failed = createMonitoringWebhook({
  endpoint: "https://monitoring.example.com/events",
  token: "another-private-monitoring-token-32-characters",
  fallback: (value) => failedFallbacks.push(value),
  async fetch() { return new Response(null, { status: 503 }); }
});
assert.equal(await failed.onUnexpectedError(new Error("private provider outage")), false);
assert.equal(failedFallbacks.length, 1);
assert.deepEqual(Object.keys(failedFallbacks[0]).sort(), ["event", "eventId", "service"]);
assert.equal(JSON.stringify(failedFallbacks).includes("private provider outage"), false);
await failed.close();

const factory = await createMarketplaceDeploymentAdapters({ env: {
  MONITORING_WEBHOOK_URL: "https://monitoring.example.com/events",
  MONITORING_WEBHOOK_TOKEN: "factory-private-monitoring-token-32-characters"
} });
assert.equal(typeof factory.onUnexpectedError, "function");
assert.equal(typeof factory.close, "function");
await factory.close();

console.log("Monitoring webhook tests passed: HTTPS-only configuration, privacy-minimal fingerprints, bounded context, credential isolation, failure fallback and deterministic shutdown.");
