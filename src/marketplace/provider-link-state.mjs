import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const supportedProviders = Object.freeze(["google", "facebook"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const developmentCookieName = "tideway_provider_link";

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function provider(value) {
  if (!supportedProviders.includes(value)) throw new TypeError("A supported provider connection is required.");
  return value;
}

function uuid(value, label) {
  if (!uuidPattern.test(value || "")) throw new TypeError(`A valid ${label} is required.`);
  return value.toLowerCase();
}

function exactOrigin(value) {
  try {
    const parsed = new URL(value);
    if (parsed.origin !== String(value).replace(/\/$/, "") || parsed.username || parsed.password) throw new Error();
    return parsed.origin;
  } catch {
    throw new TypeError("Provider connection state requires an exact application origin.");
  }
}

function secretKey(value) {
  if (typeof value !== "string" || value.length < 32) throw new TypeError("Provider connection state requires a 32-character secret.");
  return value;
}

function signedPayload(payload, secret) {
  const encoded = base64url(JSON.stringify(payload));
  const signature = base64url(createHmac("sha256", secret).update("tideway:provider-link:v1\0", "utf8").update(encoded, "ascii").digest());
  return `${encoded}.${signature}`;
}

function cookieValue(header, name) {
  const values = [];
  for (const field of String(header || "").split(";")) {
    const separator = field.indexOf("=");
    if (separator >= 0 && field.slice(0, separator).trim() === name) values.push(field.slice(separator + 1).trim());
  }
  if (values.length !== 1) throw new TypeError("The provider connection attempt is missing or expired.");
  return values[0];
}

function verifiedPayload(token, secret, nowSeconds) {
  if (typeof token !== "string" || token.length > 4096) throw new TypeError("The provider connection attempt is missing or expired.");
  const parts = token.split(".");
  if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) throw new TypeError("The provider connection attempt is missing or expired.");
  const expected = createHmac("sha256", secret).update("tideway:provider-link:v1\0", "utf8").update(parts[0], "ascii").digest();
  const supplied = Buffer.from(parts[1], "base64url");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new TypeError("The provider connection attempt is missing or expired.");
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); } catch { throw new TypeError("The provider connection attempt is missing or expired."); }
  if (!payload || payload.v !== 1 || !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp) || payload.iat > nowSeconds + 60 || payload.exp < nowSeconds || payload.exp - payload.iat !== 600) throw new TypeError("The provider connection attempt is missing or expired.");
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(payload.nonce || "")) throw new TypeError("The provider connection attempt is missing or expired.");
  return payload;
}

export function createProviderLinkState(options = {}) {
  const secret = secretKey(options.secret);
  const origin = exactOrigin(options.appOrigin);
  const secure = new URL(origin).protocol === "https:";
  const cookieName = secure ? "__Host-tideway_provider_link" : developmentCookieName;
  const clock = options.clock || (() => Date.now());
  const entropy = options.randomBytes || randomBytes;
  const clearCookie = `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure ? "; Secure" : ""}`;

  return Object.freeze({
    cookieName,
    clearCookie,
    has(cookieHeader) {
      return String(cookieHeader || "").split(";").some((field) => field.slice(0, Math.max(0, field.indexOf("="))).trim() === cookieName);
    },
    begin(context, providerValue) {
      const selectedProvider = provider(providerValue);
      const userId = uuid(context?.actor?.userId, "authenticated user id");
      const sessionId = uuid(context?.sessionId, "authenticated session id");
      const nowSeconds = Math.floor(clock() / 1000);
      const payload = { v: 1, provider: selectedProvider, userId, sessionId, nonce: base64url(entropy(32)), iat: nowSeconds, exp: nowSeconds + 600 };
      return `${cookieName}=${signedPayload(payload, secret)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure ? "; Secure" : ""}`;
    },
    verify(cookieHeader, context, providerValue) {
      const selectedProvider = provider(providerValue);
      const payload = verifiedPayload(cookieValue(cookieHeader, cookieName), secret, Math.floor(clock() / 1000));
      if (payload.provider !== selectedProvider || payload.userId !== uuid(context?.actor?.userId, "authenticated user id") || payload.sessionId !== uuid(context?.sessionId, "authenticated session id")) throw new TypeError("The provider connection attempt is missing or expired.");
      return Object.freeze({ provider: selectedProvider, userId: payload.userId, sessionId: payload.sessionId });
    }
  });
}

export { supportedProviders as connectableSocialProviders };
