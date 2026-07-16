const storageKey = "tidewayAccountIntentV1";
const version = 1;

export const accountIntentLifetimeMs = 30 * 60 * 1000;

export function normalizeAccountIntent(value) {
  return String(value || "").trim().toLowerCase() === "book" ? "book" : "";
}

export function accountIntentFromSearch(search = "") {
  const params = new URLSearchParams(String(search || ""));
  const values = params.getAll("intent");
  return values.length === 1 ? normalizeAccountIntent(values[0]) : "";
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

export function accountEntryPath(intent) {
  return normalizeAccountIntent(intent) === "book" ? "/signup?intent=book" : "/signup";
}
