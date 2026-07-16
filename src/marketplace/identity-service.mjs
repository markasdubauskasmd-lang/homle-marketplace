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

export function normalizedProviderConnectionClaims(provider, claims) {
  if (provider === "google") return normalizedVerifiedSocialClaims(provider, claims);
  if (provider !== "facebook" || !claims || claims.emailVerified !== false) throw new TypeError("A verified provider connection response is required.");
  const subject = cleanText(claims.subject, 255, "Provider subject", true);
  const suppliedEmail = cleanText(claims.email, 254, "Provider email");
  const email = suppliedEmail ? emailAddress(suppliedEmail) : null;
  const locale = cleanText(claims.locale, 32, "Provider locale");
  return {
    subject,
    email,
    emailVerified: false,
    displayName: cleanText(claims.displayName, 120, "Provider display name"),
    avatarUrl: secureAvatarUrl(claims.avatarUrl),
    profile: locale ? { locale } : {}
  };
}

export function selectedOnboardingRole(role) {
  if (!selectableOnboardingRoles.includes(role)) throw new TypeError("Choose Cleaner or Landlord/Property Manager.");
  return role;
}

export function createIdentityService(repository) {
  if (!repository || ["resolveSocialIdentity", "completeRoleOnboarding", "listConnectedIdentities", "connectSocialIdentity"].some((method) => typeof repository[method] !== "function")) throw new TypeError("An authentication repository is required.");
  return {
    socialSignIn(provider, verifiedClaims) {
      return repository.resolveSocialIdentity(provider, normalizedVerifiedSocialClaims(provider, verifiedClaims));
    },
    completeOnboarding(actor, role) {
      if (!actor?.userId) throw new TypeError("An authenticated account is required for onboarding.");
      return repository.completeRoleOnboarding(actor, selectedOnboardingRole(role));
    },
    async connectedProviders(actor) {
      if (!actor?.userId) throw new TypeError("An authenticated account is required.");
      const identities = await repository.listConnectedIdentities(actor);
      return identities.map((identity) => ({
        provider: supportedSocialProviders.includes(identity.provider) || identity.provider === "password" ? identity.provider : "",
        connectedAt: identity.connected_at ?? identity.connectedAt ?? null,
        lastUsedAt: identity.last_used_at ?? identity.lastUsedAt ?? null
      })).filter((identity) => identity.provider);
    },
    connectProvider(actor, provider, claims) {
      if (!actor?.userId) throw new TypeError("An authenticated account is required.");
      return repository.connectSocialIdentity(actor, provider, normalizedProviderConnectionClaims(provider, claims));
    }
  };
}

export { selectableOnboardingRoles, supportedSocialProviders };
