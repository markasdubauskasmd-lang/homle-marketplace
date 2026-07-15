import { randomUUID } from "node:crypto";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const checksumPattern = /^[0-9a-f]{64}$/;
const photoTypes = Object.freeze(["before", "after", "issue"]);
const mimeTypes = Object.freeze(["image/jpeg", "image/png", "image/webp", "image/heic"]);

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
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < minimum || normalized > maximum) throw new TypeError(`${label} is outside the supported range.`);
  return normalized;
}

function cleaner(actor, action) {
  if (!actor?.userId || !Array.isArray(actor.roles) || !actor.roles.includes("cleaner")) throw new TypeError(`A Cleaner account is required to ${action}.`);
}

function participant(actor) {
  if (!actor?.userId) throw new TypeError("An authenticated booking participant is required to view a job photo.");
}

function unavailable() {
  return Object.assign(new Error("Private job-photo storage is temporarily unavailable."), { statusCode: 503, code: "media-storage-unavailable" });
}

function requireStorage(storage) {
  const methods = ["createUploadUrl", "headObject", "inspectAndSanitizeImage", "createReadUrl"];
  if (!storage || !methods.every((method) => typeof storage[method] === "function")) throw unavailable();
  return storage;
}

function progressProjection(value) {
  const record = typeof value === "string" ? JSON.parse(value) : value;
  if (!record || typeof record !== "object") throw new Error("Cleaning progress is unavailable.");
  return record;
}

function absoluteSignedUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw unavailable(); }
  if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") throw unavailable();
  return url.toString();
}

function verifiedOutput(value) {
  if (!value || value.safe !== true || value.outputMimeType !== "image/jpeg") throw Object.assign(new Error("The image failed the private media safety inspection."), { statusCode: 409, code: "unsafe-job-photo" });
  const checksumSha256 = String(value.outputChecksumSha256 || "").toLowerCase();
  if (!checksumPattern.test(checksumSha256)) throw unavailable();
  return {
    byteSize: integer(value.outputByteSize, 1, 15_000_000, "Processed photo size"),
    checksumSha256,
    width: integer(value.width, 1, 20_000, "Processed photo width"),
    height: integer(value.height, 1, 20_000, "Processed photo height")
  };
}

export function createMediaService(repository, options = {}) {
  const methods = ["createUploadIntent", "getUploadForCompletion", "rejectUpload", "completeUpload", "getProgress", "getPhotoObject"];
  if (!repository || !methods.every((method) => typeof repository[method] === "function")) throw new TypeError("A complete private-media repository is required.");
  const storage = options.objectStorage || null;
  const now = typeof options.now === "function" ? options.now : () => new Date();
  const createId = typeof options.createId === "function" ? options.createId : randomUUID;

  async function removeQuarantine(storageKey) {
    if (typeof storage?.deleteObject !== "function") return;
    try { await storage.deleteObject({ storageKey }); } catch {}
  }

  async function reject(actor, record, reason) {
    await repository.rejectUpload(actor, record.uploadId, reason);
    await removeQuarantine(record.quarantineStorageKey);
    await removeQuarantine(record.finalStorageKey);
  }

  return Object.freeze({
    async createUploadIntent(actor, bookingId, input = {}) {
      cleaner(actor, "upload job photos");
      const adapter = requireStorage(storage);
      const selectedBookingId = uuid(bookingId, "booking id");
      const photoType = text(input.photoType, 20, "Photo type", 1).toLowerCase();
      if (!photoTypes.includes(photoType)) throw new TypeError("Choose before, after or issue for the photo type.");
      const mimeType = text(input.mimeType, 40, "Photo MIME type", 1).toLowerCase();
      if (!mimeTypes.includes(mimeType)) throw new TypeError("Choose a supported JPEG, PNG, WebP or HEIC image.");
      const checksumSha256 = text(input.checksumSha256, 64, "Photo checksum", 64).toLowerCase();
      if (!checksumPattern.test(checksumSha256)) throw new TypeError("Photo checksum must be a lowercase SHA-256 value.");
      const uploadId = uuid(createId(), "generated upload id");
      const taskId = input.taskId == null || input.taskId === "" ? null : uuid(input.taskId, "task id");
      const issuedAt = now();
      if (!(issuedAt instanceof Date) || !Number.isFinite(issuedAt.getTime())) throw unavailable();
      const expiresAt = new Date(issuedAt.getTime() + 10 * 60_000).toISOString();
      const record = await repository.createUploadIntent(actor, {
        uploadId,
        bookingId: selectedBookingId,
        taskId,
        photoType,
        quarantineStorageKey: `quarantine/job-photos/${selectedBookingId}/${uploadId}`,
        finalStorageKey: `job-photos/${selectedBookingId}/${uploadId}.jpg`,
        mimeType,
        byteSize: integer(input.byteSize, 1, 15_000_000, "Photo size"),
        checksumSha256,
        note: text(input.note, 1000, "Photo note") || null,
        expiresAt
      });
      let signed;
      try {
        signed = await adapter.createUploadUrl({ storageKey: record.quarantineStorageKey, mimeType: record.mimeType, byteSize: record.byteSize, checksumSha256: record.checksumSha256, expiresAt: record.expiresAt });
      } catch { throw unavailable(); }
      return Object.freeze({
        uploadId: record.uploadId,
        uploadUrl: absoluteSignedUrl(signed?.url),
        method: "PUT",
        expiresAt: record.expiresAt,
        requiredHeaders: Object.freeze({ "Content-Type": record.mimeType, "Content-Length": String(record.byteSize), "X-Content-SHA256": record.checksumSha256 })
      });
    },

    async completeUpload(actor, bookingId, uploadId) {
      cleaner(actor, "complete job-photo uploads");
      const adapter = requireStorage(storage);
      const selectedBookingId = uuid(bookingId, "booking id");
      const record = await repository.getUploadForCompletion(actor, uuid(uploadId, "photo upload id"));
      if (record.bookingId !== selectedBookingId) throw Object.assign(new Error("The photo upload was not found for this booking."), { statusCode: 404, code: "photo-upload-not-found" });
      if (record.status === "completed") return progressProjection(await repository.getProgress(actor, selectedBookingId));
      let object;
      try { object = await adapter.headObject({ storageKey: record.quarantineStorageKey }); } catch { throw unavailable(); }
      const checksum = String(object?.checksumSha256 || "").toLowerCase();
      if (Number(object?.byteSize) !== record.byteSize || String(object?.mimeType || "").toLowerCase() !== record.mimeType || checksum !== record.checksumSha256) {
        await reject(actor, record, "uploaded-object-mismatch");
        throw Object.assign(new Error("The uploaded image does not match its declared size, type and checksum."), { statusCode: 409, code: "job-photo-mismatch" });
      }
      let processed;
      try {
        processed = await adapter.inspectAndSanitizeImage({ sourceStorageKey: record.quarantineStorageKey, targetStorageKey: record.finalStorageKey, sourceMimeType: record.mimeType, maximumBytes: 15_000_000, stripMetadata: true });
      } catch (error) {
        if (error?.unsafe === true) {
          await reject(actor, record, "image-safety-check-failed");
          throw Object.assign(new Error("The image failed the private media safety inspection."), { statusCode: 409, code: "unsafe-job-photo" });
        }
        throw unavailable();
      }
      let verified;
      try { verified = verifiedOutput(processed); } catch (error) {
        if (error?.code === "unsafe-job-photo") await reject(actor, record, "image-safety-check-failed");
        throw error;
      }
      const progress = progressProjection(await repository.completeUpload(actor, record.uploadId, verified));
      await removeQuarantine(record.quarantineStorageKey);
      return progress;
    },

    async getPhotoAccess(actor, bookingId, photoId) {
      participant(actor);
      const adapter = requireStorage(storage);
      const photo = await repository.getPhotoObject(actor, uuid(bookingId, "booking id"), uuid(photoId, "photo id"));
      const expiresAt = new Date(now().getTime() + 5 * 60_000).toISOString();
      let signed;
      try { signed = await adapter.createReadUrl({ storageKey: photo.storageKey, expiresAt }); } catch { throw unavailable(); }
      return Object.freeze({ photoId: photoId.toLowerCase(), photoType: photo.photoType, note: photo.note, mimeType: photo.mimeType, byteSize: photo.byteSize, url: absoluteSignedUrl(signed?.url), expiresAt });
    }
  });
}

export { mimeTypes as jobPhotoMimeTypes, photoTypes as jobPhotoTypes };
