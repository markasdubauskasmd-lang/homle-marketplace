-- Structured room scans.
--
-- The scanner already produces per-object conditions, an enumerated soiling
-- taxonomy, two independent confidence scores and a required evidence string.
-- None of it reached the database: landlord-journey.js kept only the generated
-- task strings and everything else was garbage-collected when the overlay
-- closed. See docs/ROOM_SCAN_ARCHITECTURE_AUDIT.md, gap G1.
--
-- Consequences of that loss, all of which this migration exists to end:
--   * condition could not influence price, because it was never stored;
--   * a quote could not be explained afterwards, because its inputs were gone;
--   * customer corrections — the most valuable label source in the product —
--     were discarded at the moment they were made.
--
-- The scan is attached to the cleaning request rather than given an independent
-- session lifecycle. That reuses the ownership, participant-access, deletion
-- and submission-freeze rules the request already enforces, rather than
-- inventing a second and inevitably divergent set of them.
--
-- This migration stores observations only. It changes no price, no booking and
-- no existing table.
BEGIN;

-- Which model produced a reading, so a regression is attributable and a
-- rollback means something. Resolved server-side from configuration and never
-- from a request body: a client that could name its own model version could
-- launder an arbitrary claim into the audit trail.
CREATE TABLE room_scan_model_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose text NOT NULL CHECK (purpose IN ('walking','confirmation','none')),
  provider text NOT NULL CHECK (char_length(provider) BETWEEN 1 AND 40),
  model_id text NOT NULL CHECK (char_length(model_id) BETWEEN 1 AND 80),
  schema_version smallint NOT NULL CHECK (schema_version BETWEEN 1 AND 1000),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (purpose, provider, model_id, schema_version)
);

CREATE TABLE room_scan_sessions (
  id uuid PRIMARY KEY,
  cleaning_request_id uuid NOT NULL REFERENCES cleaning_requests(id) ON DELETE CASCADE,
  landlord_user_id uuid NOT NULL REFERENCES landlord_profiles(user_id),
  model_version_id uuid REFERENCES room_scan_model_versions(id),
  -- Which tier of the device-support strategy produced this scan. Recorded so
  -- accuracy can later be reported per tier instead of averaged into one
  -- meaningless number across live-viewfinder and camera-roll captures.
  device_class text NOT NULL CHECK (device_class IN ('guided-web','camera-fallback','unknown')),
  captured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- One structured scan per request. A retry of the same handoff carries the
  -- same session id and is absorbed rather than duplicated; a genuinely new
  -- scan replaces the previous one inside the recording transaction.
  UNIQUE (cleaning_request_id)
);

CREATE TABLE room_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_scan_session_id uuid NOT NULL REFERENCES room_scan_sessions(id) ON DELETE CASCADE,
  room_name text NOT NULL CHECK (char_length(room_name) BETWEEN 1 AND 120),
  -- NULL is "not assessed", never a grade. The vision reader deliberately
  -- returns 'unknown' when a photograph cannot support a judgement, and that
  -- has to survive storage as absence rather than being flattened to 'light'.
  condition text CHECK (condition IN ('light','medium','heavy')),
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 1000),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX room_scans_session_idx ON room_scans(room_scan_session_id, sort_order, id);

CREATE TABLE room_scan_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_scan_id uuid NOT NULL REFERENCES room_scans(id) ON DELETE CASCADE,
  -- Identity from before any customer rename, so a row renamed "Bathroom tap"
  -- still merges with the "Tap" it came from instead of becoming a second
  -- object. The scanner already maintains this key; it is stored, not derived.
  inventory_key text NOT NULL CHECK (char_length(inventory_key) BETWEEN 1 AND 60),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 40),
  quantity smallint NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 20),
  condition text CHECK (condition IN ('clean','light','medium','heavy')),
  soiling text[] NOT NULL DEFAULT '{}'::text[] CHECK (
    array_length(soiling, 1) IS NULL OR (
      array_length(soiling, 1) <= 4
      AND soiling <@ ARRAY['dust','grease','limescale','stain','mould','soap-scum','food-debris','pet-hair','damage','clutter']::text[]
    )
  ),
  -- Two independent signals, kept independent. A clearly recognised tap in
  -- shadow has high label confidence and low condition confidence, and
  -- collapsing them into one number is what makes an uncertain grade look
  -- like a confident one.
  --
  -- Deliberately NOT constrained to require confidence alongside a grade. A
  -- provider that omits the field would otherwise fail the whole scan at
  -- insert, discarding twenty good rooms over one missing number. The honesty
  -- rule belongs in the projection, which reports the score it actually has,
  -- rather than in a constraint that can only reject.
  confidence_label numeric(4,3) NOT NULL DEFAULT 0 CHECK (confidence_label BETWEEN 0 AND 1),
  confidence_condition numeric(4,3) NOT NULL DEFAULT 0 CHECK (confidence_condition BETWEEN 0 AND 1),
  condition_confirmed boolean NOT NULL DEFAULT false,
  -- What was actually visible: "white deposits around the tap base". This is
  -- what makes a grade checkable rather than merely asserted.
  evidence text NOT NULL DEFAULT '' CHECK (char_length(evidence) <= 200),
  origin text NOT NULL CHECK (origin IN ('detector','vision','manual')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX room_scan_objects_scan_idx ON room_scan_objects(room_scan_id, id);

-- Corrections are recorded, never applied destructively. The original detected
-- value and the corrected value both survive: the first is the training label,
-- the second is the truth the customer asserted, and a row that overwrote one
-- with the other would destroy exactly the signal worth keeping.
CREATE TABLE room_scan_object_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Intentionally not a foreign key. A 'removed' correction outlives the object
  -- it describes; a cascade would delete the only record that the customer
  -- rejected that detection, which is the most informative label of all.
  room_scan_object_id uuid NOT NULL,
  room_scan_id uuid NOT NULL REFERENCES room_scans(id) ON DELETE CASCADE,
  corrected_by uuid NOT NULL REFERENCES users(id),
  field text NOT NULL CHECK (field IN ('label','condition','quantity','removed')),
  original_value text NOT NULL CHECK (char_length(original_value) <= 60),
  corrected_value text NOT NULL CHECK (char_length(corrected_value) <= 60),
  -- Defaults false and is set only by an explicit customer choice. No customer
  -- scan trains anything without it.
  training_consent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX room_scan_object_corrections_object_idx ON room_scan_object_corrections(room_scan_object_id, created_at);

ALTER TABLE room_scan_model_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_scan_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_scan_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_scan_object_corrections ENABLE ROW LEVEL SECURITY;

-- Deliberately restrictive. Every read and write below goes through a
-- SECURITY DEFINER function that applies the participant rules explicitly;
-- these policies exist so that a direct query, if one is ever added by
-- accident, returns nothing rather than another customer's home.
CREATE POLICY room_scan_sessions_owner_or_admin ON room_scan_sessions USING (
  landlord_user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator')
);
CREATE POLICY room_scans_owner_or_admin ON room_scans USING (
  EXISTS (SELECT 1 FROM room_scan_sessions session WHERE session.id = room_scans.room_scan_session_id
    AND (session.landlord_user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator')))
);
CREATE POLICY room_scan_objects_owner_or_admin ON room_scan_objects USING (
  EXISTS (SELECT 1 FROM room_scans scan JOIN room_scan_sessions session ON session.id = scan.room_scan_session_id
    WHERE scan.id = room_scan_objects.room_scan_id
      AND (session.landlord_user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator')))
);
CREATE POLICY room_scan_object_corrections_owner_or_admin ON room_scan_object_corrections USING (
  corrected_by = tideway_private.current_user_id() OR tideway_private.has_role('administrator')
);
CREATE POLICY room_scan_model_versions_readable ON room_scan_model_versions FOR SELECT USING (true);

-- Participant-aware read. Mirrors get_cleaning_request_scan exactly: the owning
-- Landlord and an Administrator always; an invited Cleaner only when the
-- Landlord authorised preview; the assigned Cleaner from confirmation onward.
-- Written as the same expression rather than a similar one, because two access
-- rules that are meant to agree will otherwise drift apart.
CREATE FUNCTION tideway_private.get_room_scan(target_request_id uuid)
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
        FROM room_scan_objects object WHERE object.room_scan_id = scan.id), '[]'::jsonb)
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

-- Resolve-or-create, so the caller never supplies an id. Called only from the
-- recording function below, with strings the server takes from its own
-- configuration.
CREATE FUNCTION tideway_private.resolve_room_scan_model_version(
  supplied_purpose text, supplied_provider text, supplied_model_id text, supplied_schema_version smallint
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE resolved_id uuid;
BEGIN
  IF supplied_purpose IS NULL OR supplied_provider IS NULL OR supplied_model_id IS NULL OR supplied_schema_version IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO room_scan_model_versions (purpose, provider, model_id, schema_version)
    VALUES (supplied_purpose, supplied_provider, supplied_model_id, supplied_schema_version)
    ON CONFLICT (purpose, provider, model_id, schema_version) DO NOTHING;
  SELECT version.id INTO resolved_id FROM room_scan_model_versions version
    WHERE version.purpose = supplied_purpose AND version.provider = supplied_provider
      AND version.model_id = supplied_model_id AND version.schema_version = supplied_schema_version;
  RETURN resolved_id;
END;
$$;

-- Records one structured scan against a draft request.
--
-- Idempotent by session id: a retried request carrying the same id returns the
-- stored scan untouched rather than inserting a second copy of every room and
-- object. A different id for the same request replaces the previous scan inside
-- this transaction, because a re-scan corrects the whole handoff and keeping
-- both would double every count downstream.
CREATE FUNCTION tideway_private.record_room_scan(
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
      OR char_length(COALESCE(room_entry->>'note','')) > 1000
    THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-room-scan-room'; END IF;

    INSERT INTO room_scans (room_scan_session_id, room_name, condition, note, sort_order)
      VALUES (proposed_session_id, room_entry->>'roomName', supplied_condition, COALESCE(room_entry->>'note',''), room_index)
      RETURNING id INTO inserted_scan_id;

    IF room_entry ? 'objects' AND jsonb_typeof(room_entry->'objects') <> 'null' THEN
      IF jsonb_typeof(room_entry->'objects') <> 'array' THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-room-scan-room'; END IF;
      object_count := jsonb_array_length(room_entry->'objects');
      total_objects := total_objects + object_count;
      IF object_count > 40 OR total_objects > 200 THEN
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

-- Records a correction without destroying what was originally detected. The
-- object row is updated so the customer sees their own change, and the delta is
-- appended so the original detection survives as a training label.
CREATE FUNCTION tideway_private.correct_room_scan_object(
  target_object_id uuid, supplied_field text, supplied_value text, supplied_training_consent boolean
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  object_record room_scan_objects%ROWTYPE;
  request_status text;
  original_value text;
  stored_value text;
  result jsonb;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('landlord') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='landlord-required';
  END IF;
  IF supplied_field IS NULL OR supplied_field NOT IN ('label','condition','quantity','removed') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-room-scan-correction';
  END IF;

  SELECT object.* INTO object_record FROM room_scan_objects object
    JOIN room_scans scan ON scan.id = object.room_scan_id
    JOIN room_scan_sessions session ON session.id = scan.room_scan_session_id
    WHERE object.id = target_object_id AND session.landlord_user_id = actor_id
    FOR UPDATE OF object;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='room-scan-object-not-found'; END IF;

  SELECT request.status INTO request_status FROM cleaning_requests request
    JOIN room_scan_sessions session ON session.cleaning_request_id = request.id
    JOIN room_scans scan ON scan.room_scan_session_id = session.id
    WHERE scan.id = object_record.room_scan_id;
  IF request_status <> 'draft' THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='room-scan-not-correctable';
  END IF;

  IF supplied_field = 'label' THEN
    IF char_length(COALESCE(supplied_value,'')) NOT BETWEEN 1 AND 40 THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-room-scan-correction'; END IF;
    original_value := object_record.label;
    stored_value := supplied_value;
    -- A customer rename is a fact about identity, so label confidence becomes
    -- certain while the condition evidence — which the customer did not touch —
    -- keeps its own separate score.
    UPDATE room_scan_objects SET label = supplied_value, confidence_label = 1, origin = 'manual'
      WHERE id = object_record.id;
  ELSIF supplied_field = 'condition' THEN
    IF supplied_value IS NOT NULL AND supplied_value <> '' AND supplied_value NOT IN ('clean','light','medium','heavy') THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-room-scan-correction'; END IF;
    original_value := COALESCE(object_record.condition, '');
    stored_value := COALESCE(supplied_value, '');
    UPDATE room_scan_objects SET condition = NULLIF(supplied_value,''), condition_confirmed = true, confidence_condition = 1
      WHERE id = object_record.id;
  ELSIF supplied_field = 'quantity' THEN
    IF supplied_value IS NULL OR supplied_value !~ '^[0-9]{1,2}$' OR supplied_value::integer NOT BETWEEN 1 AND 20 THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-room-scan-correction'; END IF;
    original_value := object_record.quantity::text;
    stored_value := supplied_value;
    UPDATE room_scan_objects SET quantity = supplied_value::smallint WHERE id = object_record.id;
  ELSE
    original_value := object_record.label;
    stored_value := 'removed';
  END IF;

  INSERT INTO room_scan_object_corrections (
    room_scan_object_id, room_scan_id, corrected_by, field, original_value, corrected_value, training_consent)
    VALUES (object_record.id, object_record.room_scan_id, actor_id, supplied_field,
      left(original_value, 60), left(stored_value, 60), COALESCE(supplied_training_consent, false));

  IF supplied_field = 'removed' THEN
    DELETE FROM room_scan_objects WHERE id = object_record.id;
    RETURN jsonb_build_object('objectId', object_record.id, 'removed', true);
  END IF;

  SELECT jsonb_build_object(
    'objectId', object.id, 'label', object.label, 'quantity', object.quantity,
    'condition', object.condition, 'conditionConfirmed', object.condition_confirmed,
    'confidenceLabel', object.confidence_label, 'confidenceCondition', object.confidence_condition,
    'removed', false)
    INTO result FROM room_scan_objects object WHERE object.id = object_record.id;
  RETURN result;
END;
$$;

-- The customer's own delete. Scan-level for now; per-room deletion is on the
-- roadmap and needs its own reviewed rules about what a partially deleted scan
-- means for an already-generated checklist.
CREATE FUNCTION tideway_private.delete_room_scan(target_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor_id uuid := tideway_private.current_user_id(); removed integer;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('landlord') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='landlord-required';
  END IF;
  WITH deleted AS (
    DELETE FROM room_scan_sessions session
      WHERE session.cleaning_request_id = target_request_id
        AND session.landlord_user_id = actor_id
        AND EXISTS (SELECT 1 FROM cleaning_requests request
          WHERE request.id = session.cleaning_request_id AND request.status = 'draft')
      RETURNING 1)
  SELECT count(*)::integer INTO removed FROM deleted;
  RETURN removed > 0;
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.resolve_room_scan_model_version(text,text,text,smallint) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.record_room_scan(uuid,uuid,text,timestamptz,jsonb,text,text,text,smallint) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.get_room_scan(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.correct_room_scan_object(uuid,text,text,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.delete_room_scan(uuid) FROM PUBLIC;

COMMIT;
