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
  IF (SELECT count(*) FROM tideway_private.facebook_data_deletion_requests WHERE id IN (
    '73000000-0000-4000-8000-000000000001',
    '73000000-0000-4000-8000-000000000002',
    '73000000-0000-4000-8000-000000000003'
  )) <> 2 THEN RAISE EXCEPTION 'Facebook deletion retry created a duplicate confirmation record'; END IF;
  IF (SELECT count(*) FROM tideway_private.facebook_data_deletion_requests callback
      JOIN privacy_requests request ON request.id = callback.privacy_request_id
      WHERE callback.id = '73000000-0000-4000-8000-000000000001'
        AND callback.provider_subject_hash = decode(repeat('e1', 32), 'hex')
        AND callback.fallback_status = 'requested'
        AND callback.completed_at IS NULL
        AND request.user_id = '10000000-0000-4000-8000-000000000001'
        AND request.request_type = 'deletion'
        AND request.status = 'requested') <> 1 THEN
    RAISE EXCEPTION 'Known Facebook subject was not bound to the correct private deletion queue item';
  END IF;
  IF (SELECT count(*) FROM tideway_private.facebook_data_deletion_requests
      WHERE id = '73000000-0000-4000-8000-000000000003'
        AND provider_subject_hash = decode(repeat('e3', 32), 'hex')
        AND privacy_request_id IS NULL
        AND fallback_status = 'completed'
        AND completed_at IS NOT NULL) <> 1 THEN
    RAISE EXCEPTION 'Unknown Facebook subject did not remain account-unlinked and honestly completed';
  END IF;
  IF (SELECT count(*) FROM audit_logs
      WHERE actor_user_id = '10000000-0000-4000-8000-000000000001'
        AND action = 'privacy-request.created'
        AND metadata->>'requestType' = 'deletion'
        AND metadata->>'source' = 'facebook-data-deletion-callback') <> 1 THEN
    RAISE EXCEPTION 'Facebook deletion callback audit evidence is missing or duplicated';
  END IF;
END
$verification$;

ROLLBACK;
