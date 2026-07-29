import { bookingSummaryBuckets, bookingSummaryStatusLabels, formatBookingMoney } from "./booking-summary-model.js?v=20260723-3";
import { createCleanerPage, element, requestJson, setText } from "./cleaner-page.js?v=20260729-6";

const dayFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short" });
const dayNumFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric" });

createCleanerPage("map", async () => {
  const result = await requestJson("/api/marketplace/bookings?limit=50");
  const bookings = Array.isArray(result.bookings) ? result.bookings : [];
  const buckets = bookingSummaryBuckets(bookings, "cleaner");
  const plottable = [...buckets.pending, ...buckets.active, ...buckets.upcoming];

  setText("[data-map-count]", String(plottable.length));
  const empty = document.querySelector("[data-map-empty]");
  if (empty) empty.hidden = plottable.length > 0;

  const host = document.querySelector("[data-map-list]");
  if (!host) return;
  host.replaceChildren(...plottable.map((booking) => {
    const card = element("article", "hc-job");
    const top = element("div", "hc-job-top");
    const start = booking.scheduledStartAt ? new Date(booking.scheduledStartAt) : null;
    const valid = start && Number.isFinite(start.getTime());

    const date = element("div", "hc-job-date");
    date.append(
      element("span", "hc-job-day", valid ? dayFormat.format(start).toUpperCase() : "TBC"),
      element("span", "hc-job-dnum", valid ? dayNumFormat.format(start) : "—")
    );

    const head = element("div", "hc-job-head");
    const title = element("a", "hc-job-title", booking.cleaningType || "Cleaning");
    title.href = `/cleaner/jobs/${booking.bookingId}`;
    head.append(title, element("p", "hc-job-addr", booking.propertyArea || "Area shared after confirmation"));
    const chips = element("div", "hc-job-chips");
    chips.append(element("span", "hc-chip", bookingSummaryStatusLabels[booking.status] || "Booking"));
    head.append(chips);

    const pay = element("div", "hc-job-pay");
    pay.append(element("div", "hc-job-pay-amount", formatBookingMoney(booking.pricePence)));
    top.append(date, head, pay);
    card.append(top);
    return card;
  }));
});
