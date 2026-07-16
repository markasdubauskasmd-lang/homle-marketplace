\set ON_ERROR_STOP on

BEGIN;

DO $privileges$
BEGIN
  IF has_table_privilege(current_user,'public.disputes','SELECT') OR has_table_privilege(current_user,'public.disputes','INSERT') OR has_table_privilege(current_user,'public.disputes','UPDATE') OR has_table_privilege(current_user,'public.disputes','DELETE') THEN
    RAISE EXCEPTION 'Runtime role can bypass the function-only dispute workflow';
  END IF;
END
$privileges$;

SELECT set_config('app.user_id','10000000-0000-4000-8000-000000000003',true);
SELECT set_config('app.user_roles','landlord',true);
DO $outsider$
BEGIN
  BEGIN
    PERFORM tideway_private.open_booking_dispute('40000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000099','50000000-0000-4000-8000-000000000098','quality','An unrelated integration account must not open this booking case.');
    RAISE EXCEPTION 'Unrelated account opened a booking dispute';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    IF SQLERRM<>'booking-not-found' THEN RAISE; END IF;
  END;
END
$outsider$;

SELECT set_config('app.user_id','10000000-0000-4000-8000-000000000001',true);
SELECT set_config('app.user_roles','landlord',true);
DO $landlord$
DECLARE first_result jsonb; retry_result jsonb;
BEGIN
  first_result:=tideway_private.open_booking_dispute('40000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002','damage','A synthetic kitchen cabinet door was damaged during the integration visit.');
  retry_result:=tideway_private.open_booking_dispute('40000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000002','damage','A synthetic kitchen cabinet door was damaged during the integration visit.');
  IF first_result->>'disputeId'<>'50000000-0000-4000-8000-000000000001' OR retry_result->>'disputeId'<>first_result->>'disputeId' THEN RAISE EXCEPTION 'Dispute opening was not retry-idempotent'; END IF;
  IF (SELECT status FROM bookings WHERE id='40000000-0000-4000-8000-000000000003')<>'disputed' THEN RAISE EXCEPTION 'Opening a dispute did not pause the booking lifecycle'; END IF;
END
$landlord$;

SELECT set_config('app.user_id','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('app.user_roles','cleaner',true);
DO $cleaner$
DECLARE active_result jsonb;
BEGIN
  active_result:=tideway_private.open_booking_dispute('40000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000004','50000000-0000-4000-8000-000000000005','quality','A second participant report should return the already active booking case.');
  IF active_result->>'disputeId'<>'50000000-0000-4000-8000-000000000001' THEN RAISE EXCEPTION 'A second active dispute was created for one booking'; END IF;
END
$cleaner$;

SELECT set_config('app.user_id','10000000-0000-4000-8000-000000000004',true);
SELECT set_config('app.user_roles','administrator',true);
DO $administrator$
DECLARE queue jsonb; reviewing jsonb; resolved jsonb;
BEGIN
  queue:=tideway_private.list_admin_booking_disputes('open',50,0);
  IF jsonb_array_length(queue->'disputes')<>1 OR queue->'disputes'->0->>'openedByRole'<>'landlord' THEN RAISE EXCEPTION 'Administrator dispute queue lost its safe case projection'; END IF;
  reviewing:=tideway_private.review_booking_dispute('50000000-0000-4000-8000-000000000001','reviewing',NULL,NULL);
  IF reviewing->>'status'<>'reviewing' THEN RAISE EXCEPTION 'Administrator could not begin case review'; END IF;
  resolved:=tideway_private.review_booking_dispute('50000000-0000-4000-8000-000000000001','resolved','Synthetic evidence reviewed; the integration booking is recorded as completed.','completed');
  IF resolved->>'status'<>'resolved' OR resolved->>'resolutionOutcome'<>'completed' THEN RAISE EXCEPTION 'Administrator resolution did not record the exact booking outcome'; END IF;
END
$administrator$;

SELECT set_config('app.user_id','10000000-0000-4000-8000-000000000001',true);
SELECT set_config('app.user_roles','landlord',true);
DO $result$
DECLARE participant_result jsonb;
BEGIN
  participant_result:=tideway_private.get_booking_dispute('40000000-0000-4000-8000-000000000003');
  IF participant_result->>'status'<>'resolved' OR participant_result->>'resolutionOutcome'<>'completed' OR participant_result->>'resolutionNote' IS NULL THEN RAISE EXCEPTION 'Participant cannot read the final private case outcome'; END IF;
  IF (SELECT status FROM bookings WHERE id='40000000-0000-4000-8000-000000000003')<>'completed' THEN RAISE EXCEPTION 'Resolved dispute did not return the booking to its recorded outcome'; END IF;
END
$result$;

SELECT set_config('app.user_id','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('app.user_roles','cleaner',true);
SELECT tideway_private.open_booking_dispute(
  '40000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000006','50000000-0000-4000-8000-000000000007',
  'payment','A synthetic post-completion commercial case verifies completion evidence is retained.'
);

SELECT set_config('app.user_id','10000000-0000-4000-8000-000000000004',true);
SELECT set_config('app.user_roles','administrator',true);
SELECT tideway_private.review_booking_dispute(
  '50000000-0000-4000-8000-000000000006','resolved',
  'Synthetic evidence reviewed; the commercial booking outcome is recorded as cancelled.','cancelled'
);

DO $completion_evidence$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM bookings WHERE id='40000000-0000-4000-8000-000000000003' AND status='cancelled' AND completed_at IS NOT NULL AND cancelled_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Post-completion dispute erased the recorded visit completion evidence';
  END IF;
END
$completion_evidence$;

COMMIT;
