const mapped = Object.freeze({
  "landlord-required": [403, "landlord-required", "A Homle Landlord account is required."]
});

function mapError(error) {
  const selected = mapped[error?.message];
  return selected ? Object.assign(new Error(selected[2]), { statusCode: selected[0], code: selected[1], cause: error }) : error;
}

export function createLandlordCareRepository(database) {
  if (!database || typeof database.withUserTransaction !== "function") throw new TypeError("The marketplace database boundary is required.");
  return Object.freeze({
    get(actor) {
      return database.withUserTransaction(actor, async (client) => {
        try {
          const result = await client.query(
            "SELECT tideway_private.get_landlord_care_summary() AS result"
          );
          return result.rows[0]?.result;
        } catch (error) { throw mapError(error); }
      });
    }
  });
}
