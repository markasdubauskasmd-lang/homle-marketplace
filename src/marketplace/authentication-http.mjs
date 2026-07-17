import { errorResponse, methodNotAllowed, readJsonObject, readRawBody, sendJson } from "./http-support.mjs";
import { createRateLimitBoundary } from "./rate-limit-boundary.mjs";

const prefix = "/api/marketplace/auth/";
const genericAccepted = Object.freeze({ ok: true, accepted: true, message: "If the account can use this action, the next step will be sent privately." });

function exactOrigin(value) {
  try {
    const url = new URL(value);
    if (url.origin !== String(value).replace(/\/$/, "") || url.username || url.password) throw new Error();
    return url.origin;
  } catch {
    throw new TypeError("Authentication routes require an exact application origin.");
  }
}

function header(request, name) {
  const supplied = request?.headers?.[name.toLowerCase()];
  return Array.isArray(supplied) ? supplied[0] : String(supplied || "");
}

async function facebookSignedRequest(request) {
  if (!/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(header(request, "content-type"))) {
    throw Object.assign(new SyntaxError("Send a form-encoded Facebook deletion request."), { code: "form-content-type-required" });
  }
  const body = (await readRawBody(request, 12 * 1024)).toString("utf8");
  const form = new URLSearchParams(body);
  const values = form.getAll("signed_request");
  if (values.length !== 1 || !values[0] || values[0].length > 8192) throw Object.assign(new SyntaxError("Facebook supplied an invalid deletion request."), { code: "invalid-facebook-deletion-request" });
  return values[0];
}

function accountIntent(value) {
  if (value === undefined) return "";
  if (value !== "book") throw Object.assign(new Error("Choose a supported account action."), { statusCode: 400, code: "invalid-account-intent" });
  return "book";
}

function signInIntent(url) {
  const values = url.searchParams.getAll("intent");
  if (!values.length) return "";
  if (values.length !== 1) throw Object.assign(new Error("Choose a supported account action."), { statusCode: 400, code: "invalid-account-intent" });
  return accountIntent(values[0]);
}

function deliveryLink(origin, delivery, intent = "") {
  const path = delivery.kind === "email-verification" ? "/verify-email" : delivery.kind === "facebook-email-verification" ? "/verify-facebook" : delivery.kind === "password-reset" ? "/reset-password" : "";
  if (!path) throw new TypeError("A supported authentication delivery is required.");
  const link = new URL(path, origin);
  link.hash = new URLSearchParams({ token: delivery.token, ...(intent === "book" ? { intent } : {}) }).toString();
  return link.toString();
}

function accountFromOnboarding(context, result) {
  return {
    userId: context.actor.userId,
    email: context.account.email,
    emailVerifiedAt: context.account.emailVerifiedAt,
    displayName: context.account.displayName,
    selectedRole: result.selected_role ?? result.selectedRole,
    roles: Array.isArray(result.roles) ? result.roles : []
  };
}

function sendRedirect(response, statusCode, location, cookies = []) {
  const headers = {
    Location: location,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer"
  };
  if (cookies.length) headers["Set-Cookie"] = cookies;
  response.writeHead(statusCode, headers);
  response.end();
}

export function createAuthenticationHttpRouter(dependencies, options = {}) {
  const security = dependencies?.security;
  const credentials = dependencies?.credentialService;
  const identity = dependencies?.identityService;
  const sessions = dependencies?.accountSessionService;
  const emailDelivery = dependencies?.emailDelivery;
  const rateLimiter = dependencies?.rateLimiter;
  const google = dependencies?.googleOidcProvider || null;
  const facebook = dependencies?.facebookLoginProvider || null;
  const facebookIdentity = dependencies?.facebookIdentityService || null;
  const facebookDataDeletion = dependencies?.facebookDataDeletionService || null;
  const providerLink = dependencies?.providerLinkState || null;
  if (!security || typeof security.protect !== "function" || typeof security.requireOrigin !== "function") throw new TypeError("Authentication HTTP routes require account security.");
  if (!credentials || ["register", "requestEmailVerification", "verifyEmail", "signIn", "requestPasswordReset", "resetPassword"].some((method) => typeof credentials[method] !== "function")) throw new TypeError("Authentication HTTP routes require the credential service.");
  if (!identity || ["completeOnboarding", "connectedProviders", "connectProvider", "verifyProviderStepUp", "disconnectProvider"].some((method) => typeof identity[method] !== "function") || (google && typeof identity.socialSignIn !== "function")) throw new TypeError("Authentication HTTP routes require the identity service.");
  if (facebook && (!facebookIdentity || typeof facebookIdentity.begin !== "function" || typeof facebookIdentity.verify !== "function")) throw new TypeError("Facebook authentication routes require the pending identity service.");
  if (facebook && (!facebookDataDeletion || typeof facebookDataDeletion.request !== "function" || typeof facebookDataDeletion.status !== "function")) throw new TypeError("Facebook authentication routes require the signed data-deletion service.");
  if (!sessions || ["establish", "rotate", "logout", "logoutAll"].some((method) => typeof sessions[method] !== "function")) throw new TypeError("Authentication HTTP routes require the session service.");
  const emailReady = Boolean(emailDelivery && typeof emailDelivery.send === "function");
  const appOrigin = exactOrigin(options.appOrigin);
  const minimumPublicResponseMs = options.minimumPublicResponseMs ?? 500;
  if (!Number.isInteger(minimumPublicResponseMs) || minimumPublicResponseMs < 0 || minimumPublicResponseMs > 5000) throw new RangeError("Public authentication response delay is outside the supported range.");
  const now = options.now || (() => Date.now());
  const wait = options.wait || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const onUnexpectedError = typeof options.onUnexpectedError === "function" ? options.onUnexpectedError : () => {};
  const limit = createRateLimitBoundary(rateLimiter, options.clientKey, { onUnexpectedError });
  if (google && (google.name !== "google" || typeof google.begin !== "function" || typeof google.complete !== "function" || typeof google.clearCookie !== "string")) throw new TypeError("Google authentication routes require a complete OIDC provider.");
  if (facebook && (facebook.name !== "facebook" || typeof facebook.begin !== "function" || typeof facebook.complete !== "function" || typeof facebook.clearCookie !== "string")) throw new TypeError("Facebook authentication routes require a complete provider verifier.");
  if (!providerLink || ["begin", "verify", "has", "beginStepUp", "verifyStepUp", "completeStepUp", "verifyRecentStepUp", "hasStepUpFlow"].some((method) => typeof providerLink[method] !== "function") || ["clearCookie", "clearStepUpFlowCookie", "clearRecentStepUpCookie"].some((field) => typeof providerLink[field] !== "string")) throw new TypeError("Authentication HTTP routes require provider connection state.");

  async function privateDelivery(delivery, intent = "") {
    if (!delivery) return;
    if (!emailReady) throw new TypeError("Email delivery is not available for this authentication stage.");
    await emailDelivery.send({ kind: delivery.kind, recipient: delivery.recipient, link: deliveryLink(appOrigin, delivery, intent), expiresAt: delivery.expiresAt });
  }

  async function publicTiming(startedAt) {
    const remaining = minimumPublicResponseMs - Math.max(0, now() - startedAt);
    if (remaining > 0) await wait(remaining);
  }

  function metadata(request) {
    return { userAgent: header(request, "user-agent"), ipAddress: limit.clientKey(request) };
  }

  function providerAdapter(name) {
    return name === "google" ? google : name === "facebook" ? facebook : null;
  }

  async function completeProviderConnection(request, response, provider, claims, adapter) {
    const context = await security.authenticate(request);
    providerLink.verify(header(request, "cookie"), context, provider);
    await identity.connectProvider(context.actor, provider, claims);
    sendRedirect(response, 303, `/settings#provider=${provider}-connected`, [adapter.clearCookie, providerLink.clearCookie]);
  }

  async function completeProviderStepUp(request, response, provider, claims, adapter) {
    const context = await security.authenticate(request);
    providerLink.verifyStepUp(header(request, "cookie"), context, provider);
    if (await identity.verifyProviderStepUp(context.actor, provider, claims) !== true) throw new TypeError("The provider security check did not match this account.");
    sendRedirect(response, 303, `/settings#provider=${provider}-verified`, [adapter.clearCookie, providerLink.clearStepUpFlowCookie, providerLink.completeStepUp(context, provider)]);
  }

  function recentStepUp(request, context) {
    try { return providerLink.verifyRecentStepUp(header(request, "cookie"), context); } catch { return null; }
  }

  return {
    async handle(request, response, suppliedUrl) {
      const url = suppliedUrl instanceof URL ? suppliedUrl : new URL(request.url || "/", "http://localhost");
      if (!url.pathname.startsWith(prefix) && url.pathname !== "/api/marketplace/onboarding") return false;
      const startedAt = now();
      try {
        if (url.pathname === `${prefix}provider-links`) {
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          const context = await security.protect(request);
          const connected = await identity.connectedProviders(context.actor);
          const verified = recentStepUp(request, context);
          sendJson(response, 200, { ok: true, connected, available: { google: Boolean(google), facebook: Boolean(facebook), apple: false }, recentStepUp: verified ? { provider: verified.provider } : null });
          return true;
        }
        const stepUpStartMatch = url.pathname.match(new RegExp(`^${prefix}provider-links/(google|facebook)/step-up/start$`));
        if (stepUpStartMatch) {
          const selectedProvider = stepUpStartMatch[1];
          const adapter = providerAdapter(selectedProvider);
          if (!adapter) return sendJson(response, 404, { ok: false, code: "not-found", error: "Authentication route not found." }), true;
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const context = await security.protect(request, { mutation: true });
          await limit(request, "login");
          await limit(request, `${selectedProvider}-start`);
          const connected = await identity.connectedProviders(context.actor);
          if (!connected.some((item) => item.provider === selectedProvider)) {
            sendJson(response, 409, { ok: false, code: "provider-not-connected", error: "That sign-in method is not connected to this account." });
            return true;
          }
          const attempt = adapter.begin({ purpose: "step-up" });
          sendJson(response, 200, { ok: true, provider: selectedProvider, location: attempt.location }, { "Set-Cookie": [attempt.setCookie, providerLink.beginStepUp(context, selectedProvider)] });
          return true;
        }
        const linkStartMatch = url.pathname.match(new RegExp(`^${prefix}provider-links/(google|facebook)/start$`));
        if (linkStartMatch) {
          const selectedProvider = linkStartMatch[1];
          const adapter = providerAdapter(selectedProvider);
          if (!adapter) return sendJson(response, 404, { ok: false, code: "not-found", error: "Authentication route not found." }), true;
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          const context = await security.protect(request, { mutation: true });
          await limit(request, "login");
          await limit(request, `${selectedProvider}-start`);
          const connected = await identity.connectedProviders(context.actor);
          if (connected.some((item) => item.provider === selectedProvider)) {
            sendJson(response, 409, { ok: false, code: "provider-already-connected", error: `${selectedProvider === "google" ? "Google" : "Facebook"} is already connected to this account.` });
            return true;
          }
          const hasPassword = connected.some((item) => item.provider === "password");
          if (hasPassword) {
            const passwordStepUp = await credentials.signIn(context.account.email, (await readJsonObject(request)).password);
            const sameAccount = passwordStepUp.authenticated === true && passwordStepUp.account?.userId === context.actor.userId;
            if (!sameAccount) {
              const locked = passwordStepUp.reason === "temporarily-locked";
              sendJson(response, locked ? 429 : 401, { ok: false, code: locked ? "temporarily-locked" : "step-up-failed", error: locked ? "Sign in is temporarily locked. Try again later." : "Your current password is required before connecting another sign-in method." });
              return true;
            }
          } else {
            const verified = recentStepUp(request, context);
            if (!verified || !connected.some((item) => item.provider === verified.provider)) {
              sendJson(response, 401, { ok: false, code: "provider-step-up-required", error: "Verify one of your current sign-in methods before connecting another." });
              return true;
            }
          }
          const attempt = adapter.begin({ purpose: "link" });
          sendJson(response, 200, { ok: true, provider: selectedProvider, location: attempt.location }, { "Set-Cookie": [attempt.setCookie, providerLink.begin(context, selectedProvider), providerLink.clearRecentStepUpCookie] });
          return true;
        }
        const disconnectMatch = url.pathname.match(new RegExp(`^${prefix}provider-links/(google|facebook)$`));
        if (disconnectMatch) {
          const selectedProvider = disconnectMatch[1];
          if (request.method !== "DELETE") return methodNotAllowed(response, ["DELETE"]), true;
          const context = await security.protect(request, { mutation: true });
          await limit(request, "login");
          const connected = await identity.connectedProviders(context.actor);
          if (!connected.some((item) => item.provider === selectedProvider)) {
            sendJson(response, 409, { ok: false, code: "provider-not-connected", error: "That sign-in method is not connected to this account." });
            return true;
          }
          if (connected.length <= 1) {
            sendJson(response, 409, { ok: false, code: "last-sign-in-method", error: "Connect another sign-in method before removing this one." });
            return true;
          }
          const hasPassword = connected.some((item) => item.provider === "password");
          if (hasPassword) {
            const passwordStepUp = await credentials.signIn(context.account.email, (await readJsonObject(request)).password);
            const sameAccount = passwordStepUp.authenticated === true && passwordStepUp.account?.userId === context.actor.userId;
            if (!sameAccount) {
              const locked = passwordStepUp.reason === "temporarily-locked";
              sendJson(response, locked ? 429 : 401, { ok: false, code: locked ? "temporarily-locked" : "step-up-failed", error: locked ? "Sign in is temporarily locked. Try again later." : "Your current password is required before removing a sign-in method." });
              return true;
            }
          } else {
            const verified = recentStepUp(request, context);
            if (!verified || verified.provider === selectedProvider || !connected.some((item) => item.provider === verified.provider)) {
              sendJson(response, 401, { ok: false, code: "provider-step-up-required", error: "Verify the sign-in method you will keep before removing this one." });
              return true;
            }
          }
          const result = await identity.disconnectProvider(context.actor, selectedProvider);
          if (!result.disconnected) {
            const last = result.reason === "last-sign-in-method";
            sendJson(response, 409, { ok: false, code: last ? "last-sign-in-method" : "provider-not-connected", error: last ? "Connect another sign-in method before removing this one." : "That sign-in method is not connected to this account." });
            return true;
          }
          const logout = await sessions.logoutAll(context);
          sendJson(response, 200, { ok: true, disconnected: true, provider: selectedProvider, revokedSessions: result.revokedSessions }, { "Set-Cookie": [logout.setCookie, providerLink.clearRecentStepUpCookie] });
          return true;
        }
        if (url.pathname === `${prefix}google/start`) {
          if (!google) return sendJson(response, 404, { ok: false, code: "not-found", error: "Authentication route not found." }), true;
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          await limit(request, "google-start");
          const attempt = google.begin({ intent: signInIntent(url) });
          sendRedirect(response, 302, attempt.location, [attempt.setCookie]);
          return true;
        }
        if (url.pathname === `${prefix}google/callback`) {
          if (!google) return sendJson(response, 404, { ok: false, code: "not-found", error: "Authentication route not found." }), true;
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          try {
            await limit(request, "google-callback");
            const claims = await google.complete(url, header(request, "cookie"));
            if ((claims.flowPurpose ?? "sign-in") === "step-up") {
              await completeProviderStepUp(request, response, "google", claims, google);
              return true;
            }
            if ((claims.flowPurpose ?? "sign-in") === "link") {
              await completeProviderConnection(request, response, "google", claims, google);
              return true;
            }
            if ((claims.flowPurpose ?? "sign-in") !== "sign-in") throw new TypeError("Google returned an invalid flow purpose.");
            const account = await identity.socialSignIn("google", claims);
            const session = await sessions.establish(account, metadata(request));
            const destination = session.account.roles.length ? "/login" : "/onboarding";
            const fragment = new URLSearchParams({ social: "google", csrfToken: session.csrfToken, ...(claims.flowIntent === "book" ? { intent: "book" } : {}) });
            sendRedirect(response, 303, `${destination}#${fragment}`, [google.clearCookie, session.setCookie]);
          } catch (error) {
            const rateLimited = error?.statusCode === 429;
            if (!rateLimited && !(error instanceof TypeError)) onUnexpectedError(error);
            const linking = providerLink.has(header(request, "cookie"));
            const steppingUp = providerLink.hasStepUpFlow(header(request, "cookie"));
            const accountFlow = linking || steppingUp;
            const fragment = new URLSearchParams({ [accountFlow ? "provider" : "social"]: rateLimited ? "rate-limited" : "google-failed" });
            sendRedirect(response, 303, `${accountFlow ? "/settings" : "/login"}#${fragment}`, [google.clearCookie, ...(linking ? [providerLink.clearCookie] : []), ...(steppingUp ? [providerLink.clearStepUpFlowCookie] : [])]);
          }
          return true;
        }
        if (url.pathname === `${prefix}facebook/start`) {
          if (!facebook) return sendJson(response, 404, { ok: false, code: "not-found", error: "Authentication route not found." }), true;
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          await limit(request, "facebook-start");
          const attempt = facebook.begin({ intent: signInIntent(url) });
          sendRedirect(response, 302, attempt.location, [attempt.setCookie]);
          return true;
        }
        if (url.pathname === `${prefix}facebook/callback`) {
          if (!facebook) return sendJson(response, 404, { ok: false, code: "not-found", error: "Authentication route not found." }), true;
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          try {
            await limit(request, "facebook-callback");
            const claims = await facebook.complete(url, header(request, "cookie"));
            if ((claims.flowPurpose ?? "sign-in") === "step-up") {
              await completeProviderStepUp(request, response, "facebook", claims, facebook);
              return true;
            }
            if ((claims.flowPurpose ?? "sign-in") === "link") {
              await completeProviderConnection(request, response, "facebook", claims, facebook);
              return true;
            }
            if ((claims.flowPurpose ?? "sign-in") !== "sign-in") throw new TypeError("Facebook returned an invalid flow purpose.");
            const result = await facebookIdentity.begin(claims);
            if (result.authenticated) {
              const session = await sessions.establish(result.account, metadata(request));
              const destination = session.account.roles.length ? "/login" : "/onboarding";
              const fragment = new URLSearchParams({ social: "facebook", csrfToken: session.csrfToken, ...(claims.flowIntent === "book" ? { intent: "book" } : {}) });
              sendRedirect(response, 303, `${destination}#${fragment}`, [facebook.clearCookie, session.setCookie]);
            } else if (result.verificationRequired) {
              await privateDelivery(result.emailDelivery, claims.flowIntent);
              sendRedirect(response, 303, "/login#social=facebook-verification-sent", [facebook.clearCookie]);
            } else {
              sendRedirect(response, 303, "/login#social=facebook-email-unavailable", [facebook.clearCookie]);
            }
          } catch (error) {
            const rateLimited = error?.statusCode === 429;
            if (!rateLimited && !(error instanceof TypeError)) onUnexpectedError(error);
            const linking = providerLink.has(header(request, "cookie"));
            const steppingUp = providerLink.hasStepUpFlow(header(request, "cookie"));
            const accountFlow = linking || steppingUp;
            const fragment = new URLSearchParams({ [accountFlow ? "provider" : "social"]: rateLimited ? "rate-limited" : "facebook-failed" });
            sendRedirect(response, 303, `${accountFlow ? "/settings" : "/login"}#${fragment}`, [facebook.clearCookie, ...(linking ? [providerLink.clearCookie] : []), ...(steppingUp ? [providerLink.clearStepUpFlowCookie] : [])]);
          }
          return true;
        }
        if (url.pathname === `${prefix}facebook/data-deletion`) {
          if (!facebook || !facebookDataDeletion) return sendJson(response, 404, { ok: false, code: "not-found", error: "Authentication route not found." }), true;
          if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
          await limit(request, "facebook-data-deletion");
          const result = await facebookDataDeletion.request(await facebookSignedRequest(request));
          sendJson(response, 200, { url: result.statusUrl, confirmation_code: result.confirmationCode });
          return true;
        }
        if (url.pathname === `${prefix}facebook/data-deletion/status`) {
          if (!facebook || !facebookDataDeletion) return sendJson(response, 404, { ok: false, code: "not-found", error: "Authentication route not found." }), true;
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          await limit(request, "facebook-data-deletion-status");
          const result = await facebookDataDeletion.status(header(request, "x-homle-deletion-code"));
          if (!result) return sendJson(response, 404, { ok: false, code: "deletion-request-not-found", error: "This deletion request is unavailable." }), true;
          sendJson(response, 200, { ok: true, status: result.status, requestedAt: result.requestedAt, completedAt: result.completedAt });
          return true;
        }
        const emailOnlyRoute = new Set([
          `${prefix}signup`, `${prefix}verification/resend`, `${prefix}verification/confirm`,
          `${prefix}login`, `${prefix}password-reset/request`, `${prefix}password-reset/confirm`
        ]).has(url.pathname);
        if (emailOnlyRoute && !emailReady) return sendJson(response, 404, { ok: false, code: "not-found", error: "Authentication route not found." }), true;
        if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
        security.requireOrigin(request);
        if (url.pathname === `${prefix}signup`) {
          await limit(request, "signup");
          const body = await readJsonObject(request);
          const intent = accountIntent(body.intent);
          const result = await credentials.register({ email: body.email, displayName: body.displayName, password: body.password });
          await privateDelivery(result.emailDelivery, intent);
          await publicTiming(startedAt);
          sendJson(response, 202, genericAccepted);
          return true;
        }
        if (url.pathname === `${prefix}verification/resend`) {
          await limit(request, "verification-resend");
          const body = await readJsonObject(request);
          const intent = accountIntent(body.intent);
          const result = await credentials.requestEmailVerification(body.email);
          await privateDelivery(result.emailDelivery, intent);
          await publicTiming(startedAt);
          sendJson(response, 202, genericAccepted);
          return true;
        }
        if (url.pathname === `${prefix}verification/confirm`) {
          await limit(request, "verification-confirm");
          const result = await credentials.verifyEmail((await readJsonObject(request)).token);
          if (!result.verified) {
            sendJson(response, 400, { ok: false, code: "verification-invalid", error: "This verification link is invalid or expired." });
            return true;
          }
          sendJson(response, 200, { ok: true, verified: true });
          return true;
        }
        if (url.pathname === `${prefix}facebook/verification/confirm`) {
          if (!facebook) return sendJson(response, 404, { ok: false, code: "not-found", error: "Authentication route not found." }), true;
          await limit(request, "facebook-verification-confirm");
          const result = await facebookIdentity.verify((await readJsonObject(request)).token);
          if (!result.verified) {
            const collision = result.reason === "existing-account-requires-sign-in";
            sendJson(response, collision ? 409 : 400, { ok: false, code: collision ? "existing-account-requires-sign-in" : "verification-invalid", error: collision ? "This email already belongs to an account that must sign in before Facebook can be connected." : "This verification link is invalid or expired." });
            return true;
          }
          const session = await sessions.establish(result.account, metadata(request));
          sendJson(response, 200, { ok: true, account: session.account, csrfToken: session.csrfToken, expiresAt: session.expiresAt }, { "Set-Cookie": session.setCookie });
          return true;
        }
        if (url.pathname === `${prefix}login`) {
          await limit(request, "login");
          const body = await readJsonObject(request);
          const result = await credentials.signIn(body.email, body.password);
          if (!result.authenticated) {
            const locked = result.reason === "temporarily-locked";
            const verification = result.reason === "email-verification-required";
            sendJson(response, locked ? 429 : verification ? 403 : 401, { ok: false, code: locked ? "temporarily-locked" : verification ? "email-verification-required" : "invalid-credentials", error: locked ? "Sign in is temporarily locked. Try again later." : verification ? "Verify your email before signing in." : "Email or password is incorrect." });
            return true;
          }
          const session = await sessions.establish(result.account, metadata(request));
          sendJson(response, 200, { ok: true, account: session.account, csrfToken: session.csrfToken, expiresAt: session.expiresAt }, { "Set-Cookie": session.setCookie });
          return true;
        }
        if (url.pathname === `${prefix}password-reset/request`) {
          await limit(request, "password-reset-request");
          const result = await credentials.requestPasswordReset((await readJsonObject(request)).email);
          await privateDelivery(result.emailDelivery);
          await publicTiming(startedAt);
          sendJson(response, 202, genericAccepted);
          return true;
        }
        if (url.pathname === `${prefix}password-reset/confirm`) {
          await limit(request, "password-reset-confirm");
          const body = await readJsonObject(request);
          const result = await credentials.resetPassword(body.token, body.password);
          if (!result.changed) {
            sendJson(response, 400, { ok: false, code: "reset-invalid", error: "This password-reset link is invalid or expired." });
            return true;
          }
          sendJson(response, 200, { ok: true, changed: true, sessionsRevoked: result.sessionsRevoked });
          return true;
        }
        if (url.pathname === `${prefix}logout` || url.pathname === `${prefix}logout-all`) {
          const context = await security.protect(request, { mutation: true });
          const result = url.pathname.endsWith("logout-all") ? await sessions.logoutAll(context) : await sessions.logout(context);
          sendJson(response, 200, { ok: true, ...(Object.hasOwn(result, "revokedSessions") ? { revokedSessions: result.revokedSessions } : {}) }, { "Set-Cookie": result.setCookie });
          return true;
        }
        if (url.pathname === "/api/marketplace/onboarding") {
          const context = await security.protect(request, { mutation: true });
          if (context.actor.roles.length) throw Object.assign(new Error("This account has already completed onboarding."), { statusCode: 409, code: "onboarding-complete" });
          const result = await identity.completeOnboarding(context.actor, (await readJsonObject(request)).role);
          const session = await sessions.rotate(context, accountFromOnboarding(context, result), metadata(request));
          sendJson(response, 200, { ok: true, account: session.account, csrfToken: session.csrfToken, expiresAt: session.expiresAt }, { "Set-Cookie": session.setCookie });
          return true;
        }
        sendJson(response, 404, { ok: false, code: "not-found", error: "Authentication route not found." });
        return true;
      } catch (error) {
        const mapped = errorResponse(error);
        if (mapped.statusCode === 500) onUnexpectedError(error);
        const headers = error?.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : {};
        sendJson(response, mapped.statusCode, { ok: false, code: mapped.code, error: mapped.message }, headers);
        return true;
      }
    }
  };
}
