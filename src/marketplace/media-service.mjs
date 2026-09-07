import { createHash, randomUUID } from "node:crypto";
import { exactOrigin, uuid, uuidPattern } from "./validation.mjs";

const checksumPattern = /^[0-9a-f]{64}$/;
const photoTypes = Object.freeze(["before", "after", "issue"]);
const mimeTypes = Object.freeze(["image/jpeg", "image/png", "image/webp", "image/heic"]);

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

function verifiedUploadHeaders(value, record) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
  const expected = {
    "content-type": record.mimeType,
    "x-amz-checksum-sha256": Buffer.from(record.checksumSha256, "hex").toString("base64"),
    "x-amz-meta-tideway-sha256": record.checksumSha256,
    "x-amz-server-side-encryption": "AES256"
  };
  const entries = Object.entries(value);
  if (entries.length !== Object.keys(expected).length) throw unavailable();
  const normalized = Object.fromEntries(entries.map(([key, supplied]) => [String(key).toLowerCase(), String(supplied)]));
  if (Object.entries(expected).some(([key, expectedValue]) => normalized[key] !== expectedValue)) throw unavailable();
  return Object.freeze({
    "Content-Type": expected["content-type"],
    "X-Amz-Checksum-Sha256": expected["x-amz-checksum-sha256"],
    "X-Amz-Meta-Tideway-Sha256": expected["x-amz-meta-tideway-sha256"],
    "X-Amz-Server-Side-Encryption": expected["x-amz-server-side-encryption"]
  });
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
  const appOrigin = options.appOrigin ? exactOrigin(options.appOrigin) : null;
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
        requiredHeaders: verifiedUploadHeaders(signed?.requiredHeaders, record)
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
      if (!actor?.userId) throw new TypeError("An authenticated marketplace account is required to view a job photo.");
      if (!appOrigin || typeof storage?.readPrivateImage !== "function") throw unavailable();
      const selectedBookingId = uuid(bookingId, "booking id");
      const id = uuid(photoId, "job photo id");
      const photo = await repository.getPhotoObject(actor, selectedBookingId, id);
      const expiresAt = new Date(now().getTime() + 5 * 60_000).toISOString();
      const url = new URL(`/api/marketplace/bookings/${selectedBookingId}/cleaning-progress/photos/${id}/content`, appOrigin);
      url.searchParams.set("expiresAt", expiresAt);
      return Object.freeze({ photoId: id, photoType: photo.photoType, note: photo.note, mimeType: photo.mimeType, byteSize: photo.byteSize, url: url.toString(), expiresAt });
    },
    async getPhotoContent(actor, bookingId, photoId, expiresAt) {
      if (!actor?.userId) throw new TypeError("An authenticated marketplace account is required to view a job photo.");
      const expiry = new Date(expiresAt);
      const remaining = expiry.getTime() - now().getTime();
      if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 5 * 60_000 || expiry.toISOString() !== expiresAt) throw Object.assign(new Error("The private photo link has expired. Open the photo again."), { statusCode: 410, code: "job-photo-link-expired" });
      const selectedBookingId = uuid(bookingId, "booking id");
      const id = uuid(photoId, "job photo id");
      // Authorize before fetching, then again after the storage read so a
      // permission withdrawn during that read cannot release new bytes.
      const photo = await repository.getPhotoObject(actor, selectedBookingId, id);
      if (typeof storage?.readPrivateImage !== "function") throw unavailable();
      let bytes;
      try { bytes = await storage.readPrivateImage({ storageKey: photo.storageKey, byteSize: photo.byteSize }); } catch { throw unavailable(); }
      if (!Buffer.isBuffer(bytes) || bytes.length !== photo.byteSize || bytes.length > 15_000_000 || photo.mimeType !== "image/jpeg" || createHash("sha256").update(bytes).digest("hex") !== photo.checksumSha256) throw unavailable();
      const current = await repository.getPhotoObject(actor, selectedBookingId, id);
      if (current.storageKey !== photo.storageKey || current.checksumSha256 !== photo.checksumSha256 || expiry.getTime() <= now().getTime()) throw Object.assign(new Error("The private photo is no longer available. Open the photo again."), { statusCode: 410, code: "job-photo-link-expired" });
      return Object.freeze({ mimeType: "image/jpeg", bytes });
    }
  });
}

export { mimeTypes as jobPhotoMimeTypes, photoTypes as jobPhotoTypes };
