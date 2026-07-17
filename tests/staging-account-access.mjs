import assert from "node:assert/strict";
import { createStagingAccountAccess, stagingAccountEmailSha256 } from "../src/marketplace/staging-account-access.mjs";
import { createCredentialService } from "../src/marketplace/credential-service.mjs";
import { createIdentityService } from "../src/marketplace/identity-service.mjs";
import { createFacebookIdentityService } from "../src/marketplace/facebook-identity-service.mjs";

const approvedEmail = "approved-owner@invalid.example";
const approvedHash = stagingAccountEmailSha256(approvedEmail);
assert.equal(approvedHash.length, 64);
assert.equal(stagingAccountEmailSha256(" APPROVED-OWNER@invalid.example "), approvedHash, "Approved email hashing was not canonical.");

const open = createStagingAccountAccess({});
assert.equal(open.restricted, false);
assert.equal(open.allows("anyone@invalid.example"), true);

const denyAll = createStagingAccountAccess({ STAGING_ACCOUNTS_ONLY: "true" });
assert.equal(denyAll.restricted, true);
assert.equal(denyAll.allows(approvedEmail), false, "An empty staging allowlist did not fail closed.");

const restricted = createStagingAccountAccess({ STAGING_ACCOUNTS_ONLY: "true", STAGING_ACCOUNT_EMAIL_SHA256: approvedHash.toUpperCase() });
assert.equal(restricted.allows(approvedEmail), true);
assert.equal(restricted.allows("unapproved@invalid.example"), false);
assert.equal(restricted.allows("not-an-email"), false);
assert.throws(() => createStagingAccountAccess({ STAGING_ACCOUNTS_ONLY: "sometimes" }), /true or false/);
assert.throws(() => createStagingAccountAccess({ STAGING_ACCOUNT_EMAIL_SHA256: approvedHash }), /requires STAGING_ACCOUNTS_ONLY/);
assert.throws(() => createStagingAccountAccess({ STAGING_ACCOUNTS_ONLY: "true", STAGING_ACCOUNT_EMAIL_SHA256: "not-a-hash" }), /SHA-256/);
assert.throws(() => createStagingAccountAccess({ STAGING_ACCOUNTS_ONLY: "true", STAGING_ACCOUNT_EMAIL_SHA256: `${approvedHash},${approvedHash}` }), /unique/);

const blockedCalls = [];
const credentialRepository = Object.fromEntries([
  "registerPasswordAccount", "consumeEmailVerification", "issueEmailVerification", "findPasswordAccount", "recordPasswordAttempt", "issuePasswordReset", "consumePasswordReset"
].map((method) => [method, async () => { blockedCalls.push(method); throw new Error("blocked repository call"); }]));
const credentials = createCredentialService(credentialRepository, {
  tokenSecret: "staging-account-access-test-token-secret-123456789",
  accountAccess: restricted
});
assert.deepEqual(await credentials.register({ email: "unapproved@invalid.example", displayName: "Unknown Visitor", password: "A valid password for a blocked account" }), { accepted: true, emailDelivery: null });
assert.deepEqual(await credentials.requestEmailVerification("unapproved@invalid.example"), { accepted: true, emailDelivery: null });
assert.deepEqual(await credentials.requestPasswordReset("unapproved@invalid.example"), { accepted: true, emailDelivery: null });
assert.deepEqual(await credentials.signIn("unapproved@invalid.example", "Any password"), { authenticated: false, reason: "invalid-credentials" });
assert.deepEqual(blockedCalls, [], "A disallowed password flow reached the account repository.");

const identityCalls = [];
const identityRepository = Object.fromEntries([
  "resolveSocialIdentity", "completeRoleOnboarding", "activateWorkspace", "listConnectedIdentities", "connectSocialIdentity", "verifyConnectedSocialIdentity", "disconnectSocialIdentity"
].map((method) => [method, async () => { identityCalls.push(method); throw new Error("blocked identity repository call"); }]));
const identity = createIdentityService(identityRepository, { accountAccess: restricted });
assert.throws(() => identity.socialSignIn("google", { subject: "google-unapproved", email: "unapproved@invalid.example", emailVerified: true, displayName: "Unknown" }), (error) => error instanceof TypeError && error.code === "staging-account-access-unavailable" && /unavailable/.test(error.message));
assert.deepEqual(identityCalls, [], "A disallowed Google account reached social account resolution.");

const facebookCalls = [];
const facebook = createFacebookIdentityService({
  async findExistingSocialIdentity() { facebookCalls.push("find"); return null; },
  async beginPendingSocialIdentity() { facebookCalls.push("begin"); return "pending"; },
  async consumePendingSocialIdentity() { facebookCalls.push("consume"); return null; }
}, {
  tokenSecret: "staging-facebook-access-test-token-secret-12345",
  accountAccess: restricted
});
const facebookResult = await facebook.begin({ subject: "facebook-unapproved", email: "unapproved@invalid.example", emailVerified: false, displayName: "Unknown" });
assert.equal(facebookResult.authenticated, false);
assert.equal(facebookResult.verificationRequired, false);
assert.equal(facebookResult.emailDelivery, null);
assert.deepEqual(facebookCalls, ["find"], "A disallowed Facebook account created pending identity state.");

console.log("Staging account access tests passed: canonical hashed allowlist, fail-closed empty mode, generic password denial, and no Google/Facebook account writes for unapproved visitors.");
