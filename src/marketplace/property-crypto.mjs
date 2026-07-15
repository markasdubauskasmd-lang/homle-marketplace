import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const envelopeVersion = 1;
const ivLength = 12;
const tagLength = 16;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function encryptionKey(secret) {
  if (typeof secret !== "string" || secret.length < 32) throw new TypeError("A high-entropy data encryption secret of at least 32 characters is required.");
  return createHash("sha256").update("tideway:data-encryption:v1\0", "utf8").update(secret, "utf8").digest();
}

export function assertPropertyEncryptionSecret(secret) {
  encryptionKey(secret);
  return true;
}

function authenticatedContext(propertyId) {
  if (!uuidPattern.test(propertyId || "")) throw new TypeError("A valid property id is required for authenticated encryption.");
  return Buffer.from(`tideway:property-access:v1:${propertyId.toLowerCase()}`, "utf8");
}

export function encryptPropertyAccessInstructions(value, propertyId, secret) {
  const plaintext = typeof value === "string" ? value.trim() : "";
  if (!plaintext) return null;
  if (plaintext.length > 3000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(plaintext)) throw new TypeError("Access instructions must contain at most 3000 safe characters.");
  const iv = randomBytes(ivLength);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv, { authTagLength: tagLength });
  cipher.setAAD(authenticatedContext(propertyId));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([envelopeVersion]), iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptPropertyAccessInstructions(envelope, propertyId, secret) {
  if (envelope == null) return "";
  if (!Buffer.isBuffer(envelope) || envelope.length <= 1 + ivLength + tagLength || envelope[0] !== envelopeVersion) throw new TypeError("Encrypted access instructions are invalid.");
  const iv = envelope.subarray(1, 1 + ivLength);
  const tag = envelope.subarray(1 + ivLength, 1 + ivLength + tagLength);
  const ciphertext = envelope.subarray(1 + ivLength + tagLength);
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), iv, { authTagLength: tagLength });
    decipher.setAAD(authenticatedContext(propertyId));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Encrypted access instructions could not be authenticated.");
  }
}
