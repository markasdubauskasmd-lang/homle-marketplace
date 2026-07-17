const storageKey = "tidewayAccountIntentV1";
const cleanerStorageKey = "tidewaySelectedCleanerV1";
const version = 1;
const cleanerIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const accountIntentLifetimeMs = 30 * 60 * 1000;

export function normalizeAccountIntent(value) {
  return String(value || "").trim().toLowerCase() === "book" ? "book" : "";
}

export function accountIntentFromSearch(search = "") {
  const params = new URLSearchParams(String(search || ""));
  const values = params.getAll("intent");
  return values.length === 1 ? normalizeAccountIntent(values[0]) : "";
}

export function normalizeSelectedCleaner(value) {
  const selected = String(value || "").trim().toLowerCase();
  return cleanerIdPattern.test(selected) ? selected : "";
}

export function selectedCleanerFromSearch(search = "") {
  const values = new URLSearchParams(String(search || "")).getAll("cleaner");
  return values.length === 1 ? normalizeSelectedCleaner(values[0]) : "";
}

export function saveAccountIntent(storage, intent, now = Date.now()) {
  const normalized = normalizeAccountIntent(intent);
  if (!normalized || !storage?.setItem) return "";
  const savedAt = Number.isFinite(now) ? now : Date.now();
  storage.setItem(storageKey, JSON.stringify({ version, intent: normalized, savedAt, expiresAt: savedAt + accountIntentLifetimeMs }));
  return normalized;
}

export function readAccountIntent(storage, now = Date.now()) {
  if (!storage?.getItem) return "";
  try {
    const stored = JSON.parse(storage.getItem(storageKey) || "null");
    const savedAt = Number(stored?.savedAt);
    const expiresAt = Number(stored?.expiresAt);
    const valid = stored?.version === version
      && normalizeAccountIntent(stored?.intent) === stored.intent
      && Number.isFinite(savedAt)
      && Number.isFinite(expiresAt)
      && expiresAt === savedAt + accountIntentLifetimeMs
      && now >= savedAt - 5 * 60 * 1000
      && now < expiresAt;
    if (!valid) throw new Error("invalid");
    return stored.intent;
  } catch {
    storage.removeItem?.(storageKey);
    return "";
  }
}

export function clearAccountIntent(storage) {
  storage?.removeItem?.(storageKey);
}

export function saveSelectedCleaner(storage, cleanerId, now = Date.now()) {
  const selected = normalizeSelectedCleaner(cleanerId);
  if (!selected || !storage?.setItem) return "";
  const savedAt = Number.isFinite(now) ? now : Date.now();
  storage.setItem(cleanerStorageKey, JSON.stringify({ version, cleanerId: selected, savedAt, expiresAt: savedAt + accountIntentLifetimeMs }));
  return selected;
}

export function readSelectedCleaner(storage, now = Date.now()) {
  if (!storage?.getItem) return "";
  try {
    const stored = JSON.parse(storage.getItem(cleanerStorageKey) || "null");
    const savedAt = Number(stored?.savedAt);
    const expiresAt = Number(stored?.expiresAt);
    const valid = stored?.version === version
      && normalizeSelectedCleaner(stored?.cleanerId) === stored.cleanerId
      && Number.isFinite(savedAt)
      && Number.isFinite(expiresAt)
      && expiresAt === savedAt + accountIntentLifetimeMs
      && now >= savedAt - 5 * 60 * 1000
      && now < expiresAt;
    if (!valid) throw new Error("invalid");
    return stored.cleanerId;
  } catch {
    storage.removeItem?.(cleanerStorageKey);
    return "";
  }
}

export function clearSelectedCleaner(storage) {
  storage?.removeItem?.(cleanerStorageKey);
}

export function accountEntryPath(intent, cleanerId = "") {
  if (normalizeAccountIntent(intent) !== "book") return "/signup";
  const selected = normalizeSelectedCleaner(cleanerId);
  return selected ? `/signup?${new URLSearchParams({ intent: "book", cleaner: selected })}` : "/signup?intent=book";
}
