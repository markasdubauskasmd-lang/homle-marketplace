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

assert.equal(normalizeLiveActivationOrigin("https://homle-marketplace-preview.onrender.com/"), "https://homle-marketplace-preview.onrender.com");
for (const invalid of ["http://homle.example", "https://localhost", "https://127.0.0.1", "https://homle.example/path", "https://user:pass@homle.example", "https://homle.example?secret=yes"]) {
  assert.throws(() => normalizeLiveActivationOrigin(invalid), /HTTPS|public|origin/i);
}

const providerGaps = liveActivationSnapshot(health(), { origin: "https://homle.example", expectedRelease: "746d0599", providers: providers() });
assert.equal(providerGaps.readiness.coreBookingRehearsal, true);
assert.equal(providerGaps.readiness.transactionalNotifications, false);
assert.equal(providerGaps.readiness.emailFallback, false);
assert.equal(providerGaps.readiness.requestedAccountEntry, false);
assert.equal(providerGaps.readiness.testPaymentRehearsal, false);
assert.equal(providerGaps.readiness.realPayments, false);
assert.deepEqual(providerGaps.remainingActions.map((entry) => entry.key), ["facebook-sign-in", "apple-sign-in", "transactional-email", "test-payments"]);
assert.equal(providerGaps.capabilities.mediaReady, true);
const serialized = JSON.stringify(providerGaps);
assert(!serialized.includes("never-project-this") && !serialized.includes("never-project-provider-secrets") && !serialized.includes("postgres://") && !serialized.includes("DATABASE_URL") && !serialized.includes("GOOGLE_CLIENT_SECRET"), "The live activation snapshot exposed unexpected or private fields.");

const fullyConfiguredTest = liveActivationSnapshot(health({ emailReady: true, paymentsReady: true }), { origin: "https://homle.example", providers: providers({ emailPassword: true, passwordReset: true, emailVerification: true, apple: true, facebook: true }) });
assert.equal(fullyConfiguredTest.readiness.testPaymentRehearsal, true);
assert.equal(fullyConfiguredTest.readiness.requestedAccountEntry, true);
assert.deepEqual(fullyConfiguredTest.remainingActions, []);
assert.equal(fullyConfiguredTest.readiness.realPayments, false, "A staging health snapshot claimed that real payments were approved.");

const missingStorage = liveActivationSnapshot(health({ mediaReady: false }), { origin: "https://homle.example", providers: providers() });
assert.deepEqual(missingStorage.remainingActions.map((entry) => entry.key), ["facebook-sign-in", "apple-sign-in", "private-media", "transactional-email", "test-payments"]);
assert.equal(missingStorage.readiness.coreBookingRehearsal, false);

assert.throws(() => liveActivationSnapshot(health(), { origin: "https://homle.example", expectedRelease: "aaaaaaaa", providers: providers() }), /does not match expected release/);
assert.throws(() => liveActivationSnapshot({ ...health(), marketplace: { ...health().marketplace, mediaReady: "yes" } }, { origin: "https://homle.example", providers: providers() }), /explicit boolean/);
assert.throws(() => liveActivationSnapshot({ ...health(), dataIntegrity: "degraded" }, { origin: "https://homle.example", providers: providers() }), /degraded data integrity/);
assert.throws(() => liveActivationSnapshot(health(), { origin: "https://homle.example", providers: providers({ facebook: "yes" }) }), /explicit boolean/);
assert.throws(() => liveActivationSnapshot(health(), { origin: "https://homle.example", providers: providers({ roles: ["landlord"] }) }), /exactly Cleaner and Landlord/);

const requests = [];
const fetched = await fetchLiveActivationSnapshot({
  origin: "https://homle.example",
  expectedRelease: "746d0599",
  async fetch(url, options) {
    requests.push({ url, options });
    const body = url.endsWith("/api/auth/providers") ? providers() : health();
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  }
});
assert.equal(fetched.release.sourceCommit, "746d0599");
assert.equal(requests.length, 2);
assert.equal(requests[0].url, "https://homle.example/api/health?release=746d0599");
assert.equal(requests[1].url, "https://homle.example/api/auth/providers");
assert(requests.every((request) => request.options.method === "GET" && request.options.redirect === "error"));
assert(requests.every((request) => !request.options.headers.authorization && !request.options.headers.cookie), "The live snapshot sent credentials to a public verification endpoint.");

await assert.rejects(fetchLiveActivationSnapshot({
  origin: "https://homle.example",
  async fetch() { return new Response("cached", { status: 200, headers: { "content-type": "application/json" } }); }
}), /non-cacheable/);

console.log("Live activation snapshot tests passed: exact release, secret-free health and account-provider projections, current provider gaps, test-only payment boundary and bounded no-credential public verification requests.");
