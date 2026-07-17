import { isIP } from "node:net";
import { exactEmailOrigin, fromIdentity, preparedEmailMessage, stableEmailDeliveryId } from "./email-delivery-message.mjs";

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
  const appOrigin = exactEmailOrigin(env.APP_ORIGIN);
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
      const message = preparedEmailMessage(input, appOrigin);
      const deliveryId = stableEmailDeliveryId(message.seed);
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
