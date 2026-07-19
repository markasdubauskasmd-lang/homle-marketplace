const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const views = new Set(["awaiting", "verified", "all"]);
const identityStatuses = new Set(["not-checked", "pending", "verified", "failed", "expired"]);
const backgroundStatuses = new Set(["not-checked", "pending", "verified", "failed", "expired", "not-required"]);

function integer(value, minimum, maximum, fallback, label) {
  if (value == null || value === "") return fallback;
  const selected = Number(value);
  if (!Number.isInteger(selected) || selected < minimum || selected > maximum) throw new TypeError(`${label} is outside the supported range.`);
  return selected;
}

function requireAdministrator(actor) {
  if (!actor?.userId || !Array.isArray(actor.roles) || !actor.roles.includes("administrator")) {
    throw Object.assign(new Error("A Homle Administrator account is required."), { statusCode: 403, code: "administrator-required" });
  }
}

function entry(value) {
  if (!value || typeof value !== "object" || !uuidPattern.test(value.cleanerId || "")) throw new Error("A cleaner verification record is unavailable.");
  if (!identityStatuses.has(value.identityCheckStatus) || !backgroundStatuses.has(value.backgroundCheckStatus)) throw new Error("A cleaner verification status is unavailable.");
  return Object.freeze({
    cleanerId: value.cleanerId,
    displayName: String(value.displayName || "").slice(0, 160),
    identityCheckStatus: value.identityCheckStatus,
    backgroundCheckStatus: value.backgroundCheckStatus,
    isPublic: value.isPublic === true,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null
  });
}

export function createAdministratorVerificationService(repository) {
  if (!repository || typeof repository.listQueue !== "function" || typeof repository.setVerification !== "function") throw new TypeError("A complete Administrator verification repository is required.");
  return Object.freeze({
    async list(actor, input = {}) {
      requireAdministrator(actor);
      const view = input.view == null || input.view === "" ? null : String(input.view).trim().toLowerCase();
      if (view !== null && !views.has(view)) throw new TypeError("Choose a valid cleaner verification view.");
      const result = await repository.listQueue(actor, { view, limit: integer(input.limit, 1, 100, 50, "Verification page size"), offset: integer(input.offset, 0, 10000, 0, "Verification page offset") });
      if (!result || !Array.isArray(result.cleaners)) throw new Error("The cleaner verification queue is unavailable.");
      return Object.freeze({ cleaners: Object.freeze(result.cleaners.map(entry)), limit: integer(result.limit, 1, 100, 50, "Verification page size"), offset: integer(result.offset, 0, 10000, 0, "Verification page offset") });
    },
    async set(actor, cleanerId, input = {}) {
      requireAdministrator(actor);
      if (!uuidPattern.test(cleanerId || "")) throw new TypeError("A valid cleaner is required.");
      const identityCheckStatus = input.identityCheckStatus == null || input.identityCheckStatus === "" ? null : String(input.identityCheckStatus).trim();
      const backgroundCheckStatus = input.backgroundCheckStatus == null || input.backgroundCheckStatus === "" ? null : String(input.backgroundCheckStatus).trim();
      if (identityCheckStatus === null && backgroundCheckStatus === null) throw new TypeError("Supply an identity or background check status to change.");
      if (identityCheckStatus !== null && !identityStatuses.has(identityCheckStatus)) throw new TypeError("Choose a supported identity check status.");
      if (backgroundCheckStatus !== null && !backgroundStatuses.has(backgroundCheckStatus)) throw new TypeError("Choose a supported background check status.");
      const note = typeof input.note === "string" ? input.note.slice(0, 500) : "";
      const result = await repository.setVerification(actor, { cleanerId: cleanerId.toLowerCase(), identityCheckStatus, backgroundCheckStatus, note });
      if (!result || !uuidPattern.test(result.cleanerId || "") || !identityStatuses.has(result.identityCheckStatus) || !backgroundStatuses.has(result.backgroundCheckStatus)) throw new Error("The cleaner verification update is unavailable.");
      return Object.freeze({ cleanerId: result.cleanerId, identityCheckStatus: result.identityCheckStatus, backgroundCheckStatus: result.backgroundCheckStatus });
    }
  });
}
