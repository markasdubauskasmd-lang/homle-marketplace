function mapMessageError(error) {
  const errors = {
    "booking-not-found": [404, "booking-not-found", "The booking was not found."],
    "booking-messaging-closed": [409, "booking-messaging-closed", "Messaging is not available at this booking stage."],
    "invalid-booking-message": [422, "invalid-booking-message", "The booking message is invalid or contains contact details."],
    "invalid-message-cursor": [422, "invalid-message-cursor", "The message page cursor is invalid."],
    "message-idempotency-conflict": [409, "message-idempotency-conflict", "This message retry key was already used for different content."],
    "message-rate-limited": [429, "message-rate-limited", "Too many messages were sent. Wait before trying again."]
  };
  const selected = errors[error?.message];
  return selected ? Object.assign(new Error(selected[2]), { statusCode: selected[0], code: selected[1], cause: error }) : error;
}

export function createMessageRepository(database) {
  if (!database || typeof database.withUserTransaction !== "function") throw new TypeError("The marketplace database boundary is required.");
  async function call(actor, queryText, values) {
    return database.withUserTransaction(actor, async (client) => {
      try { return (await client.query(queryText, values)).rows[0]?.result; }
      catch (error) { throw mapMessageError(error); }
    });
  }
  return Object.freeze({
    sendMessage(actor, bookingId, input) {
      return call(actor, "SELECT tideway_private.send_booking_message($1::uuid,$2::uuid,$3::uuid,$4::text) AS result", [bookingId, input.messageId, input.clientMessageId, input.body]);
    },
    listMessages(actor, bookingId, input) {
      return call(actor, "SELECT tideway_private.get_booking_messages($1::uuid,$2::timestamptz,$3::uuid,$4::integer) AS result", [bookingId, input.beforeCreatedAt, input.beforeMessageId, input.limit]);
    }
  });
}
