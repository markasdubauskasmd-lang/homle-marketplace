import { readFile } from "node:fs/promises";
import { createMessageRepository } from "../src/marketplace/message-repository.mjs";
import { containsDirectContactDetails, createMessageService } from "../src/marketplace/message-service.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }
async function rejects(operation, fragment) { try { await operation(); } catch (error) { return String(error.message).includes(fragment); } return false; }

const bookingId = "55555555-5555-4555-8555-555555555555";
const messageId = "88888888-8888-4888-8888-888888888888";
const clientMessageId = "99999999-9999-4999-8999-999999999999";
const cleaner = { userId: "22222222-2222-4222-8222-222222222222", roles: ["cleaner"] };
const landlord = { userId: "11111111-1111-4111-8111-111111111111", roles: ["landlord"] };
const outsider = { userId: "33333333-3333-4333-8333-333333333333", roles: ["administrator"] };
const calls = [];

function message(overrides = {}) {
  return { messageId, clientMessageId, bookingId, senderUserId: cleaner.userId, senderRole: "cleaner", body: "I have parked and will start the kitchen first.", createdAt: "2026-07-15T16:00:00.000Z", privateEmail: "never@example.com", ...overrides };
}
const repository = {
  async sendMessage(actor, id, input) { calls.push({ kind: "send", actor, id, input }); return message({ body: input.body, clientMessageId: input.clientMessageId }); },
  async listMessages(actor, id, input) { calls.push({ kind: "list", actor, id, input }); return { bookingId: id, messages: [message()], hasMore: true, nextCursor: { beforeCreatedAt: "2026-07-15T16:00:00.000Z", beforeMessageId: messageId }, internalConversationId: "secret" }; }
};
const service = createMessageService(repository, { createId: () => messageId });
const sent = await service.sendMessage(cleaner, bookingId, { clientMessageId, body: "  I have parked and will start the kitchen first.  " });
assert(sent.body === "I have parked and will start the kitchen first." && calls[0].input.messageId === messageId && calls[0].input.clientMessageId === clientMessageId, "Message creation lost normalized content or server/client idempotency identifiers.");
assert(!Object.hasOwn(sent, "privateEmail"), "The message projection leaked an unexpected repository field.");
const page = await service.listMessages(landlord, bookingId, { limit: "25", beforeCreatedAt: "2026-07-15T16:00:00.000Z", beforeMessageId: messageId });
assert(page.messages.length === 1 && page.hasMore && page.nextCursor.beforeMessageId === messageId && calls.at(-1).input.limit === 25, "Message pagination lost its stable cursor or bounded page size.");
for (const prohibited of ["Email me at cleaner@example.com", "Call 07123 456789", "Open https://example.com", "Message me on WhatsApp"]) {
  assert(containsDirectContactDetails(prohibited), `Contact-detail detector accepted: ${prohibited}`);
  assert(await rejects(() => service.sendMessage(cleaner, bookingId, { clientMessageId, body: prohibited }), "Keep communication inside Tideway"), "A direct contact route entered booking messages.");
}
assert(!containsDirectContactDetails("The lockbox code is 4821 and I am outside."), "A safe short access code was mistaken for a phone number.");
assert(await rejects(() => service.sendMessage(outsider, bookingId, { clientMessageId, body: "Attempt" }), "Cleaner or Landlord"), "An Administrator sent a participant message.");
assert(await rejects(() => service.listMessages(landlord, bookingId, { beforeCreatedAt: "2026-07-15T16:00:00.000Z" }), "supplied together"), "A partial message cursor was accepted.");
assert(await rejects(() => service.listMessages(landlord, bookingId, { limit: 101 }), "outside"), "An unbounded message page was accepted.");

const databaseCalls = [];
let failure = null;
const database = { async withUserTransaction(actor, operation) { return operation({ async query(queryText, values) { databaseCalls.push({ actor, queryText, values }); if (failure) throw failure; return { rows: [{ result: queryText.includes("get_booking_messages") ? { bookingId, messages: [], hasMore: false, nextCursor: null } : message() }] }; } }); } };
const databaseRepository = createMessageRepository(database);
await databaseRepository.sendMessage(cleaner, bookingId, { messageId, clientMessageId, body: "Arrived" });
await databaseRepository.listMessages(landlord, bookingId, { beforeCreatedAt: null, beforeMessageId: null, limit: 50 });
assert(databaseCalls.some((call) => call.queryText.includes("send_booking_message")) && databaseCalls.some((call) => call.queryText.includes("get_booking_messages")), "Message repository bypassed its restricted database functions.");
assert(databaseCalls.every((call) => !call.queryText.includes(bookingId) && call.queryText.includes("$1::uuid")), "Message repository interpolated a booking identifier into SQL.");
failure = new Error("message-rate-limited");
assert(await rejects(() => databaseRepository.sendMessage(cleaner, bookingId, { messageId, clientMessageId, body: "Retry" }), "Too many messages"), "Database message throttling was not mapped to a safe response.");

const migration = await readFile(new URL("../db/migrations/015_booking_messaging.sql", import.meta.url), "utf8");
const grants = await readFile(new URL("../db/runtime-role-grants.sql", import.meta.url), "utf8");
for (const required of ["client_message_id", "messages_sender_client_id_unique", "booking_message_body_allowed", "send_booking_message", "get_booking_messages", "booking-participant-required", "booking-messaging-closed", "message-idempotency-conflict", "message-rate-limited", "pending-cleaner-acceptance", "pg_advisory_xact_lock", "booking-message-sent", "recipientUserId", "nextCursor", "deleted_at IS NULL"]) assert(migration.includes(required), `Booking messaging migration omitted ${required}.`);
assert(grants.includes("send_booking_message") && grants.includes("get_booking_messages") && grants.includes("messages, notifications, audit_logs") && grants.includes("REVOKE SELECT ON conversations, messages"), "The runtime role can bypass the participant message/audit boundary or read raw conversation tables.");

console.log("Message tests passed: participant-only idempotent sends, stable pagination, direct-contact blocking, durable notification/audit writes, throttling and least-privilege table grants.");
