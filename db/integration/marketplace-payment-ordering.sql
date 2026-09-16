\set ON_ERROR_STOP on

BEGIN;

SELECT set_config('app.user_id', '10000000-0000-4000-8000-000000000004', true);
SELECT set_config('app.user_roles', 'administrator', true);

DO $payment_ordering$
DECLARE
  booking_record bookings%ROWTYPE;
  result jsonb;
  blocked boolean;
  occurred timestamptz := now()-interval '4 minutes';
BEGIN
  SELECT * INTO booking_record FROM bookings WHERE id='40000000-0000-4000-8000-000000000003' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment-ordering booking fixture is missing'; END IF;
  UPDATE bookings SET status='completed',updated_at=now() WHERE id=booking_record.id;
  INSERT INTO booking_payments(id,booking_id,landlord_user_id,cleaner_user_id,provider,currency,amount_pence,amount_captured_pence,status,terms_fingerprint,provider_payment_id,idempotency_key_hash,authorized_at,captured_at,last_provider_event_at)
  VALUES('50000000-0000-4000-8000-000000000010',booking_record.id,booking_record.landlord_user_id,booking_record.cleaner_user_id,'stripe','gbp',booking_record.customer_price_pence,booking_record.customer_price_pence,'captured',booking_record.terms_fingerprint,'pi_payment_ordering',decode(repeat('d1',32),'hex'),now()-interval '1 hour',now()-interval '30 minutes',now()-interval '10 minutes');
  INSERT INTO tideway_private.cleaner_payout_accounts(cleaner_user_id,provider,destination_account_id,charges_enabled,payouts_enabled,details_submitted)
  VALUES(booking_record.cleaner_user_id,'stripe','acct_integration_ordering',true,true,true);

  PERFORM * FROM tideway_private.begin_booking_payment_command('51000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000010','refund',1000,decode(repeat('d2',32),'hex'));
  blocked := false;
  BEGIN
    PERFORM * FROM tideway_private.begin_booking_payment_command('51000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000010','refund',1000,decode(repeat('d3',32),'hex'));
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'payment-not-refundable' THEN RAISE; END IF;
    blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'A second refund was reserved while the first refund was live'; END IF;
  blocked := false;
  BEGIN
    PERFORM * FROM tideway_private.begin_booking_payment_command('51000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000010','transfer',NULL,decode(repeat('d4',32),'hex'));
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'payment-not-transferable' THEN RAISE; END IF;
    blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Cleaner transfer began while a refund was live'; END IF;

  UPDATE payment_commands SET status='provider-failed' WHERE id='51000000-0000-4000-8000-000000000001';
  PERFORM * FROM tideway_private.begin_booking_payment_command('51000000-0000-4000-8000-000000000004','50000000-0000-4000-8000-000000000010','transfer',NULL,decode(repeat('d5',32),'hex'));
  blocked := false;
  BEGIN
    PERFORM * FROM tideway_private.begin_booking_payment_command('51000000-0000-4000-8000-000000000005','50000000-0000-4000-8000-000000000010','refund',1000,decode(repeat('d6',32),'hex'));
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'payment-not-refundable' THEN RAISE; END IF;
    blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Refund began after Cleaner transfer was reserved'; END IF;

  PERFORM * FROM tideway_private.record_booking_payment_command('51000000-0000-4000-8000-000000000004','tr_payment_ordering','pending');
  result := tideway_private.reconcile_payment_provider_event('stripe','evt_ordering_transfer_1','transfer-succeeded','tr_payment_ordering','50000000-0000-4000-8000-000000000010','51000000-0000-4000-8000-000000000004',booking_record.cleaner_pay_pence,'gbp',occurred,repeat('a',64));
  IF result->>'accepted'<>'true' OR result->>'duplicate'<>'false' THEN RAISE EXCEPTION 'First Cleaner transfer event did not reconcile'; END IF;
  result := tideway_private.reconcile_payment_provider_event('stripe','evt_ordering_transfer_2','transfer-succeeded','tr_payment_ordering','50000000-0000-4000-8000-000000000010','51000000-0000-4000-8000-000000000004',booking_record.cleaner_pay_pence,'gbp',occurred+interval '1 second',repeat('b',64));
  IF result->>'duplicate'<>'true' THEN RAISE EXCEPTION 'A second event re-applied the same Cleaner transfer'; END IF;
  result := tideway_private.reconcile_payment_provider_event('stripe','evt_ordering_transfer_reverse','transfer-reversed','tr_payment_ordering','50000000-0000-4000-8000-000000000010','51000000-0000-4000-8000-000000000004',booking_record.cleaner_pay_pence,'gbp',occurred+interval '2 seconds',repeat('c',64));
  IF result->>'accepted'<>'true' OR (SELECT status FROM payment_commands WHERE id='51000000-0000-4000-8000-000000000004')<>'provider-failed' THEN RAISE EXCEPTION 'Verified Cleaner transfer reversal did not reopen the money boundary'; END IF;

  PERFORM * FROM tideway_private.begin_booking_payment_command('51000000-0000-4000-8000-000000000006','50000000-0000-4000-8000-000000000010','refund',1000,decode(repeat('d7',32),'hex'));
  PERFORM * FROM tideway_private.record_booking_payment_command('51000000-0000-4000-8000-000000000006','re_payment_ordering','pending');
  result := tideway_private.reconcile_payment_provider_event('stripe','evt_ordering_refund_1','refund-succeeded','re_payment_ordering','50000000-0000-4000-8000-000000000010','51000000-0000-4000-8000-000000000006',1000,'gbp',occurred+interval '3 seconds',repeat('d',64));
  IF result->>'accepted'<>'true' OR (SELECT amount_refunded_pence FROM booking_payments WHERE id='50000000-0000-4000-8000-000000000010')<>1000 THEN RAISE EXCEPTION 'First refund event did not reconcile exactly once'; END IF;
  result := tideway_private.reconcile_payment_provider_event('stripe','evt_ordering_refund_2','refund-succeeded','re_payment_ordering','50000000-0000-4000-8000-000000000010','51000000-0000-4000-8000-000000000006',1000,'gbp',occurred+interval '4 seconds',repeat('e',64));
  IF result->>'duplicate'<>'true' OR (SELECT amount_refunded_pence FROM booking_payments WHERE id='50000000-0000-4000-8000-000000000010')<>1000 THEN RAISE EXCEPTION 'A second event applied the same refund twice'; END IF;

  result := tideway_private.reconcile_payment_provider_event('stripe','evt_ordering_invalid_regression','authorization-succeeded','pi_payment_ordering','50000000-0000-4000-8000-000000000010',NULL,booking_record.customer_price_pence,'gbp',occurred+interval '5 seconds',repeat('f',64));
  IF result->>'stateConflict'<>'true' OR (SELECT status FROM booking_payments WHERE id='50000000-0000-4000-8000-000000000010')<>'partially-refunded' THEN RAISE EXCEPTION 'A late authorization event regressed captured/refunded payment state'; END IF;
END
$payment_ordering$;


-- Restore the existing receipt fixture after exercising both response orders.
SAVEPOINT authorization_response_ordering;
DO $authorization_response_ordering$
DECLARE
  payment booking_payments%ROWTYPE;
  previous_payment booking_payments%ROWTYPE;
  expected_status text;
  response_status text;
  history_count bigint;
  result jsonb;
  blocked boolean;
BEGIN
  FOREACH expected_status IN ARRAY ARRAY['authorized','captured','partially-refunded','refunded','cancelled','disputed'] LOOP
    UPDATE booking_payments SET status=expected_status WHERE id='50000000-0000-4000-8000-000000000010';
    SELECT * INTO previous_payment FROM booking_payments WHERE id='50000000-0000-4000-8000-000000000010';
    SELECT count(*) INTO history_count FROM payment_status_history WHERE payment_id='50000000-0000-4000-8000-000000000010';
    FOREACH response_status IN ARRAY ARRAY['requires-customer-action','processing','authorized','failed'] LOOP
      payment := tideway_private.record_booking_payment_authorization('50000000-0000-4000-8000-000000000010','pi_payment_ordering',response_status);
      IF payment.status <> expected_status THEN RAISE EXCEPTION 'Late % response regressed % state',response_status,expected_status; END IF;
      IF ROW(payment.amount_pence,payment.amount_captured_pence,payment.amount_refunded_pence,payment.authorized_at,payment.captured_at,payment.cancelled_at,payment.last_provider_event_at)
        IS DISTINCT FROM ROW(previous_payment.amount_pence,previous_payment.amount_captured_pence,previous_payment.amount_refunded_pence,previous_payment.authorized_at,previous_payment.captured_at,previous_payment.cancelled_at,previous_payment.last_provider_event_at)
        THEN RAISE EXCEPTION 'Late response changed authoritative money or timestamps'; END IF;
    END LOOP;
    IF (SELECT count(*) FROM payment_status_history WHERE payment_id=payment.id) <> history_count THEN RAISE EXCEPTION 'Ignored late response wrote misleading status history'; END IF;
  END LOOP;

  -- A signed authorization can arrive before the original create call returns.
  UPDATE booking_payments SET status='creating',provider_payment_id=NULL,last_provider_event_at=NULL,
    amount_captured_pence=0,amount_refunded_pence=0,authorized_at=NULL,captured_at=NULL,cancelled_at=NULL
    WHERE id='50000000-0000-4000-8000-000000000010';
  result := tideway_private.reconcile_payment_provider_event('stripe','evt_authorization_before_response','authorization-succeeded','pi_response_race','50000000-0000-4000-8000-000000000010',NULL,
    (SELECT amount_pence FROM booking_payments WHERE id='50000000-0000-4000-8000-000000000010'),'gbp',now()-interval '1 minute',repeat('9',64));
  IF result->>'accepted' <> 'true' THEN RAISE EXCEPTION 'Signed authorization fixture did not reconcile'; END IF;
  blocked := false;
  BEGIN
    PERFORM tideway_private.record_booking_payment_authorization('50000000-0000-4000-8000-000000000010','pi_wrong_response','processing');
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'payment-state-conflict' THEN RAISE; END IF;
    blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Wrong provider identity was attached after signed authorization'; END IF;
  payment := tideway_private.record_booking_payment_authorization('50000000-0000-4000-8000-000000000010','pi_response_race','requires-customer-action');
  IF payment.status <> 'authorized' OR payment.provider_payment_id <> 'pi_response_race' OR payment.authorized_at IS NULL THEN RAISE EXCEPTION 'Create response lost earlier signed authorization'; END IF;
  payment := tideway_private.record_booking_payment_authorization(payment.id,'pi_response_race','failed');
  IF payment.status <> 'authorized' THEN RAISE EXCEPTION 'Duplicate create response regressed authorization'; END IF;

  -- The usual order still starts at processing and waits for signed authority.
  UPDATE booking_payments SET status='creating',provider_payment_id=NULL,last_provider_event_at=NULL,authorized_at=NULL
    WHERE id=payment.id;
  payment := tideway_private.record_booking_payment_authorization(payment.id,'pi_response_first','authorized');
  IF payment.status <> 'processing' OR payment.authorized_at IS NOT NULL THEN RAISE EXCEPTION 'Unsigned API response authorized a booking'; END IF;
  result := tideway_private.reconcile_payment_provider_event('stripe','evt_authorization_after_response','authorization-succeeded','pi_response_first',payment.id,NULL,payment.amount_pence,'gbp',now()-interval '30 seconds',repeat('8',64));
  SELECT * INTO payment FROM booking_payments WHERE id=payment.id;
  IF result->>'accepted' <> 'true' OR payment.status <> 'authorized' THEN RAISE EXCEPTION 'Signed event after response could not authorize'; END IF;

  -- A failed card can still reopen its existing intent for another payment method.
  UPDATE booking_payments SET status='authorization-failed' WHERE id=payment.id;
  payment := tideway_private.record_booking_payment_authorization(payment.id,'pi_response_first','authorized');
  IF payment.status <> 'authorization-failed' THEN RAISE EXCEPTION 'Stale response hid signed authorization failure'; END IF;
  payment := tideway_private.record_booking_payment_authorization(payment.id,'pi_response_first','requires-customer-action');
  IF payment.status <> 'requires-customer-action' THEN RAISE EXCEPTION 'Failed authorization could not reopen for a new payment method'; END IF;

  blocked := false;
  BEGIN
    PERFORM tideway_private.record_booking_payment_authorization(payment.id,'pi_wrong_response','processing');
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'provider-payment-conflict' THEN RAISE; END IF;
    blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Existing provider identity was replaced'; END IF;

  PERFORM set_config('app.user_id','10000000-0000-4000-8000-000000000099',true);
  PERFORM set_config('app.user_roles','landlord',true);
  blocked := false;
  BEGIN
    PERFORM tideway_private.record_booking_payment_authorization(payment.id,'pi_response_first','processing');
  EXCEPTION WHEN SQLSTATE 'P0002' THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Another landlord altered payment authorization'; END IF;
END
$authorization_response_ordering$;
ROLLBACK TO SAVEPOINT authorization_response_ordering;

-- Exercise the SECURITY DEFINER ownership logic on a captured fixture and verify runtime grants.
SELECT set_config('app.user_id', (SELECT landlord_user_id::text FROM bookings WHERE id='40000000-0000-4000-8000-000000000003'), true);
SELECT set_config('app.user_roles', 'landlord', true);
DO $receipt_owner$
DECLARE payment record; blocked boolean := false;
BEGIN
  IF NOT has_function_privilege('tideway_app','tideway_private.read_my_booking_receipt_payment(uuid)','EXECUTE')
    THEN RAISE EXCEPTION 'Runtime role cannot execute the owner-bound receipt lookup'; END IF;
  SELECT * INTO payment FROM tideway_private.read_my_booking_receipt_payment('40000000-0000-4000-8000-000000000003');
  IF payment.provider_payment_id IS DISTINCT FROM 'pi_payment_ordering' OR payment.amount_captured_pence < 1
    THEN RAISE EXCEPTION 'Receipt owner lost the captured provider payment'; END IF;
  IF has_table_privilege('tideway_app','public.booking_payments','SELECT')
    THEN RAISE EXCEPTION 'Receipt access broadened payment table privileges'; END IF;
  PERFORM set_config('app.user_id','10000000-0000-4000-8000-000000000099',true);
  BEGIN
    PERFORM * FROM tideway_private.read_my_booking_receipt_payment('40000000-0000-4000-8000-000000000003');
  EXCEPTION WHEN SQLSTATE 'P0002' OR SQLSTATE '42501' THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Another account read a private receipt payment'; END IF;
  PERFORM set_config('app.user_id','10000000-0000-4000-8000-000000000004',true);
  PERFORM set_config('app.user_roles','administrator',true);
  blocked := false;
  BEGIN
    PERFORM * FROM tideway_private.read_my_booking_receipt_payment('40000000-0000-4000-8000-000000000003');
  EXCEPTION WHEN SQLSTATE '42501' THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Administrator-only context bypassed customer receipt ownership'; END IF;
END
$receipt_owner$;

ROLLBACK;
