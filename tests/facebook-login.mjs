import assert from "node:assert/strict";
import { createFacebookLoginProvider } from "../src/marketplace/facebook-login.mjs";

const appOrigin = "https://staging.tideway.example";
const appId = "123456789012345";
const appSecret = "abcdef0123456789abcdef0123456789";
const graphVersion = "v99.0";
const stateSecret = "facebook-flow-state-secret-more-than-thirty-two-characters";
const now = Date.UTC(2026, 6, 16, 12, 0, 0);
const accessToken = "private-facebook-user-access-token";
let entropyCounter = 1;
let debugOverride = {};
let profileOverride = {};
let requests = [];

async function fetcher(urlValue, init) {
  const url = urlValue instanceof URL ? urlValue : new URL(urlValue);
  requests.push({ url, init });
  if (url.pathname.endsWith("/oauth/access_token")) {
    assert.equal(init.method, "POST");
    assert.equal(init.headers["Content-Type"], "application/x-www-form-urlencoded");
    assert(!url.search.includes(appSecret) && !url.search.includes("private-code"));
    const body = new URLSearchParams(init.body);
    assert.equal(body.get("client_id"), appId);
    assert.equal(body.get("client_secret"), appSecret);
    assert.equal(body.get("redirect_uri"), `${appOrigin}/api/marketplace/auth/facebook/callback`);
    return new Response(JSON.stringify({ access_token: accessToken, token_type: "bearer", expires_in: 3600 }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.pathname.endsWith("/debug_token")) {
    assert.equal(init.headers.Authorization, `Bearer ${appId}|${appSecret}`);
    assert.equal(url.searchParams.get("input_token"), accessToken);
    return new Response(JSON.stringify({ data: { app_id: appId, type: "USER", is_valid: true, user_id: "facebook-subject-123", expires_at: Math.floor(now / 1000) + 3600, data_access_expires_at: Math.floor(now / 1000) + 7200, ...debugOverride } }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.pathname.endsWith("/me")) {
    assert.equal(init.headers.Authorization, `Bearer ${accessToken}`);
    assert.equal(url.searchParams.get("fields"), "id,name,email,picture.type(large)");
    assert.match(url.searchParams.get("appsecret_proof"), /^[a-f0-9]{64}$/);
    assert(!url.searchParams.has("access_token"));
    return new Response(JSON.stringify({ id: "facebook-subject-123", name: "Property Owner", email: "Owner@Example.com", picture: { data: { is_silhouette: false, url: "https://images.example.com/owner.jpg" } }, ...profileOverride }), { status: 200, headers: { "content-type": "application/json" } });
  }
  throw new Error(`Unexpected Facebook request: ${url}`);
}

const provider = createFacebookLoginProvider({ appOrigin, appId, appSecret, graphVersion, stateSecret, fetch: fetcher, clock: () => now, randomBytes(size) { return Buffer.alloc(size, entropyCounter++); } });
function start() {
  const attempt = provider.begin();
  const location = new URL(attempt.location);
  return { attempt, location, state: location.searchParams.get("state"), cookie: attempt.setCookie.split(";", 1)[0] };
}

const first = start();
assert.equal(first.location.origin, "https://www.facebook.com");
assert.equal(first.location.pathname, `/${graphVersion}/dialog/oauth`);
assert.equal(first.location.searchParams.get("client_id"), appId);
assert.equal(first.location.searchParams.get("scope"), "email");
assert.equal(first.location.searchParams.get("response_type"), "code");
assert.equal(first.location.searchParams.get("redirect_uri"), provider.callbackUrl);
assert.equal(first.state.length, 43);
assert(first.attempt.setCookie.startsWith("__Host-tideway_facebook_flow=") && first.attempt.setCookie.includes("HttpOnly") && first.attempt.setCookie.includes("SameSite=Lax") && first.attempt.setCookie.includes("Secure") && first.attempt.setCookie.includes("Max-Age=600") && !first.attempt.setCookie.includes(appSecret));

const claims = await provider.complete(new URL(`${provider.callbackUrl}?code=private-code&state=${encodeURIComponent(first.state)}`), first.cookie);
assert.deepEqual(claims, { subject: "facebook-subject-123", email: "owner@example.com", emailVerified: false, displayName: "Property Owner", avatarUrl: "https://images.example.com/owner.jpg", locale: "", flowPurpose: "sign-in", flowIntent: "" });
assert.equal(requests.length, 3);
assert(provider.clearCookie.includes("Max-Age=0") && provider.clearCookie.includes("Secure"));

const link = provider.begin({ purpose: "link" });
const linkLocation = new URL(link.location);
const linkClaims = await provider.complete(new URL(`${provider.callbackUrl}?code=link&state=${encodeURIComponent(linkLocation.searchParams.get("state"))}`), link.setCookie.split(";", 1)[0]);
assert.equal(linkClaims.flowPurpose, "link");
const stepUp = provider.begin({ purpose: "step-up" });
const stepUpLocation = new URL(stepUp.location);
const stepUpClaims = await provider.complete(new URL(`${provider.callbackUrl}?code=step-up-code&state=${encodeURIComponent(stepUpLocation.searchParams.get("state"))}`), stepUp.setCookie.split(";", 1)[0]);
assert.equal(stepUpClaims.flowPurpose, "step-up");
const booking = provider.begin({ intent: "book" });
const bookingLocation = new URL(booking.location);
const bookingClaims = await provider.complete(new URL(`${provider.callbackUrl}?code=booking-code&state=${encodeURIComponent(bookingLocation.searchParams.get("state"))}`), booking.setCookie.split(";", 1)[0]);
assert.equal(bookingClaims.flowPurpose, "sign-in");
assert.equal(bookingClaims.flowIntent, "book");
assert.throws(() => provider.begin({ purpose: "unexpected" }), /purpose/i);
assert.throws(() => provider.begin({ intent: "https://attacker.example" }), /intent/i);
assert.throws(() => provider.begin({ purpose: "link", intent: "book" }), /intent/i);

const proxied = start();
await provider.complete(new URL(`http://127.0.0.1:4173/api/marketplace/auth/facebook/callback?code=proxied&state=${encodeURIComponent(proxied.state)}`), proxied.cookie);
assert.equal(new URLSearchParams(requests.at(-3).init.body).get("redirect_uri"), provider.callbackUrl);

const mismatched = start();
await assert.rejects(() => provider.complete(new URL(`${provider.callbackUrl}?code=x&state=${mismatched.state}x`), mismatched.cookie), /mismatched/);
await assert.rejects(() => provider.complete(new URL(`${provider.callbackUrl}?code=x&state=${mismatched.state}`), ""), /missing or expired/);
await assert.rejects(() => provider.complete(new URL(`${provider.callbackUrl}?error=access_denied&state=${mismatched.state}`), mismatched.cookie), /cancelled or rejected/);

debugOverride = { app_id: "different-app" };
const wrongApp = start();
await assert.rejects(() => provider.complete(new URL(`${provider.callbackUrl}?code=x&state=${wrongApp.state}`), wrongApp.cookie), /different application/);
debugOverride = { expires_at: Math.floor(now / 1000) - 120 };
const expired = start();
await assert.rejects(() => provider.complete(new URL(`${provider.callbackUrl}?code=x&state=${expired.state}`), expired.cookie), /expired/);
debugOverride = {};
profileOverride = { id: "different-person" };
const mismatch = start();
await assert.rejects(() => provider.complete(new URL(`${provider.callbackUrl}?code=x&state=${mismatch.state}`), mismatch.cookie), /mismatched/);
profileOverride = { email: undefined };
const withoutEmail = start();
const emailMissingClaims = await provider.complete(new URL(`${provider.callbackUrl}?code=x&state=${withoutEmail.state}`), withoutEmail.cookie);
assert.equal(emailMissingClaims.email, null);
profileOverride = {};

assert.throws(() => createFacebookLoginProvider({ appOrigin, appId, appSecret, graphVersion: "latest", stateSecret }), /vN.N/);
assert.throws(() => createFacebookLoginProvider({ appOrigin, appId: "not-an-app", appSecret, graphVersion, stateSecret }), /App ID/);
assert.throws(() => createFacebookLoginProvider({ appOrigin, appId, appSecret: "not-a-facebook-secret", graphVersion, stateSecret }), /App secret/);
assert.throws(() => createFacebookLoginProvider({ appOrigin, appId, appSecret, graphVersion, stateSecret: "short" }), /state secret/);
assert.throws(() => createFacebookLoginProvider({ appOrigin, appId, appSecret, graphVersion, stateSecret, requestTimeoutMs: 999 }), /timeout/);

const failingProvider = createFacebookLoginProvider({
  appOrigin, appId, appSecret, graphVersion, stateSecret, clock: () => now,
  randomBytes(size) { return Buffer.alloc(size, 9); },
  async fetch(url) {
    if (String(url).includes("oauth/access_token")) return new Response(JSON.stringify({ access_token: accessToken, token_type: "bearer" }), { status: 200, headers: { "content-type": "application/json" } });
    throw new Error(`private transport detail ${url}`);
  }
});
const failingAttempt = failingProvider.begin();
const failingLocation = new URL(failingAttempt.location);
await assert.rejects(
  () => failingProvider.complete(new URL(`${failingProvider.callbackUrl}?code=x&state=${failingLocation.searchParams.get("state")}`), failingAttempt.setCookie.split(";", 1)[0]),
  (error) => error instanceof TypeError && error.message.includes("temporarily unavailable") && !error.message.includes(accessToken)
);

console.log("Facebook Login tests passed: version-pinned authorization, signed account-first booking intent and sign-in/link purpose, bounded server exchange, app-bound token inspection, app-secret proof, subject matching, unverified-email boundary and cookie cleanup.");
