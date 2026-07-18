import { csrfMatches, developmentSessionCookieName, hashOpaqueToken, parseCookies, sessionCookieName } from "./session.mjs";
import { marketplaceRoles } from "./domain.mjs";

export class AccountHttpError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = "AccountHttpError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function exactOrigin(value) {
  try {
    const parsed = new URL(value);
    if (parsed.origin !== String(value).replace(/\/$/, "") || parsed.username || parsed.password) throw new Error();
    return parsed.origin;
  } catch {
    throw new TypeError("Account security requires an exact application origin.");
  }
}

function header(request, name) {
  const value = request?.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : String(value || "");
}

export function createAccountSecurity(repository, options) {
  if (!repository || typeof repository.findSession !== "function") throw new TypeError("A session repository is required.");
  const sessionSecret = options?.sessionSecret;
  if (typeof sessionSecret !== "string" || sessionSecret.length < 32) throw new TypeError("A 32-character session secret is required.");
  const appOrigin = exactOrigin(options?.appOrigin);
  const production = options?.production === true;
  const expectedCookieName = production ? sessionCookieName : developmentSessionCookieName;

  async function authenticate(request) {
    const token = parseCookies(header(request, "cookie"))[expectedCookieName] || "";
    if (!token) throw new AccountHttpError(401, "authentication-required", "Sign in is required.");
    let tokenHash;
    try { tokenHash = hashOpaqueToken(token, sessionSecret); } catch { throw new AccountHttpError(401, "authentication-required", "Sign in is required."); }
    const session = await repository.findSession(tokenHash);
    if (!session) throw new AccountHttpError(401, "authentication-required", "Sign in is required.");
    const roles = Array.isArray(session.roles) ? [...new Set(session.roles)] : [];
    if (roles.some((role) => !marketplaceRoles.includes(role))) throw new AccountHttpError(403, "invalid-account-role", "This account cannot access the marketplace.");
    return {
      sessionId: session.session_id,
      csrfHash: session.csrf_secret_hash,
      expiresAt: session.expires_at,
      actor: { userId: session.user_id, roles },
      account: {
        email: session.email,
        emailVerifiedAt: session.email_verified_at,
        displayName: session.display_name,
        avatarUrl: session.avatar_url || null,
        selectedRole: session.selected_role
      }
    };
  }

  function requireOrigin(request) {
    if (header(request, "origin") !== appOrigin) throw new AccountHttpError(403, "origin-rejected", "The request origin was rejected.");
  }

  function requireCsrf(request, context) {
    if (!csrfMatches(header(request, "x-csrf-token"), context.csrfHash, sessionSecret)) throw new AccountHttpError(403, "csrf-rejected", "The security token is missing or expired.");
  }

  function requireRole(context, allowedRoles) {
    if (!Array.isArray(allowedRoles) || allowedRoles.length === 0) return;
    if (allowedRoles.some((role) => !marketplaceRoles.includes(role))) throw new TypeError("A supported route role is required.");
    if (!allowedRoles.some((role) => context.actor.roles.includes(role))) throw new AccountHttpError(403, "role-rejected", "This account role cannot perform that action.");
  }

  return {
    async protect(request, policy = {}) {
      const context = await authenticate(request);
      if (policy.mutation === true) {
        requireOrigin(request);
        requireCsrf(request, context);
      }
      requireRole(context, policy.roles);
      return context;
    },
    authenticate,
    requireOrigin,
    requireCsrf,
    requireRole
  };
}
