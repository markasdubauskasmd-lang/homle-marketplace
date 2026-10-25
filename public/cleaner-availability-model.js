// The booking statuses that occupy a Cleaner's time. Migration 028 refuses an
// overlapping invitation while a booking is in any of these, so this is the
// same rule the server enforces, read from the booking rather than from an
// availability status nothing ever writes.
export const occupyingBookingStatuses = Object.freeze(new Set([
  "pending-cleaner-acceptance", "confirmed", "cleaner-en-route", "cleaner-arrived", "cleaning-in-progress", "awaiting-review"
]));

function instant(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

// Whether a booking the Cleaner holds overlaps this availability window. A
// window still marked `held` (the original, never-written signal) counts too.
export function availabilityWindowBooked(window_, bookings = []) {
  if (window_?.status === "held") return true;
  const start = instant(window_?.startAt);
  const end = instant(window_?.endAt);
  if (start === null || end === null) return false;
  return (Array.isArray(bookings) ? bookings : []).some((booking) => {
    if (!occupyingBookingStatuses.has(booking?.status)) return false;
    const bookingStart = instant(booking.scheduledStartAt);
    const bookingEnd = instant(booking.scheduledEndAt);
    return bookingStart !== null && bookingEnd !== null && bookingStart < end && bookingEnd > start;
  });
}
