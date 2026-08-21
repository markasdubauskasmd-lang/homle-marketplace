#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchLiveActivationSnapshot, normalizeLiveActivationOrigin } from "./live-activation-snapshot.mjs";

const toolPath = fileURLToPath(import.meta.url);
const maximumResponseBytes = 512 * 1024;

function exact(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function boundedText(response) {
  const text = await response.text();
  if (Buffer.byteLength(text) > maximumResponseBytes) throw new Error("A public release response exceeded the 512 KiB verification limit.");
  return text;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertHeader(response, name, expected, label) {
  const value = response.headers.get(name) || "";
  const matches = expected instanceof RegExp ? expected.test(value) : value === expected;
  assert(matches, `${label} returned an invalid ${name} header.`);
}

function assertSecurityHeaders(response, label, permissions) {
  assertHeader(response, "cache-control", /(?:^|,)\s*no-store\b/i, label);
  assertHeader(response, "strict-transport-security", /^max-age=31536000; includeSubDomains$/i, label);
  assertHeader(response, "x-content-type-options", "nosniff", label);
  assertHeader(response, "x-frame-options", "DENY", label);
  assertHeader(response, "referrer-policy", "strict-origin-when-cross-origin", label);
  assertHeader(response, "permissions-policy", permissions, label);
  const csp = response.headers.get("content-security-policy") || "";
  assert(csp.includes("default-src 'self'") && csp.includes("base-uri 'self'") && csp.includes("form-action 'self'") && csp.includes("frame-ancestors 'none'"), `${label} returned an incomplete Content-Security-Policy.`);
  assert(!csp.includes("unsafe-inline") && !csp.includes("unsafe-eval"), `${label} weakened its Content-Security-Policy.`);
}

async function request(fetchImplementation, url, options = {}) {
  const response = await fetchImplementation(url, {
    method: "GET",
    redirect: "manual",
    signal: options.signal,
    headers: {
      accept: options.accept || "text/html,application/xhtml+xml",
      "user-agent": "Homle-Live-Release-Check/1.0"
    }
  });
  return { response, body: options.body === false ? "" : await boundedText(response) };
}

export async function verifyLiveRelease(options = {}) {
  const origin = normalizeLiveActivationOrigin(options.origin);
  const expectedRelease = exact(options.expectedRelease);
  assert(expectedRelease, "An exact expected release commit is required.");
  const fetchImplementation = options.fetch || globalThis.fetch;
  if (typeof fetchImplementation !== "function") throw new TypeError("A fetch implementation is required.");

  // A healthy /api/health response alone cannot prove that Cloudflare and
  // Render are serving the intended HTML, redirects or security boundaries.
  const activation = await fetchLiveActivationSnapshot({
    origin,
    expectedRelease,
    fetch: fetchImplementation,
    timeoutMs: options.timeoutMs || 20_000
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 20_000);
  timer.unref?.();
  try {
    const publicPermissions = "camera=(), microphone=(), geolocation=()";
    const landlordPermissions = "camera=(self), microphone=(self), geolocation=()";
    const pages = [
      { path: "/", label: "Landing page", permissions: publicPermissions, markers: ['<title>Homle — cleaning, understood clearly</title>', '<link rel="canonical" href="https://homlle.com/">'] },
      { path: "/login", label: "Account entry page", permissions: publicPermissions, markers: ["<title>Sign in to Homle</title>", '<meta name="robots" content="noindex, nofollow">'] },
      { path: "/landlord/book", label: "Landlord booking journey", permissions: landlordPermissions, markers: ["<title>Book a clean — Homle</title>", '<meta name="robots" content="noindex, nofollow">'] },
      { path: "/landlord/dashboard", label: "Landlord dashboard shell", permissions: landlordPermissions, markers: ["<title>Landlord dashboard | Homle</title>", '<meta name="robots" content="noindex,nofollow,noarchive">'] }
    ];
    for (const page of pages) {
      const { response, body } = await request(fetchImplementation, `${origin}${page.path}`, { signal: controller.signal });
      assert(response.status === 200, `${page.label} returned HTTP ${response.status}.`);
      assertHeader(response, "content-type", /^text\/html\b/i, page.label);
      assertSecurityHeaders(response, page.label, page.permissions);
      for (const marker of page.markers) assert(body.includes(marker), `${page.label} did not contain its release identity marker.`);
    }

    const { response: robotsResponse, body: robots } = await request(fetchImplementation, `${origin}/robots.txt`, { signal: controller.signal, accept: "text/plain" });
    assert(robotsResponse.status === 200, `Crawler policy returned HTTP ${robotsResponse.status}.`);
    assertHeader(robotsResponse, "content-type", /^text\/plain\b/i, "Crawler policy");
    assertHeader(robotsResponse, "cache-control", "no-cache", "Crawler policy");
    assert(robots.includes("Sitemap: https://homlle.com/sitemap.xml") && ["/admin", "/api/", "/bookings/", "/cleaner/", "/landlord/", "/login", "/signup"].every((route) => robots.includes(`Disallow: ${route}`)), "Crawler policy exposed a private surface or omitted the canonical sitemap.");
    assert(!robots.includes("onrender.com"), "Crawler policy advertised the Render preview host.");

    const { response: sitemapResponse, body: sitemap } = await request(fetchImplementation, `${origin}/sitemap.xml`, { signal: controller.signal, accept: "application/xml" });
    assert(sitemapResponse.status === 200, `Canonical sitemap returned HTTP ${sitemapResponse.status}.`);
    assertHeader(sitemapResponse, "content-type", /^application\/xml\b/i, "Canonical sitemap");
    assertHeader(sitemapResponse, "cache-control", "no-cache", "Canonical sitemap");
    const sitemapLocations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
    assert(JSON.stringify(sitemapLocations) === JSON.stringify([`${origin}/`]), "Canonical sitemap advertised anything other than the public homepage.");

    const redirects = [
      { path: "/favicon.ico", location: "/homle-logo-128-4f82ebad.png", cache: "no-cache", label: "Favicon fallback" },
      { path: "/landlord/scan", location: "/landlord/book", cache: "no-store", label: "Retired scanner route" }
    ];
    for (const redirect of redirects) {
      const { response } = await request(fetchImplementation, `${origin}${redirect.path}`, { signal: controller.signal, body: false });
      assert(response.status === 308, `${redirect.label} returned HTTP ${response.status} instead of a permanent redirect.`);
      assertHeader(response, "location", redirect.location, redirect.label);
      assertHeader(response, "cache-control", redirect.cache, redirect.label);
    }

    for (const privateProbe of ["/.env", "/wp-login.php"]) {
      const { response } = await request(fetchImplementation, `${origin}${privateProbe}`, { signal: controller.signal, accept: "application/json" });
      assert(response.status === 404, `${privateProbe} was publicly reachable.`);
      assertHeader(response, "cache-control", /(?:^|,)\s*no-store\b/i, privateProbe);
    }

    return Object.freeze({
      ok: true,
      origin,
      release: activation.release,
      verified: Object.freeze({
        activation: true,
        publicPages: pages.length,
        privateHtmlNoStore: true,
        securityHeaders: true,
        crawlerBoundary: true,
        canonicalSitemap: true,
        redirects: redirects.length,
        sensitivePathDenials: 2
      }),
      activationReadiness: activation.readiness,
      remainingActions: activation.remainingActions
    });
  } finally {
    clearTimeout(timer);
  }
}

function commandOptions(argv, env = process.env) {
  const positional = argv.filter((value) => !value.startsWith("--"));
  const releaseArgument = argv.find((value) => value.startsWith("--expect-release="));
  const unknown = argv.filter((value) => value.startsWith("--") && !value.startsWith("--expect-release="));
  if (unknown.length || positional.length > 1) throw new TypeError("Usage: node tools/live-release-check.mjs <https-origin> --expect-release=1234abcd");
  return {
    origin: positional[0] || env.HOMLE_PUBLIC_ORIGIN,
    expectedRelease: releaseArgument?.slice("--expect-release=".length) || env.HOMLE_EXPECTED_RELEASE_COMMIT
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === toolPath) {
  try {
    console.log(JSON.stringify(await verifyLiveRelease(commandOptions(process.argv.slice(2))), null, 2));
  } catch (error) {
    console.error(`Homle live release check failed: ${error instanceof Error ? error.message : "Unknown verification failure."}`);
    process.exitCode = 1;
  }
}
