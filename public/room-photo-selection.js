const supportedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);
const heicName = /\.heic$/i;
const guidedPhotoName = /\.(?:jpe?g|png|webp|heic|heif|avif|gif|bmp)$/i;
const unsafeGuidedPhotoType = /(?:svg|xml)/i;

export const maximumRoomPhotos = 10;
export const maximumRoomPhotoBytes = 15_000_000;
export const maximumGuidedRoomPhotoPixels = 50_000_000;
export const maximumGuidedRoomPhotoSide = 16_384;

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

// The native camera picker needs `accept="image/*"` to open reliably across
// iPhone and Android browsers. Keep that broad picker while enforcing a raster
// image boundary before the scanner creates an object URL or canvas. An empty
// MIME type is accepted only for a familiar camera/photo filename.
export function validatedGuidedRoomPhotoFile(file) {
  const mimeType = String(file?.type || "").trim().toLowerCase();
  const name = String(file?.name || "").slice(0, 240);
  const byteSize = Number(file?.size);
  const rasterType = mimeType.startsWith("image/") && !unsafeGuidedPhotoType.test(mimeType);
  const inferredRaster = !mimeType && guidedPhotoName.test(name);
  if ((!rasterType && !inferredRaster) || !Number.isInteger(byteSize) || byteSize < 1 || byteSize > maximumRoomPhotoBytes) {
    throw new TypeError("Choose a standard room photo up to 15 MB.");
  }
  return Object.freeze({ file, mimeType: mimeType || "image/unknown", byteSize, name: name || "Camera photo" });
}

export function validatedGuidedRoomPhotoDimensions(width, height) {
  const normalizedWidth = Number(width);
  const normalizedHeight = Number(height);
  const supported = Number.isInteger(normalizedWidth)
    && Number.isInteger(normalizedHeight)
    && normalizedWidth > 0
    && normalizedHeight > 0
    && normalizedWidth <= maximumGuidedRoomPhotoSide
    && normalizedHeight <= maximumGuidedRoomPhotoSide
    && normalizedWidth * normalizedHeight <= maximumGuidedRoomPhotoPixels;
  if (!supported) throw new TypeError("That photo is too large to prepare. Choose a standard phone photo or a lower-resolution copy.");
  return Object.freeze({ width: normalizedWidth, height: normalizedHeight });
}
