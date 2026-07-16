import { generateKeyPairSync, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createGoogleOidcProvider, googleOidcEndpoints } from "../src/marketplace/google-oidc.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function rejects(operation, expected) {
  try { await operation(); } catch (error) { return String(error.message).includes(expected); }
  return false;
}

function encoded(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function identityToken(privateKey, kid, claims, header = {}) {
  const first = encoded({ alg: "RS256", typ: "JWT", kid, ...header });
  const second = encoded(claims);
  const signature = sign("RSA-SHA256", Buffer.from(`${first}.${second}`, "ascii"), privateKey).toString("base64url");
  return `${first}.${second}.${signature}`;
}

const appOrigin = "https://tideway.example.com";
const clientId = "tideway-google-client.apps.googleusercontent.com";
const clientSecret = "private-google-client-secret";
const stateSecret = "google-flow-state-secret-more-than-thirty-two-characters";
const now = Date.UTC(2026, 6, 16, 10, 0, 0);
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" });
const kid = "google-key-1";
let entropyCounter = 1;
let activeNonce = "";
let claimsOverride = {};
let tokenRequests = 0;
let keyRequests = 0;
let lastTokenBody;

const baseClaims = () => ({
  iss: "https://accounts.google.com",
  aud: clientId,
  sub: "google-subject-123",
  email: "owner@example.com",
  email_verified: true,
  name: "Property Owner",
  picture: "https://images.example.com/owner.jpg",
  locale: "en-GB",
  nonce: activeNonce,
  iat: Math.floor(now / 1000),
  exp: Math.floor(now / 1000) + 600,
  ...claimsOverride
});

async function fetcher(url, init) {
  if (url === googleOidcEndpoints.tokenEndpoint) {
    tokenRequests += 1;
    assert(init.method === "POST" && init.redirect === "error" && init.headers["Content-Type"] === "application/x-www-form-urlencoded", "Google authorization code was not exchanged through the bounded server POST channel.");
    lastTokenBody = new URLSearchParams(init.body);
    return new Response(JSON.stringify({ access_token: "unused-access-token", id_token: identityToken(privateKey, kid, baseClaims()), expires_in: 3600, token_type: "Bearer" }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url === googleOidcEndpoints.jwksEndpoint) {
    keyRequests += 1;
    return new Response(JSON.stringify({ keys: [{ ...jwk, kid, alg: "RS256", use: "sig" }] }), { status: 200, headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" } });
  }
  throw new Error(`Unexpected provider request: ${url}`);
}

const provider = createGoogleOidcProvider({
  appOrigin,
  clientId,
  clientSecret,
  stateSecret,
  fetch: fetcher,
  clock: () => now,
  randomBytes(size) { return Buffer.alloc(size, entropyCounter++); }
});

function start() {
  const attempt = provider.begin();
  const location = new URL(attempt.location);
  activeNonce = location.searchParams.get("nonce");
  return { attempt, location, state: location.searchParams.get("state"), cookie: attempt.setCookie.split(";", 1)[0] };
}

const first = start();
assert(first.location.origin === "https://accounts.google.com" && first.location.pathname === "/o/oauth2/v2/auth", "Google sign-in did not use Google's authorization endpoint.");
assert(first.location.searchParams.get("response_type") === "code" && first.location.searchParams.get("scope") === "openid email profile" && first.location.searchParams.get("client_id") === clientId && first.location.searchParams.get("redirect_uri") === `${appOrigin}/api/marketplace/auth/google/callback`, "Google sign-in requested the wrong client, callback, response type or identity scopes.");
assert(first.location.searchParams.get("code_challenge_method") === "S256" && first.location.searchParams.get("code_challenge")?.length === 43 && first.state.length === 43 && activeNonce.length === 43, "Google sign-in omitted PKCE, state or nonce replay protection.");
assert(first.attempt.setCookie.startsWith("__Host-tideway_google_flow=") && first.attempt.setCookie.includes("Path=/") && first.attempt.setCookie.includes("HttpOnly") && first.attempt.setCookie.includes("SameSite=Lax") && first.attempt.setCookie.includes("Secure") && first.attempt.setCookie.includes("Max-Age=600") && !first.attempt.setCookie.includes(clientSecret), "Google flow material was not kept in a host-only short-lived secure HTTP-only cookie.");

const firstClaims = await provider.complete(new URL(`${provider.callbackUrl}?code=one-time-code&state=${encodeURIComponent(first.state)}`), first.cookie);
assert(firstClaims.subject === "google-subject-123" && firstClaims.email === "owner@example.com" && firstClaims.emailVerified === true && firstClaims.displayName === "Property Owner" && firstClaims.avatarUrl.startsWith("https://") && firstClaims.locale === "en-GB", "A valid Google identity token did not produce the bounded verified account claims.");
assert(lastTokenBody.get("code") === "one-time-code" && lastTokenBody.get("client_id") === clientId && lastTokenBody.get("client_secret") === clientSecret && lastTokenBody.get("grant_type") === "authorization_code" && lastTokenBody.get("redirect_uri") === provider.callbackUrl && lastTokenBody.get("code_verifier")?.length === 43 && !lastTokenBody.has("refresh_token"), "The Google code exchange lost its exact callback, client authentication or PKCE verifier, or requested persistent provider access unnecessarily.");
assert(provider.clearCookie.includes("Max-Age=0") && provider.clearCookie.includes("Secure"), "The Google flow cookie cannot be expired after callback handling.");

const proxied = start();
const proxiedClaims = await provider.complete(new URL(`http://127.0.0.1:4173/api/marketplace/auth/google/callback?code=proxied-code&state=${encodeURIComponent(proxied.state)}`), proxied.cookie);
assert(proxiedClaims.subject === "google-subject-123" && lastTokenBody.get("redirect_uri") === provider.callbackUrl, "A trusted reverse-proxy callback lost the configured public HTTPS redirect URI.");

const second = start();
await provider.complete(new URL(`${provider.callbackUrl}?code=second-code&state=${encodeURIComponent(second.state)}`), second.cookie);
assert(tokenRequests === 3 && keyRequests === 1, "Google signing keys were not bounded and cached or the authorization code was not exchanged exactly once per callback.");

const mismatched = start();
assert(await rejects(() => provider.complete(new URL(`${provider.callbackUrl}?code=code&state=${encodeURIComponent(`${mismatched.state}x`)}`), mismatched.cookie), "mismatched"), "Google callback accepted a state that did not match the signed HTTP-only flow cookie.");
assert(await rejects(() => provider.complete(new URL(`${provider.callbackUrl}?code=code&state=${encodeURIComponent(mismatched.state)}`), ""), "missing or expired"), "Google callback accepted a missing flow cookie.");
assert(await rejects(() => provider.complete(new URL(`${provider.callbackUrl}?error=access_denied&state=${encodeURIComponent(mismatched.state)}`), mismatched.cookie), "cancelled or rejected"), "Google denial was treated as a successful sign-in.");

for (const [override, expected, label] of [
  [{ aud: "different-client" }, "different application", "audience"],
  [{ iss: "https://attacker.example" }, "different application", "issuer"],
  [{ nonce: "different-nonce" }, "different sign-in attempt", "nonce"],
  [{ email_verified: false }, "verified account email", "verified email"],
  [{ exp: Math.floor(now / 1000) - 120 }, "expired", "expiry"]
]) {
  claimsOverride = override;
  const attempt = start();
  assert(await rejects(() => provider.complete(new URL(`${provider.callbackUrl}?code=invalid-${label}&state=${encodeURIComponent(attempt.state)}`), attempt.cookie), expected), `Google identity-token ${label} validation failed open.`);
}
claimsOverride = {};

assert(await rejects(() => Promise.resolve(createGoogleOidcProvider({ appOrigin, clientId, clientSecret, stateSecret: "short" })), "state secret"), "Google sign-in accepted a weak flow-state secret.");
assert(await rejects(() => Promise.resolve(createGoogleOidcProvider({ appOrigin, clientId, clientSecret, stateSecret, requestTimeoutMs: 999 })), "timeout"), "Google sign-in accepted an unbounded provider timeout.");

const accountPage = await readFile(new URL("../public/account.html", import.meta.url), "utf8");
const accountScript = await readFile(new URL("../public/auth-entry.js", import.meta.url), "utf8");
assert(accountPage.includes('data-social-actions hidden') && accountPage.includes('data-social-provider="google"') && accountPage.includes('data-social-provider="facebook"') && /data-social-provider="google"[^>]+hidden/.test(accountPage) && /data-social-provider="facebook"[^>]+hidden/.test(accountPage), "The account page exposed a provider before capability discovery or omitted its gated controls.");
assert(accountScript.includes("providers[link.dataset.socialProvider] === true") && accountScript.indexOf("history.replaceState") < accountScript.indexOf('fetch("/api/auth/providers"') && accountScript.includes('fragment.get("csrfToken")') && accountScript.includes("storeCsrf(socialCsrfToken)"), "The account browser flow did not require an explicit provider capability or remove callback fragments before network activity.");

console.log("Google OIDC tests passed: exact callback, signed short-lived state, nonce, PKCE, server-only code exchange, RS256/JWKS verification, issuer/audience/expiry/email checks, bounded key cache, cookie clearing and capability-gated UI.");
