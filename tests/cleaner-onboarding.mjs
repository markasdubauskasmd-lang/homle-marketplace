import assert from "node:assert/strict";
import { createCleanerOnboardingService, cleanerOnboardingSections, normalizedCleanerOnboardingInput } from "../src/marketplace/cleaner-onboarding.mjs";
import { decryptCleanerOnboardingPayload, encryptCleanerOnboardingPayload } from "../src/marketplace/cleaner-onboarding-crypto.mjs";
import { onboardingProgress } from "../public/cleaner-onboarding-steps.js";

const cleanerId = "11111111-1111-4111-8111-111111111111";
const actor = Object.freeze({ userId: cleanerId, roles: ["cleaner"] });
const secret = "cleaner-onboarding-test-secret-that-is-long-enough";

assert.equal(cleanerOnboardingSections.length, 18);
assert.deepEqual(normalizedCleanerOnboardingInput("personal", { status: "submitted", data: { firstName: " Ras ", livedUnderFiveYears: true } }), {
  section: "personal", status: "submitted", data: { firstName: "Ras", livedUnderFiveYears: true }, schemaVersion: 1
});
assert.throws(() => normalizedCleanerOnboardingInput("banking", { data: { sortCode: "00-00-00" } }), /Stripe/);
assert.throws(() => normalizedCleanerOnboardingInput("personal", { data: { portrait: "data:image/png;base64,abc" } }), /embedded file data/);

const encrypted = encryptCleanerOnboardingPayload({ firstName: "Ras" }, cleanerId, "personal", secret);
assert(!encrypted.includes(Buffer.from("Ras")), "The encrypted envelope must not contain plaintext onboarding data.");
assert.deepEqual(decryptCleanerOnboardingPayload(encrypted, cleanerId, "personal", secret), { firstName: "Ras" });
assert.throws(() => decryptCleanerOnboardingPayload(encrypted, cleanerId, "business", secret));
const progress = onboardingProgress({ account: {}, profile: {}, onboardingSections: [{ section: "business", status: "submitted" }, { section: "identity", status: "submitted" }] });
assert.equal(progress.steps.find((step) => step.key === "business").done, true);
assert.equal(progress.steps.find((step) => step.key === "identity").done, false, "Identity must stay incomplete until verification authority records a verified result.");

const records = new Map();
const repository = {
  async listOwnSections() { return [...records.values()]; },
  async saveOwnSection(_actor, section) {
    const record = {
      cleaner_user_id: cleanerId,
      section_code: section.section,
      payload_ciphertext: section.payloadCiphertext,
      status: section.status,
      schema_version: section.schemaVersion,
      completed_at: section.status === "submitted" ? new Date("2026-08-01T10:00:00.000Z") : null,
      updated_at: new Date("2026-08-01T10:00:00.000Z")
    };
    records.set(section.section, record);
    return record;
  }
};
const service = createCleanerOnboardingService(repository, { dataEncryptionSecret: secret });
const saved = await service.saveOwnSection(actor, "insurance", { status: "submitted", data: { provider: "Example Mutual", policyExpiry: "2027-08-01" } });
assert.equal(saved.status, "submitted");
assert.equal(saved.data.provider, "Example Mutual");
assert.equal((await service.getOwnSection(actor, "insurance")).data.policyExpiry, "2027-08-01");
assert.equal((await service.listOwnSections(actor)).length, 1);
await assert.rejects(() => service.listOwnSections({ userId: cleanerId, roles: ["landlord"] }), /Cleaner account/);

console.log("Cleaner onboarding encryption, validation and persistence service passed.");
