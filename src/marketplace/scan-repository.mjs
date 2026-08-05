// The database boundary for structured room scans.
//
// Every statement below is a call to a reviewed SECURITY DEFINER function. The
// runtime role has no direct privilege on the scan tables at all — see the
// REVOKE block in db/runtime-role-grants.sql — so this module physically cannot
// widen the participant rules by writing a looser query, which is the point.

function mapped(error, table) {
  const entry = table[error?.message];
  if (!entry) throw error;
  throw Object.assign(new Error(entry[2]), { statusCode: entry[0], code: entry[1], cause: error });
}

const recordErrors = Object.freeze({
  "landlord-required": [403, "landlord-required", "A Landlord account is required to save a room scan."],
  "request-not-found": [404, "request-not-found", "The cleaning-request draft was not found."],
  "room-scan-not-recordable": [409, "room-scan-not-recordable", "Only a draft request can accept a room scan."],
  "invalid-room-scan": [422, "invalid-room-scan", "The room scan could not be read."],
  "invalid-room-scan-room": [422, "invalid-room-scan-room", "One of the scanned rooms could not be read."],
  "invalid-room-scan-object": [422, "invalid-room-scan-object", "One of the scanned objects could not be read."],
  "room-scan-object-limit": [422, "room-scan-object-limit", "This scan contains more objects than one request can carry."]
});

const correctionErrors = Object.freeze({
  "landlord-required": [403, "landlord-required", "A Landlord account is required to correct a room scan."],
  "room-scan-object-not-found": [404, "room-scan-object-not-found", "That scanned object was not found."],
  "room-scan-not-correctable": [409, "room-scan-not-correctable", "A submitted scan can no longer be corrected."],
  "invalid-room-scan-correction": [422, "invalid-room-scan-correction", "That correction could not be applied."]
});

const measurementErrors = Object.freeze({
  "landlord-required": [403, "landlord-required", "A Landlord account is required to save room measurements."],
  "room-scan-not-found": [404, "room-scan-not-found", "That scanned room was not found."],
  "room-scan-not-correctable": [409, "room-scan-not-correctable", "A submitted scan can no longer be measured."],
  "invalid-room-measurements": [422, "invalid-room-measurements", "The room measurements could not be read."],
  "invalid-room-measurement": [422, "invalid-room-measurement", "One of the room measurements could not be read."],
  "room-measurement-needs-tolerance": [422, "room-measurement-needs-tolerance", "An estimated measurement must state how far out it could be."],
  "room-measurement-method-unavailable": [422, "room-measurement-method-unavailable", "This device cannot take a sensor measurement."]
});

const voiceErrors = Object.freeze({
  "landlord-required": [403, "landlord-required", "A Landlord account is required to save spoken instructions."],
  "request-not-found": [404, "request-not-found", "The cleaning request was not found."],
  "request-not-editable": [409, "request-not-editable", "A submitted request's instructions can no longer be changed."],
  "invalid-voice-instructions": [422, "invalid-voice-instructions", "Those spoken instructions could not be read."],
  "invalid-voice-instruction": [422, "invalid-voice-instruction", "One of those spoken instructions could not be read."],
  "authentication-required": [401, "authentication-required", "Sign in to view these instructions."]
});

const readErrors = Object.freeze({
  "authentication-required": [401, "authentication-required", "Sign in to view this room scan."],
  "request-not-found": [404, "request-not-found", "The room scan was not found."]
});

export function createScanRepository(database) {
  if (!database || typeof database.withUserTransaction !== "function") throw new TypeError("The marketplace database boundary is required.");
  return Object.freeze({
    recordScan(actor, scan) {
      return database.withUserTransaction(actor, async (client) => {
        try {
          const result = await client.query(
            "SELECT tideway_private.record_room_scan($1::uuid,$2::uuid,$3::text,$4::timestamptz,$5::jsonb,$6::text,$7::text,$8::text,$9::smallint) AS scan",
            [scan.sessionId, scan.cleaningRequestId, scan.deviceClass, scan.capturedAt, JSON.stringify(scan.rooms),
              scan.model?.purpose ?? null, scan.model?.provider ?? null, scan.model?.modelId ?? null, scan.model?.schemaVersion ?? null]
          );
          return result.rows[0]?.scan;
        } catch (error) { return mapped(error, recordErrors); }
      });
    },
    getScan(actor, cleaningRequestId) {
      return database.withUserTransaction(actor, async (client) => {
        try {
          const result = await client.query("SELECT tideway_private.get_room_scan($1::uuid) AS scan", [cleaningRequestId]);
          return result.rows[0]?.scan;
        } catch (error) { return mapped(error, readErrors); }
      });
    },
    correctObject(actor, objectId, correction) {
      return database.withUserTransaction(actor, async (client) => {
        try {
          const result = await client.query(
            "SELECT tideway_private.correct_room_scan_object($1::uuid,$2::text,$3::text,$4::boolean) AS correction",
            [objectId, correction.field, correction.value, correction.trainingConsent]
          );
          return result.rows[0]?.correction;
        } catch (error) { return mapped(error, correctionErrors); }
      });
    },
    recordVoiceInstructions(actor, cleaningRequestId, instructions) {
      return database.withUserTransaction(actor, async (client) => {
        try {
          const result = await client.query(
            "SELECT tideway_private.record_request_voice_instructions($1::uuid,$2::jsonb) AS instructions",
            [cleaningRequestId, JSON.stringify(instructions)]
          );
          return result.rows[0]?.instructions ?? [];
        } catch (error) { return mapped(error, voiceErrors); }
      });
    },
    getVoiceInstructions(actor, cleaningRequestId) {
      return database.withUserTransaction(actor, async (client) => {
        try {
          const result = await client.query("SELECT tideway_private.get_request_voice_instructions($1::uuid) AS instructions", [cleaningRequestId]);
          return result.rows[0]?.instructions ?? [];
        } catch (error) { return mapped(error, voiceErrors); }
      });
    },
    recordMeasurements(actor, roomScanId, measurements) {
      return database.withUserTransaction(actor, async (client) => {
        try {
          const result = await client.query(
            "SELECT tideway_private.record_room_scan_measurements($1::uuid,$2::jsonb) AS measurements",
            [roomScanId, JSON.stringify(measurements)]
          );
          return result.rows[0]?.measurements;
        } catch (error) { return mapped(error, measurementErrors); }
      });
    },
    deleteScan(actor, cleaningRequestId) {
      return database.withUserTransaction(actor, async (client) => {
        try {
          const result = await client.query("SELECT tideway_private.delete_room_scan($1::uuid) AS removed", [cleaningRequestId]);
          return result.rows[0]?.removed === true;
        } catch (error) { return mapped(error, correctionErrors); }
      });
    }
  });
}
