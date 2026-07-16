import assert from "node:assert/strict";
import { createMarketplaceAttachment, loadMarketplaceDeploymentAdapters, probeMarketplaceDatabase } from "../src/marketplace/attachment.mjs";

const completeEnvironment = Object.freeze({
  MARKETPLACE_ENABLED: "true",
  DATABASE_URL: "postgresql://tideway_app:secret@db.example/tideway",
  SESSION_SECRET: "session-secret-is-more-than-thirty-two-characters",
  AUTH_TOKEN_SECRET: "auth-token-secret-is-different-and-long-enough",
  DATA_ENCRYPTION_KEY: "encryption-secret-is-also-different-and-long",
  APP_ORIGIN: "https://staging.tideway.example",
  SMTP_URL: "smtps://mailer.example",
  EMAIL_FROM: "Tideway <test@invalid.example>",
  OBJECT_STORAGE_ENDPOINT: "https://objects.example",
  OBJECT_STORAGE_BUCKET: "tideway-private-test",
  OBJECT_STORAGE_REGION: "eu-west-2",
  OBJECT_STORAGE_ACCESS_KEY_ID: "test-key",
  OBJECT_STORAGE_SECRET_ACCESS_KEY: "test-secret",
  GOOGLE_CLIENT_ID: "configured-but-not-attached",
  GOOGLE_CLIENT_SECRET: "configured-but-not-attached-secret",
  FACEBOOK_APP_ID: "123456789012345",
  FACEBOOK_APP_SECRET: "abcdef0123456789abcdef0123456789",
  FACEBOOK_GRAPH_API_VERSION: "v99.0"
});

const adapters = Object.freeze({
  onUnexpectedError() {}
});

let adapterLoaded = false;
const disabled = await createMarketplaceAttachment({
  env: {},
  async loadAdapters() { adapterLoaded = true; throw new Error("must not load"); },
  async createPool() { throw new Error("must not connect"); }
});
assert.equal(disabled.enabled, false);
assert.equal(disabled.ready, false);
assert.equal(disabled.router, null);
assert.equal(disabled.paymentsReady, false);
assert.equal(adapterLoaded, false);
assert.ok(Object.values(disabled.authenticationCapabilities).filter((value) => value === true).length === 0);

await assert.rejects(createMarketplaceAttachment({ env: { MARKETPLACE_ENABLED: "sometimes" } }), /must be true or false/);
await assert.rejects(createMarketplaceAttachment({ env: { MARKETPLACE_ENABLED: "true" }, adapters }), /requires database, session, token, encryption and exact-origin/);
await assert.rejects(loadMarketplaceDeploymentAdapters({ MARKETPLACE_ADAPTER_MODULE: "relative-adapter.mjs" }), /absolute file path/);

let invalidProxyLoadedAdapters = false;
await assert.rejects(createMarketplaceAttachment({
  env: { ...completeEnvironment, TRUST_PROXY: "true" },
  adapters: undefined,
  async loadAdapters() { invalidProxyLoadedAdapters = true; throw new Error("must not load"); }
}), /TRUSTED_PROXY_CIDRS is required/);
assert.equal(invalidProxyLoadedAdapters, false, "Invalid proxy trust loaded deployment adapters before failing closed.");

let released = 0;
let ended = 0;
let realtimeClosed = 0;
let smtpVerified = 0;
let smtpClosed = 0;
let storageVerified = 0;
let storageClosed = 0;
const probeQueries = [];
const pool = {
  async connect() {
    return {
      async query(sql) {
        probeQueries.push(sql);
        return { rows: [{ database_role: "tideway_app", server_version_num: 160004, role_is_safe: true, lookup_session_ready: true, booking_workflow_ready: true, rate_limit_ready: true, facebook_pending_identity_ready: true, payment_ledger_ready: true, payment_access_ready: true }] };
      },
      release() { released += 1; }
    };
  },
  async end() { ended += 1; }
};
const router = { async handle() { return true; } };
const sharedRateLimiter = { async consume() { return { allowed: true }; } };
const emailDelivery = { async verify() { smtpVerified += 1; }, async send() {}, close() { smtpClosed += 1; } };
const objectStorage = { async verify() { storageVerified += 1; }, async createUploadUrl() {}, async headObject() {}, async inspectAndSanitizeImage() {}, async createReadUrl() {}, async deleteObject() {}, close() { storageClosed += 1; } };
const trustedClientKey = () => "direct:ipv4:198.51.100.10";
let limiterCreated = 0;
let clientKeyCreated = 0;
const attachment = await createMarketplaceAttachment({
  env: completeEnvironment,
  adapters,
  async createPool() { return pool; },
  async createEmailDelivery(selectedEnvironment, options) {
    assert.equal(selectedEnvironment, completeEnvironment);
    assert.equal(options.onUnexpectedError, adapters.onUnexpectedError);
    return emailDelivery;
  },
  async createObjectStorage(selectedEnvironment, options) {
    assert.equal(selectedEnvironment, completeEnvironment);
    assert.equal(options.onUnexpectedError, adapters.onUnexpectedError);
    return objectStorage;
  },
  createClientKeyResolver(selectedEnvironment) {
    clientKeyCreated += 1;
    assert.equal(selectedEnvironment, completeEnvironment);
    return trustedClientKey;
  },
  createRateLimiter(selectedPool, options) {
    limiterCreated += 1;
    assert.equal(selectedPool, pool);
    assert.equal(options.secret, completeEnvironment.SESSION_SECRET);
    return sharedRateLimiter;
  },
  createRuntime(selectedPool, options) {
    assert.equal(selectedPool, pool);
    assert.equal(options.rateLimiter, sharedRateLimiter);
    assert.equal(options.clientKey, trustedClientKey);
    assert.equal(options.emailDelivery, emailDelivery);
    assert.equal(options.objectStorage, objectStorage);
    return {
      router,
      authenticationHttpReady: true,
      googleOidcReady: true,
      facebookLoginReady: true,
      realtimeSignalSource: { async close() { realtimeClosed += 1; } }
    };
  }
});
assert.equal(attachment.enabled, true);
assert.equal(attachment.ready, true);
assert.equal(attachment.router, router);
assert.equal(limiterCreated, 1);
assert.equal(clientKeyCreated, 1);
assert.equal(smtpVerified, 1);
assert.equal(storageVerified, 1);
assert.equal(released, 1);
assert.ok(probeQueries[0].includes("current_user") && probeQueries[0].includes("tideway_private.lookup_session"));
assert.equal(attachment.authenticationCapabilities.emailPassword, true);
assert.equal(attachment.authenticationCapabilities.passwordReset, true);
assert.equal(attachment.authenticationCapabilities.emailVerification, true);
assert.equal(attachment.authenticationCapabilities.google, true, "A configured and attached Google callback router was not advertised truthfully.");
assert.equal(attachment.authenticationCapabilities.facebook, true, "A configured and attached Facebook callback plus mailbox-verification router was not advertised truthfully.");
assert.equal(attachment.paymentsReady, false, "Payments appeared attached without the explicit payment switch.");
await attachment.close();
await attachment.close();
assert.equal(realtimeClosed, 1);
assert.equal(smtpClosed, 1);
assert.equal(storageClosed, 1);
assert.equal(ended, 1);

let paymentAdapterVerified = 0;
let paymentProviderConfiguration;
const paymentEnvironment = Object.freeze({ ...completeEnvironment, PAYMENTS_ENABLED: "true", STRIPE_SECRET_KEY: `sk_test_${"a".repeat(32)}`, STRIPE_PUBLISHABLE_KEY: `pk_test_${"c".repeat(32)}`, STRIPE_WEBHOOK_SECRET: `whsec_${"b".repeat(32)}` });
const paymentAttachment = await createMarketplaceAttachment({
  env: paymentEnvironment,
  adapters,
  async createPool() { return { async end() {} }; },
  async probeDatabase() {},
  async createEmailDelivery() { return { async verify() {}, async send() {}, async close() {} }; },
  async createObjectStorage() { return { async verify() {}, async createUploadUrl() {}, async headObject() {}, async inspectAndSanitizeImage() {}, async createReadUrl() {}, async deleteObject() {}, async close() {} }; },
  createClientKeyResolver() { return trustedClientKey; },
  createRateLimiter() { return sharedRateLimiter; },
  async createPaymentProvider(configuration) {
    paymentProviderConfiguration = configuration;
    return { name: "stripe", async verify() { paymentAdapterVerified += 1; return { ready: true, testMode: true }; } };
  },
  createRuntime(selectedPool, options) {
    assert.equal(options.paymentProvider.name, "stripe");
    return { router, authenticationHttpReady: true, googleOidcReady: true, facebookLoginReady: true, paymentReady: true, realtimeSignalSource: { async close() {} } };
  }
});
assert.equal(paymentAttachment.paymentsReady, true);
assert.equal(paymentAdapterVerified, 1);
assert.equal(paymentProviderConfiguration.secretKey, paymentEnvironment.STRIPE_SECRET_KEY);
assert.equal(paymentProviderConfiguration.webhookSecret, paymentEnvironment.STRIPE_WEBHOOK_SECRET);
await paymentAttachment.close();

let unsafeReleased = 0;
await assert.rejects(probeMarketplaceDatabase({
  async connect() {
    return {
      async query() { return { rows: [{ database_role: "migration_owner", server_version_num: 160000, role_is_safe: true, lookup_session_ready: true, booking_workflow_ready: true, rate_limit_ready: true, facebook_pending_identity_ready: true, payment_ledger_ready: true, payment_access_ready: true }] }; },
      release() { unsafeReleased += 1; }
    };
  }
}), /authenticate as tideway_app/);
assert.equal(unsafeReleased, 1);

await assert.rejects(probeMarketplaceDatabase({
  async connect() {
    return {
      async query() { return { rows: [{ database_role: "tideway_app", server_version_num: 160000, role_is_safe: true, lookup_session_ready: true, booking_workflow_ready: true, rate_limit_ready: false, facebook_pending_identity_ready: true, payment_ledger_ready: true, payment_access_ready: true }] }; },
      release() {}
    };
  }
}), /migrations or runtime grants are incomplete/);

let failedPoolEnded = 0;
let failedSmtpClosed = 0;
let failedStorageClosed = 0;
await assert.rejects(createMarketplaceAttachment({
  env: completeEnvironment,
  adapters,
  async createEmailDelivery() { return { async verify() {}, async send() {}, close() { failedSmtpClosed += 1; } }; },
  async createObjectStorage() { return { async verify() {}, async createUploadUrl() {}, async headObject() {}, async inspectAndSanitizeImage() {}, async createReadUrl() {}, async deleteObject() {}, close() { failedStorageClosed += 1; } }; },
  async createPool() { return { async end() { failedPoolEnded += 1; } }; },
  async probeDatabase() { throw new Error("staging probe failed"); },
  createRuntime() { throw new Error("must not compose"); }
}), /staging probe failed/);
assert.equal(failedPoolEnded, 1, "Failed marketplace startup did not close its pool.");
assert.equal(failedSmtpClosed, 1, "Failed marketplace startup did not close SMTP delivery.");
assert.equal(failedStorageClosed, 1, "Failed marketplace startup did not close private object storage.");

console.log("Marketplace attachment tests passed: disabled isolation, complete-adapter gate, restricted database probe, truthful auth capabilities and idempotent resource shutdown.");
