import assert from "node:assert/strict";
import { createCleanerOnboardingDocumentService, maximumCleanerOnboardingDocumentBytes } from "../src/marketplace/cleaner-onboarding-document.mjs";

const cleanerId = "11111111-1111-4111-8111-111111111111";
const actor = Object.freeze({ userId: cleanerId, roles: ["cleaner"] });
const secret = "cleaner-onboarding-document-test-secret-long-enough";
const records = new Map();
const key = (section, documentType) => `${section}:${documentType}`;
const repository = {
  async listOwnDocuments(_actor, section) { return [...records.values()].filter((record) => (!section || record.section_code === section) && record.status !== "deleted"); },
  async saveOwnDocument(_actor, document) {
    const existing = records.get(key(document.section, document.documentType));
    const record = {
      id: existing?.id || "22222222-2222-4222-8222-222222222222",
      section_code: document.section,
      document_type: document.documentType,
      original_filename: document.filename,
      mime_type: document.mimeType,
      size_bytes: document.sizeBytes,
      checksum_sha256: document.checksumSha256,
      status: "uploaded",
      expires_on: null,
      content_ciphertext: document.contentCiphertext,
      object_key_ciphertext: document.objectKeyCiphertext,
      created_at: existing?.created_at || "2026-08-05T10:00:00.000Z",
      updated_at: "2026-08-05T10:00:00.000Z"
    };
    records.set(key(document.section, document.documentType), record);
    return record;
  },
  async getOwnDocument(_actor, section, documentType) {
    const record = records.get(key(section, documentType));
    return record?.status === "deleted" ? null : record;
  },
  async deleteOwnDocument(_actor, section, documentType) {
    const record = records.get(key(section, documentType));
    if (!record) return null;
    record.status = "deleted";
    record.content_ciphertext = null;
    return record;
  }
};

const service = createCleanerOnboardingDocumentService(repository, { dataEncryptionSecret: secret });
const pdf = Buffer.from("%PDF-1.7\nprivate passport bytes\n%%EOF", "utf8");
const saved = await service.saveOwnDocument(actor, "identity", "passportPhoto", { filename: "passport.pdf", mimeType: "application/pdf", bytes: pdf });
assert.equal(saved.filename, "passport.pdf");
assert.equal(saved.sizeBytes, pdf.length);
assert.equal(records.get("identity:passportPhoto").content_ciphertext.includes(Buffer.from("private passport bytes")), false, "Document bytes must be encrypted before reaching PostgreSQL.");
assert.equal(records.get("identity:passportPhoto").object_key_ciphertext.includes(Buffer.from("render-postgres")), false, "The storage locator must not be plaintext.");
assert.equal((await service.listOwnDocuments(actor, "identity")).length, 1);
assert.deepEqual((await service.getOwnDocument(actor, "identity", "passportPhoto")).bytes, pdf);
const rightToWorkPassport = await service.saveOwnDocument(actor, "rtw", "rightToWorkPassport", { filename: "right-to-work.pdf", mimeType: "application/pdf", bytes: pdf });
assert.equal(rightToWorkPassport.section, "rtw");
assert.deepEqual((await service.getOwnDocument(actor, "rtw", "rightToWorkPassport")).bytes, pdf);
const rightToWorkBirthCertificate = await service.saveOwnDocument(actor, "rtw", "rightToWorkBirthCertificate", { filename: "birth-certificate.pdf", mimeType: "application/pdf", bytes: pdf });
assert.equal(rightToWorkBirthCertificate.documentType, "rightToWorkBirthCertificate");
assert.deepEqual((await service.getOwnDocument(actor, "rtw", "rightToWorkBirthCertificate")).bytes, pdf);
await assert.rejects(() => service.saveOwnDocument(actor, "identity", "unknown", { filename: "x.pdf", mimeType: "application/pdf", bytes: pdf }), /supported document type/);
await assert.rejects(() => service.saveOwnDocument(actor, "identity", "passportPhoto", { filename: "x.png", mimeType: "image/png", bytes: pdf }), /contents do not match/);
await assert.rejects(() => service.saveOwnDocument(actor, "identity", "passportPhoto", { filename: "x.pdf", mimeType: "application/pdf", bytes: Buffer.alloc(maximumCleanerOnboardingDocumentBytes + 1) }), /20 MB/);
await assert.rejects(() => service.listOwnDocuments({ userId: cleanerId, roles: ["landlord"] }), /Cleaner account/);
assert.equal((await service.deleteOwnDocument(actor, "identity", "passportPhoto")).status, "deleted");
assert.equal(await service.getOwnDocument(actor, "identity", "passportPhoto"), null);

console.log("Cleaner onboarding document tests passed: encrypted database bytes, type/signature limits, owner isolation, download integrity and deletion.");
