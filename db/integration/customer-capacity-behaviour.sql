\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('app.user_id','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('app.user_roles','cleaner',true);
SAVEPOINT before_withdrawal;
DELETE FROM cleaner_availability WHERE cleaner_user_id='10000000-0000-4000-8000-000000000002';
DO $withdrawn$
DECLARE current_booking bookings%ROWTYPE;
BEGIN
  BEGIN
    PERFORM tideway_private.respond_to_cleaner_invitation('40000000-0000-4000-8000-000000000001','accept',NULL);
    RAISE EXCEPTION 'Withdrawn capacity confirmed a booking';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'cleaner-unavailable' THEN RAISE; END IF;
  END;
  SELECT * INTO current_booking FROM bookings WHERE id='40000000-0000-4000-8000-000000000001';
  IF current_booking.status<>'pending-cleaner-acceptance' OR current_booking.confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Failed capacity check left a confirmed assignment';
  END IF;
END $withdrawn$;
ROLLBACK TO SAVEPOINT before_withdrawal;
DO $expired$
DECLARE first_result bookings%ROWTYPE; retry_result bookings%ROWTYPE;
BEGIN
  SELECT * INTO first_result FROM tideway_private.respond_to_cleaner_invitation('4f000000-0000-4000-8000-000000000001','accept',NULL);
  SELECT * INTO retry_result FROM tideway_private.respond_to_cleaner_invitation('4f000000-0000-4000-8000-000000000001','accept',NULL);
  IF first_result.status<>'cancelled' OR first_result.expired_at IS NULL
    OR first_result.confirmed_at IS NOT NULL OR first_result.responded_at IS NOT NULL
    OR retry_result.expired_at IS DISTINCT FROM first_result.expired_at THEN
    RAISE EXCEPTION 'Elapsed invitation deadline confirmed or duplicated an assignment';
  END IF;
END $expired$;
SELECT set_config('app.user_id','10000000-0000-4000-8000-000000000001',true);
SELECT set_config('app.user_roles','landlord',true);
DO $customer_recovery$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cleaning_requests WHERE id='30000000-0000-4000-8000-000000000003' AND status='searching-for-cleaner') THEN
    RAISE EXCEPTION 'Expired invitation did not reopen customer matching';
  END IF;
  IF (SELECT count(*) FROM notifications WHERE booking_id='4f000000-0000-4000-8000-000000000001' AND event_type='cleaner-invitation-expired')<>1 THEN
    RAISE EXCEPTION 'Expiry retry lost or duplicated the customer recovery notice';
  END IF;
END $customer_recovery$;
ROLLBACK;
