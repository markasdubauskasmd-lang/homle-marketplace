import { errorResponse, methodNotAllowed, readJsonObject, sendJson } from "./http-support.mjs";

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
  const path = delivery.kind === "email-verification" ? "/verify-email" : delivery.kind === "password-reset" ? "/reset-password" : "";
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

export function createAuthenticationHttpRouter(dependencies, options = {}) {
  const security = dependencies?.security;
  const credentials = dependencies?.credentialService;
  const identity = dependencies?.identityService;
  const sessions = dependencies?.accountSessionService;
  const emailDelivery = dependencies?.emailDelivery;
  const rateLimiter = dependencies?.rateLimiter;
  if (!security || typeof security.protect !== "function" || typeof security.requireOrigin !== "function") throw new TypeError("Authentication HTTP routes require account security.");
  if (!credentials || ["register", "requestEmailVerification", "verifyEmail", "signIn", "requestPasswordReset", "resetPassword"].some((method) => typeof credentials[method] !== "function")) throw new TypeError("Authentication HTTP routes require the credential service.");
  if (!identity || typeof identity.completeOnboarding !== "function") throw new TypeError("Authentication HTTP routes require the identity service.");
  if (!sessions || ["establish", "rotate", "logout", "logoutAll"].some((method) => typeof sessions[method] !== "function")) throw new TypeError("Authentication HTTP routes require the session service.");
  if (!emailDelivery || typeof emailDelivery.send !== "function") throw new TypeError("Authentication HTTP routes require a trusted email-delivery adapter.");
  if (!rateLimiter || typeof rateLimiter.consume !== "function") throw new TypeError("Authentication HTTP routes require a shared rate limiter.");
  if (typeof options.clientKey !== "function") throw new TypeError("Authentication HTTP routes require a trusted client-key resolver.");
  const appOrigin = exactOrigin(options.appOrigin);
  const minimumPublicResponseMs = options.minimumPublicResponseMs ?? 500;
  if (!Number.isInteger(minimumPublicResponseMs) || minimumPublicResponseMs < 0 || minimumPublicResponseMs > 5000) throw new RangeError("Public authentication response delay is outside the supported range.");
  const now = options.now || (() => Date.now());
  const wait = options.wait || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const onUnexpectedError = typeof options.onUnexpectedError === "function" ? options.onUnexpectedError : () => {};

  function clientKey(request) {
    const key = String(options.clientKey(request) || "");
    if (!key || key.length > 200 || /[\u0000-\u001f\u007f]/.test(key)) throw new TypeError("The trusted authentication client key is invalid.");
    return key;
  }

  async function limit(request, scope) {
    const result = await rateLimiter.consume({ scope, key: clientKey(request) });
    if (result?.allowed !== true) {
      const retryAfterSeconds = Math.max(1, Math.min(3600, Number(result?.retryAfterSeconds) || 60));
      throw Object.assign(new Error("Too many attempts. Try again later."), { statusCode: 429, code: "rate-limited", retryAfterSeconds });
    }
  }

  async function privateDelivery(delivery) {
    if (!delivery) return;
    await emailDelivery.send({ kind: delivery.kind, recipient: delivery.recipient, link: deliveryLink(appOrigin, delivery), expiresAt: delivery.expiresAt });
  }

  async function publicTiming(startedAt) {
    const remaining = minimumPublicResponseMs - Math.max(0, now() - startedAt);
    if (remaining > 0) await wait(remaining);
  }

  function metadata(request) {
    return { userAgent: header(request, "user-agent"), ipAddress: clientKey(request) };
  }

  return {
    async handle(request, response, suppliedUrl) {
      const url = suppliedUrl instanceof URL ? suppliedUrl : new URL(request.url || "/", "http://localhost");
      if (!url.pathname.startsWith(prefix) && url.pathname !== "/api/marketplace/onboarding") return false;
      const startedAt = now();
      try {
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
