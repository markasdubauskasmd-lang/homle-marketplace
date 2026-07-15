import { hashPassword, hashPurposeToken, newOpaqueToken, verifyPassword } from "./session.mjs";
import { normalizedEmail } from "./auth-repository.mjs";

function displayName(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > 120 || /[\u0000-\u001f\u007f]/.test(normalized)) throw new TypeError("Display name must contain 1 to 120 characters.");
  return normalized;
}

function expiry(clock, ttlSeconds, minimum, maximum, label) {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < minimum || ttlSeconds > maximum) throw new RangeError(`${label} lifetime is outside the supported range.`);
  const now = clock();
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError("Credential clock must return a valid Date.");
  return new Date(now.getTime() + ttlSeconds * 1000).toISOString();
}

function publicAccount(account) {
  return {
    userId: account.user_id,
    email: account.email,
    emailVerifiedAt: account.email_verified_at,
    displayName: account.display_name,
    selectedRole: account.selected_role,
    roles: Array.isArray(account.roles) ? account.roles : []
  };
}

export function createCredentialService(repository, options) {
  const requiredMethods = ["registerPasswordAccount", "consumeEmailVerification", "issueEmailVerification", "findPasswordAccount", "recordPasswordAttempt", "issuePasswordReset", "consumePasswordReset"];
  if (!repository || requiredMethods.some((method) => typeof repository[method] !== "function")) throw new TypeError("A complete credential repository is required.");
  const tokenSecret = options?.tokenSecret;
  const clock = options?.clock || (() => new Date());
  const verificationTtlSeconds = options?.verificationTtlSeconds ?? 86_400;
  const resetTtlSeconds = options?.resetTtlSeconds ?? 3_600;
  // A real, process-local scrypt hash keeps unknown-email login work comparable
  // to known-account verification without storing a usable credential.
  const dummyHashPromise = hashPassword(newOpaqueToken());

  return {
    async register(input) {
      const email = normalizedEmail(input?.email);
      const name = displayName(input?.displayName);
      const passwordHash = await hashPassword(input?.password);
      const token = newOpaqueToken();
      const verificationHash = hashPurposeToken(token, "email-verification", tokenSecret);
      const verificationExpiresAt = expiry(clock, verificationTtlSeconds, 600, 172_800, "Email verification");
      const created = await repository.registerPasswordAccount({ email, displayName: name, passwordHash, verificationHash, verificationExpiresAt });
      return {
        accepted: true,
        emailDelivery: created ? { kind: "email-verification", recipient: email, token, expiresAt: verificationExpiresAt } : null
      };
    },

    async verifyEmail(token) {
      let verificationHash;
      try { verificationHash = hashPurposeToken(token, "email-verification", tokenSecret); } catch { return { verified: false }; }
      const account = await repository.consumeEmailVerification(verificationHash);
      return account ? { verified: true, account: publicAccount(account) } : { verified: false };
    },

    async requestEmailVerification(emailValue) {
      const token = newOpaqueToken();
      const verificationHash = hashPurposeToken(token, "email-verification", tokenSecret);
      const verificationExpiresAt = expiry(clock, verificationTtlSeconds, 600, 172_800, "Email verification");
      let email;
      try { email = normalizedEmail(emailValue); } catch { return { accepted: true, emailDelivery: null }; }
      const issued = await repository.issueEmailVerification(email, verificationHash, verificationExpiresAt);
      return {
        accepted: true,
        emailDelivery: issued ? { kind: "email-verification", recipient: email, token, expiresAt: verificationExpiresAt } : null
      };
    },

    async signIn(emailValue, password) {
      let email;
      try { email = normalizedEmail(emailValue); } catch {
        await verifyPassword(String(password || ""), await dummyHashPromise);
        return { authenticated: false, reason: "invalid-credentials" };
      }
      const account = await repository.findPasswordAccount(email);
      const passwordMatches = await verifyPassword(String(password || ""), account?.password_hash || await dummyHashPromise);
      if (!account || !passwordMatches) {
        if (account?.user_id) await repository.recordPasswordAttempt(account.user_id, false);
        return { authenticated: false, reason: "invalid-credentials" };
      }
      const lockedUntil = account.locked_until ? new Date(account.locked_until) : null;
      if (lockedUntil && lockedUntil.getTime() > clock().getTime()) return { authenticated: false, reason: "temporarily-locked" };
      await repository.recordPasswordAttempt(account.user_id, true);
      if (!account.email_verified_at) return { authenticated: false, reason: "email-verification-required" };
      return { authenticated: true, account: publicAccount(account) };
    },

    async requestPasswordReset(emailValue) {
      const token = newOpaqueToken();
      const resetHash = hashPurposeToken(token, "password-reset", tokenSecret);
      const resetExpiresAt = expiry(clock, resetTtlSeconds, 600, 7_200, "Password reset");
      let email;
      try { email = normalizedEmail(emailValue); } catch { return { accepted: true, emailDelivery: null }; }
      const issued = await repository.issuePasswordReset(email, resetHash, resetExpiresAt);
      return {
        accepted: true,
        emailDelivery: issued ? { kind: "password-reset", recipient: email, token, expiresAt: resetExpiresAt } : null
      };
    },

    async resetPassword(token, replacementPassword) {
      let resetHash;
      try { resetHash = hashPurposeToken(token, "password-reset", tokenSecret); } catch { return { changed: false }; }
      const replacementPasswordHash = await hashPassword(replacementPassword);
      const result = await repository.consumePasswordReset(resetHash, replacementPasswordHash);
      return result ? { changed: true, sessionsRevoked: Number(result.sessions_revoked) || 0 } : { changed: false };
    }
  };
}
