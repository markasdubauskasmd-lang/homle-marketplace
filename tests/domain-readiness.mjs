import assert from "node:assert/strict";
import { verifyDomainReadiness } from "../tools/domain-readiness.mjs";

const securityHeaders = {
  "content-security-policy": "default-src 'self'; img-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()"
};

function jsonResponse(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { ...securityHeaders, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

const requested = [];
const good = await verifyDomainReadiness("https://tidewaycleaning.co.uk", {
  async resolveAddresses(hostname) { assert.equal(hostname, "tidewaycleaning.co.uk"); return ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"]; },
  async tlsProbe() { return { daysRemaining: 60, validUntil: "2026-09-14T00:00:00.000Z" }; },
  async fetch(url, options) {
    requested.push({ url, options });
    if (url === "http://tidewaycleaning.co.uk/") return new Response(null, { status: 308, headers: { location: "https://tidewaycleaning.co.uk/" } });
    if (url === "https://tidewaycleaning.co.uk/") return new Response("<!doctype html><title>Tideway</title>", { status: 200, headers: { ...securityHeaders, "content-type": "text/html; charset=utf-8" } });
    if (url.endsWith("/api/health")) return jsonResponse({ ok: true, service: "tideway-marketplace", dataIntegrity: "healthy", writesAllowed: true, marketplace: { enabled: false, ready: false, authenticationReady: false } });
    if (url.endsWith("/api/auth/providers")) return jsonResponse({ ok: true, providers: { emailPassword: false, passwordReset: false, emailVerification: false, google: false, apple: false, facebook: false, roles: ["cleaner", "landlord"] } });
    throw new Error(`Unexpected URL: ${url}`);
  }
});
assert.equal(good.ok, true);
assert.equal(good.origin, "https://tidewaycleaning.co.uk");
assert.ok(good.checks.every((check) => check.ok));
assert.equal(requested.length, 4);
assert.ok(requested.every((entry) => entry.options.redirect === "manual" && entry.options.signal instanceof AbortSignal));

for (const invalid of [
  "http://tidewaycleaning.co.uk", "https://localhost", "https://127.0.0.1", "https://tidewaycleaning.co.uk/path",
  "https://user:pass@tidewaycleaning.co.uk", "https://tidewaycleaning.co.uk:8443"
]) await assert.rejects(verifyDomainReadiness(invalid), /public|HTTPS|origin/i);

const bad = await verifyDomainReadiness("https://unsafe-cleaning.co.uk", {
  async resolveAddresses() { return ["192.168.1.8"]; },
  async tlsProbe() { return { daysRemaining: 3 }; },
  async fetch(url) {
    if (url.startsWith("http://")) return new Response(null, { status: 302, headers: { location: "https://other.example/" } });
    if (url.endsWith("/api/health")) return new Response(JSON.stringify({ ok: true, service: "wrong-service", dataIntegrity: "degraded", writesAllowed: false, marketplace: { authenticationReady: false } }), { status: 200, headers: { "content-type": "application/json", "cache-control": "public" } });
    if (url.endsWith("/api/auth/providers")) return new Response(JSON.stringify({ providers: { emailPassword: true, roles: ["administrator"] }, leaked: "DATABASE_URL" }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response("not html", { status: 200, headers: { "content-type": "text/plain", "x-powered-by": "unsafe" } });
  }
});
assert.equal(bad.ok, false);
for (const name of ["dns", "tls", "http-redirect", "homepage", "security-headers", "health", "health-cache", "authentication-capabilities", "authentication-cache"]) {
  assert.equal(bad.checks.find((check) => check.name === name)?.ok, false, `${name} failure was not detected.`);
}

console.log("Domain readiness tests passed: exact public origin, public DNS, trusted TLS lifetime, canonical redirect, security headers, Tideway health and truthful authentication discovery.");
