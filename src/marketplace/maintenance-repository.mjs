function boundedLimit(value, maximum, label) {
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new TypeError(`${label} is outside the supported range.`);
  return value;
}

function rowsResult(result, limit) {
  const count = Array.isArray(result?.rows) ? result.rows.length : 0;
  if (count > limit) throw new Error("A maintenance function returned more rows than its batch limit.");
  return Object.freeze({ processedCount: count, batchFull: count === limit });
}

function scalarResult(result, limit) {
  const count = Number(result?.rows?.[0]?.processed_count);
  if (!Number.isInteger(count) || count < 0 || count > limit) throw new Error("A maintenance function returned an invalid processed count.");
  return Object.freeze({ processedCount: count, batchFull: count === limit });
}

function uploadRows(result, limit) {
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  if (rows.length > limit) throw new Error("Upload expiry returned more rows than its batch limit.");
  return Object.freeze({
    processedCount: rows.length,
    batchFull: rows.length === limit,
    uploads: Object.freeze(rows.map((row) => Object.freeze({
      uploadId: row.upload_id,
      quarantineStorageKey: row.quarantine_storage_key,
      finalStorageKey: row.final_storage_key
    })))
  });
}

export function createMaintenanceRepository(pool) {
  if (!pool || typeof pool.query !== "function") throw new TypeError("A dedicated Homle worker PostgreSQL pool is required.");
  return Object.freeze({
    async expireInvitations(limit) {
      const selected = boundedLimit(limit, 500, "Invitation expiry batch limit");
      return rowsResult(await pool.query("SELECT * FROM tideway_private.expire_due_cleaner_invitations($1::integer)", [selected]), selected);
    },
    async queuePaymentReadinessReminders(limit) {
      const selected = boundedLimit(limit, 500, "Payment-readiness reminder batch limit");
      return rowsResult(await pool.query("SELECT * FROM tideway_private.queue_due_booking_payment_reminders($1::integer)", [selected]), selected);
    },
    async queueBookingVisitReminders(limit) {
      const selected = boundedLimit(limit, 500, "Booking-visit reminder batch limit");
      return rowsResult(await pool.query("SELECT * FROM tideway_private.queue_due_booking_visit_reminders($1::integer)", [selected]), selected);
    },
    async purgeLocations(limit) {
      const selected = boundedLimit(limit, 1000, "Location purge batch limit");
      return rowsResult(await pool.query("SELECT * FROM tideway_private.purge_expired_cleaner_locations($1::integer)", [selected]), selected);
    },
    async purgeSessions(limit) {
      const selected = boundedLimit(limit, 5000, "Session purge batch limit");
      const result = await pool.query("SELECT * FROM tideway_private.purge_expired_sessions($1::integer)", [selected]);
      const row = result?.rows?.[0];
      const count = Number(row?.deleted_count);
      if (!Number.isInteger(count) || count < 0 || count > selected || typeof row?.batch_full !== "boolean" || row.batch_full !== (count === selected)) throw new Error("Session expiry returned an invalid batch result.");
      return Object.freeze({ processedCount: count, batchFull: row.batch_full });
    },
    async purgeRateLimits(limit) {
      const selected = boundedLimit(limit, 5000, "Rate-limit purge batch limit");
      return scalarResult(await pool.query("SELECT tideway_private.purge_expired_rate_limits($1::integer) AS processed_count", [selected]), selected);
    },
    async purgePendingSocialIdentities(limit) {
      const selected = boundedLimit(limit, 5000, "Pending social-identity purge batch limit");
      return scalarResult(await pool.query("SELECT tideway_private.purge_expired_pending_social_identities($1::integer) AS processed_count", [selected]), selected);
    },
    async expireJobPhotoUploads(limit) {
      const selected = boundedLimit(limit, 1000, "Job-photo expiry batch limit");
      return uploadRows(await pool.query("SELECT * FROM tideway_private.expire_due_job_photo_uploads($1::integer)", [selected]), selected);
    },
    async expireRequestPhotoUploads(limit) {
      const selected = boundedLimit(limit, 1000, "Request-photo expiry batch limit");
      return uploadRows(await pool.query("SELECT * FROM tideway_private.expire_due_request_photo_uploads($1::integer)", [selected]), selected);
    }
  });
}
