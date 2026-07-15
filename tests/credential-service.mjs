import { createCredentialService } from "../src/marketplace/credential-service.mjs";
import { verifyPassword } from "../src/marketplace/session.mjs";
import { readFile } from "node:fs/promises";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const now = new Date("2026-07-15T14:00:00.000Z");
const accounts = new Map();
const verificationTokens = new Map();
const resetTokens = new Map();
let accountNumber = 0;
const repository = {
  async registerPasswordAccount(input) {
    if (accounts.has(input.email)) return false;
    const account = {
      user_id: `password-account-${++accountNumber}`,
      email: input.email,
      email_verified_at: null,
      display_name: input.displayName,
      selected_role: null,
      roles: [],
      password_hash: input.passwordHash,
      failed_attempts: 0,
      locked_until: null,
      sessions: 2
    };
    accounts.set(input.email, account);
    verificationTokens.set(input.verificationHash.toString("hex"), { account, expiresAt: input.verificationExpiresAt, used: false });
    return true;
  },
  async consumeEmailVerification(hash) {
    const record = verificationTokens.get(hash.toString("hex"));
    if (!record || record.used || new Date(record.expiresAt) <= now) return null;
    record.used = true;
    record.account.email_verified_at = now.toISOString();
    return record.account;
  },
  async issueEmailVerification(email, hash, expiresAt) {
    const account = accounts.get(email);
    if (!account || account.email_verified_at) return false;
    for (const record of verificationTokens.values()) if (record.account === account) record.used = true;
    verificationTokens.set(hash.toString("hex"), { account, expiresAt, used: false });
    return true;
  },
  async findPasswordAccount(email) {
    return accounts.get(email) || null;
  },
  async recordPasswordAttempt(userId, succeeded) {
    const account = [...accounts.values()].find((candidate) => candidate.user_id === userId);
    if (!account) return null;
    if (account.locked_until && new Date(account.locked_until) > now) return account;
    if (succeeded) {
      account.failed_attempts = 0;
      account.locked_until = null;
    } else {
      account.failed_attempts += 1;
      if (account.failed_attempts >= 5) account.locked_until = new Date(now.getTime() + 15 * 60_000).toISOString();
    }
    return account;
  },
  async issuePasswordReset(email, hash, expiresAt) {
    const account = accounts.get(email);
    if (!account?.email_verified_at) return false;
    for (const record of resetTokens.values()) if (record.account === account) record.used = true;
    resetTokens.set(hash.toString("hex"), { account, expiresAt, used: false });
    return true;
  },
  async consumePasswordReset(hash, passwordHash) {
    const record = resetTokens.get(hash.toString("hex"));
    if (!record || record.used || new Date(record.expiresAt) <= now) return null;
    record.used = true;
    record.account.password_hash = passwordHash;
    record.account.failed_attempts = 0;
    record.account.locked_until = null;
    const sessionsRevoked = record.account.sessions;
    record.account.sessions = 0;
    return { user_id: record.account.user_id, sessions_revoked: sessionsRevoked };
  }
};

const service = createCredentialService(repository, { tokenSecret: "credential-test-secret-that-is-longer-than-32-characters", clock: () => new Date(now) });
const registration = await service.register({ email: " Owner@Example.com ", displayName: " Property Owner ", password: "A long first password!" });
assert(registration.accepted && registration.emailDelivery?.kind === "email-verification" && registration.emailDelivery.recipient === "owner@example.com" && accounts.size === 1, "Password registration did not create one canonical pending account and verification delivery.");
const storedAccount = accounts.get("owner@example.com");
assert(storedAccount.password_hash.startsWith("$scrypt$32768$8$1$") && await verifyPassword("A long first password!", storedAccount.password_hash), "Registration did not store the bounded scrypt password hash.");
assert(![...verificationTokens.keys()].includes(registration.emailDelivery.token), "A raw email verification token was stored instead of its purpose-bound hash.");

const duplicateRegistration = await service.register({ email: "owner@example.com", displayName: "Different Name", password: "Another long password!" });
assert(duplicateRegistration.accepted && duplicateRegistration.emailDelivery === null && accounts.size === 1, "Duplicate signup changed the generic public result or created another account.");
const unverifiedLogin = await service.signIn("owner@example.com", "A long first password!");
assert(!unverifiedLogin.authenticated && unverifiedLogin.reason === "email-verification-required", "An unverified email received an authenticated password session.");

const unknownVerificationRequest = await service.requestEmailVerification("missing@example.com");
const resentVerification = await service.requestEmailVerification("owner@example.com");
assert(unknownVerificationRequest.accepted && unknownVerificationRequest.emailDelivery === null && resentVerification.accepted && resentVerification.emailDelivery?.recipient === "owner@example.com", "Verification resend exposed an unknown email or failed to issue trusted delivery material.");
assert(!await service.verifyEmail(registration.emailDelivery.token).then((result) => result.verified), "A replacement verification request left the earlier token usable.");

const verification = await service.verifyEmail(resentVerification.emailDelivery.token);
const repeatedVerification = await service.verifyEmail(resentVerification.emailDelivery.token);
assert(verification.verified && verification.account.userId === storedAccount.user_id && !repeatedVerification.verified, "Email verification was not single-use.");
const validLogin = await service.signIn("owner@example.com", "A long first password!");
assert(validLogin.authenticated && validLogin.account.userId === storedAccount.user_id && !Object.hasOwn(validLogin.account, "password_hash"), "Verified credentials did not authenticate or leaked the password hash.");

for (let attempt = 0; attempt < 5; attempt += 1) await service.signIn("owner@example.com", "Definitely the wrong password");
const lockedLogin = await service.signIn("owner@example.com", "A long first password!");
assert(!lockedLogin.authenticated && lockedLogin.reason === "temporarily-locked" && storedAccount.failed_attempts === 5, "Shared login-attempt state did not lock repeated failures before session creation.");
storedAccount.locked_until = new Date(now.getTime() - 1).toISOString();

const unknownReset = await service.requestPasswordReset("missing@example.com");
const resetRequest = await service.requestPasswordReset("owner@example.com");
assert(unknownReset.accepted && unknownReset.emailDelivery === null && resetRequest.accepted && resetRequest.emailDelivery?.kind === "password-reset", "Password-reset request exposed an unknown email or failed to produce trusted delivery material.");
assert(![...resetTokens.keys()].includes(resetRequest.emailDelivery.token), "A raw password-reset token was stored instead of its purpose-bound hash.");
const reset = await service.resetPassword(resetRequest.emailDelivery.token, "A safer replacement password!");
const repeatedReset = await service.resetPassword(resetRequest.emailDelivery.token, "A different replacement password!");
assert(reset.changed && reset.sessionsRevoked === 2 && !repeatedReset.changed && storedAccount.sessions === 0 && await verifyPassword("A safer replacement password!", storedAccount.password_hash), "Password reset was not single-use, did not revoke sessions or failed to replace the credential.");

const migrationSql = await readFile(new URL("../db/migrations/005_email_password_lifecycle.sql", import.meta.url), "utf8");
const resendMigrationSql = await readFile(new URL("../db/migrations/007_email_verification_resend.sql", import.meta.url), "utf8");
const runtimeGrantsSql = await readFile(new URL("../db/runtime-role-grants.sql", import.meta.url), "utf8");
assert(migrationSql.includes("register_password_account") && migrationSql.includes("consume_email_verification") && migrationSql.includes("record_password_attempt") && migrationSql.includes("issue_password_reset") && migrationSql.includes("consume_password_reset"), "Email/password migration omitted a required lifecycle function.");
assert(migrationSql.includes("failed_attempts >= 5") && migrationSql.includes("interval '15 minutes'") && migrationSql.includes("UPDATE sessions SET revoked_at") && (migrationSql.match(/REVOKE ALL ON FUNCTION/g) || []).length === 5, "Credential lifecycle lacks persistent lockout, reset session revocation or restricted execution.");
assert(resendMigrationSql.includes("issue_email_verification") && resendMigrationSql.includes("email_verified_at IS NULL") && resendMigrationSql.includes("SET used_at = COALESCE") && resendMigrationSql.includes("pg_advisory_xact_lock") && resendMigrationSql.includes("REVOKE ALL ON FUNCTION"), "Email verification resend is not generic, single-live-token, concurrency-safe and restricted.");
for (const signature of ["register_password_account(citext, text, text, bytea, timestamptz)", "consume_email_verification(bytea)", "record_password_attempt(uuid, boolean)", "issue_password_reset(citext, bytea, timestamptz)", "consume_password_reset(bytea, text)"]) {
  assert(runtimeGrantsSql.includes(signature), `The restricted runtime role lacks ${signature}.`);
}
assert(runtimeGrantsSql.includes("issue_email_verification(citext, bytea, timestamptz)"), "The restricted runtime role cannot issue a replacement verification token.");

console.log("Credential service tests passed: scrypt signup, generic duplicate handling, single-use verification, verified login, persistent lockout, non-enumerating reset request, single-use reset and session revocation.");
