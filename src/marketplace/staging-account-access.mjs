import { createHash, timingSafeEqual } from "node:crypto";
import { normalizedEmail } from "./auth-repository.mjs";

const sha256Pattern = /^[a-f0-9]{64}$/;
const maximumApprovedAccounts = 20;

function enabled(value) {
  const selected = String(value || "").trim().toLowerCase();
  if (!selected || selected === "false") return false;
  if (selected === "true") return true;
  throw new TypeError("STAGING_ACCOUNTS_ONLY must be true or false.");
}

function approvedDigests(value) {
  const supplied = String(value || "").trim();
  if (!supplied) return [];
  const values = supplied.split(",").map((entry) => entry.trim().toLowerCase());
  if (values.length > maximumApprovedAccounts || values.some((entry) => !sha256Pattern.test(entry)) || new Set(values).size !== values.length) {
    throw new TypeError(`STAGING_ACCOUNT_EMAIL_SHA256 must contain up to ${maximumApprovedAccounts} unique comma-separated SHA-256 values.`);
  }
  return values.map((entry) => Buffer.from(entry, "hex"));
}

export function stagingAccountEmailSha256(emailValue) {
  return createHash("sha256").update(normalizedEmail(emailValue), "utf8").digest("hex");
}

export function createStagingAccountAccess(env = process.env) {
  const restricted = enabled(env.STAGING_ACCOUNTS_ONLY);
  const digests = approvedDigests(env.STAGING_ACCOUNT_EMAIL_SHA256);
  if (!restricted && digests.length) throw new TypeError("STAGING_ACCOUNT_EMAIL_SHA256 requires STAGING_ACCOUNTS_ONLY=true.");
  return Object.freeze({
    restricted,
    allows(emailValue) {
      if (!restricted) return true;
      let candidate;
      try { candidate = Buffer.from(stagingAccountEmailSha256(emailValue), "hex"); } catch { return false; }
      return digests.some((digest) => timingSafeEqual(candidate, digest));
    }
  });
}
