import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const sessionCookieName = "__Host-tideway_session";
const developmentSessionCookieName = "tideway_session_dev";
const scryptParameters = Object.freeze({ cost: 32768, blockSize: 8, parallelization: 1, keyLength: 32, maxmem: 64 * 1024 * 1024 });

function secretKey(secret) {
  if (typeof secret !== "string" || secret.length < 32) throw new TypeError("A session secret of at least 32 characters is required.");
  return secret;
}

export function newOpaqueToken(bytes = 32) {
  if (!Number.isInteger(bytes) || bytes < 24 || bytes > 64) throw new RangeError("Opaque tokens must contain 24 to 64 random bytes.");
  return randomBytes(bytes).toString("base64url");
}

export function hashOpaqueToken(token, secret) {
  if (typeof token !== "string" || token.length < 32 || token.length > 200) throw new TypeError("A valid opaque token is required.");
  return createHmac("sha256", secretKey(secret)).update(token, "utf8").digest();
}

export function verifyOpaqueToken(token, expectedHash, secret) {
  if (!Buffer.isBuffer(expectedHash) || expectedHash.length !== 32) return false;
  try {
    const actual = hashOpaqueToken(token, secret);
    return timingSafeEqual(actual, expectedHash);
  } catch {
    return false;
  }
}

export function createSessionMaterial(secret, now = new Date(), ttlSeconds = 60 * 60 * 24 * 30) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError("A valid session creation time is required.");
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 300 || ttlSeconds > 60 * 60 * 24 * 90) throw new RangeError("Session lifetime must be between five minutes and ninety days.");
  const token = newOpaqueToken();
  const csrfToken = newOpaqueToken();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
  return { token, tokenHash: hashOpaqueToken(token, secret), csrfToken, csrfHash: hashOpaqueToken(csrfToken, secret), createdAt, expiresAt, ttlSeconds };
}

export function sessionCookie(token, ttlSeconds, secure = true) {
  if (typeof token !== "string" || !token) throw new TypeError("A session token is required.");
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 0) throw new RangeError("A non-negative cookie lifetime is required.");
  const secureAttribute = secure ? "; Secure" : "";
  const cookieName = secure ? sessionCookieName : developmentSessionCookieName;
  return `${cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${secureAttribute}; Max-Age=${ttlSeconds}`;
}

export function clearSessionCookie(secure = true) {
  return sessionCookie("deleted", 0, secure);
}

export function parseCookies(header) {
  const values = {};
  for (const part of String(header || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim();
    if (!key || Object.hasOwn(values, key)) continue;
    try { values[key] = decodeURIComponent(part.slice(separator + 1).trim()); } catch { values[key] = ""; }
  }
  return values;
}

export function sessionTokenFromRequest(request) {
  const cookies = parseCookies(request?.headers?.cookie);
  return cookies[sessionCookieName] || cookies[developmentSessionCookieName] || "";
}

export function csrfMatches(suppliedToken, expectedHash, secret) {
  return verifyOpaqueToken(suppliedToken, expectedHash, secret);
}

export async function hashPassword(password) {
  if (typeof password !== "string" || password.length < 12 || password.length > 128) throw new RangeError("Password must contain 12 to 128 characters.");
  const salt = randomBytes(16);
  const derived = await scrypt(password.normalize("NFKC"), salt, scryptParameters.keyLength, { N: scryptParameters.cost, r: scryptParameters.blockSize, p: scryptParameters.parallelization, maxmem: scryptParameters.maxmem });
  return `$scrypt$${scryptParameters.cost}$${scryptParameters.blockSize}$${scryptParameters.parallelization}$${salt.toString("base64url")}$${Buffer.from(derived).toString("base64url")}`;
}

export async function verifyPassword(password, storedHash) {
  if (typeof password !== "string" || typeof storedHash !== "string") return false;
  const parts = storedHash.split("$");
  if (parts.length !== 7 || parts[1] !== "scrypt") return false;
  const cost = Number(parts[2]);
  const blockSize = Number(parts[3]);
  const parallelization = Number(parts[4]);
  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[5], "base64url");
    expected = Buffer.from(parts[6], "base64url");
  } catch {
    return false;
  }
  if (cost !== scryptParameters.cost || blockSize !== scryptParameters.blockSize || parallelization !== scryptParameters.parallelization || salt.length !== 16 || expected.length !== scryptParameters.keyLength) return false;
  try {
    const actual = await scrypt(password.normalize("NFKC"), salt, expected.length, { N: cost, r: blockSize, p: parallelization, maxmem: scryptParameters.maxmem });
    return timingSafeEqual(Buffer.from(actual), expected);
  } catch {
    return false;
  }
}

export { developmentSessionCookieName, sessionCookieName };
