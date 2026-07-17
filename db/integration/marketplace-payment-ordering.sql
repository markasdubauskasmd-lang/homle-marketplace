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

ROLLBACK;
