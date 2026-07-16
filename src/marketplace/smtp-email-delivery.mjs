import { createHash } from "node:crypto";
import { isIP } from "node:net";

const emailPattern = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

function emailAddress(value, label) {
  const selected = typeof value === "string" ? value.trim() : "";
  if (!selected || selected.length > 254 || !emailPattern.test(selected) || /[\u0000-\u0020\u007f]/.test(selected)) throw new TypeError(`${label} is invalid.`);
  return selected;
}

function fromIdentity(value) {
  const selected = typeof value === "string" ? value.trim() : "";
  if (!selected || selected.length > 320 || /[\u0000-\u001f\u007f]/.test(selected)) throw new TypeError("EMAIL_FROM is invalid.");
  const named = selected.match(/^([^<>]{1,100})\s+<([^<>]+)>$/);
  const address = emailAddress(named ? named[2] : selected, "EMAIL_FROM address");
  return { value: selected, domain: address.slice(address.lastIndexOf("@") + 1).toLowerCase() };
}

function smtpConfiguration(value) {
  let url;
  try { url = new URL(value); } catch { throw new TypeError("SMTP_URL must be a valid SMTP connection URL."); }
  if (!new Set(["smtp:", "smtps:"]).has(url.protocol) || !url.hostname || isIP(url.hostname) || (url.pathname && url.pathname !== "/") || url.search || url.hash) throw new TypeError("SMTP_URL must use a credentialed SMTP hostname without path, query or fragment options.");
  let user;
  let pass;
  try {
    user = decodeURIComponent(url.username);
    pass = decodeURIComponent(url.password);
  } catch { throw new TypeError("SMTP_URL credentials are invalid."); }
  if (!user || !pass || /[\u0000-\u001f\u007f]/.test(user) || /[\u0000-\u001f\u007f]/.test(pass)) throw new TypeError("SMTP_URL must contain bounded authentication credentials.");
  if (user.length > 320 || pass.length > 1024) throw new TypeError("SMTP_URL must contain bounded authentication credentials.");
  const secure = url.protocol === "smtps:";
  const port = url.port ? Number(url.port) : secure ? 465 : 587;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new TypeError("SMTP_URL port is invalid.");
  return Object.freeze({ host: url.hostname, port, secure, auth: Object.freeze({ user, pass }) });
}

function exactOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new TypeError("APP_ORIGIN is invalid for SMTP delivery."); }
  const secure = url.protocol === "https:";
  const local = url.protocol === "http:" && url.hostname === "127.0.0.1";
  if ((!secure && !local) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new TypeError("APP_ORIGIN is invalid for SMTP delivery.");
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

function stableHash(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function preparedMessage(input, appOrigin) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Email delivery payload is invalid.");
  if (input.kind === "email-verification" || input.kind === "facebook-email-verification" || input.kind === "password-reset") {
    const recipient = emailAddress(input.recipient, "Email recipient");
    const link = trustedLink(input.link, input.kind, appOrigin);
    const expiresAt = new Date(input.expiresAt);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.toISOString() !== input.expiresAt) throw new TypeError("Authentication email expiry is invalid.");
    const verification = input.kind !== "password-reset";
    const facebookVerification = input.kind === "facebook-email-verification";
    const subject = facebookVerification ? "Tideway: verify your email for Facebook sign-in" : verification ? "Tideway: verify your email" : "Tideway: reset your password";
    const action = facebookVerification ? "Verify this email address to finish Facebook sign-in" : verification ? "Verify your email address" : "Reset your Tideway password";
    const purpose = facebookVerification ? "Facebook sign-in verification" : verification ? "email verification" : "password reset";
    const text = `${action}:\n\n${link}\n\nThis private ${purpose} link expires at ${expiresAt.toISOString()}. If you did not request this, you can ignore this email.`;
    return { recipient, subject, text, seed: `${input.kind}\0${recipient.toLowerCase()}\0${link}\0${input.expiresAt}` };
  }
  const recipient = emailAddress(input.to, "Email recipient");
  const idempotencyKey = boundedLine(input.idempotencyKey, 100, "Email idempotency key");
  const subject = boundedLine(input.subject, 200, "Email subject");
  if (!subject.startsWith("Tideway:")) throw new TypeError("Notification email subject is invalid.");
  const text = boundedText(input.text);
  return { recipient, subject, text, seed: `notification\0${idempotencyKey}` };
}

function publicFailure(error, onUnexpectedError) {
  try { onUnexpectedError(error); } catch {}
  const responseCode = Number(error?.responseCode);
  const supplied = typeof error?.code === "string" ? error.code.toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 60) : "smtp-error";
  return Object.assign(new Error("Email delivery is temporarily unavailable."), {
    code: supplied || "smtp-error",
    permanent: Number.isInteger(responseCode) && responseCode >= 500 && responseCode <= 599
  });
}

export async function createSmtpEmailDelivery(env = process.env, options = {}) {
  const sender = fromIdentity(env.EMAIL_FROM);
  const smtp = smtpConfiguration(env.SMTP_URL);
  const appOrigin = exactOrigin(env.APP_ORIGIN);
  const onUnexpectedError = typeof options.onUnexpectedError === "function" ? options.onUnexpectedError : () => {};
  let nodemailer = options.nodemailer;
  if (!nodemailer) {
    try { nodemailer = await import("nodemailer"); } catch (error) { throw publicFailure(error, onUnexpectedError); }
  }
  const createTransport = nodemailer?.createTransport || nodemailer?.default?.createTransport;
  if (typeof createTransport !== "function") throw new TypeError("The reviewed Nodemailer package does not expose createTransport.");
  const transport = createTransport({
    ...smtp,
    requireTLS: true,
    pool: true,
    maxConnections: 2,
    maxMessages: 100,
    rateDelta: 1000,
    rateLimit: 5,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
    debug: false,
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2", servername: smtp.host }
  });
  if (!transport || typeof transport.sendMail !== "function" || typeof transport.verify !== "function") throw new TypeError("Nodemailer returned an incomplete SMTP transport.");
  let closed = false;

  return Object.freeze({
    async verify() {
      if (closed) throw new TypeError("SMTP delivery is closed.");
      try { await transport.verify(); } catch (error) { throw publicFailure(error, onUnexpectedError); }
      return true;
    },
    async send(input) {
      if (closed) throw new TypeError("SMTP delivery is closed.");
      const message = preparedMessage(input, appOrigin);
      const deliveryId = stableHash(message.seed);
      let result;
      try {
        result = await transport.sendMail({
          from: sender.value,
          to: message.recipient,
          subject: message.subject,
          text: message.text,
          messageId: `<tideway-${deliveryId.slice(0, 40)}@${sender.domain}>`,
          headers: { "X-Tideway-Delivery-Id": deliveryId }
        });
      } catch (error) { throw publicFailure(error, onUnexpectedError); }
      const accepted = Array.isArray(result?.accepted) && result.accepted.some((value) => String(value).toLowerCase() === message.recipient.toLowerCase());
      if (!accepted) throw Object.assign(new Error("Email recipient was rejected."), { code: "smtp-recipient-rejected", permanent: true });
      return Object.freeze({ accepted: true, messageId: `<tideway-${deliveryId.slice(0, 40)}@${sender.domain}>` });
    },
    close() {
      if (closed) return;
      closed = true;
      transport.close?.();
    }
  });
}
