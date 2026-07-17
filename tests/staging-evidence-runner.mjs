import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { runStagingEvidence, stagingEvidenceConfirmation, validateStagingEvidenceEnvironment } from "../tools/staging-evidence-runner.mjs";

const recipient = "founder+homle-staging@staging.example";
const environment = Object.freeze({
  NODE_ENV: "production",
  MARKETPLACE_ENABLED: "true",
  STAGING_ACCOUNTS_ONLY: "true",
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
  HOMLE_STAGING_EVIDENCE_EMAIL: recipient
});
const confirmation = stagingEvidenceConfirmation(recipient);
assert.deepEqual(validateStagingEvidenceEnvironment(environment, confirmation), { recipient });
assert.throws(() => validateStagingEvidenceEnvironment(environment, "wrong"), /exactly confirm the approved staging mailbox/);
assert.throws(() => validateStagingEvidenceEnvironment({ ...environment, HOMLE_STAGING_EVIDENCE_EMAIL: "customer@staging.example" }, stagingEvidenceConfirmation("customer@staging.example")), /local part contains homle-staging/);

const uuids = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444"
];
let uuidIndex = 0;
const sourceChecksum = createHash("sha256").update(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=", "base64")).digest("hex");
const sanitizedBytes = Buffer.from("synthetic-sanitized-private-jpeg");
const sanitizedChecksum = createHash("sha256").update(sanitizedBytes).digest("hex");
const sent = [];
const deleted = [];
const fetched = [];
let emailClosed = 0;
let storageClosed = 0;
let adapterClosed = 0;
let monitoringCalls = 0;

const result = await runStagingEvidence({
  env: environment,
  confirmation,
  now: () => new Date("2026-07-17T12:00:00.000Z"),
  uuid: () => uuids[uuidIndex++],
  async loadAdapters(env) {
    assert.equal(env, environment);
    return {
      async onUnexpectedError(error, context) {
        monitoringCalls += 1;
        assert.equal(error.code, "homle-staging-evidence");
        assert.deepEqual(context, { component: "staging-evidence", operation: "synthetic-alert", job: "launch-readiness", consecutiveFailures: 1 });
        return true;
      },
      async close() { adapterClosed += 1; }
    };
  },
  async createEmail(env, options) {
    assert.equal(env, environment);
    assert.equal(typeof options.onUnexpectedError, "function");
    return {
      async verify() { return true; },
      async send(input) { sent.push(input); return { accepted: true }; },
      async close() { emailClosed += 1; }
    };
  },
  async createStorage(env, options) {
    assert.equal(env, environment);
    assert.equal(typeof options.onUnexpectedError, "function");
    return {
      async verify() { return true; },
      async createUploadUrl(input) {
        assert.equal(input.checksumSha256, sourceChecksum);
        return { url: "https://objects.staging.example/upload", requiredHeaders: { "Content-Type": "image/png" } };
      },
      async headObject({ storageKey }) {
        return storageKey.startsWith("quarantine/")
          ? { mimeType: "image/png", byteSize: 68, checksumSha256: sourceChecksum }
          : { mimeType: "image/jpeg", byteSize: sanitizedBytes.length, checksumSha256: sanitizedChecksum };
      },
      async inspectAndSanitizeImage(input) {
        assert.equal(input.stripMetadata, true);
        return { safe: true, outputMimeType: "image/jpeg", outputChecksumSha256: sanitizedChecksum };
      },
      async createReadUrl() { return { url: "https://objects.staging.example/read" }; },
      async deleteObject({ storageKey }) { deleted.push(storageKey); },
      async close() { storageClosed += 1; }
    };
  },
  async fetch(url, options) {
    fetched.push({ url, options });
    return url.endsWith("/upload") ? new Response(null, { status: 200 }) : new Response(sanitizedBytes, { status: 200 });
  }
});
assert.equal(result.ok, true);
assert.deepEqual(result.evidence, { emailAccepted: true, privateImageUploaded: true, privateImageSanitized: true, privateImageReadVerified: true, monitoringDeliveryAccepted: true });
assert.deepEqual(result.cleanup, { quarantineDeleted: true, finalDeleted: true });
assert.equal(result.paymentsContacted, false);
assert.equal(result.oauthProvidersContacted, false);
const serializedResult = JSON.stringify(result);
assert.equal(serializedResult.includes(recipient), false, "Evidence output exposed the approved private mailbox.");
assert.equal(serializedResult.includes(uuids[0]), false, "Evidence output exposed a private storage identifier.");
assert.equal(serializedResult.includes(uuids[1]), false, "Evidence output exposed a private storage identifier.");
assert.equal(sent.length, 2);
assert.deepEqual(sent.map((entry) => entry.kind), ["email-verification", "password-reset"]);
assert(sent.every((entry) => entry.recipient === recipient && entry.link.startsWith(environment.APP_ORIGIN) && entry.link.includes("#token=")));
assert.equal(fetched[0].options.method, "PUT");
assert.equal(fetched[1].options.method, "GET");
assert.equal(deleted.length, 2);
assert(deleted[0].startsWith("quarantine/request-photos/") && deleted[1].startsWith("request-photos/"));
assert.equal(monitoringCalls, 1);
assert.equal(emailClosed, 1);
assert.equal(storageClosed, 1);
assert.equal(adapterClosed, 1);

const failureDeleted = [];
let failureClosed = 0;
await assert.rejects(runStagingEvidence({
  env: environment,
  confirmation,
  uuid: (() => { let index = 0; return () => uuids[index++]; })(),
  async loadAdapters() { return { async onUnexpectedError() { return true; }, async close() { failureClosed += 1; } }; },
  async createEmail() { return { async verify() {}, async send() { return { accepted: true }; }, async close() { failureClosed += 1; } }; },
  async createStorage() {
    return {
      async verify() {},
      async createUploadUrl() { return { url: "https://objects.staging.example/upload", requiredHeaders: {} }; },
      async headObject() {}, async inspectAndSanitizeImage() {}, async createReadUrl() {},
      async deleteObject({ storageKey }) { failureDeleted.push(storageKey); },
      async close() { failureClosed += 1; }
    };
  },
  async fetch() { return new Response(null, { status: 503 }); }
}), /cleanup was incomplete|Staging evidence failed/);
assert.equal(failureDeleted.length, 2, "A failed upload did not attempt cleanup of both private keys.");
assert.equal(failureClosed, 3, "A failed staging proof did not close all adapters.");

let cleanupFailureClosed = 0;
await assert.rejects(runStagingEvidence({
  env: environment,
  confirmation,
  uuid: (() => { let index = 0; return () => uuids[index++]; })(),
  async loadAdapters() { return { async onUnexpectedError() { return true; }, async close() { cleanupFailureClosed += 1; } }; },
  async createEmail() { return { async verify() {}, async send() { return { accepted: true }; }, async close() { cleanupFailureClosed += 1; } }; },
  async createStorage() {
    return {
      async verify() {},
      async createUploadUrl() { return { url: "https://objects.staging.example/upload", requiredHeaders: {} }; },
      async headObject({ storageKey }) {
        return storageKey.startsWith("quarantine/")
          ? { mimeType: "image/png", byteSize: 68, checksumSha256: sourceChecksum }
          : { mimeType: "image/jpeg", byteSize: sanitizedBytes.length, checksumSha256: sanitizedChecksum };
      },
      async inspectAndSanitizeImage() { return { safe: true, outputMimeType: "image/jpeg", outputChecksumSha256: sanitizedChecksum }; },
      async createReadUrl() { return { url: "https://objects.staging.example/read" }; },
      async deleteObject({ storageKey }) { if (storageKey.startsWith("request-photos/")) throw new Error("synthetic cleanup refusal"); },
      async close() { cleanupFailureClosed += 1; }
    };
  },
  async fetch(url) { return url.endsWith("/upload") ? new Response(null, { status: 200 }) : new Response(sanitizedBytes, { status: 200 }); }
}), /cleanup was incomplete/);
assert.equal(cleanupFailureClosed, 3, "A cleanup failure did not close all adapters.");

let guardFactories = 0;
await assert.rejects(runStagingEvidence({
  env: { ...environment, PAYMENTS_ENABLED: "true" },
  confirmation,
  async loadAdapters() { guardFactories += 1; }
}), /must be false/);
assert.equal(guardFactories, 0, "A staging safety guard contacted a service before rejection.");

console.log("Staging evidence runner tests passed: approved mailbox confirmation, two synthetic emails, signed private-image round trip, monitoring delivery, payment/OAuth isolation, cleanup on success/failure and deterministic shutdown.");
