// Database boundary for anonymous funnel telemetry.
//
// The SQL function accepts only the fixed vocabulary in `funnel-telemetry.mjs`,
// restated at the database so this boundary cannot widen it. Nothing passed
// through here carries an account, session, request or property id, and there
// is no actor to pass: the whole point of the beacon is that it does not know
// who sent it.
export function createFunnelTelemetryRepository(database) {
  if (!database || typeof database.withAuthenticationTransaction !== "function" || typeof database.withUserTransaction !== "function") {
    throw new TypeError("The marketplace database boundary is required.");
  }
  return Object.freeze({
    recordBatch(events) {
      return database.withAuthenticationTransaction(async (client) => {
        const result = await client.query(
          "SELECT tideway_private.record_public_funnel_batch($1::jsonb) AS recorded",
          [JSON.stringify(events)]
        );
        return Number(result.rows[0]?.recorded) || 0;
      });
    },
    snapshot(actor, windowDays = 30) {
      return database.withUserTransaction(actor, async (client) => {
        const result = await client.query(
          "SELECT tideway_private.get_administrator_public_funnel($1::integer) AS snapshot",
          [windowDays]
        );
        return result.rows[0]?.snapshot ?? { windowDays, counters: {}, totals: {} };
      });
    }
  });
}
