import { readFile } from "node:fs/promises";
import { bookingSummaryBuckets, bookingSummaryPrimaryAction, bookingSummaryPriceLabel, formatBookingMoney, formatBookingWindow } from "../public/booking-summary-model.js";

function assert(condition, message) { if (!condition) throw new Error(message); }

const bookingId = "55555555-5555-4555-8555-555555555555";
const common = { bookingId, scheduledStartAt: "2026-07-20T09:00:00.000Z", scheduledEndAt: "2026-07-20T12:00:00.000Z", pricePence: 7500, propertyArea: "SW1A", taskCount: 4 };
const cleanerRecords = [
  { ...common, participantRole: "cleaner", status: "pending-cleaner-acceptance", canRespond: true },
  { ...common, bookingId: "66666666-6666-4666-8666-666666666666", participantRole: "cleaner", status: "cleaning-in-progress", activeJobAvailable: true },
  { ...common, bookingId: "77777777-7777-4777-8777-777777777777", participantRole: "cleaner", status: "completed", activeJobAvailable: true }
];
const landlordRecords = [{ ...common, participantRole: "landlord", status: "confirmed", pricePence: 12000, paymentStepAvailable: true, activeJobAvailable: true }];
const cleanerBuckets = bookingSummaryBuckets(cleanerRecords, "cleaner");
const landlordBuckets = bookingSummaryBuckets(landlordRecords, "landlord");
assert(cleanerBuckets.pending.length === 1 && cleanerBuckets.active.length === 1 && cleanerBuckets.history.length === 1, "Cleaner bookings were grouped into the wrong dashboard sections.");
assert(landlordBuckets.upcoming.length === 1 && landlordBuckets.pending.length === 0, "Landlord bookings were grouped into the wrong dashboard sections.");
assert(bookingSummaryPrimaryAction(cleanerRecords[0], "cleaner").kind === "respond" && bookingSummaryPrimaryAction(cleanerRecords[1], "cleaner").kind === "active-job", "Cleaner booking actions do not follow the lifecycle.");
assert(bookingSummaryPrimaryAction({ ...common, participantRole: "landlord", status: "confirmed", paymentStepAvailable: true, activeJobAvailable: false }, "landlord").kind === "payment", "A confirmed Landlord booking did not offer its payment step.");
assert(bookingSummaryPriceLabel("cleaner") === "Your agreed pay" && bookingSummaryPriceLabel("landlord") === "Your booking total", "Participant prices are not labelled from each side's perspective.");
assert(formatBookingMoney(7500) === "£75.00" && formatBookingWindow(common.scheduledStartAt, common.scheduledEndAt).includes("10:00–13:00"), "Dashboard money or London visit times were formatted incorrectly.");

const [cleanerPage, cleanerScript, landlordPage, landlordScript, model, server, authEntry, migration, grants, packageFile] = await Promise.all([
  readFile(new URL("../public/cleaner-dashboard.html", import.meta.url), "utf8"),
  readFile(new URL("../public/cleaner-dashboard.js", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-dashboard.html", import.meta.url), "utf8"),
  readFile(new URL("../public/landlord-dashboard.js", import.meta.url), "utf8"),
  readFile(new URL("../public/booking-summary-model.js", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8"),
  readFile(new URL("../public/auth-entry.js", import.meta.url), "utf8"),
  readFile(new URL("../db/migrations/026_participant_booking_summaries.sql", import.meta.url), "utf8"),
  readFile(new URL("../db/runtime-role-grants.sql", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8")
]);

for (const copy of ["Cleaner dashboard", "Pending requests", "Active jobs", "Upcoming jobs"]) assert(cleanerPage.includes(copy), `The Cleaner dashboard omitted ${copy}.`);
for (const copy of ["Accept request", "Decline this request?"]) assert(`${cleanerPage}\n${cleanerScript}`.includes(copy), `The Cleaner dashboard controls omitted ${copy}.`);
assert(cleanerScript.includes('requestJson("/api/marketplace/bookings?limit=50")') && cleanerScript.includes("/response") && cleanerScript.includes('respondToBooking(booking.bookingId, "accept"') && cleanerScript.includes('respondToBooking(selectedDeclineBookingId, "decline"'), "The Cleaner dashboard is not connected to real participant bookings and invitation decisions.");
assert(cleanerScript.includes('"X-CSRF-Token"') && cleanerScript.includes("credentials: \"same-origin\"") && cleanerScript.includes("globalThis.confirm") && !cleanerScript.includes("innerHTML"), "Cleaner decisions lost session/CSRF/confirmation protection or safe rendering.");
assert(cleanerScript.includes("pricePence") && cleanerScript.includes("private marketplace pricing was exposed") && model.includes("Your agreed pay"), "The Cleaner interface does not enforce its own-pay-only presentation boundary.");
assert(cleanerScript.includes("Review private room scan") && cleanerScript.includes("booking.cleaningRequestId") && cleanerScript.includes("/scan`") && cleanerScript.includes("/photos/${encodeURIComponent(photo.photoId)}/access") && cleanerScript.includes("exact address and access details remain hidden"), "An invited Cleaner cannot review the consented room-scan handoff without exposing protected property details.");
assert(cleanerPage.includes("data-cleaner-next") && cleanerPage.includes("Do this next") && cleanerScript.includes("function renderNextAction(buckets, payout)") && cleanerScript.includes('link.textContent = "Review request"') && cleanerScript.includes('link.textContent = active ? "Open active job" : "View job checklist"') && cleanerScript.includes('link.href = "/cleaner/payouts"'), "The Cleaner dashboard makes the Cleaner search multiple sections instead of presenting one role-relevant next action.");
assert(landlordPage.includes("Active and upcoming bookings") && landlordPage.includes("Confirmed records only") && landlordScript.includes('requestJson("/api/marketplace/bookings?limit=50")'), "The Landlord workspace is not connected to participant booking summaries.");
assert(landlordScript.includes("/booking-payment?bookingId=") && landlordScript.includes("/bookings/${booking.bookingId}") && model.includes("Your booking total") && !landlordScript.includes("cleanerPayPence"), "Landlord booking cards lost live/payment links or exposed Cleaner pay.");
assert(server.includes('"/cleaner/dashboard": "cleaner-dashboard.html"') && authEntry.includes('return "/cleaner/dashboard"'), "Cleaner sign-in does not land in the real dashboard route.");
assert(migration.includes("booking.landlord_user_id = actor_id OR booking.cleaner_user_id = actor_id") && migration.includes("CASE WHEN booking.landlord_user_id = actor_id THEN booking.customer_price_pence ELSE booking.cleaner_pay_pence END") && migration.includes("REVOKE ALL"), "The database does not own participant isolation and role-specific price projection.");
assert(!migration.includes("address_line_1") && !migration.includes("access_instructions") && !migration.includes("cleaner_pay_pence',") && grants.includes("list_my_booking_summaries(integer)"), "Booking summaries expose protected visit details, a separately named Cleaner-pay field or lack restricted execution.");
assert(packageFile.includes("tests/booking-dashboard-ui.mjs"), "Booking-dashboard verification is not part of the project gate.");

console.log("Booking dashboard UI tests passed: one-next-action guidance, participant jobs, Cleaner decisions, role-specific prices, live/payment links and mobile workspace handoff.");
