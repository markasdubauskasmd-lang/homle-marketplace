import assert from "node:assert/strict";
import { createAdministratorVerificationService } from "../src/marketplace/administrator-verification-service.mjs";

const cleanerId = "22222222-2222-4222-8222-222222222222";
const admin = { userId: "44444444-4444-4444-8444-444444444444", roles: ["administrator"] };
const landlord = { userId: "11111111-1111-4111-8111-111111111111", roles: ["landlord"] };

const calls = [];
const repository = {
  async listQueue(actor, input) { calls.push({ kind: "list", actor, input }); return { cleaners: [{ cleanerId, displayName: "Test Cleaner", identityCheckStatus: "pending", backgroundCheckStatus: "not-checked", isPublic: false, updatedAt: "2026-07-19T10:00:00.000Z" }], limit: input.limit, offset: input.offset }; },
  async setVerification(actor, input) { calls.push({ kind: "set", actor, input }); return { cleanerId, identityCheckStatus: input.identityCheckStatus || "pending", backgroundCheckStatus: input.backgroundCheckStatus || "not-checked" }; }
};
const service = createAdministratorVerificationService(repository);

async function rejects(operation, codeOrFragment) {
  try { await operation(); return false; } catch (error) { return String(error.code || error.message).includes(codeOrFragment); }
}

// Administrator lists the queue with a validated view and pagination.
const page = await service.list(admin, { view: "awaiting", limit: "25", offset: "0" });
assert(page.cleaners.length === 1 && page.cleaners[0].cleanerId === cleanerId && page.cleaners[0].identityCheckStatus === "pending" && Object.isFrozen(page.cleaners), "The verification queue projection was not validated and frozen.");
assert(calls[0].input.view === "awaiting" && calls[0].input.limit === 25, "The view or page size was not canonicalised for the repository.");

// Non-administrators are refused on both operations.
assert(await rejects(() => service.list(landlord, {}), "administrator-required"), "A landlord could read the verification queue.");
assert(await rejects(() => service.set(landlord, cleanerId, { identityCheckStatus: "verified" }), "administrator-required"), "A landlord could set a verification status.");

// An Administrator sets a status; invalid statuses and empty changes are rejected.
const set = await service.set(admin, cleanerId, { identityCheckStatus: "verified", backgroundCheckStatus: "not-required", note: "Reviewed passport and DBS." });
assert(set.identityCheckStatus === "verified" && set.backgroundCheckStatus === "not-required" && calls.at(-1).input.cleanerId === cleanerId && calls.at(-1).input.note.includes("passport"), "A valid Administrator verification was not passed through to the repository.");
assert(await rejects(() => service.set(admin, cleanerId, {}), "identity or background"), "An empty verification change was accepted.");
assert(await rejects(() => service.set(admin, cleanerId, { identityCheckStatus: "invented" }), "supported identity"), "An invalid identity status was accepted.");
assert(await rejects(() => service.set(admin, cleanerId, { backgroundCheckStatus: "invented" }), "supported background"), "An invalid background status was accepted.");
assert(await rejects(() => service.set(admin, "not-a-uuid", { identityCheckStatus: "verified" }), "valid cleaner"), "A malformed cleaner id was accepted.");

// A long note is bounded before it reaches the repository.
await service.set(admin, cleanerId, { identityCheckStatus: "pending", note: "x".repeat(900) });
assert(calls.at(-1).input.note.length === 500, "The verification note was not bounded to 500 characters.");

assert.throws(() => createAdministratorVerificationService({}), /complete Administrator verification repository/);

console.log("Administrator verification service tests passed: administrator-only access, validated statuses, bounded note and canonical queue projection.");

/* ── The evidence behind a vetting decision ────────────────────────────── */

// Approving a Cleaner is what puts a stranger in a customer's home, and it was
// being done against a name and two status strings. This is the read that
// makes the decision an informed one.
{
  const { encryptCleanerOnboardingPayload } = await import("../src/marketplace/cleaner-onboarding-crypto.mjs");
  const secret = "verification-review-encryption-secret-over-32-characters";
  const identity = { fullName: "A Cleaner", documentNumber: "X1234567" };
  const readable = encryptCleanerOnboardingPayload(identity, cleanerId, "identity", secret).toString("base64");
  // Encrypted for a DIFFERENT section, so its associated data will not
  // authenticate here. This is what a tampered or mis-filed row looks like.
  const unreadable = encryptCleanerOnboardingPayload(identity, cleanerId, "tax", secret).toString("base64");

  const applicationCalls = [];
  const withApplication = {
    ...repository,
    async getApplication(actor, requestedCleanerId) {
      applicationCalls.push({ actor, cleanerId: requestedCleanerId });
      return {
        cleanerId: requestedCleanerId,
        sections: [
          { section: "identity", payloadCiphertext: readable, status: "submitted", schemaVersion: 1, completedAt: "2026-07-19T09:00:00.000Z", updatedAt: "2026-07-19T09:00:00.000Z" },
          { section: "rtw", payloadCiphertext: unreadable, status: "submitted", schemaVersion: 1, completedAt: "2026-07-19T09:00:00.000Z", updatedAt: "2026-07-19T09:00:00.000Z" }
        ],
        documents: [
          { documentId: "33333333-3333-4333-8333-333333333333", section: "identity", documentType: "passport", originalFilename: "passport.pdf", mimeType: "application/pdf", sizeBytes: 5000, checksumSha256: "a".repeat(64), status: "pending", expiresOn: "2030-01-01", createdAt: "2026-07-19T09:00:00.000Z" }
        ]
      };
    }
  };
  const reviewing = createAdministratorVerificationService(withApplication, { dataEncryptionSecret: secret });

  const application = await reviewing.getApplication(admin, cleanerId.toUpperCase());
  assert.equal(applicationCalls[0].cleanerId, cleanerId, "The cleaner id was not normalised before the database read.");
  assert.equal(application.sections[0].readable, true);
  assert.deepEqual(application.sections[0].data, identity, "The Administrator could not read the submitted evidence.");

  // A section that cannot be decrypted is reported as unreadable, never
  // omitted. Silently dropping it would make an incomplete application look
  // complete, which is the exact failure this feature exists to stop.
  assert.equal(application.sections[1].readable, false);
  assert.equal(application.sections[1].data, null);
  assert.equal(application.sections.length, 2, "An undecryptable section was dropped instead of flagged.");

  assert.equal(application.documents[0].documentType, "passport");
  // Metadata only. A queue page must not pull a stack of identity scans into
  // memory as a side effect of being opened.
  assert.ok(!JSON.stringify(application.documents).includes("objectKey") && !JSON.stringify(application.documents).includes("ciphertext"),
    "The application review exposed document storage keys or ciphertext.");

  assert.ok(await rejects(() => reviewing.getApplication(landlord, cleanerId), "administrator-required"), "A Landlord read a Cleaner application.");
  assert.ok(await rejects(() => reviewing.getApplication(admin, "not-a-uuid"), "valid cleaner"), "An invalid cleaner id was accepted.");

  // Without the encryption secret the review reports itself unavailable rather
  // than the vetting screen failing to load at all.
  const withoutSecret = createAdministratorVerificationService(withApplication);
  assert.ok(await rejects(() => withoutSecret.getApplication(admin, cleanerId), "application-review-unavailable"),
    "A deployment without the encryption secret did not degrade cleanly.");
  // And the queue itself still works there.
  assert.equal((await withoutSecret.list(admin, { view: "awaiting" })).cleaners.length, 1);
}
console.log("Cleaner application review checks passed: decrypted evidence, undecryptable sections flagged rather than dropped, metadata-only documents, role gate and clean degradation.");
