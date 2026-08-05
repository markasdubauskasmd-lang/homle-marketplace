import assert from "node:assert/strict";
import { createCleanerProfilePhotoService, maximumCleanerProfilePhotoBytes } from "../src/marketplace/cleaner-profile-photo.mjs";

const actor = { userId: "22222222-2222-4222-8222-222222222222", roles: ["cleaner"] };
const calls = [];
const stored = Buffer.from("metadata-free-jpeg");
const repository = {
  async saveOwnPhoto(selectedActor, photo) {
    calls.push({ selectedActor, photo });
    return { mime_type: photo.mimeType, byte_size: photo.byteSize, width: photo.width, height: photo.height, updated_at: "2026-08-04T12:00:00.000Z" };
  },
  async getOwnPhoto() {
    return { image_bytes: stored, mime_type: "image/jpeg", byte_size: stored.length, width: 640, height: 480, updated_at: "2026-08-04T12:00:00.000Z" };
  }
};
const service = createCleanerProfilePhotoService(repository, { async processImage() { return { bytes: stored, width: 640, height: 480 }; } });

const saved = await service.saveOwnPhoto(actor, { mimeType: "image/png", bytes: Buffer.from("source-png") });
assert.equal(saved.mimeType, "image/jpeg");
assert.equal(saved.width, 640);
assert.equal(calls[0].selectedActor, actor);
assert.equal(calls[0].photo.bytes, stored);
assert.match(calls[0].photo.checksumSha256, /^[a-f0-9]{64}$/);
const read = await service.getOwnPhoto(actor);
assert.equal(read.bytes, stored);

await assert.rejects(() => service.saveOwnPhoto(actor, { mimeType: "image/gif", bytes: Buffer.from("gif") }), /JPG, PNG or WebP/);
await assert.rejects(() => service.saveOwnPhoto(actor, { mimeType: "image/jpeg", bytes: Buffer.alloc(maximumCleanerProfilePhotoBytes + 1) }), /5 MB/);
await assert.rejects(() => service.getOwnPhoto({ userId: actor.userId, roles: ["landlord"] }), /Cleaner account/);

console.log("Cleaner profile photo tests passed: private ownership, type and size limits, sanitised JPEG storage and safe metadata projection.");
