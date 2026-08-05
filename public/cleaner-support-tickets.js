import { createCleanerPage, element } from "./cleaner-page.js?v=20260729-11";

const categoryLabels = {
  quality: "Quality",
  damage: "Damage",
  access: "Access",
  safety: "Safety",
  conduct: "Conduct",
  payment: "Payments",
  other: "Other"
};

const categoryTitles = {
  quality: "Cleaning quality case",
  damage: "Damage case",
  access: "Property access case",
  safety: "Safety case",
  conduct: "Conduct case",
  payment: "Payment case",
  other: "Booking support case"
};

const statusLabels = {
  open: "Open",
  reviewing: "In review",
  resolved: "Resolved",
  closed: "Closed"
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const list = document.querySelector("[data-support-ticket-list]");
const empty = document.querySelector("[data-support-ticket-empty]");
const partial = document.querySelector("[data-support-ticket-status]");
const dialog = document.querySelector("[data-support-dialog]");

function compactDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const elapsed = Date.now() - date.getTime();
  if (elapsed >= 0 && elapsed < 60 * 60 * 1000) return `${Math.max(1, Math.floor(elapsed / 60000))}m ago`;
  if (elapsed >= 0 && elapsed < 24 * 60 * 60 * 1000) return `${Math.max(1, Math.floor(elapsed / 3600000))}h ago`;
  if (elapsed >= 0 && elapsed < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(elapsed / 86400000)}d ago`;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function renderTicket(dispute) {
  const category = categoryLabels[dispute.category] ? dispute.category : "other";
  const status = statusLabels[dispute.status] ? dispute.status : "open";
  const row = element("a", "hc-support-row");
  row.href = `/bookings/${encodeURIComponent(dispute.bookingId)}`;
  row.setAttribute("aria-label", `Open ${categoryTitles[category]}`);

  const copy = element("span", "hc-support-copy");
  copy.append(
    element("strong", "", categoryTitles[category]),
    element("small", "", dispute.resolutionNote || dispute.description || "Open the booking to review this private case.")
  );

  const categoryPill = element("span", "hc-support-pill hc-support-category", categoryLabels[category]);
  const statusPill = element("span", `hc-support-pill hc-support-status is-${status}`, statusLabels[status]);
  const time = element("time", "hc-support-time", compactDate(dispute.resolvedAt || dispute.createdAt));
  if (dispute.createdAt) time.dateTime = dispute.resolvedAt || dispute.createdAt;
  row.append(copy, categoryPill, statusPill, time);
  return row;
}

function openTicketGuidance() {
  if (typeof dialog?.showModal === "function") dialog.showModal();
  else if (dialog) dialog.hidden = false;
}

createCleanerPage("support-tickets", async ({ requestJson }) => {
  document.querySelector("[data-support-new]")?.addEventListener("click", openTicketGuidance);
  document.querySelector("[data-support-dialog-close]")?.addEventListener("click", () => {
    if (typeof dialog?.close === "function") dialog.close();
    else if (dialog) dialog.hidden = true;
  });

  const result = await requestJson("/api/marketplace/bookings?limit=50");
  const bookingIds = [...new Set((Array.isArray(result.bookings) ? result.bookings : [])
    .map((booking) => booking?.bookingId)
    .filter((bookingId) => uuidPattern.test(String(bookingId))))];

  const responses = await Promise.allSettled(
    bookingIds.map((bookingId) => requestJson(`/api/marketplace/bookings/${bookingId}/dispute`))
  );
  const disputes = responses
    .filter((response) => response.status === "fulfilled" && response.value?.dispute)
    .map((response) => response.value.dispute)
    .filter((dispute) => uuidPattern.test(String(dispute.bookingId)))
    .sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0));

  list.replaceChildren(...disputes.map(renderTicket));
  empty.hidden = disputes.length !== 0;
  const failed = responses.filter((response) => response.status === "rejected").length;
  partial.hidden = failed === 0;
  if (failed) partial.textContent = "Some ticket updates could not be loaded. Refresh before relying on this list.";
});
