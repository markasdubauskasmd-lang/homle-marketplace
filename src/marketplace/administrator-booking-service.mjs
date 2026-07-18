const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const views = new Set(["attention", "active", "finished"]);
const requestStatuses = new Set(["searching-for-cleaner", "cleaner-invited", "pending-cleaner-acceptance", "matched", "cancelled"]);
const bookingStatuses = new Set(["draft", "searching-for-cleaner", "cleaner-invited", "pending-cleaner-acceptance", "confirmed", "cleaner-en-route", "cleaner-arrived", "cleaning-in-progress", "awaiting-review", "completed", "cancelled", "disputed"]);
const paymentStatuses = new Set(["creating", "requires-customer-action", "processing", "authorized", "authorization-failed", "captured", "partially-refunded", "refunded", "cancelled", "disputed"]);
const caseStatuses = new Set(["open", "reviewing", "resolved", "closed"]);

function integer(value, minimum, maximum, fallback, label) {
  if (value == null || value === "") return fallback;
  const selected = Number(value);
  if (!Number.isInteger(selected) || selected < minimum || selected > maximum) throw new TypeError(`${label} is outside the supported range.`);
  return selected;
}

function optionalInteger(value, minimum, maximum, label) {
  if (value == null) return null;
  return integer(value, minimum, maximum, null, label);
}

function timestamp(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`${label} is unavailable.`);
  return new Date(value).toISOString();
}

function uuid(value, label, optional = false) {
  if (optional && value == null) return null;
  if (!uuidPattern.test(value || "")) throw new Error(`${label} is unavailable.`);
  return value.toLowerCase();
}

function operation(value) {
  if (!value || typeof value !== "object" || !["request", "booking"].includes(value.operationKind)) throw new Error("A booking operation is unavailable.");
  const isBooking = value.operationKind === "booking";
  if (!(isBooking ? bookingStatuses : requestStatuses).has(value.status)) throw new Error("The booking operation status is unavailable.");
  const taskCount = integer(value.taskCount, 0, 10000, null, "Task count");
  const completedTaskCount = integer(value.completedTaskCount, 0, taskCount, null, "Completed task count");
  const customerPricePence = optionalInteger(value.customerPricePence, 1, 10_000_000, "Customer price");
  const cleanerPayPence = optionalInteger(value.cleanerPayPence, 1, 10_000_000, "Cleaner pay");
  const plannedCostsPence = optionalInteger(value.plannedCostsPence, 0, 10_000_000, "Planned costs");
  const plannedContributionPence = optionalInteger(value.plannedContributionPence, 1, 10_000_000, "Planned contribution");
  const targetContributionPence = optionalInteger(value.targetContributionPence, 1, 10_000_000, "Target contribution");
  if (isBooking && (customerPricePence == null || cleanerPayPence == null || plannedCostsPence == null || plannedContributionPence == null || targetContributionPence == null || customerPricePence !== cleanerPayPence + plannedCostsPence + plannedContributionPence || plannedContributionPence < targetContributionPence)) throw new Error("The booking operation economics are unavailable.");
  return Object.freeze({
    operationKind: value.operationKind,
    requestId: uuid(value.requestId, "Request id", isBooking && value.requestId == null),
    bookingId: uuid(value.bookingId, "Booking id", !isBooking),
    status: value.status,
    scheduledStartAt: timestamp(value.scheduledStartAt, "Scheduled start"),
    scheduledEndAt: timestamp(value.scheduledEndAt, "Scheduled end"),
    cleaningType: String(value.cleaningType || "Cleaning").slice(0, 200),
    serviceCount: integer(value.serviceCount, 0, 1000, null, "Service count"),
    taskCount,
    completedTaskCount,
    customerPricePence,
    cleanerPayPence,
    plannedCostsPence,
    plannedContributionPence,
    targetMarginBasisPoints: optionalInteger(value.targetMarginBasisPoints, 0, 10000, "Target margin"),
    targetContributionPence,
    paymentStatus: value.paymentStatus == null ? null : paymentStatuses.has(value.paymentStatus) ? value.paymentStatus : (() => { throw new Error("The payment status is unavailable."); })(),
    caseStatus: value.caseStatus == null ? null : caseStatuses.has(value.caseStatus) ? value.caseStatus : (() => { throw new Error("The case status is unavailable."); })(),
    needsAttention: value.needsAttention === true,
    nextAction: String(value.nextAction || "").slice(0, 300),
    updatedAt: timestamp(value.updatedAt, "Operation update")
  });
}

export function createAdministratorBookingService(repository) {
  if (!repository || typeof repository.list !== "function") throw new TypeError("A complete Administrator booking repository is required.");
  return Object.freeze({
    async list(actor, input = {}) {
      if (!actor?.userId || !Array.isArray(actor.roles) || !actor.roles.includes("administrator")) throw Object.assign(new Error("A Homle Administrator account is required."), { statusCode: 403, code: "administrator-required" });
      const view = input.view == null || input.view === "" ? null : String(input.view).trim().toLowerCase();
      if (view !== null && !views.has(view)) throw new TypeError("Choose a valid booking operations view.");
      const result = await repository.list(actor, { view, limit: integer(input.limit, 1, 100, 50, "Booking operations page size"), offset: integer(input.offset, 0, 10000, 0, "Booking operations page offset") });
      if (!result || !Array.isArray(result.operations)) throw new Error("The booking operations queue is unavailable.");
      return Object.freeze({ operations: Object.freeze(result.operations.map(operation)), limit: integer(result.limit, 1, 100, 50, "Booking operations page size"), offset: integer(result.offset, 0, 10000, 0, "Booking operations page offset") });
    }
  });
}
