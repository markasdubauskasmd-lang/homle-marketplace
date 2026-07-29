import { createCleanerPage, element } from "./cleaner-page.js?v=20260729-11";

const incidentCategories = new Set(["damage", "safety", "conduct", "access"]);
const categoryLabels = {
  damage: "Damage",
  safety: "Safety",
  conduct: "Conduct",
  access: "Access"
};
const categoryTitles = {
  damage: "Property damage",
  safety: "Safety incident",
  conduct: "Safeguarding or conduct concern",
  access: "Access or security incident"
};
const statusLabels = {
  open: "Open",
  reviewing: "Under review",
  resolved: "Resolved",
  closed: "Closed"
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const list = document.querySelector("[data-incident-list]");
const empty = document.querySelector("[data-incident-empty]");
const partial = document.querySelector("[data-incident-status]");
const dialog = document.querySelector("[data-incident-dialog]");

function incidentDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function renderIncident({ dispute, booking }) {
  const category = incidentCategories.has(dispute.category) ? dispute.category : "safety";
  const status = statusLabels[dispute.status] ? dispute.status : "open";
  const row = element("a", "hc-support-row hc-incident-row");
  row.href = `/bookings/${encodeURIComponent(dispute.bookingId)}`;
  row.setAttribute("aria-label", `Open ${categoryTitles[category]}`);

  const copy = element("span", "hc-support-copy hc-incident-copy");
  copy.append(
    element("strong", "", categoryTitles[category]),
    element("small", "", `${booking?.propertyName || "Cleaning booking"} · ${incidentDate(dispute.createdAt)}`)
  );
  const categoryPill = element("span", "hc-support-pill hc-support-category", categoryLabels[category]);
  const statusPill = element("span", `hc-support-pill hc-support-status is-${status}`, statusLabels[status]);
  const reference = element("span", "hc-support-time hc-incident-reference", `CASE-${String(dispute.disputeId).slice(0, 8).toUpperCase()}`);
  row.append(copy, categoryPill, statusPill, reference);
  return row;
}

function openIncidentGuidance() {
  if (typeof dialog?.showModal === "function") dialog.showModal();
  else if (dialog) dialog.hidden = false;
}

createCleanerPage("incident-reports", async ({ requestJson }) => {
  document.querySelector("[data-incident-new]")?.addEventListener("click", openIncidentGuidance);
  document.querySelector("[data-incident-dialog-close]")?.addEventListener("click", () => {
    if (typeof dialog?.close === "function") dialog.close();
    else if (dialog) dialog.hidden = true;
  });

  const result = await requestJson("/api/marketplace/bookings?limit=50");
  const bookings = (Array.isArray(result.bookings) ? result.bookings : [])
    .filter((booking) => uuidPattern.test(String(booking?.bookingId)));
  const bookingById = new Map(bookings.map((booking) => [booking.bookingId, booking]));
  const responses = await Promise.allSettled(
    bookings.map((booking) => requestJson(`/api/marketplace/bookings/${booking.bookingId}/dispute`))
  );
  const incidents = responses
    .filter((response) => response.status === "fulfilled" && response.value?.dispute)
    .map((response) => response.value.dispute)
    .filter((dispute) => uuidPattern.test(String(dispute.bookingId)) && uuidPattern.test(String(dispute.disputeId)) && incidentCategories.has(dispute.category))
    .map((dispute) => ({ dispute, booking: bookingById.get(dispute.bookingId) }))
    .sort((left, right) => new Date(right.dispute.createdAt || 0) - new Date(left.dispute.createdAt || 0));

  list.replaceChildren(...incidents.map(renderIncident));
  empty.hidden = incidents.length !== 0;
  const failed = responses.filter((response) => response.status === "rejected").length;
  partial.hidden = failed === 0;
  if (failed) partial.textContent = "Some incident updates could not be loaded. Refresh before relying on this list.";
});
