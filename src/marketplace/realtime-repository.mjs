function mapRealtimeError(error) {
  const errors = {
    "booking-not-found": [404, "booking-not-found", "The booking was not found."],
    "cleaning-request-not-found": [404, "cleaning-request-not-found", "The cleaning request was not found."],
    "account-inactive": [403, "account-inactive", "This account cannot receive booking updates."],
    "invalid-realtime-cursor": [422, "invalid-realtime-cursor", "The real-time event cursor is invalid."],
    "invalid-request-realtime-cursor": [422, "invalid-realtime-cursor", "The real-time event cursor is invalid."]
  };
  const selected = errors[error?.message];
  return selected ? Object.assign(new Error(selected[2]), { statusCode: selected[0], code: selected[1], cause: error }) : error;
}

export function createRealtimeRepository(database) {
  if (!database || typeof database.withUserTransaction !== "function") throw new TypeError("The marketplace database boundary is required.");
  return Object.freeze({
    getSnapshot(actor, bookingId, afterEventId, limit = 100) {
      return database.withUserTransaction(actor, async (client) => {
        try { return (await client.query("SELECT tideway_private.get_booking_realtime_snapshot($1::uuid,$2::bigint,$3::integer) AS snapshot", [bookingId, afterEventId, limit])).rows[0]?.snapshot; }
        catch (error) { throw mapRealtimeError(error); }
      });
    },
    getRequestSnapshot(actor, requestId, afterEventId, limit = 100) {
      return database.withUserTransaction(actor, async (client) => {
        try { return (await client.query("SELECT tideway_private.get_cleaning_request_realtime_snapshot($1::uuid,$2::bigint,$3::integer) AS snapshot", [requestId, afterEventId, limit])).rows[0]?.snapshot; }
        catch (error) { throw mapRealtimeError(error); }
      });
    }
  });
}
