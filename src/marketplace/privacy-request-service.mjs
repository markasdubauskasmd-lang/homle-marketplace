const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const requestTypes = new Set(["export", "deletion"]);
const statuses = new Set(["requested", "verifying", "processing", "completed", "rejected"]);

function actorAccount(actor) {
  if (!uuidPattern.test(actor?.userId || "")) throw new TypeError("A signed-in Homle account is required.");
}

function uuid(value, label) {
  if (!uuidPattern.test(value || "")) throw new TypeError(`A valid ${label} is required.`);
  return value.toLowerCase();
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
    }
  });
}
