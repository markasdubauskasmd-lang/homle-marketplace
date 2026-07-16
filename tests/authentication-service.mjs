import { createIdentityService, normalizedProviderConnectionClaims, normalizedVerifiedSocialClaims, selectedOnboardingRole } from "../src/marketplace/identity-service.mjs";
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
      account = { user_id: `account-${++accountNumber}`, email: claims.email, email_verified_at: new Date().toISOString(), has_password_identity: false, display_name: claims.displayName, avatar_url: claims.avatarUrl, selected_role: null, roles: [] };
      accountsByEmail.set(claims.email, account);
    } else if (!account.email_verified_at || account.has_password_identity) {
      throw new Error("Sign in to the existing account and connect this social provider from authenticated settings");
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
  },
  async listConnectedIdentities(actor) {
    return [{ provider: "password", connected_at: "2026-07-16T09:00:00.000Z", last_used_at: null }, ...[...identities.entries()].filter(([, identity]) => identity.user_id === actor.userId).map(([key]) => ({ provider: key.split(":", 1)[0], connected_at: "2026-07-16T10:00:00.000Z", last_used_at: null }))];
  },
  async connectSocialIdentity(actor, provider, claims) {
    const key = `${provider}:${claims.subject}`;
    identities.set(key, { user_id: actor.userId, ...claims });
    return { provider, connected_at: "2026-07-16T10:00:00.000Z", last_used_at: null, already_connected: false };
  }
};
const service = createIdentityService(repository);

const googleClaims = { subject: "google-subject-1", email: " Owner@Example.com ", emailVerified: true, displayName: " Property Owner ", avatarUrl: "https://images.example.com/person.jpg", locale: "en-GB" };
const normalized = normalizedVerifiedSocialClaims("google", googleClaims);
assert(normalized.email === "owner@example.com" && normalized.displayName === "Property Owner" && normalized.avatarUrl.startsWith("https://") && normalized.profile.locale === "en-GB", "Verified provider claims were not safely normalized.");
assert(expectThrow(() => normalizedVerifiedSocialClaims("google", { ...googleClaims, emailVerified: false }), "must verify") && expectThrow(() => normalizedVerifiedSocialClaims("password", googleClaims), "supported social") && expectThrow(() => selectedOnboardingRole("administrator"), "Cleaner or Landlord"), "Unverified social email, password-as-social or administrator self-selection was accepted.");
const facebookConnectionClaims = normalizedProviderConnectionClaims("facebook", { ...googleClaims, emailVerified: false });
assert(facebookConnectionClaims.email === "owner@example.com" && facebookConnectionClaims.emailVerified === false && expectThrow(() => normalizedProviderConnectionClaims("google", { ...googleClaims, emailVerified: false }), "must verify"), "Authenticated provider connection did not preserve the distinct Google/Facebook email trust boundary.");

const firstGoogleLogin = await service.socialSignIn("google", googleClaims);
const repeatedGoogleLogin = await service.socialSignIn("google", googleClaims);
const connectedFacebookLogin = await service.socialSignIn("facebook", { ...googleClaims, subject: "facebook-subject-9" });
assert(firstGoogleLogin.account_created && firstGoogleLogin.identity_created && firstGoogleLogin.user_id === "account-1", "A new verified Google user did not automatically receive an account.");
assert(!repeatedGoogleLogin.account_created && !repeatedGoogleLogin.identity_created && repeatedGoogleLogin.user_id === firstGoogleLogin.user_id, "Repeated Google login created a duplicate account or identity.");
assert(!connectedFacebookLogin.account_created && connectedFacebookLogin.identity_created && connectedFacebookLogin.user_id === firstGoogleLogin.user_id && accountsByEmail.size === 1, "A second provider using the same verified email created a duplicate account.");

accountsByEmail.set("collision@example.com", { user_id: "attacker-preregistered-account", email: "collision@example.com", email_verified_at: null, has_password_identity: true, display_name: "Unverified", avatar_url: "", selected_role: null, roles: [] });
let unverifiedCollisionRejected = false;
try {
  await service.socialSignIn("google", { ...googleClaims, subject: "real-inbox-owner", email: "collision@example.com" });
} catch (error) {
  unverifiedCollisionRejected = error.message.includes("authenticated settings");
}
assert(unverifiedCollisionRejected && !identities.has("google:real-inbox-owner") && accountsByEmail.get("collision@example.com")?.email_verified_at === null, "A provider-verified login attached to an attacker-pre-registered unverified password account.");

accountsByEmail.set("verified-password@example.com", { user_id: "verified-password-account", email: "verified-password@example.com", email_verified_at: new Date().toISOString(), has_password_identity: true, display_name: "Password User", avatar_url: "", selected_role: null, roles: [] });
let passwordAccountStepUpRequired = false;
try {
  await service.socialSignIn("facebook", { ...googleClaims, subject: "facebook-for-password-account", email: "verified-password@example.com" });
} catch (error) {
  passwordAccountStepUpRequired = error.message.includes("authenticated settings");
}
assert(passwordAccountStepUpRequired && !identities.has("facebook:facebook-for-password-account"), "A pre-authenticated social callback attached to a password account without account step-up.");
const connectedFromSettings = await service.connectProvider({ userId: "verified-password-account", roles: ["landlord"] }, "facebook", { ...googleClaims, subject: "facebook-after-step-up", emailVerified: false });
const listedConnections = await service.connectedProviders({ userId: "verified-password-account", roles: ["landlord"] });
assert(connectedFromSettings.provider === "facebook" && listedConnections.some((item) => item.provider === "password") && listedConnections.some((item) => item.provider === "facebook") && identities.get("facebook:facebook-after-step-up")?.emailVerified === false, "Authenticated settings did not connect and safely list the additional provider.");

const cleanerOnboarding = await service.completeOnboarding({ userId: firstGoogleLogin.user_id, roles: [] }, "cleaner");
const repeatedCleanerOnboarding = await service.completeOnboarding({ userId: firstGoogleLogin.user_id, roles: ["cleaner"] }, "cleaner");
assert(cleanerOnboarding.selected_role === "cleaner" && cleanerOnboarding.profile_created && !repeatedCleanerOnboarding.profile_created, "Cleaner onboarding was not role-specific and idempotent.");
let roleSwitchRejected = false;
try { await service.completeOnboarding({ userId: firstGoogleLogin.user_id, roles: ["cleaner"] }, "landlord"); } catch { roleSwitchRejected = true; }
assert(roleSwitchRejected, "A self-service role change bypassed the reviewed account workflow.");

const migrationSql = await readFile(new URL("../db/migrations/004_social_identity_and_onboarding.sql", import.meta.url), "utf8");
const connectionMigration = await readFile(new URL("../db/migrations/027_authenticated_provider_connections.sql", import.meta.url), "utf8");
const runtimeGrantsSql = await readFile(new URL("../db/runtime-role-grants.sql", import.meta.url), "utf8");
const unverifiedMergeGuard = migrationSql.indexOf("IF resolved_email_verified_at IS NULL");
const socialIdentityInsert = migrationSql.indexOf("INSERT INTO authentication_identities (", unverifiedMergeGuard);
assert(migrationSql.includes("resolve_social_identity") && migrationSql.includes("asserted_email_verified IS DISTINCT FROM true") && (migrationSql.match(/pg_advisory_xact_lock/g) || []).length === 2 && migrationSql.includes("SELECT u.id, u.account_status, u.email_verified_at INTO resolved_user_id, resolved_status, resolved_email_verified_at") && migrationSql.includes("WHERE u.email = normalized_email FOR UPDATE") && migrationSql.includes("ai.provider = 'password'") && migrationSql.includes("resolved_email_verified_at IS NULL OR resolved_has_password_identity") && unverifiedMergeGuard > 0 && socialIdentityInsert > unverifiedMergeGuard && migrationSql.includes("authenticated settings") && migrationSql.includes("UNSUPPORTED_PLACEHOLDER") === false, "Social identity migration lacks the verified-email, password-account step-up, unverified-account takeover, concurrency or deduplication safeguards.");
assert(migrationSql.includes("complete_role_onboarding") && migrationSql.includes("chosen_role NOT IN ('cleaner', 'landlord')") && migrationSql.includes("ON CONFLICT (user_id) DO NOTHING") && migrationSql.includes("account.role.selected") && (migrationSql.match(/REVOKE ALL ON FUNCTION/g) || []).length === 2, "Role onboarding migration is not idempotent, auditable or restricted.");
assert(runtimeGrantsSql.includes("resolve_social_identity(authentication_provider, text, citext, boolean, text, text, jsonb)") && runtimeGrantsSql.includes("complete_role_onboarding(user_role)"), "The restricted runtime role cannot execute the social identity or onboarding functions.");
assert(connectionMigration.includes("list_my_authentication_identities") && connectionMigration.includes("connect_social_identity") && connectionMigration.includes("tideway_private.current_user_id()") && (connectionMigration.match(/pg_advisory_xact_lock/g) || []).length === 2 && connectionMigration.includes("provider-identity-already-connected") && connectionMigration.includes("account-provider-already-connected") && connectionMigration.includes("authentication-provider-connected") && connectionMigration.trimEnd().endsWith("COMMIT;"), "Authenticated provider connection lacks actor binding, collision locks, audit history or atomic migration boundaries.");
assert(runtimeGrantsSql.includes("connect_social_identity(authentication_provider,text,citext,boolean,text,text,jsonb)") && runtimeGrantsSql.includes("REVOKE SELECT, INSERT, UPDATE, DELETE ON authentication_identities FROM tideway_app"), "Provider connection bypasses the function-only runtime boundary.");

console.log("Authentication service tests passed: safe social sign-in, takeover-resistant password-account step-up, authenticated provider connection/listing, collision-locked migration and role onboarding.");
