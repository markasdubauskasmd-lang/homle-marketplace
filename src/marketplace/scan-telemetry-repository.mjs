// Database boundary for anonymous scanner operations telemetry. The SQL
// function accepts only a fixed aggregate vocabulary; this module never sees
// a photo, room, object label, note, identity or marketplace record id.
export function createScanTelemetryRepository(database) {
  if (!database || typeof database.withAuthenticationTransaction !== "function" || typeof database.withUserTransaction !== "function") {
    throw new TypeError("The marketplace database boundary is required.");
  }
  return Object.freeze({
    recordBatch(events) {
      return database.withAuthenticationTransaction(async (client) => {
        const result = await client.query(
          "SELECT tideway_private.record_scan_telemetry_batch($1::jsonb) AS recorded",
          [JSON.stringify(events)]
        );
        return Number(result.rows[0]?.recorded) || 0;
      });
    },
    snapshot(actor, windowDays = 30) {
      return database.withUserTransaction(actor, async (client) => {
        const result = await client.query(
          "SELECT tideway_private.get_administrator_scan_telemetry($1::integer) AS snapshot",
          [windowDays]
        );
        return result.rows[0]?.snapshot ?? { counters: {}, timings: {} };
      });
    }
  });
}
