import assert from "node:assert/strict";
import { createTransactionalEmailDelivery, emailDeliveryEnvironment } from "../src/marketplace/email-delivery.mjs";
import { createResendEmailDelivery, resendEndpoint } from "../src/marketplace/resend-email-delivery.mjs";

const env = Object.freeze({
  EMAIL_DELIVERY_PROVIDER: "resend",
  RESEND_API_KEY: `re_${"a".repeat(32)}`,
  EMAIL_FROM: "Homle <onboarding@resend.dev>",
  APP_ORIGIN: "https://homle-marketplace-preview.onrender.com"
});

assert.deepEqual(emailDeliveryEnvironment(env), { provider: "resend", configured: true, errors: [] });
assert.equal(emailDeliveryEnvironment({ SMTP_URL: "smtps://mail.invalid", EMAIL_FROM: "Homle <hello@invalid.example>" }).provider, "smtp");
assert.equal(emailDeliveryEnvironment({ RESEND_API_KEY: env.RESEND_API_KEY, EMAIL_FROM: env.EMAIL_FROM }).provider, "resend");
for (const invalid of [
  { ...env, EMAIL_DELIVERY_PROVIDER: "unknown" },
  { ...env, SMTP_URL: "smtps://mail.invalid" },
  { ...env, RESEND_API_KEY: "re_short" },
  { ...env, EMAIL_FROM: "" },
  { EMAIL_DELIVERY_PROVIDER: "resend", EMAIL_FROM: env.EMAIL_FROM }
]) assert.equal(emailDeliveryEnvironment(invalid).configured, false);

const requests = [];
const fetch = async (url, options) => {
  requests.push({ url, options });
  return new Response(JSON.stringify({ id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" }), { status: 200, headers: { "Content-Type": "application/json" } });
};
const delivery = await createTransactionalEmailDelivery(env, { fetch });
assert.equal(delivery.provider, "resend");
assert.equal(await delivery.verify(), true);
const verification = Object.freeze({
  kind: "email-verification",
  recipient: "owner@example.com",
  link: `${env.APP_ORIGIN}/verify-email#token=private-token`,
  expiresAt: "2026-07-18T12:00:00.000Z"
});
const first = await delivery.send(verification);
const repeated = await delivery.send(verification);
assert.equal(first.messageId, "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794");
assert.equal(requests.length, 2);
assert.equal(requests[0].url, resendEndpoint);
assert.equal(requests[0].options.method, "POST");
assert.equal(requests[0].options.redirect, "error");
assert.match(requests[0].options.headers.Authorization, /^Bearer re_[a-z]+$/);
assert.equal(requests[0].options.headers.Authorization, `Bearer ${env.RESEND_API_KEY}`);
assert.match(requests[0].options.headers["Idempotency-Key"], /^[a-f0-9]{64}$/);
assert.equal(requests[0].options.headers["Idempotency-Key"], requests[1].options.headers["Idempotency-Key"], "A retry changed the Resend provider idempotency key.");
assert.equal(requests[0].options.headers["User-Agent"], "Homle-Marketplace/1.0");
const body = JSON.parse(requests[0].options.body);
assert.deepEqual(body.to, [verification.recipient]);
assert.equal(body.from, env.EMAIL_FROM);
assert.equal(body.subject, "Homle: verify your email");
assert(body.text.includes(verification.link) && body.text.includes(verification.expiresAt));
assert.equal(body.headers["X-Homle-Delivery-Id"], requests[0].options.headers["Idempotency-Key"]);
assert(!Object.hasOwn(body, "html") && !Object.hasOwn(body, "attachments"));

await assert.rejects(() => delivery.send({ ...verification, recipient: "victim@example.com\r\nBcc: attacker@example.com" }), /recipient is invalid/);
delivery.close();
delivery.close();
await assert.rejects(() => delivery.send(verification), /closed/);

let monitored;
const rejected = await createResendEmailDelivery(env, {
  onUnexpectedError(error) { monitored = error; },
  async fetch() {
    return new Response(JSON.stringify({ name: "validation_error", message: "private provider detail owner@example.com" }), { status: 422 });
  }
});
await assert.rejects(() => rejected.send(verification), (error) => error.message === "Email delivery is temporarily unavailable." && error.code === "validation-error" && error.permanent === true && !error.message.includes("owner@example.com"));
assert.equal(monitored?.status, 422);
assert(!monitored?.message.includes("owner@example.com"), "Private provider response details entered monitoring.");

const retryable = await createResendEmailDelivery(env, { async fetch() { return new Response(JSON.stringify({ name: "rate_limit_exceeded" }), { status: 429 }); } });
await assert.rejects(() => retryable.send(verification), (error) => error.code === "rate-limit-exceeded" && error.permanent === false);

for (const invalid of [
  { ...env, RESEND_API_KEY: "re_short" },
  { ...env, APP_ORIGIN: "http://public.example" },
  { ...env, EMAIL_FROM: "Homle\r\nBcc: attacker@example.com" }
]) await assert.rejects(() => createResendEmailDelivery(invalid, { fetch }), /RESEND_API_KEY|APP_ORIGIN|EMAIL_FROM/);

console.log("Resend HTTPS email tests passed: explicit provider selection, exact endpoint, stable provider idempotency, bounded requests, text-only messages, generic failures and deterministic close.");
