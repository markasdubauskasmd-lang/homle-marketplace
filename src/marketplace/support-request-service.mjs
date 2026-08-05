import { randomUUID } from "node:crypto";
import { uuid } from "./validation.mjs";

const categories = new Set(["account-access", "property", "room-scan", "booking-preparation", "booking-change", "other"]);
const statuses = new Set(["open", "reviewing", "resolved"]);
const controlCharacters = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const sensitiveTerms = /\b(?:password|passcode|door[\s-]?code|alarm[\s-]?code|key[\s-]?safe|api[\s-]?key|secret[\s-]?key|card[\s-]?number|cvv|cvc)\b/i;
// Reject a card-like run, not an unrelated collection of dates, booking
// references and room numbers. Spaces and hyphens are the separators people
// commonly use when copying a payment-card number.
const paymentCardLikeDigits = /(?:\d[ -]?){13,19}/;

function role(actor, expected, action) {
  if (!actor?.userId || !Array.isArray(actor.roles) || !actor.roles.includes(expected)) {
    throw Object.assign(new Error(`${expected === "administrator" ? "A Homle Administrator" : "A Landlord"} account is required to ${action}.`), {
      statusCode: 403,
      code: `${expected}-required`
    });
  }
}

function text(value, minimum, maximum, label, optional = false) {
  const normalized = typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : "";
  if (optional && !normalized) return null;
  if (normalized.length < minimum || normalized.length > maximum || controlCharacters.test(normalized)) throw new TypeError(`${label} is invalid.`);
  return normalized;
}

function noSensitiveDetails(...values) {
  const combined = values.filter(Boolean).join("\n");
  if (sensitiveTerms.test(combined) || paymentCardLikeDigits.test(combined)) {
    throw new TypeError("Remove passwords, access codes, payment-card data and secret keys before sending this request.");
  }
}

function integer(value, minimum, maximum, fallback, label) {
  if (value == null || value === "") return fallback;
  const selected = Number(value);
  if (!Number.isInteger(selected) || selected < minimum || selected > maximum) throw new TypeError(`${label} is outside the supported range.`);
  return selected;
}

function timestamp(value, label, optional = false) {
  if (optional && value == null) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`${label} is unavailable.`);
  return new Date(value).toISOString();
}

function futureTimestamp(value, now, label) {
  const selected = timestamp(value, label);
  const time = Date.parse(selected);
  if (time <= now.getTime() || time > now.getTime() + 365 * 24 * 60 * 60 * 1000) throw new TypeError(`${label} must be within the next year.`);
  return selected;
}

function object(value) {
  if (typeof value === "string") { try { return JSON.parse(value); } catch { return null; } }
  return value;
}

function supportRequest(value) {
  const record = object(value);
  if (!record || typeof record !== "object" || !categories.has(record.category) || !statuses.has(record.status)) throw new Error("The support request is unavailable.");
  const result = {
    supportRequestId: uuid(record.supportRequestId, "support request id"),
    category: record.category,
    subject: text(record.subject, 10, 120, "Support subject"),
    description: text(record.description, 20, 2000, "Support description"),
    status: record.status,
    resolutionSummary: text(record.resolutionSummary, 20, 2000, "Support response", true),
    createdAt: timestamp(record.createdAt, "Support request creation time"),
    updatedAt: timestamp(record.updatedAt, "Support request update time"),
    resolvedAt: timestamp(record.resolvedAt, "Support request resolution time", true),
    bookingId: record.bookingId == null ? null : uuid(record.bookingId, "support booking id"),
    bookingChangeKind: record.bookingChangeKind == null ? null : String(record.bookingChangeKind),
    proposedStartAt: timestamp(record.proposedStartAt, "proposed booking start", true)
  };
  const bookingChange = result.category === "booking-change";
  if (bookingChange !== (result.bookingId !== null && ["reschedule", "cancel"].includes(result.bookingChangeKind))) throw new Error("The booking-change support request is inconsistent.");
  if ((result.bookingChangeKind === "reschedule") !== (result.proposedStartAt !== null)) throw new Error("The proposed booking time is inconsistent.");
  if ((result.status === "resolved") !== (result.resolutionSummary !== null && result.resolvedAt !== null)) throw new Error("The support request resolution is inconsistent.");
  return Object.freeze(result);
}

function page(value) {
  const result = object(value);
  if (!result || !Array.isArray(result.supportRequests)) throw new Error("Support requests are unavailable.");
  return Object.freeze({
    supportRequests: Object.freeze(result.supportRequests.map(supportRequest)),
    limit: integer(result.limit, 1, 100, 25, "Support page size"),
    offset: integer(result.offset, 0, 10000, 0, "Support page offset")
  });
}

export function createSupportRequestService(repository, options = {}) {
  if (!repository || !["create", "createBookingChange", "listOwn", "listForAdministrator", "review"].every((method) => typeof repository[method] === "function")) throw new TypeError("A complete support-request repository is required.");
  const createId = typeof options.createId === "function" ? options.createId : randomUUID;
  const clock = typeof options.clock === "function" ? options.clock : () => new Date();
  return Object.freeze({
    async create(actor, input = {}) {
      role(actor, "landlord", "ask for support");
      const category = String(input.category || "").trim().toLowerCase();
      if (!categories.has(category)) throw new TypeError("Choose what you need help with.");
      if (input.confirmNoSensitiveData !== true) throw new TypeError("Confirm that the request contains no access codes, passwords, card data or secret keys.");
      const description = text(input.description, 20, 2000, "Support description");
      if (category === "booking-change") {
        const bookingChangeKind = String(input.bookingChangeKind || "").trim().toLowerCase();
        if (!["reschedule", "cancel"].includes(bookingChangeKind)) throw new TypeError("Choose whether to reschedule or cancel the booking.");
        const proposedStartAt = bookingChangeKind === "reschedule" ? futureTimestamp(input.proposedStartAt, clock(), "The proposed start time") : null;
        noSensitiveDetails(description);
        return supportRequest(await repository.createBookingChange(actor, {
          supportRequestId: uuid(createId(), "generated support request id"),
          clientRequestId: uuid(input.clientRequestId, "support retry id"),
          bookingId: uuid(input.bookingId, "booking id"),
          bookingChangeKind,
          proposedStartAt,
          description
        }));
      }
      const subject = text(input.subject, 10, 120, "Support subject");
      noSensitiveDetails(subject, description);
      return supportRequest(await repository.create(actor, {
        supportRequestId: uuid(createId(), "generated support request id"),
        clientRequestId: uuid(input.clientRequestId, "support retry id"),
        category,
        subject,
        description
      }));
    },
    async listOwn(actor, input = {}) {
      role(actor, "landlord", "view support requests");
      return page(await repository.listOwn(actor, {
        limit: integer(input.limit, 1, 50, 25, "Support page size"),
        offset: integer(input.offset, 0, 10000, 0, "Support page offset")
      }));
    },
    async listForAdministrator(actor, input = {}) {
      role(actor, "administrator", "review support requests");
      const status = input.status == null || input.status === "" ? null : String(input.status).trim().toLowerCase();
      const category = input.category == null || input.category === "" ? null : String(input.category).trim().toLowerCase();
      if (status !== null && !statuses.has(status)) throw new TypeError("Choose a valid support status.");
      if (category !== null && !categories.has(category)) throw new TypeError("Choose a valid support category.");
      return page(await repository.listForAdministrator(actor, {
        status,
        category,
        limit: integer(input.limit, 1, 100, 50, "Support page size"),
        offset: integer(input.offset, 0, 10000, 0, "Support page offset")
      }));
    },
    async review(actor, supportRequestId, input = {}) {
      role(actor, "administrator", "update a support request");
      const status = String(input.status || "").trim().toLowerCase();
      if (!["reviewing", "resolved"].includes(status)) throw new TypeError("Choose review started or resolved.");
      const resolutionSummary = status === "resolved" ? text(input.resolutionSummary, 20, 2000, "Support response") : null;
      if (status === "resolved") {
        if (input.privacyConfirmed !== true) throw new TypeError("Confirm that the response contains no access, payment or secret data.");
        if (input.noExternalActionConfirmed !== true) throw new TypeError("Confirm that this response does not perform payment, account or external action.");
        noSensitiveDetails(resolutionSummary);
      }
      return supportRequest(await repository.review(actor, uuid(supportRequestId, "support request id"), { status, resolutionSummary }));
    }
  });
}
