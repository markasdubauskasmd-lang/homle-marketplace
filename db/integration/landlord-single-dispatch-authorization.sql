\set ON_ERROR_STOP on

BEGIN;
SET LOCAL ROLE tideway_app;
SELECT set_config('app.user_id', '10000000-0000-4000-8000-000000000001', true);
SELECT set_config('app.user_roles', 'landlord,cleaner', true);

DO $$
DECLARE result jsonb;
BEGIN
  SELECT tideway_private.configure_automatic_dispatch('30000000-0000-4000-8000-000000000003'::uuid, true, 1::smallint) INTO result;
  IF result->>'enabled' <> 'true' OR (result->>'attemptLimit')::integer <> 1 OR (result->>'attemptCount')::integer <> 0 OR result->>'lastResult' <> 'authorized' THEN
    RAISE EXCEPTION 'The Landlord one-Cleaner authorization was not stored exactly';
  END IF;
END
$$;

SELECT set_config('app.user_id', '10000000-0000-4000-8000-000000000003', true);
SELECT set_config('app.user_roles', 'landlord', true);

DO $$
BEGIN
  BEGIN
    PERFORM tideway_private.configure_automatic_dispatch('30000000-0000-4000-8000-000000000003'::uuid, true, 1::smallint);
    RAISE EXCEPTION 'An unrelated Landlord authorized Cleaner matching';
  EXCEPTION WHEN no_data_found THEN
    NULL;
  END;
END
$$;

ROLLBACK;
