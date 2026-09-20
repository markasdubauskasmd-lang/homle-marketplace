import { uuidPattern } from "./validation.mjs";

const mapped = Object.freeze({
  "administrator-required": [403, "administrator-required", "A Homle Administrator account is required."],
  "invalid-expiry-batch-limit": [422, "invalid-expiry-batch-limit", "Choose a supported expiry batch size."],
  "booking-not-found": [404, "booking-not-found", "That booking could not be found."]
});

function mapError(error) {
  const selected = mapped[error?.message];
  return selected ? Object.assign(new Error(selected[2]), { statusCode: selected[0], code: selected[1], cause: error }) : error;
}

function timestamp(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`${label} is unavailable.`);
  return new Date(value).toISOString();
}

/**
 * One booking past its payment deadline.
 *
 * `paymentId` is the half-finished attempt, if any, that still holds a live
 * provider intent. Null means nothing was ever started and there is no hold to
 * release before the booking is ended.
 */
function expirableBooking(record) {
  if (!record || typeof record !== "object" || !uuidPattern.test(record.bookingId || "")) throw new Error("An expirable booking record is unavailable.");
  const paymentId = record.paymentId == null ? null : String(record.paymentId);
  if (paymentId !== null && !uuidPattern.test(paymentId)) throw new Error("An expirable booking payment reference is unavailable.");
  return Object.freeze({
    bookingId: record.bookingId,
    scheduledStartAt: timestamp(record.scheduledStartAt, "Booking start time"),
    paymentId
  });
}

export function createUnpaidBookingRepository(database) {
  if (!database || typeof database.withUserTransaction !== "function") throw new TypeError("The marketplace database boundary is required.");
  return Object.freeze({
    async listExpirable(actor, limit = 100) {
      return database.withUserTransaction(actor, async (client) => {
        try {
          const result = await client.query(
            "SELECT tideway_private.list_unpaid_bookings_for_expiry($1::integer) AS bookings",
            [limit]
          );
          const records = result.rows[0]?.bookings;
          if (!Array.isArray(records)) throw new Error("The unpaid-booking queue is unavailable.");
          return Object.freeze(records.map(expirableBooking));
        } catch (error) { throw mapError(error); }
      });
    },
    async expire(actor, bookingId) {
      return database.withUserTransaction(actor, async (client) => {
        try {
          const result = await client.query(
            "SELECT tideway_private.expire_unpaid_booking($1::uuid) AS outcome",
            [bookingId]
          );
          const outcome = result.rows[0]?.outcome;
          if (!outcome || typeof outcome !== "object" || typeof outcome.expired !== "boolean") throw new Error("The unpaid-booking expiry outcome is unavailable.");
          return Object.freeze({ bookingId: outcome.bookingId, expired: outcome.expired, reason: String(outcome.reason || "") });
        } catch (error) { throw mapError(error); }
      });
    }
  });
}
