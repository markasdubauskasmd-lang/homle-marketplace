function mappedError(error) {
  const known = {
    "request-not-found": [404, "request-not-found", "The cleaning-request draft was not found."],
    "request-photo-not-found": [404, "request-photo-not-found", "The private room photo was not found."],
    "request-photo-upload-not-found": [404, "request-photo-upload-not-found", "The room-photo upload was not found."],
    "invalid-request-photo-upload": [422, "invalid-request-photo-upload", "The room-photo upload details are invalid."],
    "invalid-request-photo-storage-key": [422, "invalid-request-photo-storage-key", "The room-photo storage destination is invalid."],
    "invalid-verified-request-photo": [422, "invalid-verified-request-photo", "The processed room photo did not pass validation."],
    "invalid-request-photo-rejection": [422, "invalid-request-photo-rejection", "The room-photo rejection reason is invalid."],
    "request-photo-upload-not-allowed": [409, "request-photo-upload-not-allowed", "Room photos can only be added to a future private draft."],
    "request-photo-room-not-found": [409, "request-photo-room-not-found", "Use a room name from the reviewed checklist."],
    "request-photo-limit": [409, "request-photo-limit", "A cleaning request can contain up to ten room photos."],
    "request-photo-upload-expired": [409, "request-photo-upload-expired", "This room-photo upload expired. Start a new upload."],
    "request-photo-upload-completed": [409, "request-photo-upload-completed", "This room-photo upload is already complete."]
  };
  const selected = known[error?.message];
  return selected ? Object.assign(new Error(selected[2]), { statusCode: selected[0], code: selected[1], cause: error }) : error;
}

function upload(row) {
  if (!row) throw new Error("The room-photo upload record is unavailable.");
  return {
    uploadId: row.id,
    cleaningRequestId: row.cleaning_request_id,
    requestedBy: row.requested_by,
    roomName: row.room_name,
    note: row.note,
    quarantineStorageKey: row.quarantine_storage_key,
    finalStorageKey: row.final_storage_key,
    mimeType: row.requested_mime_type,
    byteSize: Number(row.requested_byte_size),
    checksumSha256: row.requested_checksum_hex,
    status: row.status,
    expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : row.expires_at,
    completedAt: row.completed_at instanceof Date ? row.completed_at.toISOString() : row.completed_at || null
  };
}

function scan(value) {
  const record = typeof value === "string" ? JSON.parse(value) : value;
  if (!record || typeof record !== "object" || !Array.isArray(record.photos)) throw new Error("The private room scan is unavailable.");
  return record;
}

export function createRequestMediaRepository(database) {
  if (!database || typeof database.withUserTransaction !== "function") throw new TypeError("The marketplace database boundary is required.");
  async function transact(actor, operation) {
    return database.withUserTransaction(actor, async (client) => {
      try { return await operation(client); } catch (error) { throw mappedError(error); }
    });
  }
  const columns = "id,cleaning_request_id,requested_by,room_name,note,quarantine_storage_key,final_storage_key,requested_mime_type,requested_byte_size,encode(requested_checksum_sha256,'hex') AS requested_checksum_hex,status,expires_at,completed_at";
  return Object.freeze({
    createUploadIntent(actor, input) {
      return transact(actor, async (client) => upload((await client.query(
        `SELECT ${columns} FROM tideway_private.create_request_photo_upload_intent($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::text,$7::text,$8::integer,$9::text,$10::timestamptz)`,
        [input.uploadId, input.cleaningRequestId, input.roomName, input.note, input.quarantineStorageKey, input.finalStorageKey, input.mimeType, input.byteSize, input.checksumSha256, input.expiresAt]
      )).rows[0]));
    },
    getUploadForCompletion(actor, uploadId) {
      return transact(actor, async (client) => upload((await client.query(`SELECT ${columns} FROM tideway_private.get_request_photo_upload_for_completion($1::uuid)`, [uploadId])).rows[0]));
    },
    rejectUpload(actor, uploadId, reason) {
      return transact(actor, async (client) => client.query("SELECT tideway_private.reject_request_photo_upload($1::uuid,$2::text)", [uploadId, reason]));
    },
    completeUpload(actor, uploadId, verified) {
      return transact(actor, async (client) => scan((await client.query(
        "SELECT tideway_private.complete_request_photo_upload($1::uuid,$2::integer,$3::text,$4::integer,$5::integer) AS scan",
        [uploadId, verified.byteSize, verified.checksumSha256, verified.width, verified.height]
      )).rows[0]?.scan));
    },
    getScan(actor, cleaningRequestId) {
      return transact(actor, async (client) => scan((await client.query("SELECT tideway_private.get_cleaning_request_scan($1::uuid) AS scan", [cleaningRequestId])).rows[0]?.scan));
    },
    getPhotoObject(actor, cleaningRequestId, photoId) {
      return transact(actor, async (client) => {
        const row = (await client.query("SELECT * FROM tideway_private.get_cleaning_request_photo_object($1::uuid,$2::uuid)", [cleaningRequestId, photoId])).rows[0];
        if (!row) throw new Error("request-photo-not-found");
        return { storageKey: row.storage_key, mimeType: row.mime_type, byteSize: Number(row.byte_size), checksumSha256: row.checksum_hex, roomName: row.room_name, note: row.note };
      });
    }
  });
}
