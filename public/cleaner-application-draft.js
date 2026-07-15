const cleanerDraftKey = "tidewayCleanerApplicationDraftV1";
const cleanerDraftVersion = 1;
const submissionKeyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const cleanerApplicationDraftLifetimeMs = 30 * 60 * 1000;
export const cleanerApplicationDraftFields = Object.freeze({
  fullName: 120,
  postcode: 20,
  email: 254,
  phone: 30,
  travelAreas: 250,
  experience: 80,
  transport: 80,
  professionalBio: 600,
  languages: 419,
  equipmentPlan: 80,
  firstAvailableDate: 10,
  firstAvailableStartTime: 5,
  firstAvailableEndTime: 5,
  availability: 300,
  notes: 1000
});
export const cleanerApplicationDraftServices = Object.freeze([
  "serviceTurnovers",
  "serviceEndOfTenancy",
  "serviceWorkplaces",
  "serviceCommunal",
  "serviceDeepCleans"
]);

function cleanFields(fields = {}) {
  return Object.fromEntries(Object.entries(cleanerApplicationDraftFields).map(([name, limit]) => [name, String(fields?.[name] || "").slice(0, limit)]));
}

function cleanServices(services = {}) {
  return Object.fromEntries(cleanerApplicationDraftServices.map((name) => [name, services?.[name] === true]));
}

function hasContent(fields, services) {
  return Object.entries(fields).some(([name, value]) => name !== "transport" && value.trim()) || Object.values(services).some(Boolean);
}

export function cleanerApplicationDraftFingerprint(fields = {}, services = {}) {
  return JSON.stringify({ fields: cleanFields(fields), services: cleanServices(services) });
}

export function saveCleanerApplicationDraft(storage, { fields = {}, services = {}, currentStep = 1, submissionKey = "" } = {}, now = Date.now()) {
  if (!storage?.setItem) return null;
  const safeFields = cleanFields(fields);
  const safeServices = cleanServices(services);
  if (!hasContent(safeFields, safeServices)) {
    storage.removeItem?.(cleanerDraftKey);
    return null;
  }
  const savedAt = Number.isFinite(now) ? now : Date.now();
  const safeSubmissionKey = submissionKeyPattern.test(String(submissionKey || "")) ? String(submissionKey).toLowerCase() : "";
  const draft = {
    version: cleanerDraftVersion,
    fields: safeFields,
    services: safeServices,
    currentStep: Math.max(1, Math.min(3, Number(currentStep) || 1)),
    savedAt,
    expiresAt: savedAt + cleanerApplicationDraftLifetimeMs,
    ...(safeSubmissionKey ? { retry: { key: safeSubmissionKey, fingerprint: cleanerApplicationDraftFingerprint(safeFields, safeServices) } } : {})
  };
  storage.setItem(cleanerDraftKey, JSON.stringify(draft));
  return draft;
}

export function readCleanerApplicationDraft(storage, now = Date.now()) {
  if (!storage?.getItem) return null;
  try {
    const value = JSON.parse(storage.getItem(cleanerDraftKey) || "null");
    const savedAt = Number(value?.savedAt);
    const expiresAt = Number(value?.expiresAt);
    const valid = value?.version === cleanerDraftVersion
      && Number.isFinite(savedAt)
      && Number.isFinite(expiresAt)
      && expiresAt === savedAt + cleanerApplicationDraftLifetimeMs
      && now >= savedAt - 5 * 60 * 1000
      && now < expiresAt;
    if (!valid) {
      storage.removeItem?.(cleanerDraftKey);
      return null;
    }
    const fields = cleanFields(value.fields);
    const services = cleanServices(value.services);
    if (!hasContent(fields, services)) {
      storage.removeItem?.(cleanerDraftKey);
      return null;
    }
    const fingerprint = cleanerApplicationDraftFingerprint(fields, services);
    const retryKey = submissionKeyPattern.test(String(value?.retry?.key || "")) && value.retry.fingerprint === fingerprint
      ? String(value.retry.key).toLowerCase()
      : "";
    return {
      fields,
      services,
      currentStep: Math.max(1, Math.min(3, Number(value.currentStep) || 1)),
      savedAt,
      expiresAt,
      ...(retryKey ? { retry: { key: retryKey, fingerprint } } : {})
    };
  } catch {
    storage.removeItem?.(cleanerDraftKey);
    return null;
  }
}

export function clearCleanerApplicationDraft(storage) {
  storage?.removeItem?.(cleanerDraftKey);
}
