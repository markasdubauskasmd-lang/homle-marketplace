import { createHash } from "node:crypto";

const checksumPattern = /^[a-f0-9]{64}$/;
const bucketPattern = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const regionPattern = /^[a-z0-9][a-z0-9-]{0,62}$/;
const uuidSource = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const storageKeyPattern = new RegExp(`^(?:quarantine/(?:job-photos|request-photos)/${uuidSource}/${uuidSource}|(?:job-photos|request-photos)/${uuidSource}/${uuidSource}\\.jpg)$`);
const mimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);

function bounded(value, maximum, label) {
  const selected = typeof value === "string" ? value.trim() : "";
  if (!selected || selected.length > maximum || /[\u0000-\u0020\u007f]/.test(selected)) throw new TypeError(`${label} is invalid.`);
  return selected;
}

function configuration(env) {
  let endpoint;
  try { endpoint = new URL(env.OBJECT_STORAGE_ENDPOINT); } catch { throw new TypeError("OBJECT_STORAGE_ENDPOINT must be an exact HTTPS origin."); }
  const local = env.NODE_ENV !== "production" && endpoint.protocol === "http:" && ["127.0.0.1", "localhost"].includes(endpoint.hostname);
  if ((!local && endpoint.protocol !== "https:") || endpoint.username || endpoint.password || endpoint.pathname !== "/" || endpoint.search || endpoint.hash) throw new TypeError("OBJECT_STORAGE_ENDPOINT must be an exact HTTPS origin.");
  const bucket = bounded(env.OBJECT_STORAGE_BUCKET, 63, "OBJECT_STORAGE_BUCKET");
  if (!bucketPattern.test(bucket) || bucket.includes("..") || /^\d+\.\d+\.\d+\.\d+$/.test(bucket)) throw new TypeError("OBJECT_STORAGE_BUCKET is invalid.");
  const region = bounded(env.OBJECT_STORAGE_REGION, 63, "OBJECT_STORAGE_REGION").toLowerCase();
  if (!regionPattern.test(region)) throw new TypeError("OBJECT_STORAGE_REGION is invalid.");
  const accessKeyId = bounded(env.OBJECT_STORAGE_ACCESS_KEY_ID, 256, "OBJECT_STORAGE_ACCESS_KEY_ID");
  const secretAccessKey = bounded(env.OBJECT_STORAGE_SECRET_ACCESS_KEY, 1024, "OBJECT_STORAGE_SECRET_ACCESS_KEY");
  const pathStyleValue = String(env.OBJECT_STORAGE_FORCE_PATH_STYLE || "false").trim().toLowerCase();
  if (!new Set(["true", "false"]).has(pathStyleValue)) throw new TypeError("OBJECT_STORAGE_FORCE_PATH_STYLE must be true or false.");
  // AWS SDK v3 annotates supplied credential objects with non-secret provenance
  // metadata while resolving them, so this nested object must remain extensible.
  return Object.freeze({ endpoint: endpoint.origin, bucket, region, credentials: { accessKeyId, secretAccessKey }, forcePathStyle: pathStyleValue === "true" });
}

function storageKey(value, prefix) {
  const selected = bounded(value, 180, "Object storage key").toLowerCase();
  if (!storageKeyPattern.test(selected) || (prefix && !selected.startsWith(prefix))) throw new TypeError("Object storage key is outside Tideway's private media prefixes.");
  return selected;
}

function finalImageKey(value) {
  const selected = storageKey(value);
  if (!selected.startsWith("job-photos/") && !selected.startsWith("request-photos/")) throw new TypeError("Object storage key is outside Tideway's private final-image prefixes.");
  return selected;
}

function mimeType(value) {
  const selected = bounded(value, 40, "Object MIME type").toLowerCase();
  if (!mimeTypes.has(selected)) throw new TypeError("Object MIME type is unsupported.");
  return selected;
}

function checksum(value) {
  const selected = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!checksumPattern.test(selected)) throw new TypeError("Object checksum is invalid.");
  return selected;
}

function byteSize(value, maximum = 15_000_000) {
  const selected = Number(value);
  if (!Number.isInteger(selected) || selected < 1 || selected > maximum) throw new TypeError("Object byte size is invalid.");
  return selected;
}

function expirySeconds(value, maximum, now) {
  const expiresAt = new Date(value);
  const current = now();
  if (!(current instanceof Date) || !Number.isFinite(current.getTime()) || !Number.isFinite(expiresAt.getTime()) || expiresAt.toISOString() !== value) throw new TypeError("Signed object expiry is invalid.");
  const seconds = Math.ceil((expiresAt.getTime() - current.getTime()) / 1000);
  if (seconds < 1 || seconds > maximum) throw new TypeError("Signed object expiry is outside the supported window.");
  return seconds;
}

function base64Checksum(hex) {
  return Buffer.from(hex, "hex").toString("base64");
}

function hexChecksum(base64) {
  try {
    const bytes = Buffer.from(String(base64 || ""), "base64");
    return bytes.length === 32 ? bytes.toString("hex") : "";
  } catch { return ""; }
}

async function boundedBody(body, maximum) {
  if (!body || typeof body[Symbol.asyncIterator] !== "function") throw new Error("object-body-unavailable");
  const chunks = [];
  let total = 0;
  for await (const value of body) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    total += chunk.length;
    if (total > maximum) throw Object.assign(new Error("image-input-too-large"), { unsafe: true });
    chunks.push(chunk);
  }
  if (!total) throw Object.assign(new Error("image-input-empty"), { unsafe: true });
  return Buffer.concat(chunks, total);
}

function operationalFailure(error, onUnexpectedError) {
  try { onUnexpectedError(error); } catch {}
  return new Error("object-storage-operation-failed");
}

async function loadDependencies(options) {
  let client = options.s3ClientModule;
  let presigner = options.presignerModule;
  let sharp = options.sharp;
  try {
    if (!client) client = await import("@aws-sdk/client-s3");
    if (!presigner) presigner = await import("@aws-sdk/s3-request-presigner");
    if (!sharp) {
      const imported = await import("sharp");
      sharp = imported.default || imported;
    }
  } catch (error) { throw operationalFailure(error, options.onUnexpectedError || (() => {})); }
  return { client, presigner, sharp };
}

export async function createS3ObjectStorage(env = process.env, options = {}) {
  const selected = configuration(env);
  const onUnexpectedError = typeof options.onUnexpectedError === "function" ? options.onUnexpectedError : () => {};
  const now = typeof options.now === "function" ? options.now : () => new Date();
  const { client: sdk, presigner, sharp } = await loadDependencies({ ...options, onUnexpectedError });
  const requiredConstructors = ["S3Client", "HeadBucketCommand", "PutObjectCommand", "HeadObjectCommand", "GetObjectCommand", "DeleteObjectCommand"];
  if (!requiredConstructors.every((name) => typeof sdk?.[name] === "function") || typeof presigner?.getSignedUrl !== "function" || typeof sharp !== "function") throw new TypeError("The reviewed private-storage dependencies are incomplete.");
  const s3 = new sdk.S3Client({
    endpoint: selected.endpoint,
    region: selected.region,
    credentials: selected.credentials,
    forcePathStyle: selected.forcePathStyle,
    maxAttempts: 2,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED"
  });
  if (!s3 || typeof s3.send !== "function") throw new TypeError("The S3 client did not initialize.");
  let closed = false;

  async function send(command) {
    if (closed) throw new TypeError("Private object storage is closed.");
    try { return await s3.send(command); } catch (error) { throw operationalFailure(error, onUnexpectedError); }
  }

  async function sign(command, expiresIn, signing = {}) {
    if (closed) throw new TypeError("Private object storage is closed.");
    try { return await presigner.getSignedUrl(s3, command, { expiresIn, ...signing }); } catch (error) { throw operationalFailure(error, onUnexpectedError); }
  }

  return Object.freeze({
    async verify() {
      await send(new sdk.HeadBucketCommand({ Bucket: selected.bucket }));
      return true;
    },
    async createUploadUrl(input) {
      const key = storageKey(input?.storageKey, "quarantine/");
      const type = mimeType(input?.mimeType);
      const size = byteSize(input?.byteSize);
      const sha256 = checksum(input?.checksumSha256);
      const expiresIn = expirySeconds(input?.expiresAt, 600, now);
      const checksumBase64 = base64Checksum(sha256);
      const requiredHeaders = Object.freeze({
        "Content-Type": type,
        "X-Amz-Checksum-Sha256": checksumBase64,
        "X-Amz-Meta-Tideway-Sha256": sha256,
        "X-Amz-Server-Side-Encryption": "AES256"
      });
      const command = new sdk.PutObjectCommand({ Bucket: selected.bucket, Key: key, ContentType: type, ContentLength: size, ChecksumSHA256: checksumBase64, Metadata: { "tideway-sha256": sha256 }, ServerSideEncryption: "AES256" });
      const url = await sign(command, expiresIn, {
        signableHeaders: new Set(["content-type"]),
        unhoistableHeaders: new Set(["x-amz-checksum-sha256", "x-amz-meta-tideway-sha256", "x-amz-server-side-encryption"])
      });
      return Object.freeze({ url, requiredHeaders });
    },
    async headObject(input) {
      const key = storageKey(input?.storageKey);
      const result = await send(new sdk.HeadObjectCommand({ Bucket: selected.bucket, Key: key, ChecksumMode: "ENABLED" }));
      const metadataChecksum = checksum(result?.Metadata?.["tideway-sha256"]);
      const providerChecksum = result?.ChecksumSHA256 ? hexChecksum(result.ChecksumSHA256) : metadataChecksum;
      if (providerChecksum && providerChecksum !== metadataChecksum) throw new Error("object-checksum-mismatch");
      return Object.freeze({ mimeType: String(result?.ContentType || "").split(";", 1)[0].toLowerCase(), byteSize: Number(result?.ContentLength), checksumSha256: metadataChecksum });
    },
    async inspectAndSanitizeImage(input) {
      const sourceKey = storageKey(input?.sourceStorageKey, "quarantine/");
      const targetKey = finalImageKey(input?.targetStorageKey);
      mimeType(input?.sourceMimeType);
      const maximumBytes = byteSize(input?.maximumBytes);
      if (input?.stripMetadata !== true) throw new TypeError("Private images must strip metadata.");
      const source = await send(new sdk.GetObjectCommand({ Bucket: selected.bucket, Key: sourceKey, ChecksumMode: "ENABLED" }));
      if (Number(source?.ContentLength) > maximumBytes) throw Object.assign(new Error("image-input-too-large"), { unsafe: true });
      const body = await boundedBody(source?.Body, maximumBytes);
      let output;
      try {
        const image = sharp(body, { failOn: "error", limitInputPixels: 40_000_000, animated: false, sequentialRead: true });
        const metadata = await image.metadata();
        if (!metadata?.width || !metadata?.height || metadata.width > 20_000 || metadata.height > 20_000 || metadata.width * metadata.height > 40_000_000 || Number(metadata.pages || 1) !== 1) throw new Error("image-dimensions-unsafe");
        output = await image.rotate().flatten({ background: "#ffffff" }).jpeg({ quality: 88, chromaSubsampling: "4:2:0" }).toBuffer({ resolveWithObject: true });
      } catch (error) { throw Object.assign(new Error("image-decode-or-reencode-failed"), { unsafe: true }); }
      const bytes = Buffer.from(output?.data || []);
      if (!bytes.length || bytes.length > maximumBytes || !output?.info?.width || !output?.info?.height || output.info.format !== "jpeg") throw Object.assign(new Error("image-output-invalid"), { unsafe: true });
      const outputChecksumSha256 = createHash("sha256").update(bytes).digest("hex");
      await send(new sdk.PutObjectCommand({ Bucket: selected.bucket, Key: targetKey, Body: bytes, ContentType: "image/jpeg", ContentLength: bytes.length, ChecksumSHA256: base64Checksum(outputChecksumSha256), Metadata: { "tideway-sha256": outputChecksumSha256, "tideway-sanitized": "true" }, ServerSideEncryption: "AES256" }));
      return Object.freeze({ safe: true, outputMimeType: "image/jpeg", outputByteSize: bytes.length, outputChecksumSha256, width: Number(output.info.width), height: Number(output.info.height) });
    },
    async createReadUrl(input) {
      const key = finalImageKey(input?.storageKey);
      const expiresIn = expirySeconds(input?.expiresAt, 300, now);
      const command = new sdk.GetObjectCommand({ Bucket: selected.bucket, Key: key, ResponseContentType: "image/jpeg", ResponseCacheControl: "private, no-store, max-age=0" });
      return Object.freeze({ url: await sign(command, expiresIn) });
    },
    async deleteObject(input) {
      const key = storageKey(input?.storageKey);
      await send(new sdk.DeleteObjectCommand({ Bucket: selected.bucket, Key: key }));
    },
    close() {
      if (closed) return;
      closed = true;
      s3.destroy?.();
    }
  });
}
