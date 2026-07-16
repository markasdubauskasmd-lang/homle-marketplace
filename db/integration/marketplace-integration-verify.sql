\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

DO $verification$
BEGIN
  IF (SELECT count(*) FROM bookings WHERE id::text LIKE '40000000-0000-4000-8000-%') <> 3 THEN RAISE EXCEPTION 'Integration bookings are missing'; END IF;
  IF (SELECT count(*) FROM bookings WHERE id::text LIKE '40000000-0000-4000-8000-%' AND status = 'confirmed') <> 1 THEN RAISE EXCEPTION 'Concurrent acceptance did not produce one confirmed booking'; END IF;
  IF (SELECT count(*) FROM bookings WHERE id::text LIKE '40000000-0000-4000-8000-%' AND status = 'pending-cleaner-acceptance') <> 1 THEN RAISE EXCEPTION 'Losing overlapping invitation did not remain pending'; END IF;
  IF (SELECT count(*) FROM bookings WHERE id='40000000-0000-4000-8000-000000000003' AND status='cancelled' AND completed_at IS NOT NULL AND cancelled_at IS NOT NULL) <> 1 THEN RAISE EXCEPTION 'Resolved dispute booking outcome or completion evidence is missing'; END IF;
  IF (SELECT count(*) FROM disputes WHERE id IN ('50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000006') AND status='resolved' AND assigned_admin_user_id='10000000-0000-4000-8000-000000000004') <> 2 THEN RAISE EXCEPTION 'Audited Administrator dispute resolutions are missing'; END IF;
  IF (SELECT count(*) FROM booking_status_history WHERE booking_id='40000000-0000-4000-8000-000000000003' AND to_status IN ('disputed','completed','cancelled')) <> 4 THEN RAISE EXCEPTION 'Dispute booking history is not exactly once'; END IF;
  IF (SELECT count(*) FROM audit_logs WHERE resource_id IN ('50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000006') AND action IN ('booking-dispute-opened','booking-dispute-review-started','booking-dispute-resolved')) <> 5 THEN RAISE EXCEPTION 'Dispute audit trail is incomplete'; END IF;
  IF (SELECT count(*) FROM booking_status_history WHERE booking_id::text LIKE '40000000-0000-4000-8000-%' AND to_status = 'confirmed') <> 1 THEN RAISE EXCEPTION 'Confirmation history is not exactly once'; END IF;
  IF (SELECT count(*) FROM conversations WHERE booking_id::text LIKE '40000000-0000-4000-8000-%') <> 1 THEN RAISE EXCEPTION 'Confirmed booking conversation was not created exactly once'; END IF;
END
$verification$;

ROLLBACK;
