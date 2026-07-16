\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

SELECT set_config('app.user_id', '10000000-0000-4000-8000-000000000002', true);
SELECT set_config('app.user_roles', 'cleaner', true);
DO $cleaner$
BEGIN
  IF (SELECT count(*) FROM bookings WHERE id::text LIKE '40000000-0000-4000-8000-%' AND status = 'confirmed') <> 1 THEN RAISE EXCEPTION 'Exactly one overlapping booking was not confirmed'; END IF;
  IF (SELECT count(*) FROM properties WHERE id::text LIKE '20000000-0000-4000-8000-%') <> 1 THEN RAISE EXCEPTION 'Cleaner property access did not follow the accepted booking'; END IF;
END
$cleaner$;

SELECT set_config('app.user_id', '10000000-0000-4000-8000-000000000003', true);
SELECT set_config('app.user_roles', 'landlord', true);
DO $outsider$
BEGIN
  IF (SELECT count(*) FROM bookings WHERE id::text LIKE '40000000-0000-4000-8000-%') <> 0 THEN RAISE EXCEPTION 'Unrelated account gained booking access after acceptance'; END IF;
  IF (SELECT count(*) FROM properties WHERE id::text LIKE '20000000-0000-4000-8000-%') <> 0 THEN RAISE EXCEPTION 'Unrelated account gained property access after acceptance'; END IF;
END
$outsider$;

ROLLBACK;
