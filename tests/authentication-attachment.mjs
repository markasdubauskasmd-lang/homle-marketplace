import assert from "node:assert/strict";
import { createAuthenticationAttachment } from "../src/marketplace/authentication-attachment.mjs";
import { createAuthenticationRuntime } from "../src/marketplace/authentication-runtime.mjs";

const environment = Object.freeze({
  NODE_ENV: "production",
  AUTHENTICATION_ENABLED: "true",
  MARKETPLACE_ENABLED: "false",
  PAYMENTS_ENABLED: "false",
  DATABASE_URL: "postgresql://tideway_app:secret@db.example/homle",
  SESSION_SECRET: "authentication-session-secret-longer-than-thirty-two",
  AUTH_TOKEN_SECRET: "authentication-token-secret-is-separate-and-long",
  APP_ORIGIN: "https://staging.homle.example",
  SMTP_URL: "smtps://mailer.example",
  EMAIL_FROM: "Homle <test@invalid.example>",
  GOOGLE_CLIENT_ID: "homle-test.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "google-test-secret-never-log-this",
  FACEBOOK_APP_ID: "123456789012345",
  FACEBOOK_APP_SECRET: "abcdef0123456789abcdef0123456789",
  FACEBOOK_GRAPH_API_VERSION: "v99.0"
});

let loaded = false;
const disabled = await createAuthenticationAttachment({
  env: {},
  async loadAdapters() { loaded = true; throw new Error("must not load"); }
});
assert.equal(disabled.enabled, false);
assert.equal(disabled.authenticationHttpReady, false);
assert.equal(disabled.router, null);
assert.equal(loaded, false);
await assert.rejects(createAuthenticationAttachment({ env: { AUTHENTICATION_ENABLED: "sometimes" } }), /must be true or false/);
await assert.rejects(createAuthenticationAttachment({ env: { AUTHENTICATION_ENABLED: "true" } }), /DATABASE_URL/);

const actualRuntime = createAuthenticationRuntime({ connect() { throw new Error("runtime construction must not query"); } }, {
  env: environment,
  emailDelivery: { async send() {} },
  rateLimiter: { async consume() { return { allowed: true }; } },
  clientKey() { return "direct:ipv4:198.51.100.10"; }
});
assert.equal(actualRuntime.authenticationHttpReady, true);
assert.equal(actualRuntime.googleOidcReady, true);
assert.equal(actualRuntime.facebookLoginReady, true);
assert.equal(actualRuntime.router && typeof actualRuntime.router.handle, "function");
assert.equal("objectStorage" in actualRuntime, false, "Authentication-only runtime unexpectedly acquired private media storage.");

let verified = 0;
let emailClosed = 0;
let poolClosed = 0;
let adaptersClosed = 0;
let probed = 0;
const router = { async handle() { return true; } };
const attachment = await createAuthenticationAttachment({
  env: environment,
  adapters: { onUnexpectedError() {}, async close() { adaptersClosed += 1; } },
  createClientKeyResolver() { return () => "direct:ipv4:198.51.100.10"; },
  async createEmailDelivery() {
    return { async verify() { verified += 1; }, async send() {}, async close() { emailClosed += 1; } };
  },
  async createPool() { return { async end() { poolClosed += 1; } }; },
  async probeDatabase() { probed += 1; },
  createRateLimiter() { return { async consume() { return { allowed: true }; } }; },
  createRuntime() {
    return { router, authenticationHttpReady: true, emailPasswordReady: true, googleOidcReady: true, facebookLoginReady: true };
  }
});
assert.equal(attachment.enabled, true);
assert.equal(attachment.ready, true);
assert.equal(attachment.router, router);
assert.equal(attachment.authenticationCapabilities.emailPassword, true);
assert.equal(attachment.authenticationCapabilities.google, true);
assert.equal(attachment.authenticationCapabilities.facebook, true);
assert.equal(probed, 1);
assert.equal(verified, 1);
await attachment.close();
await attachment.close();
assert.equal(emailClosed, 1);
assert.equal(poolClosed, 1);
assert.equal(adaptersClosed, 1);

const googleOnlyEnvironment = Object.freeze({
  ...environment,
  SMTP_URL: "",
  EMAIL_FROM: "",
  FACEBOOK_APP_ID: "",
  FACEBOOK_APP_SECRET: "",
  FACEBOOK_GRAPH_API_VERSION: ""
});
let googleOnlyEmailFactoryCalled = false;
const googleOnlyAttachment = await createAuthenticationAttachment({
  env: googleOnlyEnvironment,
  adapters: { onUnexpectedError() {}, async close() {} },
  createClientKeyResolver() { return () => "direct:ipv4:198.51.100.10"; },
  async createEmailDelivery() { googleOnlyEmailFactoryCalled = true; throw new Error("Google-only activation must not compose email delivery."); },
  async createPool() { return { async end() {} }; },
  async probeDatabase() {},
  createRateLimiter() { return { async consume() { return { allowed: true }; } }; },
  createRuntime() {
    return { router, authenticationHttpReady: true, emailPasswordReady: false, googleOidcReady: true, facebookLoginReady: false };
  }
});
assert.equal(googleOnlyAttachment.ready, true);
assert.equal(googleOnlyAttachment.authenticationCapabilities.emailPassword, false);
assert.equal(googleOnlyAttachment.authenticationCapabilities.passwordReset, false);
assert.equal(googleOnlyAttachment.authenticationCapabilities.emailVerification, false);
assert.equal(googleOnlyAttachment.authenticationCapabilities.google, true);
assert.equal(googleOnlyAttachment.authenticationCapabilities.facebook, false);
assert.equal(googleOnlyEmailFactoryCalled, false);
await googleOnlyAttachment.close();

let failedEmailClosed = 0;
let failedPoolClosed = 0;
await assert.rejects(createAuthenticationAttachment({
  env: environment,
  adapters: { onUnexpectedError() {}, async close() {} },
  createClientKeyResolver() { return () => "direct:ipv4:198.51.100.10"; },
  async createEmailDelivery() { return { async verify() {}, async send() {}, async close() { failedEmailClosed += 1; } }; },
  async createPool() { return { async end() { failedPoolClosed += 1; } }; },
  async probeDatabase() { throw new Error("authentication database probe failed"); }
}), /authentication database probe failed/);
assert.equal(failedEmailClosed, 1);
assert.equal(failedPoolClosed, 1);

console.log("Authentication attachment tests passed: explicit activation, full account router without media or payments, truthful provider capabilities, database/email verification and deterministic cleanup.");
