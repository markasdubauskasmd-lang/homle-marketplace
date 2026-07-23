import assert from "node:assert/strict";
import {
  maximumGuidedRoomPhotoPixels,
  maximumRoomPhotoBytes,
  maximumRoomPhotos,
  validatedGuidedRoomPhotoDimensions,
  validatedGuidedRoomPhotoFile,
  validatedRoomPhotoSelection
} from "../public/room-photo-selection.js";
import { extractRoomVideoFrames, maximumRoomVideoBytes, maximumRoomVideoFrames, maximumRoomVideoSeconds, roomVideoContactSheetLayout, roomVideoFrameTimes, validatedRoomVideoFile } from "../public/room-video-frames.js";

const photo = (name, type = "image/jpeg", size = 1_000_000) => ({ name, type, size });
const batch = validatedRoomPhotoSelection([photo("one.jpg"), photo("two.webp", "image/webp")], { existingPhotoCount: 3 });
assert.equal(batch.length, 2);
assert.equal(batch[1].mimeType, "image/webp");
assert.equal(validatedRoomPhotoSelection([photo("iphone.HEIC", "")])[0].mimeType, "image/heic", "An iPhone HEIC file with an empty browser MIME type was rejected.");
assert.throws(() => validatedRoomPhotoSelection([photo("unsupported.heif", "image/heif")]), /JPEG, PNG, WebP or HEIC/);
assert.throws(() => validatedRoomPhotoSelection([photo("large.jpg", "image/jpeg", maximumRoomPhotoBytes + 1)]), /15 MB each/);
assert.throws(() => validatedRoomPhotoSelection([photo("one.jpg"), photo("two.jpg")], { existingPhotoCount: 9 }), /no more than 1 additional room photo/);
assert.throws(() => validatedRoomPhotoSelection([photo("one.jpg")], { existingPhotoCount: maximumRoomPhotos }), /no more than 0 additional room photos/);
assert.deepEqual(validatedRoomPhotoSelection([], { existingPhotoCount: 0 }), []);
assert.equal(validatedGuidedRoomPhotoFile(photo("camera-capture", "image/jpeg")).mimeType, "image/jpeg");
assert.equal(validatedGuidedRoomPhotoFile(photo("iphone.HEIC", "")).mimeType, "image/unknown");
assert.throws(() => validatedGuidedRoomPhotoFile(photo("vector.svg", "image/svg+xml")), /standard room photo/);
assert.throws(() => validatedGuidedRoomPhotoFile(photo("renamed.txt", "")), /standard room photo/);
assert.throws(() => validatedGuidedRoomPhotoFile(photo("large.jpg", "image/jpeg", maximumRoomPhotoBytes + 1)), /15 MB/);
assert.deepEqual(validatedGuidedRoomPhotoDimensions(8_000, 6_000), { width: 8_000, height: 6_000 });
assert.throws(() => validatedGuidedRoomPhotoDimensions(maximumGuidedRoomPhotoPixels, 2), /too large to prepare/);
assert.throws(() => validatedGuidedRoomPhotoDimensions(0, 1_000), /too large to prepare/);
const video = (name, type = "video/mp4", size = 12_000_000) => ({ name, type, size });
assert.equal(validatedRoomVideoFile(video("kitchen.mp4")).mimeType, "video/mp4");
assert.deepEqual(roomVideoFrameTimes(maximumRoomVideoSeconds, maximumRoomVideoFrames), [7.5, 15, 22.5]);
assert.throws(() => validatedRoomVideoFile(video("large.mp4", "video/mp4", maximumRoomVideoBytes + 1)), /up to 60 MB/);
assert.throws(() => validatedRoomVideoFile(video("unsafe.avi", "video/x-msvideo")), /MP4, MOV or WebM/);
assert.throws(() => roomVideoFrameTimes(maximumRoomVideoSeconds + 1), /between 1 and 30 seconds/);
assert.deepEqual(roomVideoContactSheetLayout({ frameCount: 3, sourceWidth: 720, sourceHeight: 1280, canvasWidth: 1280, canvasHeight: 720 }), { columns: 3, rows: 1, cellWidth: 1280 / 3, cellHeight: 720 });
assert.deepEqual(roomVideoContactSheetLayout({ frameCount: 3, sourceWidth: 1280, sourceHeight: 720, canvasWidth: 720, canvasHeight: 1280 }), { columns: 1, rows: 3, cellWidth: 720, cellHeight: 1280 / 3 });
assert.throws(() => roomVideoContactSheetLayout({ frameCount: 0, sourceWidth: 720, sourceHeight: 1280, canvasWidth: 720, canvasHeight: 1280 }), /frame count/);
assert.throws(() => roomVideoContactSheetLayout({ frameCount: 3, sourceWidth: 0, sourceHeight: 1280, canvasWidth: 720, canvasHeight: 1280 }), /dimensions/);

class FakeVideo {
  #listeners = new Map();
  duration = 8;
  videoWidth = 1920;
  videoHeight = 1080;
  addEventListener(name, listener) { if (!this.#listeners.has(name)) this.#listeners.set(name, new Set()); this.#listeners.get(name).add(listener); }
  removeEventListener(name, listener) { this.#listeners.get(name)?.delete(listener); }
  emit(name) { for (const listener of [...(this.#listeners.get(name) || [])]) listener(); }
  set src(value) { this.source = value; queueMicrotask(() => this.emit("loadedmetadata")); }
  removeAttribute() { this.source = ""; }
  load() {}
  set currentTime(value) { this.time = value; queueMicrotask(() => this.emit("seeked")); }
}
const originalDocument = globalThis.document;
const originalWindow = globalThis.window;
const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;
const drawn = [];
const revoked = [];
try {
  globalThis.window = globalThis;
  globalThis.document = { createElement(name) {
    if (name === "video") return new FakeVideo();
    if (name === "canvas") return { width: 0, height: 0, getContext: () => ({ drawImage: (...input) => drawn.push(input) }), toBlob: (callback) => callback(new Blob(["jpeg"], { type: "image/jpeg" })) };
    throw new Error(`Unexpected element ${name}`);
  } };
  URL.createObjectURL = () => "blob:private-room-video";
  URL.revokeObjectURL = (value) => revoked.push(value);
  const frames = await extractRoomVideoFrames(video("kitchen.mp4"));
  assert.equal(frames.length, maximumRoomVideoFrames);
  assert.deepEqual(frames.map((frame) => frame.name), ["room-video-frame-1.jpg", "room-video-frame-2.jpg", "room-video-frame-3.jpg"]);
  assert.equal(drawn.length, maximumRoomVideoFrames);
  assert.deepEqual(revoked, ["blob:private-room-video"]);
} finally {
  globalThis.document = originalDocument;
  globalThis.window = originalWindow;
  URL.createObjectURL = originalCreateObjectUrl;
  URL.revokeObjectURL = originalRevokeObjectUrl;
}

console.log("room photo selection tests passed");
