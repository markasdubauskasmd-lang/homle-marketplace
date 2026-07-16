\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

DO $verification$
BEGIN
  IF (SELECT count(*) FROM bookings WHERE id::text LIKE '40000000-0000-4000-8000-%') <> 2 THEN RAISE EXCEPTION 'Integration bookings are missing'; END IF;
  IF (SELECT count(*) FROM bookings WHERE id::text LIKE '40000000-0000-4000-8000-%' AND status = 'confirmed') <> 1 THEN RAISE EXCEPTION 'Concurrent acceptance did not produce one confirmed booking'; END IF;
  IF (SELECT count(*) FROM bookings WHERE id::text LIKE '40000000-0000-4000-8000-%' AND status = 'pending-cleaner-acceptance') <> 1 THEN RAISE EXCEPTION 'Losing overlapping invitation did not remain pending'; END IF;
  IF (SELECT count(*) FROM booking_status_history WHERE booking_id::text LIKE '40000000-0000-4000-8000-%' AND to_status = 'confirmed') <> 1 THEN RAISE EXCEPTION 'Confirmation history is not exactly once'; END IF;
  IF (SELECT count(*) FROM conversations WHERE booking_id::text LIKE '40000000-0000-4000-8000-%') <> 1 THEN RAISE EXCEPTION 'Confirmed booking conversation was not created exactly once'; END IF;
END
$verification$;

ROLLBACK;
