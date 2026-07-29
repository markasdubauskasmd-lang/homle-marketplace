\set ON_ERROR_STOP on

BEGIN;

-- The structured scan describes the inside of a customer's home. If the runtime
-- role can reach those tables directly, every participant rule below is
-- decoration, so that is asserted before anything else is exercised.
--
-- The role is named explicitly rather than taken from current_user. This script
-- runs as the migration owner so it can also assert on stored rows, and an
-- assertion about the runtime boundary must not quietly become an assertion
-- about whoever happened to run it.
DO $privileges$
DECLARE forbidden text;
BEGIN
  SELECT string_agg(format('%s.%s', target.table_name, target.privilege), ', ')
    INTO forbidden
    FROM (VALUES
      ('room_scan_sessions','SELECT'),('room_scan_sessions','INSERT'),('room_scan_sessions','UPDATE'),('room_scan_sessions','DELETE'),
      ('room_scans','SELECT'),('room_scans','INSERT'),('room_scans','UPDATE'),('room_scans','DELETE'),
      ('room_scan_objects','SELECT'),('room_scan_objects','INSERT'),('room_scan_objects','UPDATE'),('room_scan_objects','DELETE'),
      ('room_scan_object_corrections','SELECT'),('room_scan_object_corrections','INSERT'),
      ('room_scan_object_corrections','UPDATE'),('room_scan_object_corrections','DELETE'),
      ('room_scan_model_versions','INSERT'),('room_scan_model_versions','UPDATE'),('room_scan_model_versions','DELETE')
    ) AS target(table_name, privilege)
    WHERE has_table_privilege('tideway_app', format('public.%I', target.table_name), target.privilege);
  IF forbidden IS NOT NULL THEN
    RAISE EXCEPTION 'Runtime role can bypass the function-only room-scan boundary: %', forbidden;
  END IF;
  -- Attribution is not private, and the projection needs to report which model
  -- produced a reading, so the runtime role keeps read access to that one table.
  IF NOT has_table_privilege('tideway_app','public.room_scan_model_versions','SELECT') THEN
    RAISE EXCEPTION 'Runtime role cannot read model-version attribution';
  END IF;
END
$privileges$;

SELECT set_config('app.user_id','10000000-0000-4000-8000-000000000001',true);
SELECT set_config('app.user_roles','landlord',true);

INSERT INTO cleaning_requests (
  id, landlord_user_id, property_id, status, requested_start_at, requested_end_at,
  cleaning_type, required_services, budget_pence, scope_fingerprint, submitted_at
) VALUES
  ('3a000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','draft',
   now() + interval '72 hours', now() + interval '74 hours','standard',ARRAY['standard-clean'],10000,repeat('d',64),NULL);

INSERT INTO cleaning_request_tasks (cleaning_request_id, room_name, description, sort_order) VALUES
  ('3a000000-0000-4000-8000-000000000001','Kitchen','Degrease the worktops',0);

-- Submission requires a completed room photo, so the frozen-scope assertions at
-- the end of this script have a submittable request to work against.
INSERT INTO cleaning_request_photos (
  id, cleaning_request_id, storage_key, room_name, note, mime_type, byte_size,
  checksum_sha256, width_pixels, height_pixels, sanitized_at
) VALUES (
  '6a000000-0000-4000-8000-000000000001','3a000000-0000-4000-8000-000000000001',
  'request-photos/3a000000-0000-4000-8000-000000000001/6a000000-0000-4000-8000-000000000001.jpg',
  'Kitchen','Synthetic integration room photo','image/jpeg',1000,decode(repeat('da',32),'hex'),800,600,now());

DO $record$
DECLARE recorded jsonb; kitchen jsonb; hob jsonb; window_row jsonb;
BEGIN
  recorded := tideway_private.record_room_scan(
    '3b000000-0000-4000-8000-000000000001',
    '3a000000-0000-4000-8000-000000000001',
    'guided-web', now(),
    '[{"roomName":"Kitchen","condition":"medium","note":"Focus on the marks near the window.","objects":[
        {"inventoryKey":"hob","label":"Hob","quantity":1,"condition":"heavy","soiling":["grease"],
         "confidenceLabel":0.91,"confidenceCondition":0.83,"conditionConfirmed":false,
         "evidence":"dark glossy streaks around the burners","origin":"vision"},
        {"inventoryKey":"window","label":"Window","quantity":2,"condition":"unknown","soiling":[],
         "confidenceLabel":0.77,"confidenceCondition":0,"conditionConfirmed":false,
         "evidence":"","origin":"detector"}]},
      {"roomName":"Bathroom","condition":"","note":"","objects":[]}]'::jsonb,
    'confirmation','anthropic','claude-haiku-4-5',1::smallint);

  IF jsonb_array_length(recorded->'rooms') <> 2 THEN RAISE EXCEPTION 'Recording a scan did not store every room'; END IF;
  IF recorded->'session'->>'deviceClass' <> 'guided-web' THEN RAISE EXCEPTION 'Device class was not recorded'; END IF;
  IF recorded->'session'->'model'->>'modelId' <> 'claude-haiku-4-5' THEN RAISE EXCEPTION 'Reading was not attributed to a model version'; END IF;

  kitchen := recorded->'rooms'->0;
  IF kitchen->>'roomName' <> 'Kitchen' OR kitchen->>'condition' <> 'medium' THEN RAISE EXCEPTION 'Room order or condition was not preserved'; END IF;
  -- A room the reader could not judge must survive as absence of assessment.
  -- Flattening it to a grade is the exact failure the scanner refuses to make
  -- on the device, and storage must not reintroduce it.
  IF (recorded->'rooms'->1->>'condition') IS NOT NULL THEN RAISE EXCEPTION 'An unassessed room was stored as a grade'; END IF;

  SELECT value INTO hob FROM jsonb_array_elements(kitchen->'objects') WHERE value->>'inventoryKey'='hob';
  SELECT value INTO window_row FROM jsonb_array_elements(kitchen->'objects') WHERE value->>'inventoryKey'='window';
  IF hob->>'condition' <> 'heavy' OR hob->'soiling'->>0 <> 'grease' THEN RAISE EXCEPTION 'Per-object condition or soiling was lost'; END IF;
  IF hob->>'evidence' <> 'dark glossy streaks around the burners' THEN RAISE EXCEPTION 'Evidence supporting the grade was lost'; END IF;
  -- The whole point of two scores: an object can be confidently named and
  -- honestly ungraded at the same time.
  IF (window_row->>'confidenceLabel')::numeric <> 0.770 OR (window_row->>'confidenceCondition')::numeric <> 0 THEN
    RAISE EXCEPTION 'Label and condition confidence were not stored independently'; END IF;
  IF (window_row->>'condition') IS NOT NULL THEN RAISE EXCEPTION 'An unknown object condition was stored as a grade'; END IF;
  IF (window_row->>'quantity')::integer <> 2 THEN RAISE EXCEPTION 'Proven object quantity was lost'; END IF;
END
$record$;

-- A retried handoff carries the same session id. It must be absorbed, not
-- duplicated: a second copy of every room would double every count downstream.
DO $idempotent$
DECLARE repeated jsonb; room_total integer; object_total integer;
BEGIN
  repeated := tideway_private.record_room_scan(
    '3b000000-0000-4000-8000-000000000001',
    '3a000000-0000-4000-8000-000000000001',
    'guided-web', now(),
    '[{"roomName":"Kitchen","condition":"heavy","note":"","objects":[]}]'::jsonb,
    'confirmation','anthropic','claude-haiku-4-5',1::smallint);
  IF jsonb_array_length(repeated->'rooms') <> 2 THEN RAISE EXCEPTION 'A retried scan was not idempotent'; END IF;
  IF repeated->'rooms'->0->>'condition' <> 'medium' THEN RAISE EXCEPTION 'A retried scan overwrote the stored reading'; END IF;
  SELECT count(*) INTO room_total FROM room_scans scan
    JOIN room_scan_sessions session ON session.id = scan.room_scan_session_id
    WHERE session.cleaning_request_id = '3a000000-0000-4000-8000-000000000001';
  SELECT count(*) INTO object_total FROM room_scan_objects object
    JOIN room_scans scan ON scan.id = object.room_scan_id
    JOIN room_scan_sessions session ON session.id = scan.room_scan_session_id
    WHERE session.cleaning_request_id = '3a000000-0000-4000-8000-000000000001';
  IF room_total <> 2 OR object_total <> 2 THEN RAISE EXCEPTION 'A retried scan duplicated stored rows'; END IF;
END
$idempotent$;

-- A genuinely new scan replaces the previous one. Keeping both would double
-- every object the customer scanned twice.
DO $replace$
DECLARE replaced jsonb; session_total integer;
BEGIN
  replaced := tideway_private.record_room_scan(
    '3b000000-0000-4000-8000-000000000002',
    '3a000000-0000-4000-8000-000000000001',
    'camera-fallback', now(),
    '[{"roomName":"Kitchen","condition":"light","note":"","objects":[
        {"inventoryKey":"worktop","label":"Worktop","quantity":1,"condition":"clean","soiling":[],
         "confidenceLabel":0.95,"confidenceCondition":0.9,"conditionConfirmed":false,"evidence":"","origin":"vision"}]}]'::jsonb,
    'confirmation','anthropic','claude-haiku-4-5',1::smallint);
  IF jsonb_array_length(replaced->'rooms') <> 1 THEN RAISE EXCEPTION 'A re-scan did not replace the previous scan'; END IF;
  SELECT count(*) INTO session_total FROM room_scan_sessions WHERE cleaning_request_id = '3a000000-0000-4000-8000-000000000001';
  IF session_total <> 1 THEN RAISE EXCEPTION 'A re-scan left more than one scan attached to the request'; END IF;
  -- 'clean' is a real answer, not a missing one, and must not be nulled.
  IF replaced->'rooms'->0->'objects'->0->>'condition' <> 'clean' THEN RAISE EXCEPTION 'A clean object was not stored as clean'; END IF;
END
$replace$;

-- Corrections record the delta and never destroy the original detection: the
-- detected value is the training label and the corrected value is the truth the
-- customer asserted.
DO $corrections$
DECLARE target uuid; renamed jsonb; correction_row record; surviving integer;
BEGIN
  SELECT object.id INTO target FROM room_scan_objects object
    JOIN room_scans scan ON scan.id = object.room_scan_id
    JOIN room_scan_sessions session ON session.id = scan.room_scan_session_id
    WHERE session.cleaning_request_id = '3a000000-0000-4000-8000-000000000001';

  renamed := tideway_private.correct_room_scan_object(target,'label','Kitchen worktop',true);
  IF renamed->>'label' <> 'Kitchen worktop' THEN RAISE EXCEPTION 'A customer rename was not applied'; END IF;
  -- Renaming settles identity, not surface condition. The two scores must not
  -- move together.
  IF (renamed->>'confidenceLabel')::numeric <> 1 THEN RAISE EXCEPTION 'A customer rename did not settle label confidence'; END IF;
  IF (renamed->>'confidenceCondition')::numeric <> 0.900 THEN RAISE EXCEPTION 'A rename overwrote unrelated condition confidence'; END IF;

  SELECT * INTO correction_row FROM room_scan_object_corrections WHERE room_scan_object_id = target AND field = 'label';
  IF correction_row.original_value <> 'Worktop' THEN RAISE EXCEPTION 'The original detected label was not retained'; END IF;
  IF correction_row.training_consent IS NOT TRUE THEN RAISE EXCEPTION 'Explicit training consent was not recorded'; END IF;

  PERFORM tideway_private.correct_room_scan_object(target,'removed',NULL,false);
  IF EXISTS (SELECT 1 FROM room_scan_objects WHERE id = target) THEN RAISE EXCEPTION 'A removed object survived'; END IF;
  -- A rejected detection is the most informative label there is. It must
  -- outlive the object row it describes.
  SELECT count(*) INTO surviving FROM room_scan_object_corrections WHERE room_scan_object_id = target;
  IF surviving <> 2 THEN RAISE EXCEPTION 'Removing an object destroyed the record that it was rejected'; END IF;
END
$corrections$;

-- No training consent unless the customer gave it for that specific correction.
DO $consent$
DECLARE target uuid; recorded_consent boolean;
BEGIN
  PERFORM tideway_private.record_room_scan(
    '3b000000-0000-4000-8000-000000000003','3a000000-0000-4000-8000-000000000001','guided-web', now(),
    '[{"roomName":"Kitchen","condition":"light","note":"","objects":[
        {"inventoryKey":"sink","label":"Sink","quantity":1,"condition":"light","soiling":["limescale"],
         "confidenceLabel":0.8,"confidenceCondition":0.4,"conditionConfirmed":false,"evidence":"ring marks","origin":"vision"}]}]'::jsonb,
    'confirmation','anthropic','claude-haiku-4-5',1::smallint);
  SELECT object.id INTO target FROM room_scan_objects object
    JOIN room_scans scan ON scan.id = object.room_scan_id
    JOIN room_scan_sessions session ON session.id = scan.room_scan_session_id
    WHERE session.cleaning_request_id = '3a000000-0000-4000-8000-000000000001';
  PERFORM tideway_private.correct_room_scan_object(target,'condition','medium',NULL);
  SELECT training_consent INTO recorded_consent FROM room_scan_object_corrections
    WHERE room_scan_object_id = target AND field = 'condition';
  IF recorded_consent IS NOT FALSE THEN RAISE EXCEPTION 'An unstated training consent did not default to false'; END IF;
END
$consent$;

-- Bounds, so one malformed handoff cannot write an unbounded amount of data.
DO $bounds$
BEGIN
  BEGIN
    PERFORM tideway_private.record_room_scan(
      '3b000000-0000-4000-8000-000000000004','3a000000-0000-4000-8000-000000000001','guided-web', now(),
      (SELECT jsonb_build_array(jsonb_build_object('roomName','Kitchen','condition','light','note','','objects',
        (SELECT jsonb_agg(jsonb_build_object('inventoryKey','item-'||generation,'label','Item '||generation,'quantity',1,
          'condition','light','soiling','[]'::jsonb,'confidenceLabel',0.5,'confidenceCondition',0.5,
          'conditionConfirmed',false,'evidence','','origin','vision')) FROM generate_series(1,41) AS generation)))),
      'confirmation','anthropic','claude-haiku-4-5',1::smallint);
    RAISE EXCEPTION 'An oversized room was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'room-scan-object-limit' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM tideway_private.record_room_scan(
      '3b000000-0000-4000-8000-000000000005','3a000000-0000-4000-8000-000000000001','guided-web', now(),
      '[{"roomName":"Kitchen","condition":"light","note":"","objects":[
          {"inventoryKey":"bin","label":"Bin","quantity":1,"condition":"light","soiling":[],
           "confidenceLabel":0.5,"confidenceCondition":0.5,"conditionConfirmed":false,"evidence":"","origin":"invented"}]}]'::jsonb,
      'confirmation','anthropic','claude-haiku-4-5',1::smallint);
    RAISE EXCEPTION 'An unrecognised object origin was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'invalid-room-scan-object' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM tideway_private.record_room_scan(
      '3b000000-0000-4000-8000-000000000006','3a000000-0000-4000-8000-000000000001','guided-web', now(),
      '[{"roomName":"Kitchen","condition":"filthy","note":"","objects":[]}]'::jsonb,
      'confirmation','anthropic','claude-haiku-4-5',1::smallint);
    RAISE EXCEPTION 'An unrecognised room condition was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'invalid-room-scan-room' THEN RAISE; END IF;
  END;
END
$bounds$;

-- One customer must never reach another customer's rooms.
SELECT set_config('app.user_id','10000000-0000-4000-8000-000000000003',true);
SELECT set_config('app.user_roles','landlord',true);
DO $outsider$
BEGIN
  BEGIN
    PERFORM tideway_private.get_room_scan('3a000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'An unrelated account read another customer room scan';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    IF SQLERRM <> 'request-not-found' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM tideway_private.record_room_scan(
      '3b000000-0000-4000-8000-000000000007','3a000000-0000-4000-8000-000000000001','guided-web', now(),
      '[{"roomName":"Kitchen","condition":"light","note":"","objects":[]}]'::jsonb,
      'confirmation','anthropic','claude-haiku-4-5',1::smallint);
    RAISE EXCEPTION 'An unrelated account recorded a scan against another customer request';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    IF SQLERRM <> 'request-not-found' THEN RAISE; END IF;
  END;
END
$outsider$;

-- An uninvited Cleaner is not a participant either.
SELECT set_config('app.user_id','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('app.user_roles','cleaner',true);
DO $cleaner$
BEGIN
  BEGIN
    PERFORM tideway_private.get_room_scan('3a000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'An uninvited Cleaner read a private room scan';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    IF SQLERRM <> 'request-not-found' THEN RAISE; END IF;
  END;
END
$cleaner$;

SELECT set_config('app.user_id','10000000-0000-4000-8000-000000000001',true);
SELECT set_config('app.user_roles','landlord',true);

-- Measurements carry their provenance or they are not stored. Under the
-- web-only decision nothing here is exact, and a bare number would sit in the
-- same column as the rest and look exactly like them.
DO $measurements$
DECLARE target uuid; stored jsonb;
BEGIN
  SELECT scan.id INTO target FROM room_scans scan
    JOIN room_scan_sessions session ON session.id = scan.room_scan_session_id
    WHERE session.cleaning_request_id = '3a000000-0000-4000-8000-000000000001' LIMIT 1;

  stored := tideway_private.record_room_scan_measurements(target,
    '[{"subject":"room-length","method":"reference-calibrated","valueMm":3400,"toleranceMm":420,"confidence":"medium","reference":"bank-card"},
      {"subject":"ceiling-height","method":"user-confirmed","valueMm":2400,"toleranceMm":0,"confidence":"high"}]'::jsonb);
  IF jsonb_array_length(stored) <> 2 THEN RAISE EXCEPTION 'Room measurements were not stored'; END IF;
  -- Selected by subject, not by position: the projection orders by subject, and
  -- a test that assumes an index is asserting on the sort order rather than on
  -- the measurement it means to check.
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(stored) AS entry
    WHERE entry.value->>'subject' = 'room-length' AND entry.value->>'reference' = 'bank-card')
  THEN RAISE EXCEPTION 'A measurement lost the reference it was scaled from'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(stored) AS entry
    WHERE entry.value->>'subject' = 'ceiling-height' AND (entry.value->>'toleranceMm')::bigint = 0)
  THEN RAISE EXCEPTION 'A customer-confirmed exact figure was not stored as exact'; END IF;

  -- Recording replaces wholesale. A floor area derived from a length and a
  -- width must never outlive the figures it came from, and leaving a stale one
  -- behind would store two numbers that disagree.
  stored := tideway_private.record_room_scan_measurements(target,
    '[{"subject":"room-length","method":"user-confirmed","valueMm":3600,"toleranceMm":20,"confidence":"high","originalValueMm":3400}]'::jsonb);
  IF jsonb_array_length(stored) <> 1 THEN RAISE EXCEPTION 'Re-measuring a room left stale measurements behind'; END IF;
  IF (stored->0->>'originalValueMm')::bigint <> 3400 THEN RAISE EXCEPTION 'Correcting a measurement destroyed the original estimate'; END IF;

  -- An estimate with no band would read as exact for ever after.
  BEGIN
    PERFORM tideway_private.record_room_scan_measurements(target,
      '[{"subject":"room-width","method":"reference-calibrated","valueMm":2600,"toleranceMm":0,"confidence":"medium"}]'::jsonb);
    RAISE EXCEPTION 'An estimated measurement was stored with no tolerance';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'room-measurement-needs-tolerance' THEN RAISE; END IF;
  END;

  -- No browser can produce a sensor reading, and a stored one would claim an
  -- accuracy nothing delivered.
  BEGIN
    PERFORM tideway_private.record_room_scan_measurements(target,
      '[{"subject":"room-width","method":"sensor","valueMm":2600,"toleranceMm":5,"confidence":"high"}]'::jsonb);
    RAISE EXCEPTION 'A sensor measurement was accepted from a web client';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'room-measurement-method-unavailable' THEN RAISE; END IF;
  END;

  -- The measurements reach the participant projection alongside the objects.
  IF jsonb_array_length(tideway_private.get_room_scan('3a000000-0000-4000-8000-000000000001')->'rooms'->0->'measurements') <> 1 THEN
    RAISE EXCEPTION 'Stored measurements did not reach the room projection';
  END IF;
END
$measurements$;

-- A submitted request is frozen scope a Cleaner may already have accepted work
-- against, so neither a new scan nor a correction may change it underneath them.
DO $frozen$
DECLARE target uuid;
BEGIN
  SELECT object.id INTO target FROM room_scan_objects object
    JOIN room_scans scan ON scan.id = object.room_scan_id
    JOIN room_scan_sessions session ON session.id = scan.room_scan_session_id
    WHERE session.cleaning_request_id = '3a000000-0000-4000-8000-000000000001';
  PERFORM tideway_private.submit_cleaning_request('3a000000-0000-4000-8000-000000000001',true,false);

  BEGIN
    PERFORM tideway_private.record_room_scan(
      '3b000000-0000-4000-8000-000000000008','3a000000-0000-4000-8000-000000000001','guided-web', now(),
      '[{"roomName":"Kitchen","condition":"heavy","note":"","objects":[]}]'::jsonb,
      'confirmation','anthropic','claude-haiku-4-5',1::smallint);
    RAISE EXCEPTION 'A submitted request accepted a replacement scan';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'room-scan-not-recordable' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM tideway_private.correct_room_scan_object(target,'condition','heavy',false);
    RAISE EXCEPTION 'A submitted scan accepted a correction';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'room-scan-not-correctable' THEN RAISE; END IF;
  END;

  -- The owner can still read their own submitted scan.
  IF jsonb_array_length(tideway_private.get_room_scan('3a000000-0000-4000-8000-000000000001')->'rooms') <> 1 THEN
    RAISE EXCEPTION 'The owner lost read access to their own submitted scan'; END IF;
END
$frozen$;

ROLLBACK;
