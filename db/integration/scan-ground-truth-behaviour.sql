\set ON_ERROR_STOP on

BEGIN;

-- Reviewer verdicts about the scanner's grading: administrator-only, validated
-- at the boundary, overwriting on re-review, aggregated without identifiers,
-- and gone the moment the scan they describe is deleted.

DO $privileges$
BEGIN
  IF has_table_privilege('tideway_app','public.room_scan_ground_truth','SELECT')
    OR has_table_privilege('tideway_app','public.room_scan_ground_truth','INSERT')
  THEN RAISE EXCEPTION 'The runtime role can reach reviewer verdicts directly'; END IF;
  IF NOT has_function_privilege('tideway_app','tideway_private.record_scan_ground_truth(uuid,text,jsonb,boolean,text,boolean)','EXECUTE')
  THEN RAISE EXCEPTION 'The runtime role cannot record ground truth through the reviewed function'; END IF;
END
$privileges$;

-- A scan to review, created by its Landlord exactly as production does.
SELECT set_config('app.user_id','10000000-0000-4000-8000-000000000001',true);
SELECT set_config('app.user_roles','landlord',true);

INSERT INTO cleaning_requests (
  id, landlord_user_id, property_id, status, requested_start_at, requested_end_at,
  cleaning_type, required_services, budget_pence, scope_fingerprint, submitted_at
) VALUES
  ('3f000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','draft',
   now() + interval '90 hours', now() + interval '92 hours','standard',ARRAY['standard-clean'],10000,repeat('f',64),NULL);

DO $setup$
BEGIN
  PERFORM tideway_private.record_room_scan(
    '3f000000-0000-4000-8000-000000000002',
    '3f000000-0000-4000-8000-000000000001',
    'guided-web', now(),
    '[{"roomName":"Kitchen","condition":"light","note":"","objects":[
        {"inventoryKey":"sink","label":"Sink","quantity":1,"condition":"clean","soiling":[],
         "confidenceLabel":0.9,"confidenceCondition":0.62,"conditionConfirmed":false,
         "evidence":"","origin":"vision"}]}]'::jsonb,
    'confirmation','anthropic','claude-haiku-4-5',2::smallint);
END
$setup$;

DO $review$
DECLARE
  truth_object_id uuid;
  recorded jsonb;
  queue jsonb;
  report jsonb;
BEGIN
  SELECT id INTO truth_object_id FROM room_scan_objects WHERE inventory_key = 'sink'
    AND room_scan_id IN (SELECT id FROM room_scans WHERE room_scan_session_id IN
      (SELECT id FROM room_scan_sessions WHERE cleaning_request_id = '3f000000-0000-4000-8000-000000000001'));

  -- A Landlord is not a reviewer, however much it is their own scan.
  BEGIN
    PERFORM tideway_private.record_scan_ground_truth(truth_object_id, 'medium', '["food-debris"]'::jsonb, true, '', false);
    RAISE EXCEPTION 'A Landlord recorded ground truth';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    IF SQLERRM <> 'administrator-required' THEN RAISE; END IF;
  END;

  PERFORM set_config('app.user_id','10000000-0000-4000-8000-000000000004',true);
  PERFORM set_config('app.user_roles','administrator',true);

  -- The queue shows the model's own claim, so the reviewer knows what is being
  -- checked — and nothing else about the home.
  queue := tideway_private.list_scan_ground_truth_queue(50);
  IF NOT queue::text LIKE '%"label": "Sink"%' AND NOT queue::text LIKE '%"label":"Sink"%' THEN
    RAISE EXCEPTION 'The unreviewed sink is not in the queue';
  END IF;
  IF queue::text LIKE '%note%' AND queue::text LIKE '%transcript%' THEN
    RAISE EXCEPTION 'Customer notes leaked into the review queue';
  END IF;

  -- The dirty-sink case itself: the model said clean, the reviewer says medium
  -- with washing-up in it.
  recorded := tideway_private.record_scan_ground_truth(truth_object_id, 'medium', '["food-debris","clutter"]'::jsonb, true, 'stacked washing-up', false);
  IF recorded->>'condition' <> 'medium' THEN RAISE EXCEPTION 'The verdict was not stored'; END IF;
  IF (recorded->>'trainingConsented')::boolean THEN RAISE EXCEPTION 'Consent appeared from nowhere'; END IF;

  -- Re-review overwrites: the latest reviewed truth is the truth, once.
  recorded := tideway_private.record_scan_ground_truth(truth_object_id, 'heavy', '["food-debris"]'::jsonb, true, '', true);
  IF (SELECT count(*) FROM room_scan_ground_truth WHERE room_scan_object_id = truth_object_id) <> 1 THEN
    RAISE EXCEPTION 'Re-reviewing duplicated the label';
  END IF;

  -- A reviewed object leaves the queue.
  queue := tideway_private.list_scan_ground_truth_queue(50);
  IF queue::text LIKE '%' || truth_object_id::text || '%' THEN
    RAISE EXCEPTION 'A reviewed object is still queued';
  END IF;

  -- The report is counts and pairs, never identifiers.
  report := tideway_private.scan_ground_truth_report();
  IF (report->>'labelledTotal')::integer <> 1 THEN RAISE EXCEPTION 'The report did not count the label'; END IF;
  IF (report->>'falseCleanCount')::integer <> 1 THEN RAISE EXCEPTION 'A clean verdict over a dirty sink was not counted as a false clean'; END IF;
  IF report::text LIKE '%3f000000-0000-4000-8000-000000000001%' THEN RAISE EXCEPTION 'The aggregate report leaked a request id'; END IF;

  -- An out-of-scale verdict is refused, not coerced.
  BEGIN
    PERFORM tideway_private.record_scan_ground_truth(truth_object_id, 'filthy', '[]'::jsonb, true, '', false);
    RAISE EXCEPTION 'An out-of-scale verdict was stored';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'invalid-ground-truth' THEN RAISE; END IF;
  END;

  -- Deleting the scan takes the derived label with it: retention and customer
  -- deletion must never leave reviewer verdicts describing a purged home.
  PERFORM set_config('app.user_id','10000000-0000-4000-8000-000000000001',true);
  PERFORM set_config('app.user_roles','landlord',true);
  PERFORM tideway_private.delete_room_scan('3f000000-0000-4000-8000-000000000001');
  IF EXISTS (SELECT 1 FROM room_scan_ground_truth WHERE room_scan_object_id = truth_object_id) THEN
    RAISE EXCEPTION 'A ground-truth label outlived the scan it describes';
  END IF;
END
$review$;

ROLLBACK;
