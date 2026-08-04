const categories = new Set(["account-access", "property", "room-scan", "booking-preparation", "booking-change", "other"]);
const statuses = new Set(["open", "reviewing", "resolved"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const supportCategoryLabels = Object.freeze({
  "account-access": "Account access",
  property: "Property",
  "room-scan": "Room scan",
  "booking-preparation": "Preparing a booking",
  "booking-change": "Booking change",
  other: "Something else"
});

export const supportStatusLabels = Object.freeze({
  open: "Sent",
  reviewing: "Under review",
  resolved: "Answered"
});

export function supportRequestPayload(form, clientRequestId, now = Date.now()) {
  const category = String(form?.category || "").trim().toLowerCase();
  const subject = String(form?.subject || "").trim();
  const description = String(form?.description || "").trim();
  if (!categories.has(category)) throw new TypeError("Choose what you need help with.");
  if (description.length < 20 || description.length > 2000) throw new TypeError("Use 20 to 2,000 characters to explain the problem.");
  if (form?.confirmNoSensitiveData !== true) throw new TypeError("Confirm that you removed passwords, access codes, payment-card data and secret keys.");
  if (!uuidPattern.test(clientRequestId || "")) throw new TypeError("This support request cannot be sent safely. Refresh and try again.");
  if (category === "booking-change") {
    const bookingId = String(form?.bookingId || "").trim().toLowerCase();
    const bookingChangeKind = String(form?.bookingChangeKind || "").trim().toLowerCase();
    if (!uuidPattern.test(bookingId)) throw new TypeError("Choose the confirmed booking you need to change.");
    if (!["reschedule", "cancel"].includes(bookingChangeKind)) throw new TypeError("Choose whether to reschedule or cancel the booking.");
    let proposedStartAt = null;
    if (bookingChangeKind === "reschedule") {
      const parsed = Date.parse(String(form?.proposedStartAt || ""));
      if (!Number.isFinite(parsed) || parsed <= Number(now) || parsed > Number(now) + 365 * 24 * 60 * 60 * 1000) throw new TypeError("Choose a new start time within the next year.");
      proposedStartAt = new Date(parsed).toISOString();
    }
    return Object.freeze({ category, bookingId, bookingChangeKind, proposedStartAt, description, confirmNoSensitiveData: true, clientRequestId });
  }
  if (subject.length < 10 || subject.length > 120) throw new TypeError("Use 10 to 120 characters for the subject.");
  return Object.freeze({ category, subject, description, confirmNoSensitiveData: true, clientRequestId });
}

export function supportRequestPage(value) {
  const source = value && typeof value === "object" ? value : {};
  const records = Array.isArray(source.supportRequests) ? source.supportRequests : [];
  return Object.freeze({
    supportRequests: Object.freeze(records.map((record) => {
      if (!record || !categories.has(record.category) || !statuses.has(record.status) || !record.supportRequestId) throw new Error("A support request could not be displayed.");
      const projected = {
        supportRequestId: String(record.supportRequestId),
        category: record.category,
        subject: String(record.subject || ""),
        description: String(record.description || ""),
        status: record.status,
        resolutionSummary: typeof record.resolutionSummary === "string" ? record.resolutionSummary : null,
        bookingId: typeof record.bookingId === "string" && uuidPattern.test(record.bookingId) ? record.bookingId.toLowerCase() : null,
        bookingChangeKind: ["reschedule", "cancel"].includes(record.bookingChangeKind) ? record.bookingChangeKind : null,
        proposedStartAt: typeof record.proposedStartAt === "string" ? record.proposedStartAt : null,
        createdAt: String(record.createdAt || ""),
        updatedAt: String(record.updatedAt || ""),
        resolvedAt: typeof record.resolvedAt === "string" ? record.resolvedAt : null
      };
      if (projected.category === "booking-change" && (!projected.bookingId || !projected.bookingChangeKind || (projected.bookingChangeKind === "reschedule") !== Boolean(projected.proposedStartAt))) throw new Error("A booking-change request could not be displayed.");
      return Object.freeze(projected);
    })),
    limit: Number.isInteger(source.limit) ? source.limit : 25,
    offset: Number.isInteger(source.offset) ? source.offset : 0
  });
}
