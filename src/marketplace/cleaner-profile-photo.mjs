import { createHash } from "node:crypto";
import sharp from "sharp";

export const maximumCleanerProfilePhotoBytes = 5 * 1024 * 1024;
export const maximumStoredCleanerProfilePhotoBytes = 1536 * 1024;
export const cleanerProfilePhotoMimeTypes = Object.freeze(["image/jpeg", "image/png", "image/webp"]);

async function sanitizeProfilePhoto(bytes) {
  try {
    const image = sharp(bytes, { failOn: "warning", limitInputPixels: 40_000_000 });
    const source = await image.metadata();
    if (!["jpeg", "png", "webp"].includes(source.format)) throw new Error("unsupported-image-format");
    const { data, info } = await image
      .rotate()
      .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return { bytes: data, width: info.width, height: info.height };
  } catch {
    throw Object.assign(new Error("Choose a valid JPG, PNG or WebP photo."), { statusCode: 422, code: "invalid-profile-photo" });
  }
}

function requireCleaner(actor, action) {
  if (!actor?.userId || !actor.roles?.includes("cleaner")) throw new TypeError(`A Cleaner account is required to ${action}.`);
}

function metadata(record) {
  return Object.freeze({
    mimeType: record.mime_type || record.mimeType,
    byteSize: Number(record.byte_size || record.byteSize),
    width: Number(record.width),
    height: Number(record.height),
    updatedAt: new Date(record.updated_at || record.updatedAt).toISOString()
  });
}

export function createCleanerProfilePhotoService(repository, options = {}) {
  if (!repository || !["saveOwnPhoto", "getOwnPhoto"].every((method) => typeof repository[method] === "function")) throw new TypeError("A complete Cleaner profile photo repository is required.");
  const processImage = options.processImage || sanitizeProfilePhoto;
  return Object.freeze({
    async saveOwnPhoto(actor, input = {}) {
      requireCleaner(actor, "save a profile photo");
      const mimeType = String(input.mimeType || "").trim().toLowerCase();
      if (!cleanerProfilePhotoMimeTypes.includes(mimeType)) throw new TypeError("Choose a JPG, PNG or WebP photo.");
      const source = Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.from(input.bytes || []);
      if (!source.length) throw new TypeError("Choose a photo to upload.");
      if (source.length > maximumCleanerProfilePhotoBytes) throw Object.assign(new Error("The profile photo must be 5 MB or smaller."), { statusCode: 413, code: "profile-photo-too-large" });
      const processed = await processImage(source);
      if (!Buffer.isBuffer(processed?.bytes) || !processed.bytes.length || processed.bytes.length > maximumStoredCleanerProfilePhotoBytes) throw new TypeError("The profile photo could not be prepared for storage.");
      if (!Number.isInteger(processed.width) || !Number.isInteger(processed.height) || processed.width < 1 || processed.height < 1 || processed.width > 1024 || processed.height > 1024) throw new TypeError("The profile photo has unsupported dimensions.");
      return metadata(await repository.saveOwnPhoto(actor, {
        bytes: processed.bytes,
        mimeType: "image/jpeg",
        byteSize: processed.bytes.length,
        checksumSha256: createHash("sha256").update(processed.bytes).digest("hex"),
        width: processed.width,
        height: processed.height
      }));
    },
    async getOwnPhoto(actor) {
      requireCleaner(actor, "view a profile photo");
      const record = await repository.getOwnPhoto(actor);
      if (!record) return null;
      const bytes = Buffer.isBuffer(record.image_bytes) ? record.image_bytes : Buffer.from(record.bytes || []);
      return Object.freeze({ ...metadata(record), bytes });
    }
  });
}
