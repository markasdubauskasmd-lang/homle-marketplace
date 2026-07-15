function mapMediaError(error) {
  const errors = {
    "booking-not-found": [404, "booking-not-found", "The booking was not found."],
    "task-not-found": [404, "task-not-found", "The cleaning task was not found."],
    "photo-not-found": [404, "photo-not-found", "The job photo was not found."],
    "photo-upload-not-found": [404, "photo-upload-not-found", "The photo upload was not found."],
    "invalid-photo-upload": [422, "invalid-photo-upload", "The photo upload details are invalid."],
    "invalid-photo-storage-key": [422, "invalid-photo-storage-key", "The photo storage destination is invalid."],
    "invalid-verified-photo": [422, "invalid-verified-photo", "The processed photo did not pass validation."],
    "invalid-photo-rejection": [422, "invalid-photo-rejection", "The photo rejection reason is invalid."],
    "photo-upload-not-allowed": [409, "photo-upload-not-allowed", "Photos cannot be added at this booking stage."],
    "photo-upload-expired": [409, "photo-upload-expired", "This photo upload has expired. Start a new upload."],
    "photo-upload-completed": [409, "photo-upload-completed", "This photo upload is already complete."]
  };
  const selected = errors[error?.message];
  return selected ? Object.assign(new Error(selected[2]), { statusCode: selected[0], code: selected[1], cause: error }) : error;
}
function upload(row) {
  if (!row) throw new Error("The photo upload record is unavailable.");
  return {
    uploadId: row.id,
    bookingId: row.booking_id,
    taskId: row.task_id || null,
    requestedBy: row.requested_by,
    photoType: row.photo_type,
    quarantineStorageKey: row.quarantine_storage_key,
    finalStorageKey: row.final_storage_key,
    mimeType: row.requested_mime_type,
    byteSize: Number(row.requested_byte_size),
    checksumSha256: row.requested_checksum_hex,
    note: row.note || null,
    status: row.status,
    expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : row.expires_at,
    completedAt: row.completed_at instanceof Date ? row.completed_at.toISOString() : row.completed_at || null
  };
}

export function createMediaRepository(database) {
  if (!database || typeof database.withUserTransaction !== "function") throw new TypeError("The marketplace database boundary is required.");

  async function transact(actor, operation) {
    return database.withUserTransaction(actor, async (client) => {
      try { return await operation(client); } catch (error) { throw mapMediaError(error); }
    });
  }

  const uploadColumns = "id,booking_id,task_id,requested_by,photo_type,quarantine_storage_key,final_storage_key,requested_mime_type,requested_byte_size,encode(requested_checksum_sha256,'hex') AS requested_checksum_hex,note,status,expires_at,completed_at";
  return Object.freeze({
    createUploadIntent(actor, input) {
      return transact(actor, async (client) => upload((await client.query(
        `SELECT ${uploadColumns} FROM tideway_private.create_job_photo_upload_intent($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::text,$8::integer,$9::text,$10::text,$11::timestamptz)`,
        [input.uploadId, input.bookingId, input.taskId, input.photoType, input.quarantineStorageKey, input.finalStorageKey, input.mimeType, input.byteSize, input.checksumSha256, input.note, input.expiresAt]
      )).rows[0]));
    },
    getUploadForCompletion(actor, uploadId) {
      return transact(actor, async (client) => upload((await client.query(
        `SELECT ${uploadColumns} FROM tideway_private.get_job_photo_upload_for_completion($1::uuid)`, [uploadId]
      )).rows[0]));
    },
    async rejectUpload(actor, uploadId, reason) {
      return transact(actor, async (client) => { await client.query("SELECT tideway_private.reject_job_photo_upload($1::uuid,$2::text)", [uploadId, reason]); });
    },
    completeUpload(actor, uploadId, verified) {
      return transact(actor, async (client) => (await client.query(
        "SELECT tideway_private.complete_job_photo_upload($1::uuid,$2::integer,$3::text,$4::integer,$5::integer) AS snapshot",
        [uploadId, verified.byteSize, verified.checksumSha256, verified.width, verified.height]
      )).rows[0]?.snapshot);
    },
    getProgress(actor, bookingId) {
      return transact(actor, async (client) => (await client.query("SELECT tideway_private.get_cleaning_progress($1::uuid) AS snapshot", [bookingId])).rows[0]?.snapshot);
    },
    getPhotoObject(actor, bookingId, photoId) {
      return transact(actor, async (client) => {
        const row = (await client.query("SELECT * FROM tideway_private.get_job_photo_object($1::uuid,$2::uuid)", [bookingId, photoId])).rows[0];
        if (!row) throw new Error("photo-not-found");
        return { storageKey: row.storage_key, mimeType: row.mime_type, byteSize: Number(row.byte_size), checksumSha256: row.checksum_hex, photoType: row.photo_type, note: row.note || null };
      });
    }
  });
}
