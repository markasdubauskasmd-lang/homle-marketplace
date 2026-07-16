import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createS3ObjectStorage } from "../src/marketplace/s3-object-storage.mjs";

const bookingId = "55555555-5555-4555-8555-555555555555";
const photoId = "88888888-8888-4888-8888-888888888888";
const quarantineKey = `quarantine/job-photos/${bookingId}/${photoId}`;
const finalKey = `job-photos/${bookingId}/${photoId}.jpg`;
const requestQuarantineKey = `quarantine/request-photos/${bookingId}/${photoId}`;
const requestFinalKey = `request-photos/${bookingId}/${photoId}.jpg`;
const checksum = "a".repeat(64);
const sourceBytes = Buffer.from("synthetic-image-input");
const outputBytes = Buffer.from("synthetic-sanitized-jpeg");
const commands = [];
const signed = [];
let destroyed = 0;
let sharpOptions;
let pipelineCalls = [];

class Command { constructor(input) { this.input = input; } }
class S3Client {
  constructor(configuration) { this.configuration = configuration; S3Client.instance = this; }
  async send(command) {
    commands.push(command);
    if (command instanceof HeadObjectCommand) return { ContentType: "image/png", ContentLength: 21, ChecksumSHA256: Buffer.from(checksum, "hex").toString("base64"), Metadata: { "tideway-sha256": checksum } };
    if (command instanceof GetObjectCommand && command.input.Key === quarantineKey) return { ContentLength: sourceBytes.length, Body: (async function* () { yield sourceBytes.subarray(0, 4); yield sourceBytes.subarray(4); })() };
    return {};
  }
  destroy() { destroyed += 1; }
}
class HeadBucketCommand extends Command {}
class PutObjectCommand extends Command {}
class HeadObjectCommand extends Command {}
class GetObjectCommand extends Command {}
class DeleteObjectCommand extends Command {}

const s3ClientModule = { S3Client, HeadBucketCommand, PutObjectCommand, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand };
const presignerModule = { async getSignedUrl(client, command, options) { signed.push({ client, command, options }); return `https://objects.invalid.example/signed/${signed.length}`; } };
function sharp(input, options) {
  assert.deepEqual(input, sourceBytes);
  sharpOptions = options;
  const pipeline = {
    async metadata() { pipelineCalls.push("metadata"); return { width: 1200, height: 900, pages: 1, orientation: 6 }; },
    rotate() { pipelineCalls.push("rotate"); return pipeline; },
    flatten(input) { pipelineCalls.push(["flatten", input]); return pipeline; },
    jpeg(input) { pipelineCalls.push(["jpeg", input]); return pipeline; },
    async toBuffer(input) { pipelineCalls.push(["buffer", input]); return { data: outputBytes, info: { format: "jpeg", width: 1200, height: 900 } }; }
  };
  return pipeline;
}

const env = {
  NODE_ENV: "production",
  OBJECT_STORAGE_ENDPOINT: "https://objects.invalid.example",
  OBJECT_STORAGE_BUCKET: "tideway-private-test",
  OBJECT_STORAGE_REGION: "eu-west-2",
  OBJECT_STORAGE_ACCESS_KEY_ID: "reserved-test-access-key",
  OBJECT_STORAGE_SECRET_ACCESS_KEY: "reserved-test-secret-key",
  OBJECT_STORAGE_FORCE_PATH_STYLE: "true"
};
const now = () => new Date("2026-07-16T12:00:00.000Z");
const storage = await createS3ObjectStorage(env, { s3ClientModule, presignerModule, sharp, now });
assert.deepEqual(S3Client.instance.configuration.credentials, { accessKeyId: env.OBJECT_STORAGE_ACCESS_KEY_ID, secretAccessKey: env.OBJECT_STORAGE_SECRET_ACCESS_KEY });
assert.equal(Object.isFrozen(S3Client.instance.configuration.credentials), false);
assert.equal(S3Client.instance.configuration.endpoint, env.OBJECT_STORAGE_ENDPOINT);
assert.equal(S3Client.instance.configuration.forcePathStyle, true);
assert.equal(S3Client.instance.configuration.maxAttempts, 2);
await storage.verify();
assert(commands[0] instanceof HeadBucketCommand && commands[0].input.Bucket === env.OBJECT_STORAGE_BUCKET);

const upload = await storage.createUploadUrl({ storageKey: quarantineKey, mimeType: "image/png", byteSize: sourceBytes.length, checksumSha256: checksum, expiresAt: "2026-07-16T12:10:00.000Z" });
assert.equal(upload.url, "https://objects.invalid.example/signed/1");
assert.equal(upload.requiredHeaders["Content-Type"], "image/png");
assert.equal(upload.requiredHeaders["X-Amz-Meta-Tideway-Sha256"], checksum);
assert.equal(upload.requiredHeaders["X-Amz-Server-Side-Encryption"], "AES256");
assert.equal(signed[0].options.expiresIn, 600);
assert(signed[0].command instanceof PutObjectCommand && signed[0].command.input.Key === quarantineKey && signed[0].command.input.ContentLength === sourceBytes.length);

const head = await storage.headObject({ storageKey: quarantineKey });
assert.deepEqual(head, { mimeType: "image/png", byteSize: 21, checksumSha256: checksum });
const sanitized = await storage.inspectAndSanitizeImage({ sourceStorageKey: quarantineKey, targetStorageKey: finalKey, sourceMimeType: "image/png", maximumBytes: 15_000_000, stripMetadata: true });
assert.equal(sanitized.safe, true);
assert.equal(sanitized.outputMimeType, "image/jpeg");
assert.equal(sanitized.outputChecksumSha256, createHash("sha256").update(outputBytes).digest("hex"));
assert.deepEqual(sharpOptions, { failOn: "error", limitInputPixels: 40_000_000, animated: false, sequentialRead: true });
assert.deepEqual(pipelineCalls, ["metadata", "rotate", ["flatten", { background: "#ffffff" }], ["jpeg", { quality: 88, chromaSubsampling: "4:2:0" }], ["buffer", { resolveWithObject: true }]]);
const finalPut = commands.find((command) => command instanceof PutObjectCommand && command.input.Key === finalKey);
assert(finalPut && finalPut.input.ServerSideEncryption === "AES256" && finalPut.input.Metadata["tideway-sanitized"] === "true" && !Object.hasOwn(finalPut.input, "ACL"));

const read = await storage.createReadUrl({ storageKey: finalKey, expiresAt: "2026-07-16T12:05:00.000Z" });
assert.equal(read.url, "https://objects.invalid.example/signed/2");
assert.equal(signed[1].options.expiresIn, 300);
assert.equal(signed[1].command.input.ResponseCacheControl, "private, no-store, max-age=0");
const requestUpload = await storage.createUploadUrl({ storageKey: requestQuarantineKey, mimeType: "image/png", byteSize: sourceBytes.length, checksumSha256: checksum, expiresAt: "2026-07-16T12:10:00.000Z" });
const requestRead = await storage.createReadUrl({ storageKey: requestFinalKey, expiresAt: "2026-07-16T12:05:00.000Z" });
assert(requestUpload.uploadUrl === undefined && requestUpload.url.endsWith("/3") && requestRead.url.endsWith("/4") && signed[2].command.input.Key === requestQuarantineKey && signed[3].command.input.Key === requestFinalKey, "Private request-photo prefixes were not signed through the same bounded object-storage contract.");
await storage.deleteObject({ storageKey: quarantineKey });
assert(commands.at(-1) instanceof DeleteObjectCommand);
storage.close();
storage.close();
assert.equal(destroyed, 1);
await assert.rejects(() => storage.verify(), /closed/);

for (const invalid of [
  { ...env, OBJECT_STORAGE_ENDPOINT: "http://objects.invalid.example" },
  { ...env, OBJECT_STORAGE_ENDPOINT: "https://user:pass@objects.invalid.example" },
  { ...env, OBJECT_STORAGE_BUCKET: "192.0.2.1" },
  { ...env, OBJECT_STORAGE_REGION: "EU West" },
  { ...env, OBJECT_STORAGE_FORCE_PATH_STYLE: "sometimes" }
]) await assert.rejects(() => createS3ObjectStorage(invalid, { s3ClientModule, presignerModule, sharp, now }), /OBJECT_STORAGE/);

const fresh = () => createS3ObjectStorage(env, { s3ClientModule, presignerModule, sharp, now });
await assert.rejects(async () => (await fresh()).createUploadUrl({ storageKey: "public/file.jpg", mimeType: "image/jpeg", byteSize: 1, checksumSha256: checksum, expiresAt: "2026-07-16T12:01:00.000Z" }), /private media prefixes/);
await assert.rejects(async () => (await fresh()).createUploadUrl({ storageKey: quarantineKey, mimeType: "text/html", byteSize: 1, checksumSha256: checksum, expiresAt: "2026-07-16T12:01:00.000Z" }), /unsupported/);
await assert.rejects(async () => (await fresh()).createUploadUrl({ storageKey: quarantineKey, mimeType: "image/jpeg", byteSize: 1, checksumSha256: checksum, expiresAt: "2026-07-16T12:11:00.000Z" }), /expiry/);

function oversizedSharp() {
  const pipeline = {
    async metadata() { return { width: 10_000, height: 10_000, pages: 1 }; }, rotate() { return pipeline; }, flatten() { return pipeline; }, jpeg() { return pipeline; }, async toBuffer() { throw new Error("must not encode"); }
  };
  return pipeline;
}
const unsafeStorage = await createS3ObjectStorage(env, { s3ClientModule, presignerModule, sharp: oversizedSharp, now });
await assert.rejects(() => unsafeStorage.inspectAndSanitizeImage({ sourceStorageKey: quarantineKey, targetStorageKey: finalKey, sourceMimeType: "image/png", maximumBytes: 15_000_000, stripMetadata: true }), (error) => error.unsafe === true && error.message === "image-decode-or-reencode-failed");

let privateFailure;
class FailingClient extends S3Client { async send() { throw new Error("private object credential detail"); } }
const failing = await createS3ObjectStorage(env, { s3ClientModule: { ...s3ClientModule, S3Client: FailingClient }, presignerModule, sharp, now, onUnexpectedError(error) { privateFailure = error; } });
await assert.rejects(() => failing.verify(), (error) => error.message === "object-storage-operation-failed" && !error.message.includes("credential"));
assert(privateFailure?.message.includes("credential"));

console.log("S3 object-storage tests passed: exact private prefixes, signed checksum/encryption headers, bounded reads, metadata-stripping JPEG re-encode, private reads, cleanup, sanitized failures and idempotent close.");
