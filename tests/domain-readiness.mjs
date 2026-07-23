import assert from "node:assert/strict";
import { normalizeExpectedReleaseCommit } from "../release-identity.mjs";
import { probeAppleProviderRegistration, probeGoogleProviderRegistration, resolvePublicAddresses, verifyDomainReadiness } from "../tools/domain-readiness.mjs";

const securityHeaders = {
  "content-security-policy": "default-src 'self'; img-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()"
};
const packagedBuiltAt = new Date(Date.now() - 60_000).toISOString();

const systemDnsFallback = await resolvePublicAddresses("homle.example", {
  async resolve4() { throw Object.assign(new Error("resolver refused"), { code: "ECONNREFUSED" }); },
  async resolve6() { throw Object.assign(new Error("resolver refused"), { code: "ECONNREFUSED" }); },
  async lookup(hostname, options) {
    assert.equal(hostname, "homle.example");
    assert.deepEqual(options, { all: true, verbatim: true });
    return [{ address: "92.113.18.103", family: 4 }, { address: "2a02:4780:3f:1789:0:e14:ae4a:2", family: 6 }];
  }
});
assert.deepEqual(systemDnsFallback, ["92.113.18.103", "2a02:4780:3f:1789:0:e14:ae4a:2"]);
await assert.rejects(
  resolvePublicAddresses("private.example", {
    async resolve4() { throw new Error("resolver refused"); },
    async resolve6() { return []; },
    async lookup() { return [{ address: "192.168.1.10", family: 4 }]; }
  }),
  /private, local or reserved/i,
  "System DNS fallback accepted a private address."
);

function jsonResponse(value) {
  const body = value?.service === "tideway-marketplace" ? { ...value, release: { source: "packaged", sourceCommit: "414dd3ca", builtAt: packagedBuiltAt, migrationCount: 40 } } : value;
  return new Response(JSON.stringify(body), { status: 200, headers: { ...securityHeaders, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function closedResponse(status) {
  return new Response(JSON.stringify({ ok: false, error: status === 401 ? "Admin authorisation required." : "Not found." }), { status, headers: { ...securityHeaders, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function privateBoundaryResponse(url) {
  if (url.endsWith("/admin")) return closedResponse(401);
  if (["/tracking-test", "/tracking-test.html", "/tracking-test.js", "/api/tracking-test/snapshot"].some((pathname) => url.endsWith(pathname))) return closedResponse(404);
  return null;
}

function googleStartLocation(origin = "https://tidewaycleaning.co.uk") {
  const location = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  location.search = new URLSearchParams({ response_type: "code", client_id: "public-google-client-id", redirect_uri: `${origin}/api/marketplace/auth/google/callback`, scope: "openid email profile", state: "s".repeat(43), nonce: "n".repeat(43), code_challenge: "c".repeat(43), code_challenge_method: "S256" }).toString();
  return location.toString();
}

function appleStartLocation(origin = "https://tidewaycleaning.co.uk") {
  const location = new URL("https://appleid.apple.com/auth/authorize");
  location.search = new URLSearchParams({ response_type: "code", response_mode: "form_post", client_id: "co.uk.homle.web", redirect_uri: `${origin}/api/marketplace/auth/apple/callback`, scope: "name email", state: "a".repeat(43), nonce: "n".repeat(43) }).toString();
  return location.toString();
}

const requested = [];
const good = await verifyDomainReadiness("https://tidewaycleaning.co.uk", {
  expectedReleaseCommit: "414dd3ca",
  async resolveAddresses(hostname) { assert.equal(hostname, "tidewaycleaning.co.uk"); return ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"]; },
  async tlsProbe() { return { daysRemaining: 60, validUntil: "2026-09-14T00:00:00.000Z" }; },
  async fetch(url, options) {
    requested.push({ url, options });
    if (url === "http://tidewaycleaning.co.uk/") return new Response(null, { status: 308, headers: { location: "https://tidewaycleaning.co.uk/" } });
    if (url === "https://tidewaycleaning.co.uk/") return new Response("<!doctype html><title>Homle</title>", { status: 200, headers: { ...securityHeaders, "content-type": "text/html; charset=utf-8" } });
    if (url.endsWith("/api/health")) return jsonResponse({ ok: true, service: "tideway-marketplace", dataIntegrity: "healthy", writesAllowed: true, localDemosEnabled: false, marketplace: { enabled: false, ready: false, authenticationReady: false } });
    const boundary = privateBoundaryResponse(url);
    if (boundary) return boundary;
    if (url.endsWith("/api/auth/providers")) return jsonResponse({ ok: true, providers: { emailPassword: false, passwordReset: false, emailVerification: false, google: false, apple: false, facebook: false, roles: ["cleaner", "landlord"] } });
    if (["google", "apple", "facebook"].some((provider) => url.endsWith(`/api/marketplace/auth/${provider}/start`))) return new Response(null, { status: 404 });
    throw new Error(`Unexpected URL: ${url}`);
  }
});
assert.equal(good.ok, true);
assert.equal(good.origin, "https://tidewaycleaning.co.uk");
assert.ok(good.checks.every((check) => check.ok));
assert.equal(good.checks.find((check) => check.name === "release-identity")?.ok, true);
assert.equal(requested.length, 12);
assert.ok(requested.every((entry) => entry.options.redirect === "manual" && entry.options.signal instanceof AbortSignal));
assert.ok(requested.every((entry) => entry.options.method === undefined && !entry.options.headers["x-admin-key"]), "Readiness attempted a mutation or sent an Administrator key.");
assert.ok(requested.every((entry) => !entry.url.startsWith("https://accounts.google.com") && !entry.url.startsWith("https://www.facebook.com")), "Readiness followed a social-provider redirect.");

const activeProviderRequests = [];
const activeProviders = await verifyDomainReadiness("https://tidewaycleaning.co.uk", {
  expectedSocialProviders: ["google", "facebook"],
  async resolveAddresses() { return ["93.184.216.34"]; },
  async tlsProbe() { return { daysRemaining: 60, validUntil: "2026-09-14T00:00:00.000Z" }; },
  async fetch(url, options) {
    activeProviderRequests.push({ url, options });
    if (url === "http://tidewaycleaning.co.uk/") return new Response(null, { status: 308, headers: { location: "https://tidewaycleaning.co.uk/" } });
    if (url === "https://tidewaycleaning.co.uk/") return new Response("<!doctype html><title>Homle</title>", { status: 200, headers: { ...securityHeaders, "content-type": "text/html; charset=utf-8" } });
    if (url.endsWith("/api/health")) return jsonResponse({ ok: true, service: "tideway-marketplace", dataIntegrity: "healthy", writesAllowed: true, localDemosEnabled: false, marketplace: { enabled: true, ready: true, authenticationReady: true } });
    const boundary = privateBoundaryResponse(url);
    if (boundary) return boundary;
    if (url.endsWith("/api/auth/providers")) return jsonResponse({ ok: true, providers: { emailPassword: true, passwordReset: true, emailVerification: true, google: true, apple: false, facebook: true, roles: ["cleaner", "landlord"] } });
    if (url.endsWith("/api/marketplace/auth/google/start")) {
      return new Response(null, { status: 302, headers: { location: googleStartLocation(), "set-cookie": `__Host-tideway_google_flow=${"g".repeat(50)}; Path=/; HttpOnly; SameSite=Lax; Secure`, "cache-control": "no-store" } });
    }
    if (url.startsWith("https://accounts.google.com/o/oauth2/v2/auth?")) return new Response(null, { status: 302, headers: { location: "https://accounts.google.com/v3/signin/identifier?continue=opaque" } });
    if (url.endsWith("/api/marketplace/auth/facebook/start")) {
      const location = new URL("https://www.facebook.com/v23.0/dialog/oauth");
      location.search = new URLSearchParams({ response_type: "code", client_id: "123456789", redirect_uri: "https://tidewaycleaning.co.uk/api/marketplace/auth/facebook/callback", scope: "email", state: "f".repeat(43) }).toString();
      return new Response(null, { status: 302, headers: { location: location.toString(), "set-cookie": `__Host-tideway_facebook_flow=${"f".repeat(50)}; Path=/; HttpOnly; SameSite=Lax; Secure`, "cache-control": "no-store" } });
    }
    if (url.endsWith("/api/marketplace/auth/apple/start")) return new Response(null, { status: 404 });
    throw new Error(`Unexpected URL: ${url}`);
  }
});
assert.equal(activeProviders.ok, true);
assert.equal(activeProviders.checks.find((check) => check.name === "google-sign-in-start")?.ok, true);
assert.equal(activeProviders.checks.find((check) => check.name === "google-provider-registration")?.ok, true);
assert.equal(activeProviders.checks.find((check) => check.name === "facebook-sign-in-start")?.ok, true);
assert.equal(activeProviderRequests.length, 13);
assert.ok(activeProviderRequests.every((entry) => entry.options.redirect === "manual"));
const googleProviderProbe = activeProviderRequests.find((entry) => entry.url.startsWith("https://accounts.google.com/o/oauth2/v2/auth?"));
assert(googleProviderProbe && !googleProviderProbe.options.headers.cookie && !googleProviderProbe.options.headers.authorization, "Provider registration probe sent credentials or an existing session to Google.");

const rejectedGoogleRegistration = await probeGoogleProviderRegistration(googleStartLocation(), "https://tidewaycleaning.co.uk", {
  async fetch(url, options) {
    assert.equal(url, googleStartLocation());
    assert.equal(options.redirect, "manual");
    return new Response(null, { status: 302, headers: { location: "https://accounts.google.com/signin/oauth/error?authError=opaque" } });
  }
});
assert.equal(rejectedGoogleRegistration.ok, false);
assert.match(rejectedGoogleRegistration.detail, /exact Authorized redirect URI https:\/\/tidewaycleaning\.co\.uk\/api\/marketplace\/auth\/google\/callback/);
await assert.rejects(probeGoogleProviderRegistration("https://attacker.example/oauth", "https://tidewaycleaning.co.uk", { async fetch() { throw new Error("must not be called"); } }), /valid Homle Google authorization/i);

const appleOnlyRequests = [];
const appleOnlyAuthentication = await verifyDomainReadiness("https://tidewaycleaning.co.uk", {
  expectedSocialProviders: ["apple"],
  async resolveAddresses() { return ["93.184.216.34"]; },
  async tlsProbe() { return { daysRemaining: 60, validUntil: "2026-09-14T00:00:00.000Z" }; },
  async fetch(url, options) {
    appleOnlyRequests.push({ url, options });
    if (url === "http://tidewaycleaning.co.uk/") return new Response(null, { status: 308, headers: { location: "https://tidewaycleaning.co.uk/" } });
    if (url === "https://tidewaycleaning.co.uk/") return new Response("<!doctype html><title>Homle</title>", { status: 200, headers: { ...securityHeaders, "content-type": "text/html; charset=utf-8" } });
    if (url.endsWith("/api/health")) return jsonResponse({ ok: true, service: "tideway-marketplace", dataIntegrity: "healthy", writesAllowed: true, localDemosEnabled: false, marketplace: { enabled: false, ready: false, authenticationReady: true } });
    const boundary = privateBoundaryResponse(url);
    if (boundary) return boundary;
    if (url.endsWith("/api/auth/providers")) return jsonResponse({ ok: true, providers: { emailPassword: false, passwordReset: false, emailVerification: false, google: false, apple: true, facebook: false, roles: ["cleaner", "landlord"] } });
    if (url.endsWith("/api/marketplace/auth/google/start")) return new Response(null, { status: 404 });
    if (url.endsWith("/api/marketplace/auth/apple/start")) return new Response(null, { status: 302, headers: { location: appleStartLocation(), "set-cookie": `__Host-tideway_apple_flow=${"a".repeat(50)}; Path=/; HttpOnly; SameSite=None; Secure`, "cache-control": "no-store" } });
    if (url.startsWith("https://appleid.apple.com/auth/authorize?")) return new Response("<!doctype html><title>Sign in with Apple</title>", { status: 200, headers: { "content-type": "text/html" } });
    if (url.endsWith("/api/marketplace/auth/facebook/start")) return new Response(null, { status: 404 });
    throw new Error(`Unexpected URL: ${url}`);
  }
});
assert.equal(appleOnlyAuthentication.ok, true, "Apple-only account staging was not externally verifiable.");
assert.equal(appleOnlyAuthentication.checks.find((check) => check.name === "apple-sign-in-start")?.ok, true);
assert.equal(appleOnlyAuthentication.checks.find((check) => check.name === "apple-provider-registration")?.ok, true);
const appleProviderProbe = appleOnlyRequests.find((entry) => entry.url.startsWith("https://appleid.apple.com/auth/authorize?"));
assert(appleProviderProbe && !appleProviderProbe.options.headers.cookie && !appleProviderProbe.options.headers.authorization, "Provider registration probe sent credentials or an existing session to Apple.");

const rejectedAppleRegistration = await probeAppleProviderRegistration(appleStartLocation(), "https://tidewaycleaning.co.uk", {
  async fetch(url, options) {
    assert.equal(url, appleStartLocation());
    assert.equal(options.redirect, "manual");
    return new Response(null, { status: 302, headers: { location: "https://appleid.apple.com/auth/error?code=invalid_redirect_uri" } });
  }
});
assert.equal(rejectedAppleRegistration.ok, false);
assert.match(rejectedAppleRegistration.detail, /exact return URL https:\/\/tidewaycleaning\.co\.uk\/api\/marketplace\/auth\/apple\/callback/);
await assert.rejects(probeAppleProviderRegistration("https://attacker.example/oauth", "https://tidewaycleaning.co.uk", { async fetch() { throw new Error("must not be called"); } }), /valid Homle Apple authorization/i);

const googleOnlyAuthentication = await verifyDomainReadiness("https://tidewaycleaning.co.uk", {
  expectedSocialProviders: ["google"],
  async resolveAddresses() { return ["93.184.216.34"]; },
  async tlsProbe() { return { daysRemaining: 60, validUntil: "2026-09-14T00:00:00.000Z" }; },
  async fetch(url) {
    if (url === "http://tidewaycleaning.co.uk/") return new Response(null, { status: 308, headers: { location: "https://tidewaycleaning.co.uk/" } });
    if (url === "https://tidewaycleaning.co.uk/") return new Response("<!doctype html><title>Homle</title>", { status: 200, headers: { ...securityHeaders, "content-type": "text/html; charset=utf-8" } });
    if (url.endsWith("/api/health")) return jsonResponse({ ok: true, service: "tideway-marketplace", dataIntegrity: "healthy", writesAllowed: true, localDemosEnabled: false, marketplace: { enabled: false, ready: false, authenticationReady: true } });
    const boundary = privateBoundaryResponse(url);
    if (boundary) return boundary;
    if (url.endsWith("/api/auth/providers")) return jsonResponse({ ok: true, providers: { emailPassword: false, passwordReset: false, emailVerification: false, google: true, apple: false, facebook: false, roles: ["cleaner", "landlord"] } });
    if (url.endsWith("/api/marketplace/auth/google/start")) return new Response(null, { status: 302, headers: { location: googleStartLocation(), "set-cookie": `__Host-tideway_google_flow=${"g".repeat(50)}; Path=/; HttpOnly; SameSite=Lax; Secure`, "cache-control": "no-store" } });
    if (url.endsWith("/api/marketplace/auth/apple/start")) return new Response(null, { status: 404 });
    if (url.startsWith("https://accounts.google.com/o/oauth2/v2/auth?")) return new Response("<!doctype html><title>Sign in with Google</title>", { status: 200, headers: { "content-type": "text/html" } });
    if (url.endsWith("/api/marketplace/auth/facebook/start")) return new Response(null, { status: 404 });
    throw new Error(`Unexpected URL: ${url}`);
  }
});
assert.equal(googleOnlyAuthentication.ok, true, "Google-only account staging was incorrectly treated as incomplete email/password authentication.");
assert.equal(googleOnlyAuthentication.checks.find((check) => check.name === "authentication-capabilities")?.ok, true);
assert.equal(googleOnlyAuthentication.checks.find((check) => check.name === "google-provider-registration")?.ok, true);

const spoofedGoogle = await verifyDomainReadiness("https://tidewaycleaning.co.uk", {
  expectedSocialProviders: ["google"],
  async resolveAddresses() { return ["93.184.216.34"]; },
  async tlsProbe() { return { daysRemaining: 60 }; },
  async fetch(url) {
    if (url === "http://tidewaycleaning.co.uk/") return new Response(null, { status: 308, headers: { location: "https://tidewaycleaning.co.uk/" } });
    if (url === "https://tidewaycleaning.co.uk/") return new Response("<!doctype html><title>Homle</title>", { status: 200, headers: { ...securityHeaders, "content-type": "text/html" } });
    if (url.endsWith("/api/health")) return jsonResponse({ ok: true, service: "tideway-marketplace", dataIntegrity: "healthy", writesAllowed: true, localDemosEnabled: false, marketplace: { enabled: true, ready: true, authenticationReady: true } });
    const boundary = privateBoundaryResponse(url);
    if (boundary) return boundary;
    if (url.endsWith("/api/auth/providers")) return jsonResponse({ ok: true, providers: { emailPassword: true, passwordReset: true, emailVerification: true, google: true, apple: false, facebook: false, roles: ["cleaner", "landlord"] } });
    if (url.endsWith("/api/marketplace/auth/google/start")) return new Response(null, { status: 302, headers: { location: "https://attacker.example/oauth", "set-cookie": `__Host-tideway_google_flow=${"g".repeat(50)}; Path=/; HttpOnly; SameSite=Lax; Secure`, "cache-control": "no-store" } });
    if (url.endsWith("/api/marketplace/auth/apple/start")) return new Response(null, { status: 404 });
    if (url.endsWith("/api/marketplace/auth/facebook/start")) return new Response(null, { status: 404 });
    throw new Error(`Unexpected URL: ${url}`);
  }
});
assert.equal(spoofedGoogle.ok, false);
assert.equal(spoofedGoogle.checks.find((check) => check.name === "google-sign-in-start")?.ok, false, "A spoofed Google authorization route passed readiness.");
assert.equal(spoofedGoogle.checks.find((check) => check.name === "google-provider-registration")?.ok, false, "A spoofed Google route reached provider-registration readiness.");

const exposedPrivateSurfaces = await verifyDomainReadiness("https://tidewaycleaning.co.uk", {
  async resolveAddresses() { return ["93.184.216.34"]; },
  async tlsProbe() { return { daysRemaining: 60 }; },
  async fetch(url) {
    if (url === "http://tidewaycleaning.co.uk/") return new Response(null, { status: 308, headers: { location: "https://tidewaycleaning.co.uk/" } });
    if (url === "https://tidewaycleaning.co.uk/") return new Response("<!doctype html><title>Homle</title>", { status: 200, headers: { ...securityHeaders, "content-type": "text/html" } });
    if (url.endsWith("/api/health")) return jsonResponse({ ok: true, service: "tideway-marketplace", dataIntegrity: "healthy", writesAllowed: true, localDemosEnabled: true, marketplace: { enabled: false, ready: false, authenticationReady: false } });
    if (url.endsWith("/admin")) return new Response(null, { status: 302, headers: { location: "/login", "set-cookie": "admin_probe=leaked; Path=/; Secure; HttpOnly", "cache-control": "no-store" } });
    if (url.endsWith("/tracking-test")) return new Response("local demo", { status: 200, headers: { "content-type": "text/html", "cache-control": "no-store" } });
    if (url.endsWith("/tracking-test.html")) return new Response(JSON.stringify({ ok: false }), { status: 404, headers: { "content-type": "application/json", "cache-control": "no-store", "set-cookie": "probe=leaked" } });
    if (url.endsWith("/tracking-test.js")) return new Response(null, { status: 302, headers: { location: "/", "content-type": "application/json", "cache-control": "no-store" } });
    if (url.endsWith("/api/tracking-test/snapshot")) return new Response(JSON.stringify({ ok: false }), { status: 404, headers: { "content-type": "application/json", "cache-control": "public, max-age=60" } });
    if (url.endsWith("/api/auth/providers")) return jsonResponse({ ok: true, providers: { emailPassword: false, passwordReset: false, emailVerification: false, google: false, apple: false, facebook: false, roles: ["cleaner", "landlord"] } });
    if (["google", "apple", "facebook"].some((provider) => url.endsWith(`/api/marketplace/auth/${provider}/start`))) return new Response(null, { status: 404 });
    throw new Error(`Unexpected URL: ${url}`);
  }
});
assert.equal(exposedPrivateSurfaces.ok, false);
for (const name of ["health", "anonymous-admin-closed", "local-demo-closed:/tracking-test", "local-demo-closed:/tracking-test.html", "local-demo-closed:/tracking-test.js", "local-demo-closed:/api/tracking-test/snapshot"]) {
  assert.equal(exposedPrivateSurfaces.checks.find((check) => check.name === name)?.ok, false, `${name} accepted an exposed, redirected, cacheable or cookie-setting private surface.`);
}

await assert.rejects(verifyDomainReadiness("https://tidewaycleaning.co.uk", { expectedSocialProviders: "google" }), /array/i);
await assert.rejects(verifyDomainReadiness("https://tidewaycleaning.co.uk", { expectedSocialProviders: ["microsoft"] }), /google, apple and facebook/i);
await assert.rejects(verifyDomainReadiness("https://tidewaycleaning.co.uk", { expectedSocialProviders: ["google", "GOOGLE"] }), /duplicates/i);
assert.equal(normalizeExpectedReleaseCommit("A92999ED"), "a92999ed");
assert.throws(() => normalizeExpectedReleaseCommit("main"), /eight-character source commit/i);

for (const invalid of [
  "http://tidewaycleaning.co.uk", "https://localhost", "https://127.0.0.1", "https://tidewaycleaning.co.uk/path",
  "https://user:pass@tidewaycleaning.co.uk", "https://tidewaycleaning.co.uk:8443"
]) await assert.rejects(verifyDomainReadiness(invalid), /public|HTTPS|origin/i);

const bad = await verifyDomainReadiness("https://unsafe-cleaning.co.uk", {
  async resolveAddresses() { return ["192.168.1.8"]; },
  async tlsProbe() { return { daysRemaining: 3 }; },
  async fetch(url) {
    if (url.startsWith("http://")) return new Response(null, { status: 302, headers: { location: "https://other.example/" } });
    if (url.endsWith("/api/health")) return new Response(JSON.stringify({ ok: true, service: "wrong-service", dataIntegrity: "degraded", writesAllowed: false, localDemosEnabled: true, marketplace: { authenticationReady: false } }), { status: 200, headers: { "content-type": "application/json", "cache-control": "public" } });
    if (url.endsWith("/api/auth/providers")) return new Response(JSON.stringify({ providers: { emailPassword: true, roles: ["administrator"] }, leaked: "DATABASE_URL" }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response("not html", { status: 200, headers: { "content-type": "text/plain", "x-powered-by": "unsafe" } });
  }
});
assert.equal(bad.ok, false);
for (const name of ["dns", "tls", "http-redirect", "homepage", "security-headers", "health", "health-cache", "release-identity", "anonymous-admin-closed", "local-demo-closed:/tracking-test", "local-demo-closed:/tracking-test.html", "local-demo-closed:/tracking-test.js", "local-demo-closed:/api/tracking-test/snapshot", "authentication-capabilities", "authentication-cache", "google-sign-in-closed", "facebook-sign-in-closed"]) {
  assert.equal(bad.checks.find((check) => check.name === name)?.ok, false, `${name} failure was not detected.`);
}

console.log("Domain readiness tests passed: exact public origin, public DNS, trusted TLS, canonical redirect, security headers, exact packaged release identity, closed private/local surfaces, truthful authentication discovery, Google/Apple registration and closed/enabled social start-route proof.");
