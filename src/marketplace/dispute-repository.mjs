function mapDisputeError(error) {
  const errors = {
    "booking-not-found": [404, "booking-not-found", "The booking was not found or is not available to this account."],
    "dispute-not-found": [404, "dispute-not-found", "The booking case was not found."],
    "booking-not-disputable": [409, "booking-not-disputable", "A case cannot be opened at this stage of the booking."],
    "booking-dispute-state-invalid": [409, "booking-dispute-state-invalid", "The booking is no longer in the expected case-review state."],
    "dispute-already-final": [409, "dispute-already-final", "This booking case already has a final decision."],
    "invalid-booking-dispute": [422, "invalid-booking-dispute", "The booking case details are invalid."],
    "invalid-dispute-status": [422, "invalid-dispute-status", "The booking-case status filter is invalid."],
    "invalid-dispute-page": [422, "invalid-dispute-page", "The booking-case page is invalid."],
    "invalid-dispute-decision": [422, "invalid-dispute-decision", "The booking-case decision is invalid."],
    "invalid-dispute-resolution": [422, "invalid-dispute-resolution", "The booking-case resolution is incomplete or invalid."]
  };
  const selected = errors[error?.message];
  return selected ? Object.assign(new Error(selected[2]), { statusCode: selected[0], code: selected[1], cause: error }) : error;
}

export function createDisputeRepository(database) {
  if (!database || typeof database.withUserTransaction !== "function") throw new TypeError("The marketplace database boundary is required.");
  async function privateCall(actor, queryText, values) {
    return database.withUserTransaction(actor, async (client) => {
      try { return (await client.query(queryText, values)).rows[0]?.result; }
      catch (error) { throw mapDisputeError(error); }
    });
  }
  return Object.freeze({
    open(actor, input) {
      return privateCall(actor, "SELECT tideway_private.open_booking_dispute($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text) AS result", [input.bookingId, input.disputeId, input.requestId, input.category, input.description]);
    },
    getForBooking(actor, bookingId) {
      return privateCall(actor, "SELECT tideway_private.get_booking_dispute($1::uuid) AS result", [bookingId]);
    },
    listForAdministrator(actor, input) {
      return privateCall(actor, "SELECT tideway_private.list_admin_booking_disputes($1::text,$2::integer,$3::integer) AS result", [input.status, input.limit, input.offset]);
    },
    review(actor, disputeId, input) {
      return privateCall(actor, "SELECT tideway_private.review_booking_dispute($1::uuid,$2::text,$3::text,$4::text) AS result", [disputeId, input.status, input.resolutionNote, input.resolutionOutcome]);
    }
  });
}
