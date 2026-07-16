import { errorResponse, methodNotAllowed, readJsonObject, sendJson } from "./http-support.mjs";
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

function deliveryLink(origin, delivery) {
  const path = delivery.kind === "email-verification" ? "/verify-email" : delivery.kind === "facebook-email-verification" ? "/verify-facebook" : delivery.kind === "password-reset" ? "/reset-password" : "";
  if (!path) throw new TypeError("A supported authentication delivery is required.");
  const link = new URL(path, origin);
  link.hash = new URLSearchParams({ token: delivery.token }).toString();
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
  if (!security || typeof security.protect !== "function" || typeof security.requireOrigin !== "function") throw new TypeError("Authentication HTTP routes require account security.");
  if (!credentials || ["register", "requestEmailVerification", "verifyEmail", "signIn", "requestPasswordReset", "resetPassword"].some((method) => typeof credentials[method] !== "function")) throw new TypeError("Authentication HTTP routes require the credential service.");
  if (!identity || typeof identity.completeOnboarding !== "function" || (google && typeof identity.socialSignIn !== "function")) throw new TypeError("Authentication HTTP routes require the identity service.");
  if (facebook && (!facebookIdentity || typeof facebookIdentity.begin !== "function" || typeof facebookIdentity.verify !== "function")) throw new TypeError("Facebook authentication routes require the pending identity service.");
  if (!sessions || ["establish", "rotate", "logout", "logoutAll"].some((method) => typeof sessions[method] !== "function")) throw new TypeError("Authentication HTTP routes require the session service.");
  if (!emailDelivery || typeof emailDelivery.send !== "function") throw new TypeError("Authentication HTTP routes require a trusted email-delivery adapter.");
  const appOrigin = exactOrigin(options.appOrigin);
  const minimumPublicResponseMs = options.minimumPublicResponseMs ?? 500;
  if (!Number.isInteger(minimumPublicResponseMs) || minimumPublicResponseMs < 0 || minimumPublicResponseMs > 5000) throw new RangeError("Public authentication response delay is outside the supported range.");
  const now = options.now || (() => Date.now());
  const wait = options.wait || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const onUnexpectedError = typeof options.onUnexpectedError === "function" ? options.onUnexpectedError : () => {};
  const limit = createRateLimitBoundary(rateLimiter, options.clientKey, { onUnexpectedError });
  if (google && (google.name !== "google" || typeof google.begin !== "function" || typeof google.complete !== "function" || typeof google.clearCookie !== "string")) throw new TypeError("Google authentication routes require a complete OIDC provider.");
  if (facebook && (facebook.name !== "facebook" || typeof facebook.begin !== "function" || typeof facebook.complete !== "function" || typeof facebook.clearCookie !== "string")) throw new TypeError("Facebook authentication routes require a complete provider verifier.");

  async function privateDelivery(delivery) {
    if (!delivery) return;
    await emailDelivery.send({ kind: delivery.kind, recipient: delivery.recipient, link: deliveryLink(appOrigin, delivery), expiresAt: delivery.expiresAt });
  }

  async function publicTiming(startedAt) {
    const remaining = minimumPublicResponseMs - Math.max(0, now() - startedAt);
    if (remaining > 0) await wait(remaining);
  }

  function metadata(request) {
    return { userAgent: header(request, "user-agent"), ipAddress: limit.clientKey(request) };
  }

  return {
    async handle(request, response, suppliedUrl) {
      const url = suppliedUrl instanceof URL ? suppliedUrl : new URL(request.url || "/", "http://localhost");
      if (!url.pathname.startsWith(prefix) && url.pathname !== "/api/marketplace/onboarding") return false;
      const startedAt = now();
      try {
        if (url.pathname === `${prefix}google/start`) {
          if (!google) return sendJson(response, 404, { ok: false, code: "not-found", error: "Authentication route not found." }), true;
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          await limit(request, "google-start");
          const attempt = google.begin();
          sendRedirect(response, 302, attempt.location, [attempt.setCookie]);
          return true;
        }
        if (url.pathname === `${prefix}google/callback`) {
          if (!google) return sendJson(response, 404, { ok: false, code: "not-found", error: "Authentication route not found." }), true;
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          try {
            await limit(request, "google-callback");
            const claims = await google.complete(url, header(request, "cookie"));
            const account = await identity.socialSignIn("google", claims);
            const session = await sessions.establish(account, metadata(request));
            const destination = session.account.roles.length ? "/login" : "/onboarding";
            const fragment = new URLSearchParams({ social: "google", csrfToken: session.csrfToken });
            sendRedirect(response, 303, `${destination}#${fragment}`, [google.clearCookie, session.setCookie]);
          } catch (error) {
            const rateLimited = error?.statusCode === 429;
            if (!rateLimited && !(error instanceof TypeError)) onUnexpectedError(error);
            const fragment = new URLSearchParams({ social: rateLimited ? "rate-limited" : "google-failed" });
            sendRedirect(response, 303, `/login#${fragment}`, [google.clearCookie]);
          }
          return true;
        }
        if (url.pathname === `${prefix}facebook/start`) {
          if (!facebook) return sendJson(response, 404, { ok: false, code: "not-found", error: "Authentication route not found." }), true;
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          await limit(request, "facebook-start");
          const attempt = facebook.begin();
          sendRedirect(response, 302, attempt.location, [attempt.setCookie]);
          return true;
        }
        if (url.pathname === `${prefix}facebook/callback`) {
          if (!facebook) return sendJson(response, 404, { ok: false, code: "not-found", error: "Authentication route not found." }), true;
          if (request.method !== "GET") return methodNotAllowed(response, ["GET"]), true;
          try {
            await limit(request, "facebook-callback");
            const claims = await facebook.complete(url, header(request, "cookie"));
            const result = await facebookIdentity.begin(claims);
            if (result.authenticated) {
              const session = await sessions.establish(result.account, metadata(request));
              const destination = session.account.roles.length ? "/login" : "/onboarding";
              const fragment = new URLSearchParams({ social: "facebook", csrfToken: session.csrfToken });
              sendRedirect(response, 303, `${destination}#${fragment}`, [facebook.clearCookie, session.setCookie]);
            } else if (result.verificationRequired) {
              await privateDelivery(result.emailDelivery);
              sendRedirect(response, 303, "/login#social=facebook-verification-sent", [facebook.clearCookie]);
            } else {
              sendRedirect(response, 303, "/login#social=facebook-email-unavailable", [facebook.clearCookie]);
            }
          } catch (error) {
            const rateLimited = error?.statusCode === 429;
            if (!rateLimited && !(error instanceof TypeError)) onUnexpectedError(error);
            const fragment = new URLSearchParams({ social: rateLimited ? "rate-limited" : "facebook-failed" });
            sendRedirect(response, 303, `/login#${fragment}`, [facebook.clearCookie]);
          }
          return true;
        }
        if (request.method !== "POST") return methodNotAllowed(response, ["POST"]), true;
        security.requireOrigin(request);
        if (url.pathname === `${prefix}signup`) {
          await limit(request, "signup");
          const result = await credentials.register(await readJsonObject(request));
          await privateDelivery(result.emailDelivery);
          await publicTiming(startedAt);
          sendJson(response, 202, genericAccepted);
          return true;
        }
        if (url.pathname === `${prefix}verification/resend`) {
          await limit(request, "verification-resend");
          const body = await readJsonObject(request);
          const result = await credentials.requestEmailVerification(body.email);
          await privateDelivery(result.emailDelivery);
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
