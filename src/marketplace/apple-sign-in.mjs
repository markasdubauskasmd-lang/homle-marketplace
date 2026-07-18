import { createHmac, createPrivateKey, createPublicKey, randomBytes, sign, timingSafeEqual, verify } from "node:crypto";

const authorizationEndpoint = "https://appleid.apple.com/auth/authorize";
const tokenEndpoint = "https://appleid.apple.com/auth/token";
const jwksEndpoint = "https://appleid.apple.com/auth/keys";
const issuer = "https://appleid.apple.com";
const flowLifetimeSeconds = 10 * 60;
const maximumClockSkewSeconds = 60;
const maximumProviderResponseBytes = 64 * 1024;

function appleFailure(code, message) {
  return Object.assign(new TypeError(message), { code });
}

function boundedIdentifier(value, label, pattern, maximum = 255) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > maximum || !pattern.test(text)) throw new TypeError(`${label} is invalid.`);
  return text;
}

function exactHttpsOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.origin !== String(value).replace(/\/$/, "") || url.username || url.password) throw new Error();
    return url.origin;
  } catch {
    throw new TypeError("Apple sign-in requires an exact HTTPS application origin.");
  }
}

function privateSigningKey(value) {
  const text = typeof value === "string" ? value.replace(/\\n/g, "\n").trim() : "";
  if (!text || text.length > 16 * 1024 || !text.includes("BEGIN PRIVATE KEY")) throw new TypeError("Apple private key is invalid.");
  let key;
  try { key = createPrivateKey(text); } catch { throw new TypeError("Apple private key is invalid."); }
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new TypeError("Apple private key must be an EC P-256 key.");
  return key;
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
  const signature = base64url(createHmac("sha256", secret).update("homle:apple-flow:v1\0", "utf8").update(encoded, "ascii").digest());
  return `${encoded}.${signature}`;
}

function verifiedFlow(value, secret, nowSeconds) {
  if (typeof value !== "string" || value.length > 4096) throw new TypeError("The Apple sign-in attempt is missing or expired.");
  const parts = value.split(".");
  if (parts.length !== 2) throw new TypeError("The Apple sign-in attempt is missing or expired.");
  const expected = createHmac("sha256", secret).update("homle:apple-flow:v1\0", "utf8").update(parts[0], "ascii").digest();
  const supplied = decodeBase64url(parts[1], "Apple sign-in cookie signature", 64);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new TypeError("The Apple sign-in attempt is missing or expired.");
  const payload = safeJson(decodeBase64url(parts[0], "Apple sign-in cookie", 3072), "Apple sign-in cookie");
  if (payload.v !== 1 || !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp) || payload.iat > nowSeconds + maximumClockSkewSeconds || payload.exp < nowSeconds || payload.exp - payload.iat !== flowLifetimeSeconds) throw new TypeError("The Apple sign-in attempt is missing or expired.");
  if (!["sign-in", "link", "step-up"].includes(payload.purpose) || ![undefined, "", "book", "work"].includes(payload.intent)) throw new TypeError("The Apple sign-in attempt is missing or expired.");
  for (const key of ["state", "nonce"]) if (typeof payload[key] !== "string" || payload[key].length < 32 || payload[key].length > 128 || !/^[A-Za-z0-9_-]+$/.test(payload[key])) throw new TypeError("The Apple sign-in attempt is missing or expired.");
  return payload;
}

function cookieValue(header, cookieName) {
  const matches = [];
  for (const field of String(header || "").split(";")) {
    const separator = field.indexOf("=");
    if (separator >= 0 && field.slice(0, separator).trim() === cookieName) matches.push(field.slice(separator + 1).trim());
  }
  if (matches.length !== 1) throw new TypeError("The Apple sign-in attempt is missing or expired.");
  return matches[0];
}

function flowCookie(value, cookieName) {
  return `${cookieName}=${value}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=${flowLifetimeSeconds}`;
}

function expiredFlowCookie(cookieName) {
  return `${cookieName}=; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

function singleForm(form, name, maximum, required = true) {
  const values = form.getAll(name);
  if ((!required && values.length === 0)) return "";
  if (values.length !== 1 || !values[0] || values[0].length > maximum || /[\u0000-\u001f\u007f]/.test(values[0])) throw new TypeError("Apple did not return a valid sign-in response.");
  return values[0];
}

async function jsonProviderResponse(response, label) {
  if (!response || response.ok !== true) throw new TypeError(`${label} was rejected.`);
  if (!/^application\/json(?:\s*;|$)/i.test(String(response.headers?.get?.("content-type") || ""))) throw new TypeError(`${label} returned an invalid response.`);
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

function jwtParts(value, label = "Apple identity token") {
  if (typeof value !== "string" || value.length > 16 * 1024) throw new TypeError(`${label} is invalid.`);
  const parts = value.split(".");
  if (parts.length !== 3) throw new TypeError(`${label} is invalid.`);
  return {
    header: safeJson(decodeBase64url(parts[0], `${label} header`, 4096), `${label} header`),
    payload: safeJson(decodeBase64url(parts[1], `${label} claims`, 8192), `${label} claims`),
    signature: decodeBase64url(parts[2], `${label} signature`, 1024),
    signingInput: `${parts[0]}.${parts[1]}`
  };
}

function safeName(value) {
  const text = typeof value === "string" ? value.normalize("NFKC").replace(/\s+/g, " ").trim() : "";
  return text && text.length <= 60 && /^[\p{L}\p{M} .'-]+$/u.test(text) ? text : "";
}

function firstAuthorizationName(value) {
  if (!value) return "";
  try {
    const supplied = JSON.parse(value);
    if (!supplied || typeof supplied !== "object" || Array.isArray(supplied) || !supplied.name || typeof supplied.name !== "object" || Array.isArray(supplied.name)) return "";
    return [safeName(supplied.name.firstName), safeName(supplied.name.lastName)].filter(Boolean).join(" ").slice(0, 120);
  } catch { return ""; }
}

function clientSecret(clientId, teamId, keyId, key, nowSeconds) {
  const header = base64url(Buffer.from(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }), "utf8"));
  const payload = base64url(Buffer.from(JSON.stringify({ iss: teamId, iat: nowSeconds, exp: nowSeconds + 5 * 60, aud: issuer, sub: clientId }), "utf8"));
  const signingInput = `${header}.${payload}`;
  const signature = sign("sha256", Buffer.from(signingInput, "ascii"), { key, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${base64url(signature)}`;
}

function providerClaims(payload, clientId, nonce, nowSeconds, displayName) {
  if (payload.iss !== issuer || payload.aud !== clientId) throw new TypeError("Apple returned an identity token for a different application.");
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp) || payload.exp < nowSeconds - maximumClockSkewSeconds) throw new TypeError("Apple returned an expired identity token.");
  if (payload.iat != null && (typeof payload.iat !== "number" || !Number.isFinite(payload.iat) || payload.iat > nowSeconds + maximumClockSkewSeconds)) throw new TypeError("Apple returned an invalid identity token.");
  if (typeof payload.nonce !== "string" || !equalText(payload.nonce, nonce)) throw new TypeError("Apple returned an identity token for a different sign-in attempt.");
  if (typeof payload.sub !== "string" || !payload.sub.trim() || payload.sub.length > 255 || typeof payload.email !== "string" || ![true, "true"].includes(payload.email_verified)) throw new TypeError("Apple did not return a verified account email.");
  return { subject: payload.sub, email: payload.email, emailVerified: true, displayName, avatarUrl: "", locale: "" };
}

export function createAppleSignInProvider(options = {}) {
  const clientId = boundedIdentifier(options.clientId, "Apple client ID", /^[A-Za-z0-9][A-Za-z0-9.-]+[A-Za-z0-9]$/);
  const teamId = boundedIdentifier(options.teamId, "Apple team ID", /^[A-Z0-9]{10}$/, 10);
  const keyId = boundedIdentifier(options.keyId, "Apple key ID", /^[A-Z0-9]{10}$/, 10);
  const key = privateSigningKey(options.privateKey);
  const stateSecret = boundedIdentifier(options.stateSecret, "Apple state secret", /^[^\u0000-\u001f\u007f]+$/, 4096);
  if (stateSecret.length < 32) throw new TypeError("Apple state secret is invalid.");
  const appOrigin = exactHttpsOrigin(options.appOrigin);
  const cookieName = "__Host-tideway_apple_flow";
  const callbackUrl = new URL("/api/marketplace/auth/apple/callback", appOrigin).toString();
  const fetcher = options.fetch || globalThis.fetch;
  if (typeof fetcher !== "function") throw new TypeError("Apple sign-in requires a server fetch implementation.");
  const clock = options.clock || (() => Date.now());
  const entropy = options.randomBytes || randomBytes;
  const requestTimeoutMs = options.requestTimeoutMs ?? 5000;
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1000 || requestTimeoutMs > 15_000) throw new RangeError("Apple provider timeout must be between one and fifteen seconds.");
  let keyCache = { expiresAt: 0, keys: [] };

  function providerRequest(init) {
    return { ...init, signal: AbortSignal.timeout(requestTimeoutMs) };
  }

  async function signingKey(kid) {
    const now = clock();
    let jwk = keyCache.expiresAt > now ? keyCache.keys.find((candidate) => candidate.kid === kid) : null;
    if (jwk) return jwk;
    const response = await fetcher(jwksEndpoint, providerRequest({ method: "GET", headers: { Accept: "application/json" }, redirect: "error" }));
    const body = await jsonProviderResponse(response, "Apple signing-key request");
    if (!Array.isArray(body.keys) || body.keys.length > 20) throw new TypeError("Apple signing keys are unavailable.");
    const keys = body.keys.filter((candidate) => candidate && candidate.kty === "RSA" && candidate.alg === "RS256" && candidate.use === "sig" && typeof candidate.kid === "string" && typeof candidate.n === "string" && typeof candidate.e === "string");
    keyCache = { expiresAt: now + cacheLifetime(response.headers) * 1000, keys };
    jwk = keys.find((candidate) => candidate.kid === kid);
    if (!jwk) throw new TypeError("Apple identity-token signing key is unavailable.");
    return jwk;
  }

  async function verifyIdentityToken(value, nonce, displayName) {
    const token = jwtParts(value);
    if (token.header.alg !== "RS256" || typeof token.header.kid !== "string" || !token.header.kid || token.header.crit != null) throw new TypeError("Apple returned an unsupported identity token.");
    const jwk = await signingKey(token.header.kid);
    let publicKey;
    try { publicKey = createPublicKey({ key: jwk, format: "jwk" }); } catch { throw new TypeError("Apple identity-token signing key is invalid."); }
    if (!verify("RSA-SHA256", Buffer.from(token.signingInput, "ascii"), publicKey, token.signature)) throw new TypeError("Apple identity-token signature is invalid.");
    return providerClaims(token.payload, clientId, nonce, Math.floor(clock() / 1000), displayName);
  }

  return Object.freeze({
    name: "apple",
    callbackUrl,
    clearCookie: expiredFlowCookie(cookieName),
    begin(options = {}) {
      const purpose = options.purpose ?? "sign-in";
      if (!["sign-in", "link", "step-up"].includes(purpose)) throw new TypeError("Apple sign-in purpose is invalid.");
      const intent = options.intent ?? "";
      if (!["", "book", "work"].includes(intent) || (purpose !== "sign-in" && intent)) throw new TypeError("Apple sign-in intent is invalid.");
      const nowSeconds = Math.floor(clock() / 1000);
      const state = base64url(entropy(32));
      const nonce = base64url(entropy(32));
      const payload = { v: 1, purpose, intent, state, nonce, iat: nowSeconds, exp: nowSeconds + flowLifetimeSeconds };
      const url = new URL(authorizationEndpoint);
      const authorization = { response_type: "code", response_mode: purpose === "sign-in" ? "form_post" : "query", client_id: clientId, redirect_uri: callbackUrl, state, nonce };
      if (purpose === "sign-in") authorization.scope = "name email";
      url.search = new URLSearchParams(authorization).toString();
      return { location: url.toString(), setCookie: flowCookie(signedFlow(payload, stateSecret), cookieName) };
    },
    async complete(formValue, cookieHeader) {
      const form = formValue instanceof URLSearchParams ? formValue : new URLSearchParams(formValue);
      if (form.has("error")) {
        const providerError = form.get("error") === "user_cancelled_authorize" ? "apple-provider-access-denied" : "apple-provider-rejected";
        throw appleFailure(providerError, "Apple sign-in was cancelled or rejected.");
      }
      let code;
      let flow;
      let displayName;
      try {
        code = singleForm(form, "code", 4096);
        const state = singleForm(form, "state", 256);
        flow = verifiedFlow(cookieValue(cookieHeader, cookieName), stateSecret, Math.floor(clock() / 1000));
        if (!equalText(state, flow.state)) throw new TypeError("Apple returned a mismatched sign-in state.");
        displayName = firstAuthorizationName(singleForm(form, "user", 4096, false));
      } catch {
        throw appleFailure("apple-flow-invalid", "The Apple sign-in attempt is missing, invalid or expired.");
      }
      const nowSeconds = Math.floor(clock() / 1000);
      const body = new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret(clientId, teamId, keyId, key, nowSeconds), redirect_uri: callbackUrl, grant_type: "authorization_code" });
      let response;
      try {
        response = await fetcher(tokenEndpoint, providerRequest({ method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body, redirect: "error" }));
      } catch {
        throw appleFailure("apple-token-network-failed", "Apple could not be reached to complete sign-in.");
      }
      let tokens;
      try {
        tokens = await jsonProviderResponse(response, "Apple token exchange");
        if (typeof tokens.id_token !== "string") throw new TypeError("Apple did not return an identity token.");
      } catch {
        throw appleFailure("apple-token-exchange-rejected", "Apple rejected the secure sign-in handoff.");
      }
      try {
        return { ...await verifyIdentityToken(tokens.id_token, flow.nonce, displayName), flowPurpose: flow.purpose, flowIntent: flow.intent || "" };
      } catch {
        throw appleFailure("apple-identity-verification-failed", "Apple returned an identity response that could not be verified.");
      }
    }
  });
}

export const appleSignInEndpoints = Object.freeze({ authorizationEndpoint, tokenEndpoint, jwksEndpoint });
