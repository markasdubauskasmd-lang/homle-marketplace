import assert from "node:assert/strict";
import {
  probeMarketplaceStagingActivation,
  stagingMarketplaceActivationProbeConfirmation
} from "../tools/staging-marketplace-activation-probe.mjs";

const environment = Object.freeze({
  NODE_ENV: "production",
  MARKETPLACE_ENABLED: "true",
  STAGING_ACCOUNTS_ONLY: "true",
  PAYMENTS_ENABLED: "true",
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
  GOOGLE_CLIENT_SECRET: "private-google-client-secret",
  STRIPE_SECRET_KEY: `sk_test_${"a".repeat(32)}`,
  STRIPE_PUBLISHABLE_KEY: `pk_test_${"b".repeat(32)}`,
  STRIPE_WEBHOOK_SECRET: `whsec_${"c".repeat(32)}`
});

let attachmentCalls = 0;
let closeCalls = 0;
const result = await probeMarketplaceStagingActivation({
  env: environment,
  confirmation: stagingMarketplaceActivationProbeConfirmation,
  async createAttachment({ env }) {
    attachmentCalls += 1;
    assert.equal(env, environment);
    return {
      enabled: true,
      ready: true,
      authenticationHttpReady: true,
      paymentsReady: true,
      authenticationCapabilities: { emailPassword: true, emailVerification: true, passwordReset: true, google: true, apple: false, facebook: false },
      async close() { closeCalls += 1; }
    };
  }
});
assert.equal(attachmentCalls, 1);
assert.equal(closeCalls, 1);
assert.equal(result.ok, true);
assert.deepEqual(result.database, { database: "acme_homle_staging", role: "tideway_app", tls: "verified-tls" });
assert.equal(result.probes.stripeTestPlatform, true);
assert.equal(result.probes.businessRecordsCreated, false);
assert.equal(result.probes.paymentObjectsCreated, false);
assert.deepEqual(result.providers.stripe, { ready: true, testMode: true });
assert.equal(result.nextEvidence.length, 4);
const serialized = JSON.stringify(result);
for (const value of [environment.DATABASE_URL, environment.SMTP_URL, environment.SESSION_SECRET, environment.OBJECT_STORAGE_SECRET_ACCESS_KEY, environment.STRIPE_SECRET_KEY, environment.STRIPE_WEBHOOK_SECRET]) {
  assert(!serialized.includes(value), "The activation report exposed a private staging credential.");
}

let guardedAttachmentCalls = 0;
async function guardedAttachment() { guardedAttachmentCalls += 1; throw new Error("must not contact services"); }
for (const [override, confirmation, pattern] of [
  [{}, "wrong", /PROBE HOMLE MANAGED STAGING BOOKINGS AND TEST PAYMENTS/],
  [{ PAYMENTS_ENABLED: "false" }, stagingMarketplaceActivationProbeConfirmation, /must be true/],
  [{ MARKETPLACE_ENABLED: "false" }, stagingMarketplaceActivationProbeConfirmation, /MARKETPLACE_ENABLED/],
  [{ STRIPE_SECRET_KEY: `sk_live_${"a".repeat(32)}` }, stagingMarketplaceActivationProbeConfirmation, /test secret key|live keys/i],
  [{ STRIPE_WEBHOOK_SECRET: "" }, stagingMarketplaceActivationProbeConfirmation, /STRIPE_WEBHOOK_SECRET|partially configured/],
  [{ OBJECT_STORAGE_SECRET_ACCESS_KEY: "" }, stagingMarketplaceActivationProbeConfirmation, /Object storage is partially configured|private object-storage/]
]) {
  await assert.rejects(probeMarketplaceStagingActivation({ env: { ...environment, ...override }, confirmation, createAttachment: guardedAttachment }), pattern);
}
assert.equal(guardedAttachmentCalls, 0, "An activation guard contacted a provider before rejecting unsafe configuration.");

let invalidCloseCalls = 0;
await assert.rejects(probeMarketplaceStagingActivation({
  env: environment,
  confirmation: stagingMarketplaceActivationProbeConfirmation,
  async createAttachment() {
    return {
      enabled: true,
      ready: true,
      authenticationHttpReady: true,
      paymentsReady: false,
      authenticationCapabilities: { emailPassword: true, emailVerification: true, passwordReset: true },
      async close() { invalidCloseCalls += 1; }
    };
  }
}), /did not compose ready booking/);
assert.equal(invalidCloseCalls, 1, "A failed activation composition was not closed.");

console.log("Managed staging activation probe tests passed: complete booking dependencies, Stripe test-only readiness, zero business/payment writes, exact confirmation, fail-closed guards, secret-free evidence and deterministic cleanup.");
