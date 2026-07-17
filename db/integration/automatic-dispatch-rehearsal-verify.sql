\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;
DO $$ BEGIN
  IF (SELECT count(*) FROM bookings WHERE id IN ('40000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000005') AND status='cancelled' AND expired_at IS NOT NULL)<>2 THEN
    RAISE EXCEPTION 'Automatic-dispatch invitations were not both expired safely';
  END IF;
  IF (SELECT count(DISTINCT cleaner_user_id) FROM bookings WHERE id IN ('40000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000005'))<>2 THEN
    RAISE EXCEPTION 'Automatic dispatch retried the same Cleaner';
  END IF;
  IF (SELECT count(*) FROM cleaning_requests WHERE id='30000000-0000-4000-8000-000000000004' AND status='searching-for-cleaner' AND automatic_dispatch_last_result='attempt-limit' AND automatic_dispatch_lease_token IS NULL)<>1 THEN
    RAISE EXCEPTION 'Automatic dispatch did not stop cleanly at the approved attempt limit';
  END IF;
  IF (SELECT count(*) FROM booking_status_history WHERE booking_id IN ('40000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000005') AND to_status='pending-cleaner-acceptance' AND change_source='system')<>2 THEN
    RAISE EXCEPTION 'Automatic invitations lack exact system-owned history';
  END IF;
  IF (SELECT count(*) FROM booking_status_history WHERE booking_id IN ('40000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000005') AND to_status='cancelled' AND change_source='system')<>2 THEN
    RAISE EXCEPTION 'Automatic invitation expiry lacks exact system-owned history';
  END IF;
  IF (SELECT count(*) FROM audit_logs WHERE action='automatic-dispatch-invited' AND resource_id IN ('40000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000005'))<>2 THEN
    RAISE EXCEPTION 'Automatic dispatch audit evidence is incomplete';
  END IF;
END $$;
ROLLBACK;
