import { exactEmailOrigin, fromIdentity, preparedEmailMessage, stableEmailDeliveryId } from "./email-delivery-message.mjs";

const resendEndpoint = "https://api.resend.com/emails";
const providerIdPattern = /^[A-Za-z0-9_-]{1,128}$/;

function apiKey(value) {
  const selected = typeof value === "string" ? value.trim() : "";
  if (!/^re_[A-Za-z0-9_-]{16,200}$/.test(selected)) throw new TypeError("RESEND_API_KEY is invalid.");
  return selected;
}

function providerCode(value, fallback = "resend-error") {
  const selected = typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 50) : "";
  return selected || fallback;
}

function publicFailure(error, onUnexpectedError) {
  try { onUnexpectedError(error); } catch {}
  const status = Number(error?.status);
  const permanent = Number.isInteger(status) && status >= 400 && status < 500 && ![408, 409, 429].includes(status);
  return Object.assign(new Error("Email delivery is temporarily unavailable."), {
    code: providerCode(error?.code),
    permanent
  });
}

async function responseRecord(response) {
  let text = "";
  try { text = await response.text(); } catch {}
  if (text.length > 32_000) throw Object.assign(new Error("Resend returned an oversized response."), { code: "resend-response-oversized", status: response.status });
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { throw Object.assign(new Error("Resend returned malformed JSON."), { code: "resend-response-invalid", status: response.status }); }
  if (!response.ok) throw Object.assign(new Error("Resend rejected the email request."), { code: providerCode(body?.name || body?.code, "resend-request-rejected"), status: response.status });
  if (!providerIdPattern.test(String(body?.id || ""))) throw Object.assign(new Error("Resend did not return a valid delivery identifier."), { code: "resend-delivery-id-invalid", status: response.status });
  return body.id;
}

export async function createResendEmailDelivery(env = process.env, options = {}) {
  const key = apiKey(env.RESEND_API_KEY);
  const sender = fromIdentity(env.EMAIL_FROM);
  const appOrigin = exactEmailOrigin(env.APP_ORIGIN);
  const request = options.fetch || globalThis.fetch;
  if (typeof request !== "function") throw new TypeError("The runtime does not provide secure HTTPS requests for Resend delivery.");
  const onUnexpectedError = typeof options.onUnexpectedError === "function" ? options.onUnexpectedError : () => {};
  let closed = false;

  return Object.freeze({
    provider: "resend",
    async verify() {
      if (closed) throw new TypeError("Resend delivery is closed.");
      return true;
    },
    async send(input) {
      if (closed) throw new TypeError("Resend delivery is closed.");
      const message = preparedEmailMessage(input, appOrigin);
      const deliveryId = stableEmailDeliveryId(message.seed);
      let response;
      try {
        response = await request(resendEndpoint, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            "Idempotency-Key": deliveryId,
            "User-Agent": "Homle-Marketplace/1.0"
          },
          body: JSON.stringify({
            from: sender.value,
            to: [message.recipient],
            subject: message.subject,
            text: message.text,
            headers: { "X-Homle-Delivery-Id": deliveryId }
          })
        });
        if (!response || typeof response.ok !== "boolean" || typeof response.text !== "function") throw Object.assign(new Error("Resend returned an invalid response."), { code: "resend-response-invalid" });
        const messageId = await responseRecord(response);
        return Object.freeze({ accepted: true, messageId });
      } catch (error) {
        throw publicFailure(error, onUnexpectedError);
      }
    },
    close() { closed = true; }
  });
}

export { resendEndpoint };
