import assert from "node:assert/strict";
import { listRenderServiceEnvironment, renderEnvironmentActivationReport } from "../render-environment-readiness.mjs";

const privateValues = Object.freeze({
  database: "postgresql://owner:private@dpg-example.internal/homle_staging",
  appPassword: "app-password-never-print-more-than-thirty-two-characters",
  workerPassword: "worker-password-never-print-more-than-thirty-two-characters",
  session: "session-secret-never-print-more-than-thirty-two-characters",
  token: "token-secret-never-print-more-than-thirty-two-characters",
  encryption: "encryption-secret-never-print-more-than-thirty-two-characters",
  admin: "admin-secret-never-print-more-than-thirty-two-characters",
  googleClient: "client.apps.googleusercontent.com",
  googleSecret: "google-secret-never-print",
  fingerprint: "a".repeat(64),
  resend: "re_test_never_print",
  storage: "storage-secret-never-print",
  stripeSecret: `sk_test_${"s".repeat(32)}`,
  stripePublic: `pk_test_${"p".repeat(32)}`,
  stripeWebhook: `whsec_${"w".repeat(32)}`
});

function entriesFrom(environment) {
  return Object.entries(environment).map(([key, value]) => ({ key, value }));
}

const safeAccountEnvironment = {
  APP_ORIGIN: "https://homle-marketplace-preview.onrender.com",
  DATABASE_BOOTSTRAP_URL: privateValues.database,
  TIDEWAY_APP_PASSWORD: privateValues.appPassword,
  TIDEWAY_WORKER_PASSWORD: privateValues.workerPassword,
  SESSION_SECRET: privateValues.session,
  AUTH_TOKEN_SECRET: privateValues.token,
  DATA_ENCRYPTION_KEY: privateValues.encryption,
  ADMIN_KEY: privateValues.admin,
  GOOGLE_CLIENT_ID: privateValues.googleClient,
  GOOGLE_CLIENT_SECRET: privateValues.googleSecret,
  STAGING_ACCOUNT_EMAIL_SHA256: privateValues.fingerprint,
  TIDEWAY_EXPECT_RELEASE: "abcdef12",
  TIDEWAY_EXPECT_SOCIAL_PROVIDERS: "google",
  MARKETPLACE_ADAPTER_MODULE: "homle:render-log-monitoring",
  RENDER_LOG_MONITORING_ACKNOWLEDGED: "true",
  STAGING_ACCOUNTS_ONLY: "true",
  AUTHENTICATION_ENABLED: "true",
  MARKETPLACE_ENABLED: "false",
  PAYMENTS_ENABLED: "false",
  PILOT_INTAKE_ENABLED: "false",
  WORKER_AUTOMATIC_DISPATCH_ENABLED: "false"
};

const account = renderEnvironmentActivationReport(entriesFrom(safeAccountEnvironment));
assert.equal(account.ok, true);
assert.equal(account.mode, "restricted-account-preview");
assert.equal(account.activation.accounts, true);
assert.equal(account.activation.marketplaceDependencies, false);
assert.deepEqual(account.missing.transactionalEmail, ["RESEND_API_KEY or SMTP_URL", "EMAIL_FROM"]);
assert.deepEqual(account.missing.privateMedia, ["OBJECT_STORAGE_ENDPOINT", "OBJECT_STORAGE_BUCKET", "OBJECT_STORAGE_REGION", "OBJECT_STORAGE_ACCESS_KEY_ID", "OBJECT_STORAGE_SECRET_ACCESS_KEY"]);
assert.equal(account.next.key, "transactional-email");
for (const secret of Object.values(privateValues)) assert(!JSON.stringify(account).includes(secret), "Render environment readiness exposed a private value.");

const marketplaceDependencies = renderEnvironmentActivationReport(entriesFrom({
  ...safeAccountEnvironment,
  RESEND_API_KEY: privateValues.resend,
  EMAIL_FROM: "Homle <test@homle.example>",
  OBJECT_STORAGE_ENDPOINT: "https://objects.example.com",
  OBJECT_STORAGE_BUCKET: "homle-private-media",
  OBJECT_STORAGE_REGION: "auto",
  OBJECT_STORAGE_ACCESS_KEY_ID: "storage-access-key",
  OBJECT_STORAGE_SECRET_ACCESS_KEY: privateValues.storage
}));
assert.equal(marketplaceDependencies.activation.marketplaceDependencies, true);
assert.equal(marketplaceDependencies.next.key, "test-payments");

const allDependencies = renderEnvironmentActivationReport(entriesFrom({
  ...safeAccountEnvironment,
  RESEND_API_KEY: privateValues.resend,
  EMAIL_FROM: "Homle <test@homle.example>",
  OBJECT_STORAGE_ENDPOINT: "https://objects.example.com",
  OBJECT_STORAGE_BUCKET: "homle-private-media",
  OBJECT_STORAGE_REGION: "auto",
  OBJECT_STORAGE_ACCESS_KEY_ID: "storage-access-key",
  OBJECT_STORAGE_SECRET_ACCESS_KEY: privateValues.storage,
  STRIPE_SECRET_KEY: privateValues.stripeSecret,
  STRIPE_PUBLISHABLE_KEY: privateValues.stripePublic,
  STRIPE_WEBHOOK_SECRET: privateValues.stripeWebhook
}));
assert.equal(allDependencies.activation.marketplaceDependencies, true);
assert.equal(allDependencies.activation.testPaymentDependencies, true);
assert.equal(allDependencies.next.key, "managed-staging-proof");

const unsafe = renderEnvironmentActivationReport(entriesFrom({ ...safeAccountEnvironment, STAGING_ACCOUNTS_ONLY: "false", MARKETPLACE_ENABLED: "true", PAYMENTS_ENABLED: "true" }));
assert.equal(unsafe.ok, false);
assert.equal(unsafe.checks.safeAccountPreview, false);
assert.equal(unsafe.next.key, "preview-safety");

const weakSecrets = renderEnvironmentActivationReport(entriesFrom({ ...safeAccountEnvironment, SESSION_SECRET: "short", AUTH_TOKEN_SECRET: privateValues.encryption }));
assert.equal(weakSecrets.ok, false);
assert(weakSecrets.missing.accounts.includes("SESSION_SECRET with 32-512 characters"));
assert(weakSecrets.missing.accounts.includes("distinct database, session, token, encryption and Administrator secrets"));
assert(!JSON.stringify(weakSecrets).includes("short"));

assert.throws(() => renderEnvironmentActivationReport([{ key: "A", value: "one" }, { key: "A", value: "two" }]), /duplicate key A/);
assert.throws(() => renderEnvironmentActivationReport([{ key: "A" }]), /string key and value/);

const firstPage = Array.from({ length: 100 }, (_, index) => ({ cursor: `cursor-${index}`, envVar: { key: `KEY_${index}`, value: `VALUE_${index}` } }));
const secondPage = [{ cursor: "cursor-final", envVar: { key: "KEY_100", value: "VALUE_100" } }];
const requested = [];
const inventory = await listRenderServiceEnvironment({
  serviceId: "srv-example123",
  apiKey: "rnd_private_test_key_long_enough",
  fetchImpl: async (url, options) => {
    requested.push({ url: String(url), authorization: options.headers.Authorization });
    return { ok: true, status: 200, async json() { return requested.length === 1 ? firstPage : secondPage; } };
  }
});
assert.equal(inventory.length, 101);
assert.match(requested[0].url, /limit=100/);
assert.match(requested[1].url, /cursor=cursor-99/);
assert.equal(requested[0].authorization, "Bearer rnd_private_test_key_long_enough");
assert(!JSON.stringify(inventory).includes("rnd_private_test_key_long_enough"));

await assert.rejects(() => listRenderServiceEnvironment({
  serviceId: "srv-example123",
  apiKey: "rnd_private_test_key_long_enough",
  fetchImpl: async () => ({ ok: false, status: 403, async json() { return {}; } })
}), /HTTP 403/);

await assert.rejects(() => listRenderServiceEnvironment({
  serviceId: "srv-example123",
  apiKey: "rnd_private_test_key_long_enough",
  fetchImpl: async () => ({ ok: true, status: 200, async json() { return {}; } })
}), /invalid page/);

console.log("Render environment pagination and secret-safe activation readiness tests passed.");
