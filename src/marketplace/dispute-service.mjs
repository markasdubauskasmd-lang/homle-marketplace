import { randomUUID } from "node:crypto";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const categories = new Set(["quality", "damage", "access", "safety", "conduct", "payment", "other"]);
const statuses = new Set(["open", "reviewing", "resolved", "closed"]);

function uuid(value, label) {
  if (!uuidPattern.test(value || "")) throw new TypeError(`A valid ${label} is required.`);
  return value.toLowerCase();
}

function text(value, minimum, maximum, label, optional = false) {
  const normalized = typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : "";
  if (optional && !normalized) return null;
  if (normalized.length < minimum || normalized.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)) throw new TypeError(`${label} is invalid.`);
  return normalized;
}

function role(actor, allowed, action) {
  if (!actor?.userId || !Array.isArray(actor.roles) || !allowed.some((item) => actor.roles.includes(item))) {
    const label = allowed.length > 1 ? "An authorised booking account" : allowed[0] === "administrator" ? "A Tideway Administrator" : "A booking participant";
    throw new TypeError(`${label} is required to ${action}.`);
  }
}

function outcome(value) {
  if (value == null) return null;
  if (["completed", "cancelled"].includes(value)) return value;
  throw new Error("The case outcome is unavailable.");
}

function timestamp(value, label, optional = false) {
  if (optional && value == null) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`${label} is unavailable.`);
  return new Date(value).toISOString();
}

function object(value) {
  if (typeof value === "string") { try { return JSON.parse(value); } catch { return null; } }
  return value;
}

function dispute(value) {
  const record = object(value);
  if (record == null) return null;
  if (typeof record !== "object" || !categories.has(record.category) || !statuses.has(record.status)) throw new Error("The booking case is unavailable.");
  const result = {
    disputeId: uuid(record.disputeId, "case id"),
    bookingId: uuid(record.bookingId, "case booking id"),
    category: record.category,
    description: text(record.description, 20, 5000, "Case description"),
    status: record.status,
    resolutionNote: text(record.resolutionNote, 20, 5000, "Resolution note", true),
    resolutionOutcome: outcome(record.resolutionOutcome),
    createdAt: timestamp(record.createdAt, "Case creation time"),
    resolvedAt: timestamp(record.resolvedAt, "Case resolution time", true)
  };
  if (record.openedByRole != null) {
    if (!["landlord", "cleaner"].includes(record.openedByRole)) throw new Error("The case opener role is unavailable.");
    result.openedByRole = record.openedByRole;
  }
  return Object.freeze(result);
}

function integer(value, minimum, maximum, fallback, label) {
  if (value == null || value === "") return fallback;
  const selected = Number(value);
  if (!Number.isInteger(selected) || selected < minimum || selected > maximum) throw new TypeError(`${label} is outside the supported range.`);
  return selected;
}

export function createDisputeService(repository, options = {}) {
  if (!repository || !["open", "getForBooking", "listForAdministrator", "review"].every((method) => typeof repository[method] === "function")) throw new TypeError("A complete booking-case repository is required.");
  const createId = typeof options.createId === "function" ? options.createId : randomUUID;
  return Object.freeze({
    async open(actor, bookingId, input = {}) {
      role(actor, ["landlord", "cleaner"], "open a private booking case");
      const category = String(input.category || "").trim().toLowerCase();
      if (!categories.has(category)) throw new TypeError("Choose a valid case category.");
      return dispute(await repository.open(actor, {
        bookingId: uuid(bookingId, "booking id"),
        disputeId: uuid(createId(), "generated case id"),
        requestId: uuid(input.requestId, "case retry id"),
        category,
        description: text(input.description, 20, 5000, "Case description")
      }));
    },
    async getForBooking(actor, bookingId) {
      role(actor, ["landlord", "cleaner", "administrator"], "view a private booking case");
      return dispute(await repository.getForBooking(actor, uuid(bookingId, "booking id")));
    },
    async listForAdministrator(actor, input = {}) {
      role(actor, ["administrator"], "review booking cases");
      const status = input.status == null || input.status === "" ? null : String(input.status).trim().toLowerCase();
      if (status !== null && !statuses.has(status)) throw new TypeError("Choose a valid case status.");
      const result = object(await repository.listForAdministrator(actor, { status, limit: integer(input.limit, 1, 100, 50, "Case page size"), offset: integer(input.offset, 0, 10000, 0, "Case page offset") }));
      if (!result || !Array.isArray(result.disputes)) throw new Error("The booking-case queue is unavailable.");
      return Object.freeze({ disputes: Object.freeze(result.disputes.map(dispute)), limit: integer(result.limit, 1, 100, 50, "Case page size"), offset: integer(result.offset, 0, 10000, 0, "Case page offset") });
    },
    async review(actor, disputeId, input = {}) {
      role(actor, ["administrator"], "update a booking case");
      const status = String(input.status || "").trim().toLowerCase();
      if (!["reviewing", "resolved"].includes(status)) throw new TypeError("Choose review started or resolved.");
      const resolutionOutcome = input.resolutionOutcome == null || input.resolutionOutcome === "" ? null : String(input.resolutionOutcome).trim().toLowerCase();
      if (status === "resolved" && !["completed", "cancelled"].includes(resolutionOutcome)) throw new TypeError("Choose the final booking outcome.");
      return dispute(await repository.review(actor, uuid(disputeId, "case id"), {
        status,
        resolutionNote: status === "resolved" ? text(input.resolutionNote, 20, 5000, "Resolution note") : null,
        resolutionOutcome: status === "resolved" ? resolutionOutcome : null
      }));
    }
  });
}
