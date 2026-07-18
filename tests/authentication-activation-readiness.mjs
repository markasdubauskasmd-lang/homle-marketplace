import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authenticationActivationReadiness, expectedAuthenticationProviders } from "../authentication-activation-readiness.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "homle-authentication-preflight-"));
const releaseIdentity = Object.freeze({ source: "packaged", sourceCommit: "6466d6e5", builtAt: new Date(Date.now() - 60_000).toISOString(), migrationCount: 40 });
const readinessOptions = Object.freeze({ projectRoot, releaseIdentity });
const secrets = Object.freeze({
  admin: "unit-test-admin-secret-with-32-characters",
  database: "postgresql://homle_app:private@db.example.com/homle",
  realtimeDatabase: "postgresql://homle_app:private@db-direct.example.com/homle",
  session: "session-secret-with-at-least-32-characters",
  token: "different-auth-secret-with-at-least-32-chars",
  encryption: "third-encryption-secret-with-32-characters",
  google: "google-client-secret-never-print-this",
  facebook: "abcdef0123456789abcdef0123456789",
  storage: "private-storage-secret-never-print-this"
});

const applePrivateKey = "-----BEGIN PRIVATE KEY-----\nunit-test-private-key-not-used-by-readiness\n-----END PRIVATE KEY-----";

const configured = {
  NODE_ENV: "production",
  HOST: "127.0.0.1",
  PORT: "4173",
  LAN_PORT: "0",
  APP_ORIGIN: "https://homle.co.uk",
  DATA_DIR: fixtureRoot,
  ADMIN_REQUIRE_KEY: "true",
  ADMIN_KEY: secrets.admin,
  TRUST_PROXY: "true",
  TRUSTED_PROXY_CIDRS: "127.0.0.1/32",
  PILOT_INTAKE_ENABLED: "false",
  AUTHENTICATION_ENABLED: "true",
  MARKETPLACE_ENABLED: "false",
  PAYMENTS_ENABLED: "false",
  DATABASE_URL: secrets.database,
  REALTIME_DATABASE_URL: secrets.realtimeDatabase,
  SESSION_SECRET: secrets.session,
  AUTH_TOKEN_SECRET: secrets.token,
  DATA_ENCRYPTION_KEY: secrets.encryption,
  SMTP_URL: "smtps://mailer.example.com:465",
  EMAIL_FROM: "Homle <no-reply@homle.co.uk>",
  OBJECT_STORAGE_ENDPOINT: "https://objects.example.com",
  OBJECT_STORAGE_BUCKET: "homle-private-media",
  OBJECT_STORAGE_REGION: "eu-west-2",
  OBJECT_STORAGE_ACCESS_KEY_ID: "private-access-key",
  OBJECT_STORAGE_SECRET_ACCESS_KEY: secrets.storage,
  MARKETPLACE_ADAPTER_MODULE: path.join(projectRoot, "deployment", "monitoring-adapter.mjs"),
  GOOGLE_CLIENT_ID: "homle.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: secrets.google,
  APPLE_CLIENT_ID: "co.uk.homle.web",
  APPLE_TEAM_ID: "ABCDE12345",
  APPLE_KEY_ID: "FGHIJ67890",
  APPLE_PRIVATE_KEY: applePrivateKey,
  FACEBOOK_APP_ID: "123456789012345",
  FACEBOOK_APP_SECRET: secrets.facebook,
  FACEBOOK_GRAPH_API_VERSION: "v99.0",
  TIDEWAY_EXPECT_SOCIAL_PROVIDERS: "google,apple,facebook",
  TIDEWAY_EXPECT_RELEASE: "6466d6e5"
};

try {
  assert.deepEqual([...expectedAuthenticationProviders("google,apple,facebook")], ["google", "apple", "facebook"]);
  assert.throws(() => expectedAuthenticationProviders(""), /at least one/i);
  assert.throws(() => expectedAuthenticationProviders("google,GOOGLE"), /duplicates/i);
  assert.throws(() => expectedAuthenticationProviders("microsoft"), /only google, apple and facebook/i);

  const ready = authenticationActivationReadiness(configured, readinessOptions);
  assert.equal(ready.ok, true, ready.errors.join("\n"));
  assert.equal(ready.configurationReady, true);
  assert.deepEqual(ready.checks, { productionDeployment: true, releaseIdentity: true, authenticationCore: true, accountEntry: true, emailFallback: true, socialProviders: true });
  assert.deepEqual(ready.release, { expectedCommit: "6466d6e5", runningCommit: "6466d6e5" });
  assert.equal(ready.callbacks.google, "https://homle.co.uk/api/marketplace/auth/google/callback");
  assert.equal(ready.callbacks.apple, "https://homle.co.uk/api/marketplace/auth/apple/callback");
  assert.equal(ready.callbacks.facebook, "https://homle.co.uk/api/marketplace/auth/facebook/callback");
  assert.deepEqual(ready.facebookDataDeletion, {
    callback: "https://homle.co.uk/api/marketplace/auth/facebook/data-deletion",
    statusPage: "https://homle.co.uk/facebook-data-deletion"
  });
  assert(ready.nextEvidence.some((item) => item.includes("two non-customer staging accounts")), "Configuration readiness was mistaken for live authentication evidence.");
  const serialized = JSON.stringify(ready);
  for (const secret of Object.values(secrets)) assert(!serialized.includes(secret), "Authentication preflight exposed a secret value.");

  const partialGoogle = authenticationActivationReadiness({ ...configured, GOOGLE_CLIENT_SECRET: "", TIDEWAY_EXPECT_SOCIAL_PROVIDERS: "google" }, readinessOptions);
  assert.equal(partialGoogle.ok, false);
  assert.equal(partialGoogle.providers.google.configured, false);
  assert(partialGoogle.errors.some((error) => error.includes("Google sign-in credentials are incomplete")));

  const googleOnly = authenticationActivationReadiness({
    ...configured,
    SMTP_URL: "",
    EMAIL_FROM: "",
    FACEBOOK_APP_ID: "",
    FACEBOOK_APP_SECRET: "",
    FACEBOOK_GRAPH_API_VERSION: "",
    TIDEWAY_EXPECT_SOCIAL_PROVIDERS: "google"
  }, readinessOptions);
  assert.equal(googleOnly.ok, true, googleOnly.errors.join("\n"));
  assert.equal(googleOnly.checks.emailFallback, false);
  assert.equal(googleOnly.checks.accountEntry, true);
  assert.equal(googleOnly.providers.google.configured, true);
  assert.equal(googleOnly.providers.facebook.configured, false);

  const nonPublicOrigin = authenticationActivationReadiness({ ...configured, APP_ORIGIN: "https://127.0.0.1", TIDEWAY_EXPECT_SOCIAL_PROVIDERS: "google" }, readinessOptions);
  assert.equal(nonPublicOrigin.ok, false);
  assert.equal(nonPublicOrigin.origin, null);
  assert.equal(nonPublicOrigin.callbacks.google, null);
  assert.equal(nonPublicOrigin.facebookDataDeletion, null);

  const detached = authenticationActivationReadiness({ ...configured, AUTHENTICATION_ENABLED: "false", MARKETPLACE_ENABLED: "false", TIDEWAY_EXPECT_SOCIAL_PROVIDERS: "google" }, readinessOptions);
  assert.equal(detached.ok, false);
  assert.equal(detached.checks.authenticationCore, false);
  assert(detached.errors.some((error) => error.includes("AUTHENTICATION_ENABLED")));

  const mismatchedRelease = authenticationActivationReadiness(configured, { projectRoot, releaseIdentity: { ...releaseIdentity, sourceCommit: "00000000" } });
  assert.equal(mismatchedRelease.ok, false);
  assert.equal(mismatchedRelease.checks.releaseIdentity, false);
  assert(mismatchedRelease.errors.some((error) => error.includes("does not match expected release")));

  const missingExpectedRelease = authenticationActivationReadiness({ ...configured, TIDEWAY_EXPECT_RELEASE: "" }, readinessOptions);
  assert.equal(missingExpectedRelease.ok, false);
  assert(missingExpectedRelease.errors.some((error) => error.includes("eight-character source commit")));

  const missingSelection = authenticationActivationReadiness({ ...configured, TIDEWAY_EXPECT_SOCIAL_PROVIDERS: "" }, readinessOptions);
  assert.equal(missingSelection.ok, false);
  assert(missingSelection.errors.some((error) => error.includes("Choose at least one")));

  console.log("Authentication activation readiness tests passed: exact packaged release, Homle callbacks, complete provider selection, standalone account prerequisites, staging-evidence boundary and secret-free reports.");
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
