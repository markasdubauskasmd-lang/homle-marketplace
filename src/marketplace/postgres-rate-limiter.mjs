import { createHmac } from "node:crypto";

const supportedScopes = Object.freeze([
  "google-start",
  "google-callback",
  "apple-start",
  "apple-callback",
  "facebook-start",
  "facebook-callback",
  "facebook-verification-confirm",
  "facebook-data-deletion",
  "facebook-data-deletion-status",
  "signup",
  "verification-resend",
  "verification-confirm",
  "login",
  "session-recovery",
  "password-reset-request",
  "password-reset-confirm",
  "marketplace-public:cleaner-directory",
  "marketplace-public:cleaner-profile",
  "marketplace-public:cleaner-reviews",
  // Metered provider call — see db/migrations/065_scan_summary_rate_limit.sql
  "marketplace-landlord:scan-summary"
]);

function secretKey(value) {
  if (typeof value !== "string" || value.length < 32) throw new TypeError("A 32-character secret is required for private rate-limit keys.");
  return value;
}

function boundedText(value, maximum, label) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > maximum || /[\u0000-\u001f\u007f]/.test(text)) throw new TypeError(`${label} is invalid.`);
  return text;
}

function privateKeyHash(scope, key, secret) {
  return createHmac("sha256", secret)
    .update("tideway:rate-limit-key:v1\0", "utf8")
    .update(scope, "utf8")
    .update("\0", "utf8")
    .update(key, "utf8")
    .digest();
}

export function createPostgresRateLimiter(pool, options = {}) {
  if (!pool || typeof pool.query !== "function") throw new TypeError("The PostgreSQL rate limiter requires a query-capable pool.");
  const secret = secretKey(options.secret);

  return Object.freeze({
    async consume(input) {
      const scope = boundedText(input?.scope, 100, "Rate-limit scope");
      if (!supportedScopes.includes(scope)) throw new TypeError("Rate-limit scope has no reviewed database policy.");
      const key = boundedText(input?.key, 200, "Trusted rate-limit key");
      const result = await pool.query(
        "SELECT allowed, retry_after_seconds FROM tideway_private.consume_rate_limit($1::text, $2::bytea)",
        [scope, privateKeyHash(scope, key, secret)]
      );
      const row = result?.rows?.[0];
      if (!row || typeof row.allowed !== "boolean") throw new TypeError("The PostgreSQL rate limiter returned an invalid decision.");
      const retryAfterSeconds = Number(row.retry_after_seconds);
      if (!Number.isInteger(retryAfterSeconds) || retryAfterSeconds < 0 || retryAfterSeconds > 3600 || (row.allowed === false && retryAfterSeconds < 1)) throw new TypeError("The PostgreSQL rate limiter returned an invalid retry time.");
      return row.allowed ? { allowed: true } : { allowed: false, retryAfterSeconds };
    }
  });
}

export { supportedScopes as postgresRateLimitScopes };
