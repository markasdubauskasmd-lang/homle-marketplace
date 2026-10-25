import assert from "node:assert/strict";
import { availabilityWindowBooked, occupyingBookingStatuses } from "../public/cleaner-availability-model.js";

const window_ = { availabilityId: "a", status: "available", startAt: "2026-11-02T09:00:00.000Z", endAt: "2026-11-02T13:00:00.000Z" };
const booking = (status, start = "2026-11-02T10:00:00.000Z", end = "2026-11-02T12:00:00.000Z") => ({ status, scheduledStartAt: start, scheduledEndAt: end });

// The defect: the page branched on an availability status nothing writes, so a
// window with a confirmed job inside it still offered "Remove".
assert.equal(availabilityWindowBooked(window_, [booking("confirmed")]), true, "A confirmed job inside the window did not mark it booked.");
for (const status of occupyingBookingStatuses) assert.equal(availabilityWindowBooked(window_, [booking(status)]), true, `${status} does not occupy the window.`);
for (const status of ["cancelled", "completed", "cleaner-declined", "expired", "disputed"]) assert.equal(availabilityWindowBooked(window_, [booking(status)]), false, `${status} still marks the window booked.`);

// Overlap, not containment; touching edges do not overlap.
assert.equal(availabilityWindowBooked(window_, [booking("confirmed", "2026-11-02T12:30:00.000Z", "2026-11-02T15:00:00.000Z")]), true);
assert.equal(availabilityWindowBooked(window_, [booking("confirmed", "2026-11-02T13:00:00.000Z", "2026-11-02T15:00:00.000Z")]), false);
assert.equal(availabilityWindowBooked(window_, [booking("confirmed", "2026-11-03T10:00:00.000Z", "2026-11-03T12:00:00.000Z")]), false);

// The original signal still counts, and bad data never marks a window booked.
assert.equal(availabilityWindowBooked({ ...window_, status: "held" }, []), true);
assert.equal(availabilityWindowBooked(window_, [booking("confirmed", "not a date", "also not")]), false);
assert.equal(availabilityWindowBooked(window_, null), false);
assert.equal(availabilityWindowBooked({ ...window_, startAt: "bad" }, [booking("confirmed")]), false);

console.log("Cleaner availability model passed: a window shows Booked from the bookings that occupy it, by overlap, using the server's occupying statuses.");
