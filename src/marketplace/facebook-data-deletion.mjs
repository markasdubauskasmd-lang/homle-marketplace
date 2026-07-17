import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const signedPartPattern = /^[A-Za-z0-9_-]+$/;
const facebookSubjectPattern = /^\d{1,32}$/;
const confirmationCodePattern = /^[A-Za-z0-9_-]{32}$/;
const statuses = new Set(["requested", "verifying", "processing", "completed", "rejected"]);

function exactOrigin(value) {
  try {
    const url = new URL(value);
    if (url.origin !== String(value).replace(/\/$/, "") || url.username || url.password) throw new Error();
    return url.origin;
  } catch {
    throw new TypeError("Facebook data deletion requires an exact application origin.");
  }
}

function secret(value, label) {
  const selected = String(value || "").trim();
  if (selected.length < 32 || selected.length > 512) throw new TypeError(`${label} must contain between 32 and 512 characters.`);
  return selected;
}

function decodeSignedPart(value, label, maximumBytes) {
  if (!signedPartPattern.test(value || "") || value.length > Math.ceil(maximumBytes * 4 / 3) + 4) throw new TypeError(`Facebook returned an invalid ${label}.`);
  const decoded = Buffer.from(value, "base64url");
  if (!decoded.length || decoded.length > maximumBytes || decoded.toString("base64url") !== value) throw new TypeError(`Facebook returned an invalid ${label}.`);
  return decoded;
}

export function verifyFacebookDataDeletionRequest(signedRequest, appSecret) {
  const supplied = String(signedRequest || "");
  if (!supplied || supplied.length > 8192) throw new TypeError("Facebook supplied an invalid signed deletion request.");
  const parts = supplied.split(".");
  if (parts.length !== 2) throw new TypeError("Facebook supplied an invalid signed deletion request.");
  const signature = decodeSignedPart(parts[0], "deletion signature", 32);
  if (signature.length !== 32) throw new TypeError("Facebook returned an invalid deletion signature.");
  const expected = createHmac("sha256", secret(appSecret, "Facebook app secret")).update(parts[1], "utf8").digest();
  if (!timingSafeEqual(signature, expected)) throw new TypeError("Facebook deletion request signature verification failed.");
  const encodedPayload = decodeSignedPart(parts[1], "deletion payload", 4096);
  let payload;
  try { payload = JSON.parse(encodedPayload.toString("utf8")); } catch { throw new TypeError("Facebook returned an invalid deletion payload."); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.algorithm !== "HMAC-SHA256" || !facebookSubjectPattern.test(String(payload.user_id || ""))) {
    throw new TypeError("Facebook returned an unsupported deletion payload.");
  }
  if (payload.issued_at != null && (!Number.isInteger(payload.issued_at) || payload.issued_at < 0)) throw new TypeError("Facebook returned an invalid deletion issue time.");
  return Object.freeze({ subject: String(payload.user_id) });
}

function keyedDigest(key, purpose, value) {
  return createHmac("sha256", key).update(`homle:${purpose}\0${value}`, "utf8").digest();
}

function deletionStatus(value) {
  const record = typeof value === "string" ? JSON.parse(value) : value;
  if (!record || typeof record !== "object" || !statuses.has(record.status)) throw new Error("The Facebook deletion request status is unavailable.");
  const requestedAt = new Date(record.requestedAt);
  const completedAt = record.completedAt == null ? null : new Date(record.completedAt);
  if (!Number.isFinite(requestedAt.getTime()) || (completedAt && !Number.isFinite(completedAt.getTime()))) throw new Error("The Facebook deletion request status is unavailable.");
  return Object.freeze({ status: record.status, requestedAt: requestedAt.toISOString(), completedAt: completedAt?.toISOString() || null });
}

export function createFacebookDataDeletionService(repository, options = {}) {
  if (!repository || typeof repository.request !== "function" || typeof repository.status !== "function") throw new TypeError("A complete Facebook data-deletion repository is required.");
  const appOrigin = exactOrigin(options.appOrigin);
  const appSecret = secret(options.appSecret, "Facebook app secret");
  const tokenSecret = secret(options.tokenSecret, "Authentication token secret");

  function confirmationFor(subject) {
    return keyedDigest(tokenSecret, "facebook-deletion-confirmation", subject).subarray(0, 24).toString("base64url");
  }

  return Object.freeze({
    async request(signedRequest) {
      const { subject } = verifyFacebookDataDeletionRequest(signedRequest, appSecret);
      const confirmationCode = confirmationFor(subject);
      const result = deletionStatus(await repository.request({
        requestId: randomUUID(),
        subject,
        subjectHash: keyedDigest(tokenSecret, "facebook-deletion-subject", subject),
        confirmationCodeHash: createHash("sha256").update(confirmationCode, "utf8").digest()
      }));
      return Object.freeze({
        confirmationCode,
        statusUrl: `${appOrigin}/facebook-data-deletion#code=${confirmationCode}`,
        status: result.status
      });
    },
    async status(confirmationCode) {
      const selected = String(confirmationCode || "").trim();
      if (!confirmationCodePattern.test(selected)) return null;
      const record = await repository.status(createHash("sha256").update(selected, "utf8").digest());
      return record == null ? null : deletionStatus(record);
    }
  });
}
