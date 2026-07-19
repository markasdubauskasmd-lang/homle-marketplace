const views = new Set(["awaiting", "verified", "all"]);
const identityStatuses = Object.freeze(["not-checked", "pending", "verified", "failed", "expired"]);
const backgroundStatuses = Object.freeze(["not-checked", "pending", "verified", "failed", "expired", "not-required"]);

export function adminVerificationView(value) {
  const selected = String(value || "").trim().toLowerCase();
  if (!selected) return null;
  if (!views.has(selected)) throw new TypeError("Choose a valid cleaner verification view.");
  return selected;
}

export function verificationStatusLabel(value) {
  if (typeof value !== "string" || !value) return "Unavailable";
  return value.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}

export function cleanerVerificationState(record) {
  const identityVerified = record?.identityCheckStatus === "verified";
  const backgroundSettled = record?.backgroundCheckStatus === "verified" || record?.backgroundCheckStatus === "not-required";
  return Object.freeze({
    fullyVerified: identityVerified && backgroundSettled,
    awaiting: !identityVerified || !backgroundSettled
  });
}

export function adminVerificationQueue(value) {
  if (!value || !Array.isArray(value.cleaners) || !Number.isInteger(value.limit) || !Number.isInteger(value.offset)) throw new Error("The cleaner verification queue is unavailable.");
  for (const record of value.cleaners) {
    if (!identityStatuses.includes(record?.identityCheckStatus) || !backgroundStatuses.includes(record?.backgroundCheckStatus)) throw new Error("A cleaner verification status is unavailable.");
  }
  return { cleaners: value.cleaners, limit: value.limit, offset: value.offset };
}

export function verificationChange(identityCheckStatus, backgroundCheckStatus, note) {
  const identity = String(identityCheckStatus || "").trim();
  const background = String(backgroundCheckStatus || "").trim();
  if (!identity && !background) throw new TypeError("Choose an identity or background check status to record.");
  if (identity && !identityStatuses.includes(identity)) throw new TypeError("Choose a supported identity check status.");
  if (background && !backgroundStatuses.includes(background)) throw new TypeError("Choose a supported background check status.");
  const trimmedNote = String(note || "").trim().slice(0, 500);
  if (!trimmedNote) throw new TypeError("Record a short evidence note for the audit trail.");
  return Object.freeze({
    ...(identity ? { identityCheckStatus: identity } : {}),
    ...(background ? { backgroundCheckStatus: background } : {}),
    note: trimmedNote
  });
}

export { backgroundStatuses, identityStatuses };
