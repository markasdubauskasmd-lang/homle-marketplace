import assert from "node:assert/strict";
import { maximumRoomPhotoBytes, maximumRoomPhotos, validatedRoomPhotoSelection } from "../public/room-photo-selection.js";

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

console.log("room photo selection tests passed");
