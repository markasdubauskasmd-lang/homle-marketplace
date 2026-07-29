-- Room measurements, with how each one was arrived at.
--
-- Phase 5 of docs/ROOM_SCAN_ARCHITECTURE_AUDIT.md, under the web-only decision
-- in its §11. There is no depth sensor reachable from a browser, so every value
-- here is an estimate from a known-size reference in frame or a figure a person
-- confirmed. Nothing stored by this migration is exact.
--
-- The method, the tolerance and the confidence are NOT NULL for that reason.
-- A measurement whose provenance is unknown is worse than no measurement,
-- because it sits in the same column as the others and looks like them. The
-- constraints below make a bare number physically unstorable.
BEGIN;

CREATE TABLE room_scan_measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_scan_id uuid NOT NULL REFERENCES room_scans(id) ON DELETE CASCADE,
  subject text NOT NULL CHECK (subject IN ('room-length','room-width','ceiling-height','floor-area','wall-area')),
  -- 'sensor' is reserved and currently unreachable. It is in the constraint so
  -- that adding a native measurement path later is a code change rather than a
  -- migration on a table already holding customer data; the service refuses it
  -- at the boundary until something can honestly produce it.
  method text NOT NULL CHECK (method IN ('reference-calibrated','user-confirmed','derived','sensor')),
  value_mm bigint NOT NULL CHECK (value_mm > 0 AND value_mm <= 100000000),
  tolerance_mm bigint NOT NULL CHECK (tolerance_mm >= 0 AND tolerance_mm <= 100000000),
  confidence text NOT NULL CHECK (confidence IN ('high','medium','low','unusable')),
  -- Which known-size object supplied the scale, so a systematically wrong
  -- reference can be found later rather than quietly skewing every room that
  -- used it.
  reference text NOT NULL DEFAULT '' CHECK (char_length(reference) <= 40),
  -- The original detected value, retained when a customer corrects one. Both
  -- figures survive for the same reason object corrections do: the first is the
  -- training label and the second is the truth the customer asserted.
  original_value_mm bigint CHECK (original_value_mm IS NULL OR (original_value_mm > 0 AND original_value_mm <= 100000000)),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- One value per subject per room. Two floor areas for one room is not extra
  -- information, it is an unresolved disagreement nothing downstream could act on.
  UNIQUE (room_scan_id, subject),
  -- An estimate with a zero tolerance would read as exact for ever after.
  -- Only a person may state a figure with no band, and only about their own home.
  CONSTRAINT room_scan_measurements_estimate_has_band
    CHECK (method = 'user-confirmed' OR tolerance_mm > 0)
);

CREATE INDEX room_scan_measurements_scan_idx ON room_scan_measurements(room_scan_id, subject);

ALTER TABLE room_scan_measurements ENABLE ROW LEVEL SECURITY;
CREATE POLICY room_scan_measurements_owner_or_admin ON room_scan_measurements USING (
  EXISTS (SELECT 1 FROM room_scans scan JOIN room_scan_sessions session ON session.id = scan.room_scan_session_id
    WHERE scan.id = room_scan_measurements.room_scan_id
      AND (session.landlord_user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator')))
);

-- Replaces a room's measurements wholesale.
--
-- Wholesale rather than per-value because a floor area derived from a length
-- and a width must never outlive the figures it was derived from. Updating one
-- length and leaving a stale area behind would leave two stored numbers that
-- disagree, and nothing reading them could tell which was current.
CREATE FUNCTION tideway_private.record_room_scan_measurements(
  target_room_scan_id uuid, supplied_measurements jsonb
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  request_status text;
  entry jsonb;
  supplied_method text;
  supplied_tolerance bigint;
  stored jsonb;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('landlord') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='landlord-required';
  END IF;
  IF jsonb_typeof(supplied_measurements) <> 'array' OR jsonb_array_length(supplied_measurements) > 20 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-room-measurements';
  END IF;

  SELECT request.status INTO request_status FROM cleaning_requests request
    JOIN room_scan_sessions session ON session.cleaning_request_id = request.id
    JOIN room_scans scan ON scan.room_scan_session_id = session.id
    WHERE scan.id = target_room_scan_id AND session.landlord_user_id = actor_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='room-scan-not-found'; END IF;
  IF request_status <> 'draft' THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='room-scan-not-correctable'; END IF;

  DELETE FROM room_scan_measurements WHERE room_scan_id = target_room_scan_id;

  FOR entry IN SELECT value FROM jsonb_array_elements(supplied_measurements) LOOP
    supplied_method := entry->>'method';
    -- Refused here as well as in the service. A browser cannot produce a sensor
    -- reading, and a stored one would claim an accuracy nothing delivered.
    IF supplied_method = 'sensor' THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='room-measurement-method-unavailable'; END IF;
    IF jsonb_typeof(entry) <> 'object'
      OR COALESCE(entry->>'subject','') NOT IN ('room-length','room-width','ceiling-height','floor-area','wall-area')
      OR COALESCE(supplied_method,'') NOT IN ('reference-calibrated','user-confirmed','derived')
      OR COALESCE(entry->>'valueMm','') !~ '^[0-9]{1,9}$'
      OR COALESCE(entry->>'toleranceMm','') !~ '^[0-9]{1,9}$'
      OR COALESCE(entry->>'confidence','') NOT IN ('high','medium','low','unusable')
      OR char_length(COALESCE(entry->>'reference','')) > 40
    THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-room-measurement'; END IF;

    supplied_tolerance := (entry->>'toleranceMm')::bigint;
    IF supplied_method <> 'user-confirmed' AND supplied_tolerance = 0 THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='room-measurement-needs-tolerance';
    END IF;

    INSERT INTO room_scan_measurements (room_scan_id, subject, method, value_mm, tolerance_mm, confidence, reference, original_value_mm)
      VALUES (target_room_scan_id, entry->>'subject', supplied_method, (entry->>'valueMm')::bigint,
        supplied_tolerance, entry->>'confidence', COALESCE(entry->>'reference',''),
        CASE WHEN COALESCE(entry->>'originalValueMm','') ~ '^[0-9]{1,9}$' THEN (entry->>'originalValueMm')::bigint ELSE NULL END);
  END LOOP;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'measurementId', measurement.id, 'subject', measurement.subject, 'method', measurement.method,
    'valueMm', measurement.value_mm, 'toleranceMm', measurement.tolerance_mm,
    'confidence', measurement.confidence, 'reference', measurement.reference,
    'originalValueMm', measurement.original_value_mm) ORDER BY measurement.subject), '[]'::jsonb)
    INTO stored FROM room_scan_measurements measurement WHERE measurement.room_scan_id = target_room_scan_id;
  RETURN stored;
END;
$$;

-- The room projection gains its measurements. Rewritten rather than wrapped so
-- there is one participant rule for the whole scan, not two that could drift.
CREATE OR REPLACE FUNCTION tideway_private.get_room_scan(target_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  request_record cleaning_requests%ROWTYPE;
  session_record room_scan_sessions%ROWTYPE;
  model_record room_scan_model_versions%ROWTYPE;
  rooms jsonb;
BEGIN
  IF actor_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='authentication-required'; END IF;
  SELECT * INTO request_record FROM cleaning_requests request WHERE request.id = target_request_id;
  IF NOT FOUND OR NOT (request_record.landlord_user_id = actor_id OR tideway_private.has_role('administrator') OR EXISTS (
    SELECT 1 FROM bookings booking WHERE booking.cleaning_request_id = request_record.id AND booking.cleaner_user_id = actor_id AND (
      booking.status IN ('confirmed','cleaner-en-route','cleaner-arrived','cleaning-in-progress','awaiting-review','completed')
      OR (request_record.cleaner_preview_authorized AND booking.status = 'pending-cleaner-acceptance')
    )
  )) THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='request-not-found'; END IF;

  SELECT * INTO session_record FROM room_scan_sessions session WHERE session.cleaning_request_id = request_record.id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('cleaningRequestId', request_record.id, 'session', NULL, 'rooms', '[]'::jsonb);
  END IF;
  IF session_record.model_version_id IS NOT NULL THEN
    SELECT * INTO model_record FROM room_scan_model_versions version WHERE version.id = session_record.model_version_id;
  END IF;

  SELECT COALESCE(jsonb_agg(room_row.room ORDER BY room_row.sort_order, room_row.room_scan_id), '[]'::jsonb) INTO rooms FROM (
    SELECT scan.sort_order, scan.id AS room_scan_id, jsonb_build_object(
      'roomScanId', scan.id,
      'roomName', scan.room_name,
      'condition', scan.condition,
      'note', scan.note,
      'sortOrder', scan.sort_order,
      'objects', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'objectId', object.id,
          'inventoryKey', object.inventory_key,
          'label', object.label,
          'quantity', object.quantity,
          'condition', object.condition,
          'soiling', to_jsonb(object.soiling),
          'confidenceLabel', object.confidence_label,
          'confidenceCondition', object.confidence_condition,
          'conditionConfirmed', object.condition_confirmed,
          'evidence', object.evidence,
          'origin', object.origin
        ) ORDER BY object.id)
        FROM room_scan_objects object WHERE object.room_scan_id = scan.id), '[]'::jsonb),
      'measurements', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'measurementId', measurement.id,
          'subject', measurement.subject,
          'method', measurement.method,
          'valueMm', measurement.value_mm,
          'toleranceMm', measurement.tolerance_mm,
          'confidence', measurement.confidence,
          'reference', measurement.reference,
          'originalValueMm', measurement.original_value_mm
        ) ORDER BY measurement.subject)
        FROM room_scan_measurements measurement WHERE measurement.room_scan_id = scan.id), '[]'::jsonb)
    ) AS room
    FROM room_scans scan WHERE scan.room_scan_session_id = session_record.id
  ) AS room_row;

  RETURN jsonb_build_object(
    'cleaningRequestId', request_record.id,
    'session', jsonb_build_object(
      'sessionId', session_record.id,
      'deviceClass', session_record.device_class,
      'capturedAt', session_record.captured_at,
      'createdAt', session_record.created_at,
      'model', CASE WHEN model_record.id IS NULL THEN NULL ELSE jsonb_build_object(
        'purpose', model_record.purpose, 'provider', model_record.provider,
        'modelId', model_record.model_id, 'schemaVersion', model_record.schema_version) END),
    'rooms', rooms);
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.record_room_scan_measurements(uuid,jsonb) FROM PUBLIC;

COMMIT;
