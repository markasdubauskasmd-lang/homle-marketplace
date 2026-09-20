import { uuid, uuidPattern } from "./validation.mjs";
const requestTypes = new Set(["export", "deletion"]);
const statuses = new Set(["requested", "verifying", "processing", "completed", "rejected"]);

const queueViews = new Set(["open", "completed", "all"]);
const progressStatuses = new Set(["verifying", "processing", "completed", "rejected"]);

function actorAccount(actor) {
  if (!uuidPattern.test(actor?.userId || "")) throw new TypeError("A signed-in Homle account is required.");
}

function administratorAccount(actor) {
  actorAccount(actor);
  if (!Array.isArray(actor?.roles) || !actor.roles.includes("administrator")) {
    throw Object.assign(new Error("An Administrator account is required to manage data-protection requests."), { statusCode: 403, code: "administrator-required" });
  }
}

function boundedInteger(value, minimum, maximum, fallback, label) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new TypeError(`${label} is outside the supported range.`);
  return parsed;
}

function countOf(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${label} is unavailable.`);
  return parsed;
}

function administratorPrivacyRequest(value) {
  const record = object(value);
  if (!record || typeof record !== "object" || !requestTypes.has(record.requestType) || !statuses.has(record.status)) throw new Error("The data-protection request is unavailable.");
  return Object.freeze({
    requestId: uuid(record.requestId, "privacy request id"),
    accountId: uuid(record.accountId, "account id"),
    email: typeof record.email === "string" && record.email.length <= 320 ? record.email : "",
    requestType: record.requestType,
    status: record.status,
    createdAt: timestamp(record.createdAt, "Privacy request creation time"),
    verifiedAt: timestamp(record.verifiedAt, "Privacy request verification time", true),
    completedAt: timestamp(record.completedAt, "Privacy request completion time", true),
    // One month from the request, per UK GDPR. Projected rather than left for a
    // reader to work out, because the whole purpose of the queue is that this
    // date is not missed by accident.
    dueAt: timestamp(record.dueAt, "Privacy request deadline"),
    overdue: record.overdue === true
  });
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

function privacyRequest(value) {
  const record = object(value);
  if (!record || typeof record !== "object" || !requestTypes.has(record.requestType) || !statuses.has(record.status)) throw new Error("The account privacy request is unavailable.");
  const result = {
    requestId: uuid(record.requestId, "privacy request id"),
    requestType: record.requestType,
    status: record.status,
    createdAt: timestamp(record.createdAt, "Privacy request creation time"),
    verifiedAt: timestamp(record.verifiedAt, "Privacy request verification time", true),
    completedAt: timestamp(record.completedAt, "Privacy request completion time", true)
  };
  if (record.created != null) result.created = record.created === true;
  return Object.freeze(result);
}

export function createPrivacyRequestService(repository) {
  if (!repository || typeof repository.list !== "function" || typeof repository.request !== "function") throw new TypeError("A complete account privacy-request repository is required.");
  return Object.freeze({
    async list(actor) {
      actorAccount(actor);
      const records = object(await repository.list(actor));
      if (!Array.isArray(records) || records.length > 20) throw new Error("The account privacy request list is unavailable.");
      return Object.freeze(records.map(privacyRequest));
    },
    async request(actor, input = {}) {
      actorAccount(actor);
      const requestType = String(input.requestType || "").trim().toLowerCase();
      if (!requestTypes.has(requestType)) throw new TypeError("Choose data export or account deletion.");
      return privacyRequest(await repository.request(actor, { requestId: uuid(input.requestId, "privacy request retry id"), requestType }));
    },
    /**
     * The administrator queue.
     *
     * Intake has existed since migration 035 and nothing could read it, so a
     * data-protection request was written to a table nobody looked at. UK GDPR
     * allows one month to answer; a request nobody can see is a breach on a
     * timer, and the timer had been running the whole time.
     *
     * The queue projects the account's own email, because answering a subject
     * access request means sending it somewhere verified, and nothing else
     * about the person. It is for scheduling statutory work, not for browsing
     * customers.
     */
    async listForAdministrator(actor, input = {}) {
      administratorAccount(actor);
      if (typeof repository.listForAdministrator !== "function") throw new TypeError("The administrator data-protection queue is unavailable.");
      const view = input.view == null || input.view === "" ? "open" : String(input.view).trim().toLowerCase();
      if (!queueViews.has(view)) throw new TypeError("Choose a valid data-protection queue view.");
      const page = object(await repository.listForAdministrator(actor, {
        view,
        limit: boundedInteger(input.limit, 1, 100, 50, "Data-protection page size"),
        offset: boundedInteger(input.offset, 0, 10_000, 0, "Data-protection page offset")
      }));
      if (!page || !Array.isArray(page.requests)) throw new Error("The data-protection queue is unavailable.");
      return Object.freeze({
        requests: Object.freeze(page.requests.map(administratorPrivacyRequest)),
        openCount: countOf(page.openCount, "Open data-protection request count"),
        overdueCount: countOf(page.overdueCount, "Overdue data-protection request count"),
        limit: boundedInteger(page.limit, 1, 100, 50, "Data-protection page size"),
        offset: boundedInteger(page.offset, 0, 10_000, 0, "Data-protection page offset")
      });
    },
    async recordProgress(actor, requestId, input = {}) {
      administratorAccount(actor);
      if (typeof repository.recordProgress !== "function") throw new TypeError("The administrator data-protection queue is unavailable.");
      const status = String(input.status || "").trim().toLowerCase();
      if (!progressStatuses.has(status)) throw new TypeError("Choose a valid data-protection request status.");
      const note = input.note == null ? null : String(input.note).trim().slice(0, 1000) || null;
      // Refusing somebody's data-protection request is a decision that has to be
      // explained, to them and to a regulator asking why. The database enforces
      // this too; rejecting here gives the administrator a usable message
      // instead of a constraint error.
      if (status === "rejected" && !note) throw new TypeError("Record why this data-protection request is being refused.");
      return privacyRequest(await repository.recordProgress(actor, { requestId: uuid(requestId, "privacy request id"), status, note }));
    }
  });
}
