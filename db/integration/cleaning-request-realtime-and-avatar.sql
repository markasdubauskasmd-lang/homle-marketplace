\set ON_ERROR_STOP on

BEGIN;
SET LOCAL ROLE tideway_app;
SELECT set_config('app.user_id', '10000000-0000-4000-8000-000000000001', true);
SELECT set_config('app.user_roles', 'landlord,cleaner', true);

DO $$
DECLARE snapshot jsonb; session_record record;
BEGIN
  SELECT tideway_private.get_cleaning_request_realtime_snapshot('30000000-0000-4000-8000-000000000003'::uuid,0,100) INTO snapshot;
  IF snapshot->>'requestId' <> '30000000-0000-4000-8000-000000000003'
    OR snapshot->>'status' <> 'searching-for-cleaner'
    OR jsonb_typeof(snapshot->'automaticDispatch') <> 'object'
    OR position('Private test address' IN snapshot::text)>0
    OR position('integration-cleaner@' IN snapshot::text)>0 THEN
    RAISE EXCEPTION 'The Landlord request live snapshot is incomplete or leaks private/candidate identity data';
  END IF;
  SELECT * INTO session_record FROM tideway_private.lookup_session(decode(repeat('11',32),'hex'));
  IF session_record.avatar_url <> 'https://images.invalid.example/integration-landlord.jpg' THEN
    RAISE EXCEPTION 'The verified account avatar was not retained by the secure session projection';
  END IF;
END
$$;

SELECT set_config('app.user_id', '10000000-0000-4000-8000-000000000003', true);
SELECT set_config('app.user_roles', 'landlord', true);
DO $$
BEGIN
  BEGIN
    PERFORM tideway_private.get_cleaning_request_realtime_snapshot('30000000-0000-4000-8000-000000000003'::uuid,0,100);
    RAISE EXCEPTION 'An unrelated Landlord subscribed to a private cleaning request';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
END
$$;

ROLLBACK;
