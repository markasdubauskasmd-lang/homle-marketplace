// What the account-control screen may say and send.
//
// Suspension is the only account action reachable from this page. The column
// also carries `deletion-pending` and `deleted`, and both stay out of reach on
// purpose: erasure is a reviewed data-protection operation with its own
// retention rules, a hard delete is impossible against twenty-seven foreign
// keys, and a screen that offers both invites the irreversible one.
const settableStatuses = new Set(["active", "suspended"]);

const statusLabels = Object.freeze({
  active: "Active",
  suspended: "Suspended",
  // Readable, because an Administrator searching for somebody needs to see
  // that the account is already on its way out, and that this page is not
  // where that gets undone.
  "deletion-pending": "Deletion pending",
  deleted: "Deleted"
});

export function accountStatusLabel(value) {
  return statusLabels[String(value || "").trim().toLowerCase()] || "Unknown";
}

/**
 * The warning shown BEFORE the decision, not after it.
 *
 * Suspending a Cleaner who has a job tomorrow leaves a customer expecting
 * somebody who will not arrive. Nothing on this page cancels those bookings —
 * that is a money and notification decision — so the number is put in front of
 * the person about to act, which is the only place it is any use.
 */
export function suspensionWarning(account) {
  if (String(account?.accountStatus || "") !== "active") return "";
  const live = Number(account?.liveBookings);
  if (!Number.isInteger(live) || live < 1) return "";
  return `This account has ${live} live booking${live === 1 ? "" : "s"}. Suspending it does not cancel ${live === 1 ? "it" : "them"} or tell anyone, so the other party will still be expecting the clean.`;
}

export function accountStatusPayload(accountStatus, reason) {
  const status = String(accountStatus || "").trim().toLowerCase();
  if (!settableStatuses.has(status)) throw new TypeError("Choose whether the account is active or suspended.");
  const recorded = String(reason ?? "").replace(/\r\n?/g, "\n").trim();
  // Ten characters is the difference between a reason and a shrug. Suspending
  // somebody's livelihood is not an anonymous act and "why" is the first
  // question asked afterwards.
  if (recorded.length < 10) throw new TypeError("Record why this account is being suspended or restored, in at least ten characters.");
  if (recorded.length > 1000) throw new TypeError("Keep the reason under 1,000 characters.");
  return Object.freeze({ accountStatus: status, reason: recorded });
}
