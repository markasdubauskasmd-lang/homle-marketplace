const supportedVideoTypes = new Set(["video/mp4", "video/quicktime", "video/webm"]);

export const maximumRoomVideoBytes = 60_000_000;
export const maximumRoomVideoSeconds = 30;
export const maximumRoomVideoFrames = 3;

function boundedInteger(value, minimum, maximum, label) {
  const selected = Number(value);
  if (!Number.isInteger(selected) || selected < minimum || selected > maximum) throw new TypeError(`${label} is outside the supported range.`);
  return selected;
}

export function validatedRoomVideoFile(file) {
  const mimeType = String(file?.type || "").toLowerCase();
  const byteSize = Number(file?.size);
  if (!supportedVideoTypes.has(mimeType) || !Number.isInteger(byteSize) || byteSize < 1 || byteSize > maximumRoomVideoBytes) throw new TypeError("Record an MP4, MOV or WebM room video up to 60 MB.");
  return Object.freeze({ file, mimeType, byteSize, name: String(file?.name || "Room video").slice(0, 240) || "Room video" });
}

export function roomVideoFrameTimes(durationSeconds, frameCount = maximumRoomVideoFrames) {
  const duration = Number(durationSeconds);
  const count = boundedInteger(frameCount, 1, maximumRoomVideoFrames, "Room-video frame count");
  if (!Number.isFinite(duration) || duration < 1 || duration > maximumRoomVideoSeconds) throw new TypeError(`Keep the room video between 1 and ${maximumRoomVideoSeconds} seconds.`);
  return Object.freeze(Array.from({ length: count }, (_, index) => Number((duration * (index + 1) / (count + 1)).toFixed(3))));
}

export function roomVideoContactSheetLayout({ frameCount, sourceWidth, sourceHeight, canvasWidth, canvasHeight } = {}) {
  const count = boundedInteger(frameCount, 1, maximumRoomVideoFrames, "Room-video frame count");
  const dimensions = [sourceWidth, sourceHeight, canvasWidth, canvasHeight].map(Number);
  if (!dimensions.every((value) => Number.isFinite(value) && value > 0 && value <= 7680)) throw new TypeError("Room-video contact-sheet dimensions are unsupported.");
  const [sourceW, sourceH, canvasW, canvasH] = dimensions;
  const candidates = [{ columns: count, rows: 1 }, { columns: 1, rows: count }];
  const score = ({ columns, rows }) => {
    const scale = Math.min((canvasW / columns) / sourceW, (canvasH / rows) / sourceH);
    return sourceW * scale * sourceH * scale;
  };
  const selected = score(candidates[0]) >= score(candidates[1]) ? candidates[0] : candidates[1];
  return Object.freeze({
    columns: selected.columns,
    rows: selected.rows,
    cellWidth: canvasW / selected.columns,
    cellHeight: canvasH / selected.rows
  });
}

function waitFor(target, successEvent, failureEvent, timeoutMs, timeoutMessage) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (operation, value) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      target.removeEventListener(successEvent, success);
      target.removeEventListener(failureEvent, failure);
      operation(value);
    };
    const success = () => finish(resolve);
    const failure = () => finish(reject, new TypeError("This video could not be read safely. Record it again or use room photos."));
    const timer = window.setTimeout(() => finish(reject, new TypeError(timeoutMessage)), timeoutMs);
    target.addEventListener(successEvent, success, { once: true });
    target.addEventListener(failureEvent, failure, { once: true });
  });
}

function jpegBlob(canvas) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new TypeError("A room-video frame took too long to prepare. Try a shorter video.")), 10_000);
    canvas.toBlob((blob) => {
      window.clearTimeout(timer);
      if (!blob?.size || blob.type !== "image/jpeg") return reject(new TypeError("A room-video frame could not be prepared safely. Try room photos instead."));
      resolve(blob);
    }, "image/jpeg", 0.86);
  });
}

function namedFrame(blob, index) {
  const name = `room-video-frame-${index + 1}.jpg`;
  if (typeof File === "function") return new File([blob], name, { type: "image/jpeg", lastModified: Date.now() });
  Object.defineProperty(blob, "name", { configurable: true, value: name });
  return blob;
}

export async function extractRoomVideoFrames(file, { frameCount = maximumRoomVideoFrames } = {}) {
  const selected = validatedRoomVideoFile(file);
  if (typeof document === "undefined" || typeof document.createElement !== "function" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") throw new TypeError("This browser cannot prepare a private room video. Use current room photos instead.");
  const video = document.createElement("video");
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new TypeError("This browser cannot prepare private room-video frames. Use current room photos instead.");
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  const objectUrl = URL.createObjectURL(selected.file);
  try {
    const metadata = waitFor(video, "loadedmetadata", "error", 15_000, "The room video took too long to open. Try a shorter video.");
    video.src = objectUrl;
    await metadata;
    const times = roomVideoFrameTimes(video.duration, frameCount);
    const width = Number(video.videoWidth);
    const height = Number(video.videoHeight);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 7680 || height > 4320) throw new TypeError("The room video dimensions are unsupported. Record at standard phone quality.");
    const scale = Math.min(1, 1600 / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const frames = [];
    for (const [index, time] of times.entries()) {
      const seeked = waitFor(video, "seeked", "error", 10_000, "The room video took too long to scan. Try a shorter video.");
      video.currentTime = time;
      await seeked;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(namedFrame(await jpegBlob(canvas), index));
    }
    return Object.freeze(frames);
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}
