import { createIdentityService, normalizedVerifiedSocialClaims, selectedOnboardingRole } from "../src/marketplace/identity-service.mjs";
import { readFile } from "node:fs/promises";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectThrow(operation, expectedMessage) {
  try { operation(); } catch (error) { return String(error.message).includes(expectedMessage); }
  return false;
}

const accountsByEmail = new Map();
const identities = new Map();
const onboarding = new Map();
let accountNumber = 0;
const repository = {
  async resolveSocialIdentity(provider, claims) {
    const identityKey = `${provider}:${claims.subject}`;
    if (identities.has(identityKey)) return { ...identities.get(identityKey), account_created: false, identity_created: false };
    let account = accountsByEmail.get(claims.email);
    const accountCreated = !account;
    if (!account) {
      account = { user_id: `account-${++accountNumber}`, email: claims.email, display_name: claims.displayName, avatar_url: claims.avatarUrl, selected_role: null, roles: [] };
      accountsByEmail.set(claims.email, account);
    }
    const result = { ...account, account_created: accountCreated, identity_created: true };
    identities.set(identityKey, result);
    return result;
  },
  async completeRoleOnboarding(actor, role) {
    const previous = onboarding.get(actor.userId);
    if (previous && previous !== role) throw new Error("role change rejected");
    onboarding.set(actor.userId, role);
    return { user_id: actor.userId, selected_role: role, roles: [role], profile_created: !previous };
  }
};
const service = createIdentityService(repository);

const googleClaims = { subject: "google-subject-1", email: " Owner@Example.com ", emailVerified: true, displayName: " Property Owner ", avatarUrl: "https://images.example.com/person.jpg", locale: "en-GB" };
const normalized = normalizedVerifiedSocialClaims("google", googleClaims);
assert(normalized.email === "owner@example.com" && normalized.displayName === "Property Owner" && normalized.avatarUrl.startsWith("https://") && normalized.profile.locale === "en-GB", "Verified provider claims were not safely normalized.");
assert(expectThrow(() => normalizedVerifiedSocialClaims("google", { ...googleClaims, emailVerified: false }), "must verify") && expectThrow(() => normalizedVerifiedSocialClaims("password", googleClaims), "supported social") && expectThrow(() => selectedOnboardingRole("administrator"), "Cleaner or Landlord"), "Unverified social email, password-as-social or administrator self-selection was accepted.");

const firstGoogleLogin = await service.socialSignIn("google", googleClaims);
const repeatedGoogleLogin = await service.socialSignIn("google", googleClaims);
const connectedFacebookLogin = await service.socialSignIn("facebook", { ...googleClaims, subject: "facebook-subject-9" });
assert(firstGoogleLogin.account_created && firstGoogleLogin.identity_created && firstGoogleLogin.user_id === "account-1", "A new verified Google user did not automatically receive an account.");
assert(!repeatedGoogleLogin.account_created && !repeatedGoogleLogin.identity_created && repeatedGoogleLogin.user_id === firstGoogleLogin.user_id, "Repeated Google login created a duplicate account or identity.");
assert(!connectedFacebookLogin.account_created && connectedFacebookLogin.identity_created && connectedFacebookLogin.user_id === firstGoogleLogin.user_id && accountsByEmail.size === 1, "A second provider using the same verified email created a duplicate account.");

const cleanerOnboarding = await service.completeOnboarding({ userId: firstGoogleLogin.user_id, roles: [] }, "cleaner");
const repeatedCleanerOnboarding = await service.completeOnboarding({ userId: firstGoogleLogin.user_id, roles: ["cleaner"] }, "cleaner");
assert(cleanerOnboarding.selected_role === "cleaner" && cleanerOnboarding.profile_created && !repeatedCleanerOnboarding.profile_created, "Cleaner onboarding was not role-specific and idempotent.");
let roleSwitchRejected = false;
try { await service.completeOnboarding({ userId: firstGoogleLogin.user_id, roles: ["cleaner"] }, "landlord"); } catch { roleSwitchRejected = true; }
assert(roleSwitchRejected, "A self-service role change bypassed the reviewed account workflow.");

const migrationSql = await readFile(new URL("../db/migrations/004_social_identity_and_onboarding.sql", import.meta.url), "utf8");
const runtimeGrantsSql = await readFile(new URL("../db/runtime-role-grants.sql", import.meta.url), "utf8");
assert(migrationSql.includes("resolve_social_identity") && migrationSql.includes("asserted_email_verified IS DISTINCT FROM true") && (migrationSql.match(/pg_advisory_xact_lock/g) || []).length === 2 && migrationSql.includes("WHERE u.email = normalized_email FOR UPDATE") && migrationSql.includes("UNSUPPORTED_PLACEHOLDER") === false, "Social identity migration lacks verified-email, concurrency or deduplication safeguards.");
assert(migrationSql.includes("complete_role_onboarding") && migrationSql.includes("chosen_role NOT IN ('cleaner', 'landlord')") && migrationSql.includes("ON CONFLICT (user_id) DO NOTHING") && migrationSql.includes("account.role.selected") && (migrationSql.match(/REVOKE ALL ON FUNCTION/g) || []).length === 2, "Role onboarding migration is not idempotent, auditable or restricted.");
assert(runtimeGrantsSql.includes("resolve_social_identity(authentication_provider, text, citext, boolean, text, text, jsonb)") && runtimeGrantsSql.includes("complete_role_onboarding(user_role)"), "The restricted runtime role cannot execute the social identity or onboarding functions.");

console.log("Authentication service tests passed: verified Google account creation, repeat-login identity reuse, cross-provider verified-email deduplication, role-specific idempotent onboarding and administrator self-selection denial.");
