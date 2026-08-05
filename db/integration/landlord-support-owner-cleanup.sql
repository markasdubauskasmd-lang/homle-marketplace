\set ON_ERROR_STOP on

BEGIN;
DO $verify$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM bookings WHERE id='48000000-0000-4000-8000-000000000001' AND status='confirmed') THEN
    RAISE EXCEPTION 'A booking-change request silently changed the confirmed booking';
  END IF;
END
$verify$;
DELETE FROM bookings WHERE id='48000000-0000-4000-8000-000000000001';
COMMIT;
