import { bookingSummaryBuckets, bookingSummaryStatusLabels, formatBookingMoney, formatBookingWindow } from "./booking-summary-model.js?v=20260723-3";
import { createCleanerPage, element, requestJson, setText } from "./cleaner-page.js?v=20260728-1";

// A job can be signed off once it is under way. The sign-off screen itself is the shared
// active-job page, which already owns the checklist, photo capture and finish gate.
const signOffStatuses = ["cleaner-en-route", "cleaner-arrived", "cleaning-in-progress", "awaiting-review"];

function jobCard(booking, actionLabel) {
  const card = element("article", "hc-job");
  const top = element("div", "hc-job-top");
  const head = element("div", "hc-job-head");
  const title = element("a", "hc-job-title", booking.cleaningType || "Cleaning");
  title.href = `/bookings/${booking.bookingId}`;
  head.append(title, element("p", "hc-job-addr", formatBookingWindow(booking.scheduledStartAt, booking.scheduledEndAt)));
  const chips = element("div", "hc-job-chips");
  chips.append(
    element("span", "hc-chip hc-chip-slot", bookingSummaryStatusLabels[booking.status] || "Booking"),
    element("span", "hc-chip", `${booking.taskCount} ${booking.taskCount === 1 ? "task" : "tasks"}`)
  );
  head.append(chips);
  const pay = element("div", "hc-job-pay");
  pay.append(element("div", "hc-job-pay-amount", formatBookingMoney(booking.pricePence)));
  top.append(head, pay);
  card.append(top);

  const foot = element("div", "hc-job-foot");
  const open = element("a", "hc-btn", actionLabel);
  open.href = `/bookings/${booking.bookingId}`;
  const detail = element("a", "hc-job-link", "View details →");
  detail.href = `/cleaner/jobs/${booking.bookingId}`;
  foot.append(open, detail);
  card.append(foot);
  return card;
}

createCleanerPage("signoff", async () => {
  const result = await requestJson("/api/marketplace/bookings?limit=50");
  const bookings = Array.isArray(result.bookings) ? result.bookings : [];
  const buckets = bookingSummaryBuckets(bookings, "cleaner");

  const ready = bookings.filter((booking) => signOffStatuses.includes(booking.status));
  setText("[data-signoff-count]", String(ready.length));
  const readyEmpty = document.querySelector("[data-signoff-empty]");
  if (readyEmpty) readyEmpty.hidden = ready.length > 0;
  const readyHost = document.querySelector("[data-signoff-list]");
  if (readyHost) readyHost.replaceChildren(...ready.map((booking) => jobCard(booking, "Open sign-off ↗")));

  const upcoming = buckets.upcoming.filter((booking) => !signOffStatuses.includes(booking.status));
  const upcomingEmpty = document.querySelector("[data-signoff-upcoming-empty]");
  if (upcomingEmpty) upcomingEmpty.hidden = upcoming.length > 0;
  const upcomingHost = document.querySelector("[data-signoff-upcoming]");
  if (upcomingHost) upcomingHost.replaceChildren(...upcoming.map((booking) => jobCard(booking, "Open job ↗")));
});
