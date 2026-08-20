import { createHash } from "node:crypto";
import { Webhook } from "svix";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const eventIdPattern = /^[A-Za-z0-9_-]{1,128}$/;
const messageIdPattern = /^[A-Za-z0-9_-]{1,200}$/;
const suppressionReasons = Object.freeze({
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.suppressed": "suppressed"
});

function headerValue(headers, name) {
  const supplied = headers?.[name] ?? headers?.[name.toLowerCase()];
  return Array.isArray(supplied) ? supplied[0] : typeof supplied === "string" ? supplied : "";
}

function invalid(cause) {
  return Object.assign(new Error("The email-delivery webhook could not be verified."), {
    statusCode: 400,
    code: "invalid-email-webhook",
    cause
  });
}

function verifiedEvent(value, providerEventId, payloadSha256) {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.type !== "string") throw invalid();
  const reason = suppressionReasons[value.type];
  if (!reason) return Object.freeze({ ignored: true });
  const recipients = value.data?.to;
  if (!Array.isArray(recipients) || recipients.length !== 1 || typeof recipients[0] !== "string") throw invalid();
  const recipientEmail = recipients[0].trim().toLowerCase();
  if (recipientEmail.length > 254 || !emailPattern.test(recipientEmail)) throw invalid();
  const providerMessageId = String(value.data?.email_id || "").trim();
  if (!messageIdPattern.test(providerMessageId)) throw invalid();
  const occurredAt = new Date(value.created_at);
  if (!Number.isFinite(occurredAt.getTime()) || occurredAt.getTime() > Date.now() + 86_400_000) throw invalid();
  return Object.freeze({
    ignored: false,
    providerEventId,
    recipientEmail,
    providerMessageId,
    reason,
    occurredAt: occurredAt.toISOString(),
    payloadSha256
  });
}

export function createResendWebhookService(repository, env = process.env) {
  if (!repository || typeof repository.record !== "function") throw new TypeError("A complete email-suppression repository is required.");
  const secret = String(env.RESEND_WEBHOOK_SECRET || "").trim();
  if (!/^whsec_[A-Za-z0-9+/_=-]{16,512}$/.test(secret)) throw new TypeError("RESEND_WEBHOOK_SECRET is invalid.");
  const webhook = new Webhook(secret);

  return Object.freeze({
    async handle(rawBody, headers = {}) {
      if (!Buffer.isBuffer(rawBody)) throw invalid();
      const providerEventId = headerValue(headers, "svix-id").trim();
      const timestamp = headerValue(headers, "svix-timestamp").trim();
      const signature = headerValue(headers, "svix-signature").trim();
      if (!eventIdPattern.test(providerEventId) || !timestamp || !signature) throw invalid();
      let value;
      try {
        // Resend signs the exact UTF-8 payload. Parsing and re-stringifying it
        // before verification would invalidate the signature and weaken replay
        // protection, so the raw request bytes cross this boundary only once.
        value = webhook.verify(rawBody.toString("utf8"), {
          "svix-id": providerEventId,
          "svix-timestamp": timestamp,
          "svix-signature": signature
        });
      } catch (cause) {
        throw invalid(cause);
      }
      const event = verifiedEvent(value, providerEventId, createHash("sha256").update(rawBody).digest());
      if (event.ignored) return Object.freeze({ accepted: true, duplicate: false, ignored: true, matched: false });
      return repository.record(event);
    }
  });
}
