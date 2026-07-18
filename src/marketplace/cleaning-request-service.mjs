import { createHash, randomUUID } from "node:crypto";
import { serviceCodes } from "./cleaner-profile.mjs";
import { cleanerTaskGuidance, cleanerTaskQuality } from "../../public/task-quality.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const recurrenceRules = Object.freeze({
  "one-time": null,
  weekly: "FREQ=WEEKLY;INTERVAL=1",
  fortnightly: "FREQ=WEEKLY;INTERVAL=2",
  "every-four-weeks": "FREQ=WEEKLY;INTERVAL=4"
});
const withdrawalReasons = Object.freeze(["no-longer-needed", "date-changed", "created-by-mistake", "other"]);

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
    if (!cleanerTaskQuality(normalized.description).clear) throw new TypeError(`Task ${index + 1} needs a specific Cleaner action. ${cleanerTaskGuidance}`);
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
    scanFingerprint: record.scan_fingerprint || null,
    scopeConfirmedAt: record.customer_scope_confirmed_at ? new Date(record.customer_scope_confirmed_at).toISOString() : null,
    cleanerPreviewAuthorized: record.cleaner_preview_authorized === true,
    submittedAt: record.submitted_at ? new Date(record.submitted_at).toISOString() : null,
    createdAt: record.created_at ? new Date(record.created_at).toISOString() : null,
    automaticDispatch: {
      enabled: Boolean(record.automatic_dispatch_authorized_at) && !record.automatic_dispatch_revoked_at,
      attemptLimit: record.automatic_dispatch_attempt_limit == null ? null : Number(record.automatic_dispatch_attempt_limit),
      attemptCount: Number(record.automatic_dispatch_attempt_count) || 0,
      authorizedAt: record.automatic_dispatch_authorized_at ? new Date(record.automatic_dispatch_authorized_at).toISOString() : null,
      revokedAt: record.automatic_dispatch_revoked_at ? new Date(record.automatic_dispatch_revoked_at).toISOString() : null,
      nextAttemptAt: record.automatic_dispatch_next_attempt_at ? new Date(record.automatic_dispatch_next_attempt_at).toISOString() : null,
      lastResult: record.automatic_dispatch_last_result || null
    }
  };
}

function dispatchProjection(record) {
  if (!record || !uuidPattern.test(record.cleaningRequestId || "")) throw new Error("Automatic-matching status is unavailable.");
  const attemptLimit = record.attemptLimit == null ? null : Number(record.attemptLimit);
  const attemptCount = Number(record.attemptCount) || 0;
  const maximumCustomerPricePence = record.maximumCustomerPricePence == null ? null : Number(record.maximumCustomerPricePence);
  if ((attemptLimit != null && (!Number.isInteger(attemptLimit) || attemptLimit < 1 || attemptLimit > 5)) || !Number.isInteger(attemptCount) || attemptCount < 0 || (record.enabled === true && (!Number.isInteger(maximumCustomerPricePence) || maximumCustomerPricePence < 1 || maximumCustomerPricePence > 10_000_000))) throw new Error("Automatic-matching status is unavailable.");
  return Object.freeze({
    cleaningRequestId: record.cleaningRequestId.toLowerCase(),
    enabled: record.enabled === true,
    attemptLimit,
    attemptCount,
    maximumCustomerPricePence,
    authorizedAt: record.authorizedAt ? new Date(record.authorizedAt).toISOString() : null,
    revokedAt: record.revokedAt ? new Date(record.revokedAt).toISOString() : null,
    nextAttemptAt: record.nextAttemptAt ? new Date(record.nextAttemptAt).toISOString() : null,
    lastResult: record.lastResult || null
  });
}

function withdrawalProjection(record) {
  if (!record || !uuidPattern.test(record.cleaningRequestId || "") || record.status !== "cancelled" || !["draft", "searching-for-cleaner"].includes(record.previousStatus) || !withdrawalReasons.includes(record.reasonCode)) throw new Error("Cleaning-request withdrawal could not be verified.");
  const withdrawnAt = new Date(record.withdrawnAt);
  if (Number.isNaN(withdrawnAt.getTime())) throw new Error("Cleaning-request withdrawal could not be verified.");
  return Object.freeze({
    cleaningRequestId: record.cleaningRequestId.toLowerCase(),
    status: "cancelled",
    previousStatus: record.previousStatus,
    reasonCode: record.reasonCode,
    withdrawnAt: withdrawnAt.toISOString()
  });
}

export function createCleaningRequestService(repository, options = {}) {
  if (!repository || typeof repository.createOwnRequest !== "function" || typeof repository.listOwnRequests !== "function" || typeof repository.submitOwnRequest !== "function" || typeof repository.configureAutomaticDispatch !== "function" || typeof repository.withdrawOwnRequest !== "function") throw new TypeError("A complete cleaning-request repository is required.");
  return {
    async createOwnRequest(actor, input) {
      if (!actor?.userId || !actor.roles?.includes("landlord")) throw new TypeError("A Landlord account is required to create a cleaning request.");
      return projection(await repository.createOwnRequest(actor, normalizedCleaningRequest({ ...input, submit: false }, options)));
    },
    async listOwnRequests(actor) {
      if (!actor?.userId || !actor.roles?.includes("landlord")) throw new TypeError("A Landlord account is required to list cleaning requests.");
      return (await repository.listOwnRequests(actor)).map(projection);
    },
    async submitOwnRequest(actor, cleaningRequestId, input = {}) {
      if (!actor?.userId || !actor.roles?.includes("landlord")) throw new TypeError("A Landlord account is required to submit a cleaning request.");
      if (input.scopeReviewed !== true) throw new TypeError("Review and confirm the complete room scan and cleaner checklist before submission.");
      if (typeof input.cleanerPreviewAuthorized !== "boolean") throw new TypeError("Choose whether an invited Cleaner may preview room photos before accepting.");
      const result = await repository.submitOwnRequest(actor, uuid(cleaningRequestId, "cleaning request id"), { scopeReviewed: true, cleanerPreviewAuthorized: input.cleanerPreviewAuthorized });
      if (!result || result.status !== "searching-for-cleaner") throw new Error("The submitted cleaning request could not be verified.");
      return Object.freeze({
        cleaningRequestId: result.cleaningRequestId,
        status: result.status,
        submittedAt: new Date(result.submittedAt).toISOString(),
        scopeConfirmedAt: new Date(result.scopeConfirmedAt).toISOString(),
        cleanerPreviewAuthorized: result.cleanerPreviewAuthorized === true,
        photoCount: Number(result.photoCount),
        taskCount: Number(result.taskCount)
      });
    },
    async configureAutomaticDispatch(actor, cleaningRequestId, input = {}) {
      if (!actor?.userId || !actor.roles?.includes("landlord")) throw new TypeError("A Landlord account is required to authorize automatic matching.");
      if (typeof input.enabled !== "boolean") throw new TypeError("Choose whether automatic matching is enabled.");
      const attemptLimit = input.enabled ? Number(input.attemptLimit ?? 3) : 3;
      if (!Number.isInteger(attemptLimit) || attemptLimit < 1 || attemptLimit > 5) throw new TypeError("Automatic matching may invite between 1 and 5 Cleaners.");
      const approvedMaximumPricePence = input.enabled ? budget(input.approvedMaximumPricePence) : null;
      if (input.enabled && approvedMaximumPricePence == null) throw new TypeError("Review and approve the maximum booking total before automatic matching.");
      return dispatchProjection(await repository.configureAutomaticDispatch(actor, uuid(cleaningRequestId, "cleaning request id"), { enabled: input.enabled, attemptLimit, approvedMaximumPricePence }));
    },
    async withdrawOwnRequest(actor, cleaningRequestId, input = {}) {
      if (!actor?.userId || !actor.roles?.includes("landlord")) throw new TypeError("A Landlord account is required to withdraw a cleaning request.");
      const reasonCode = boundedText(input.reasonCode, 40, "Withdrawal reason", 1).toLowerCase();
      if (!withdrawalReasons.includes(reasonCode)) throw new TypeError("Choose a supported reason for withdrawing this request.");
      return withdrawalProjection(await repository.withdrawOwnRequest(actor, uuid(cleaningRequestId, "cleaning request id"), { reasonCode }));
    }
  };
}

export { recurrenceRules, withdrawalReasons };
