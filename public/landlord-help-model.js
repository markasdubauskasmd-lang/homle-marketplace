const categories = new Set(["account-access", "property", "room-scan", "booking-preparation", "other"]);
const statuses = new Set(["open", "reviewing", "resolved"]);

export const supportCategoryLabels = Object.freeze({
  "account-access": "Account access",
  property: "Property",
  "room-scan": "Room scan",
  "booking-preparation": "Preparing a booking",
  other: "Something else"
});

export const supportStatusLabels = Object.freeze({
  open: "Sent",
  reviewing: "Under review",
  resolved: "Answered"
});

export function supportRequestPayload(form, clientRequestId) {
  const category = String(form?.category || "").trim().toLowerCase();
  const subject = String(form?.subject || "").trim();
  const description = String(form?.description || "").trim();
  if (!categories.has(category)) throw new TypeError("Choose what you need help with.");
  if (subject.length < 10 || subject.length > 120) throw new TypeError("Use 10 to 120 characters for the subject.");
  if (description.length < 20 || description.length > 2000) throw new TypeError("Use 20 to 2,000 characters to explain the problem.");
  if (form?.confirmNoSensitiveData !== true) throw new TypeError("Confirm that you removed passwords, access codes, payment-card data and secret keys.");
  if (!/^[0-9a-f-]{36}$/i.test(clientRequestId || "")) throw new TypeError("This support request cannot be sent safely. Refresh and try again.");
  return Object.freeze({ category, subject, description, confirmNoSensitiveData: true, clientRequestId });
}

export function supportRequestPage(value) {
  const source = value && typeof value === "object" ? value : {};
  const records = Array.isArray(source.supportRequests) ? source.supportRequests : [];
  return Object.freeze({
    supportRequests: Object.freeze(records.map((record) => {
      if (!record || !categories.has(record.category) || !statuses.has(record.status) || !record.supportRequestId) throw new Error("A support request could not be displayed.");
      return Object.freeze({
        supportRequestId: String(record.supportRequestId),
        category: record.category,
        subject: String(record.subject || ""),
        description: String(record.description || ""),
        status: record.status,
        resolutionSummary: typeof record.resolutionSummary === "string" ? record.resolutionSummary : null,
        createdAt: String(record.createdAt || ""),
        updatedAt: String(record.updatedAt || ""),
        resolvedAt: typeof record.resolvedAt === "string" ? record.resolvedAt : null
      });
    })),
    limit: Number.isInteger(source.limit) ? source.limit : 25,
    offset: Number.isInteger(source.offset) ? source.offset : 0
  });
}
