import { containsSensitiveAccessDetails } from "./access-detail-safety.js";
import { landlordRequestDraftLifetimeMs } from "./landlord-request-draft.js";

const storageKey = "homlePropertyFormDraftV1";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// No operational free text, access information, media, consent or credentials.
export const propertyDraftFields = Object.freeze({ propertyType: 40, addressLine1: 240, addressLine2: 240, locality: 120, postcode: 12 });
function cleanFields(fields = {}) {
  return Object.fromEntries(Object.entries(propertyDraftFields).map(([name, limit]) => {
    const value = String(fields[name] || "");
    return [name, containsSensitiveAccessDetails(value) || /\b(?:password|secret|token|credential|api[ _-]?key)\b/i.test(value) ? "" : value.slice(0, limit)];
  }));
}
export function clearPropertyFormDraft(storage) {
  try { storage?.removeItem?.(storageKey); } catch {}
}
export function savePropertyFormDraft(storage, { ownerId, fields, retryId = "" }, now = Date.now()) {
  const safe = cleanFields(fields);
  if (!uuid.test(ownerId || "") || !Object.values(safe).some(value => value.trim())) { clearPropertyFormDraft(storage); return null; }
  const draft = { version: 1, ownerId, fields: safe, savedAt: now, expiresAt: now + landlordRequestDraftLifetimeMs,
    retryId: uuid.test(retryId) ? retryId : "" };
  try { storage.setItem(storageKey, JSON.stringify(draft)); return draft; } catch { return null; }
}
export function readPropertyFormDraft(storage, ownerId, now = Date.now()) {
  try {
    const draft = JSON.parse(storage.getItem(storageKey) || "null");
    if (!uuid.test(ownerId || "") || draft?.ownerId !== ownerId || draft?.version !== 1
      || !Number.isFinite(draft.savedAt) || draft.expiresAt !== draft.savedAt + landlordRequestDraftLifetimeMs
      || now < draft.savedAt - 300_000 || now >= draft.expiresAt) { clearPropertyFormDraft(storage); return null; }
    const fields = cleanFields(draft.fields);
    if (!Object.values(fields).some(value => value.trim())) { clearPropertyFormDraft(storage); return null; }
    return { fields, retryId: uuid.test(draft.retryId || "") ? draft.retryId : "" };
  } catch { clearPropertyFormDraft(storage); return null; }
}
