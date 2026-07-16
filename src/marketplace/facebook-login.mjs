import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const developmentCookieName = "tideway_facebook_flow";
const flowLifetimeSeconds = 10 * 60;
const maximumClockSkewSeconds = 60;
const maximumProviderResponseBytes = 64 * 1024;

function boundedSecret(value, label, minimum = 1, maximum = 4096) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < minimum || text.length > maximum || /[\u0000-\u001f\u007f]/.test(text)) throw new TypeError(`${label} is invalid.`);
  return text;
}

function exactOrigin(value) {
  try {
    const url = new URL(value);
    if (url.origin !== String(value).replace(/\/$/, "") || url.username || url.password) throw new Error();
    return url.origin;
  } catch {
    throw new TypeError("Facebook sign-in requires an exact application origin.");
  }
}

function graphVersion(value) {
  const selected = typeof value === "string" ? value.trim() : "";
  if (!/^v\d{1,2}\.\d{1,2}$/.test(selected)) throw new TypeError("Facebook Graph API version must be explicitly configured as vN.N.");
  return selected;
}

function facebookAppId(value) {
  const selected = boundedSecret(value, "Facebook App ID", 5, 32);
  if (!/^\d+$/.test(selected)) throw new TypeError("Facebook App ID is invalid.");
  return selected;
}

function facebookAppSecret(value) {
  const selected = boundedSecret(value, "Facebook App secret", 32, 128).toLowerCase();
  if (!/^[a-f0-9]+$/.test(selected)) throw new TypeError("Facebook App secret is invalid.");
  return selected;
}

function base64url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function decodeBase64url(value, label, maximumBytes = 4096) {
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
  const signature = base64url(createHmac("sha256", secret).update("tideway:facebook-flow:v1\0", "utf8").update(encoded, "ascii").digest());
  return `${encoded}.${signature}`;
}

function verifiedFlow(value, secret, nowSeconds) {
  if (typeof value !== "string" || value.length > 4096) throw new TypeError("The Facebook sign-in attempt is missing or expired.");
  const parts = value.split(".");
  if (parts.length !== 2) throw new TypeError("The Facebook sign-in attempt is missing or expired.");
  const expected = createHmac("sha256", secret).update("tideway:facebook-flow:v1\0", "utf8").update(parts[0], "ascii").digest();
  const supplied = decodeBase64url(parts[1], "Facebook sign-in cookie signature", 64);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new TypeError("The Facebook sign-in attempt is missing or expired.");
  const payload = safeJson(decodeBase64url(parts[0], "Facebook sign-in cookie", 3072), "Facebook sign-in cookie");
  if (payload.v !== 1 || !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp) || payload.iat > nowSeconds + maximumClockSkewSeconds || payload.exp < nowSeconds || payload.exp - payload.iat !== flowLifetimeSeconds) throw new TypeError("The Facebook sign-in attempt is missing or expired.");
  if (!["sign-in", "link", "step-up"].includes(payload.purpose)) throw new TypeError("The Facebook sign-in attempt is missing or expired.");
  if (typeof payload.state !== "string" || payload.state.length < 32 || payload.state.length > 128 || !/^[A-Za-z0-9_-]+$/.test(payload.state)) throw new TypeError("The Facebook sign-in attempt is missing or expired.");
  return payload;
}

function cookieValue(header, cookieName) {
  const matches = [];
  for (const field of String(header || "").split(";")) {
    const separator = field.indexOf("=");
    if (separator < 0) continue;
    if (field.slice(0, separator).trim() === cookieName) matches.push(field.slice(separator + 1).trim());
  }
  if (matches.length !== 1) throw new TypeError("The Facebook sign-in attempt is missing or expired.");
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
  if (values.length !== 1 || !values[0] || values[0].length > maximum || /[\u0000-\u001f\u007f]/.test(values[0])) throw new TypeError("Facebook did not return a valid sign-in response.");
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
  const body = safeJson(Buffer.from(text, "utf8"), `${label} response`);
  if (body.error) throw new TypeError(`${label} was rejected.`);
  return body;
}

function emailAddress(value) {
  const selected = typeof value === "string" ? value.trim().toLowerCase() : "";
  const at = selected.indexOf("@");
  if (!selected || selected.length > 254 || at < 1 || at !== selected.lastIndexOf("@") || at === selected.length - 1 || /[\u0000-\u0020\u007f]/.test(selected)) return null;
  return selected;
}

function profileClaims(profile, debug, appId, nowSeconds) {
  const data = debug?.data;
  if (!data || data.is_valid !== true || String(data.app_id || "") !== appId || String(data.type || "").toUpperCase() !== "USER") throw new TypeError("Facebook returned an identity for a different application.");
  const subject = typeof data.user_id === "string" ? data.user_id.trim() : "";
  if (!subject || subject.length > 255 || !/^[A-Za-z0-9_-]+$/.test(subject)) throw new TypeError("Facebook returned an invalid account identity.");
  if (Number.isFinite(Number(data.expires_at)) && Number(data.expires_at) > 0 && Number(data.expires_at) < nowSeconds - maximumClockSkewSeconds) throw new TypeError("Facebook returned an expired access token.");
  if (Number.isFinite(Number(data.data_access_expires_at)) && Number(data.data_access_expires_at) > 0 && Number(data.data_access_expires_at) < nowSeconds - maximumClockSkewSeconds) throw new TypeError("Facebook data access has expired.");
  if (typeof profile?.id !== "string" || !equalText(profile.id, subject)) throw new TypeError("Facebook returned a mismatched account profile.");
  const displayName = typeof profile.name === "string" && profile.name.trim().length <= 120 ? profile.name.trim() : "";
  const avatarCandidate = profile?.picture?.data?.is_silhouette === false && typeof profile.picture.data.url === "string" ? profile.picture.data.url : "";
  let avatarUrl = "";
  try { const parsed = new URL(avatarCandidate); if (parsed.protocol === "https:") avatarUrl = parsed.toString(); } catch {}
  return { subject, email: emailAddress(profile.email), emailVerified: false, displayName, avatarUrl, locale: "" };
}

export function createFacebookLoginProvider(options = {}) {
  const appId = facebookAppId(options.appId);
  const appSecret = facebookAppSecret(options.appSecret);
  const version = graphVersion(options.graphVersion);
  const stateSecret = boundedSecret(options.stateSecret, "Facebook state secret", 32);
  const appOrigin = exactOrigin(options.appOrigin);
  const secure = new URL(appOrigin).protocol === "https:";
  const cookieName = secure ? "__Host-tideway_facebook_flow" : developmentCookieName;
  const callbackUrl = new URL("/api/marketplace/auth/facebook/callback", appOrigin).toString();
  const authorizationEndpoint = `https://www.facebook.com/${version}/dialog/oauth`;
  const tokenEndpoint = `https://graph.facebook.com/${version}/oauth/access_token`;
  const debugEndpoint = `https://graph.facebook.com/${version}/debug_token`;
  const profileEndpoint = `https://graph.facebook.com/${version}/me`;
  const fetcher = options.fetch || globalThis.fetch;
  if (typeof fetcher !== "function") throw new TypeError("Facebook sign-in requires a server fetch implementation.");
  const clock = options.clock || (() => Date.now());
  const entropy = options.randomBytes || randomBytes;
  const requestTimeoutMs = options.requestTimeoutMs ?? 5000;
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1000 || requestTimeoutMs > 15_000) throw new RangeError("Facebook provider timeout must be between one and fifteen seconds.");

  function providerRequest(init) {
    return { ...init, signal: AbortSignal.timeout(requestTimeoutMs) };
  }

  async function requestJson(url, init, label) {
    let response;
    try { response = await fetcher(url, providerRequest(init)); } catch { throw new TypeError(`${label} is temporarily unavailable.`); }
    return jsonProviderResponse(response, label);
  }

  return Object.freeze({
    name: "facebook",
    callbackUrl,
    clearCookie: expiredFlowCookie(secure, cookieName),
    begin(options = {}) {
      const purpose = options.purpose ?? "sign-in";
      if (!["sign-in", "link", "step-up"].includes(purpose)) throw new TypeError("Facebook sign-in purpose is invalid.");
      const nowSeconds = Math.floor(clock() / 1000);
      const state = base64url(entropy(32));
      const payload = { v: 1, purpose, state, iat: nowSeconds, exp: nowSeconds + flowLifetimeSeconds };
      const url = new URL(authorizationEndpoint);
      url.search = new URLSearchParams({ client_id: appId, redirect_uri: callbackUrl, response_type: "code", scope: "email", state }).toString();
      return { location: url.toString(), setCookie: flowCookie(signedFlow(payload, stateSecret), secure, cookieName) };
    },
    async complete(urlValue, cookieHeader) {
      const url = urlValue instanceof URL ? urlValue : new URL(urlValue, appOrigin);
      if (url.pathname !== new URL(callbackUrl).pathname) throw new TypeError("Facebook returned to an invalid callback address.");
      if (url.searchParams.has("error") || url.searchParams.has("error_code")) throw new TypeError("Facebook sign-in was cancelled or rejected.");
      const code = singleQuery(url, "code", 4096);
      const state = singleQuery(url, "state", 256);
      const flow = verifiedFlow(cookieValue(cookieHeader, cookieName), stateSecret, Math.floor(clock() / 1000));
      if (!equalText(state, flow.state)) throw new TypeError("Facebook returned a mismatched sign-in state.");
      const token = await requestJson(tokenEndpoint, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: appId, client_secret: appSecret, redirect_uri: callbackUrl, code }), redirect: "error" }, "Facebook token exchange");
      const accessToken = boundedSecret(token.access_token, "Facebook access token", 16, 8192);
      if (token.token_type && String(token.token_type).toLowerCase() !== "bearer") throw new TypeError("Facebook returned an unsupported access token.");
      const debugUrl = new URL(debugEndpoint);
      debugUrl.searchParams.set("input_token", accessToken);
      const debug = await requestJson(debugUrl, { method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${appId}|${appSecret}` }, redirect: "error" }, "Facebook token inspection");
      const profileUrl = new URL(profileEndpoint);
      profileUrl.searchParams.set("fields", "id,name,email,picture.type(large)");
      profileUrl.searchParams.set("appsecret_proof", createHmac("sha256", appSecret).update(accessToken, "utf8").digest("hex"));
      const profile = await requestJson(profileUrl, { method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` }, redirect: "error" }, "Facebook profile request");
      return { ...profileClaims(profile, debug, appId, Math.floor(clock() / 1000)), flowPurpose: flow.purpose };
    }
  });
}
