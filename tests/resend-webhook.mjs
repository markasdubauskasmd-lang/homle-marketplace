import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Webhook } from "svix";
import { createEmailSuppressionRepository } from "../src/marketplace/email-suppression-repository.mjs";
import { createResendWebhookService } from "../src/marketplace/resend-webhook.mjs";

const secret = `whsec_${Buffer.from("homle-resend-webhook-test-secret-32").toString("base64")}`;
const signer = new Webhook(secret);
const now = new Date();
const address = "owner@example.com";

function payload(overrides = {}) {
  return {
    type: "email.bounced",
    created_at: now.toISOString(),
    data: {
      email_id: "56761188-7520-42d8-8898-ff6fc54ce618",
      to: [address],
      bounce: { type: "Permanent" }
    },
    ...overrides
  };
}

function signed(value, { id = "evt_resend_01", timestamp = now } = {}) {
  const body = Buffer.from(JSON.stringify(value));
  return {
    body,
    headers: {
      "svix-id": id,
      "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
      "svix-signature": signer.sign(id, timestamp, body.toString("utf8"))
    }
  };
}

const recorded = [];
const service = createResendWebhookService({
  async record(event) {
    recorded.push(event);
    return Object.freeze({ accepted: true, duplicate: false, ignored: false, matched: true });
  }
}, { RESEND_WEBHOOK_SECRET: secret });

const bounced = signed(payload());
const accepted = await service.handle(bounced.body, bounced.headers);
assert.deepEqual(accepted, { accepted: true, duplicate: false, ignored: false, matched: true });
assert.equal(recorded.length, 1);
assert.equal(recorded[0].providerEventId, "evt_resend_01");
assert.equal(recorded[0].recipientEmail, address);
assert.equal(recorded[0].providerMessageId, "56761188-7520-42d8-8898-ff6fc54ce618");
assert.equal(recorded[0].reason, "bounced");
assert.equal(recorded[0].occurredAt, now.toISOString());
assert(Buffer.isBuffer(recorded[0].payloadSha256) && recorded[0].payloadSha256.length === 32);
assert.equal(recorded[0].payloadSha256.toString("hex"), createHash("sha256").update(bounced.body).digest("hex"));

const complained = signed(payload({ type: "email.complained" }), { id: "evt_resend_02" });
await service.handle(complained.body, complained.headers);
assert.equal(recorded.at(-1).reason, "complained");
const suppressed = signed(payload({ type: "email.suppressed" }), { id: "evt_resend_03" });
await service.handle(suppressed.body, suppressed.headers);
assert.equal(recorded.at(-1).reason, "suppressed");

const delivered = signed(payload({ type: "email.delivered" }), { id: "evt_resend_04" });
const ignored = await service.handle(delivered.body, delivered.headers);
assert.deepEqual(ignored, { accepted: true, duplicate: false, ignored: true, matched: false });
assert.equal(recorded.length, 3, "A non-suppression delivery event reached the private suppression ledger.");

async function rejectsInvalid(operation) {
  await assert.rejects(operation, (error) =>
    error?.statusCode === 400
    && error?.code === "invalid-email-webhook"
    && error?.message === "The email-delivery webhook could not be verified."
    && !error.message.includes(address)
  );
}

await rejectsInvalid(() => service.handle(Buffer.from(`${bounced.body} `), bounced.headers));
await rejectsInvalid(() => service.handle(bounced.body, { ...bounced.headers, "svix-signature": "v1,invalid" }));
await rejectsInvalid(() => service.handle(bounced.body, { "svix-id": bounced.headers["svix-id"] }));
const stale = signed(payload(), { id: "evt_resend_stale", timestamp: new Date(Date.now() - 360_000) });
await rejectsInvalid(() => service.handle(stale.body, stale.headers));
const multipleRecipients = signed(payload({ data: { ...payload().data, to: [address, "other@example.com"] } }), { id: "evt_resend_multi" });
await rejectsInvalid(() => service.handle(multipleRecipients.body, multipleRecipients.headers));
const invalidRecipient = signed(payload({ data: { ...payload().data, to: ["owner@example.com\r\nBcc: attacker@example.com"] } }), { id: "evt_resend_email" });
await rejectsInvalid(() => service.handle(invalidRecipient.body, invalidRecipient.headers));
const missingMessage = signed(payload({ data: { ...payload().data, email_id: "" } }), { id: "evt_resend_message" });
await rejectsInvalid(() => service.handle(missingMessage.body, missingMessage.headers));
const futureEvent = signed(payload({ created_at: new Date(Date.now() + 90_000_000).toISOString() }), { id: "evt_resend_future" });
await rejectsInvalid(() => service.handle(futureEvent.body, futureEvent.headers));
await rejectsInvalid(() => service.handle("not-a-buffer", bounced.headers));
assert.throws(() => createResendWebhookService({ record() {} }, { RESEND_WEBHOOK_SECRET: "whsec_short" }), /RESEND_WEBHOOK_SECRET is invalid/);
assert.throws(() => createResendWebhookService({}, { RESEND_WEBHOOK_SECRET: secret }), /complete email-suppression repository/);

let queryText;
let queryValues;
const repository = createEmailSuppressionRepository({
  withAuthenticationTransaction(operation) {
    return operation({
      async query(text, values) {
        queryText = text;
        queryValues = values;
        return { rows: [{ result: { accepted: true, duplicate: true, ignored: false, matched: false } }] };
      }
    });
  }
});
const repositoryResult = await repository.record(recorded[0]);
assert.deepEqual(repositoryResult, { accepted: true, duplicate: true, ignored: false, matched: false });
assert.match(queryText, /record_resend_email_suppression\(\s*\$1::text,\$2::citext,\$3::text,\$4::text,\$5::timestamptz,\$6::bytea/);
assert(!queryText.includes(address), "The recipient address was interpolated into SQL.");
assert.deepEqual(queryValues.slice(0, 5), [
  recorded[0].providerEventId,
  address,
  recorded[0].providerMessageId,
  "bounced",
  recorded[0].occurredAt
]);
assert.equal(queryValues[5], recorded[0].payloadSha256);

const invalidRepository = createEmailSuppressionRepository({
  withAuthenticationTransaction(operation) {
    return operation({ async query() { return { rows: [{ result: "invalid" }] }; } });
  }
});
await assert.rejects(() => invalidRepository.record(recorded[0]), /invalid result/);
assert.throws(() => createEmailSuppressionRepository({}), /restricted authentication database boundary/);

console.log("Resend webhook tests passed: Svix signature and timestamp verification, exact permanent suppression mapping, privacy-safe idempotent persistence, ignored-event handling and tamper rejection.");
