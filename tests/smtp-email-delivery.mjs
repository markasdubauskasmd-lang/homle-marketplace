import assert from "node:assert/strict";
import { createSmtpEmailDelivery } from "../src/marketplace/smtp-email-delivery.mjs";

const configurations = [];
const messages = [];
let verified = 0;
let closed = 0;
const nodemailer = {
  createTransport(configuration) {
    configurations.push(configuration);
    return {
      async verify() { verified += 1; },
      async sendMail(message) { messages.push(message); return { accepted: [message.to], rejected: [] }; },
      close() { closed += 1; }
    };
  }
};

const env = {
  SMTP_URL: "smtps://mailer%40invalid.example:private%20password@smtp.invalid.example:465",
  EMAIL_FROM: "Tideway <no-reply@invalid.example>",
  APP_ORIGIN: "https://staging.tideway.example"
};
const delivery = await createSmtpEmailDelivery(env, { nodemailer });
assert.equal(configurations.length, 1);
assert.deepEqual(configurations[0].auth, { user: "mailer@invalid.example", pass: "private password" });
assert.equal(configurations[0].host, "smtp.invalid.example");
assert.equal(configurations[0].port, 465);
assert.equal(configurations[0].secure, true);
assert.equal(configurations[0].requireTLS, true);
assert.equal(configurations[0].disableFileAccess, true);
assert.equal(configurations[0].disableUrlAccess, true);
assert.equal(configurations[0].logger, false);
assert.equal(configurations[0].debug, false);
assert.deepEqual(configurations[0].tls, { rejectUnauthorized: true, minVersion: "TLSv1.2", servername: "smtp.invalid.example" });
await delivery.verify();
assert.equal(verified, 1);

const verification = {
  kind: "email-verification",
  recipient: "owner@invalid.example",
  link: "https://staging.tideway.example/verify-email#token=private-token",
  expiresAt: "2026-07-17T12:00:00.000Z"
};
const first = await delivery.send(verification);
const repeated = await delivery.send(verification);
assert.equal(first.messageId, repeated.messageId, "A retry changed the stable SMTP Message-ID.");
assert.equal(messages[0].from, env.EMAIL_FROM);
assert.equal(messages[0].to, verification.recipient);
assert.equal(messages[0].subject, "Tideway: verify your email");
assert(messages[0].text.includes(verification.link) && messages[0].text.includes(verification.expiresAt));
assert(!Object.hasOwn(messages[0], "html") && !Object.hasOwn(messages[0], "attachments"));
assert.match(messages[0].headers["X-Tideway-Delivery-Id"], /^[a-f0-9]{64}$/);

const notification = await delivery.send({
  to: "cleaner@invalid.example",
  idempotencyKey: "00000000-0000-4000-8000-000000000001",
  subject: "Tideway: Cleaner arrived",
  text: "Hello,\n\nThe Cleaner recorded their arrival.\n\nOpen Tideway: https://staging.tideway.example"
});
assert.notEqual(notification.messageId, first.messageId);

await assert.rejects(() => delivery.send({ ...verification, recipient: "victim@invalid.example\r\nBcc: attacker@invalid.example" }), /recipient is invalid/);
await assert.rejects(() => delivery.send({ ...verification, link: "javascript:alert(1)#token=x" }), /link is invalid/);
await assert.rejects(() => delivery.send({ ...verification, link: "https://attacker.invalid/verify-email#token=private-token" }), /link is invalid/);
await assert.rejects(() => delivery.send({ ...verification, link: "https://staging.tideway.example/reset-password#token=private-token" }), /link is invalid/);
await assert.rejects(() => delivery.send({ ...verification, expiresAt: "tomorrow" }), /expiry is invalid/);
await assert.rejects(() => delivery.send({ to: "owner@invalid.example", idempotencyKey: "id", subject: "Untrusted subject", text: "Body" }), /subject is invalid/);

delivery.close();
delivery.close();
assert.equal(closed, 1);
await assert.rejects(() => delivery.send(verification), /closed/);

for (const invalid of [
  { ...env, SMTP_URL: "https://user:pass@smtp.invalid.example" },
  { ...env, SMTP_URL: "smtp://user:pass@127.0.0.1:587" },
  { ...env, SMTP_URL: "smtp://smtp.invalid.example:587" },
  { ...env, SMTP_URL: "smtp://user:pass@smtp.invalid.example:587?tls.rejectUnauthorized=false" },
  { ...env, EMAIL_FROM: "Tideway\r\nBcc: attacker@invalid.example" }
]) await assert.rejects(() => createSmtpEmailDelivery(invalid, { nodemailer }), /SMTP_URL|EMAIL_FROM/);

await assert.rejects(() => createSmtpEmailDelivery({ ...env, APP_ORIGIN: "https://staging.tideway.example/path" }, { nodemailer }), /APP_ORIGIN/);

let privateFailure;
const failingDelivery = await createSmtpEmailDelivery(env, {
  onUnexpectedError(error) { privateFailure = error; },
  nodemailer: {
    createTransport() {
      return {
        async verify() { throw Object.assign(new Error("private password leaked by provider"), { code: "EAUTH", responseCode: 535 }); },
        async sendMail() {}, close() {}
      };
    }
  }
});
await assert.rejects(() => failingDelivery.verify(), (error) => error.message === "Email delivery is temporarily unavailable." && error.code === "eauth" && error.permanent === true && !error.message.includes("private password"));
assert(privateFailure?.message.includes("private password"), "Private monitoring did not receive the original provider failure.");

console.log("SMTP delivery tests passed: exact TLS transport, URL/file isolation, text-only auth/notification mail, stable Message-ID, header injection rejection, bounded provider failure and idempotent close.");
