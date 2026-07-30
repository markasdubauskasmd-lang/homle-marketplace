import { randomUUID } from "node:crypto";
import { uuid } from "./validation.mjs";

const sectionCodes = new Set([
  "personal-details", "business-details", "identity-verification", "background-checks",
  "work-areas", "experience", "references", "insurance", "availability",
  "banking", "equipment", "documents", "settings"
]);
const completionStatuses = new Set(["draft", "complete", "submitted", "verified", "needs-action"]);
const documentMimeTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);
const documentTypes = new Set([
  "passport", "driving-licence", "dbs-certificate", "public-liability",
  "birth-certificate", "residence-permit", "right-to-work", "proof-of-address",
  "cv", "ni-confirmation", "reference-letter", "professional-indemnity",
  "employers-liability", "training-certificate", "invoice-template", "other"
]);
const modulePattern = /^[a-z][a-z0-9-]{1,79}$/;
const agreementPattern = /^[a-z][a-z0-9-]{1,79}$/;
const checksumPattern = /^[0-9a-f]{64}$/;

function text(value, maximum, label, minimum = 0) {
  const normalized = typeof value === "string" ? value.trim().replace(/[\u0000-\u001f\u007f]/g, "") : "";
  if (normalized.length < minimum || normalized.length > maximum) throw new TypeError(`${label} must contain ${minimum} to ${maximum} characters.`);
  return normalized;
}
function integer(value, minimum, maximum, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) throw new TypeError(`${label} is outside the supported range.`);
  return number;
}
function requireCleaner(actor, action) {
  if (!actor?.userId || !actor.roles?.includes("cleaner")) throw new TypeError(`A Cleaner account is required to ${action}.`);
}
function sectionCode(value) {
  const selected = text(value, 64, "Onboarding section", 1).toLowerCase();
  if (!sectionCodes.has(selected)) throw new TypeError("This Cleaner data section is not supported.");
  return selected;
}
function jsonObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Cleaner section data must be an object.");
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, "utf8") > 60_000) throw new TypeError("Cleaner section data is too large.");
  return JSON.parse(encoded);
}
function projectedSection(record, selected) {
  return Object.freeze({
    sectionCode: record?.sectionCode || selected,
    payload: record?.payload && typeof record.payload === "object" ? record.payload : {},
    completionStatus: record?.completionStatus || "draft",
    updatedAt: record?.updatedAt ? new Date(record.updatedAt).toISOString() : null
  });
}
function signedUrl(value) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error("Private document storage is temporarily unavailable."); }
  if (parsed.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(parsed.hostname)) throw new Error("Private document storage is temporarily unavailable.");
  return parsed.toString();
}
function unavailable() {
  return Object.assign(new Error("Private document storage is temporarily unavailable."), { statusCode: 503, code: "cleaner-document-storage-unavailable" });
}
function storageAdapter(value) {
  if (!value || !["createPrivateUploadUrl", "headObject", "createPrivateReadUrl"].every((method) => typeof value[method] === "function")) throw unavailable();
  return value;
}
function trainingProjection(row) {
  return Object.freeze({
    moduleCode: row.module_code,
    status: row.status,
    completedLessons: Number(row.completed_lessons),
    totalLessons: Number(row.total_lessons),
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    updatedAt: new Date(row.updated_at).toISOString()
  });
}
function agreementProjection(row) {
  return Object.freeze({
    agreementCode: row.agreement_code,
    policyVersion: row.policy_version,
    signedName: row.signed_name,
    signedAt: new Date(row.signed_at).toISOString()
  });
}
function documentProjection(record) {
  return Object.freeze({
    documentId: record.documentId,
    documentType: record.documentType,
    originalFileName: record.originalFileName,
    mimeType: record.mimeType,
    byteSize: record.byteSize,
    status: record.status,
    expiresAt: record.expiresAt || null,
    uploadedAt: record.uploadedAt || null,
    verifiedAt: record.verifiedAt || null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  });
}

export function createCleanerDashboardService(repository, options = {}) {
  if (!repository || !["getSection", "saveSection", "listDocuments", "createDocumentIntent", "getDocument", "completeDocument", "listTraining", "saveTraining", "listAgreements", "signAgreement"].every((method) => typeof repository[method] === "function")) throw new TypeError("A complete Cleaner dashboard repository is required.");
  const storage = options.objectStorage || null;
  const now = typeof options.now === "function" ? options.now : () => new Date();
  const createId = typeof options.createId === "function" ? options.createId : randomUUID;
  return Object.freeze({
    async getSection(actor, code) {
      requireCleaner(actor, "view onboarding data");
      const selected = sectionCode(code);
      return projectedSection(await repository.getSection(actor, selected), selected);
    },
    async saveSection(actor, code, input = {}) {
      requireCleaner(actor, "save onboarding data");
      const selected = sectionCode(code);
      const completionStatus = text(input.completionStatus || "draft", 20, "Completion status", 1).toLowerCase();
      if (!completionStatuses.has(completionStatus)) throw new TypeError("Completion status is invalid.");
      return projectedSection(await repository.saveSection(actor, { sectionCode: selected, payload: jsonObject(input.payload), completionStatus }), selected);
    },
    async listDocuments(actor) {
      requireCleaner(actor, "view documents");
      return (await repository.listDocuments(actor)).map(documentProjection);
    },
    async createDocumentIntent(actor, input = {}) {
      requireCleaner(actor, "upload documents");
      const adapter = storageAdapter(storage);
      const documentType = text(input.documentType, 64, "Document type", 1).toLowerCase();
      if (!documentTypes.has(documentType)) throw new TypeError("Choose a supported document type.");
      const originalFileName = text(input.originalFileName, 180, "Document file name", 1);
      if (/[\/\\]/.test(originalFileName)) throw new TypeError("Document file name is invalid.");
      const mimeType = text(input.mimeType, 40, "Document MIME type", 1).toLowerCase();
      if (!documentMimeTypes.has(mimeType)) throw new TypeError("Choose a PDF, JPEG or PNG document.");
      const checksumSha256 = text(input.checksumSha256, 64, "Document checksum", 64).toLowerCase();
      if (!checksumPattern.test(checksumSha256)) throw new TypeError("Document checksum must be a lowercase SHA-256 value.");
      const documentId = uuid(createId(), "generated document id");
      const issuedAt = now();
      if (!(issuedAt instanceof Date) || !Number.isFinite(issuedAt.getTime())) throw unavailable();
      const uploadExpiresAt = new Date(issuedAt.getTime() + 10 * 60_000).toISOString();
      const record = await repository.createDocumentIntent(actor, {
        documentId,
        documentType,
        originalFileName,
        storageKey: `cleaner-documents/${actor.userId.toLowerCase()}/${documentId}`,
        mimeType,
        byteSize: integer(input.byteSize, 1, 20_000_000, "Document size"),
        checksumSha256,
        uploadExpiresAt
      });
      let signed;
      try {
        signed = await adapter.createPrivateUploadUrl({
          storageKey: record.storageKey,
          mimeType: record.mimeType,
          byteSize: record.byteSize,
          checksumSha256: record.checksumSha256,
          expiresAt: record.uploadExpiresAt
        });
      } catch { throw unavailable(); }
      return Object.freeze({ documentId, uploadUrl: signedUrl(signed?.url), method: "PUT", expiresAt: record.uploadExpiresAt, requiredHeaders: signed.requiredHeaders });
    },
    async completeDocument(actor, documentId) {
      requireCleaner(actor, "complete document uploads");
      const adapter = storageAdapter(storage);
      const selectedId = uuid(documentId, "document id");
      const record = await repository.getDocument(actor, selectedId);
      if (!record) throw Object.assign(new Error("The private document was not found."), { statusCode: 404, code: "cleaner-document-not-found" });
      if (record.status !== "uploading") return documentProjection(record);
      if (new Date(record.uploadExpiresAt) <= now()) throw Object.assign(new Error("This document upload expired. Start a new upload."), { statusCode: 409, code: "cleaner-document-upload-expired" });
      let object;
      try { object = await adapter.headObject({ storageKey: record.storageKey }); } catch { throw unavailable(); }
      if (Number(object?.byteSize) !== record.byteSize || String(object?.mimeType || "").toLowerCase() !== record.mimeType || String(object?.checksumSha256 || "").toLowerCase() !== record.checksumSha256) {
        throw Object.assign(new Error("The uploaded document does not match its declared size, type and checksum."), { statusCode: 409, code: "cleaner-document-mismatch" });
      }
      return documentProjection(await repository.completeDocument(actor, selectedId));
    },
    async getDocumentAccess(actor, documentId) {
      requireCleaner(actor, "open documents");
      const adapter = storageAdapter(storage);
      const selectedId = uuid(documentId, "document id");
      const record = await repository.getDocument(actor, selectedId);
      if (!record || record.status === "uploading") throw Object.assign(new Error("The private document was not found."), { statusCode: 404, code: "cleaner-document-not-found" });
      const expiresAt = new Date(now().getTime() + 5 * 60_000).toISOString();
      let signed;
      try { signed = await adapter.createPrivateReadUrl({ storageKey: record.storageKey, mimeType: record.mimeType, expiresAt }); } catch { throw unavailable(); }
      return Object.freeze({ documentId: selectedId, url: signedUrl(signed?.url), expiresAt, mimeType: record.mimeType, originalFileName: record.originalFileName });
    },
    async listTraining(actor) {
      requireCleaner(actor, "view training progress");
      return (await repository.listTraining(actor)).map(trainingProjection);
    },
    async saveTraining(actor, moduleCode, input = {}) {
      requireCleaner(actor, "save training progress");
      const selected = text(moduleCode, 80, "Training module", 2).toLowerCase();
      if (!modulePattern.test(selected)) throw new TypeError("Training module is invalid.");
      const totalLessons = integer(input.totalLessons, 1, 100, "Total lessons");
      const completedLessons = integer(input.completedLessons, 0, totalLessons, "Completed lessons");
      const requestedStatus = text(input.status || "", 20, "Training status").toLowerCase();
      const status = completedLessons === totalLessons
        ? "completed"
        : requestedStatus === "in-progress" || completedLessons > 0
          ? "in-progress"
          : "not-started";
      const current = now().toISOString();
      return trainingProjection(await repository.saveTraining(actor, {
        moduleCode: selected,
        status,
        completedLessons,
        totalLessons,
        startedAt: status === "not-started" ? null : current,
        completedAt: status === "completed" ? current : null
      }));
    },
    async listAgreements(actor) {
      requireCleaner(actor, "view agreements");
      return (await repository.listAgreements(actor)).map(agreementProjection);
    },
    async signAgreement(actor, agreementCode, input = {}) {
      requireCleaner(actor, "sign agreements");
      const selected = text(agreementCode, 80, "Agreement", 2).toLowerCase();
      if (!agreementPattern.test(selected)) throw new TypeError("Agreement is invalid.");
      const policyVersion = text(input.policyVersion, 40, "Policy version", 1);
      if (!/^[A-Za-z0-9._-]+$/.test(policyVersion)) throw new TypeError("Policy version is invalid.");
      const signedName = text(input.signedName, 120, "Legal name", 2);
      const record = await repository.signAgreement(actor, { agreementCode: selected, policyVersion, signedName });
      if (!record) throw Object.assign(new Error("This agreement version has already been signed."), { statusCode: 409, code: "agreement-already-signed" });
      return agreementProjection(record);
    }
  });
}

export { sectionCodes };
