\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

DO $assertion$
BEGIN
  IF current_database() !~ '_tideway_test$' THEN
    RAISE EXCEPTION 'Integration tests require a database name ending in _tideway_test';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.users
    WHERE id IN (
      '10000000-0000-4000-8000-000000000001'::uuid,
      '10000000-0000-4000-8000-000000000002'::uuid,
      '10000000-0000-4000-8000-000000000003'::uuid
    )
  ) THEN
    RAISE EXCEPTION 'Reserved Tideway integration fixtures already exist';
  END IF;
END
$assertion$;

ROLLBACK;
