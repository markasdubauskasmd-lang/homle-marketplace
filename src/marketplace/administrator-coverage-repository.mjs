const mapped = Object.freeze({
  "administrator-required": [403, "administrator-required", "A Homle Administrator account is required."],
  "invalid-coverage-window": [422, "invalid-coverage-window", "Choose a supported coverage window."],
  "invalid-payout-readiness-filter": [500, "coverage-configuration-invalid", "The coverage report configuration is unavailable."]
});

function mapError(error) {
  const selected = mapped[error?.message];
  return selected ? Object.assign(new Error(selected[2]), { statusCode: selected[0], code: selected[1], cause: error }) : error;
}

export function createAdministratorCoverageRepository(database, options = {}) {
  if (!database || typeof database.withUserTransaction !== "function") throw new TypeError("The marketplace database boundary is required.");
  if (typeof options.requirePayoutReady !== "boolean") throw new TypeError("Administrator coverage requires an explicit payment-mode boundary.");
  return Object.freeze({
    get(actor, input) {
      return database.withUserTransaction(actor, async (client) => {
        try {
          const result = await client.query(
            "SELECT tideway_private.get_administrator_coverage_report($1::integer,$2::boolean) AS result",
            [input.windowDays, options.requirePayoutReady]
          );
          return result.rows[0]?.result;
        } catch (error) { throw mapError(error); }
      });
    }
  });
}
