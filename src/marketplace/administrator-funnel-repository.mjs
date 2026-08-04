const mapped = Object.freeze({
  "administrator-required": [403, "administrator-required", "A Homle Administrator account is required."],
  "invalid-funnel-window": [422, "invalid-funnel-window", "Choose a supported funnel window."]
});

function mapError(error) {
  const selected = mapped[error?.message];
  return selected ? Object.assign(new Error(selected[2]), { statusCode: selected[0], code: selected[1], cause: error }) : error;
}

export function createAdministratorFunnelRepository(database) {
  if (!database || typeof database.withUserTransaction !== "function") throw new TypeError("The marketplace database boundary is required.");
  return Object.freeze({
    get(actor, input) {
      return database.withUserTransaction(actor, async (client) => {
        try {
          const result = await client.query(
            "SELECT tideway_private.get_administrator_funnel_report($1::integer) AS result",
            [input.windowDays]
          );
          return result.rows[0]?.result;
        } catch (error) { throw mapError(error); }
      });
    }
  });
}
