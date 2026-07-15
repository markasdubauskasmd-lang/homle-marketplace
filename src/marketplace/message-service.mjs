import { randomUUID } from "node:crypto";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailPattern = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i;
const urlPattern = /(?:https?:\/\/|www\.)/i;
const ukPhonePattern = /(?:^|[^\d])(?:\+?44|0)(?:[\s().-]*\d){9,10}(?:[^\d]|$)/;
const outsideContactPattern = /\b(?:whats?app|telegram|signal|instagram|facebook|snapchat)\b/i;

function uuid(value, label) {
  if (!uuidPattern.test(value || "")) throw new TypeError(`A valid ${label} is required.`);
  return value.toLowerCase();
}

function messageBody(value) {
  const normalized = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (normalized.length < 1 || normalized.length > 2000) throw new TypeError("Message must contain 1 to 2000 characters.");
  if (/[\u0000-\u001f\u007f]/.test(normalized)) throw new TypeError("Message contains unsupported control characters.");
  if (emailPattern.test(normalized) || urlPattern.test(normalized) || ukPhonePattern.test(normalized) || outsideContactPattern.test(normalized)) throw new TypeError("Keep communication inside Tideway and remove phone numbers, email addresses, links or outside-messaging handles.");
  return normalized;
}

function timestamp(value, label) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw new TypeError(`A valid ${label} is required.`);
  return new Date(value).toISOString();
}

function integer(value, minimum, maximum, fallback, label) {
  if (value == null || value === "") return fallback;
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < minimum || normalized > maximum) throw new TypeError(`${label} is outside the supported range.`);
  return normalized;
}

function actorAllowed(actor, action) {
  if (!actor?.userId || !Array.isArray(actor.roles) || !actor.roles.some((role) => role === "cleaner" || role === "landlord")) throw new TypeError(`A Cleaner or Landlord account is required to ${action}.`);
}

function authenticated(actor) {
  if (!actor?.userId) throw new TypeError("An authenticated booking participant is required to view messages.");
}

function oneMessage(value) {
  const record = typeof value === "string" ? JSON.parse(value) : value;
  if (!record || typeof record !== "object") throw new Error("The booking message is unavailable.");
  return Object.freeze({
    messageId: record.messageId,
    clientMessageId: record.clientMessageId,
    bookingId: record.bookingId,
    senderUserId: record.senderUserId,
    senderRole: record.senderRole,
    body: record.body,
    createdAt: record.createdAt
  });
}

function page(value) {
  const record = typeof value === "string" ? JSON.parse(value) : value;
  if (!record || typeof record !== "object" || !Array.isArray(record.messages)) throw new Error("Booking messages are unavailable.");
  return Object.freeze({
    bookingId: record.bookingId,
    messages: Object.freeze(record.messages.map(oneMessage)),
    hasMore: record.hasMore === true,
    nextCursor: record.nextCursor ? Object.freeze({ beforeCreatedAt: record.nextCursor.beforeCreatedAt, beforeMessageId: record.nextCursor.beforeMessageId }) : null
  });
}

export function createMessageService(repository, options = {}) {
  if (!repository || typeof repository.sendMessage !== "function" || typeof repository.listMessages !== "function") throw new TypeError("A complete booking-message repository is required.");
  const createId = typeof options.createId === "function" ? options.createId : randomUUID;
  return Object.freeze({
    async sendMessage(actor, bookingId, input = {}) {
      actorAllowed(actor, "send a booking message");
      return oneMessage(await repository.sendMessage(actor, uuid(bookingId, "booking id"), {
        messageId: uuid(createId(), "generated message id"),
        clientMessageId: uuid(input.clientMessageId, "client message id"),
        body: messageBody(input.body)
      }));
    },
    async listMessages(actor, bookingId, input = {}) {
      authenticated(actor);
      const beforeCreatedAt = timestamp(input.beforeCreatedAt, "message cursor time");
      const beforeMessageId = input.beforeMessageId == null || input.beforeMessageId === "" ? null : uuid(input.beforeMessageId, "message cursor id");
      if ((beforeCreatedAt === null) !== (beforeMessageId === null)) throw new TypeError("Message cursor time and id must be supplied together.");
      return page(await repository.listMessages(actor, uuid(bookingId, "booking id"), {
        beforeCreatedAt,
        beforeMessageId,
        limit: integer(input.limit, 1, 100, 50, "Message page size")
      }));
    }
  });
}

export function containsDirectContactDetails(value) {
  try { messageBody(value); return false; } catch (error) { return error.message.includes("Keep communication inside Tideway"); }
}
