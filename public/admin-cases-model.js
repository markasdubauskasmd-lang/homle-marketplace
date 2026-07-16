const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedStatuses = Object.freeze(["open", "reviewing", "resolved", "closed"]);
const allowedCategories = Object.freeze(["quality", "damage", "access", "safety", "conduct", "payment", "other"]);
const controlCharacters = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
export const caseResponsePolicyVersion = "tideway-case-response-v1";

const casePolicies = Object.freeze({
  quality: Object.freeze({
    priority: "Standard review",
    summary: "Compare the accepted scope with timestamped task progress and available before-and-after evidence.",
    evidence: Object.freeze(["Accepted room-by-room checklist", "Task updates and Cleaner notes", "Relevant before-and-after photos", "Booking messages about agreed scope"]),
    boundary: "Do not promise a re-clean, discount or refund. Record only the booking outcome; any approved remedy remains a separate decision."
  }),
  damage: Object.freeze({
    priority: "Priority review",
    summary: "Preserve the allegation separately from verified facts and compare time-stamped condition evidence.",
    evidence: Object.freeze(["Relevant before-and-after photos", "Issue report and timestamps", "Accepted scope and property notes", "Participant messages about the item"]),
    boundary: "Do not admit liability or promise compensation. Never copy insurance, bank or card details into the resolution note."
  }),
  access: Object.freeze({
    priority: "Priority review",
    summary: "Check whether the accepted booking pack supplied usable access information at the required time.",
    evidence: Object.freeze(["Accepted booking and arrival timeline", "Access-message timestamps", "Journey and arrival events", "Participant statements about the failed access"]),
    boundary: "Do not repeat door codes, key locations, alarm details or an exact address in the case note."
  }),
  safety: Object.freeze({
    priority: "Immediate safety review",
    summary: "Separate immediate danger from the booking decision and restrict sensitive safety information to the minimum needed.",
    evidence: Object.freeze(["Issue report and exact event times", "Relevant job photos only", "Journey and cleaning-status timeline", "Participant statements, labelled as statements"]),
    boundary: "Tideway is not an emergency service. Do not expose live location, promise an emergency response or treat an allegation as a verified fact."
  }),
  conduct: Object.freeze({
    priority: "Priority review",
    summary: "Compare participant statements with the booking timeline while keeping allegations distinct from established facts.",
    evidence: Object.freeze(["Booking messages", "Journey and cleaning-status events", "Issue reports and relevant photos", "Each participant statement"]),
    boundary: "Do not publish allegations, reveal private contact details or make hiring, suspension or legal conclusions from this screen."
  }),
  payment: Object.freeze({
    priority: "Standard review",
    summary: "Compare only Tideway's provider-neutral payment status with the accepted booking amount and outcome.",
    evidence: Object.freeze(["Accepted customer total", "Provider-neutral authorization status", "Recorded booking outcome", "Existing payment-action audit references"]),
    boundary: "Do not enter card, bank or provider-secret data. This case resolution does not capture, cancel, refund or transfer money."
  }),
  other: Object.freeze({
    priority: "Triage required",
    summary: "Identify the closest case type, then review only the evidence needed for the booking outcome.",
    evidence: Object.freeze(["Accepted booking pack", "Relevant timeline events", "Relevant participant messages", "Relevant photos or issue reports"]),
    boundary: "Do not broaden the record with unrelated personal data or promise an external, financial or legal action."
  })
});

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} is unavailable.`);
  return value;
}

function uuid(value, label) {
  if (!uuidPattern.test(String(value || ""))) throw new TypeError(`${label} is unavailable.`);
  return String(value).toLowerCase();
}

function boundedText(value, minimum, maximum, label, optional = false) {
  const selected = typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : "";
  if (optional && !selected) return null;
  if (selected.length < minimum || selected.length > maximum || controlCharacters.test(selected)) throw new TypeError(`${label} is unavailable.`);
  return selected;
}

function timestamp(value, label, optional = false) {
  if (optional && value == null) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new TypeError(`${label} is unavailable.`);
  return new Date(value).toISOString();
}

function pageInteger(value, minimum, maximum, label) {
  const selected = Number(value);
  if (!Number.isInteger(selected) || selected < minimum || selected > maximum) throw new TypeError(`${label} is unavailable.`);
  return selected;
}

function projectCase(value) {
  const record = object(value, "Booking case");
  if (!allowedCategories.includes(record.category) || !allowedStatuses.includes(record.status)) throw new TypeError("Booking case classification is unavailable.");
  if (!["landlord", "cleaner"].includes(record.openedByRole)) throw new TypeError("Booking case participant role is unavailable.");
  const outcome = record.resolutionOutcome == null ? null : String(record.resolutionOutcome);
  if (outcome !== null && !["completed", "cancelled"].includes(outcome)) throw new TypeError("Booking case outcome is unavailable.");
  return Object.freeze({
    disputeId: uuid(record.disputeId, "Booking case reference"),
    bookingId: uuid(record.bookingId, "Booking reference"),
    category: record.category,
    description: boundedText(record.description, 20, 5000, "Booking case description"),
    status: record.status,
    openedByRole: record.openedByRole,
    resolutionNote: boundedText(record.resolutionNote, 20, 5000, "Booking case resolution", true),
    resolutionOutcome: outcome,
    createdAt: timestamp(record.createdAt, "Booking case creation time"),
    resolvedAt: timestamp(record.resolvedAt, "Booking case resolution time", true)
  });
}

export function adminCaseQueue(value) {
  const result = object(value, "Booking case queue");
  if (!Array.isArray(result.disputes)) throw new TypeError("Booking case queue is unavailable.");
  return Object.freeze({
    disputes: Object.freeze(result.disputes.map(projectCase)),
    limit: pageInteger(result.limit, 1, 100, "Booking case page size"),
    offset: pageInteger(result.offset, 0, 10000, "Booking case page offset")
  });
}

export function adminCaseFilter(value) {
  const selected = String(value || "").trim().toLowerCase();
  if (!selected) return "";
  if (!allowedStatuses.includes(selected)) throw new TypeError("Choose a valid case status.");
  return selected;
}

export function adminCaseReviewPayload() {
  return Object.freeze({ status: "reviewing" });
}

export function adminCaseResolutionPayload(value) {
  const input = object(value, "Booking case resolution");
  const resolutionOutcome = String(input.resolutionOutcome || "").trim().toLowerCase();
  if (!["completed", "cancelled"].includes(resolutionOutcome)) throw new TypeError("Choose the final booking outcome.");
  if (input.confirmed !== true) throw new TypeError("Confirm that you understand what this decision changes.");
  if (input.policyVersion !== caseResponsePolicyVersion) throw new TypeError("Review the current booking-case handling standard before resolving this case.");
  if (input.evidenceReviewed !== true) throw new TypeError("Confirm that the relevant booking evidence was reviewed and named in the resolution note.");
  if (input.sensitiveDataMinimised !== true) throw new TypeError("Confirm that unnecessary personal, access and payment data was kept out of the resolution note.");
  if (input.noExternalActionConfirmed !== true) throw new TypeError("Confirm that this decision does not perform a payment or external action.");
  return Object.freeze({
    status: "resolved",
    resolutionOutcome,
    resolutionNote: boundedText(input.resolutionNote, 20, 5000, "Resolution note"),
    policyVersion: caseResponsePolicyVersion,
    evidenceReviewed: true,
    sensitiveDataMinimised: true,
    noExternalActionConfirmed: true
  });
}

export function casePolicyForCategory(value) {
  const selected = casePolicies[String(value || "").trim().toLowerCase()];
  if (!selected) throw new TypeError("Choose a valid case category.");
  return selected;
}

export function shortBookingReference(value) {
  return `BKG-${uuid(value, "Booking reference").slice(0, 8).toUpperCase()}`;
}

export function caseStatusLabel(value) {
  return Object.freeze({ open: "Open", reviewing: "Under review", resolved: "Resolved", closed: "Closed" })[value] || "Status unavailable";
}

export function caseCategoryLabel(value) {
  return Object.freeze({ quality: "Quality", damage: "Damage", access: "Access", safety: "Safety", conduct: "Conduct", payment: "Payment record", other: "Other" })[value] || "Case";
}
