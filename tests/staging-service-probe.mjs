import assert from "node:assert/strict";
import {
  probeMarketplaceStagingServices,
  sanitizeStagingServiceProbeError,
  stagingServiceProbeConfirmation,
  validateStagingServiceProbeEnvironment
} from "../tools/staging-service-probe.mjs";

const environment = Object.freeze({
  NODE_ENV: "production",
  MARKETPLACE_ENABLED: "true",
  PAYMENTS_ENABLED: "false",
  DATABASE_URL: "postgresql://tideway_app:private-db-password@db.staging.example:5432/acme_homle_staging?sslmode=verify-full",
  REALTIME_DATABASE_URL: "postgresql://tideway_app:private-db-password@db-direct.staging.example:5432/acme_homle_staging?sslmode=verify-full",
  SESSION_SECRET: "session-secret-is-long-private-and-distinct-01",
  AUTH_TOKEN_SECRET: "authentication-token-is-long-private-and-distinct-02",
  DATA_ENCRYPTION_KEY: "data-encryption-is-long-private-and-distinct-03",
  APP_ORIGIN: "https://staging.homle.example",
  SMTP_URL: "smtps://mailer:private-mail-password@smtp.staging.example:465",
  EMAIL_FROM: "Homle staging <test@staging.homle.example>",
  OBJECT_STORAGE_ENDPOINT: "https://objects.staging.example",
  OBJECT_STORAGE_BUCKET: "homle-private-staging",
  OBJECT_STORAGE_REGION: "eu-west-2",
  OBJECT_STORAGE_ACCESS_KEY_ID: "private-storage-access-key",
  OBJECT_STORAGE_SECRET_ACCESS_KEY: "private-storage-secret-key",
  MARKETPLACE_ADAPTER_MODULE: "homle:monitoring-webhook",
  MONITORING_WEBHOOK_URL: "https://monitoring.staging.example/events",
  MONITORING_WEBHOOK_TOKEN: "private-monitoring-token-is-long-enough-04",
  GOOGLE_CLIENT_ID: "staging-google-client.apps.exampleusercontent.com",
  GOOGLE_CLIENT_SECRET: "private-google-client-secret"
});

const validated = validateStagingServiceProbeEnvironment(environment, stagingServiceProbeConfirmation);
assert.deepEqual(validated.database, { database: "acme_homle_staging", role: "tideway_app", tls: "verified-tls" });
assert.deepEqual(validated.providersConfigured, { google: true, facebook: false });

const renderInternalEnvironment = {
  ...environment,
  RENDER: "true",
  RENDER_SERVICE_TYPE: "web",
  DATABASE_URL: "postgresql://tideway_app:private-db-password@dpg-d9csr9b7uimc73f0m8d0-a:5432/acme_homle_staging",
  REALTIME_DATABASE_URL: "postgresql://tideway_app:private-db-password@dpg-d9csr9b7uimc73f0m8d0-a:5432/acme_homle_staging"
};
assert.deepEqual(validateStagingServiceProbeEnvironment(renderInternalEnvironment, stagingServiceProbeConfirmation).database, { database: "acme_homle_staging", role: "tideway_app", tls: "render-private-network" });

let attachmentCalls = 0;
let closeCalls = 0;
const result = await probeMarketplaceStagingServices({
  env: environment,
  confirmation: stagingServiceProbeConfirmation,
  async createAttachment({ env }) {
    attachmentCalls += 1;
    assert.equal(env, environment);
    return {
      enabled: true,
      ready: true,
      authenticationHttpReady: true,
      paymentsReady: false,
      authenticationCapabilities: { emailPassword: true, emailVerification: true, passwordReset: true, google: true, facebook: false },
      async close() { closeCalls += 1; }
    };
  }
});
assert.equal(attachmentCalls, 1);
assert.equal(closeCalls, 1);
assert.equal(result.ok, true);
assert.equal(result.probes.paymentsContacted, false);
assert.deepEqual(result.providers, { google: true, facebook: false, apple: false });
assert.equal(result.nextEvidence.length, 4);
const serialized = JSON.stringify(result);
for (const value of [environment.DATABASE_URL, environment.SMTP_URL, environment.SESSION_SECRET, environment.OBJECT_STORAGE_SECRET_ACCESS_KEY]) assert(!serialized.includes(value));

let guardedAttachmentCalls = 0;
async function guardedAttachment() { guardedAttachmentCalls += 1; throw new Error("must not run"); }
for (const [override, confirmation, pattern] of [
  [{}, "wrong", /Set HOMLE_STAGING_SERVICE_PROBE_CONFIRMATION/],
  [{ PAYMENTS_ENABLED: "true" }, stagingServiceProbeConfirmation, /must be false/],
  [{ DATABASE_URL: environment.DATABASE_URL.replace("tideway_app", "migration_owner") }, stagingServiceProbeConfirmation, /authenticate as tideway_app/],
  [{ DATABASE_URL: environment.DATABASE_URL.replace("acme_homle_staging", "homle_production") }, stagingServiceProbeConfirmation, /must end in/],
  [{ DATABASE_URL: environment.DATABASE_URL.replace("sslmode=verify-full", "sslmode=require") }, stagingServiceProbeConfirmation, /verify-full/],
  [{ DATABASE_URL: environment.DATABASE_URL.replace("db.staging.example", "127.0.0.1") }, stagingServiceProbeConfirmation, /refuses a local/],
  [{ REALTIME_DATABASE_URL: environment.REALTIME_DATABASE_URL.replace("tideway_app", "migration_owner") }, stagingServiceProbeConfirmation, /authenticate as tideway_app/],
  [{ REALTIME_DATABASE_URL: environment.REALTIME_DATABASE_URL.replace("acme_homle_staging", "other_homle_staging") }, stagingServiceProbeConfirmation, /same managed staging database/],
  [{ REALTIME_DATABASE_URL: environment.REALTIME_DATABASE_URL.replace("verify-full", "require") }, stagingServiceProbeConfirmation, /REALTIME_DATABASE_URL.*verify-full/],
  [{ SMTP_URL: "" }, stagingServiceProbeConfirmation, /email provider/]
]) {
  await assert.rejects(probeMarketplaceStagingServices({ env: { ...environment, ...override }, confirmation, createAttachment: guardedAttachment }), pattern);
}
assert.equal(guardedAttachmentCalls, 0, "A staging safety guard contacted a service before rejecting the environment.");

let invalidCloseCalls = 0;
await assert.rejects(probeMarketplaceStagingServices({
  env: environment,
  confirmation: stagingServiceProbeConfirmation,
  async createAttachment() {
    return { enabled: true, ready: true, authenticationHttpReady: true, paymentsReady: true, authenticationCapabilities: {}, async close() { invalidCloseCalls += 1; } };
  }
}), /payments disabled/);
assert.equal(invalidCloseCalls, 1, "An invalid staging attachment was not closed.");

const unsafe = new Error(`Connection failed for ${environment.DATABASE_URL}; SMTP ${environment.SMTP_URL}; key ${environment.OBJECT_STORAGE_SECRET_ACCESS_KEY}`);
const sanitized = sanitizeStagingServiceProbeError(unsafe, environment);
assert(!sanitized.includes("private-db-password") && !sanitized.includes("private-mail-password") && !sanitized.includes(environment.OBJECT_STORAGE_SECRET_ACCESS_KEY));
assert.match(sanitized, /redacted/);

console.log("Managed staging service probe tests passed: exact confirmation, verified external TLS or trusted Render private transport, staging-only database, tideway_app identity, payment isolation, complete composition, deterministic close and secret-safe evidence.");
