import { readFile } from "node:fs/promises";
import { createRequestMediaRepository } from "../src/marketplace/request-media-repository.mjs";
import { createRequestMediaService } from "../src/marketplace/request-media-service.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }
async function rejects(operation, fragment) { try { await operation(); } catch (error) { return String(error.message).includes(fragment); } return false; }

const requestId = "66666666-6666-4666-8666-666666666666";
const uploadId = "88888888-8888-4888-8888-888888888888";
const landlord = { userId: "11111111-1111-4111-8111-111111111111", roles: ["landlord"] };
const cleaner = { userId: "22222222-2222-4222-8222-222222222222", roles: ["cleaner"] };
const checksum = "a".repeat(64);
const processedChecksum = "b".repeat(64);
const checksumBase64 = Buffer.from(checksum, "hex").toString("base64");
const calls = [];

function upload(overrides = {}) {
  return { uploadId, cleaningRequestId: requestId, requestedBy: landlord.userId, roomName: "Kitchen", note: "Grease around the hob", quarantineStorageKey: `quarantine/request-photos/${requestId}/${uploadId}`, finalStorageKey: `request-photos/${requestId}/${uploadId}.jpg`, mimeType: "image/jpeg", byteSize: 1234, checksumSha256: checksum, status: "pending", expiresAt: "2026-07-16T12:10:00.000Z", completedAt: null, ...overrides };
}
function scan() {
  return { cleaningRequestId: requestId, status: "draft", tasks: [{ roomName: "Kitchen", description: "Degrease the hob", sortOrder: 0 }], photos: [{ photoId: uploadId, roomName: "Kitchen", note: "Grease around the hob", mimeType: "image/jpeg", byteSize: 987, width: 1200, height: 900, createdAt: "2026-07-16T12:01:00.000Z" }], cleanerPreviewAuthorized: false, scopeConfirmedAt: null };
}
const repository = {
  async createUploadIntent(actor, input) { calls.push({ kind: "create", actor, input }); return upload(input); },
  async getUploadForCompletion(actor, id) { calls.push({ kind: "get", actor, id }); return upload(); },
  async rejectUpload(actor, id, reason) { calls.push({ kind: "reject", actor, id, reason }); },
  async completeUpload(actor, id, verified) { calls.push({ kind: "complete", actor, id, verified }); return scan(); },
  async getScan(actor, id) { calls.push({ kind: "scan", actor, id }); return scan(); },
  async getPhotoObject(actor, suppliedRequestId, photoId) { calls.push({ kind: "object", actor, suppliedRequestId, photoId }); return { storageKey: `request-photos/${requestId}/${uploadId}.jpg`, mimeType: "image/jpeg", byteSize: 987, checksumSha256: processedChecksum, roomName: "Kitchen", note: "Grease around the hob" }; }
};
const storage = {
  async createUploadUrl(input) { calls.push({ kind: "upload-url", input }); return { url: "https://storage.example/private-request-write", requiredHeaders: { "Content-Type": input.mimeType, "X-Amz-Checksum-Sha256": checksumBase64, "X-Amz-Meta-Tideway-Sha256": checksum, "X-Amz-Server-Side-Encryption": "AES256" } }; },
  async headObject(input) { calls.push({ kind: "head", input }); return { mimeType: "image/jpeg", byteSize: 1234, checksumSha256: checksum }; },
  async inspectAndSanitizeImage(input) { calls.push({ kind: "sanitize", input }); return { safe: true, outputMimeType: "image/jpeg", outputByteSize: 987, outputChecksumSha256: processedChecksum, width: 1200, height: 900 }; },
  async createReadUrl(input) { calls.push({ kind: "read-url", input }); return { url: "https://storage.example/private-request-read" }; },
  async deleteObject(input) { calls.push({ kind: "delete", input }); }
};
const service = createRequestMediaService(repository, { objectStorage: storage, now: () => new Date("2026-07-16T12:00:00.000Z"), createId: () => uploadId });
const intent = await service.createUploadIntent(landlord, requestId, { roomName: "Kitchen", note: "Grease around the hob", mimeType: "image/jpeg", byteSize: 1234, checksumSha256: checksum });
assert(intent.uploadId === uploadId && intent.method === "PUT" && intent.requiredHeaders["X-Amz-Checksum-Sha256"] === checksumBase64 && !Object.hasOwn(intent, "storageKey"), "Request media exposed a storage key or lost its exact signed upload contract.");
assert(calls.find((call) => call.kind === "create").input.quarantineStorageKey === `quarantine/request-photos/${requestId}/${uploadId}`, "The server did not own the request-photo quarantine key.");
await service.createUploadIntent(landlord, requestId, { roomName: "Bathroom", mimeType: "image/jpeg", byteSize: 1234, checksumSha256: checksum });
assert(calls.filter((call) => call.kind === "create").at(-1).input.note === "See the confirmed Bathroom checklist for cleaning instructions.", "A room photo without duplicate manual notes did not receive safe checklist context.");
const completed = await service.completeUpload(landlord, requestId, uploadId);
assert(completed.photos.length === 1 && calls.find((call) => call.kind === "sanitize").input.stripMetadata === true && calls.some((call) => call.kind === "delete"), "Room photo completion bypassed sanitation, metadata removal or quarantine cleanup.");
const sharedScan = await service.getScan(cleaner, requestId);
const access = await service.getPhotoAccess(cleaner, requestId, uploadId);
assert(sharedScan.tasks[0].description === "Degrease the hob" && sharedScan.photos[0].roomName === "Kitchen" && access.expiresAt === "2026-07-16T12:05:00.000Z" && !Object.hasOwn(access, "storageKey") && !Object.hasOwn(access, "checksumSha256"), "Authorized Cleaner scope or scan access lost the approved checklist, leaked private storage internals or returned a long-lived link.");
assert(await rejects(() => service.createUploadIntent(cleaner, requestId, { roomName: "Kitchen", note: "Note", mimeType: "image/jpeg", byteSize: 1234, checksumSha256: checksum }), "Landlord"), "A Cleaner could create a Landlord room-photo upload.");
assert(await rejects(() => createRequestMediaService(repository).createUploadIntent(landlord, requestId, { roomName: "Kitchen", note: "Note", mimeType: "image/jpeg", byteSize: 1234, checksumSha256: checksum }), "temporarily unavailable"), "Request media did not fail closed without private storage.");

const dbCalls = [];
let dbFailure = null;
const database = { async withUserTransaction(actor, operation) { return operation({ async query(queryText, values) {
  dbCalls.push({ actor, queryText, values });
  if (dbFailure) throw dbFailure;
  if (queryText.includes("get_cleaning_request_photo_object")) return { rows: [{ storage_key: "private.jpg", mime_type: "image/jpeg", byte_size: 987, checksum_hex: processedChecksum, room_name: "Kitchen", note: "Hob" }] };
  if (queryText.includes("complete_request_photo_upload") || queryText.includes("get_cleaning_request_scan")) return { rows: [{ scan: scan() }] };
  if (queryText.includes("reject_request_photo_upload")) return { rows: [] };
  return { rows: [{ id: uploadId, cleaning_request_id: requestId, requested_by: landlord.userId, room_name: "Kitchen", note: "Hob", quarantine_storage_key: "quarantine", final_storage_key: "final", requested_mime_type: "image/jpeg", requested_byte_size: 1234, requested_checksum_hex: checksum, status: "pending", expires_at: "2026-07-16T12:10:00.000Z", completed_at: null }] };
} }); } };
const realRepository = createRequestMediaRepository(database);
await realRepository.createUploadIntent(landlord, { uploadId, cleaningRequestId: requestId, roomName: "Kitchen", note: "Hob", quarantineStorageKey: "quarantine", finalStorageKey: "final", mimeType: "image/jpeg", byteSize: 1234, checksumSha256: checksum, expiresAt: "2026-07-16T12:10:00.000Z" });
await realRepository.getUploadForCompletion(landlord, uploadId);
await realRepository.rejectUpload(landlord, uploadId, "bad-file");
await realRepository.completeUpload(landlord, uploadId, { byteSize: 987, checksumSha256: processedChecksum, width: 1200, height: 900 });
await realRepository.getScan(landlord, requestId);
await realRepository.getPhotoObject(cleaner, requestId, uploadId);
for (const name of ["create_request_photo_upload_intent", "get_request_photo_upload_for_completion", "reject_request_photo_upload", "complete_request_photo_upload", "get_cleaning_request_scan", "get_cleaning_request_photo_object"]) assert(dbCalls.some((call) => call.queryText.includes(name)), `Request-media repository did not call ${name}.`);
assert(dbCalls.every((call) => !call.queryText.includes(requestId) && !call.queryText.includes(uploadId)), "Request-media repository interpolated a resource id into SQL.");
dbFailure = new Error("request-photo-room-not-found");
assert(await rejects(() => realRepository.createUploadIntent(landlord, { uploadId, cleaningRequestId: requestId }), "room name"), "A photo outside the reviewed checklist did not receive the safe conflict.");

const [migration, cleanerHandoffMigration, grants, workerGrants] = await Promise.all([
  readFile(new URL("../db/migrations/030_private_request_room_scans.sql", import.meta.url), "utf8"),
  readFile(new URL("../db/migrations/049_pending_cleaner_scope_handoff.sql", import.meta.url), "utf8"),
  readFile(new URL("../db/runtime-role-grants.sql", import.meta.url), "utf8"),
  readFile(new URL("../db/worker-role-grants.sql", import.meta.url), "utf8")
]);
for (const required of ["cleaning_request_photo_uploads", "quarantine/request-photos", "request-photos/%s/%s.jpg", "request-photo-room-not-found", "request-photo-limit", "get_cleaning_request_scan", "get_cleaning_request_photo_object", "expire_due_request_photo_uploads", "FOR UPDATE SKIP LOCKED", "sanitized_at"]) assert(migration.includes(required), `Private request-room-scan migration omitted ${required}.`);
for (const required of ["pending-cleaner-acceptance", "cleaning_request_tasks", "'tasks',tasks", "cleaner_preview_authorized", "actor_has_pending_invitation AND request_record.cleaner_preview_authorized", "request-not-found"]) assert(cleanerHandoffMigration.includes(required), `Pending-Cleaner scope handoff migration omitted ${required}.`);
for (const forbidden of ["address_line_1", "access_instructions", "contact_name", "budget_pence", "customer_price_pence"]) assert(!cleanerHandoffMigration.includes(forbidden), `Pending-Cleaner scope handoff exposed protected ${forbidden}.`);
assert(grants.includes("REVOKE SELECT, INSERT, UPDATE, DELETE ON cleaning_request_photos, cleaning_request_photo_uploads") && workerGrants.includes("expire_due_request_photo_uploads"), "Runtime or worker grants permit room-photo key access or bypass expiry.");

console.log("Request media tests passed: owner-only room capture, optional photo notes with safe checklist context, exact signed upload, sanitation, reviewed-room binding, participant-safe reads, function-only storage keys and expiry.");
