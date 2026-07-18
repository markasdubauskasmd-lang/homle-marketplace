\set ON_ERROR_STOP on

BEGIN;
SELECT set_config('app.user_id', '10000000-0000-4000-8000-000000000004', true);
SELECT set_config('app.user_roles', 'administrator', true);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM tideway_private.recommend_cleaners_for_request_v2('30000000-0000-4000-8000-000000000003', 25)
    WHERE cleaner_id = '10000000-0000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION 'A landlord was recommended as a cleaner for their own request';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM tideway_private.recommend_cleaners_for_request_v2('30000000-0000-4000-8000-000000000003', 25)
    WHERE cleaner_id = '10000000-0000-4000-8000-000000000002'
  ) THEN
    RAISE EXCEPTION 'The independent eligible cleaner was not recommended';
  END IF;
END
$$;

ROLLBACK;
