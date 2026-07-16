import { containsSensitiveAccessDetails } from "./access-detail-safety.js";

const customerRequestDraftKey = "tidewayCustomerRequestDraftV1";
const customerRequestDraftVersion = 1;
const submissionKeyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const accessSensitiveDraftFields = Object.freeze(["siteSize", "details"]);

export const customerRequestDraftLifetimeMs = 30 * 60 * 1000;
export const customerRequestDraftFields = Object.freeze({
  postcode: 12,
  propertyType: 80,
  service: 80,
  siteSize: 160,
  hazards: 120,
  frequency: 80,
  preferredDate: 20,
  preferredTimeWindow: 80,
  details: 1200,
  contactName: 120,
  organisation: 160,
  email: 160,
  phone: 40
});

function cleanFields(fields = {}) {
  const cleaned = Object.fromEntries(Object.entries(customerRequestDraftFields).map(([name, limit]) => [name, String(fields?.[name] || "").slice(0, limit)]));
  for (const name of accessSensitiveDraftFields) {
    if (containsSensitiveAccessDetails(cleaned[name])) cleaned[name] = "";
  }
  return cleaned;
}

function hasContent(fields) {
  return Object.entries(fields).some(([name, value]) => !["frequency", "preferredTimeWindow"].includes(name) && value.trim());
}

export function customerRequestDraftFingerprint(fields = {}) {
  return JSON.stringify(cleanFields(fields));
}

export function saveCustomerRequestDraft(storage, { fields = {}, currentStep = 1, submissionKey = "" } = {}, now = Date.now()) {
  if (!storage?.setItem) return null;
  const safeFields = cleanFields(fields);
  if (!hasContent(safeFields)) {
    storage.removeItem?.(customerRequestDraftKey);
    return null;
  }
  const savedAt = Number.isFinite(now) ? now : Date.now();
  const safeSubmissionKey = submissionKeyPattern.test(String(submissionKey || "")) ? String(submissionKey).toLowerCase() : "";
  const draft = {
    version: customerRequestDraftVersion,
    fields: safeFields,
    currentStep: Math.max(1, Math.min(3, Number(currentStep) || 1)),
    savedAt,
    expiresAt: savedAt + customerRequestDraftLifetimeMs,
    ...(safeSubmissionKey ? { retry: { key: safeSubmissionKey, fingerprint: customerRequestDraftFingerprint(safeFields) } } : {})
  };
  storage.setItem(customerRequestDraftKey, JSON.stringify(draft));
  return draft;
}

export function readCustomerRequestDraft(storage, now = Date.now()) {
  if (!storage?.getItem) return null;
  try {
    const value = JSON.parse(storage.getItem(customerRequestDraftKey) || "null");
    const savedAt = Number(value?.savedAt);
    const expiresAt = Number(value?.expiresAt);
    const valid = value?.version === customerRequestDraftVersion
      && Number.isFinite(savedAt)
      && Number.isFinite(expiresAt)
      && expiresAt === savedAt + customerRequestDraftLifetimeMs
      && now >= savedAt - 5 * 60 * 1000
      && now < expiresAt;
    if (!valid) {
      storage.removeItem?.(customerRequestDraftKey);
      return null;
    }
    const fields = cleanFields(value.fields);
    if (!hasContent(fields)) {
      storage.removeItem?.(customerRequestDraftKey);
      return null;
    }
    const fingerprint = customerRequestDraftFingerprint(fields);
    const retryKey = submissionKeyPattern.test(String(value?.retry?.key || "")) && value.retry.fingerprint === fingerprint
      ? String(value.retry.key).toLowerCase()
      : "";
    return {
      fields,
      currentStep: Math.max(1, Math.min(3, Number(value.currentStep) || 1)),
      savedAt,
      expiresAt,
      ...(retryKey ? { retry: { key: retryKey, fingerprint } } : {})
    };
  } catch {
    storage.removeItem?.(customerRequestDraftKey);
    return null;
  }
}

export function clearCustomerRequestDraft(storage) {
  storage?.removeItem?.(customerRequestDraftKey);
}
