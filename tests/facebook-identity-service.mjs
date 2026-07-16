import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createFacebookIdentityService } from "../src/marketplace/facebook-identity-service.mjs";

const calls = [];
let existing = null;
let beginState = "pending";
let consumed = null;
const repository = {
  async findExistingSocialIdentity(provider, subject) { calls.push({ kind: "find", provider, subject }); return existing; },
  async beginPendingSocialIdentity(input) { calls.push({ kind: "begin", input }); return beginState; },
  async consumePendingSocialIdentity(hash) { calls.push({ kind: "consume", hash }); return consumed; }
};
const service = createFacebookIdentityService(repository, { tokenSecret: "facebook-verification-secret-more-than-thirty-two-characters", clock: () => new Date("2026-07-16T12:00:00.000Z"), verificationTtlSeconds: 3600 });
const claims = { subject: "facebook-subject", email: "Owner@Example.com", emailVerified: false, displayName: "Property Owner", avatarUrl: "https://images.example.com/owner.jpg" };

existing = { user_id: "account-existing", email: "owner@example.com", email_verified_at: "2026-07-15T12:00:00.000Z", display_name: "Property Owner", selected_role: "landlord", roles: ["landlord"] };
const repeat = await service.begin(claims);
assert.equal(repeat.authenticated, true);
assert.equal(repeat.account.userId, "account-existing");
assert(!calls.some((call) => call.kind === "begin"));

existing = null;
const pending = await service.begin(claims);
assert.equal(pending.authenticated, false);
assert.equal(pending.verificationRequired, true);
assert.equal(pending.emailDelivery.kind, "facebook-email-verification");
assert.equal(pending.emailDelivery.recipient, "owner@example.com");
assert.equal(pending.emailDelivery.expiresAt, "2026-07-16T13:00:00.000Z");
assert.match(pending.emailDelivery.token, /^[A-Za-z0-9_-]+$/);
assert.equal(calls.at(-1).input.provider, "facebook");
assert.equal(calls.at(-1).input.email, "owner@example.com");
assert(Buffer.isBuffer(calls.at(-1).input.verificationHash) && calls.at(-1).input.verificationHash.length === 32);

consumed = { user_id: "account-new", email: "owner@example.com", email_verified_at: "2026-07-16T12:05:00.000Z", display_name: "Property Owner", selected_role: null, roles: [] };
const verified = await service.verify(pending.emailDelivery.token);
assert.equal(verified.verified, true);
assert.equal(verified.account.userId, "account-new");
assert(Buffer.isBuffer(calls.at(-1).hash) && calls.at(-1).hash.length === 32);
assert.equal((await service.verify("malformed token")).verified, false);

const missingEmail = await service.begin({ ...claims, subject: "no-email", email: null });
assert.equal(missingEmail.reason, "facebook-email-unavailable");
assert.equal(missingEmail.emailDelivery, null);
await assert.rejects(() => service.begin({ ...claims, emailVerified: true }), /remain unverified/);

beginState = "existing";
existing = { ...consumed, user_id: "raced-account" };
const raced = await service.begin({ ...claims, subject: "raced-subject" });
assert.equal(raced.authenticated, true);
assert.equal(raced.account.userId, "raced-account");

consumed = null;
const collision = await service.verify(pending.emailDelivery.token);
assert.deepEqual(collision, { verified: false, reason: "existing-account-requires-sign-in" });
assert.throws(() => createFacebookIdentityService({}, { tokenSecret: "x" }), /complete pending-identity repository/);

const migration = await readFile(new URL("../db/migrations/021_facebook_pending_identity.sql", import.meta.url), "utf8");
const runtimeGrants = await readFile(new URL("../db/runtime-role-grants.sql", import.meta.url), "utf8");
const workerGrants = await readFile(new URL("../db/worker-role-grants.sql", import.meta.url), "utf8");
for (const evidence of [
  "CREATE TABLE tideway_private.pending_social_identities",
  "provider_email_verified = true",
  "resolved_verified_at IS NULL OR has_password_identity",
  "lookup_existing_social_identity",
  "begin_pending_social_identity",
  "consume_pending_social_identity",
  "FOR UPDATE SKIP LOCKED",
  "purge_expired_pending_social_identities",
  "facebook-verification-confirm",
  "REVOKE ALL ON TABLE tideway_private.pending_social_identities FROM PUBLIC"
]) assert(migration.includes(evidence), `Facebook pending-identity migration omitted ${evidence}.`);
assert(runtimeGrants.includes("consume_pending_social_identity(bytea) TO tideway_app") && runtimeGrants.includes("REVOKE ALL ON TABLE tideway_private.pending_social_identities FROM tideway_app"));
assert(workerGrants.includes("purge_expired_pending_social_identities(integer) TO tideway_worker"));

console.log("Facebook identity tests passed: existing-subject reuse, provider-email distrust, Homle mailbox verification, pending-token hashing, race recovery and password-account collision boundary.");
