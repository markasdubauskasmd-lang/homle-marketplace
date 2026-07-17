import { createResendEmailDelivery } from "./resend-email-delivery.mjs";
import { createSmtpEmailDelivery } from "./smtp-email-delivery.mjs";

function present(env, key) {
  return typeof env[key] === "string" && env[key].trim().length > 0;
}

export function emailDeliveryEnvironment(env = process.env) {
  const requested = String(env.EMAIL_DELIVERY_PROVIDER || "").trim().toLowerCase();
  const smtp = present(env, "SMTP_URL");
  const resend = present(env, "RESEND_API_KEY");
  const from = present(env, "EMAIL_FROM");
  const errors = [];
  if (requested && !new Set(["smtp", "resend"]).has(requested)) errors.push("EMAIL_DELIVERY_PROVIDER must be smtp or resend.");
  if (smtp && resend) errors.push("Configure only one email delivery credential: SMTP_URL or RESEND_API_KEY.");
  let provider = requested;
  if (!provider) provider = smtp ? "smtp" : resend ? "resend" : "";
  if (provider === "smtp" && !smtp) errors.push("EMAIL_DELIVERY_PROVIDER=smtp requires SMTP_URL.");
  if (provider === "resend" && !resend) errors.push("EMAIL_DELIVERY_PROVIDER=resend requires RESEND_API_KEY.");
  if (provider && !from) errors.push("Email delivery requires EMAIL_FROM.");
  if (resend && !/^re_[A-Za-z0-9_-]{16,200}$/.test(env.RESEND_API_KEY.trim())) errors.push("RESEND_API_KEY is invalid.");
  return Object.freeze({ provider, configured: Boolean(provider && from && errors.length === 0), errors: Object.freeze(errors) });
}

export async function createTransactionalEmailDelivery(env = process.env, options = {}) {
  const state = emailDeliveryEnvironment(env);
  if (!state.configured) throw new TypeError(`Email delivery configuration is invalid: ${state.errors.join(" ") || "choose SMTP_URL or RESEND_API_KEY and configure EMAIL_FROM."}`);
  if (state.provider === "resend") return createResendEmailDelivery(env, options);
  return createSmtpEmailDelivery(env, options);
}
