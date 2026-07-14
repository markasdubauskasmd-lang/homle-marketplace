const handoffKey = "tidewayBriefHandoff";
const handoffLifetimeMs = 30 * 60 * 1000;
const referencePattern = /^REQ-[A-Z0-9]{8}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function saveBriefHandoff(storage, reference, email, now = Date.now()) {
  const safeReference = typeof reference === "string" ? reference.trim().toUpperCase() : "";
  const safeEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!referencePattern.test(safeReference) || !emailPattern.test(safeEmail)) return false;
  try {
    storage.setItem(handoffKey, JSON.stringify({ reference: safeReference, email: safeEmail, createdAt: now }));
    return true;
  } catch {
    return false;
  }
}

export function readBriefHandoff(storage, expectedReference, now = Date.now()) {
  const safeReference = typeof expectedReference === "string" ? expectedReference.trim().toUpperCase() : "";
  if (!referencePattern.test(safeReference)) return null;
  try {
    const handoff = JSON.parse(storage.getItem(handoffKey) || "null");
    const age = now - Number(handoff?.createdAt);
    const valid = handoff
      && handoff.reference === safeReference
      && emailPattern.test(handoff.email || "")
      && Number.isFinite(age)
      && age >= 0
      && age <= handoffLifetimeMs;
    if (!valid) {
      if (handoff && (handoff.reference === safeReference || !Number.isFinite(age) || age > handoffLifetimeMs)) storage.removeItem(handoffKey);
      return null;
    }
    return { reference: handoff.reference, email: handoff.email };
  } catch {
    try { storage.removeItem(handoffKey); } catch {}
    return null;
  }
}

export function clearBriefHandoff(storage) {
  try { storage.removeItem(handoffKey); } catch {}
}
