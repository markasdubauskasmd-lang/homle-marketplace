import { createHash, randomUUID } from "node:crypto";
import { serviceCodes } from "./cleaner-profile.mjs";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const recurrenceRules = Object.freeze({
  "one-time": null,
  weekly: "FREQ=WEEKLY;INTERVAL=1",
  fortnightly: "FREQ=WEEKLY;INTERVAL=2",
  "every-four-weeks": "FREQ=WEEKLY;INTERVAL=4"
});

function boundedText(value, maximum, label, minimum = 0) {
  const normalized = typeof value === "string" ? value.trim().replace(/[\u0000-\u001f\u007f]/g, "") : "";
  if (normalized.length < minimum || normalized.length > maximum) throw new TypeError(`${label} must contain ${minimum} to ${maximum} characters.`);
  return normalized;
}

function uuid(value, label) {
  if (!uuidPattern.test(value || "")) throw new TypeError(`A valid ${label} is required.`);
  return value.toLowerCase();
}

function instant(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) throw new TypeError(`${label} must be an exact UTC timestamp.`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) throw new TypeError(`${label} must be a valid timestamp.`);
  return parsed;
}

function requiredServices(value) {
  if (!Array.isArray(value) || !value.length) throw new TypeError("Choose at least one required cleaning service.");
  const unique = [...new Set(value.map((service) => boundedText(service, 80, "Required service", 1)))].sort();
  if (unique.length !== value.length || unique.some((service) => !serviceCodes.includes(service))) throw new TypeError("Required cleaning services must be supported and unique.");
  return unique;
}

function tasks(value) {
  if (!Array.isArray(value) || !value.length || value.length > 200) throw new TypeError("A cleaning request requires 1 to 200 room tasks.");
  const seen = new Set();
  return value.map((task, index) => {
    const normalized = {
      roomName: boundedText(task?.roomName, 120, `Task ${index + 1} room`, 1),
      description: boundedText(task?.description, 1000, `Task ${index + 1} description`, 1),
      sortOrder: index
    };
    const key = `${normalized.roomName.toLowerCase()}\0${normalized.description.toLowerCase()}`;
    if (seen.has(key)) throw new TypeError("Room tasks must be unique.");
    seen.add(key);
    return normalized;
  });
}

function budget(value) {
  if (value == null || value === "") return null;
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount < 1 || amount > 10_000_000) throw new TypeError("Budget is outside the supported range.");
  return amount;
}

function recurrence(value) {
  const selected = boundedText(value || "one-time", 40, "Booking frequency", 1);
  if (!Object.hasOwn(recurrenceRules, selected)) throw new TypeError("Choose a supported one-time or recurring frequency.");
  return { frequency: selected, recurrenceRule: recurrenceRules[selected] };
}

export function cleaningRequestScopeFingerprint(value) {
  const snapshot = {
    propertyId: value.propertyId,
    requestedStartAt: value.requestedStartAt,
    requestedEndAt: value.requestedEndAt,
    cleaningType: value.cleaningType,
    requiredServices: value.requiredServices,
    specialInstructions: value.specialInstructions,
    budgetPence: value.budgetPence,
    frequency: value.frequency,
    recurrenceRule: value.recurrenceRule,
    tasks: value.tasks.map(({ roomName, description, sortOrder }) => ({ roomName, description, sortOrder }))
  };
  return createHash("sha256").update(JSON.stringify(snapshot), "utf8").digest("hex");
}

export function normalizedCleaningRequest(input = {}, options = {}) {
  const clock = options.clock || (() => new Date());
  const now = clock();
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError("Cleaning-request clock must return a valid Date.");
  const requestedStart = instant(input.requestedStartAt, "Requested start");
  const requestedEnd = instant(input.requestedEndAt, "Requested end");
  const duration = requestedEnd.getTime() - requestedStart.getTime();
  if (requestedStart.getTime() <= now.getTime()) throw new TypeError("Requested cleaning time must be in the future.");
  if (requestedStart.getTime() > now.getTime() + 366 * 24 * 60 * 60 * 1000) throw new TypeError("Requested cleaning time is too far in the future.");
  if (duration < 30 * 60 * 1000 || duration > 16 * 60 * 60 * 1000) throw new TypeError("Estimated cleaning duration must be between 30 minutes and 16 hours.");
  const recurrenceValue = recurrence(input.frequency);
  const record = {
    id: uuid(input.id || randomUUID(), "cleaning request id"),
    propertyId: uuid(input.propertyId, "property id"),
    requestedStartAt: requestedStart.toISOString(),
    requestedEndAt: requestedEnd.toISOString(),
    cleaningType: boundedText(input.cleaningType, 80, "Cleaning type", 1),
    requiredServices: requiredServices(input.requiredServices),
    specialInstructions: boundedText(input.specialInstructions, 5000, "Special instructions") || null,
    budgetPence: budget(input.budgetPence),
    ...recurrenceValue,
    tasks: tasks(input.tasks),
    status: input.submit === false ? "draft" : "searching-for-cleaner",
    submittedAt: input.submit === false ? null : now.toISOString()
  };
  if (!record.requiredServices.includes(record.cleaningType)) throw new TypeError("Cleaning type must be included in the required services.");
  return { ...record, scopeFingerprint: cleaningRequestScopeFingerprint(record) };
}

function recordTasks(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

function projection(record) {
  return {
    requestId: record.id,
    propertyId: record.property_id,
    status: record.status,
    requestedStartAt: new Date(record.requested_start_at).toISOString(),
    requestedEndAt: new Date(record.requested_end_at).toISOString(),
    cleaningType: record.cleaning_type,
    requiredServices: Array.isArray(record.required_services) ? record.required_services : [],
    specialInstructions: record.special_instructions || "",
    budgetPence: record.budget_pence == null ? null : Number(record.budget_pence),
    frequency: Object.entries(recurrenceRules).find(([, rule]) => rule === (record.recurrence_rule || null))?.[0] || "one-time",
    tasks: recordTasks(record.tasks).map((task) => ({ roomName: task.roomName ?? task.room_name, description: task.description, sortOrder: Number(task.sortOrder ?? task.sort_order) || 0 })),
    scopeFingerprint: record.scope_fingerprint,
    submittedAt: record.submitted_at ? new Date(record.submitted_at).toISOString() : null,
    createdAt: record.created_at ? new Date(record.created_at).toISOString() : null
  };
}

export function createCleaningRequestService(repository, options = {}) {
  if (!repository || typeof repository.createOwnRequest !== "function" || typeof repository.listOwnRequests !== "function") throw new TypeError("A complete cleaning-request repository is required.");
  return {
    async createOwnRequest(actor, input) {
      if (!actor?.userId || !actor.roles?.includes("landlord")) throw new TypeError("A Landlord account is required to create a cleaning request.");
      return projection(await repository.createOwnRequest(actor, normalizedCleaningRequest(input, options)));
    },
    async listOwnRequests(actor) {
      if (!actor?.userId || !actor.roles?.includes("landlord")) throw new TypeError("A Landlord account is required to list cleaning requests.");
      return (await repository.listOwnRequests(actor)).map(projection);
    }
  };
}

export { recurrenceRules };
