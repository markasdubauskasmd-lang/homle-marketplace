const mapped = Object.freeze({
  "administrator-required": [403, "administrator-required", "A Homle Administrator account is required."],
  "invalid-booking-operation-view": [422, "invalid-booking-operation-view", "Choose a valid booking operations view."],
  "invalid-booking-operation-page": [422, "invalid-booking-operation-page", "The booking operations page is invalid."]
});

function mapError(error) {
  const selected = mapped[error?.message];
  return selected ? Object.assign(new Error(selected[2]), { statusCode: selected[0], code: selected[1], cause: error }) : error;
}

export function createAdministratorBookingRepository(database) {
  if (!database || typeof database.withUserTransaction !== "function") throw new TypeError("The marketplace database boundary is required.");
  return Object.freeze({
    list(actor, input) {
      return database.withUserTransaction(actor, async (client) => {
        try {
          const result = await client.query("SELECT tideway_private.list_administrator_booking_operations($1::text,$2::integer,$3::integer) AS result", [input.view, input.limit, input.offset]);
          return result.rows[0]?.result;
        } catch (error) { throw mapError(error); }
      });
    }
  });
}
