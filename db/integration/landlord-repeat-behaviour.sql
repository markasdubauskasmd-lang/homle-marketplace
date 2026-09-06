\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE repeat_test_marker (id integer);
CREATE FUNCTION pg_temp.repeat_scope(uuid,uuid) RETURNS SETOF jsonb LANGUAGE sql STABLE AS $query$
SELECT scope_snapshot FROM (SELECT booking.id, booking.landlord_user_id, booking.property_id, booking.cleaner_user_id, booking.status, booking.scope_snapshot FROM bookings booking JOIN properties property ON property.id=booking.property_id AND property.landlord_user_id=booking.landlord_user_id AND property.archived_at IS NULL WHERE booking.id=$1::uuid AND booking.landlord_user_id=$2::uuid AND booking.status='completed') repeated
$query$;
SELECT set_config('app.user_id','10000000-0000-4000-8000-000000000001',true);
SELECT set_config('app.user_roles','landlord',true);
DO $test$
BEGIN
  IF (SELECT count(*) FROM pg_temp.repeat_scope('42000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001'))<>1 THEN
    RAISE EXCEPTION 'Owner could not read completed frozen scope through runtime role';
  END IF;
  IF (SELECT value->'tasks'->0->>'description' FROM pg_temp.repeat_scope('42000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001') value)<>'Clean worktops' THEN
    RAISE EXCEPTION 'Repeat scope did not preserve approved tasks';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.repeat_scope('42000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001')) THEN
    RAISE EXCEPTION 'Noncompleted booking exposed repeat scope';
  END IF;
END $test$;
SELECT set_config('app.user_id','10000000-0000-4000-8000-000000000003',true);
DO $test$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_temp.repeat_scope('42000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003'))
     OR EXISTS (SELECT 1 FROM pg_temp.repeat_scope('42000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001')) THEN
    RAISE EXCEPTION 'Unrelated account read another owner frozen scope';
  END IF;
END $test$;
SELECT set_config('app.user_id','10000000-0000-4000-8000-000000000001',true);
SELECT tideway_private.archive_my_property('22000000-0000-4000-8000-000000000004');
DO $test$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_temp.repeat_scope('42000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001')) THEN
    RAISE EXCEPTION 'Archived property exposed repeat scope';
  END IF;
END $test$;
ROLLBACK;
