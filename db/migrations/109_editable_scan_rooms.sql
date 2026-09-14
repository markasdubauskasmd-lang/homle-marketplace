BEGIN;

-- Keep display names distinct from pricing room types. Existing scans retain
-- their original names; no previously agreed booking is repriced.
ALTER TABLE room_scans ADD COLUMN room_type text NOT NULL DEFAULT 'other'
  CHECK (room_type IN ('kitchen','bathroom','bedroom','living-room','dining-room','hallway','other'));

CREATE OR REPLACE FUNCTION tideway_private.record_room_scan(
  proposed_session_id uuid,
  target_request_id uuid,
  supplied_device_class text,
  supplied_captured_at timestamptz,
  supplied_rooms jsonb,
  supplied_model_purpose text,
  supplied_model_provider text,
  supplied_model_id text,
  supplied_schema_version smallint
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  request_record cleaning_requests%ROWTYPE;
  existing_session room_scan_sessions%ROWTYPE;
  resolved_model uuid;
  room_entry jsonb;
  object_entry jsonb;
  inserted_scan_id uuid;
  room_index integer := 0;
  object_count integer;
  total_objects integer := 0;
  supplied_condition text;
  supplied_quantity text;
  supplied_label_confidence text;
  supplied_condition_confidence text;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('landlord') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='landlord-required';
  END IF;
  IF proposed_session_id IS NULL OR target_request_id IS NULL
    OR supplied_device_class IS NULL OR supplied_device_class NOT IN ('guided-web','camera-fallback','unknown')
    OR supplied_captured_at IS NULL
    OR supplied_captured_at > now() + interval '5 minutes'
    OR supplied_captured_at < now() - interval '24 hours'
    OR jsonb_typeof(supplied_rooms) <> 'array'
    OR jsonb_array_length(supplied_rooms) NOT BETWEEN 1 AND 20
  THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-room-scan'; END IF;

  SELECT * INTO request_record FROM cleaning_requests request
    WHERE request.id = target_request_id AND request.landlord_user_id = actor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='request-not-found'; END IF;
  -- Only a draft accepts a scan. Once submitted, the scan is part of a frozen
  -- scope that a Cleaner may already have accepted work against.
  IF request_record.status <> 'draft' THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='room-scan-not-recordable';
  END IF;

  SELECT * INTO existing_session FROM room_scan_sessions session
    WHERE session.cleaning_request_id = request_record.id FOR UPDATE;
  IF FOUND AND existing_session.id = proposed_session_id THEN
    RETURN tideway_private.get_room_scan(request_record.id);
  END IF;
  IF FOUND THEN DELETE FROM room_scan_sessions WHERE id = existing_session.id; END IF;

  resolved_model := tideway_private.resolve_room_scan_model_version(
    supplied_model_purpose, supplied_model_provider, supplied_model_id, supplied_schema_version);

  INSERT INTO room_scan_sessions (id, cleaning_request_id, landlord_user_id, model_version_id, device_class, captured_at)
    VALUES (proposed_session_id, request_record.id, actor_id, resolved_model, supplied_device_class, supplied_captured_at);

  FOR room_entry IN SELECT value FROM jsonb_array_elements(supplied_rooms) LOOP
    -- 'unknown' is the reader's own word for "this photograph cannot show you",
    -- and room-vision.mjs already carries it through as absence of assessment
    -- rather than a grade. Storage has to agree, or a room the model honestly
    -- declined to judge would be rejected outright while a confident wrong
    -- grade sailed through.
    supplied_condition := NULLIF(NULLIF(room_entry->>'condition', ''), 'unknown');
    IF jsonb_typeof(room_entry) <> 'object'
      OR char_length(COALESCE(room_entry->>'roomName','')) NOT BETWEEN 1 AND 120
      OR (supplied_condition IS NOT NULL AND supplied_condition NOT IN ('light','medium','heavy'))
      OR COALESCE(room_entry->>'roomType','other') NOT IN ('kitchen','bathroom','bedroom','living-room','dining-room','hallway','other')
      OR char_length(COALESCE(room_entry->>'note','')) > 1000
    THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-room-scan-room'; END IF;

    INSERT INTO room_scans (room_scan_session_id, room_name, room_type, condition, note, sort_order)
      VALUES (proposed_session_id, room_entry->>'roomName', COALESCE(room_entry->>'roomType','other'), supplied_condition, COALESCE(room_entry->>'note',''), room_index)
      RETURNING id INTO inserted_scan_id;

    IF room_entry ? 'objects' AND jsonb_typeof(room_entry->'objects') <> 'null' THEN
      IF jsonb_typeof(room_entry->'objects') <> 'array' THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-room-scan-room'; END IF;
      object_count := jsonb_array_length(room_entry->'objects');
      total_objects := total_objects + object_count;
      IF object_count > 200 OR total_objects > 4000 THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='room-scan-object-limit'; END IF;

      FOR object_entry IN SELECT value FROM jsonb_array_elements(room_entry->'objects') LOOP
        supplied_condition := NULLIF(NULLIF(object_entry->>'condition', ''), 'unknown');
        supplied_quantity := COALESCE(object_entry->>'quantity', '1');
        supplied_label_confidence := COALESCE(object_entry->>'confidenceLabel', '0');
        supplied_condition_confidence := COALESCE(object_entry->>'confidenceCondition', '0');
        -- Every numeric arrives as text from JSON, so each is shape-checked
        -- before it is cast. An unchecked cast raises a bare 22P02 that reports
        -- nothing about which field or which room was wrong.
        --
        -- Out-of-range numbers are clamped rather than rejected, matching what
        -- confidenceValue() and itemQuantity() already do on the device. A
        -- float that serialises as 0.6200000000000001 must not discard twenty
        -- good rooms. Names and enums still reject, because a wrong label is a
        -- claim about the room and there is no safe value to clamp it to.
        IF jsonb_typeof(object_entry) <> 'object'
          OR char_length(COALESCE(object_entry->>'inventoryKey','')) NOT BETWEEN 1 AND 60
          OR char_length(COALESCE(object_entry->>'label','')) NOT BETWEEN 1 AND 40
          OR COALESCE(object_entry->>'origin','') NOT IN ('detector','vision','manual')
          OR (supplied_condition IS NOT NULL AND supplied_condition NOT IN ('clean','light','medium','heavy'))
          OR supplied_quantity !~ '^[0-9]{1,4}$'
          OR supplied_label_confidence !~ '^[0-9]+(\.[0-9]+)?$'
          OR supplied_condition_confidence !~ '^[0-9]+(\.[0-9]+)?$'
        THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-room-scan-object'; END IF;

        INSERT INTO room_scan_objects (
          room_scan_id, inventory_key, label, quantity, condition, soiling,
          confidence_label, confidence_condition, condition_confirmed, evidence, origin)
        VALUES (
          inserted_scan_id,
          object_entry->>'inventoryKey',
          object_entry->>'label',
          LEAST(GREATEST(supplied_quantity::integer, 1), 20)::smallint,
          supplied_condition,
          COALESCE(ARRAY(SELECT jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(object_entry->'soiling') = 'array' THEN object_entry->'soiling' ELSE '[]'::jsonb END)), '{}'::text[]),
          LEAST(GREATEST(supplied_label_confidence::numeric, 0), 1),
          LEAST(GREATEST(supplied_condition_confidence::numeric, 0), 1),
          COALESCE((object_entry->>'conditionConfirmed') = 'true', false),
          left(COALESCE(object_entry->>'evidence',''), 200),
          object_entry->>'origin');
      END LOOP;
    END IF;

    room_index := room_index + 1;
  END LOOP;

  RETURN tideway_private.get_room_scan(request_record.id);
END;
$$;

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
  IF NOT FOUND OR NOT (request_record.landlord_user_id = actor_id OR tideway_private.has_role('administrator'))
  THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='request-not-found'; END IF;

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
      'roomType', scan.room_type,
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

COMMIT;
