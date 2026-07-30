-- Ground truth for the scanner's condition grading.
--
-- The accuracy plan (docs/ROOM_SCAN_ARCHITECTURE_AUDIT.md §9, and the honest
-- limitation repeated in every phase since) has always ended the same way: the
-- benchmark runs on synthetic fixtures because nothing collects reviewed
-- verdicts about real scans. This is that collection point. An internal
-- reviewer records what an object's condition actually was; the report compares
-- those verdicts with what the model said, in aggregate; and the false-clean
-- rate stops being unknowable the day real scans exist.
--
-- Two properties are load-bearing:
--
--   1. Labels live exactly as long as the scan they describe. The row cascades
--      from room_scan_objects, so retention purges and customer deletion take
--      the derived data with the original — a label about a deleted scan is
--      still a statement about somebody's home.
--   2. A label may only feed TRAINING when the reviewer attests consent exists.
--      `training_consented` defaults false, and the queue/report functions
--      never expose media or notes to anything but the administrator surface.
BEGIN;

CREATE TABLE room_scan_ground_truth (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_scan_object_id uuid NOT NULL UNIQUE REFERENCES room_scan_objects(id) ON DELETE CASCADE,
  reviewer_user_id uuid NOT NULL REFERENCES users(id),
  -- The reviewed truth. 'unknown' is a real reviewer verdict — "this photo
  -- cannot show it" — and recording it keeps the model's own 'unknown's honest.
  condition text NOT NULL CHECK (condition IN ('clean','light','medium','heavy','unknown')),
  soiling text[] NOT NULL DEFAULT '{}'::text[] CHECK (
    array_length(soiling, 1) IS NULL OR (
      array_length(soiling, 1) <= 4
      AND soiling <@ ARRAY['dust','grease','limescale','stain','mould','soap-scum','food-debris','pet-hair','damage','clutter']::text[]
    )
  ),
  -- Whether the model's object NAME was right, judged separately from the
  -- condition — the two error rates answer different questions.
  label_correct boolean NOT NULL,
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 500),
  training_consented boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE room_scan_ground_truth ENABLE ROW LEVEL SECURITY;
-- No policy on purpose: like the scan tables it derives from, every read and
-- write goes through the reviewed functions below.

-- Records one reviewer verdict about one object. Re-reviewing overwrites — the
-- latest reviewed truth is the truth — and every change is audited, so a
-- disagreement between reviewers is visible in the log rather than silent.
CREATE FUNCTION tideway_private.record_scan_ground_truth(
  target_object_id uuid, supplied_condition text, supplied_soiling jsonb,
  supplied_label_correct boolean, supplied_notes text, supplied_training_consented boolean
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  object_record room_scan_objects%ROWTYPE;
  soiling_list text[];
  stored room_scan_ground_truth%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('administrator') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='administrator-required';
  END IF;
  SELECT * INTO object_record FROM room_scan_objects WHERE id = target_object_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='scan-object-not-found'; END IF;
  IF jsonb_typeof(COALESCE(supplied_soiling, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-ground-truth';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT value #>> '{}'), '{}'::text[]) INTO soiling_list
    FROM jsonb_array_elements(COALESCE(supplied_soiling, '[]'::jsonb));
  BEGIN
    INSERT INTO room_scan_ground_truth
        (room_scan_object_id, reviewer_user_id, condition, soiling, label_correct, notes, training_consented)
      VALUES (target_object_id, actor_id, supplied_condition, soiling_list,
        COALESCE(supplied_label_correct, false), left(trim(COALESCE(supplied_notes,'')), 500),
        COALESCE(supplied_training_consented, false))
    ON CONFLICT (room_scan_object_id) DO UPDATE SET
      reviewer_user_id = actor_id, condition = excluded.condition, soiling = excluded.soiling,
      label_correct = excluded.label_correct, notes = excluded.notes,
      training_consented = excluded.training_consented, updated_at = now()
      RETURNING * INTO stored;
  EXCEPTION WHEN check_violation OR not_null_violation OR invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-ground-truth';
  END;
  INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
    VALUES (actor_id, 'scan-ground-truth-recorded', 'room_scan_ground_truth', stored.id,
      jsonb_build_object('objectId', target_object_id, 'condition', supplied_condition,
        'labelCorrect', COALESCE(supplied_label_correct, false)));
  RETURN jsonb_build_object(
    'groundTruthId', stored.id, 'objectId', stored.room_scan_object_id,
    'condition', stored.condition, 'soiling', to_jsonb(stored.soiling),
    'labelCorrect', stored.label_correct, 'trainingConsented', stored.training_consented);
END;
$$;

-- Objects awaiting review, oldest scans first. Administrator-only, and bounded.
-- Returns what the MODEL said — label, grade, soiling, confidence, evidence —
-- because that is what the reviewer is checking; it never returns customer
-- notes, transcripts or media.
CREATE FUNCTION tideway_private.list_scan_ground_truth_queue(batch_limit integer)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor_id uuid := tideway_private.current_user_id(); queue jsonb;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('administrator') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='administrator-required';
  END IF;
  IF batch_limit IS NULL OR batch_limit NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-queue-limit';
  END IF;
  SELECT COALESCE(jsonb_agg(entry ORDER BY entry->>'capturedAt'), '[]'::jsonb) INTO queue FROM (
    SELECT jsonb_build_object(
      'objectId', object.id,
      'cleaningRequestId', session.cleaning_request_id,
      'roomName', scan.room_name,
      'label', object.label,
      'quantity', object.quantity,
      'condition', COALESCE(object.condition, ''),
      'soiling', to_jsonb(object.soiling),
      'confidenceCondition', object.confidence_condition,
      'conditionConfirmed', object.condition_confirmed,
      'evidence', object.evidence,
      'origin', object.origin,
      'capturedAt', session.captured_at
    ) AS entry
    FROM room_scan_objects object
    JOIN room_scans scan ON scan.id = object.room_scan_id
    JOIN room_scan_sessions session ON session.id = scan.room_scan_session_id
    LEFT JOIN room_scan_ground_truth truth ON truth.room_scan_object_id = object.id
    WHERE truth.id IS NULL
    ORDER BY session.captured_at ASC, object.id ASC
    LIMIT batch_limit
  ) pending;
  RETURN queue;
END;
$$;

-- Aggregate agreement between the model and the reviewed truth. Counts only —
-- the same rule as the shadow-pricing report: a confusion matrix discloses
-- nothing, a list of labelled homes is a list of homes.
CREATE FUNCTION tideway_private.scan_ground_truth_report()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor_id uuid := tideway_private.current_user_id(); report jsonb;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('administrator') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='administrator-required';
  END IF;
  SELECT jsonb_build_object(
    'labelledTotal', COUNT(*),
    'labelCorrectCount', COUNT(*) FILTER (WHERE truth.label_correct),
    'trainingConsentedCount', COUNT(*) FILTER (WHERE truth.training_consented),
    -- The confusion pairs the agreement statistics are computed from. The
    -- model's '' (no assessment) is reported as 'unknown' so the two graders
    -- share one scale.
    'conditionPairs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('model', pair.model, 'truth', pair.truth, 'count', pair.pair_count))
      FROM (
        SELECT COALESCE(NULLIF(object.condition, ''), 'unknown') AS model,
               inner_truth.condition AS truth, COUNT(*) AS pair_count
        FROM room_scan_ground_truth inner_truth
        JOIN room_scan_objects object ON object.id = inner_truth.room_scan_object_id
        GROUP BY 1, 2
      ) pair), '[]'::jsonb),
    -- The number the dirty-sink defect makes worth watching on its own: how
    -- often the model said clean when the reviewer says it was not.
    'falseCleanCount', COUNT(*) FILTER (
      WHERE object.condition = 'clean' AND truth.condition IN ('light','medium','heavy'))
  ) INTO report
  FROM room_scan_ground_truth truth
  JOIN room_scan_objects object ON object.id = truth.room_scan_object_id;
  RETURN COALESCE(report, jsonb_build_object('labelledTotal', 0));
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.record_scan_ground_truth(uuid,text,jsonb,boolean,text,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.list_scan_ground_truth_queue(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.scan_ground_truth_report() FROM PUBLIC;

COMMIT;
