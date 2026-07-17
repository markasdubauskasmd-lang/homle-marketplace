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
  async authenticate(req) {
    if (!String(req.headers.cookie || "").includes("__Host-tideway_session=opaque")) throw new AccountHttpError(401, "authentication-required", "Sign in is required.");
    return currentContext;
  },
  async protect(req, policy = {}) {
    const context = await this.authenticate(req);
    if (policy.mutation) {
      this.requireOrigin(req);
      if (req.headers["x-csrf-token"] !== "valid-csrf") throw new AccountHttpError(403, "csrf-rejected", "The security token is missing or expired.");
    }
    return context;
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
let socialSignInError = null;
const identityService = {
  async socialSignIn(provider, claims) { calls.push({ kind: "social-sign-in", provider, claims }); if (socialSignInError) throw socialSignInError; return { user_id: currentContext.actor.userId, email: claims.email, email_verified_at: "2026-07-15T12:00:00.000Z", display_name: claims.displayName, selected_role: null, roles: [] }; },
  async completeOnboarding(actor, role) { calls.push({ kind: "onboarding", actor, role }); return { user_id: actor.userId, selected_role: role, roles: [role] }; },
  async activateWorkspace(actor, role) { calls.push({ kind: "workspace", actor, role }); return { selected_role: role, roles: [...new Set([...actor.roles, role])].sort(), profile_created: !actor.roles.includes(role), workspace_added: !actor.roles.includes(role) }; },
  async connectedProviders(actor) { calls.push({ kind: "connected-providers", actor }); return connectedProviders; },
  async connectProvider(actor, provider, claims) { calls.push({ kind: "connect-provider", actor, provider, claims }); connectedProviders.push({ provider, connectedAt: "2026-07-16T12:00:00.000Z", lastUsedAt: null }); return { provider }; },
  async verifyProviderStepUp(actor, provider, claims) { calls.push({ kind: "provider-step-up", actor, provider, claims }); return claims.subject === `${provider}-subject`; },
  async disconnectProvider(actor, provider) {
    calls.push({ kind: "disconnect-provider", actor, provider });
    const index = connectedProviders.findIndex((item) => item.provider === provider);
    if (index < 0) return { disconnected: false, reason: "provider-not-connected", revokedSessions: 0 };
    connectedProviders.splice(index, 1);
    return { disconnected: true, reason: null, revokedSessions: 2 };
  }
};
const connectedProviders = [{ provider: "password", connectedAt: "2026-07-15T12:00:00.000Z", lastUsedAt: null }];
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
let googlePurpose = "sign-in";
let googleIntent = "";
const googleOidcProvider = {
  name: "google",
  clearCookie: "tideway_google_flow=; Max-Age=0; HttpOnly; Secure",
  begin(options = {}) { googlePurpose = options.purpose || "sign-in"; googleIntent = options.intent || ""; calls.push({ kind: "google-start", purpose: googlePurpose, intent: googleIntent }); return { location: "https://accounts.google.com/o/oauth2/v2/auth?response_type=code&redirect_uri=https%3A%2F%2Ftideway.example.com%2Fapi%2Fmarketplace%2Fauth%2Fgoogle%2Fcallback&state=opaque", setCookie: "tideway_google_flow=signed; HttpOnly; Secure" }; },
  async complete(url, cookie) {
    calls.push({ kind: "google-complete", url: url.toString(), cookie });
    if (googleCompletionError) throw googleCompletionError;
    return { subject: "google-subject", email: "owner@example.com", emailVerified: true, displayName: "Property Owner", avatarUrl: "", locale: "en-GB", flowPurpose: googlePurpose, flowIntent: googleIntent };
  }
};
let facebookCompletionError = null;
let facebookPurpose = "sign-in";
let facebookIntent = "";
const facebookLoginProvider = {
  name: "facebook",
  clearCookie: "tideway_facebook_flow=; Max-Age=0; HttpOnly; Secure",
  begin(options = {}) { facebookPurpose = options.purpose || "sign-in"; facebookIntent = options.intent || ""; calls.push({ kind: "facebook-start", purpose: facebookPurpose, intent: facebookIntent }); return { location: "https://www.facebook.com/v99.0/dialog/oauth?response_type=code&redirect_uri=https%3A%2F%2Ftideway.example.com%2Fapi%2Fmarketplace%2Fauth%2Ffacebook%2Fcallback&state=opaque", setCookie: "tideway_facebook_flow=signed; HttpOnly; Secure" }; },
  async complete(url, cookie) {
    calls.push({ kind: "facebook-complete", url: url.toString(), cookie });
    if (facebookCompletionError) throw facebookCompletionError;
    return { subject: "facebook-subject", email: "owner@example.com", emailVerified: false, displayName: "Property Owner", avatarUrl: "", locale: "", flowPurpose: facebookPurpose, flowIntent: facebookIntent };
  }
};
let facebookBeginResult = { authenticated: false, verificationRequired: true, emailDelivery: { kind: "facebook-email-verification", recipient: "owner@example.com", token: "facebook-verification-private", expiresAt: "2026-07-16T13:00:00.000Z" } };
let facebookVerifyResult = { verified: false, reason: "invalid-or-expired" };
const facebookIdentityService = {
  async begin(claims) { calls.push({ kind: "facebook-identity-begin", claims }); return facebookBeginResult; },
  async verify(token) { calls.push({ kind: "facebook-identity-verify", token }); return facebookVerifyResult; }
};
const facebookDataDeletionService = {
  async request(signedRequest) {
    calls.push({ kind: "facebook-data-deletion", signedRequest });
    return { statusUrl: `${origin}/facebook-data-deletion#code=${"c".repeat(32)}`, confirmationCode: "c".repeat(32), status: "requested" };
  },
  async status(code) {
    calls.push({ kind: "facebook-data-deletion-status", code });
    return code === "c".repeat(32) ? { status: "processing", requestedAt: "2026-07-16T12:00:00.000Z", completedAt: null } : null;
  }
};
const providerLinkState = {
  clearCookie: "__Host-tideway_provider_link=; Max-Age=0; HttpOnly; Secure",
  clearStepUpFlowCookie: "__Host-tideway_provider_step_up_flow=; Max-Age=0; HttpOnly; Secure",
  clearRecentStepUpCookie: "__Host-tideway_provider_step_up_recent=; Max-Age=0; HttpOnly; SameSite=Strict; Secure",
  has(cookie) { return String(cookie || "").includes("__Host-tideway_provider_link="); },
  hasStepUpFlow(cookie) { return String(cookie || "").includes("__Host-tideway_provider_step_up_flow="); },
  begin(context, provider) { calls.push({ kind: "provider-link-begin", context, provider }); return `__Host-tideway_provider_link=${provider}-signed; HttpOnly; Secure`; },
  verify(cookie, context, provider) {
    calls.push({ kind: "provider-link-verify", cookie, context, provider });
    if (!String(cookie).includes(`__Host-tideway_provider_link=${provider}-signed`)) throw new TypeError("The provider connection attempt is missing or expired.");
    return { provider, userId: context.actor.userId, sessionId: context.sessionId };
  },
  beginStepUp(context, provider) { calls.push({ kind: "provider-step-up-begin", context, provider }); return `__Host-tideway_provider_step_up_flow=${provider}-signed; HttpOnly; Secure`; },
  verifyStepUp(cookie, context, provider) {
    calls.push({ kind: "provider-step-up-verify", cookie, context, provider });
    if (!String(cookie).includes(`__Host-tideway_provider_step_up_flow=${provider}-signed`)) throw new TypeError("The provider security check is missing or expired.");
    return { provider, userId: context.actor.userId, sessionId: context.sessionId };
  },
  completeStepUp(context, provider) { calls.push({ kind: "provider-step-up-complete", context, provider }); return `__Host-tideway_provider_step_up_recent=${provider}-signed; HttpOnly; SameSite=Strict; Secure`; },
  verifyRecentStepUp(cookie, context) {
    const match = String(cookie || "").match(/__Host-tideway_provider_step_up_recent=(google|facebook)-signed/);
    if (!match) throw new TypeError("The recent provider security check is missing or expired.");
    return { provider: match[1], userId: context.actor.userId, sessionId: context.sessionId };
  }
};
const router = createAuthenticationHttpRouter({ security, credentialService, identityService, facebookIdentityService, facebookDataDeletionService, providerLinkState, accountSessionService, emailDelivery, rateLimiter, googleOidcProvider, facebookLoginProvider }, {
  appOrigin: origin,
  workspaceReady: false,
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

const invalidGoogleIntent = await dispatch(router, "GET", "/api/marketplace/auth/google/start?intent=https%3A%2F%2Fattacker.example", undefined, { "user-agent": "Example Browser" });
assert(invalidGoogleIntent.response.statusCode === 400 && invalidGoogleIntent.body.code === "invalid-account-intent", "Google sign-in accepted an arbitrary account destination.");
const googleStart = await dispatch(router, "GET", "/api/marketplace/auth/google/start?intent=book", undefined, { "user-agent": "Example Browser" });
assert(googleStart.response.statusCode === 302 && googleStart.response.headers.Location.startsWith("https://accounts.google.com/") && googleStart.response.headers["Set-Cookie"][0].includes("HttpOnly") && googleStart.response.headers["Cache-Control"] === "no-store" && calls.some((call) => call.kind === "google-start" && call.intent === "book"), "Google account-first booking did not start through a non-cacheable server redirect and secure signed flow cookie.");
const googleCallback = await dispatch(router, "GET", "/api/marketplace/auth/google/callback?code=private-code&state=opaque", undefined, { cookie: "tideway_google_flow=signed", "user-agent": "Example Browser" });
assert(googleCallback.response.statusCode === 303 && googleCallback.response.headers.Location.startsWith("/onboarding#social=google&csrfToken=") && googleCallback.response.headers.Location.endsWith("&intent=book") && !googleCallback.response.headers.Location.includes("private-code") && googleCallback.response.headers["Set-Cookie"].length === 2 && googleCallback.response.headers["Set-Cookie"][0].includes("Max-Age=0") && googleCallback.response.headers["Set-Cookie"][1].includes("HttpOnly") && calls.some((call) => call.kind === "social-sign-in" && call.provider === "google") && calls.some((call) => call.kind === "establish"), "Verified Google callback did not clear flow state, create/reuse the Homle identity, preserve booking intent, establish an opaque session and continue to Landlord role onboarding.");
const googleCleanerStart = await dispatch(router, "GET", "/api/marketplace/auth/google/start?intent=work", undefined, { "user-agent": "Example Browser" });
const googleCleanerCallback = await dispatch(router, "GET", "/api/marketplace/auth/google/callback?code=cleaner-code&state=opaque", undefined, { cookie: "tideway_google_flow=signed", "user-agent": "Example Browser" });
assert(googleCleanerStart.response.statusCode === 302 && calls.some((call) => call.kind === "google-start" && call.intent === "work") && googleCleanerCallback.response.statusCode === 303 && googleCleanerCallback.response.headers.Location.startsWith("/onboarding#social=google&csrfToken=") && googleCleanerCallback.response.headers.Location.endsWith("&intent=work"), "Google account creation did not preserve the Cleaner profile action through its signed server flow.");
socialSignInError = Object.assign(new TypeError("private staging access result"), { code: "staging-account-access-unavailable" });
const unapprovedGoogleCallback = await dispatch(router, "GET", "/api/marketplace/auth/google/callback?code=unapproved&state=opaque", undefined, { cookie: "tideway_google_flow=signed" });
assert(unapprovedGoogleCallback.response.statusCode === 303 && unapprovedGoogleCallback.response.headers.Location === "/login#social=staging-access-unavailable" && unapprovedGoogleCallback.response.headers["Set-Cookie"][0].includes("Max-Age=0") && !unapprovedGoogleCallback.response.headers.Location.includes("private staging access result"), "A verified but unapproved Google test account received a vague or private callback failure instead of the safe staging result.");
socialSignInError = null;
googleCompletionError = new TypeError("private provider rejection");
const failedGoogleCallback = await dispatch(router, "GET", "/api/marketplace/auth/google/callback?code=bad&state=opaque", undefined, { cookie: "tideway_google_flow=signed" });
assert(failedGoogleCallback.response.statusCode === 303 && failedGoogleCallback.response.headers.Location === "/login#social=google-failed&reason=provider-failed" && failedGoogleCallback.response.headers["Set-Cookie"][0].includes("Max-Age=0") && !failedGoogleCallback.response.headers.Location.includes("private provider rejection") && unexpectedError?.code === "google-provider-failed" && !unexpectedError.message.includes("private provider rejection"), "Rejected Google callback leaked provider details, retained its one-time flow cookie or bypassed privacy-safe stage monitoring.");
googleCompletionError = null;

const duplicateFacebookIntent = await dispatch(router, "GET", "/api/marketplace/auth/facebook/start?intent=book&intent=book", undefined, { "user-agent": "Example Browser" });
assert(duplicateFacebookIntent.response.statusCode === 400 && duplicateFacebookIntent.body.code === "invalid-account-intent", "Facebook sign-in accepted an ambiguous duplicated account action.");
const facebookStart = await dispatch(router, "GET", "/api/marketplace/auth/facebook/start?intent=book", undefined, { "user-agent": "Example Browser" });
assert(facebookStart.response.statusCode === 302 && facebookStart.response.headers.Location.startsWith("https://www.facebook.com/") && facebookStart.response.headers["Set-Cookie"][0].includes("HttpOnly") && calls.some((call) => call.kind === "facebook-start" && call.intent === "book"), "Facebook account-first booking did not start through a non-cacheable server redirect and secure signed flow cookie.");
const facebookPending = await dispatch(router, "GET", "/api/marketplace/auth/facebook/callback?code=private-code&state=opaque", undefined, { cookie: "tideway_facebook_flow=signed", "user-agent": "Example Browser" });
assert(facebookPending.response.statusCode === 303 && facebookPending.response.headers.Location === "/login#social=facebook-verification-sent" && facebookPending.response.headers["Set-Cookie"][0].includes("Max-Age=0") && deliveries.at(-1).kind === "facebook-email-verification" && deliveries.at(-1).link.startsWith(`${origin}/verify-facebook#token=`) && deliveries.at(-1).link.endsWith("&intent=book") && !facebookPending.response.body.includes("owner@example.com"), "First Facebook callback did not require a private Homle mailbox-verification link or preserve its signed booking action.");
const invalidFacebookVerification = await dispatch(router, "POST", "/api/marketplace/auth/facebook/verification/confirm", { token: "bad" }, publicHeaders);
facebookVerifyResult = { verified: true, account: { userId: currentContext.actor.userId, email: "owner@example.com", emailVerifiedAt: "2026-07-16T12:05:00.000Z", displayName: "Property Owner", selectedRole: null, roles: [] } };
const validFacebookVerification = await dispatch(router, "POST", "/api/marketplace/auth/facebook/verification/confirm", { token: "good" }, publicHeaders);
assert(invalidFacebookVerification.response.statusCode === 400 && validFacebookVerification.response.statusCode === 200 && validFacebookVerification.body.csrfToken === "new-csrf-private" && validFacebookVerification.response.headers["Set-Cookie"].includes("HttpOnly"), "Facebook mailbox verification accepted an invalid token or failed to establish Homle's opaque session.");
facebookBeginResult = { authenticated: true, account: facebookVerifyResult.account };
const facebookRepeat = await dispatch(router, "GET", "/api/marketplace/auth/facebook/callback?code=repeat&state=opaque", undefined, { cookie: "tideway_facebook_flow=signed", "user-agent": "Example Browser" });
assert(facebookRepeat.response.statusCode === 303 && facebookRepeat.response.headers.Location.startsWith("/onboarding#social=facebook&csrfToken=") && facebookRepeat.response.headers.Location.endsWith("&intent=book") && facebookRepeat.response.headers["Set-Cookie"].length === 2, "A previously verified Facebook subject was forced through mailbox verification again, lost booking intent or did not receive a Homle session.");
facebookBeginResult = { authenticated: false, verificationRequired: false, reason: "staging-access-unavailable", emailDelivery: null };
const unapprovedFacebook = await dispatch(router, "GET", "/api/marketplace/auth/facebook/callback?code=unapproved&state=opaque", undefined, { cookie: "tideway_facebook_flow=signed" });
assert(unapprovedFacebook.response.headers.Location === "/login#social=staging-access-unavailable", "A verified but unapproved Facebook test account received a vague sign-in failure.");
facebookBeginResult = { authenticated: false, verificationRequired: false, reason: "facebook-email-unavailable", emailDelivery: null };
const facebookNoEmail = await dispatch(router, "GET", "/api/marketplace/auth/facebook/callback?code=no-email&state=opaque", undefined, { cookie: "tideway_facebook_flow=signed" });
assert(facebookNoEmail.response.headers.Location === "/login#social=facebook-email-unavailable", "Facebook missing-email handling created an account or lost its safe fallback.");
facebookCompletionError = new TypeError("private Facebook rejection");
const failedFacebookCallback = await dispatch(router, "GET", "/api/marketplace/auth/facebook/callback?code=bad&state=opaque", undefined, { cookie: "tideway_facebook_flow=signed" });
assert(failedFacebookCallback.response.statusCode === 303 && failedFacebookCallback.response.headers.Location === "/login#social=facebook-failed" && !failedFacebookCallback.response.headers.Location.includes("private Facebook rejection"), "Rejected Facebook callback leaked provider detail or retained flow state.");
facebookCompletionError = null;

const deletionWrongType = await dispatch(router, "POST", "/api/marketplace/auth/facebook/data-deletion", { signed_request: "signed.payload" }, publicHeaders);
const deletionCallback = await dispatch(router, "POST", "/api/marketplace/auth/facebook/data-deletion", "signed_request=signed.payload", { "content-type": "application/x-www-form-urlencoded" });
const deletionStatus = await dispatch(router, "GET", "/api/marketplace/auth/facebook/data-deletion/status", undefined, { "x-homle-deletion-code": "c".repeat(32) });
const missingDeletionStatus = await dispatch(router, "GET", "/api/marketplace/auth/facebook/data-deletion/status", undefined, { "x-homle-deletion-code": "x".repeat(32) });
assert(deletionWrongType.response.statusCode === 400 && deletionWrongType.body.code === "form-content-type-required", "Facebook deletion callback accepted an unsigned JSON/browser-style mutation.");
assert(deletionCallback.response.statusCode === 200 && deletionCallback.body.confirmation_code === "c".repeat(32) && deletionCallback.body.url === `${origin}/facebook-data-deletion#code=${"c".repeat(32)}` && !deletionCallback.body.ok && calls.some((call) => call.kind === "facebook-data-deletion" && call.signedRequest === "signed.payload"), "Facebook deletion callback did not return Meta's exact private confirmation contract.");
assert(deletionStatus.response.statusCode === 200 && deletionStatus.body.status === "processing" && deletionStatus.response.headers["Cache-Control"] === "no-store" && missingDeletionStatus.response.statusCode === 404, "Facebook deletion status leaked or failed to return the narrow no-store status projection.");

const providerList = await dispatch(router, "GET", "/api/marketplace/auth/provider-links", undefined, privateHeaders);
assert(providerList.response.statusCode === 200 && providerList.body.connected.length === 1 && providerList.body.connected[0].provider === "password" && providerList.body.available.google === true && providerList.body.available.facebook === true && providerList.body.available.apple === false && providerList.body.recentStepUp === null, "Authenticated settings did not return the narrow connected/available provider projection.");
const failedLinkStart = await dispatch(router, "POST", "/api/marketplace/auth/provider-links/google/start", { password: "wrong" }, privateHeaders);
assert(failedLinkStart.response.statusCode === 401 && failedLinkStart.body.code === "step-up-failed" && !failedLinkStart.response.headers["Set-Cookie"], "Provider connection began without current-password step-up.");
signInResult = { authenticated: true, account: { userId: currentContext.actor.userId, email: "owner@example.com", emailVerifiedAt: "2026-07-15T12:00:00.000Z", displayName: "Property Owner", selectedRole: null, roles: [] } };
const googleLinkStart = await dispatch(router, "POST", "/api/marketplace/auth/provider-links/google/start", { password: "correct" }, privateHeaders);
assert(googleLinkStart.response.statusCode === 200 && googleLinkStart.body.provider === "google" && googleLinkStart.body.location.startsWith("https://accounts.google.com/") && googleLinkStart.response.headers["Set-Cookie"].length === 3 && calls.some((call) => call.kind === "google-start" && call.purpose === "link") && calls.some((call) => call.kind === "provider-link-begin" && call.provider === "google"), "Password step-up did not create both signed Google and session-bound connection states or consume stale social step-up.");
const googleLinkCallback = await dispatch(router, "GET", "/api/marketplace/auth/google/callback?code=link&state=opaque", undefined, { cookie: "__Host-tideway_session=opaque; tideway_google_flow=signed; __Host-tideway_provider_link=google-signed" });
assert(googleLinkCallback.response.statusCode === 303 && googleLinkCallback.response.headers.Location === "/settings#provider=google-connected" && googleLinkCallback.response.headers["Set-Cookie"].length === 2 && calls.some((call) => call.kind === "connect-provider" && call.provider === "google") && !googleLinkCallback.response.headers.Location.includes("link"), "Google provider callback did not connect only to the authenticated session or clear both flow cookies.");
const socialSignInsBeforeMissingLinkState = calls.filter((call) => call.kind === "social-sign-in").length;
const missingLinkState = await dispatch(router, "GET", "/api/marketplace/auth/google/callback?code=link-without-binding&state=opaque", undefined, { cookie: "__Host-tideway_session=opaque; tideway_google_flow=signed" });
assert(missingLinkState.response.headers.Location === "/login#social=google-failed&reason=provider-failed" && calls.filter((call) => call.kind === "social-sign-in").length === socialSignInsBeforeMissingLinkState, "A signed provider-link callback without its session binding downgraded into ordinary social sign-in.");
const duplicateGoogleLink = await dispatch(router, "POST", "/api/marketplace/auth/provider-links/google/start", { password: "correct" }, privateHeaders);
assert(duplicateGoogleLink.response.statusCode === 409 && duplicateGoogleLink.body.code === "provider-already-connected", "An already-connected provider started a replacement flow.");
const facebookLinkStart = await dispatch(router, "POST", "/api/marketplace/auth/provider-links/facebook/start", { password: "correct" }, privateHeaders);
assert(facebookLinkStart.response.statusCode === 200 && facebookLinkStart.body.location.startsWith("https://www.facebook.com/") && calls.some((call) => call.kind === "facebook-start" && call.purpose === "link"), "Facebook connection did not preserve the authenticated link purpose.");
const facebookIdentityCallsBeforeLink = calls.filter((call) => call.kind === "facebook-identity-begin").length;
const facebookLinkCallback = await dispatch(router, "GET", "/api/marketplace/auth/facebook/callback?code=link&state=opaque", undefined, { cookie: "__Host-tideway_session=opaque; tideway_facebook_flow=signed; __Host-tideway_provider_link=facebook-signed" });
assert(facebookLinkCallback.response.headers.Location === "/settings#provider=facebook-connected" && calls.some((call) => call.kind === "connect-provider" && call.provider === "facebook") && calls.filter((call) => call.kind === "facebook-identity-begin").length === facebookIdentityCallsBeforeLink, "Authenticated Facebook connection incorrectly entered the untrusted pre-login mailbox-linking flow.");

connectedProviders.splice(0, connectedProviders.length, { provider: "google", connectedAt: "2026-07-16T12:00:00.000Z", lastUsedAt: null });
const lastMethodRemoval = await dispatch(router, "DELETE", "/api/marketplace/auth/provider-links/google", {}, privateHeaders);
assert(lastMethodRemoval.response.statusCode === 409 && lastMethodRemoval.body.code === "last-sign-in-method" && !calls.some((call) => call.kind === "disconnect-provider"), "A social-only account could remove its final sign-in method.");
const socialConnectWithoutStepUp = await dispatch(router, "POST", "/api/marketplace/auth/provider-links/facebook/start", {}, privateHeaders);
assert(socialConnectWithoutStepUp.response.statusCode === 401 && socialConnectWithoutStepUp.body.code === "provider-step-up-required", "A social-only account connected another provider without recent exact-provider verification.");
const googleStepUpStart = await dispatch(router, "POST", "/api/marketplace/auth/provider-links/google/step-up/start", {}, privateHeaders);
assert(googleStepUpStart.response.statusCode === 200 && googleStepUpStart.response.headers["Set-Cookie"].length === 2 && calls.some((call) => call.kind === "google-start" && call.purpose === "step-up") && calls.some((call) => call.kind === "provider-step-up-begin" && call.provider === "google"), "Social-only step-up did not bind the existing provider to the authenticated user and session.");
const googleStepUpCallback = await dispatch(router, "GET", "/api/marketplace/auth/google/callback?code=step-up&state=opaque", undefined, { cookie: "__Host-tideway_session=opaque; tideway_google_flow=signed; __Host-tideway_provider_step_up_flow=google-signed" });
assert(googleStepUpCallback.response.statusCode === 303 && googleStepUpCallback.response.headers.Location === "/settings#provider=google-verified" && googleStepUpCallback.response.headers["Set-Cookie"].length === 3 && calls.some((call) => call.kind === "provider-step-up" && call.provider === "google") && calls.some((call) => call.kind === "provider-step-up-complete"), "A matching social provider did not produce a short-lived authenticated step-up or failed to clear its flow state.");
const recentGoogleHeaders = { ...privateHeaders, cookie: `${privateHeaders.cookie}; __Host-tideway_provider_step_up_recent=google-signed` };
const socialFacebookLinkStart = await dispatch(router, "POST", "/api/marketplace/auth/provider-links/facebook/start", {}, recentGoogleHeaders);
assert(socialFacebookLinkStart.response.statusCode === 200 && socialFacebookLinkStart.response.headers["Set-Cookie"].length === 3 && calls.some((call) => call.kind === "facebook-start" && call.purpose === "link"), "A recently verified social-only account could not start a single-use second-provider connection.");
const socialFacebookLinkCallback = await dispatch(router, "GET", "/api/marketplace/auth/facebook/callback?code=social-link&state=opaque", undefined, { cookie: "__Host-tideway_session=opaque; tideway_facebook_flow=signed; __Host-tideway_provider_link=facebook-signed" });
assert(socialFacebookLinkCallback.response.headers.Location === "/settings#provider=facebook-connected" && connectedProviders.some((item) => item.provider === "facebook"), "Social-only second-provider connection did not complete against the authenticated account.");
const secondGoogleStepUpStart = await dispatch(router, "POST", "/api/marketplace/auth/provider-links/google/step-up/start", {}, privateHeaders);
const secondGoogleStepUpCallback = await dispatch(router, "GET", "/api/marketplace/auth/google/callback?code=step-up-2&state=opaque", undefined, { cookie: "__Host-tideway_session=opaque; tideway_google_flow=signed; __Host-tideway_provider_step_up_flow=google-signed" });
assert(secondGoogleStepUpStart.response.statusCode === 200 && secondGoogleStepUpCallback.response.headers.Location === "/settings#provider=google-verified", "A second deliberate provider step-up could not be established for removal.");
const removeVerifiedMethod = await dispatch(router, "DELETE", "/api/marketplace/auth/provider-links/google", {}, recentGoogleHeaders);
assert(removeVerifiedMethod.response.statusCode === 401 && removeVerifiedMethod.body.code === "provider-step-up-required", "A social-only account could remove the same method used for step-up instead of proving the remaining method works.");
const removeFacebook = await dispatch(router, "DELETE", "/api/marketplace/auth/provider-links/facebook", {}, recentGoogleHeaders);
assert(removeFacebook.response.statusCode === 200 && removeFacebook.body.disconnected && removeFacebook.body.revokedSessions === 2 && removeFacebook.response.headers["Set-Cookie"].length === 2 && calls.some((call) => call.kind === "disconnect-provider" && call.provider === "facebook") && calls.some((call) => call.kind === "logout-all"), "Lockout-safe provider removal did not require the remaining provider, revoke every session and clear browser security state.");
signInResult = { authenticated: false, reason: "invalid-credentials" };

const invalidSignupIntent = await dispatch(router, "POST", "/api/marketplace/auth/signup", { email: "new@example.com", displayName: "New User", password: "long password", intent: "https://attacker.example" }, publicHeaders);
assert(invalidSignupIntent.response.statusCode === 400 && invalidSignupIntent.body.code === "invalid-account-intent", "Email signup accepted an arbitrary post-verification destination.");
const signup = await dispatch(router, "POST", "/api/marketplace/auth/signup", { email: "new@example.com", displayName: "New User", password: "long password", intent: "book" }, publicHeaders);
const signupDelivery = deliveries.at(-1);
assert(signup.response.statusCode === 202 && signup.body.accepted && waits[0] === 500 && signupDelivery.recipient === "new@example.com" && signupDelivery.link.startsWith(`${origin}/verify-email#token=`) && signupDelivery.link.endsWith("&intent=book") && !signupDelivery.link.includes("?token=") && !signup.response.body.includes("verification-token-private"), "Account-first signup leaked delivery material, lost booking intent, omitted the generic timing boundary or put its token in a server URL query.");
const missingResend = await dispatch(router, "POST", "/api/marketplace/auth/verification/resend", { email: "missing@example.com" }, publicHeaders);
const knownResend = await dispatch(router, "POST", "/api/marketplace/auth/verification/resend", { email: "owner@example.com", intent: "book" }, publicHeaders);
assert(missingResend.response.statusCode === 202 && knownResend.response.statusCode === 202 && missingResend.response.body === knownResend.response.body && deliveries.at(-1).link.includes("resent-token-private") && deliveries.at(-1).link.endsWith("&intent=book") && !knownResend.response.body.includes("owner@example.com"), "Verification resend exposed account existence or raw recipient/token material, or lost the fixed booking action.");

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

const pendingAccount = await dispatch(router, "GET", "/api/marketplace/account", undefined, { cookie: privateHeaders.cookie });
const accountMutation = await dispatch(router, "POST", "/api/marketplace/account", {}, privateHeaders);
const anonymousAccount = await dispatch(router, "GET", "/api/marketplace/account");
assert(pendingAccount.response.statusCode === 200 && pendingAccount.body.workspaceReady === false && pendingAccount.body.account.displayName === "Property Owner" && pendingAccount.body.account.roles.length === 0 && !Object.hasOwn(pendingAccount.body.account, "userId") && accountMutation.response.statusCode === 405 && anonymousAccount.response.statusCode === 401, "Authentication-only account status was unavailable, writable, unauthenticated or exposed a private account identifier.");

const recoveredOnboardingSession = await dispatch(router, "POST", "/api/marketplace/auth/onboarding-session", {}, { origin, "content-type": "application/json", cookie: privateHeaders.cookie, "user-agent": "Example Browser" });
const rejectedCrossOriginRecovery = await dispatch(router, "POST", "/api/marketplace/auth/onboarding-session", {}, { origin: "https://attacker.example", "content-type": "application/json", cookie: privateHeaders.cookie });
assert(recoveredOnboardingSession.response.statusCode === 200 && recoveredOnboardingSession.body.csrfToken === "rotated-csrf-private" && recoveredOnboardingSession.response.headers["Set-Cookie"].includes("rotated") && calls.at(-1).kind === "rotate" && rejectedCrossOriginRecovery.response.statusCode === 403, "A role-pending account could not recover its one-time setup token after refresh or a cross-origin page could rotate it.");

const onboarding = await dispatch(router, "POST", "/api/marketplace/onboarding", { role: "landlord" }, privateHeaders);
assert(onboarding.response.statusCode === 200 && onboarding.body.account.selectedRole === "landlord" && onboarding.body.csrfToken === "rotated-csrf-private" && onboarding.response.headers["Set-Cookie"].includes("rotated") && calls.at(-1).kind === "rotate" && calls.at(-1).account.email === "owner@example.com", "Role onboarding did not rotate the role-pending session with the existing account identity.");
currentContext = { ...currentContext, actor: { ...currentContext.actor, roles: ["landlord"] }, account: { ...currentContext.account, selectedRole: "landlord" } };
const readyAccount = await dispatch(router, "GET", "/api/marketplace/account", undefined, { cookie: privateHeaders.cookie });
assert(readyAccount.body.account.selectedRole === "landlord" && readyAccount.body.account.roles.join(",") === "landlord" && readyAccount.body.workspaceReady === false, "Role onboarding could not be verified through the authentication-only account projection.");
const completedRecovery = await dispatch(router, "POST", "/api/marketplace/auth/onboarding-session", {}, { origin, "content-type": "application/json", cookie: privateHeaders.cookie });
const repeatedOnboarding = await dispatch(router, "POST", "/api/marketplace/onboarding", { role: "cleaner" }, privateHeaders);
assert(completedRecovery.response.statusCode === 409 && completedRecovery.body.code === "onboarding-complete" && repeatedOnboarding.response.statusCode === 409 && repeatedOnboarding.body.code === "onboarding-complete", "Completed onboarding could recover another setup token or be used for a self-service role change.");
const recoveredWorkspaceSession = await dispatch(router, "POST", "/api/marketplace/auth/session", {}, { origin, "content-type": "application/json", cookie: privateHeaders.cookie, "user-agent": "Example Browser" });
const addedCleanerWorkspace = await dispatch(router, "POST", "/api/marketplace/auth/workspace", { role: "cleaner" }, privateHeaders);
assert(recoveredWorkspaceSession.response.statusCode === 200 && recoveredWorkspaceSession.body.csrfToken === "rotated-csrf-private" && addedCleanerWorkspace.response.statusCode === 200 && addedCleanerWorkspace.body.workspaceAdded && addedCleanerWorkspace.body.account.selectedRole === "cleaner" && addedCleanerWorkspace.body.account.roles.join(",") === "cleaner,landlord" && addedCleanerWorkspace.response.headers["Set-Cookie"].includes("rotated") && calls.some((call) => call.kind === "workspace" && call.role === "cleaner"), "A completed account could not recover a tab-local CSRF token or explicitly add and enter its second workspace.");
const crossOriginWorkspaceSession = await dispatch(router, "POST", "/api/marketplace/auth/session", {}, { origin: "https://attacker.example", "content-type": "application/json", cookie: privateHeaders.cookie });
assert(crossOriginWorkspaceSession.response.statusCode === 403, "A cross-origin page could rotate a completed Homle session.");

rateLimitedScope = "login";
const rateLimited = await dispatch(router, "POST", "/api/marketplace/auth/login", { email: "owner@example.com", password: "correct" }, publicHeaders);
assert(rateLimited.response.statusCode === 429 && rateLimited.body.code === "rate-limited" && rateLimited.response.headers["Retry-After"] === "90", "Authentication abuse control did not fail closed with a bounded retry time.");
rateLimitedScope = "";

emailDelivery.send = async () => { throw new Error("private SMTP detail"); };
const deliveryFailure = await dispatch(router, "POST", "/api/marketplace/auth/password-reset/request", { email: "owner@example.com" }, publicHeaders);
assert(deliveryFailure.response.statusCode === 500 && deliveryFailure.body.error === "Something went wrong. Please try again." && !deliveryFailure.response.body.includes("SMTP") && unexpectedError?.message === "private SMTP detail", "Delivery failure leaked private provider details or bypassed private monitoring.");

const googleOnlyRouter = createAuthenticationHttpRouter({
  security,
  credentialService,
  identityService,
  providerLinkState,
  accountSessionService,
  rateLimiter,
  googleOidcProvider
}, {
  appOrigin: origin,
  clientKey: () => "198.51.100.10",
  minimumPublicResponseMs: 0,
  now: () => nowValue,
  async wait() {},
  onUnexpectedError(error) { unexpectedError = error; }
});
const googleOnlyStart = await dispatch(googleOnlyRouter, "GET", "/api/marketplace/auth/google/start?intent=book", undefined, { "user-agent": "Example Browser" });
const unavailableEmailLogin = await dispatch(googleOnlyRouter, "POST", "/api/marketplace/auth/login", { email: "owner@example.com", password: "secret" }, publicHeaders);
const unavailableEmailSignup = await dispatch(googleOnlyRouter, "POST", "/api/marketplace/auth/signup", { email: "owner@example.com", password: "secret", displayName: "Owner" }, publicHeaders);
assert(googleOnlyStart.response.statusCode === 302 && googleOnlyStart.response.headers.Location.startsWith("https://accounts.google.com/"), "Google-only authentication could not start its configured provider.");
assert(unavailableEmailLogin.response.statusCode === 404 && unavailableEmailLogin.body.code === "not-found" && unavailableEmailSignup.response.statusCode === 404, "Google-only authentication exposed email/password routes without a verified delivery provider.");

console.log("Authentication HTTP tests passed: generic credential lifecycle, social sign-in, password or exact-provider step-up, lockout-safe connection/removal, session revocation, onboarding, limiting and sanitized failures.");
