import assert from "node:assert/strict";
import { cleanerSubmissionReadiness, createCleanerOnboardingService, cleanerOnboardingSections, normalizedCleanerOnboardingInput, requiredCleanerSubmissionSections } from "../src/marketplace/cleaner-onboarding.mjs";
import { decryptCleanerOnboardingPayload, encryptCleanerOnboardingPayload } from "../src/marketplace/cleaner-onboarding-crypto.mjs";
import { onboardingProgress } from "../public/cleaner-onboarding-steps.js";

const cleanerId = "11111111-1111-4111-8111-111111111111";
const actor = Object.freeze({ userId: cleanerId, roles: ["cleaner"] });
const secret = "cleaner-onboarding-test-secret-that-is-long-enough";

assert.equal(cleanerOnboardingSections.length, 19);
assert(cleanerOnboardingSections.includes("review"));
assert.equal(cleanerSubmissionReadiness([]).ready, false);
assert.deepEqual(cleanerSubmissionReadiness([]).missingSections, [...requiredCleanerSubmissionSections]);
assert.deepEqual(normalizedCleanerOnboardingInput("personal", { status: "submitted", data: { firstName: " Ras ", livedUnderFiveYears: true } }), {
  section: "personal", status: "submitted", data: { firstName: "Ras", livedUnderFiveYears: true }, schemaVersion: 1
});
assert.deepEqual(normalizedCleanerOnboardingInput("business", { status: "submitted", data: { serviceType: "beautician", businessType: "business", businessName: " Glow Studio " } }).data, {
  serviceType: "beautician", businessType: "business", businessName: "Glow Studio"
});
assert.deepEqual(normalizedCleanerOnboardingInput("rtw", { status: "submitted", data: { britishOrIrishCitizen: "no", shareCode: " W12 345 678 ", rightToWorkDateOfBirth: "1990-01-02", rightToWorkConsent: true } }).data, {
  britishOrIrishCitizen: "no", shareCode: "W12 345 678", rightToWorkDateOfBirth: "1990-01-02", rightToWorkConsent: true
});
assert.deepEqual(normalizedCleanerOnboardingInput("rtw", { status: "submitted", data: { britishOrIrishCitizen: "yes", nationalInsuranceNumber: " AB 12 34 56 C ", rightToWorkConsent: true } }).data, {
  britishOrIrishCitizen: "yes", nationalInsuranceNumber: "AB 12 34 56 C", rightToWorkConsent: true
});
const previousAddress = { postcode: "SW1A 1AA", houseNumber: "10", street: "Example Road", town: "London", county: "Greater London", country: "United Kingdom", fromMonth: "02", fromYear: "2022", yearsLived: "2.5" };
assert.deepEqual(normalizedCleanerOnboardingInput("personal", { status: "submitted", data: { livedUnderFiveYears: true, previousAddresses: [previousAddress] } }).data.previousAddresses, [previousAddress]);
assert.throws(() => normalizedCleanerOnboardingInput("banking", { data: { sortCode: "00-00-00" } }), /Stripe/);
assert.throws(() => normalizedCleanerOnboardingInput("personal", { data: { portrait: "data:image/png;base64,abc" } }), /embedded file data/);

const encrypted = encryptCleanerOnboardingPayload({ firstName: "Ras" }, cleanerId, "personal", secret);
assert(!encrypted.includes(Buffer.from("Ras")), "The encrypted envelope must not contain plaintext onboarding data.");
assert.deepEqual(decryptCleanerOnboardingPayload(encrypted, cleanerId, "personal", secret), { firstName: "Ras" });
assert.throws(() => decryptCleanerOnboardingPayload(encrypted, cleanerId, "business", secret));
const unsignedPersonalProgress = onboardingProgress({ account: { displayName: "Ras", email: "ras@example.com" }, profile: {}, onboardingSections: [] });
assert.equal(unsignedPersonalProgress.steps.find((step) => step.key === "personal").done, false, "Account details alone must not show a Personal Details completion tick.");
const progress = onboardingProgress({ account: {}, profile: {}, onboardingSections: [{ section: "personal", status: "submitted" }, { section: "business", status: "submitted" }, { section: "identity", status: "submitted" }] });
assert.equal(progress.steps.find((step) => step.key === "personal").done, true, "Save & continue must mark Personal Details complete.");
assert.equal(progress.steps.find((step) => step.key === "business").done, true);
assert.equal(progress.steps.find((step) => step.key === "identity").done, true, "A submitted Identity section must show that its onboarding stage is complete while verification can remain pending.");
const verifiedLegacyProgress = onboardingProgress({ account: {}, profile: { identityCheckStatus: "verified", backgroundCheckStatus: "verified" }, onboardingSections: [] });
assert.equal(verifiedLegacyProgress.steps.find((step) => step.key === "identity").done, true);
assert.equal(verifiedLegacyProgress.steps.find((step) => step.key === "dbs").done, true);

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
const savedPersonal = await service.saveOwnSection(actor, "personal", { status: "submitted", data: { livedUnderFiveYears: true, previousAddresses: [previousAddress] } });
assert.deepEqual(savedPersonal.data.previousAddresses, [previousAddress]);
assert.deepEqual((await service.getOwnSection(actor, "personal")).data.previousAddresses, [previousAddress]);
const savedBusiness = await service.saveOwnSection(actor, "business", { status: "submitted", data: { serviceType: "beautician", businessType: "business", businessName: "Glow Studio" } });
assert.deepEqual(savedBusiness.data, { serviceType: "beautician", businessType: "business", businessName: "Glow Studio" });
assert.deepEqual((await service.getOwnSection(actor, "business")).data, savedBusiness.data);
const savedRightToWork = await service.saveOwnSection(actor, "rtw", { status: "submitted", data: { britishOrIrishCitizen: "no", shareCode: "W12 345 678", rightToWorkDateOfBirth: "1990-01-02", rightToWorkConsent: true } });
assert.deepEqual((await service.getOwnSection(actor, "rtw")).data, savedRightToWork.data);
await assert.rejects(() => service.submitOwnApplication(actor, { confirmed: false }), /Confirm/);
await assert.rejects(() => service.submitOwnApplication(actor, { confirmed: true }), (error) => error.code === "onboarding-incomplete" && error.missingSections.includes("identity"));
for (const section of requiredCleanerSubmissionSections) {
  if (!records.has(section)) await service.saveOwnSection(actor, section, { status: "submitted", data: { recorded: true } });
}
const readiness = await service.getSubmissionReadiness(actor);
assert.equal(readiness.ready, true);
assert.equal(readiness.submitted, false);
const submission = await service.submitOwnApplication(actor, { confirmed: true });
assert.equal(submission.section, "review");
assert.equal(submission.status, "submitted");
assert.equal(submission.data.applicationStatus, "awaiting-review");
assert.equal(submission.data.confirmed, true);
assert.equal(Number.isNaN(Date.parse(submission.data.submittedAt)), false);
assert.equal((await service.getSubmissionReadiness(actor)).submitted, true);
assert.equal((await service.submitOwnApplication(actor, { confirmed: true })).replayed, true);
await assert.rejects(() => service.listOwnSections({ userId: cleanerId, roles: ["landlord"] }), /Cleaner account/);

console.log("Cleaner onboarding encryption, validation and persistence service passed.");
