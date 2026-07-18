import { lookup, resolve4, resolve6 } from "node:dns/promises";
import { isIP } from "node:net";
import tls from "node:tls";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { normalizeExpectedReleaseCommit, packagedReleaseIdentityMatches } from "../release-identity.mjs";

const toolPath = fileURLToPath(import.meta.url);
const maximumResponseBytes = 128 * 1024;
const requiredCspDirectives = Object.freeze(["default-src 'self'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"]);
const authenticationNames = Object.freeze(["emailPassword", "passwordReset", "emailVerification", "google", "apple", "facebook"]);
const verifiableSocialProviders = Object.freeze(["google", "apple", "facebook"]);

function expectedSocialProviders(value = []) {
  if (!Array.isArray(value)) throw new TypeError("Expected social providers must be an array.");
  const normalized = value.map((entry) => String(entry || "").trim().toLowerCase());
  if (normalized.some((entry) => !verifiableSocialProviders.includes(entry))) throw new TypeError("Expected social providers may contain only google, apple and facebook.");
  if (new Set(normalized).size !== normalized.length) throw new TypeError("Expected social providers must not contain duplicates.");
  return Object.freeze(new Set(normalized));
}

function expectedSocialProvidersFromEnvironment(value) {
  const text = String(value || "").trim();
  return text ? text.split(",").map((entry) => entry.trim()) : [];
}

function exactPublicOrigin(value) {
  let url;
  try { url = new URL(String(value || "").trim()); } catch { throw new TypeError("A valid public HTTPS origin is required."); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash || url.origin !== String(value || "").trim().replace(/\/$/, "")) {
    throw new TypeError("Public origin must be exact HTTPS with no credentials, port, path, query or fragment.");
  }
  const hostname = url.hostname.toLowerCase();
  if (isIP(hostname) || hostname === "localhost" || !hostname.includes(".") || hostname.endsWith(".local") || hostname.endsWith(".localhost")) throw new TypeError("Public origin must use a real public hostname, not localhost or an IP address.");
  return Object.freeze({ origin: url.origin, hostname });
}

function publicIpv4(value) {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function publicIpv6(value) {
  const normalized = value.toLowerCase().split("%")[0];
  if (normalized.startsWith("::ffff:")) return publicIpv4(normalized.slice(7));
  return normalized !== "::" && normalized !== "::1" && !normalized.startsWith("fc") && !normalized.startsWith("fd") && !normalized.startsWith("fe") && !normalized.startsWith("ff") && !normalized.startsWith("2001:db8:");
}

function isPublicAddress(value) {
  const family = isIP(value);
  return family === 4 ? publicIpv4(value) : family === 6 ? publicIpv6(value) : false;
}

export async function resolvePublicAddresses(hostname, options = {}) {
  const query4 = options.resolve4 || resolve4;
  const query6 = options.resolve6 || resolve6;
  const systemLookup = options.lookup || lookup;
  const results = await Promise.allSettled([query4(hostname), query6(hostname)]);
  let addresses = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (!addresses.length) {
    try {
      const fallback = await systemLookup(hostname, { all: true, verbatim: true });
      addresses = fallback.map((record) => record?.address).filter(Boolean);
    } catch {}
  }
  if (!addresses.length) throw new Error("The hostname has no IPv4 or IPv6 address record.");
  if (addresses.some((address) => !isPublicAddress(address))) throw new Error("The hostname resolves to a private, local or reserved address.");
  return Object.freeze([...new Set(addresses)]);
}

export function probeTrustedTls(hostname, options = {}) {
  const connect = options.connect || tls.connect;
  const timeoutMs = options.timeoutMs || 8000;
  return new Promise((resolve, reject) => {
    let settled = false;
    let socket;
    let timer;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch {}
      if (error) reject(error); else resolve(value);
    };
    try {
      socket = connect({ host: hostname, port: 443, servername: hostname, rejectUnauthorized: true });
    } catch (error) {
      finish(error);
      return;
    }
    socket.once("secureConnect", () => {
      if (socket.authorized !== true) return finish(new Error("TLS certificate is not trusted for this hostname."));
      const certificate = socket.getPeerCertificate();
      const validUntil = new Date(certificate?.valid_to || "");
      if (!Number.isFinite(validUntil.getTime())) return finish(new Error("TLS certificate expiry could not be verified."));
      finish(null, Object.freeze({ validUntil: validUntil.toISOString(), daysRemaining: Math.floor((validUntil.getTime() - Date.now()) / 86_400_000) }));
    });
    socket.once("error", (error) => finish(error));
    timer = setTimeout(() => finish(new Error("TLS verification timed out.")), timeoutMs);
    timer.unref?.();
  });
}

async function boundedText(response) {
  if (!response.body?.getReader) {
    const value = await response.text();
    if (Buffer.byteLength(value) > maximumResponseBytes) throw new Error("Public endpoint response exceeded the verification limit.");
    return value;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumResponseBytes) throw new Error("Public endpoint response exceeded the verification limit.");
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function request(fetchImplementation, url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  timer.unref?.();
  try {
    return await fetchImplementation(url, { redirect: "manual", signal: controller.signal, headers: { "user-agent": "Tideway-Domain-Readiness/1.0" }, ...options });
  } finally {
    clearTimeout(timer);
  }
}

function securityHeaderErrors(response) {
  const errors = [];
  const csp = response.headers.get("content-security-policy") || "";
  for (const directive of requiredCspDirectives) if (!csp.includes(directive)) errors.push(`Content-Security-Policy is missing ${directive}.`);
  if (response.headers.get("x-content-type-options")?.toLowerCase() !== "nosniff") errors.push("X-Content-Type-Options must be nosniff.");
  if (response.headers.get("x-frame-options")?.toUpperCase() !== "DENY") errors.push("X-Frame-Options must be DENY.");
  if (!response.headers.get("referrer-policy")) errors.push("Referrer-Policy is missing.");
  const permissions = response.headers.get("permissions-policy") || "";
  if (!["camera", "microphone", "geolocation"].every((name) => permissions.includes(`${name}=`))) errors.push("Permissions-Policy must state camera, microphone and geolocation access.");
  const hsts = response.headers.get("strict-transport-security") || "";
  const maxAge = Number(hsts.match(/(?:^|;)\s*max-age=(\d+)/i)?.[1] || 0);
  if (maxAge < 31_536_000) errors.push("Strict-Transport-Security must have max-age of at least one year.");
  if (csp.trim().toLowerCase() === "upgrade-insecure-requests") errors.push("The hosting edge replaced Homle's application CSP with upgrade-insecure-requests only.");
  if (response.headers.has("x-powered-by")) errors.push("X-Powered-By should not disclose server technology.");
  return errors;
}

function safeJson(text, label) {
  try { return JSON.parse(text); } catch { throw new Error(`${label} did not return valid JSON.`); }
}

function privateBoundaryClosed(response, expectedStatus) {
  return response.status === expectedStatus
    && /^application\/json\b/i.test(response.headers.get("content-type") || "")
    && /(?:^|,)\s*no-store\b/i.test(response.headers.get("cache-control") || "")
    && !response.headers.has("location")
    && !response.headers.has("set-cookie");
}

function secureFlowCookie(headers, provider) {
  const cookie = headers.get("set-cookie") || "";
  return cookie.startsWith(`__Host-tideway_${provider}_flow=`)
    && /;\s*Path=\//i.test(cookie)
    && /;\s*HttpOnly(?:;|$)/i.test(cookie)
    && /;\s*Secure(?:;|$)/i.test(cookie)
    && new RegExp(`;\\s*SameSite=${provider === "apple" ? "None" : "Lax"}(?:;|$)`, "i").test(cookie)
    && !/;\s*Domain=/i.test(cookie);
}

function validSocialStartLocation(value, provider, origin) {
  let location;
  try { location = new URL(value); } catch { return false; }
  const redirectUri = `${origin}/api/marketplace/auth/${provider}/callback`;
  const common = location.protocol === "https:"
    && !location.username
    && !location.password
    && !location.hash
    && location.searchParams.get("redirect_uri") === redirectUri
    && location.searchParams.get("response_type") === "code"
    && /^[A-Za-z0-9_-]{32,128}$/.test(location.searchParams.get("state") || "");
  if (!common) return false;
  if (provider === "google") {
    const scopes = new Set((location.searchParams.get("scope") || "").split(/\s+/).filter(Boolean));
    return location.hostname === "accounts.google.com"
      && location.pathname === "/o/oauth2/v2/auth"
      && ["openid", "email", "profile"].every((scope) => scopes.has(scope))
      && location.searchParams.get("code_challenge_method") === "S256"
      && /^[A-Za-z0-9_-]{32,128}$/.test(location.searchParams.get("nonce") || "")
      && /^[A-Za-z0-9_-]{43,128}$/.test(location.searchParams.get("code_challenge") || "");
  }
  if (provider === "apple") {
    const scopes = new Set((location.searchParams.get("scope") || "").split(/\s+/).filter(Boolean));
    return location.hostname === "appleid.apple.com"
      && location.pathname === "/auth/authorize"
      && location.searchParams.get("response_mode") === "form_post"
      && ["name", "email"].every((scope) => scopes.has(scope))
      && /^[A-Za-z0-9_-]{32,128}$/.test(location.searchParams.get("nonce") || "");
  }
  return provider === "facebook"
    && location.hostname === "www.facebook.com"
    && /^\/v\d{1,2}\.\d{1,2}\/dialog\/oauth$/.test(location.pathname)
    && new Set((location.searchParams.get("scope") || "").split(/[\s,]+/).filter(Boolean)).has("email");
}

export async function probeGoogleProviderRegistration(locationValue, origin, options = {}) {
  if (!validSocialStartLocation(locationValue, "google", origin)) throw new TypeError("A valid Homle Google authorization start URL is required.");
  const fetchImplementation = options.fetch || globalThis.fetch;
  if (typeof fetchImplementation !== "function") throw new TypeError("A fetch implementation is required.");
  const response = await request(fetchImplementation, locationValue);
  try {
    if (response.status === 200) return Object.freeze({ ok: true, detail: "Google accepted the registered callback and continued to its sign-in flow." });
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return Object.freeze({ ok: false, detail: "Google did not accept the OAuth request before sign-in." });
    }
    let destination;
    try { destination = new URL(response.headers.get("location") || ""); } catch {
      return Object.freeze({ ok: false, detail: "Google returned an invalid sign-in continuation." });
    }
    const trustedGoogleDestination = destination.protocol === "https:"
      && destination.hostname === "accounts.google.com"
      && !destination.username
      && !destination.password;
    if (!trustedGoogleDestination || destination.pathname.startsWith("/signin/oauth/error")) {
      return Object.freeze({ ok: false, detail: `Google rejected the OAuth request before sign-in. Add the exact Authorized redirect URI ${origin}/api/marketplace/auth/google/callback to this Google web client and save it.` });
    }
    return Object.freeze({ ok: true, detail: "Google accepted the registered callback and continued to its sign-in flow." });
  } finally {
    await response.body?.cancel?.();
  }
}

export async function verifyDomainReadiness(origin, options = {}) {
  const target = exactPublicOrigin(origin);
  const fetchImplementation = options.fetch || globalThis.fetch;
  if (typeof fetchImplementation !== "function") throw new TypeError("A fetch implementation is required.");
  const expectedSocial = expectedSocialProviders(options.expectedSocialProviders);
  const expectedRelease = options.expectedReleaseCommit ? normalizeExpectedReleaseCommit(options.expectedReleaseCommit) : null;
  const errors = [];
  const checks = [];
  const record = (name, ok, detail) => { checks.push(Object.freeze({ name, ok, detail })); if (!ok) errors.push(detail); };

  try {
    const addresses = await (options.resolveAddresses || resolvePublicAddresses)(target.hostname);
    record("dns", Array.isArray(addresses) && addresses.length > 0 && addresses.every(isPublicAddress), `DNS must resolve ${target.hostname} only to public addresses.`);
  } catch (error) { record("dns", false, error.message); }

  try {
    const certificate = await (options.tlsProbe || probeTrustedTls)(target.hostname);
    record("tls", Number(certificate?.daysRemaining) >= 14, "TLS certificate must be trusted and remain valid for at least 14 days.");
  } catch (error) { record("tls", false, error.message); }

  try {
    const httpResponse = await request(fetchImplementation, `http://${target.hostname}/`);
    const location = httpResponse.headers.get("location");
    record("http-redirect", [301, 308].includes(httpResponse.status) && location === `${target.origin}/`, `HTTP must permanently redirect exactly to ${target.origin}/.`);
    await httpResponse.body?.cancel?.();
  } catch (error) { record("http-redirect", false, error.message); }

  try {
    const homepage = await request(fetchImplementation, `${target.origin}/`);
    const headerErrors = securityHeaderErrors(homepage);
    const contentType = homepage.headers.get("content-type") || "";
    record("homepage", homepage.status === 200 && /^text\/html\b/i.test(contentType), "HTTPS homepage must return HTTP 200 with HTML.");
    record("security-headers", headerErrors.length === 0, headerErrors.join(" ") || "Required browser and transport security headers are present.");
    record("anonymous-cookie", !homepage.headers.has("set-cookie"), "Anonymous homepage must not create a session cookie.");
    await homepage.body?.cancel?.();
  } catch (error) { record("homepage", false, error.message); }

  let health;
  try {
    const response = await request(fetchImplementation, `${target.origin}/api/health`);
    health = safeJson(await boundedText(response), "Health endpoint");
    const healthy = response.status === 200 && health?.ok === true && health?.service === "tideway-marketplace" && health?.dataIntegrity === "healthy" && health?.writesAllowed === true && health?.localDemosEnabled === false;
    record("health", healthy, "Tideway health must be HTTP 200 with healthy integrity, writes allowed and local demos disabled.");
    record("health-cache", /(?:^|,)\s*no-store\b/i.test(response.headers.get("cache-control") || ""), "Health endpoint must use Cache-Control: no-store.");
    record("release-identity", packagedReleaseIdentityMatches(health?.release, expectedRelease), expectedRelease ? `The live Homle runtime must identify verified release ${expectedRelease}.` : "The live Homle runtime must expose a valid packaged release identity.");
  } catch (error) { record("health", false, error.message); }

  try {
    const response = await request(fetchImplementation, `${target.origin}/admin`);
    record("anonymous-admin-closed", privateBoundaryClosed(response, 401), "Anonymous /admin must return a non-cacheable JSON 401 without a redirect, session cookie or private control-desk HTML.");
    await response.body?.cancel?.();
  } catch (error) { record("anonymous-admin-closed", false, error.message); }

  for (const pathname of ["/tracking-test", "/tracking-test.html", "/tracking-test.js", "/api/tracking-test/snapshot"]) {
    const checkName = `local-demo-closed:${pathname}`;
    try {
      const response = await request(fetchImplementation, `${target.origin}${pathname}`);
      record(checkName, privateBoundaryClosed(response, 404), `${pathname} must return a non-cacheable JSON 404 without a redirect or cookie in production.`);
      await response.body?.cancel?.();
    } catch (error) { record(checkName, false, error.message); }
  }

  try {
    const response = await request(fetchImplementation, `${target.origin}/api/auth/providers`);
    const bodyText = await boundedText(response);
    const providers = safeJson(bodyText, "Authentication capability endpoint")?.providers;
    const containsSecretName = /CLIENT_SECRET|SESSION_SECRET|DATABASE_URL|AUTH_TOKEN_SECRET/i.test(bodyText);
    const rolesValid = providers?.roles?.join(",") === "cleaner,landlord";
    const marketplaceAuthReady = health?.marketplace?.authenticationReady === true;
    const emailStates = ["emailPassword", "passwordReset", "emailVerification"].map((name) => providers?.[name]);
    const emailStateValid = emailStates.every((value) => value === emailStates[0]) && (emailStates[0] === false || marketplaceAuthReady);
    const socialStateValid = verifiableSocialProviders.every((name) => providers?.[name] === expectedSocial.has(name));
    const expectedStatePossible = expectedSocial.size === 0 || marketplaceAuthReady;
    const typesValid = authenticationNames.every((name) => typeof providers?.[name] === "boolean");
    const expectation = expectedSocial.size ? [...expectedSocial].join(" and ") : "no social provider";
    record("authentication-capabilities", response.status === 200 && rolesValid && emailStateValid && socialStateValid && expectedStatePossible && typesValid && !containsSecretName, `Authentication discovery must match runtime readiness, advertise exactly ${expectation}, keep Apple closed and expose no secret names.`);
    record("authentication-cache", /(?:^|,)\s*no-store\b/i.test(response.headers.get("cache-control") || ""), "Authentication capability endpoint must use Cache-Control: no-store.");
  } catch (error) { record("authentication-capabilities", false, error.message); }

  for (const provider of verifiableSocialProviders) {
    try {
      const response = await request(fetchImplementation, `${target.origin}/api/marketplace/auth/${provider}/start`);
      if (expectedSocial.has(provider)) {
        const location = response.headers.get("location");
        const valid = response.status === 302
          && validSocialStartLocation(location, provider, target.origin)
          && secureFlowCookie(response.headers, provider)
          && /(?:^|,)\s*no-store\b/i.test(response.headers.get("cache-control") || "");
        record(`${provider}-sign-in-start`, valid, `${provider[0].toUpperCase()}${provider.slice(1)} sign-in must start through its exact HTTPS provider route with the canonical callback, a secure flow cookie and no-store response.`);
        if (provider === "google") {
          if (!valid) {
            record("google-provider-registration", false, "Google callback registration was not probed because Homle's sign-in start response was invalid.");
          } else {
            try {
              const providerRegistration = await probeGoogleProviderRegistration(location, target.origin, { fetch: fetchImplementation });
              record("google-provider-registration", providerRegistration.ok, providerRegistration.detail);
            } catch (error) {
              record("google-provider-registration", false, error.message);
            }
          }
        }
      } else {
        const closed = response.status === 404 && !response.headers.has("location") && !response.headers.has("set-cookie");
        record(`${provider}-sign-in-closed`, closed, `${provider[0].toUpperCase()}${provider.slice(1)} sign-in must return 404 without a redirect or cookie while it is not expected.`);
      }
      await response.body?.cancel?.();
    } catch (error) { record(`${provider}-sign-in-${expectedSocial.has(provider) ? "start" : "closed"}`, false, error.message); }
  }

  return Object.freeze({ ok: errors.length === 0, origin: target.origin, hostname: target.hostname, checkedAt: new Date().toISOString(), checks: Object.freeze(checks), errors: Object.freeze(errors) });
}

if (process.argv[1] && path.resolve(process.argv[1]) === toolPath) {
  try {
    const result = await verifyDomainReadiness(process.env.TIDEWAY_PUBLIC_ORIGIN, {
      expectedSocialProviders: expectedSocialProvidersFromEnvironment(process.env.TIDEWAY_EXPECT_SOCIAL_PROVIDERS),
      expectedReleaseCommit: process.env.TIDEWAY_EXPECT_RELEASE
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
