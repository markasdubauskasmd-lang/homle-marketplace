import assert from "node:assert/strict";
import { createCleanerDashboardService } from "../src/marketplace/cleaner-dashboard-service.mjs";

const actor = { userId: "22222222-2222-4222-8222-222222222222", roles: ["cleaner"] };
const calls = [];
let document = {
  documentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  documentType: "passport",
  originalFileName: "passport.pdf",
  storageKey: "cleaner-documents/22222222-2222-4222-8222-222222222222/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  mimeType: "application/pdf",
  byteSize: 128,
  checksumSha256: "a".repeat(64),
  status: "uploading",
  uploadExpiresAt: "2026-07-16T12:10:00.000Z",
  createdAt: "2026-07-16T12:00:00.000Z",
  updatedAt: "2026-07-16T12:00:00.000Z"
};
const repository = {
  async getSection(selectedActor, sectionCode) { calls.push(["get-section", selectedActor, sectionCode]); return null; },
  async saveSection(selectedActor, input) { calls.push(["save-section", selectedActor, input]); return { ...input, updatedAt: "2026-07-16T12:00:00.000Z" }; },
  async listDocuments(selectedActor) { calls.push(["list-documents", selectedActor]); return []; },
  async createDocumentIntent(selectedActor, input) { calls.push(["create-document", selectedActor, input]); return { ...document, ...input }; },
  async getDocument(selectedActor, documentId) { calls.push(["get-document", selectedActor, documentId]); return { ...document, documentId }; },
  async completeDocument(selectedActor, documentId) { calls.push(["complete-document", selectedActor, documentId]); document = { ...document, documentId, status: "pending-review" }; return document; },
  async listTraining(selectedActor) { calls.push(["list-training", selectedActor]); return []; },
  async saveTraining(selectedActor, input) {
    calls.push(["save-training", selectedActor, input]);
    return { module_code: input.moduleCode, status: input.status, completed_lessons: input.completedLessons, total_lessons: input.totalLessons, started_at: input.startedAt, completed_at: input.completedAt, updated_at: "2026-07-16T12:00:00.000Z" };
  },
  async listAgreements(selectedActor) { calls.push(["list-agreements", selectedActor]); return []; },
  async signAgreement(selectedActor, input) { calls.push(["sign-agreement", selectedActor, input]); return { agreement_code: input.agreementCode, policy_version: input.policyVersion, signed_name: input.signedName, signed_at: "2026-07-16T12:00:00.000Z" }; }
};
const storage = {
  async createPrivateUploadUrl(input) {
    calls.push(["upload-url", input]);
    return { url: "https://objects.example/private-write", requiredHeaders: { "Content-Type": input.mimeType } };
  },
  async headObject(input) {
    calls.push(["head-object", input]);
    return { mimeType: document.mimeType, byteSize: document.byteSize, checksumSha256: document.checksumSha256 };
  },
  async createPrivateReadUrl(input) {
    calls.push(["read-url", input]);
    return { url: "https://objects.example/private-read" };
  }
};
const service = createCleanerDashboardService(repository, {
  objectStorage: storage,
  now: () => new Date("2026-07-16T12:00:00.000Z"),
  createId: () => document.documentId
});

assert.deepEqual(await service.getSection(actor, "personal-details"), { sectionCode: "personal-details", payload: {}, completionStatus: "draft", updatedAt: null });
const saved = await service.saveSection(actor, "personal-details", { payload: { firstName: "Sadie", email: "sadie@example.com" }, completionStatus: "draft" });
assert.equal(saved.payload.firstName, "Sadie");
assert.equal(saved.updatedAt, "2026-07-16T12:00:00.000Z");
await assert.rejects(() => service.saveSection(actor, "bank-secrets", { payload: {}, completionStatus: "draft" }), /not supported/);
await assert.rejects(() => service.saveSection(actor, "settings", { payload: { oversized: "x".repeat(61_000) }, completionStatus: "draft" }), /too large/);

const intent = await service.createDocumentIntent(actor, { documentType: "passport", originalFileName: "passport.pdf", mimeType: "application/pdf", byteSize: 128, checksumSha256: "a".repeat(64) });
assert.equal(intent.documentId, document.documentId);
assert.equal(intent.method, "PUT");
assert.equal(calls.find((call) => call[0] === "create-document")[2].storageKey, document.storageKey);
assert.equal((await service.completeDocument(actor, document.documentId)).status, "pending-review");
assert.equal((await service.getDocumentAccess(actor, document.documentId)).url, "https://objects.example/private-read");
await assert.rejects(() => service.createDocumentIntent(actor, { documentType: "passport", originalFileName: "virus.exe", mimeType: "application/octet-stream", byteSize: 128, checksumSha256: "a".repeat(64) }), /PDF, JPEG or PNG/);

const progress = await service.saveTraining(actor, "coshh-safe-use-of-chemicals", { status: "in-progress", completedLessons: 0, totalLessons: 6 });
assert.equal(progress.status, "in-progress");
assert.equal(progress.completedLessons, 0);
const agreement = await service.signAgreement(actor, "privacy-policy", { policyVersion: "2026-07-30", signedName: "Sadie Fletcher" });
assert.equal(agreement.signedName, "Sadie Fletcher");

await assert.rejects(() => service.getSection({ userId: actor.userId, roles: ["landlord"] }, "personal-details"), /Cleaner account/);

console.log("Cleaner dashboard storage service tests passed.");
