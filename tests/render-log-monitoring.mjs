import assert from "node:assert/strict";
import {
  builtInRenderLogMonitoringAdapter,
  createMarketplaceDeploymentAdapters,
  createRenderLogMonitoring,
  validateRenderLogMonitoringEnvironment
} from "../src/marketplace/render-log-monitoring.mjs";

const env = Object.freeze({
  NODE_ENV: "production",
  RENDER: "true",
  RENDER_SERVICE_TYPE: "web",
  RENDER_LOG_MONITORING_ACKNOWLEDGED: "true"
});
assert.equal(builtInRenderLogMonitoringAdapter, "homle:render-log-monitoring");
assert.equal(validateRenderLogMonitoringEnvironment(env).ok, true);
for (const invalid of [
  { ...env, NODE_ENV: "development" },
  { ...env, RENDER: "false" },
  { ...env, RENDER_SERVICE_TYPE: "" },
  { ...env, RENDER_LOG_MONITORING_ACKNOWLEDGED: "false" }
]) assert.equal(validateRenderLogMonitoringEnvironment(invalid).ok, false);

const lines = [];
const monitoring = createRenderLogMonitoring({
  env,
  write(line) { lines.push(line); },
  now: () => new Date("2026-07-17T12:00:00.000Z"),
  eventId: () => "11111111-1111-4111-8111-111111111111"
});
const privateError = Object.assign(new Error("Failed for owner@example.com at 10 Private Lane using token private-token"), { code: "ECONNRESET" });
assert.equal(await monitoring.onUnexpectedError(privateError, {
  component: "marketplace-worker",
  operation: "deliver-email",
  job: "email-notifications",
  consecutiveFailures: 2,
  email: "owner@example.com",
  address: "10 Private Lane"
}), true);
assert.equal(lines.length, 1);
const record = JSON.parse(lines[0]);
assert.equal(record.channel, "render-log");
assert.equal(record.service, "homle-marketplace");
assert.equal(record.eventId, "11111111-1111-4111-8111-111111111111");
assert.equal(record.error.code, "econnreset");
assert.match(record.error.fingerprintSha256, /^[0-9a-f]{64}$/);
assert.deepEqual(record.context, { component: "marketplace-worker", operation: "deliver-email", job: "email-notifications", consecutiveFailures: 2 });
for (const privateValue of ["owner@example.com", "10 Private Lane", "private-token"]) assert.equal(lines[0].includes(privateValue), false);
assert.equal(Object.hasOwn(record.context, "email"), false);
assert.equal(Object.hasOwn(record.context, "address"), false);
await monitoring.close();
assert.equal(await monitoring.onUnexpectedError(new Error("after close")), false);

const failed = createRenderLogMonitoring({ env, write() { throw new Error("private logging failure"); } });
assert.equal(await failed.onUnexpectedError(new Error("private source failure")), false);
await failed.close();

const factory = await createMarketplaceDeploymentAdapters({ env });
assert.equal(typeof factory.onUnexpectedError, "function");
assert.equal(typeof factory.close, "function");
await factory.close();

console.log("Render log monitoring tests passed: platform binding, explicit acknowledgement, privacy-minimal fingerprints, bounded context, write-failure isolation and deterministic close.");
