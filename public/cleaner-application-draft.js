const cleanerDraftKey = "tidewayCleanerApplicationDraftV1";
const cleanerDraftVersion = 1;

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

export function saveCleanerApplicationDraft(storage, { fields = {}, services = {}, currentStep = 1 } = {}, now = Date.now()) {
  if (!storage?.setItem) return null;
  const safeFields = cleanFields(fields);
  const safeServices = cleanServices(services);
  if (!hasContent(safeFields, safeServices)) {
    storage.removeItem?.(cleanerDraftKey);
    return null;
  }
  const savedAt = Number.isFinite(now) ? now : Date.now();
  const draft = {
    version: cleanerDraftVersion,
    fields: safeFields,
    services: safeServices,
    currentStep: Math.max(1, Math.min(3, Number(currentStep) || 1)),
    savedAt,
    expiresAt: savedAt + cleanerApplicationDraftLifetimeMs
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
    return { fields, services, currentStep: Math.max(1, Math.min(3, Number(value.currentStep) || 1)), savedAt, expiresAt };
  } catch {
    storage.removeItem?.(cleanerDraftKey);
    return null;
  }
}

export function clearCleanerApplicationDraft(storage) {
  storage?.removeItem?.(cleanerDraftKey);
}
