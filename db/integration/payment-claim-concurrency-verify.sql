\set ON_ERROR_STOP on
DO $verify$
DECLARE w tideway_private.payment_command_attempt_windows%ROWTYPE;
BEGIN
 SELECT * INTO STRICT w FROM tideway_private.payment_command_attempt_windows WHERE command_id='54000000-0000-4000-8000-000000000002';
 IF w.retry_before<>w.first_attempt_at+interval '23 hours' OR w.legacy_unknown OR w.request_hash<>decode(repeat('f3',32),'hex')
   OR w.request_identity->>'amountPence'<>'1000' OR w.request_identity->>'providerPaymentId'<>'pi_concurrent_claim'
   THEN RAISE EXCEPTION 'Concurrent claims changed the immutable attempt identity or deadline'; END IF;
 IF w.first_attempt_at<'2021-01-01'::timestamptz AND (w.first_attempt_at<>'2020-01-01T00:00:00Z'::timestamptz OR w.retry_before<>'2020-01-01T23:00:00Z'::timestamptz)
   THEN RAISE EXCEPTION 'Expired concurrent retries reset the original deadline'; END IF;
 IF NOT EXISTS(SELECT 1 FROM payment_commands WHERE id=w.command_id AND status='created' AND provider_command_id IS NULL AND NOT provider_success_applied AND NOT provider_terminal_failure)
   OR NOT EXISTS(SELECT 1 FROM booking_payments WHERE id='54000000-0000-4000-8000-000000000001' AND amount_refunded_pence=0)
   THEN RAISE EXCEPTION 'Attempt claims improperly altered monetary state'; END IF;
END;
$verify$;
