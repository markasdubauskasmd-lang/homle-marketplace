import { createHash } from "node:crypto";
import {
  assertCleanerOnboardingEncryptionSecret,
  decryptCleanerOnboardingDocument,
  encryptCleanerOnboardingDocument,
  encryptCleanerOnboardingPayload
} from "./cleaner-onboarding-crypto.mjs";

export const maximumCleanerOnboardingDocumentBytes = 20 * 1024 * 1024;
export const cleanerOnboardingDocumentMimeTypes = Object.freeze(["application/pdf", "image/jpeg", "image/png"]);

export const cleanerOnboardingDocumentTypes = Object.freeze({
  identity: Object.freeze(["passportPhoto", "licenceFront", "licenceBack", "birthCertificate", "residencePermit"]),
  dbs: Object.freeze(["dbsCertificate"]),
  experience: Object.freeze(["cv", "cleaningCertificates", "coshhCertificate", "healthSafetyCertificate"]),
  references: Object.freeze(["referenceLetters"]),
  insurance: Object.freeze(["publicLiabilityPolicy", "professionalIndemnityPolicy", "employersLiabilityPolicy"]),
  banking: Object.freeze(["invoiceTemplate"])
});

const allowedTypesBySection = new Map(Object.entries(cleanerOnboardingDocumentTypes).map(([section, types]) => [section, new Set(types)]));

function requireCleaner(actor, action) {
  if (!actor?.userId || !actor.roles?.includes("cleaner")) throw Object.assign(new Error(`A Cleaner account is required to ${action}.`), { statusCode: 403, code: "role-rejected" });
}

function normalizedSection(value) {
  const section = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!allowedTypesBySection.has(section)) throw Object.assign(new Error("Choose a supported onboarding document section."), { statusCode: 422, code: "invalid-document-section" });
  return section;
}

function normalizedDocumentType(section, value) {
  const documentType = typeof value === "string" ? value.trim() : "";
  if (!allowedTypesBySection.get(section)?.has(documentType)) throw Object.assign(new Error("Choose a supported document type for this onboarding step."), { statusCode: 422, code: "invalid-document-type" });
  return documentType;
}

function normalizedMimeType(value) {
  const mimeType = typeof value === "string" ? value.split(";", 1)[0].trim().toLowerCase() : "";
  if (!cleanerOnboardingDocumentMimeTypes.includes(mimeType)) throw Object.assign(new Error("Choose a PDF, JPEG or PNG document."), { statusCode: 422, code: "invalid-document-mime-type" });
  return mimeType;
}

function safeFilename(value, mimeType) {
  const fallback = mimeType === "application/pdf" ? "document.pdf" : mimeType === "image/png" ? "document.png" : "document.jpg";
  const filename = typeof value === "string"
    ? value.normalize("NFKC").replace(/[\\/\u0000-\u001f\u007f]/g, "").trim().slice(0, 255)
    : "";
  return filename || fallback;
}

function hasExpectedSignature(bytes, mimeType) {
  if (mimeType === "application/pdf") return bytes.length >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  if (mimeType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return bytes.length >= 8 && Buffer.compare(bytes.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) === 0;
}

function metadata(record) {
  if (!record) return null;
  return Object.freeze({
    id: record.id,
    section: record.section_code || record.section,
    documentType: record.document_type || record.documentType,
    filename: record.original_filename || record.filename,
    mimeType: record.mime_type || record.mimeType,
    sizeBytes: Number(record.size_bytes ?? record.sizeBytes),
    checksumSha256: record.checksum_sha256 || record.checksumSha256,
    status: record.status,
    expiresOn: record.expires_on || record.expiresOn || null,
    createdAt: new Date(record.created_at || record.createdAt).toISOString(),
    updatedAt: new Date(record.updated_at || record.updatedAt).toISOString()
  });
}

export function createCleanerOnboardingDocumentService(repository, options = {}) {
  if (!repository || !["listOwnDocuments", "saveOwnDocument", "getOwnDocument", "deleteOwnDocument"].every((method) => typeof repository[method] === "function")) throw new TypeError("A complete Cleaner onboarding document repository is required.");
  const secret = options.dataEncryptionSecret;
  assertCleanerOnboardingEncryptionSecret(secret);

  return Object.freeze({
    async listOwnDocuments(actor, sectionValue) {
      requireCleaner(actor, "view onboarding documents");
      const section = sectionValue ? normalizedSection(sectionValue) : null;
      return (await repository.listOwnDocuments(actor, section)).map(metadata);
    },
    async saveOwnDocument(actor, sectionValue, documentTypeValue, input = {}) {
      requireCleaner(actor, "upload onboarding documents");
      const section = normalizedSection(sectionValue);
      const documentType = normalizedDocumentType(section, documentTypeValue);
      const mimeType = normalizedMimeType(input.mimeType);
      const bytes = Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.from(input.bytes || []);
      if (bytes.length < 1 || bytes.length > maximumCleanerOnboardingDocumentBytes) throw Object.assign(new Error("The document must be no larger than 20 MB."), { statusCode: 413, code: "document-too-large" });
      if (!hasExpectedSignature(bytes, mimeType)) throw Object.assign(new Error("The document contents do not match the selected PDF, JPEG or PNG file type."), { statusCode: 422, code: "document-signature-mismatch" });
      const filename = safeFilename(input.filename, mimeType);
      const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
      const contentCiphertext = encryptCleanerOnboardingDocument(bytes, actor.userId, section, documentType, secret);
      const objectKeyCiphertext = encryptCleanerOnboardingPayload({ storage: "render-postgres" }, actor.userId, `document:${section}:${documentType}`, secret);
      return metadata(await repository.saveOwnDocument(actor, { section, documentType, filename, mimeType, sizeBytes: bytes.length, checksumSha256, contentCiphertext, objectKeyCiphertext }));
    },
    async getOwnDocument(actor, sectionValue, documentTypeValue) {
      requireCleaner(actor, "download onboarding documents");
      const section = normalizedSection(sectionValue);
      const documentType = normalizedDocumentType(section, documentTypeValue);
      const record = await repository.getOwnDocument(actor, section, documentType);
      if (!record) return null;
      const bytes = decryptCleanerOnboardingDocument(record.content_ciphertext || record.contentCiphertext, actor.userId, section, documentType, secret);
      const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
      if (checksumSha256 !== (record.checksum_sha256 || record.checksumSha256) || bytes.length !== Number(record.size_bytes ?? record.sizeBytes)) throw Object.assign(new Error("The stored document failed its integrity check."), { statusCode: 500, code: "document-integrity-failed" });
      return Object.freeze({ ...metadata(record), bytes });
    },
    async deleteOwnDocument(actor, sectionValue, documentTypeValue) {
      requireCleaner(actor, "delete onboarding documents");
      const section = normalizedSection(sectionValue);
      const documentType = normalizedDocumentType(section, documentTypeValue);
      return metadata(await repository.deleteOwnDocument(actor, section, documentType));
    }
  });
}
