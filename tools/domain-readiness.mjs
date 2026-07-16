import { resolve4, resolve6 } from "node:dns/promises";
import { isIP } from "node:net";
import tls from "node:tls";
import { fileURLToPath } from "node:url";
import path from "node:path";

const toolPath = fileURLToPath(import.meta.url);
const maximumResponseBytes = 128 * 1024;
const requiredCspDirectives = Object.freeze(["default-src 'self'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"]);
const authenticationNames = Object.freeze(["emailPassword", "passwordReset", "emailVerification", "google", "apple", "facebook"]);

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

export async function resolvePublicAddresses(hostname) {
  const results = await Promise.allSettled([resolve4(hostname), resolve6(hostname)]);
  const addresses = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
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
  if (response.headers.has("x-powered-by")) errors.push("X-Powered-By should not disclose server technology.");
  return errors;
}

function safeJson(text, label) {
  try { return JSON.parse(text); } catch { throw new Error(`${label} did not return valid JSON.`); }
}

export async function verifyDomainReadiness(origin, options = {}) {
  const target = exactPublicOrigin(origin);
  const fetchImplementation = options.fetch || globalThis.fetch;
  if (typeof fetchImplementation !== "function") throw new TypeError("A fetch implementation is required.");
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
    const healthy = response.status === 200 && health?.ok === true && health?.service === "tideway-marketplace" && health?.dataIntegrity === "healthy" && health?.writesAllowed === true;
    record("health", healthy, "Tideway health must be HTTP 200 with healthy integrity and writes allowed.");
    record("health-cache", /(?:^|,)\s*no-store\b/i.test(response.headers.get("cache-control") || ""), "Health endpoint must use Cache-Control: no-store.");
  } catch (error) { record("health", false, error.message); }

  try {
    const response = await request(fetchImplementation, `${target.origin}/api/auth/providers`);
    const bodyText = await boundedText(response);
    const providers = safeJson(bodyText, "Authentication capability endpoint")?.providers;
    const containsSecretName = /CLIENT_SECRET|SESSION_SECRET|DATABASE_URL|AUTH_TOKEN_SECRET/i.test(bodyText);
    const rolesValid = providers?.roles?.join(",") === "cleaner,landlord";
    const marketplaceAuthReady = health?.marketplace?.authenticationReady === true;
    const emailStateValid = ["emailPassword", "passwordReset", "emailVerification"].every((name) => providers?.[name] === marketplaceAuthReady);
    const oauthClosed = ["google", "apple", "facebook"].every((name) => providers?.[name] === false);
    const typesValid = authenticationNames.every((name) => typeof providers?.[name] === "boolean");
    record("authentication-capabilities", response.status === 200 && rolesValid && emailStateValid && oauthClosed && typesValid && !containsSecretName, "Authentication discovery must match runtime readiness, keep OAuth closed and expose no secret names.");
    record("authentication-cache", /(?:^|,)\s*no-store\b/i.test(response.headers.get("cache-control") || ""), "Authentication capability endpoint must use Cache-Control: no-store.");
  } catch (error) { record("authentication-capabilities", false, error.message); }

  return Object.freeze({ ok: errors.length === 0, origin: target.origin, hostname: target.hostname, checkedAt: new Date().toISOString(), checks: Object.freeze(checks), errors: Object.freeze(errors) });
}

if (process.argv[1] && path.resolve(process.argv[1]) === toolPath) {
  try {
    const result = await verifyDomainReadiness(process.env.TIDEWAY_PUBLIC_ORIGIN);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
