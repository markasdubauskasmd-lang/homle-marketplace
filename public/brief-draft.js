const draftVersion = 1;
const draftKeyPrefix = "tidewayBriefDraftV1:";

export const briefDraftLifetimeMs = 30 * 60 * 1000;

function normaliseReference(reference) {
  const value = String(reference || "").trim().toUpperCase();
  return /^REQ-[A-Z0-9]{8}$/.test(value) ? value : "";
}

function normaliseTranscript(value) {
  return String(value || "").slice(0, 5000);
}

function normaliseTasks(values) {
  const unique = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    const task = String(value || "").replace(/^\s*[-*•]\s*/, "").trim().slice(0, 500);
    if (task && !unique.has(task.toLowerCase())) unique.set(task.toLowerCase(), task);
    if (unique.size === 40) break;
  }
  return [...unique.values()];
}

export function briefDraftKey(reference) {
  const safeReference = normaliseReference(reference);
  return safeReference ? `${draftKeyPrefix}${safeReference}` : "";
}

export function saveBriefDraft(storage, { reference, transcript = "", tasks = [] } = {}, now = Date.now()) {
  const key = briefDraftKey(reference);
  if (!key || !storage?.setItem) return null;
  const safeTranscript = normaliseTranscript(transcript);
  const safeTasks = normaliseTasks(tasks);
  if (!safeTranscript.trim() && !safeTasks.length) {
    storage.removeItem?.(key);
    return null;
  }
  const savedAt = Number.isFinite(now) ? now : Date.now();
  const draft = { version: draftVersion, reference: normaliseReference(reference), transcript: safeTranscript, tasks: safeTasks, savedAt, expiresAt: savedAt + briefDraftLifetimeMs };
  // Losing a draft is a small harm; taking the form down is a large one. `setItem` throws
  // when storage is full and throws unconditionally in Safari private browsing, and this
  // runs from an input handler, so an unguarded throw aborted the keystroke that caused
  // it. Returning null is the same "nothing saved" answer the guards above already give.
  try {
    storage.setItem(key, JSON.stringify(draft));
  } catch {
    return null;
  }
  return draft;
}

export function readBriefDraft(storage, reference, now = Date.now()) {
  const key = briefDraftKey(reference);
  if (!key || !storage?.getItem) return null;
  try {
    const value = JSON.parse(storage.getItem(key) || "null");
    const savedAt = Number(value?.savedAt);
    const expiresAt = Number(value?.expiresAt);
    const valid = value?.version === draftVersion
      && value?.reference === normaliseReference(reference)
      && Number.isFinite(savedAt)
      && Number.isFinite(expiresAt)
      && expiresAt === savedAt + briefDraftLifetimeMs
      && now >= savedAt - 5 * 60 * 1000
      && now < expiresAt;
    if (!valid) {
      storage.removeItem?.(key);
      return null;
    }
    const transcript = normaliseTranscript(value.transcript);
    const tasks = normaliseTasks(value.tasks);
    if (!transcript.trim() && !tasks.length) {
      storage.removeItem?.(key);
      return null;
    }
    return { reference: value.reference, transcript, tasks, savedAt, expiresAt };
  } catch {
    storage.removeItem?.(key);
    return null;
  }
}

export function clearBriefDraft(storage, reference) {
  const key = briefDraftKey(reference);
  if (key && storage?.removeItem) storage.removeItem(key);
}
