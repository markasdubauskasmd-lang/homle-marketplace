export function createSessionPurgeRepository(pool) {
  if (!pool || typeof pool.query !== "function") throw new TypeError("A dedicated Homle worker PostgreSQL pool is required.");

  return Object.freeze({
    async purgeBatch(batchLimit) {
      const result = await pool.query("SELECT * FROM tideway_private.purge_expired_sessions($1::integer)", [batchLimit]);
      const row = result?.rows?.[0];
      return row ? Object.freeze({ deletedCount: Number(row.deleted_count), batchFull: row.batch_full === true }) : null;
    }
  });
}
