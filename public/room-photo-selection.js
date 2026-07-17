const supportedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);
const heicName = /\.heic$/i;

export const maximumRoomPhotos = 10;
export const maximumRoomPhotoBytes = 15_000_000;

function normalizedMimeType(file) {
  const supplied = String(file?.type || "").toLowerCase();
  if (supportedTypes.has(supplied)) return supplied;
  if (!supplied && heicName.test(String(file?.name || ""))) return "image/heic";
  return "";
}

export function validatedRoomPhotoSelection(fileList, { existingPhotoCount = 0 } = {}) {
  const files = Array.from(fileList || []);
  const existing = Number(existingPhotoCount);
  if (!Number.isInteger(existing) || existing < 0 || existing > maximumRoomPhotos) throw new TypeError("The current room-photo count is unavailable. Refresh the scan and try again.");
  if (!files.length) return [];
  const remaining = maximumRoomPhotos - existing;
  if (files.length > remaining) throw new TypeError(`Choose no more than ${remaining} additional room ${remaining === 1 ? "photo" : "photos"}. A request can contain up to ten.`);
  return files.map((file) => {
    const mimeType = normalizedMimeType(file);
    const byteSize = Number(file?.size);
    if (!mimeType || !Number.isInteger(byteSize) || byteSize < 1 || byteSize > maximumRoomPhotoBytes) throw new TypeError("Choose JPEG, PNG, WebP or HEIC images up to 15 MB each.");
    return Object.freeze({ file, mimeType, byteSize, name: String(file?.name || "Camera photo").slice(0, 240) || "Camera photo" });
  });
}
