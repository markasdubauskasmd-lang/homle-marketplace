import { createHash } from "node:crypto";

const emailPattern = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export function emailAddress(value, label) {
  const selected = typeof value === "string" ? value.trim() : "";
  if (!selected || selected.length > 254 || !emailPattern.test(selected) || /[\u0000-\u0020\u007f]/.test(selected)) throw new TypeError(`${label} is invalid.`);
  return selected;
}

export function fromIdentity(value) {
  const selected = typeof value === "string" ? value.trim() : "";
  if (!selected || selected.length > 320 || /[\u0000-\u001f\u007f]/.test(selected)) throw new TypeError("EMAIL_FROM is invalid.");
  const named = selected.match(/^([^<>]{1,100})\s+<([^<>]+)>$/);
  const address = emailAddress(named ? named[2] : selected, "EMAIL_FROM address");
  return Object.freeze({ value: selected, domain: address.slice(address.lastIndexOf("@") + 1).toLowerCase() });
}

export function exactEmailOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new TypeError("APP_ORIGIN is invalid for email delivery."); }
  const secure = url.protocol === "https:";
  const local = url.protocol === "http:" && url.hostname === "127.0.0.1";
  if ((!secure && !local) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new TypeError("APP_ORIGIN is invalid for email delivery.");
  return url.origin;
}

function trustedLink(value, kind, appOrigin) {
  let url;
  try { url = new URL(value); } catch { throw new TypeError("Authentication email link is invalid."); }
  const secure = url.protocol === "https:";
  const local = url.protocol === "http:" && url.hostname === "127.0.0.1";
  const expectedPath = kind === "email-verification" ? "/verify-email" : kind === "facebook-email-verification" ? "/verify-facebook" : "/reset-password";
  if ((!secure && !local) || url.origin !== appOrigin || url.pathname !== expectedPath || url.username || url.password || url.search || !url.hash) throw new TypeError("Authentication email link is invalid.");
  return url.toString();
}

function boundedLine(value, maximum, label) {
  const selected = typeof value === "string" ? value.trim() : "";
  if (!selected || selected.length > maximum || /[\u0000-\u001f\u007f]/.test(selected)) throw new TypeError(`${label} is invalid.`);
  return selected;
}

function boundedText(value) {
  const selected = typeof value === "string" ? value : "";
  if (!selected || selected.length > 6000 || selected.includes("\r") || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(selected)) throw new TypeError("Email text is invalid.");
  return selected;
}

export function stableEmailDeliveryId(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function preparedEmailMessage(input, appOrigin) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Email delivery payload is invalid.");
  if (input.kind === "email-verification" || input.kind === "facebook-email-verification" || input.kind === "password-reset") {
    const recipient = emailAddress(input.recipient, "Email recipient");
    const link = trustedLink(input.link, input.kind, appOrigin);
    const expiresAt = new Date(input.expiresAt);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.toISOString() !== input.expiresAt) throw new TypeError("Authentication email expiry is invalid.");
    const verification = input.kind !== "password-reset";
    const facebookVerification = input.kind === "facebook-email-verification";
    const subject = facebookVerification ? "Homle: verify your email for Facebook sign-in" : verification ? "Homle: verify your email" : "Homle: reset your password";
    const action = facebookVerification ? "Verify this email address to finish Facebook sign-in" : verification ? "Verify your email address" : "Reset your Homle password";
    const purpose = facebookVerification ? "Facebook sign-in verification" : verification ? "email verification" : "password reset";
    const text = `${action}:\n\n${link}\n\nThis private ${purpose} link expires at ${expiresAt.toISOString()}. If you did not request this, you can ignore this email.`;
    return Object.freeze({ recipient, subject, text, seed: `${input.kind}\0${recipient.toLowerCase()}\0${link}\0${input.expiresAt}` });
  }
  const recipient = emailAddress(input.to, "Email recipient");
  const idempotencyKey = boundedLine(input.idempotencyKey, 100, "Email idempotency key");
  const subject = boundedLine(input.subject, 200, "Email subject");
  if (!subject.startsWith("Homle:")) throw new TypeError("Notification email subject is invalid.");
  const text = boundedText(input.text);
  return Object.freeze({ recipient, subject, text, seed: `notification\0${idempotencyKey}` });
}
