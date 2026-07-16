import { randomUUID } from "node:crypto";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const checksumPattern = /^[0-9a-f]{64}$/;
const mimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);

function uuid(value, label) {
  if (!uuidPattern.test(value || "")) throw new TypeError(`A valid ${label} is required.`);
  return value.toLowerCase();
}
function text(value, maximum, label, minimum = 0) {
  const normalized = typeof value === "string" ? value.trim().replace(/[\u0000-\u001f\u007f]/g, "") : "";
  if (normalized.length < minimum || normalized.length > maximum) throw new TypeError(`${label} must contain ${minimum} to ${maximum} characters.`);
  return normalized;
}
function integer(value, minimum, maximum, label) {
  const selected = Number(value);
  if (!Number.isInteger(selected) || selected < minimum || selected > maximum) throw new TypeError(`${label} is outside the supported range.`);
  return selected;
}
function requireLandlord(actor, action) {
  if (!actor?.userId || !actor.roles?.includes("landlord")) throw new TypeError(`A Landlord account is required to ${action}.`);
}
function unavailable() {
  return Object.assign(new Error("Private room-photo storage is temporarily unavailable."), { statusCode: 503, code: "request-media-storage-unavailable" });
}
function storageAdapter(storage) {
  if (!storage || !["createUploadUrl", "headObject", "inspectAndSanitizeImage", "createReadUrl"].every((method) => typeof storage[method] === "function")) throw unavailable();
  return storage;
}
function signedUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw unavailable(); }
  if (url.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(url.hostname)) throw unavailable();
  return url.toString();
}
function headers(value, record) {
  const expected = {
    "content-type": record.mimeType,
    "x-amz-checksum-sha256": Buffer.from(record.checksumSha256, "hex").toString("base64"),
    "x-amz-meta-tideway-sha256": record.checksumSha256,
    "x-amz-server-side-encryption": "AES256"
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
  const normalized = Object.fromEntries(Object.entries(value).map(([key, item]) => [key.toLowerCase(), String(item)]));
  if (Object.keys(normalized).length !== 4 || Object.entries(expected).some(([key, item]) => normalized[key] !== item)) throw unavailable();
  return Object.freeze({ "Content-Type": expected["content-type"], "X-Amz-Checksum-Sha256": expected["x-amz-checksum-sha256"], "X-Amz-Meta-Tideway-Sha256": expected["x-amz-meta-tideway-sha256"], "X-Amz-Server-Side-Encryption": "AES256" });
}
function safeOutput(value) {
  const checksumSha256 = String(value?.outputChecksumSha256 || "").toLowerCase();
  if (value?.safe !== true || value?.outputMimeType !== "image/jpeg" || !checksumPattern.test(checksumSha256)) throw Object.assign(new Error("The image failed the private media safety inspection."), { statusCode: 409, code: "unsafe-request-photo" });
  return { byteSize: integer(value.outputByteSize, 1, 15_000_000, "Processed photo size"), checksumSha256, width: integer(value.width, 1, 20_000, "Processed photo width"), height: integer(value.height, 1, 20_000, "Processed photo height") };
}
function scanProjection(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.photos)) throw unavailable();
  return Object.freeze({
    cleaningRequestId: value.cleaningRequestId,
    status: value.status,
    photos: value.photos.map((photo) => Object.freeze({ photoId: photo.photoId, roomName: photo.roomName, note: photo.note, mimeType: photo.mimeType, byteSize: Number(photo.byteSize), width: Number(photo.width), height: Number(photo.height), createdAt: new Date(photo.createdAt).toISOString() })),
    cleanerPreviewAuthorized: value.cleanerPreviewAuthorized === true,
    scopeConfirmedAt: value.scopeConfirmedAt ? new Date(value.scopeConfirmedAt).toISOString() : null
  });
}

export function createRequestMediaService(repository, options = {}) {
  if (!repository || !["createUploadIntent", "getUploadForCompletion", "rejectUpload", "completeUpload", "getScan", "getPhotoObject"].every((method) => typeof repository[method] === "function")) throw new TypeError("A complete request-media repository is required.");
  const storage = options.objectStorage || null;
  const now = typeof options.now === "function" ? options.now : () => new Date();
  const createId = typeof options.createId === "function" ? options.createId : randomUUID;
  async function remove(key) { if (typeof storage?.deleteObject === "function") try { await storage.deleteObject({ storageKey: key }); } catch {} }
  async function reject(actor, record, reason) { await repository.rejectUpload(actor, record.uploadId, reason); await remove(record.quarantineStorageKey); await remove(record.finalStorageKey); }
  return Object.freeze({
    async createUploadIntent(actor, cleaningRequestId, input = {}) {
      requireLandlord(actor, "upload room photos");
      const adapter = storageAdapter(storage);
      const requestId = uuid(cleaningRequestId, "cleaning request id");
      const mimeType = text(input.mimeType, 40, "Photo MIME type", 1).toLowerCase();
      if (!mimeTypes.has(mimeType)) throw new TypeError("Choose a supported JPEG, PNG, WebP or HEIC image.");
      const checksumSha256 = text(input.checksumSha256, 64, "Photo checksum", 64).toLowerCase();
      if (!checksumPattern.test(checksumSha256)) throw new TypeError("Photo checksum must be a lowercase SHA-256 value.");
      const uploadId = uuid(createId(), "generated upload id");
      const issuedAt = now();
      if (!(issuedAt instanceof Date) || !Number.isFinite(issuedAt.getTime())) throw unavailable();
      const record = await repository.createUploadIntent(actor, {
        uploadId,
        cleaningRequestId: requestId,
        roomName: text(input.roomName, 120, "Room name", 1),
        note: text(input.note, 1000, "Photo note", 1),
        quarantineStorageKey: `quarantine/request-photos/${requestId}/${uploadId}`,
        finalStorageKey: `request-photos/${requestId}/${uploadId}.jpg`,
        mimeType,
        byteSize: integer(input.byteSize, 1, 15_000_000, "Photo size"),
        checksumSha256,
        expiresAt: new Date(issuedAt.getTime() + 10 * 60_000).toISOString()
      });
      let signed;
      try { signed = await adapter.createUploadUrl({ storageKey: record.quarantineStorageKey, mimeType: record.mimeType, byteSize: record.byteSize, checksumSha256: record.checksumSha256, expiresAt: record.expiresAt }); } catch { throw unavailable(); }
      return Object.freeze({ uploadId: record.uploadId, uploadUrl: signedUrl(signed?.url), method: "PUT", expiresAt: record.expiresAt, requiredHeaders: headers(signed?.requiredHeaders, record) });
    },
    async completeUpload(actor, cleaningRequestId, uploadId) {
      requireLandlord(actor, "complete room-photo uploads");
      const adapter = storageAdapter(storage);
      const requestId = uuid(cleaningRequestId, "cleaning request id");
      const record = await repository.getUploadForCompletion(actor, uuid(uploadId, "room-photo upload id"));
      if (record.cleaningRequestId !== requestId) throw Object.assign(new Error("The room-photo upload was not found for this request."), { statusCode: 404, code: "request-photo-upload-not-found" });
      if (record.status === "completed") return scanProjection(await repository.getScan(actor, requestId));
      let object;
      try { object = await adapter.headObject({ storageKey: record.quarantineStorageKey }); } catch { throw unavailable(); }
      if (Number(object?.byteSize) !== record.byteSize || String(object?.mimeType || "").toLowerCase() !== record.mimeType || String(object?.checksumSha256 || "").toLowerCase() !== record.checksumSha256) {
        await reject(actor, record, "uploaded-object-mismatch");
        throw Object.assign(new Error("The uploaded image does not match its declared size, type and checksum."), { statusCode: 409, code: "request-photo-mismatch" });
      }
      let processed;
      try { processed = await adapter.inspectAndSanitizeImage({ sourceStorageKey: record.quarantineStorageKey, targetStorageKey: record.finalStorageKey, sourceMimeType: record.mimeType, maximumBytes: 15_000_000, stripMetadata: true }); }
      catch (error) {
        if (error?.unsafe === true) { await reject(actor, record, "image-safety-check-failed"); throw Object.assign(new Error("The image failed the private media safety inspection."), { statusCode: 409, code: "unsafe-request-photo" }); }
        throw unavailable();
      }
      let verified;
      try { verified = safeOutput(processed); } catch (error) { if (error?.code === "unsafe-request-photo") await reject(actor, record, "image-safety-check-failed"); throw error; }
      const scan = scanProjection(await repository.completeUpload(actor, record.uploadId, verified));
      await remove(record.quarantineStorageKey);
      return scan;
    },
    async getScan(actor, cleaningRequestId) {
      if (!actor?.userId) throw new TypeError("An authenticated marketplace account is required to view a private room scan.");
      return scanProjection(await repository.getScan(actor, uuid(cleaningRequestId, "cleaning request id")));
    },
    async getPhotoAccess(actor, cleaningRequestId, photoId) {
      if (!actor?.userId) throw new TypeError("An authenticated marketplace account is required to view a room photo.");
      const adapter = storageAdapter(storage);
      const photo = await repository.getPhotoObject(actor, uuid(cleaningRequestId, "cleaning request id"), uuid(photoId, "room photo id"));
      const expiresAt = new Date(now().getTime() + 5 * 60_000).toISOString();
      let signed;
      try { signed = await adapter.createReadUrl({ storageKey: photo.storageKey, expiresAt }); } catch { throw unavailable(); }
      return Object.freeze({ photoId: photoId.toLowerCase(), roomName: photo.roomName, note: photo.note, mimeType: photo.mimeType, byteSize: photo.byteSize, url: signedUrl(signed?.url), expiresAt });
    }
  });
}
