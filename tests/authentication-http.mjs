import { AccountHttpError } from "../src/marketplace/account-security.mjs";
import { createAuthenticationHttpRouter } from "../src/marketplace/authentication-http.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function request(method, url, body, headers = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(typeof body === "string" ? body : JSON.stringify(body))];
  return { method, url, headers, async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk; } };
}

function response() {
  return {
    statusCode: null,
    headers: {},
    body: "",
    writeHead(statusCode, headers) { this.statusCode = statusCode; this.headers = headers; },
    end(body = "") { this.body = String(body); },
    parsed() { return this.body ? JSON.parse(this.body) : null; }
  };
}

async function dispatch(router, method, path, body, headers = {}) {
  const req = request(method, path, body, headers);
  const res = response();
  const handled = await router.handle(req, res, new URL(path, "https://tideway.example.com"));
  return { handled, response: res, body: res.parsed() };
}

const origin = "https://tideway.example.com";
const calls = [];
let currentContext = {
  sessionId: "77777777-7777-4777-8777-777777777777",
  csrfHash: Buffer.alloc(32),
  actor: { userId: "11111111-1111-4111-8111-111111111111", roles: [] },
  account: { email: "owner@example.com", emailVerifiedAt: "2026-07-15T12:00:00.000Z", displayName: "Property Owner", selectedRole: null }
};
const security = {
  requireOrigin(req) { if (req.headers.origin !== origin) throw new AccountHttpError(403, "origin-rejected", "The request origin was rejected."); },
  async protect(req) {
    this.requireOrigin(req);
    if (req.headers["x-csrf-token"] !== "valid-csrf") throw new AccountHttpError(403, "csrf-rejected", "The security token is missing or expired.");
    return currentContext;
  }
};
let signInResult = { authenticated: false, reason: "invalid-credentials" };
let verificationResult = { verified: false };
let resetResult = { changed: false };
const credentialService = {
  async register(input) { calls.push({ kind: "register", input }); return { accepted: true, emailDelivery: { kind: "email-verification", recipient: input.email, token: "verification-token-private", expiresAt: "2026-07-16T12:00:00.000Z" } }; },
  async requestEmailVerification(email) { calls.push({ kind: "verification-resend", email }); return { accepted: true, emailDelivery: email === "owner@example.com" ? { kind: "email-verification", recipient: email, token: "resent-token-private", expiresAt: "2026-07-16T12:00:00.000Z" } : null }; },
  async verifyEmail(token) { calls.push({ kind: "verify", token }); return verificationResult; },
  async signIn(email, password) { calls.push({ kind: "sign-in", email, password }); return signInResult; },
  async requestPasswordReset(email) { calls.push({ kind: "reset-request", email }); return { accepted: true, emailDelivery: email === "owner@example.com" ? { kind: "password-reset", recipient: email, token: "reset-token-private", expiresAt: "2026-07-15T16:00:00.000Z" } : null }; },
  async resetPassword(token, password) { calls.push({ kind: "reset-confirm", token, password }); return resetResult; }
};
const identityService = {
  async socialSignIn(provider, claims) { calls.push({ kind: "social-sign-in", provider, claims }); return { user_id: currentContext.actor.userId, email: claims.email, email_verified_at: "2026-07-15T12:00:00.000Z", display_name: claims.displayName, selected_role: null, roles: [] }; },
  async completeOnboarding(actor, role) { calls.push({ kind: "onboarding", actor, role }); return { user_id: actor.userId, selected_role: role, roles: [role] }; }
};
const accountSessionService = {
  async establish(account, metadata) { calls.push({ kind: "establish", account, metadata }); return { account, csrfToken: "new-csrf-private", expiresAt: "2026-07-16T15:00:00.000Z", setCookie: "__Host-tideway_session=opaque; Path=/; HttpOnly; SameSite=Lax; Secure" }; },
  async rotate(context, account, metadata) { calls.push({ kind: "rotate", context, account, metadata }); return { account, csrfToken: "rotated-csrf-private", expiresAt: "2026-07-16T15:00:00.000Z", setCookie: "__Host-tideway_session=rotated; Path=/; HttpOnly; SameSite=Lax; Secure" }; },
  async logout(context) { calls.push({ kind: "logout", context }); return { setCookie: "__Host-tideway_session=deleted; Max-Age=0" }; },
  async logoutAll(context) { calls.push({ kind: "logout-all", context }); return { revokedSessions: 4, setCookie: "__Host-tideway_session=deleted; Max-Age=0" }; }
};
const deliveries = [];
const emailDelivery = { async send(message) { deliveries.push(message); } };
let rateLimitedScope = "";
const rateLimiter = { async consume(input) { calls.push({ kind: "limit", input }); return input.scope === rateLimitedScope ? { allowed: false, retryAfterSeconds: 90 } : { allowed: true }; } };
let nowValue = 1000;
const waits = [];
let unexpectedError;
let googleCompletionError = null;
const googleOidcProvider = {
  name: "google",
  clearCookie: "tideway_google_flow=; Max-Age=0; HttpOnly; Secure",
  begin() { calls.push({ kind: "google-start" }); return { location: "https://accounts.google.com/o/oauth2/v2/auth?state=opaque", setCookie: "tideway_google_flow=signed; HttpOnly; Secure" }; },
  async complete(url, cookie) {
    calls.push({ kind: "google-complete", url: url.toString(), cookie });
    if (googleCompletionError) throw googleCompletionError;
    return { subject: "google-subject", email: "owner@example.com", emailVerified: true, displayName: "Property Owner", avatarUrl: "", locale: "en-GB" };
  }
};
const router = createAuthenticationHttpRouter({ security, credentialService, identityService, accountSessionService, emailDelivery, rateLimiter, googleOidcProvider }, {
  appOrigin: origin,
  clientKey: () => "198.51.100.10",
  minimumPublicResponseMs: 500,
  now: () => nowValue,
  async wait(milliseconds) { waits.push(milliseconds); nowValue += milliseconds; },
  onUnexpectedError(error) { unexpectedError = error; }
});
const publicHeaders = { origin, "content-type": "application/json", "user-agent": "Example Browser" };
const privateHeaders = { ...publicHeaders, "x-csrf-token": "valid-csrf", cookie: "__Host-tideway_session=opaque" };

const unrelatedResponse = response();
assert(await router.handle(request("GET", "/api/health"), unrelatedResponse, new URL(`${origin}/api/health`)) === false && unrelatedResponse.statusCode === null, "Authentication router intercepted an existing pilot route.");
const wrongMethod = await dispatch(router, "GET", "/api/marketplace/auth/login", undefined, publicHeaders);
assert(wrongMethod.response.statusCode === 405 && wrongMethod.response.headers.Allow === "POST", "Authentication routes did not enforce POST-only mutations.");
const wrongOrigin = await dispatch(router, "POST", "/api/marketplace/auth/login", { email: "owner@example.com", password: "secret" }, { ...publicHeaders, origin: "https://attacker.example" });
assert(wrongOrigin.response.statusCode === 403 && wrongOrigin.body.code === "origin-rejected", "Unauthenticated login accepted a cross-origin request.");

const googleStart = await dispatch(router, "GET", "/api/marketplace/auth/google/start", undefined, { "user-agent": "Example Browser" });
assert(googleStart.response.statusCode === 302 && googleStart.response.headers.Location.startsWith("https://accounts.google.com/") && googleStart.response.headers["Set-Cookie"][0].includes("HttpOnly") && googleStart.response.headers["Cache-Control"] === "no-store" && calls.some((call) => call.kind === "google-start"), "Google sign-in did not start through a non-cacheable server redirect and secure flow cookie.");
const googleCallback = await dispatch(router, "GET", "/api/marketplace/auth/google/callback?code=private-code&state=opaque", undefined, { cookie: "tideway_google_flow=signed", "user-agent": "Example Browser" });
assert(googleCallback.response.statusCode === 303 && googleCallback.response.headers.Location.startsWith("/onboarding#social=google&csrfToken=") && !googleCallback.response.headers.Location.includes("private-code") && googleCallback.response.headers["Set-Cookie"].length === 2 && googleCallback.response.headers["Set-Cookie"][0].includes("Max-Age=0") && googleCallback.response.headers["Set-Cookie"][1].includes("HttpOnly") && calls.some((call) => call.kind === "social-sign-in" && call.provider === "google") && calls.some((call) => call.kind === "establish"), "Verified Google callback did not clear flow state, create/reuse the Tideway identity, establish an opaque session and continue to role onboarding.");
googleCompletionError = new TypeError("private provider rejection");
const failedGoogleCallback = await dispatch(router, "GET", "/api/marketplace/auth/google/callback?code=bad&state=opaque", undefined, { cookie: "tideway_google_flow=signed" });
assert(failedGoogleCallback.response.statusCode === 303 && failedGoogleCallback.response.headers.Location === "/login#social=google-failed" && failedGoogleCallback.response.headers["Set-Cookie"][0].includes("Max-Age=0") && !failedGoogleCallback.response.headers.Location.includes("private provider rejection"), "Rejected Google callback leaked provider details or retained its one-time flow cookie.");
googleCompletionError = null;

const signup = await dispatch(router, "POST", "/api/marketplace/auth/signup", { email: "new@example.com", displayName: "New User", password: "long password" }, publicHeaders);
assert(signup.response.statusCode === 202 && signup.body.accepted && waits[0] === 500 && deliveries[0].recipient === "new@example.com" && deliveries[0].link.startsWith(`${origin}/verify-email#token=`) && !deliveries[0].link.includes("?token=") && !signup.response.body.includes("verification-token-private"), "Signup leaked delivery material, omitted the generic timing boundary or put its token in a server URL query.");
const missingResend = await dispatch(router, "POST", "/api/marketplace/auth/verification/resend", { email: "missing@example.com" }, publicHeaders);
const knownResend = await dispatch(router, "POST", "/api/marketplace/auth/verification/resend", { email: "owner@example.com" }, publicHeaders);
assert(missingResend.response.statusCode === 202 && knownResend.response.statusCode === 202 && missingResend.response.body === knownResend.response.body && deliveries.at(-1).link.includes("resent-token-private") && !knownResend.response.body.includes("owner@example.com"), "Verification resend exposed account existence or raw recipient/token material.");

const invalidVerification = await dispatch(router, "POST", "/api/marketplace/auth/verification/confirm", { token: "bad" }, publicHeaders);
verificationResult = { verified: true, account: { userId: currentContext.actor.userId } };
const validVerification = await dispatch(router, "POST", "/api/marketplace/auth/verification/confirm", { token: "good" }, publicHeaders);
assert(invalidVerification.response.statusCode === 400 && invalidVerification.body.code === "verification-invalid" && validVerification.response.statusCode === 200 && validVerification.body.verified, "Email verification did not distinguish valid one-time completion from an invalid/expired token.");

const invalidLogin = await dispatch(router, "POST", "/api/marketplace/auth/login", { email: "owner@example.com", password: "wrong" }, publicHeaders);
assert(invalidLogin.response.statusCode === 401 && invalidLogin.body.code === "invalid-credentials" && !invalidLogin.response.headers["Set-Cookie"], "Invalid login issued a cookie or lost its generic credential error.");
signInResult = { authenticated: false, reason: "temporarily-locked" };
const lockedLogin = await dispatch(router, "POST", "/api/marketplace/auth/login", { email: "owner@example.com", password: "correct" }, publicHeaders);
assert(lockedLogin.response.statusCode === 429 && lockedLogin.body.code === "temporarily-locked", "Persistently locked credentials were allowed to create a session.");
signInResult = { authenticated: true, account: { userId: currentContext.actor.userId, email: "owner@example.com", emailVerifiedAt: "2026-07-15T12:00:00.000Z", displayName: "Property Owner", selectedRole: null, roles: [] } };
const validLogin = await dispatch(router, "POST", "/api/marketplace/auth/login", { email: "owner@example.com", password: "correct" }, publicHeaders);
assert(validLogin.response.statusCode === 200 && validLogin.response.headers["Set-Cookie"].includes("HttpOnly") && validLogin.body.csrfToken === "new-csrf-private" && validLogin.body.account.email === "owner@example.com" && !validLogin.response.body.includes("correct") && calls.at(-1).metadata.ipAddress === "198.51.100.10", "Valid login failed secure session establishment or leaked credentials.");

const unknownReset = await dispatch(router, "POST", "/api/marketplace/auth/password-reset/request", { email: "missing@example.com" }, publicHeaders);
const knownReset = await dispatch(router, "POST", "/api/marketplace/auth/password-reset/request", { email: "owner@example.com" }, publicHeaders);
assert(unknownReset.response.body === knownReset.response.body && deliveries.at(-1).link.startsWith(`${origin}/reset-password#token=`) && !knownReset.response.body.includes("reset-token-private"), "Password-reset request exposed account existence or token material.");
const invalidReset = await dispatch(router, "POST", "/api/marketplace/auth/password-reset/confirm", { token: "bad", password: "replacement" }, publicHeaders);
resetResult = { changed: true, sessionsRevoked: 3 };
const validReset = await dispatch(router, "POST", "/api/marketplace/auth/password-reset/confirm", { token: "good", password: "replacement" }, publicHeaders);
assert(invalidReset.response.statusCode === 400 && validReset.response.statusCode === 200 && validReset.body.sessionsRevoked === 3 && !validReset.response.headers["Set-Cookie"], "Password reset accepted an invalid token or silently issued a session after credential replacement.");

const logout = await dispatch(router, "POST", "/api/marketplace/auth/logout", {}, privateHeaders);
const logoutAll = await dispatch(router, "POST", "/api/marketplace/auth/logout-all", {}, privateHeaders);
assert(logout.response.statusCode === 200 && logout.response.headers["Set-Cookie"].includes("Max-Age=0") && logoutAll.body.revokedSessions === 4 && calls.some((call) => call.kind === "logout") && calls.some((call) => call.kind === "logout-all"), "Logout or logout-all did not revoke server sessions and expire the cookie.");

const onboarding = await dispatch(router, "POST", "/api/marketplace/onboarding", { role: "landlord" }, privateHeaders);
assert(onboarding.response.statusCode === 200 && onboarding.body.account.selectedRole === "landlord" && onboarding.body.csrfToken === "rotated-csrf-private" && onboarding.response.headers["Set-Cookie"].includes("rotated") && calls.at(-1).kind === "rotate" && calls.at(-1).account.email === "owner@example.com", "Role onboarding did not rotate the role-pending session with the existing account identity.");
currentContext = { ...currentContext, actor: { ...currentContext.actor, roles: ["landlord"] }, account: { ...currentContext.account, selectedRole: "landlord" } };
const repeatedOnboarding = await dispatch(router, "POST", "/api/marketplace/onboarding", { role: "cleaner" }, privateHeaders);
assert(repeatedOnboarding.response.statusCode === 409 && repeatedOnboarding.body.code === "onboarding-complete", "Completed onboarding could be used for a self-service role change.");

rateLimitedScope = "login";
const rateLimited = await dispatch(router, "POST", "/api/marketplace/auth/login", { email: "owner@example.com", password: "correct" }, publicHeaders);
assert(rateLimited.response.statusCode === 429 && rateLimited.body.code === "rate-limited" && rateLimited.response.headers["Retry-After"] === "90", "Authentication abuse control did not fail closed with a bounded retry time.");
rateLimitedScope = "";

emailDelivery.send = async () => { throw new Error("private SMTP detail"); };
const deliveryFailure = await dispatch(router, "POST", "/api/marketplace/auth/password-reset/request", { email: "owner@example.com" }, publicHeaders);
assert(deliveryFailure.response.statusCode === 500 && deliveryFailure.body.error === "Something went wrong. Please try again." && !deliveryFailure.response.body.includes("SMTP") && unexpectedError?.message === "private SMTP detail", "Delivery failure leaked private provider details or bypassed private monitoring.");

console.log("Authentication HTTP tests passed: generic signup/resend/reset, fragment-only email tokens, verified login session issuance, persistent lock handling, exact logout, onboarding rotation, trusted rate limiting and sanitized delivery failures.");
