import assert from "node:assert/strict";
import { fetchLiveActivationSnapshot, liveActivationSnapshot, normalizeLiveActivationOrigin } from "../tools/live-activation-snapshot.mjs";

function health(overrides = {}) {
  return {
    ok: true,
    service: "tideway-marketplace",
    release: { sourceCommit: "746d0599", migrationCount: 66, privateBuildToken: "never-project-this" },
    dataIntegrity: "healthy",
    writesAllowed: true,
    marketplace: {
      enabled: true,
      ready: true,
      authenticationReady: true,
      emailReady: false,
      mediaReady: true,
      realtimeReady: true,
      geocodingReady: true,
      matchingReady: true,
      paymentsReady: false,
      automaticDispatchReady: true,
      speechSummaryReady: true,
      roomVisionReady: true,
      DATABASE_URL: "postgres://private:secret@example.invalid/private",
      ...overrides
    }
  };
}

function providers(overrides = {}) {
  return {
    ok: true,
    providers: {
      emailPassword: false,
      passwordReset: false,
      emailVerification: false,
      google: true,
      apple: false,
      facebook: false,
      roles: ["cleaner", "landlord"],
      GOOGLE_CLIENT_SECRET: "never-project-provider-secrets",
      ...overrides
    }
  };
}

function cleanerDirectory(cleaners = []) {
  return { ok: true, cleaners };
}

assert.equal(normalizeLiveActivationOrigin("https://homle-marketplace-preview.onrender.com/"), "https://homle-marketplace-preview.onrender.com");
for (const invalid of ["http://homle.example", "https://localhost", "https://127.0.0.1", "https://homle.example/path", "https://user:pass@homle.example", "https://homle.example?secret=yes"]) {
  assert.throws(() => normalizeLiveActivationOrigin(invalid), /HTTPS|public|origin/i);
}

const providerGaps = liveActivationSnapshot(health(), { origin: "https://homle.example", expectedRelease: "746d0599", providers: providers(), cleanerDirectory: cleanerDirectory() });
assert.equal(providerGaps.readiness.coreBookingRehearsal, true);
assert.equal(providerGaps.readiness.automaticMatchingRehearsal, true);
assert.equal(providerGaps.readiness.discoverableCleanerSupply, false);
assert.equal(providerGaps.readiness.directCleanerChoice, false);
assert.equal(providerGaps.readiness.transactionalNotifications, false);
assert.equal(providerGaps.readiness.emailFallback, false);
assert.equal(providerGaps.readiness.requestedAccountEntry, false);
assert.equal(providerGaps.readiness.testPaymentService, false);
assert.equal(providerGaps.readiness.participantPaymentRehearsalReady, false);
assert.equal(providerGaps.readiness.realPayments, false);
assert.deepEqual(providerGaps.remainingActions.map((entry) => entry.key), ["facebook-sign-in", "apple-sign-in", "public-cleaner-supply", "transactional-email", "test-payments"]);
assert.equal(providerGaps.capabilities.mediaReady, true);
const serialized = JSON.stringify(providerGaps);
assert(!serialized.includes("never-project-this") && !serialized.includes("never-project-provider-secrets") && !serialized.includes("postgres://") && !serialized.includes("DATABASE_URL") && !serialized.includes("GOOGLE_CLIENT_SECRET"), "The live activation snapshot exposed unexpected or private fields.");

const fullyConfiguredTest = liveActivationSnapshot(health({ emailReady: true, paymentsReady: true }), { origin: "https://homle.example", providers: providers({ emailPassword: true, passwordReset: true, emailVerification: true, apple: true, facebook: true }), cleanerDirectory: cleanerDirectory([{ id: "public-profile-never-serialized", email: "never-serialize@example.invalid" }]) });
assert.equal(fullyConfiguredTest.readiness.testPaymentService, true);
assert.equal(fullyConfiguredTest.readiness.participantPaymentRehearsalReady, true);
assert.equal(fullyConfiguredTest.readiness.requestedAccountEntry, true);
assert.equal(fullyConfiguredTest.readiness.discoverableCleanerSupply, true);
assert.equal(fullyConfiguredTest.readiness.directCleanerChoice, true);
assert.deepEqual(fullyConfiguredTest.remainingActions, []);
assert.equal(fullyConfiguredTest.readiness.realPayments, false, "A staging health snapshot claimed that real payments were approved.");
assert(!JSON.stringify(fullyConfiguredTest).includes("public-profile-never-serialized") && !JSON.stringify(fullyConfiguredTest).includes("never-serialize@example.invalid"), "The live snapshot repeated public Cleaner profile data instead of projecting supply as a boolean.");

const stripeWithoutEmail = liveActivationSnapshot(health({ paymentsReady: true }), { origin: "https://homle.example", providers: providers(), cleanerDirectory: cleanerDirectory([{ id: "available" }]) });
assert.equal(stripeWithoutEmail.readiness.testPaymentService, true, "A healthy Stripe test adapter was reported as unavailable because transactional email was missing.");
assert.equal(stripeWithoutEmail.readiness.participantPaymentRehearsalReady, false, "Stripe attachment alone falsely proved the complete participant payment rehearsal ready.");
assert.deepEqual(stripeWithoutEmail.remainingActions.map((entry) => entry.key), ["facebook-sign-in", "apple-sign-in", "transactional-email"], "A healthy Stripe adapter retained a misleading payment-configuration action.");

const missingStorage = liveActivationSnapshot(health({ mediaReady: false }), { origin: "https://homle.example", providers: providers(), cleanerDirectory: cleanerDirectory() });
assert.deepEqual(missingStorage.remainingActions.map((entry) => entry.key), ["facebook-sign-in", "apple-sign-in", "private-media", "public-cleaner-supply", "transactional-email", "test-payments"]);
assert.equal(missingStorage.readiness.coreBookingRehearsal, false);

const deliberatelyHeldDispatch = liveActivationSnapshot(health({ automaticDispatchReady: false }), { origin: "https://homle.example", providers: providers(), cleanerDirectory: cleanerDirectory([{ id: "available" }]) });
assert.equal(deliberatelyHeldDispatch.readiness.coreBookingRehearsal, true, "A safe direct-invitation rehearsal was blocked by the separately approved automatic-dispatch gate.");
assert.equal(deliberatelyHeldDispatch.readiness.automaticMatchingRehearsal, false);
const dispatchAction = deliberatelyHeldDispatch.remainingActions.find((entry) => entry.key === "automatic-dispatch");
assert(dispatchAction?.action.includes("founder explicitly approves") && dispatchAction.action.includes("exactly one monitored worker"), "The live verifier invited an operator to enable automatic dispatch without its approval and single-worker evidence boundary.");
assert(!dispatchAction.action.includes("Restore"), "An intentionally held automatic-dispatch gate was misreported as a broken runtime.");

assert.throws(() => liveActivationSnapshot(health(), { origin: "https://homle.example", expectedRelease: "aaaaaaaa", providers: providers(), cleanerDirectory: cleanerDirectory() }), /does not match expected release/);
assert.throws(() => liveActivationSnapshot({ ...health(), marketplace: { ...health().marketplace, mediaReady: "yes" } }, { origin: "https://homle.example", providers: providers(), cleanerDirectory: cleanerDirectory() }), /explicit boolean/);
assert.throws(() => liveActivationSnapshot({ ...health(), dataIntegrity: "degraded" }, { origin: "https://homle.example", providers: providers(), cleanerDirectory: cleanerDirectory() }), /degraded data integrity/);
assert.throws(() => liveActivationSnapshot(health(), { origin: "https://homle.example", providers: providers({ facebook: "yes" }), cleanerDirectory: cleanerDirectory() }), /explicit boolean/);
assert.throws(() => liveActivationSnapshot(health(), { origin: "https://homle.example", providers: providers({ roles: ["landlord"] }), cleanerDirectory: cleanerDirectory() }), /exactly Cleaner and Landlord/);
assert.throws(() => liveActivationSnapshot(health(), { origin: "https://homle.example", providers: providers(), cleanerDirectory: { ok: true, cleaners: "not-an-array" } }), /directory endpoint is not healthy/);

const requests = [];
const fetched = await fetchLiveActivationSnapshot({
  origin: "https://homle.example",
  expectedRelease: "746d0599",
  async fetch(url, options) {
    requests.push({ url, options });
    const body = url.endsWith("/api/auth/providers") ? providers() : url.endsWith("/api/marketplace/cleaners?limit=1") ? cleanerDirectory() : health();
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  }
});
assert.equal(fetched.release.sourceCommit, "746d0599");
assert.equal(requests.length, 3);
assert.equal(requests[0].url, "https://homle.example/api/health?release=746d0599");
assert.equal(requests[1].url, "https://homle.example/api/auth/providers");
assert.equal(requests[2].url, "https://homle.example/api/marketplace/cleaners?limit=1");
assert(requests.every((request) => request.options.method === "GET" && request.options.redirect === "error"));
assert(requests.every((request) => !request.options.headers.authorization && !request.options.headers.cookie), "The live snapshot sent credentials to a public verification endpoint.");

await assert.rejects(fetchLiveActivationSnapshot({
  origin: "https://homle.example",
  async fetch() { return new Response("cached", { status: 200, headers: { "content-type": "application/json" } }); }
}), /non-cacheable/);

await assert.rejects(fetchLiveActivationSnapshot({
  origin: "https://homle.example",
  async fetch() {
    return new Response("", { status: 503, headers: { "x-render-routing": "hibernate-wake-error" } });
  }
}), (error) => {
  assert.equal(error.code, "RENDER_HIBERNATE_WAKE_ERROR");
  assert.equal(error.retryable, true);
  assert.match(error.message, /before Homle started/i);
  assert.match(error.message, /expected release pin/i);
  assert.match(error.message, /redeploy the latest main commit/i);
  return true;
});

await assert.rejects(fetchLiveActivationSnapshot({
  origin: "https://homle.example",
  async fetch() { return new Response("", { status: 503 }); }
}), /did not return a successful JSON response/);

console.log("Live activation snapshot tests passed: exact release, secret-free health and account-provider projections, current provider gaps, test-only payment boundary, bounded no-credential public verification requests and platform wake-failure diagnosis.");
