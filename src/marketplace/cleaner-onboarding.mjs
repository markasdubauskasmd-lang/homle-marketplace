import { decryptCleanerOnboardingPayload, encryptCleanerOnboardingPayload, assertCleanerOnboardingEncryptionSecret } from "./cleaner-onboarding-crypto.mjs";

export const cleanerOnboardingSections = Object.freeze([
  "personal", "business", "identity", "rtw", "dbs", "tax", "experience", "references", "insurance",
  "banking", "equipment", "transport", "availability", "areas", "languages", "skills", "training", "compliance"
]);

const sectionSet = new Set(cleanerOnboardingSections);
const forbiddenKeys = new Set(["__proto__", "prototype", "constructor", "password", "passwordhash", "sessionsecret", "authtoken"]);
const forbiddenBankingKeys = /^(accountnumber|sortcode|routingnumber|iban|swift|bic|cardnumber|cvc|cvv|securitycode)$/;

function cleanKey(value) {
  const key = typeof value === "string" ? value.trim() : "";
  if (!key || key.length > 80 || forbiddenKeys.has(key.toLowerCase())) throw new TypeError("Onboarding data contains an unsupported field.");
  return key;
}

function cleanValue(value, section, depth = 0) {
  if (depth > 5) throw new TypeError("Onboarding data is too deeply nested.");
  if (value == null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Onboarding data contains an invalid number.");
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
    if (normalized.length > 4000 || /^data:/i.test(normalized)) throw new TypeError("Onboarding text is too long or contains embedded file data.");
    return normalized;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) throw new TypeError("Onboarding data contains too many entries.");
    return value.map((item) => cleanValue(item, section, depth + 1));
  }
  if (typeof value !== "object") throw new TypeError("Onboarding data contains an unsupported value.");
  const entries = Object.entries(value);
  if (entries.length > 80) throw new TypeError("Onboarding data contains too many fields.");
  const cleaned = {};
  for (const [rawKey, rawValue] of entries) {
    const key = cleanKey(rawKey);
    if (section === "banking" && forbiddenBankingKeys.test(key.toLowerCase().replace(/[^a-z]/g, ""))) {
      throw new TypeError("Bank account and card details must be entered only in Stripe's secure onboarding flow.");
    }
    cleaned[key] = cleanValue(rawValue, section, depth + 1);
  }
  return cleaned;
}

export function normalizedCleanerOnboardingSection(value) {
  const section = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!sectionSet.has(section)) throw new TypeError("A supported Cleaner onboarding section is required.");
  return section;
}

export function normalizedCleanerOnboardingInput(sectionValue, input = {}) {
  const section = normalizedCleanerOnboardingSection(sectionValue);
  const status = input.status === "submitted" ? "submitted" : "draft";
  const payload = cleanValue(input.data && typeof input.data === "object" && !Array.isArray(input.data) ? input.data : {}, section);
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > 64 * 1024) throw new TypeError("This onboarding section is too large to save.");
  return Object.freeze({ section, status, data: payload, schemaVersion: 1 });
}

function projection(record, secret) {
  const cleanerId = record.cleaner_user_id || record.cleanerId;
  const section = record.section_code || record.section;
  return Object.freeze({
    section,
    status: record.status,
    data: decryptCleanerOnboardingPayload(record.payload_ciphertext, cleanerId, section, secret),
    schemaVersion: Number(record.schema_version) || 1,
    completedAt: record.completed_at ? new Date(record.completed_at).toISOString() : null,
    updatedAt: new Date(record.updated_at).toISOString()
  });
}

export function createCleanerOnboardingService(repository, options = {}) {
  if (!repository || typeof repository.listOwnSections !== "function" || typeof repository.saveOwnSection !== "function") throw new TypeError("A complete Cleaner onboarding repository is required.");
  const secret = options.dataEncryptionSecret;
  assertCleanerOnboardingEncryptionSecret(secret);
  function requireCleaner(actor, action) {
    if (!actor?.userId || !actor.roles?.includes("cleaner")) throw new TypeError(`A Cleaner account is required to ${action}.`);
  }
  return Object.freeze({
    async listOwnSections(actor) {
      requireCleaner(actor, "view onboarding information");
      const records = await repository.listOwnSections(actor);
      return records.map((record) => projection(record, secret));
    },
    async getOwnSection(actor, sectionValue) {
      requireCleaner(actor, "view onboarding information");
      const section = normalizedCleanerOnboardingSection(sectionValue);
      const records = await repository.listOwnSections(actor);
      const record = records.find((candidate) => (candidate.section_code || candidate.section) === section);
      return record ? projection(record, secret) : null;
    },
    async saveOwnSection(actor, sectionValue, input) {
      requireCleaner(actor, "save onboarding information");
      const normalized = normalizedCleanerOnboardingInput(sectionValue, input);
      const payloadCiphertext = encryptCleanerOnboardingPayload(normalized.data, actor.userId, normalized.section, secret);
      return projection(await repository.saveOwnSection(actor, { ...normalized, payloadCiphertext }), secret);
    }
  });
}
