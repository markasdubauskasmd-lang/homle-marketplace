import { hashPurposeToken, newOpaqueToken } from "./session.mjs";
import { normalizedEmail } from "./auth-repository.mjs";

function expiry(clock, lifetimeSeconds) {
  if (!Number.isInteger(lifetimeSeconds) || lifetimeSeconds < 600 || lifetimeSeconds > 86_400) throw new RangeError("Facebook email-verification lifetime is outside the supported range.");
  const now = clock();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new TypeError("Facebook identity clock must return a valid Date.");
  return new Date(now.getTime() + lifetimeSeconds * 1000).toISOString();
}
function text(value, maximum, label, required = false) {
  const selected = typeof value === "string" ? value.trim() : "";
  if ((required && !selected) || selected.length > maximum || /[\u0000-\u001f\u007f]/.test(selected)) throw new TypeError(`${label} is invalid.`);
  return selected;
}

function claims(value) {
  if (!value || value.emailVerified !== false) throw new TypeError("Facebook claims must remain unverified until Homle verifies the mailbox.");
  const subject = text(value.subject, 255, "Facebook subject", true);
  const email = value.email ? normalizedEmail(value.email) : null;
  const displayName = text(value.displayName, 120, "Facebook display name");
  const avatarUrl = text(value.avatarUrl, 2048, "Facebook avatar URL");
  let safeAvatar = null;
  if (avatarUrl) {
    try { const url = new URL(avatarUrl); if (url.protocol === "https:") safeAvatar = url.toString(); } catch {}
  }
  return { subject, email, displayName, avatarUrl: safeAvatar, profile: {} };
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

export function createFacebookIdentityService(repository, options = {}) {
  const methods = ["findExistingSocialIdentity", "beginPendingSocialIdentity", "consumePendingSocialIdentity"];
  if (!repository || methods.some((method) => typeof repository[method] !== "function")) throw new TypeError("Facebook sign-in requires a complete pending-identity repository.");
  const tokenSecret = options.tokenSecret;
  const clock = options.clock || (() => new Date());
  const verificationTtlSeconds = options.verificationTtlSeconds ?? 3600;

  return Object.freeze({
    async begin(providerClaims) {
      const selected = claims(providerClaims);
      const existing = await repository.findExistingSocialIdentity("facebook", selected.subject);
      if (existing) return { authenticated: true, account: publicAccount(existing), emailDelivery: null };
      if (!selected.email) return { authenticated: false, verificationRequired: false, reason: "facebook-email-unavailable", emailDelivery: null };
      const token = newOpaqueToken();
      const verificationHash = hashPurposeToken(token, "facebook-email-verification", tokenSecret);
      const expiresAt = expiry(clock, verificationTtlSeconds);
      const result = await repository.beginPendingSocialIdentity({ provider: "facebook", ...selected, verificationHash, expiresAt });
      if (result === "existing") {
        const raced = await repository.findExistingSocialIdentity("facebook", selected.subject);
        if (raced) return { authenticated: true, account: publicAccount(raced), emailDelivery: null };
        throw new Error("facebook-identity-race-unresolved");
      }
      if (result !== "pending") throw new TypeError("Facebook pending identity returned an invalid state.");
      return { authenticated: false, verificationRequired: true, reason: "email-verification-required", emailDelivery: { kind: "facebook-email-verification", recipient: selected.email, token, expiresAt } };
    },
    async verify(token) {
      let verificationHash;
      try { verificationHash = hashPurposeToken(token, "facebook-email-verification", tokenSecret); } catch { return { verified: false, reason: "invalid-or-expired" }; }
      const account = await repository.consumePendingSocialIdentity(verificationHash);
      return account ? { verified: true, account: publicAccount(account) } : { verified: false, reason: "existing-account-requires-sign-in" };
    }
  });
}
