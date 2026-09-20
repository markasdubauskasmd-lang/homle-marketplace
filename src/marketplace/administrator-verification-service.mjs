import { uuidPattern } from "./validation.mjs";
import { decryptCleanerOnboardingPayload } from "./cleaner-onboarding-crypto.mjs";
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

const documentStatuses = new Set(["pending", "accepted", "rejected", "expired"]);

function applicationDocument(record) {
  if (!record || typeof record !== "object" || !uuidPattern.test(record.documentId || "")) throw new Error("A cleaner application document is unavailable.");
  return Object.freeze({
    documentId: record.documentId,
    section: String(record.section || "").slice(0, 40),
    documentType: String(record.documentType || "").slice(0, 60),
    // The name the Cleaner's own file had. Shown because "passport.pdf" versus
    // "Screenshot 2026-09-01.png" is genuinely part of judging an application.
    originalFilename: String(record.originalFilename || "").slice(0, 255),
    mimeType: String(record.mimeType || "").slice(0, 120),
    sizeBytes: Number.isInteger(record.sizeBytes) && record.sizeBytes >= 0 ? record.sizeBytes : 0,
    checksumSha256: /^[0-9a-f]{64}$/i.test(record.checksumSha256 || "") ? String(record.checksumSha256).toLowerCase() : null,
    status: documentStatuses.has(record.status) ? record.status : "pending",
    expiresOn: typeof record.expiresOn === "string" ? record.expiresOn.slice(0, 10) : null,
    createdAt: typeof record.createdAt === "string" ? new Date(record.createdAt).toISOString() : null
  });
}

export function createAdministratorVerificationService(repository, options = {}) {
  if (!repository || typeof repository.listQueue !== "function" || typeof repository.setVerification !== "function") throw new TypeError("A complete Administrator verification repository is required.");
  // Optional. Without it the queue still works and the application read
  // reports itself unavailable, rather than the vetting screen failing to
  // load at all.
  const dataEncryptionSecret = typeof options.dataEncryptionSecret === "string" ? options.dataEncryptionSecret : null;
  return Object.freeze({
    async list(actor, input = {}) {
      requireAdministrator(actor);
      const view = input.view == null || input.view === "" ? null : String(input.view).trim().toLowerCase();
      if (view !== null && !views.has(view)) throw new TypeError("Choose a valid cleaner verification view.");
      const result = await repository.listQueue(actor, { view, limit: integer(input.limit, 1, 100, 50, "Verification page size"), offset: integer(input.offset, 0, 10000, 0, "Verification page offset") });
      if (!result || !Array.isArray(result.cleaners)) throw new Error("The cleaner verification queue is unavailable.");
      return Object.freeze({ cleaners: Object.freeze(result.cleaners.map(entry)), limit: integer(result.limit, 1, 100, 50, "Verification page size"), offset: integer(result.offset, 0, 10000, 0, "Verification page offset") });
    },
    /**
     * The application an Administrator is about to approve or refuse.
     *
     * Approving a Cleaner is what puts a stranger in a customer's home, and it
     * was being done against a name and two status strings. This is the
     * evidence behind that decision.
     *
     * Decryption happens here because the key belongs to the application and
     * never to the database — the stored rows are ciphertext even to the
     * function that returns them. A section whose payload cannot be decrypted
     * is reported as unreadable rather than omitted: silently dropping it
     * would make an incomplete application look complete, which is the exact
     * failure this whole feature exists to stop.
     */
    async getApplication(actor, cleanerId) {
      requireAdministrator(actor);
      if (!uuidPattern.test(cleanerId || "")) throw new TypeError("A valid cleaner is required.");
      if (typeof repository.getApplication !== "function" || !dataEncryptionSecret) {
        throw Object.assign(new Error("Cleaner application review is not available on this deployment."), { statusCode: 503, code: "application-review-unavailable" });
      }
      const record = await repository.getApplication(actor, cleanerId.toLowerCase());
      if (!record || typeof record !== "object" || !Array.isArray(record.sections) || !Array.isArray(record.documents)) {
        throw new Error("The cleaner application is unavailable.");
      }
      const sections = record.sections.map((section) => {
        const code = String(section?.section || "").slice(0, 40);
        const base = {
          section: code,
          status: String(section?.status || "").slice(0, 20),
          schemaVersion: Number.isInteger(section?.schemaVersion) ? section.schemaVersion : null,
          completedAt: typeof section?.completedAt === "string" ? new Date(section.completedAt).toISOString() : null,
          updatedAt: typeof section?.updatedAt === "string" ? new Date(section.updatedAt).toISOString() : null
        };
        try {
          const data = decryptCleanerOnboardingPayload(Buffer.from(String(section?.payloadCiphertext || ""), "base64"), cleanerId.toLowerCase(), code, dataEncryptionSecret);
          return Object.freeze({ ...base, readable: true, data });
        } catch {
          return Object.freeze({ ...base, readable: false, data: null });
        }
      });
      return Object.freeze({
        cleanerId: cleanerId.toLowerCase(),
        sections: Object.freeze(sections),
        documents: Object.freeze(record.documents.map(applicationDocument))
      });
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
