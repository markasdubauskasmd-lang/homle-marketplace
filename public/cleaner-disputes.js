import { createCleanerPage, element } from "./cleaner-page.js?v=20260729-11";

const statusLabels = {
  open: "Open",
  reviewing: "Under review",
  resolved: "Resolved",
  closed: "Closed"
};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const list = document.querySelector("[data-dispute-list]");
const empty = document.querySelector("[data-dispute-empty]");
const partial = document.querySelector("[data-dispute-status]");

function disputeDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function disputeTitle(value) {
  const title = String(value || "").replace(/\s+/g, " ").trim();
  if (!title) return "Booking issue";
  return title.length > 72 ? `${title.slice(0, 69)}…` : title;
}

function renderDispute({ dispute, booking }) {
  const status = statusLabels[dispute.status] ? dispute.status : "open";
  const row = element("a", "hc-support-row hc-dispute-row");
  row.href = `/bookings/${encodeURIComponent(dispute.bookingId)}`;
  row.setAttribute("aria-label", `Open dispute: ${disputeTitle(dispute.description)}`);

  const copy = element("span", "hc-support-copy hc-dispute-copy");
  copy.append(
    element("strong", "", disputeTitle(dispute.description)),
    element("small", "", `${booking?.counterpartyName || "Landlord"} · ${booking?.propertyName || "Cleaning booking"} · ${disputeDate(dispute.createdAt)}`)
  );
  const statusPill = element("span", `hc-support-pill hc-support-status is-${status}`, statusLabels[status]);
  const updated = element("time", "hc-support-time hc-dispute-date", disputeDate(dispute.resolvedAt || dispute.createdAt));
  if (dispute.createdAt) updated.dateTime = dispute.resolvedAt || dispute.createdAt;
  row.append(copy, statusPill, updated);
  return row;
}

createCleanerPage("disputes", async ({ requestJson }) => {
  const result = await requestJson("/api/marketplace/bookings?limit=50");
  const bookings = (Array.isArray(result.bookings) ? result.bookings : [])
    .filter((booking) => uuidPattern.test(String(booking?.bookingId)));
  const bookingById = new Map(bookings.map((booking) => [booking.bookingId, booking]));
  const responses = await Promise.allSettled(
    bookings.map((booking) => requestJson(`/api/marketplace/bookings/${booking.bookingId}/dispute`))
  );
  const disputes = responses
    .filter((response) => response.status === "fulfilled" && response.value?.dispute?.openedByRole === "landlord")
    .map((response) => response.value.dispute)
    .filter((dispute) => uuidPattern.test(String(dispute.bookingId)) && uuidPattern.test(String(dispute.disputeId)))
    .map((dispute) => ({ dispute, booking: bookingById.get(dispute.bookingId) }))
    .sort((left, right) => new Date(right.dispute.createdAt || 0) - new Date(left.dispute.createdAt || 0));

  list.replaceChildren(...disputes.map(renderDispute));
  empty.hidden = disputes.length !== 0;
  const failed = responses.filter((response) => response.status === "rejected").length;
  partial.hidden = failed === 0;
  if (failed) partial.textContent = "Some dispute updates could not be loaded. Refresh before relying on this list.";
});
