// The narrow database boundary for saved cards (migration 136). Every call is
// one SECURITY DEFINER function; nothing here reads the private table.

const mappedErrors = Object.freeze({
  "landlord-required": [403, "landlord-required", "A Landlord account is required to save a card for this booking."],
  "administrator-required": [403, "administrator-required", "Only the platform can use a saved card."],
  "payment-role-required": [403, "payment-role-required", "This account cannot read this booking's payment."],
  "booking-not-found": [404, "booking-not-found", "The booking was not found."],
  "booking-not-authorizable": [409, "booking-not-authorizable", "This booking cannot be paid for now."],
  "payment-window-open": [409, "payment-window-open", "This booking's payment window is open, so pay for it directly instead of saving a card."],
  "booking-payment-exists": [409, "booking-payment-exists", "This booking already has a payment."],
  "saved-card-not-found": [404, "saved-card-not-found", "No card has been saved for this booking."],
  "saved-card-conflict": [409, "saved-card-conflict", "A different card setup is already recorded for this booking."],
  "saved-card-in-use": [409, "saved-card-in-use", "The saved card is already being used for this booking's payment."],
  "saved-card-not-ready": [409, "saved-card-not-ready", "The saved card is not ready to use."],
  "saved-card-not-authorizing": [409, "saved-card-not-authorizing", "The saved card is not being used."],
  "saved-card-consent-stale": [409, "saved-card-consent-stale", "The booking total or terms changed after the card was saved."],
  "invalid-saved-card": [422, "invalid-saved-card", "The saved-card state is invalid."],
  "invalid-payment-request": [422, "invalid-payment-request", "The payment request is invalid."],
  "invalid-provider-authorization": [422, "invalid-provider-authorization", "The provider authorization is invalid."],
  "invalid-saved-card-batch-limit": [422, "invalid-saved-card-batch-limit", "The saved-card batch limit is invalid."]
});

function mapError(error) {
  const selected = mappedErrors[error?.message];
  if (!selected) return error;
  return Object.assign(new Error(selected[2]), { statusCode: selected[0], code: selected[1], cause: error });
}

export function createSavedCardRepository(database) {
  if (!database || typeof database.withUserTransaction !== "function") throw new TypeError("The marketplace database boundary is required.");
  const call = (actor, sql, values) => database.withUserTransaction(actor, async (client) => {
    try {
      const result = await client.query(sql, values);
      return result.rows;
    } catch (error) { throw mapError(error); }
  });
  const single = async (actor, sql, values) => (await call(actor, sql, values))[0]?.result ?? null;
  return Object.freeze({
    begin: (actor, bookingId) => single(actor, "SELECT tideway_private.begin_booking_saved_card($1::uuid) AS result", [bookingId]),
    record: (actor, bookingId, input) => single(actor,
      "SELECT tideway_private.record_booking_saved_card($1::uuid,$2::text,$3::text,$4::text,$5::text) AS result",
      [bookingId, input.customerId, input.setupId, input.status, input.paymentMethodId ?? null]),
    get: (actor, bookingId) => single(actor, "SELECT tideway_private.get_booking_saved_card($1::uuid) AS result", [bookingId]),
    withdraw: (actor, bookingId) => single(actor, "SELECT tideway_private.withdraw_booking_saved_card($1::uuid) AS result", [bookingId]),
    async listDue(actor, limit) {
      return (await call(actor, "SELECT booking_id FROM tideway_private.list_saved_cards_due($1::integer)", [limit])).map((row) => row.booking_id);
    },
    beginAuthorization: (actor, input) => single(actor,
      "SELECT tideway_private.begin_saved_card_authorization($1::uuid,$2::uuid,$3::bytea) AS result",
      [input.bookingId, input.paymentId, input.idempotencyKeyHash]),
    recordAuthorization: (actor, bookingId, status) => single(actor,
      "SELECT tideway_private.record_saved_card_authorization($1::uuid,$2::text) AS result", [bookingId, status])
  });
}
