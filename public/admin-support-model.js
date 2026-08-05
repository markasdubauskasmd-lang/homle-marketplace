import { supportCategoryLabels, supportRequestPage, supportStatusLabels } from "./landlord-help-model.js";

export { supportCategoryLabels, supportRequestPage, supportStatusLabels };

export function supportQueueFilter(input = {}) {
  const status = String(input.status || "").trim().toLowerCase();
  const category = String(input.category || "").trim().toLowerCase();
  const statuses = new Set(["", "open", "reviewing", "resolved"]);
  const categories = new Set(["", "account-access", "property", "room-scan", "booking-preparation", "booking-change", "other"]);
  if (!statuses.has(status) || !categories.has(category)) throw new TypeError("Choose valid support filters.");
  return Object.freeze({ status, category });
}

export function supportReviewPayload(input = {}) {
  const status = String(input.status || "").trim().toLowerCase();
  if (status === "reviewing") return Object.freeze({ status: "reviewing" });
  const resolutionSummary = String(input.resolutionSummary || "").trim();
  if (status !== "resolved" || resolutionSummary.length < 20 || resolutionSummary.length > 2000) throw new TypeError("Use 20 to 2,000 characters for the final response.");
  if (input.privacyConfirmed !== true || input.noExternalActionConfirmed !== true) throw new TypeError("Confirm both review safeguards before recording a final response.");
  return Object.freeze({ status, resolutionSummary, privacyConfirmed: true, noExternalActionConfirmed: true });
}
