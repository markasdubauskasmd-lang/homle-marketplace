\set ON_ERROR_STOP on
BEGIN;
UPDATE bookings SET cleaner_response_deadline=now()-interval '1 minute'
WHERE id='40000000-0000-4000-8000-000000000005' AND status='pending-cleaner-acceptance';
DO $$ BEGIN
  IF (SELECT count(*) FROM bookings WHERE id='40000000-0000-4000-8000-000000000005' AND status='pending-cleaner-acceptance' AND cleaner_response_deadline<now())<>1 THEN
    RAISE EXCEPTION 'Second automatic-dispatch invitation was unavailable for expiry';
  END IF;
END $$;
COMMIT;
