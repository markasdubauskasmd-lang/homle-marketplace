import assert from "node:assert/strict";
import { verifyLiveRelease } from "../tools/live-release-check.mjs";

function securityHeaders(permissions, overrides = {}) {
  return {
    "cache-control": "no-store",
    "content-security-policy": "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    "permissions-policy": permissions,
    "referrer-policy": "strict-origin-when-cross-origin",
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    ...overrides
  };
}

function response(body, status = 200, headers = {}) {
  return new Response(body, { status, headers });
}

const publicPermissions = "camera=(), microphone=(), geolocation=()";
const landlordPermissions = "camera=(self), microphone=(self), geolocation=()";
const health = {
  ok: true,
  service: "tideway-marketplace",
  release: { sourceCommit: "f4d88fe8", migrationCount: 102 },
  dataIntegrity: "healthy",
  writesAllowed: true,
  marketplace: {
    enabled: true, ready: true, authenticationReady: true, emailReady: false,
    mediaReady: true, realtimeReady: true, geocodingReady: true, matchingReady: true,
    paymentsReady: true, automaticDispatchReady: true, speechSummaryReady: true, roomVisionReady: true
  }
};
const providers = {
  ok: true,
  providers: { emailPassword: false, passwordReset: false, emailVerification: false, google: true, apple: false, facebook: false, roles: ["cleaner", "landlord"] }
};
const pages = new Map([
  ["/", '<title>Homle — cleaning, understood clearly</title><link rel="canonical" href="https://homlle.com/">'],
  ["/login", '<title>Sign in to Homle</title><meta name="robots" content="noindex, nofollow">'],
  ["/landlord/book", '<title>Book a clean — Homle</title><meta name="robots" content="noindex, nofollow">'],
  ["/landlord/dashboard", '<title>Landlord dashboard | Homle</title><meta name="robots" content="noindex,nofollow,noarchive">']
]);

function liveFetch(overrides = {}) {
  const requests = [];
  return {
    requests,
    async fetch(url, options) {
      requests.push({ url, options });
      const parsed = new URL(url);
      if (overrides[parsed.pathname]) return overrides[parsed.pathname](parsed, options);
      if (parsed.pathname === "/api/health") return response(JSON.stringify(health), 200, { "content-type": "application/json", "cache-control": "no-store" });
      if (parsed.pathname === "/api/auth/providers") return response(JSON.stringify(providers), 200, { "content-type": "application/json", "cache-control": "no-store" });
      if (pages.has(parsed.pathname)) {
        const permissions = parsed.pathname.startsWith("/landlord/") ? landlordPermissions : publicPermissions;
        return response(pages.get(parsed.pathname), 200, securityHeaders(permissions, { "content-type": "text/html; charset=utf-8" }));
      }
      if (parsed.pathname === "/robots.txt") return response("User-agent: *\nDisallow: /admin\nDisallow: /api/\nDisallow: /bookings/\nDisallow: /cleaner/\nDisallow: /landlord/\nDisallow: /login\nDisallow: /signup\nSitemap: https://homlle.com/sitemap.xml\n", 200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-cache" });
      if (parsed.pathname === "/sitemap.xml") return response('<?xml version="1.0"?><urlset><url><loc>https://homlle.com/</loc></url></urlset>', 200, { "content-type": "application/xml; charset=utf-8", "cache-control": "no-cache" });
      if (parsed.pathname === "/favicon.ico") return response("", 308, { location: "/homle-logo-128-4f82ebad.png", "cache-control": "no-cache" });
      if (parsed.pathname === "/landlord/scan") return response("", 308, { location: "/landlord/book", "cache-control": "no-store" });
      if (["/.env", "/wp-login.php"].includes(parsed.pathname)) return response('{"ok":false}', 404, { "content-type": "application/json", "cache-control": "no-store" });
      throw new Error(`Unexpected test request: ${url}`);
    }
  };
}

const live = liveFetch();
const result = await verifyLiveRelease({ origin: "https://homlle.com", expectedRelease: "f4d88fe8", fetch: live.fetch });
assert.equal(result.ok, true);
assert.equal(result.release.sourceCommit, "f4d88fe8");
assert.deepEqual(result.verified, {
  activation: true, publicPages: 4, privateHtmlNoStore: true, securityHeaders: true,
  crawlerBoundary: true, canonicalSitemap: true, redirects: 2, sensitivePathDenials: 2
});
assert.equal(live.requests.length, 12);
assert(live.requests.every(({ options }) => options.method === "GET" && !options.headers.authorization && !options.headers.cookie), "Release check sent credentials to a public endpoint.");

await assert.rejects(verifyLiveRelease({
  origin: "https://homlle.com",
  expectedRelease: "f4d88fe8",
  fetch: liveFetch({
    "/": () => response(pages.get("/"), 200, securityHeaders(publicPermissions, { "content-type": "text/html", "cache-control": "public, max-age=300" }))
  }).fetch
}), /Landing page returned an invalid cache-control header/);

await assert.rejects(verifyLiveRelease({
  origin: "https://homlle.com",
  expectedRelease: "f4d88fe8",
  fetch: liveFetch({
    "/landlord/book": () => response(pages.get("/landlord/book"), 200, securityHeaders(publicPermissions, { "content-type": "text/html" }))
  }).fetch
}), /Landlord booking journey returned an invalid permissions-policy header/);

await assert.rejects(verifyLiveRelease({
  origin: "https://homlle.com",
  expectedRelease: "f4d88fe8",
  fetch: liveFetch({ "/landlord/scan": () => response("", 200, { "cache-control": "no-store" }) }).fetch
}), /Retired scanner route returned HTTP 200/);

await assert.rejects(verifyLiveRelease({
  origin: "https://homlle.com",
  expectedRelease: "f4d88fe8",
  fetch: liveFetch({ "/.env": () => response("DATABASE_URL=secret", 200, { "cache-control": "no-store" }) }).fetch
}), /\.env was publicly reachable/);

await assert.rejects(verifyLiveRelease({ origin: "https://homlle.com", fetch: liveFetch().fetch }), /expected release commit is required/);

console.log("Live release check tests passed: exact release, public/private HTML, cache and security headers, crawler policy, canonical sitemap, redirects, credential-free requests and sensitive-path denials.");
