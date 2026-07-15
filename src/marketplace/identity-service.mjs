const supportedSocialProviders = Object.freeze(["google", "apple", "facebook"]);
const selectableOnboardingRoles = Object.freeze(["cleaner", "landlord"]);

function cleanText(value, maximum, label, required = false) {
  const text = typeof value === "string" ? value.trim() : "";
  if ((required && !text) || text.length > maximum || /[\u0000-\u001f\u007f]/.test(text)) throw new TypeError(`${label} is invalid.`);
  return text;
}

function emailAddress(value) {
  const email = cleanText(value, 254, "Verified provider email", true).toLowerCase();
  const at = email.indexOf("@");
  if (at < 1 || at !== email.lastIndexOf("@") || at === email.length - 1) throw new TypeError("Verified provider email is invalid.");
  return email;
}

function secureAvatarUrl(value) {
  const url = cleanText(value, 2048, "Provider avatar URL");
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function normalizedVerifiedSocialClaims(provider, claims) {
  if (!supportedSocialProviders.includes(provider)) throw new TypeError("A supported social provider is required.");
  if (!claims || claims.emailVerified !== true) throw new TypeError("The social provider must verify the email before account creation or linking.");
  const subject = cleanText(claims.subject, 255, "Provider subject", true);
  const email = emailAddress(claims.email);
  const displayName = cleanText(claims.displayName, 120, "Provider display name") || email.split("@", 1)[0];
  const locale = cleanText(claims.locale, 32, "Provider locale");
  return {
    subject,
    email,
    emailVerified: true,
    displayName,
    avatarUrl: secureAvatarUrl(claims.avatarUrl),
    profile: locale ? { locale } : {}
  };
}

export function selectedOnboardingRole(role) {
  if (!selectableOnboardingRoles.includes(role)) throw new TypeError("Choose Cleaner or Landlord/Property Manager.");
  return role;
}

export function createIdentityService(repository) {
  if (!repository || typeof repository.resolveSocialIdentity !== "function" || typeof repository.completeRoleOnboarding !== "function") throw new TypeError("An authentication repository is required.");
  return {
    socialSignIn(provider, verifiedClaims) {
      return repository.resolveSocialIdentity(provider, normalizedVerifiedSocialClaims(provider, verifiedClaims));
    },
    completeOnboarding(actor, role) {
      if (!actor?.userId) throw new TypeError("An authenticated account is required for onboarding.");
      return repository.completeRoleOnboarding(actor, selectedOnboardingRole(role));
    }
  };
}

export { selectableOnboardingRoles, supportedSocialProviders };
