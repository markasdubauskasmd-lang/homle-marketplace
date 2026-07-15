import { readFile } from "node:fs/promises";
import { createMediaRepository } from "../src/marketplace/media-repository.mjs";
import { createMediaService } from "../src/marketplace/media-service.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }
async function rejects(operation, fragment) { try { await operation(); } catch (error) { return String(error.message).includes(fragment); } return false; }

const bookingId = "55555555-5555-4555-8555-555555555555";
const taskId = "77777777-7777-4777-8777-777777777777";
const uploadId = "88888888-8888-4888-8888-888888888888";
const photoId = uploadId;
const cleaner = { userId: "22222222-2222-4222-8222-222222222222", roles: ["cleaner"] };
const landlord = { userId: "11111111-1111-4111-8111-111111111111", roles: ["landlord"] };
const checksum = "a".repeat(64);
const processedChecksum = "b".repeat(64);
const calls = [];

function record(overrides = {}) {
  return {
    uploadId,
    bookingId,
    taskId,
    requestedBy: cleaner.userId,
    photoType: "before",
    quarantineStorageKey: `quarantine/job-photos/${bookingId}/${uploadId}`,
    finalStorageKey: `job-photos/${bookingId}/${uploadId}.jpg`,
    mimeType: "image/jpeg",
    byteSize: 1234,
    checksumSha256: checksum,
    note: "Kitchen before cleaning",
    status: "pending",
    expiresAt: "2026-07-15T16:10:00.000Z",
    completedAt: null,
    ...overrides
  };
}

const fakeRepository = {
  async createUploadIntent(actor, input) { calls.push({ kind: "create", actor, input }); return record(input); },
  async getUploadForCompletion(actor, id) { calls.push({ kind: "get-upload", actor, id }); return record(); },
  async rejectUpload(actor, id, reason) { calls.push({ kind: "reject", actor, id, reason }); },
  async completeUpload(actor, id, verified) { calls.push({ kind: "complete", actor, id, verified }); return { bookingId, photos: [{ photoId }], eventVersion: 8 }; },
  async getProgress(actor, id) { calls.push({ kind: "progress", actor, id }); return { bookingId, photos: [{ photoId }], eventVersion: 8 }; },
  async getPhotoObject(actor, suppliedBookingId, suppliedPhotoId) { calls.push({ kind: "object", actor, suppliedBookingId, suppliedPhotoId }); return { storageKey: `job-photos/${bookingId}/${photoId}.jpg`, mimeType: "image/jpeg", byteSize: 987, checksumSha256: processedChecksum, photoType: "before", note: "Kitchen before cleaning" }; }
};
const storage = {
  async createUploadUrl(input) { calls.push({ kind: "upload-url", input }); return { url: "https://storage.example/private-write-signature" }; },
  async headObject(input) { calls.push({ kind: "head", input }); return { mimeType: "image/jpeg", byteSize: 1234, checksumSha256: checksum }; },
  async inspectAndSanitizeImage(input) { calls.push({ kind: "sanitize", input }); return { safe: true, outputMimeType: "image/jpeg", outputByteSize: 987, outputChecksumSha256: processedChecksum, width: 1200, height: 900 }; },
  async createReadUrl(input) { calls.push({ kind: "read-url", input }); return { url: "https://storage.example/private-read-signature" }; },
  async deleteObject(input) { calls.push({ kind: "delete", input }); }
};
const service = createMediaService(fakeRepository, { objectStorage: storage, now: () => new Date("2026-07-15T16:00:00.000Z"), createId: () => uploadId });

const intent = await service.createUploadIntent(cleaner, bookingId, { taskId, photoType: "before", mimeType: "image/jpeg", byteSize: 1234, checksumSha256: checksum, note: "Kitchen before cleaning" });
assert(intent.uploadId === uploadId && intent.method === "PUT" && intent.uploadUrl.startsWith("https://storage.example/") && intent.requiredHeaders["X-Content-SHA256"] === checksum, "The media service did not create a bounded signed upload contract.");
assert(!Object.hasOwn(intent, "storageKey") && !Object.hasOwn(intent, "quarantineStorageKey") && !Object.hasOwn(intent, "finalStorageKey"), "The upload response exposed a separately reusable object-storage key.");
assert(calls.find((call) => call.kind === "create").input.quarantineStorageKey === `quarantine/job-photos/${bookingId}/${uploadId}`, "The server did not own the quarantine object key.");

const completed = await service.completeUpload(cleaner, bookingId, uploadId);
assert(completed.eventVersion === 8 && calls.find((call) => call.kind === "sanitize").input.stripMetadata === true, "The photo did not pass through the mandatory inspect/re-encode/metadata-strip boundary.");
assert(calls.find((call) => call.kind === "complete").verified.outputMimeType === undefined && calls.find((call) => call.kind === "complete").verified.checksumSha256 === processedChecksum, "Only verified processed-image metadata should reach the completion transaction.");
assert(calls.some((call) => call.kind === "delete"), "The quarantine object was not removed after verified completion.");

const access = await service.getPhotoAccess(landlord, bookingId, photoId);
assert(access.url.startsWith("https://storage.example/") && access.expiresAt === "2026-07-15T16:05:00.000Z" && !Object.hasOwn(access, "storageKey") && !Object.hasOwn(access, "checksumSha256"), "Participant read access leaked storage internals or was not short-lived.");
assert(await rejects(() => service.createUploadIntent(landlord, bookingId, { photoType: "before", mimeType: "image/jpeg", byteSize: 1, checksumSha256: checksum }), "Cleaner"), "A Landlord created a Cleaner job-photo upload.");
assert(await rejects(() => createMediaService(fakeRepository).createUploadIntent(cleaner, bookingId, { photoType: "before", mimeType: "image/jpeg", byteSize: 1, checksumSha256: checksum }), "temporarily unavailable"), "Media upload did not fail closed without private storage.");

const mismatchedCalls = [];
const deletesBeforeMismatch = calls.filter((call) => call.kind === "delete").length;
const mismatchedRepository = { ...fakeRepository, async rejectUpload(actor, id, reason) { mismatchedCalls.push({ actor, id, reason }); } };
const mismatchedStorage = { ...storage, async headObject() { return { mimeType: "image/png", byteSize: 1234, checksumSha256: checksum }; } };
const mismatchService = createMediaService(mismatchedRepository, { objectStorage: mismatchedStorage, now: () => new Date("2026-07-15T16:00:00.000Z"), createId: () => uploadId });
assert(await rejects(() => mismatchService.completeUpload(cleaner, bookingId, uploadId), "does not match"), "A mismatched uploaded object was accepted.");
assert(mismatchedCalls[0]?.reason === "uploaded-object-mismatch" && calls.filter((call) => call.kind === "delete").length === deletesBeforeMismatch + 2, "A mismatched object was not durably rejected or both possible object keys were not cleaned up.");

const databaseCalls = [];
let databaseFailure = null;
const database = { async withUserTransaction(actor, operation) { return operation({ async query(queryText, values) {
  databaseCalls.push({ actor, queryText, values });
  if (databaseFailure) throw databaseFailure;
  if (queryText.includes("get_job_photo_object")) return { rows: [{ storage_key: "private.jpg", mime_type: "image/jpeg", byte_size: 987, checksum_hex: processedChecksum, photo_type: "after", note: null }] };
  if (queryText.includes("complete_job_photo_upload") || queryText.includes("get_cleaning_progress")) return { rows: [{ snapshot: { bookingId, eventVersion: 9 } }] };
  if (queryText.includes("reject_job_photo_upload")) return { rows: [] };
  return { rows: [{ id: uploadId, booking_id: bookingId, task_id: taskId, requested_by: cleaner.userId, photo_type: "before", quarantine_storage_key: "quarantine", final_storage_key: "final", requested_mime_type: "image/jpeg", requested_byte_size: 1234, requested_checksum_hex: checksum, note: null, status: "pending", expires_at: "2026-07-15T16:10:00.000Z", completed_at: null }] };
} }); } };
const repository = createMediaRepository(database);
await repository.createUploadIntent(cleaner, { uploadId, bookingId, taskId, photoType: "before", quarantineStorageKey: "quarantine", finalStorageKey: "final", mimeType: "image/jpeg", byteSize: 1234, checksumSha256: checksum, note: null, expiresAt: "2026-07-15T16:10:00.000Z" });
await repository.getUploadForCompletion(cleaner, uploadId);
await repository.rejectUpload(cleaner, uploadId, "bad-file");
await repository.completeUpload(cleaner, uploadId, { byteSize: 987, checksumSha256: processedChecksum, width: 1200, height: 900 });
await repository.getPhotoObject(landlord, bookingId, photoId);
for (const name of ["create_job_photo_upload_intent", "get_job_photo_upload_for_completion", "reject_job_photo_upload", "complete_job_photo_upload", "get_job_photo_object"]) assert(databaseCalls.some((call) => call.queryText.includes(name)), `Media repository did not call ${name}.`);
assert(databaseCalls.every((call) => !call.queryText.includes(uploadId) && !call.queryText.includes(bookingId)), "Media repository interpolated a resource identifier into SQL.");
databaseFailure = new Error("photo-upload-expired");
assert(await rejects(() => repository.getUploadForCompletion(cleaner, uploadId), "expired"), "An expired upload did not receive the safe repository conflict.");

const migration = await readFile(new URL("../db/migrations/014_private_job_media.sql", import.meta.url), "utf8");
const grants = await readFile(new URL("../db/runtime-role-grants.sql", import.meta.url), "utf8");
const workerGrants = await readFile(new URL("../db/worker-role-grants.sql", import.meta.url), "utf8");
for (const required of ["job_photo_uploads", "requested_checksum_sha256", "quarantine/job-photos", "create_job_photo_upload_intent", "get_job_photo_upload_for_completion", "reject_job_photo_upload", "complete_job_photo_upload", "get_job_photo_object", "expire_due_job_photo_uploads", "photo-added", "booking_participant", "FOR UPDATE SKIP LOCKED", "image/jpeg", "sanitized_at"]) assert(migration.includes(required), `Private media migration omitted ${required}.`);
assert(grants.includes("REVOKE INSERT, UPDATE, DELETE") && grants.includes("REVOKE SELECT ON job_photos, job_photo_uploads") && workerGrants.includes("expire_due_job_photo_uploads"), "Runtime or worker grants permit reading storage keys or bypassing private photo transactions/expiry.");

console.log("Media tests passed: server-owned signed upload, exact object verification, safety inspection/re-encode, idempotent transaction boundary, participant-only signed reads, quarantine cleanup and fail-closed storage composition.");
