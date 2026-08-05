import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const envelopeVersion = 1;
const ivLength = 12;
const tagLength = 16;

function encryptionKey(secret) {
  if (typeof secret !== "string" || secret.length < 32) throw new TypeError("A high-entropy data encryption secret of at least 32 characters is required.");
  return createHash("sha256").update("homle:cleaner-onboarding:v1\0", "utf8").update(secret, "utf8").digest();
}

function documentEncryptionKey(secret) {
  if (typeof secret !== "string" || secret.length < 32) throw new TypeError("A high-entropy data encryption secret of at least 32 characters is required.");
  return createHash("sha256").update("homle:cleaner-onboarding-document:v1\0", "utf8").update(secret, "utf8").digest();
}

function associatedData(cleanerId, section) {
  return Buffer.from(`homle:cleaner-onboarding:v1\0${cleanerId}\0${section}`, "utf8");
}

function documentAssociatedData(cleanerId, section, documentType) {
  return Buffer.from(`homle:cleaner-onboarding-document:v1\0${cleanerId}\0${section}\0${documentType}`, "utf8");
}

export function assertCleanerOnboardingEncryptionSecret(secret) {
  encryptionKey(secret);
  return true;
}

export function encryptCleanerOnboardingPayload(payload, cleanerId, section, secret) {
  const iv = randomBytes(ivLength);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv, { authTagLength: tagLength });
  cipher.setAAD(associatedData(cleanerId, section));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([envelopeVersion]), iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptCleanerOnboardingPayload(envelope, cleanerId, section, secret) {
  if (!Buffer.isBuffer(envelope) || envelope.length <= 1 + ivLength + tagLength || envelope[0] !== envelopeVersion) throw new TypeError("Cleaner onboarding data is invalid or unsupported.");
  const iv = envelope.subarray(1, 1 + ivLength);
  const tag = envelope.subarray(1 + ivLength, 1 + ivLength + tagLength);
  const ciphertext = envelope.subarray(1 + ivLength + tagLength);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), iv, { authTagLength: tagLength });
  decipher.setAAD(associatedData(cleanerId, section));
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"));
}

export function encryptCleanerOnboardingDocument(bytes, cleanerId, section, documentType, secret) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1) throw new TypeError("A document file is required.");
  const iv = randomBytes(ivLength);
  const cipher = createCipheriv("aes-256-gcm", documentEncryptionKey(secret), iv, { authTagLength: tagLength });
  cipher.setAAD(documentAssociatedData(cleanerId, section, documentType));
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([Buffer.from([envelopeVersion]), iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptCleanerOnboardingDocument(envelope, cleanerId, section, documentType, secret) {
  if (!Buffer.isBuffer(envelope) || envelope.length <= 1 + ivLength + tagLength || envelope[0] !== envelopeVersion) throw new TypeError("Cleaner onboarding document data is invalid or unsupported.");
  const iv = envelope.subarray(1, 1 + ivLength);
  const tag = envelope.subarray(1 + ivLength, 1 + ivLength + tagLength);
  const ciphertext = envelope.subarray(1 + ivLength + tagLength);
  const decipher = createDecipheriv("aes-256-gcm", documentEncryptionKey(secret), iv, { authTagLength: tagLength });
  decipher.setAAD(documentAssociatedData(cleanerId, section, documentType));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
