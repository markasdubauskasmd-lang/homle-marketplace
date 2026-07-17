import { containsSensitiveAccessDetails } from "./access-detail-safety.js";

const landlordRequestDraftKey = "homleLandlordRequestDraftV1";
const landlordRequestDraftVersion = 1;
const propertyIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const accessSensitiveFields = Object.freeze(["specialInstructions", "transcript", "tasks"]);

export const landlordRequestDraftLifetimeMs = 30 * 60 * 1000;
export const landlordRequestDraftFields = Object.freeze({
  propertyId: 36,
  requestedDate: 10,
  requestedTime: 5,
  durationMinutes: 4,
  cleaningType: 80,
  frequency: 40,
  budget: 20,
  specialInstructions: 5000,
  transcript: 5000,
  tasks: 20000
});

function cleanFields(fields = {}) {
  const cleaned = Object.fromEntries(Object.entries(landlordRequestDraftFields).map(([name, limit]) => [name, String(fields?.[name] || "").slice(0, limit)]));
  if (!propertyIdPattern.test(cleaned.propertyId)) cleaned.propertyId = "";
  for (const name of accessSensitiveFields) {
    if (containsSensitiveAccessDetails(cleaned[name])) cleaned[name] = "";
  }
  return cleaned;
}

function hasContent(fields) {
  return Object.entries(fields).some(([name, value]) => !["durationMinutes", "frequency"].includes(name) && value.trim());
}

export function saveLandlordRequestDraft(storage, { fields = {} } = {}, now = Date.now()) {
  if (!storage?.setItem) return null;
  const safeFields = cleanFields(fields);
  if (!hasContent(safeFields)) {
    storage.removeItem?.(landlordRequestDraftKey);
    return null;
  }
  const savedAt = Number.isFinite(now) ? now : Date.now();
  const draft = { version: landlordRequestDraftVersion, fields: safeFields, savedAt, expiresAt: savedAt + landlordRequestDraftLifetimeMs };
  storage.setItem(landlordRequestDraftKey, JSON.stringify(draft));
  return draft;
}

export function readLandlordRequestDraft(storage, now = Date.now()) {
  if (!storage?.getItem) return null;
  try {
    const value = JSON.parse(storage.getItem(landlordRequestDraftKey) || "null");
    const savedAt = Number(value?.savedAt);
    const expiresAt = Number(value?.expiresAt);
    const valid = value?.version === landlordRequestDraftVersion
      && Number.isFinite(savedAt)
      && Number.isFinite(expiresAt)
      && expiresAt === savedAt + landlordRequestDraftLifetimeMs
      && now >= savedAt - 5 * 60 * 1000
      && now < expiresAt;
    if (!valid) {
      storage.removeItem?.(landlordRequestDraftKey);
      return null;
    }
    const fields = cleanFields(value.fields);
    if (!hasContent(fields)) {
      storage.removeItem?.(landlordRequestDraftKey);
      return null;
    }
    return { fields, savedAt, expiresAt };
  } catch {
    storage.removeItem?.(landlordRequestDraftKey);
    return null;
  }
}

export function clearLandlordRequestDraft(storage) {
  storage?.removeItem?.(landlordRequestDraftKey);
}
