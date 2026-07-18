import assert from "node:assert/strict";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import { createAppleSignInProvider, appleSignInEndpoints } from "../src/marketplace/apple-sign-in.mjs";

const now = Date.UTC(2026, 6, 18, 12, 0, 0);
const clientId = "uk.co.homle.web";
const { privateKey: appleSigningKey, publicKey: applePublicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const { privateKey: clientSigningKey, publicKey: clientPublicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const clientPrivateKey = clientSigningKey.export({ type: "pkcs8", format: "pem" });
const appleJwk = { ...applePublicKey.export({ format: "jwk" }), kid: "apple-signing-1", alg: "RS256", use: "sig" };

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function identityToken(claims = {}) {
  const header = base64url(JSON.stringify({ alg: "RS256", kid: appleJwk.kid, typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iss: "https://appleid.apple.com",
    aud: clientId,
    exp: Math.floor(now / 1000) + 600,
    iat: Math.floor(now / 1000),
    sub: "001234.abcdef",
    email: "owner@privaterelay.appleid.com",
    email_verified: "true",
    ...claims
  }));
  const input = `${header}.${payload}`;
  return `${input}.${base64url(sign("RSA-SHA256", Buffer.from(input, "ascii"), appleSigningKey))}`;
}

function flow(attempt) {
  const value = attempt.setCookie.match(/^[^=]+=([^;]+)/)?.[1];
  return JSON.parse(Buffer.from(value.split(".")[0], "base64url").toString("utf8"));
}

const requests = [];
let entropyCounter = 10;
let tokenClaims = {};
let currentFlow = null;
const provider = createAppleSignInProvider({
  appOrigin: "https://homle.example",
  clientId,
  teamId: "TEAMID1234",
  keyId: "KEYID12345",
  privateKey: clientPrivateKey,
  stateSecret: "apple-state-secret-that-is-long-and-private",
  clock: () => now,
  randomBytes(size) { entropyCounter += 1; return Buffer.alloc(size, entropyCounter); },
  async fetch(url, init) {
    requests.push({ url, init });
    if (url === appleSignInEndpoints.tokenEndpoint) {
      const supplied = Object.fromEntries(init.body);
      assert.equal(supplied.client_id, clientId);
      assert.equal(supplied.redirect_uri, "https://homle.example/api/marketplace/auth/apple/callback");
      assert.equal(supplied.grant_type, "authorization_code");
      assert.equal(supplied.code, "one-time-code");
      const [header, payload, signature] = supplied.client_secret.split(".");
      assert.deepEqual(JSON.parse(Buffer.from(header, "base64url")), { alg: "ES256", kid: "KEYID12345", typ: "JWT" });
      const clientClaims = JSON.parse(Buffer.from(payload, "base64url"));
      assert.equal(clientClaims.iss, "TEAMID1234");
      assert.equal(clientClaims.sub, clientId);
      assert.equal(clientClaims.aud, "https://appleid.apple.com");
      assert.equal(clientClaims.exp - clientClaims.iat, 300);
      assert(verify("sha256", Buffer.from(`${header}.${payload}`, "ascii"), { key: clientPublicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url")), "Apple client secret was not signed with the configured P-256 key.");
      return new Response(JSON.stringify({ id_token: identityToken({ nonce: currentFlow.nonce, ...tokenClaims }) }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url === appleSignInEndpoints.jwksEndpoint) return new Response(JSON.stringify({ keys: [appleJwk] }), { status: 200, headers: { "content-type": "application/json", "cache-control": "max-age=300" } });
    throw new Error("Unexpected Apple endpoint");
  }
});

const signIn = provider.begin({ intent: "book" });
const signInUrl = new URL(signIn.location);
currentFlow = flow(signIn);
assert.equal(signInUrl.origin, "https://appleid.apple.com");
assert.equal(signInUrl.pathname, "/auth/authorize");
assert.equal(signInUrl.searchParams.get("response_mode"), "form_post");
assert.equal(signInUrl.searchParams.get("scope"), "name email");
assert.equal(signInUrl.searchParams.get("redirect_uri"), provider.callbackUrl);
assert.equal(signInUrl.searchParams.get("state"), currentFlow.state);
assert.match(signIn.setCookie, /HttpOnly; SameSite=None; Secure; Max-Age=600/);
assert.match(provider.clearCookie, /SameSite=None; Secure; Max-Age=0/);

const cookie = signIn.setCookie.split(";", 1)[0];
const claims = await provider.complete(new URLSearchParams({
  code: "one-time-code",
  state: currentFlow.state,
  user: JSON.stringify({ name: { firstName: "  Alex ", lastName: "O'Neil" }, email: "untrusted@example.com" })
}), cookie);
assert.deepEqual(claims, {
  subject: "001234.abcdef",
  email: "owner@privaterelay.appleid.com",
  emailVerified: true,
  displayName: "Alex O'Neil",
  avatarUrl: "",
  locale: "",
  flowPurpose: "sign-in",
  flowIntent: "book"
});
assert.equal(requests.filter((request) => request.url === appleSignInEndpoints.jwksEndpoint).length, 1);

const link = provider.begin({ purpose: "link" });
const linkUrl = new URL(link.location);
assert.equal(linkUrl.searchParams.get("response_mode"), "query");
assert.equal(linkUrl.searchParams.has("scope"), false);

const maliciousName = provider.begin();
currentFlow = flow(maliciousName);
const sanitized = await provider.complete(new URLSearchParams({ code: "one-time-code", state: currentFlow.state, user: JSON.stringify({ name: { firstName: "<script>", lastName: "Owner" } }) }), maliciousName.setCookie.split(";", 1)[0]);
assert.equal(sanitized.displayName, "Owner");

await assert.rejects(
  provider.complete(new URLSearchParams({ code: "one-time-code", state: `${currentFlow.state}x` }), maliciousName.setCookie.split(";", 1)[0]),
  (error) => error.code === "apple-flow-invalid"
);

const unverified = provider.begin();
currentFlow = flow(unverified);
tokenClaims = { email_verified: "false" };
await assert.rejects(
  provider.complete(new URLSearchParams({ code: "one-time-code", state: currentFlow.state }), unverified.setCookie.split(";", 1)[0]),
  (error) => error.code === "apple-identity-verification-failed"
);
tokenClaims = {};

await assert.rejects(
  provider.complete(new URLSearchParams({ error: "user_cancelled_authorize" }), ""),
  (error) => error.code === "apple-provider-access-denied"
);

assert.throws(() => createAppleSignInProvider({
  appOrigin: "http://localhost:4173",
  clientId,
  teamId: "TEAMID1234",
  keyId: "KEYID12345",
  privateKey: clientPrivateKey,
  stateSecret: "apple-state-secret-that-is-long-and-private"
}), /exact HTTPS/);

console.log("Apple sign-in provider tests passed.");
