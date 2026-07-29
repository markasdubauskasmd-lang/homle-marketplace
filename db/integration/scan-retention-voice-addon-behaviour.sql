\set ON_ERROR_STOP on

BEGIN;

DO $privileges$
BEGIN
  -- Spoken instructions are the customer's own words about their home.
  IF has_table_privilege('tideway_app','public.cleaning_request_voice_instructions','SELECT')
    OR has_table_privilege('tideway_app','public.cleaning_request_voice_instructions','INSERT')
  THEN RAISE EXCEPTION 'The runtime role can reach spoken instructions directly'; END IF;
  -- Rates and retention stay readable, because a customer is entitled to see
  -- what they are quoted from and how long their scan is kept. Writing is not.
  IF NOT has_table_privilege('tideway_app','public.scan_pricing_addons','SELECT')
    OR NOT has_table_privilege('tideway_app','public.scan_retention_policy','SELECT')
  THEN RAISE EXCEPTION 'A customer cannot read the extras or the retention policy'; END IF;
  IF has_table_privilege('tideway_app','public.scan_pricing_addons','UPDATE')
    OR has_table_privilege('tideway_app','public.scan_retention_policy','UPDATE')
  THEN RAISE EXCEPTION 'The runtime role can change extras or retention directly'; END IF;
  -- Deletion belongs to the supervised worker, not to a web request.
  IF has_function_privilege('tideway_app','tideway_private.purge_expired_room_scans(integer)','EXECUTE')
  THEN RAISE EXCEPTION 'The web role can run the scan deletion loop'; END IF;
  IF NOT has_function_privilege('tideway_worker','tideway_private.purge_expired_room_scans(integer)','EXECUTE')
  THEN RAISE EXCEPTION 'The worker cannot run the scan deletion loop'; END IF;
END
$privileges$;

SELECT set_config('app.user_id','10000000-0000-4000-8000-000000000001',true);
SELECT set_config('app.user_roles','landlord',true);

INSERT INTO cleaning_requests (
  id, landlord_user_id, property_id, status, requested_start_at, requested_end_at,
  cleaning_type, required_services, budget_pence, scope_fingerprint, submitted_at
) VALUES
  ('3c000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','draft',
   now() + interval '80 hours', now() + interval '82 hours','standard',ARRAY['standard-clean'],10000,repeat('e',64),NULL);

DO $voice$
DECLARE stored jsonb;
BEGIN
  stored := tideway_private.record_request_voice_instructions('3c000000-0000-4000-8000-000000000001',
    '[{"roomName":"Study","instruction":"Move the paperwork","kind":"restriction","subject":"the paperwork","priority":"high","excluded":true},
      {"roomName":"Kitchen","instruction":"Degrease the worktops","kind":"request","priority":"normal","excluded":false},
      {"roomName":"Hallway","instruction":"Mind the loose bottom stair","kind":"safety","priority":"high","excluded":false}]'::jsonb);
  IF jsonb_array_length(stored) <> 3 THEN RAISE EXCEPTION 'Spoken instructions were not stored'; END IF;
  IF stored->0->>'kind' <> 'restriction' OR stored->0->>'priority' <> 'high' THEN
    RAISE EXCEPTION 'A restriction lost its kind or priority';
  END IF;

  -- Replaced wholesale, for the same reason measurements are: a half-updated set
  -- is two versions of what the customer said.
  stored := tideway_private.record_request_voice_instructions('3c000000-0000-4000-8000-000000000001',
    '[{"roomName":"Kitchen","instruction":"Degrease the worktops","kind":"request","excluded":false}]'::jsonb);
  IF jsonb_array_length(stored) <> 1 THEN RAISE EXCEPTION 'Re-recording left stale instructions behind'; END IF;

  BEGIN
    PERFORM tideway_private.record_request_voice_instructions('3c000000-0000-4000-8000-000000000001',
      '[{"roomName":"Study","instruction":"Move the paperwork","kind":"urgent"}]'::jsonb);
    RAISE EXCEPTION 'An unrecognised instruction kind was stored';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'invalid-voice-instruction' THEN RAISE; END IF;
  END;

  IF jsonb_array_length(tideway_private.get_request_voice_instructions('3c000000-0000-4000-8000-000000000001')) <> 1 THEN
    RAISE EXCEPTION 'Stored instructions did not reach the participant projection';
  END IF;
END
$voice$;

-- One customer's spoken instructions are not another's.
SELECT set_config('app.user_id','10000000-0000-4000-8000-000000000003',true);
DO $outsider$
BEGIN
  BEGIN
    PERFORM tideway_private.get_request_voice_instructions('3c000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'An unrelated account read another customer''s spoken instructions';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    IF SQLERRM <> 'request-not-found' THEN RAISE; END IF;
  END;
END
$outsider$;

-- A scanner release must not widen the separate Cleaner workspace. Cleaner
-- access to operational instructions is introduced only through its own
-- reviewed booking feature, not through this Landlord scanner projection.
SELECT set_config('app.user_id','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('app.user_roles','cleaner',true);
DO $cleaner_isolation$
BEGIN
  BEGIN
    PERFORM tideway_private.get_request_voice_instructions('3c000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'The scanner widened Cleaner access to private customer instructions';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    IF SQLERRM <> 'request-not-found' THEN RAISE; END IF;
  END;
END
$cleaner_isolation$;

SELECT set_config('app.user_id','10000000-0000-4000-8000-000000000001',true);
SELECT set_config('app.user_roles','landlord',true);
DO $landlord_limits$
BEGIN
  -- Prices are an Administrator's decision, not a customer's.
  BEGIN
    PERFORM tideway_private.upsert_scan_pricing_addon('oven-deep-clean','Oven deep clean',4500,45,true);
    RAISE EXCEPTION 'A Landlord created a chargeable extra';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    IF SQLERRM <> 'administrator-required' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM tideway_private.set_scan_retention_policy(1,1);
    RAISE EXCEPTION 'A Landlord changed the retention policy';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    IF SQLERRM <> 'administrator-required' THEN RAISE; END IF;
  END;
  -- But may read both.
  PERFORM tideway_private.list_scan_pricing_addons();
  PERFORM tideway_private.get_scan_retention_policy();
END
$landlord_limits$;

SELECT set_config('app.user_id','10000000-0000-4000-8000-000000000004',true);
SELECT set_config('app.user_roles','administrator',true);
DO $administrator$
DECLARE addons jsonb; policy jsonb;
BEGIN
  addons := tideway_private.upsert_scan_pricing_addon('oven-deep-clean','Oven deep clean',4500,45,true);
  IF jsonb_array_length(addons) <> 1 OR (addons->0->>'pence')::integer <> 4500 THEN
    RAISE EXCEPTION 'The extra was not stored at its reviewed amount';
  END IF;
  -- Upsert by code, so editing a price does not create a second extra a customer
  -- could be charged twice for.
  addons := tideway_private.upsert_scan_pricing_addon('oven-deep-clean','Oven deep clean',5000,45,true);
  IF jsonb_array_length(addons) <> 1 OR (addons->0->>'pence')::integer <> 5000 THEN
    RAISE EXCEPTION 'Editing an extra created a duplicate';
  END IF;
  -- Deactivating removes it from what a customer can choose, without destroying
  -- the record of what was once charged.
  addons := tideway_private.upsert_scan_pricing_addon('oven-deep-clean','Oven deep clean',5000,45,false);
  IF jsonb_array_length(addons) <> 0 THEN RAISE EXCEPTION 'A deactivated extra is still offered'; END IF;
  IF NOT EXISTS (SELECT 1 FROM scan_pricing_addons WHERE code='oven-deep-clean') THEN
    RAISE EXCEPTION 'Deactivating an extra destroyed its record';
  END IF;

  BEGIN
    PERFORM tideway_private.upsert_scan_pricing_addon('Oven Deep Clean!','Oven',4500,45,true);
    RAISE EXCEPTION 'A malformed extra code was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'invalid-pricing-addon' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM tideway_private.upsert_scan_pricing_addon('absurd','Absurd',999999,45,true);
    RAISE EXCEPTION 'An absurdly priced extra was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'invalid-pricing-addon' THEN RAISE; END IF;
  END;

  IF NOT EXISTS (SELECT 1 FROM audit_logs WHERE action='scan-pricing-addon-updated') THEN
    RAISE EXCEPTION 'A change to what a customer can be charged was not audited';
  END IF;

  policy := tideway_private.set_scan_retention_policy(14, 365);
  IF (policy->>'abandonedDays')::integer <> 14 THEN RAISE EXCEPTION 'The retention policy was not saved'; END IF;
  -- A scan a Cleaner worked from is the evidence in any dispute, so it cannot be
  -- deleted sooner than one nobody ever used.
  BEGIN
    PERFORM tideway_private.set_scan_retention_policy(365, 14);
    RAISE EXCEPTION 'Booked scans were set to be deleted before unbooked ones';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'invalid-retention-policy' THEN RAISE; END IF;
  END;
  IF NOT EXISTS (SELECT 1 FROM audit_logs WHERE action='scan-retention-policy-updated') THEN
    RAISE EXCEPTION 'A retention change was not audited';
  END IF;
END
$administrator$;

-- Deletion actually deletes, and only what is due.
DO $retention$
DECLARE removed integer; session_id uuid := '3d000000-0000-4000-8000-000000000001';
BEGIN
  PERFORM tideway_private.set_scan_retention_policy(30, 730);
  INSERT INTO room_scan_sessions (id, cleaning_request_id, landlord_user_id, device_class, captured_at, created_at)
    VALUES (session_id, '3c000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
      'guided-web', now() - interval '100 days', now() - interval '100 days');
  INSERT INTO room_scans (id, room_scan_session_id, room_name, condition, note, sort_order)
    VALUES ('3e000000-0000-4000-8000-000000000001', session_id, 'Kitchen', 'light', '', 0);
  INSERT INTO room_scan_objects (room_scan_id, inventory_key, label, quantity, condition, origin)
    VALUES ('3e000000-0000-4000-8000-000000000001', 'hob', 'Hob', 1, 'light', 'vision');

  -- A fresh scan on another request must survive.
  INSERT INTO room_scan_sessions (id, cleaning_request_id, landlord_user_id, device_class, captured_at, created_at)
    VALUES ('3d000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000001', 'guided-web', now(), now());

  removed := tideway_private.purge_expired_room_scans(100);
  IF removed <> 1 THEN RAISE EXCEPTION 'Retention removed % scans rather than one', removed; END IF;
  IF EXISTS (SELECT 1 FROM room_scan_sessions WHERE id = session_id) THEN
    RAISE EXCEPTION 'An expired scan survived deletion';
  END IF;
  -- Deleting the session must take its contents with it: a scan existing with
  -- half its rooms is worse than one deleted cleanly.
  IF EXISTS (SELECT 1 FROM room_scans WHERE id = '3e000000-0000-4000-8000-000000000001')
    OR EXISTS (SELECT 1 FROM room_scan_objects WHERE inventory_key = 'hob' AND room_scan_id = '3e000000-0000-4000-8000-000000000001')
  THEN RAISE EXCEPTION 'Deleting a scan left its rooms or objects behind'; END IF;
  IF NOT EXISTS (SELECT 1 FROM room_scan_sessions WHERE id = '3d000000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'Retention deleted a scan that was not due';
  END IF;

  BEGIN
    PERFORM tideway_private.purge_expired_room_scans(0);
    RAISE EXCEPTION 'An unbounded deletion batch was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'invalid-purge-batch-limit' THEN RAISE; END IF;
  END;
END
$retention$;

ROLLBACK;
