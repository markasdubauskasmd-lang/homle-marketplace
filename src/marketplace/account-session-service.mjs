import { createHmac } from "node:crypto";
import { marketplaceRoles } from "./domain.mjs";
import { clearSessionCookie, createSessionMaterial, sessionCookie } from "./session.mjs";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(value, label) {
  if (!uuidPattern.test(value || "")) throw new TypeError(`A valid ${label} is required.`);
  return value.toLowerCase();
}

function secretKey(secret) {
  if (typeof secret !== "string" || secret.length < 32) throw new TypeError("A 32-character session secret is required.");
  return secret;
}

function boundedMetadata(value, maximum) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized && normalized.length <= maximum && !/[\u0000-\u001f\u007f]/.test(normalized) ? normalized : "";
}

function privateMetadataHash(value, purpose, secret) {
  if (!value) return null;
  return createHmac("sha256", secret).update(`tideway:${purpose}:v1\0`, "utf8").update(value, "utf8").digest();
}

function sessionMetadata(metadata, secret) {
  return {
    userAgentHash: privateMetadataHash(boundedMetadata(metadata?.userAgent, 1024), "session-user-agent", secret),
    ipHash: privateMetadataHash(boundedMetadata(metadata?.ipAddress, 64), "session-ip", secret)
  };
}

function publicAccount(account) {
  const roles = Array.isArray(account?.roles) ? [...new Set(account.roles)] : [];
  if (roles.some((role) => !marketplaceRoles.includes(role))) throw new TypeError("The account contains an unsupported role.");
  return {
    userId: uuid(account?.userId ?? account?.user_id, "account user id"),
    email: String(account?.email || ""),
    emailVerifiedAt: account?.emailVerifiedAt ?? account?.email_verified_at ?? null,
    displayName: account?.displayName ?? account?.display_name ?? "",
    selectedRole: account?.selectedRole ?? account?.selected_role ?? null,
    roles
  };
}

export function createAccountSessionService(repository, options = {}) {
  if (!repository || typeof repository.createSession !== "function" || typeof repository.revokeSession !== "function" || typeof repository.revokeAllSessions !== "function") throw new TypeError("A complete account session repository is required.");
  const sessionSecret = secretKey(options.sessionSecret);
  const production = options.production === true;
  const ttlSeconds = options.ttlSeconds ?? 60 * 60 * 24 * 30;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 300 || ttlSeconds > 60 * 60 * 24 * 90) throw new RangeError("Session lifetime must be between five minutes and ninety days.");
  const clock = options.clock || (() => new Date());

  async function establish(accountValue, metadata = {}) {
    const account = publicAccount(accountValue);
    const actor = { userId: account.userId, roles: account.roles };
    const material = createSessionMaterial(sessionSecret, clock(), ttlSeconds);
    const stored = await repository.createSession(actor, { tokenHash: material.tokenHash, csrfHash: material.csrfHash, expiresAt: material.expiresAt }, sessionMetadata(metadata, sessionSecret));
    if (!stored?.id && !stored?.session_id) throw new Error("The account session could not be stored.");
    return {
      account,
      sessionId: stored.id || stored.session_id,
      expiresAt: material.expiresAt,
      csrfToken: material.csrfToken,
      setCookie: sessionCookie(material.token, ttlSeconds, production)
    };
  }

  return {
    establish,
    async rotate(context, account, metadata = {}) {
      if (!context?.actor?.userId || !context?.sessionId) throw new TypeError("An authenticated session is required for rotation.");
      const projectedAccount = publicAccount(account);
      if (projectedAccount.userId !== uuid(context.actor.userId, "authenticated user id")) throw new TypeError("Session rotation cannot change the authenticated account.");
      await repository.revokeSession(context.actor, uuid(context.sessionId, "session id"));
      return establish(projectedAccount, metadata);
    },
    async logout(context) {
      if (!context?.actor?.userId || !context?.sessionId) throw new TypeError("An authenticated session is required for logout.");
      await repository.revokeSession(context.actor, uuid(context.sessionId, "session id"));
      return { setCookie: clearSessionCookie(production) };
    },
    async logoutAll(context) {
      if (!context?.actor?.userId) throw new TypeError("An authenticated account is required for session revocation.");
      const revokedSessions = await repository.revokeAllSessions(context.actor);
      return { revokedSessions: Number(revokedSessions) || 0, setCookie: clearSessionCookie(production) };
    }
  };
}
