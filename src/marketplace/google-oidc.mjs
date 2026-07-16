import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from "node:crypto";

const authorizationEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
const tokenEndpoint = "https://oauth2.googleapis.com/token";
const jwksEndpoint = "https://www.googleapis.com/oauth2/v3/certs";
const developmentCookieName = "tideway_google_flow";
const flowLifetimeSeconds = 10 * 60;
const maximumClockSkewSeconds = 60;
const maximumProviderResponseBytes = 64 * 1024;

function boundedSecret(value, label, minimum = 1) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < minimum || text.length > 4096 || /[\u0000-\u001f\u007f]/.test(text)) throw new TypeError(`${label} is invalid.`);
  return text;
}

function exactOrigin(value) {
  try {
    const url = new URL(value);
    if (url.origin !== String(value).replace(/\/$/, "") || url.username || url.password) throw new Error();
    return url.origin;
  } catch {
    throw new TypeError("Google sign-in requires an exact application origin.");
  }
}

function base64url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function decodeBase64url(value, label, maximumBytes = 16 * 1024) {
  if (typeof value !== "string" || !value || value.length > maximumBytes * 2 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new TypeError(`${label} is malformed.`);
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length > maximumBytes || base64url(decoded) !== value) throw new TypeError(`${label} is malformed.`);
  return decoded;
}

function safeJson(buffer, label) {
  try {
    const value = JSON.parse(buffer.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new TypeError(`${label} is malformed.`);
  }
}

function equalText(left, right) {
  const first = Buffer.from(String(left), "utf8");
  const second = Buffer.from(String(right), "utf8");
  return first.length === second.length && timingSafeEqual(first, second);
}

function signedFlow(payload, secret) {
  const encoded = base64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const signature = base64url(createHmac("sha256", secret).update("tideway:google-flow:v1\0", "utf8").update(encoded, "ascii").digest());
  return `${encoded}.${signature}`;
}

function verifiedFlow(value, secret, nowSeconds) {
  if (typeof value !== "string" || value.length > 4096) throw new TypeError("The Google sign-in attempt is missing or expired.");
  const parts = value.split(".");
  if (parts.length !== 2) throw new TypeError("The Google sign-in attempt is missing or expired.");
  const expected = createHmac("sha256", secret).update("tideway:google-flow:v1\0", "utf8").update(parts[0], "ascii").digest();
  const supplied = decodeBase64url(parts[1], "Google sign-in cookie signature", 64);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new TypeError("The Google sign-in attempt is missing or expired.");
  const payload = safeJson(decodeBase64url(parts[0], "Google sign-in cookie", 3072), "Google sign-in cookie");
  if (payload.v !== 1 || !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp) || payload.iat > nowSeconds + maximumClockSkewSeconds || payload.exp < nowSeconds || payload.exp - payload.iat !== flowLifetimeSeconds) throw new TypeError("The Google sign-in attempt is missing or expired.");
  if (!["sign-in", "link", "step-up"].includes(payload.purpose)) throw new TypeError("The Google sign-in attempt is missing or expired.");
  for (const key of ["state", "nonce", "verifier"]) if (typeof payload[key] !== "string" || payload[key].length < 32 || payload[key].length > 128 || !/^[A-Za-z0-9_-]+$/.test(payload[key])) throw new TypeError("The Google sign-in attempt is missing or expired.");
  return payload;
}

function cookieValue(header, cookieName) {
  const matches = [];
  for (const field of String(header || "").split(";")) {
    const separator = field.indexOf("=");
    if (separator < 0) continue;
    if (field.slice(0, separator).trim() === cookieName) matches.push(field.slice(separator + 1).trim());
  }
  if (matches.length !== 1) throw new TypeError("The Google sign-in attempt is missing or expired.");
  return matches[0];
}

function flowCookie(value, secure, cookieName) {
  return `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${flowLifetimeSeconds}${secure ? "; Secure" : ""}`;
}

function expiredFlowCookie(secure, cookieName) {
  return `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure ? "; Secure" : ""}`;
}

function singleQuery(url, name, maximum) {
  const values = url.searchParams.getAll(name);
  if (values.length !== 1 || !values[0] || values[0].length > maximum || /[\u0000-\u001f\u007f]/.test(values[0])) throw new TypeError("Google did not return a valid sign-in response.");
  return values[0];
}

async function jsonProviderResponse(response, label) {
  if (!response || response.ok !== true) throw new TypeError(`${label} was rejected.`);
  const contentType = String(response.headers?.get?.("content-type") || "");
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) throw new TypeError(`${label} returned an invalid response.`);
  const contentLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumProviderResponseBytes) throw new TypeError(`${label} returned an invalid response.`);
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maximumProviderResponseBytes) throw new TypeError(`${label} returned an invalid response.`);
  return safeJson(Buffer.from(text, "utf8"), `${label} response`);
}

function cacheLifetime(headers) {
  const match = String(headers?.get?.("cache-control") || "").match(/(?:^|,)\s*max-age=(\d+)/i);
  return match ? Math.max(60, Math.min(Number(match[1]), 6 * 60 * 60)) : 5 * 60;
}

function jwtParts(value) {
  if (typeof value !== "string" || value.length > 16 * 1024) throw new TypeError("Google returned an invalid identity token.");
  const parts = value.split(".");
  if (parts.length !== 3) throw new TypeError("Google returned an invalid identity token.");
  return {
    header: safeJson(decodeBase64url(parts[0], "Google identity-token header", 4096), "Google identity-token header"),
    payload: safeJson(decodeBase64url(parts[1], "Google identity-token claims", 8192), "Google identity-token claims"),
    signature: decodeBase64url(parts[2], "Google identity-token signature", 1024),
    signingInput: `${parts[0]}.${parts[1]}`
  };
}

function validAudience(payload, clientId) {
  if (typeof payload.aud === "string") return payload.aud === clientId;
  if (!Array.isArray(payload.aud) || !payload.aud.every((entry) => typeof entry === "string") || !payload.aud.includes(clientId)) return false;
  return payload.aud.length === 1 || payload.azp === clientId;
}

function providerClaims(payload, clientId, nonce, nowSeconds) {
  const issuerValid = payload.iss === "https://accounts.google.com" || payload.iss === "accounts.google.com";
  if (!issuerValid || !validAudience(payload, clientId)) throw new TypeError("Google returned an identity token for a different application.");
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp) || payload.exp < nowSeconds - maximumClockSkewSeconds) throw new TypeError("Google returned an expired identity token.");
  if (payload.iat != null && (typeof payload.iat !== "number" || !Number.isFinite(payload.iat) || payload.iat > nowSeconds + maximumClockSkewSeconds)) throw new TypeError("Google returned an invalid identity token.");
  if (typeof payload.nonce !== "string" || !equalText(payload.nonce, nonce)) throw new TypeError("Google returned an identity token for a different sign-in attempt.");
  if (typeof payload.sub !== "string" || !payload.sub.trim() || payload.sub.length > 255 || typeof payload.email !== "string" || payload.email_verified !== true) throw new TypeError("Google did not return a verified account email.");
  return {
    subject: payload.sub,
    email: payload.email,
    emailVerified: true,
    displayName: typeof payload.name === "string" ? payload.name : "",
    avatarUrl: typeof payload.picture === "string" ? payload.picture : "",
    locale: typeof payload.locale === "string" ? payload.locale : ""
  };
}

export function createGoogleOidcProvider(options = {}) {
  const clientId = boundedSecret(options.clientId, "Google client ID");
  const clientSecret = boundedSecret(options.clientSecret, "Google client secret");
  const stateSecret = boundedSecret(options.stateSecret, "Google state secret", 32);
  const appOrigin = exactOrigin(options.appOrigin);
  const secure = new URL(appOrigin).protocol === "https:";
  const cookieName = secure ? "__Host-tideway_google_flow" : developmentCookieName;
  const callbackUrl = new URL("/api/marketplace/auth/google/callback", appOrigin).toString();
  const fetcher = options.fetch || globalThis.fetch;
  if (typeof fetcher !== "function") throw new TypeError("Google sign-in requires a server fetch implementation.");
  const clock = options.clock || (() => Date.now());
  const entropy = options.randomBytes || randomBytes;
  const requestTimeoutMs = options.requestTimeoutMs ?? 5000;
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1000 || requestTimeoutMs > 15_000) throw new RangeError("Google provider timeout must be between one and fifteen seconds.");
  let keyCache = { expiresAt: 0, keys: [] };

  function providerRequest(init) {
    return { ...init, signal: AbortSignal.timeout(requestTimeoutMs) };
  }

  async function signingKey(kid) {
    const now = clock();
    let key = keyCache.expiresAt > now ? keyCache.keys.find((candidate) => candidate.kid === kid) : null;
    if (key) return key;
    const response = await fetcher(jwksEndpoint, providerRequest({ method: "GET", headers: { Accept: "application/json" }, redirect: "error" }));
    const body = await jsonProviderResponse(response, "Google signing-key request");
    if (!Array.isArray(body.keys) || body.keys.length > 20) throw new TypeError("Google signing keys are unavailable.");
    const keys = body.keys.filter((candidate) => candidate && candidate.kty === "RSA" && candidate.alg === "RS256" && candidate.use === "sig" && typeof candidate.kid === "string" && typeof candidate.n === "string" && typeof candidate.e === "string");
    keyCache = { expiresAt: now + cacheLifetime(response.headers) * 1000, keys };
    key = keys.find((candidate) => candidate.kid === kid);
    if (!key) throw new TypeError("Google identity-token signing key is unavailable.");
    return key;
  }

  async function verifyIdentityToken(value, nonce) {
    const token = jwtParts(value);
    if (token.header.alg !== "RS256" || typeof token.header.kid !== "string" || !token.header.kid || token.header.crit != null) throw new TypeError("Google returned an unsupported identity token.");
    const jwk = await signingKey(token.header.kid);
    let publicKey;
    try { publicKey = createPublicKey({ key: jwk, format: "jwk" }); } catch { throw new TypeError("Google identity-token signing key is invalid."); }
    if (!verify("RSA-SHA256", Buffer.from(token.signingInput, "ascii"), publicKey, token.signature)) throw new TypeError("Google identity-token signature is invalid.");
    return providerClaims(token.payload, clientId, nonce, Math.floor(clock() / 1000));
  }

  return Object.freeze({
    name: "google",
    callbackUrl,
    clearCookie: expiredFlowCookie(secure, cookieName),
    begin(options = {}) {
      const purpose = options.purpose ?? "sign-in";
      if (!["sign-in", "link", "step-up"].includes(purpose)) throw new TypeError("Google sign-in purpose is invalid.");
      const nowSeconds = Math.floor(clock() / 1000);
      const state = base64url(entropy(32));
      const nonce = base64url(entropy(32));
      const verifier = base64url(entropy(32));
      const challenge = base64url(createHash("sha256").update(verifier, "ascii").digest());
      const payload = { v: 1, purpose, state, nonce, verifier, iat: nowSeconds, exp: nowSeconds + flowLifetimeSeconds };
      const url = new URL(authorizationEndpoint);
      url.search = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: callbackUrl, scope: "openid email profile", state, nonce, code_challenge: challenge, code_challenge_method: "S256" }).toString();
      return { location: url.toString(), setCookie: flowCookie(signedFlow(payload, stateSecret), secure, cookieName) };
    },
    async complete(urlValue, cookieHeader) {
      const url = urlValue instanceof URL ? urlValue : new URL(urlValue, appOrigin);
      // The main server may receive an internal HTTP origin behind a trusted HTTPS
      // reverse proxy. The provider redirect URI remains the exact configured
      // public origin; only the routed callback path and query are consumed here.
      if (url.pathname !== new URL(callbackUrl).pathname) throw new TypeError("Google returned to an invalid callback address.");
      if (url.searchParams.has("error")) throw new TypeError("Google sign-in was cancelled or rejected.");
      const code = singleQuery(url, "code", 4096);
      const state = singleQuery(url, "state", 256);
      const flow = verifiedFlow(cookieValue(cookieHeader, cookieName), stateSecret, Math.floor(clock() / 1000));
      if (!equalText(state, flow.state)) throw new TypeError("Google returned a mismatched sign-in state.");
      const body = new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: callbackUrl, grant_type: "authorization_code", code_verifier: flow.verifier });
      const response = await fetcher(tokenEndpoint, providerRequest({ method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body, redirect: "error" }));
      const tokens = await jsonProviderResponse(response, "Google token exchange");
      if (typeof tokens.id_token !== "string") throw new TypeError("Google did not return an identity token.");
      return { ...await verifyIdentityToken(tokens.id_token, flow.nonce), flowPurpose: flow.purpose };
    }
  });
}

export const googleOidcEndpoints = Object.freeze({ authorizationEndpoint, tokenEndpoint, jwksEndpoint });
