\set ON_ERROR_STOP on

BEGIN;

SELECT set_config('app.user_id', '10000000-0000-4000-8000-000000000004', true);
SELECT set_config('app.user_roles', 'administrator', true);

-- Historical ordering tests now supply synthetic signed parent facts explicitly.
-- Only this owner-run fixture helper seeds frozen transfer attempts; product code
-- must use113 claims and must never infer identity from today's payout account.
CREATE FUNCTION pg_temp.reconcile_bound_fixture_event(provider text,event_id text,kind text,object_id text,payment_id uuid,command_id uuid,amount_pence integer,currency character(3),occurred timestamptz,payload_hash character(64))
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE pi text; source text:='ch_integration_event'; destination text; identity jsonb;
BEGIN
 SELECT provider_payment_id INTO pi FROM booking_payments WHERE id=payment_id;
 IF kind LIKE 'transfer-%' THEN
   SELECT request_identity INTO identity FROM tideway_private.payment_command_attempt_windows WHERE payment_command_attempt_windows.command_id=reconcile_bound_fixture_event.command_id;
   IF identity IS NULL THEN
     identity:=jsonb_build_object('providerPaymentId',pi,'sourceChargeId',source,'destinationAccountId','acct_integration_ordering');
     INSERT INTO tideway_private.payment_command_attempt_windows(command_id,first_attempt_at,retry_before,request_hash,request_identity)
       VALUES(command_id,now(),now()+interval '23 hours',decode(repeat('ff',32),'hex'),identity);
   END IF;
   source:=identity->>'sourceChargeId'; destination:=identity->>'destinationAccountId';
 END IF;
 RETURN tideway_private.reconcile_payment_provider_event(provider,event_id,kind,object_id,payment_id,command_id,amount_pence,currency,occurred,payload_hash,pi,source,destination);
END;
$$;
CREATE FUNCTION pg_temp.seed_retained_event_identity(selected_event text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO tideway_private.payment_event_parent_identities(provider,provider_event_id,provider_payment_id,source_charge_id,destination_account_id)
 SELECT e.provider,e.provider_event_id,p.provider_payment_id,
   CASE WHEN e.event_kind LIKE 'transfer-%' THEN w.request_identity->>'sourceChargeId' ELSE 'ch_integration_event' END,
   CASE WHEN e.event_kind LIKE 'transfer-%' THEN w.request_identity->>'destinationAccountId' ELSE NULL END
 FROM tideway_private.payment_provider_events e JOIN booking_payments p ON p.id=e.payment_id
 LEFT JOIN tideway_private.payment_command_attempt_windows w ON w.command_id=e.command_id
 WHERE e.provider_event_id=selected_event;
$$;

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

  -- Only a signed terminal refund failure releases its monetary reservation.
  PERFORM pg_temp.reconcile_bound_fixture_event('stripe','evt_ordering_refund_failed','refund-failed','re_ordering_failed',
    '50000000-0000-4000-8000-000000000010','51000000-0000-4000-8000-000000000001',1000,'gbp',occurred-interval '1 second',repeat('7',64));
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
  result := pg_temp.reconcile_bound_fixture_event('stripe','evt_ordering_transfer_1','transfer-succeeded','tr_payment_ordering','50000000-0000-4000-8000-000000000010','51000000-0000-4000-8000-000000000004',booking_record.cleaner_pay_pence,'gbp',occurred,repeat('a',64));
  IF result->>'accepted'<>'true' OR result->>'duplicate'<>'false' THEN RAISE EXCEPTION 'First Cleaner transfer event did not reconcile'; END IF;
  result := pg_temp.reconcile_bound_fixture_event('stripe','evt_ordering_transfer_2','transfer-succeeded','tr_payment_ordering','50000000-0000-4000-8000-000000000010','51000000-0000-4000-8000-000000000004',booking_record.cleaner_pay_pence,'gbp',occurred+interval '1 second',repeat('b',64));
  IF result->>'duplicate'<>'true' THEN RAISE EXCEPTION 'A second event re-applied the same Cleaner transfer'; END IF;
  result := pg_temp.reconcile_bound_fixture_event('stripe','evt_ordering_transfer_reverse','transfer-reversed','tr_payment_ordering','50000000-0000-4000-8000-000000000010','51000000-0000-4000-8000-000000000004',booking_record.cleaner_pay_pence,'gbp',occurred+interval '2 seconds',repeat('c',64));
  IF result->>'accepted'<>'true' OR (SELECT status FROM payment_commands WHERE id='51000000-0000-4000-8000-000000000004')<>'provider-failed' THEN RAISE EXCEPTION 'Verified Cleaner transfer reversal did not reopen the money boundary'; END IF;

  PERFORM * FROM tideway_private.begin_booking_payment_command('51000000-0000-4000-8000-000000000006','50000000-0000-4000-8000-000000000010','refund',1000,decode(repeat('d7',32),'hex'));
  PERFORM * FROM tideway_private.record_booking_payment_command('51000000-0000-4000-8000-000000000006','re_payment_ordering','pending');
  result := pg_temp.reconcile_bound_fixture_event('stripe','evt_ordering_refund_1','refund-succeeded','re_payment_ordering','50000000-0000-4000-8000-000000000010','51000000-0000-4000-8000-000000000006',1000,'gbp',occurred+interval '3 seconds',repeat('d',64));
  IF result->>'accepted'<>'true' OR (SELECT amount_refunded_pence FROM booking_payments WHERE id='50000000-0000-4000-8000-000000000010')<>1000 THEN RAISE EXCEPTION 'First refund event did not reconcile exactly once'; END IF;
  result := pg_temp.reconcile_bound_fixture_event('stripe','evt_ordering_refund_2','refund-succeeded','re_payment_ordering','50000000-0000-4000-8000-000000000010','51000000-0000-4000-8000-000000000006',1000,'gbp',occurred+interval '4 seconds',repeat('e',64));
  IF result->>'duplicate'<>'true' OR (SELECT amount_refunded_pence FROM booking_payments WHERE id='50000000-0000-4000-8000-000000000010')<>1000 THEN RAISE EXCEPTION 'A second event applied the same refund twice'; END IF;

  result := pg_temp.reconcile_bound_fixture_event('stripe','evt_ordering_invalid_regression','authorization-succeeded','pi_payment_ordering','50000000-0000-4000-8000-000000000010',NULL,booking_record.customer_price_pence,'gbp',occurred+interval '5 seconds',repeat('f',64));
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
  result := pg_temp.reconcile_bound_fixture_event('stripe','evt_authorization_before_response','authorization-succeeded','pi_response_race','50000000-0000-4000-8000-000000000010',NULL,
    (SELECT amount_pence FROM booking_payments WHERE id='50000000-0000-4000-8000-000000000010'),'gbp',now()-interval '1 minute',repeat('9',64));
  IF result->>'accepted' <> 'true' THEN RAISE EXCEPTION 'Signed authorization fixture did not reconcile'; END IF;
  IF (SELECT provider_payment_id FROM booking_payments WHERE id='50000000-0000-4000-8000-000000000010') IS DISTINCT FROM 'pi_response_race' THEN RAISE EXCEPTION 'Signed authorization did not bind provider identity immediately'; END IF;
  blocked := false;
  BEGIN
    PERFORM tideway_private.record_booking_payment_authorization('50000000-0000-4000-8000-000000000010','pi_wrong_response','processing');
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'provider-payment-conflict' THEN RAISE; END IF;
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
  result := pg_temp.reconcile_bound_fixture_event('stripe','evt_authorization_after_response','authorization-succeeded','pi_response_first',payment.id,NULL,payment.amount_pence,'gbp',now()-interval '30 seconds',repeat('8',64));
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

SAVEPOINT dispute_outcome_checks;

CREATE FUNCTION pg_temp.test_dispute_event(event_id text, dispute_id text, outcome text, event_time timestamptz, event_kind text DEFAULT 'dispute-closed')
RETURNS jsonb LANGUAGE sql AS $$
 SELECT tideway_private.reconcile_payment_dispute_event('stripe',event_id,event_kind,'pi_payment_ordering',
 '50000000-0000-4000-8000-000000000010',NULL,NULL,NULL,event_time,repeat('a',64),dispute_id,outcome);
$$;

DO $dispute_outcomes$
DECLARE
  p uuid := '50000000-0000-4000-8000-000000000010';
  c uuid := '51000000-0000-4000-8000-000000000099';
  t timestamptz := now()-interval '10 minutes';
  outcome text;
  ordering integer;
  payment booking_payments%ROWTYPE;
  result jsonb;
  detail jsonb;
  blocked boolean;
  event_name text;
BEGIN
  DELETE FROM tideway_private.payment_command_attempt_windows WHERE command_id IN (SELECT id FROM payment_commands WHERE payment_id=p);
  DELETE FROM payment_commands WHERE payment_id=p;
  UPDATE booking_payments SET status='captured',amount_refunded_pence=0,last_provider_event_at=now()-interval '1 minute' WHERE id=p;
  SELECT * INTO payment FROM booking_payments WHERE id=p;

  FOREACH outcome IN ARRAY ARRAY['won','lost','warning_closed','prevented','unknown'] LOOP
    FOREACH ordering IN ARRAY ARRAY[0,1] LOOP
      DELETE FROM tideway_private.payment_disputes WHERE payment_id=p;
      UPDATE booking_payments SET status='captured' WHERE id=p;
      event_name := 'evt_dispute_'||outcome||'_'||ordering;
      IF ordering=0 THEN PERFORM pg_temp.test_dispute_event(event_name||'_open','du_order_test','needs_response',t,'dispute-opened'); END IF;
      result := pg_temp.test_dispute_event(event_name||'_closed','du_order_test',outcome,t);
      IF ordering=1 THEN PERFORM pg_temp.test_dispute_event(event_name||'_open','du_order_test','needs_response',t,'dispute-opened'); END IF;
      IF (SELECT status FROM booking_payments WHERE id=p) <> (CASE WHEN outcome IN ('won','warning_closed') THEN 'captured' ELSE 'disputed' END)
        THEN RAISE EXCEPTION 'Wrong dispute outcome % order %',outcome,ordering; END IF;
      IF (SELECT amount_captured_pence FROM booking_payments WHERE id=p) <> payment.amount_captured_pence OR (SELECT amount_refunded_pence FROM booking_payments WHERE id=p)<>0
        THEN RAISE EXCEPTION 'Dispute changed money totals'; END IF;
      result := pg_temp.test_dispute_event(event_name||'_closed','du_order_test',outcome,t);
      IF result->>'duplicate'<>'true' THEN RAISE EXCEPTION 'Dispute duplicate was reapplied'; END IF;
      blocked := false;
      BEGIN
        PERFORM pg_temp.test_dispute_event(event_name||'_closed','du_different_identity',outcome,t);
      EXCEPTION WHEN SQLSTATE '22023' THEN blocked := true;
      END;
      IF NOT blocked THEN RAISE EXCEPTION 'Duplicate event changed its dispute identity'; END IF;
    END LOOP;
  END LOOP;

  -- Independent cases: resolving one never releases another.
  DELETE FROM tideway_private.payment_disputes WHERE payment_id=p;
  PERFORM pg_temp.test_dispute_event('evt_multi_a','du_multi_a','lost',t);
  PERFORM pg_temp.test_dispute_event('evt_multi_b','du_multi_b','won',t);
  IF (SELECT status FROM booking_payments WHERE id=p)<>'disputed' THEN RAISE EXCEPTION 'One won dispute released a different lost dispute'; END IF;
  -- Stripe documents late wins. A newer signed win can supersede the loss;
  -- an older loss delivered afterward must not undo it.
  PERFORM pg_temp.test_dispute_event('evt_multi_late_win','du_multi_a','won',t+interval '2 seconds');
  PERFORM pg_temp.test_dispute_event('evt_multi_stale_lost','du_multi_a','lost',t+interval '1 second');
  IF (SELECT status FROM booking_payments WHERE id=p)<>'captured' THEN RAISE EXCEPTION 'Documented late win was not retained'; END IF;
  PERFORM pg_temp.test_dispute_event('evt_multi_equal_conflict','du_multi_a','lost',t+interval '2 seconds');
  PERFORM pg_temp.test_dispute_event('evt_multi_after_conflict','du_multi_a','won',t+interval '3 seconds');
  IF (SELECT status FROM booking_payments WHERE id=p)<>'disputed' OR (SELECT status FROM tideway_private.payment_disputes WHERE dispute_key='du_multi_a')<>'conflict'
    THEN RAISE EXCEPTION 'Ambiguous terminal conflict was automatically released'; END IF;

  -- Both admin routes expose the hold and outcomes, and the default queue includes it.
  detail := tideway_private.get_administrator_booking_payment_operation(payment.booking_id);
  IF detail->>'disputeReviewRequired'<>'true' OR jsonb_array_length(detail->'disputes')<>2 OR detail->>'canTransfer'<>'false'
    THEN RAISE EXCEPTION 'Booking admin projection hid dispute evidence or enabled payout'; END IF;
  result := tideway_private.list_administrator_payment_operations('actionable',100,0);
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(result->'payments') item WHERE item->>'paymentId'=p::text AND item->>'disputeReviewRequired'='true')
    THEN RAISE EXCEPTION 'Disputed payment vanished from default admin queue'; END IF;

  -- Existing ten-argument callers remain fail closed, and exact signed replay
  -- can recover only the corresponding historical event's missing projection.
  DELETE FROM tideway_private.payment_disputes WHERE payment_id=p;
  result := pg_temp.reconcile_bound_fixture_event('stripe','evt_legacy_closed','dispute-closed','pi_payment_ordering',p,NULL,NULL,NULL,t,repeat('a',64));
  PERFORM pg_temp.test_dispute_event('evt_other_safe','du_other_safe','won',t);
  IF (SELECT status FROM booking_payments WHERE id=p)<>'disputed' THEN RAISE EXCEPTION 'Unidentified legacy evidence was released by an unrelated win'; END IF;
  result := pg_temp.test_dispute_event('evt_legacy_closed','du_recovered_legacy','won',t);
  IF (SELECT status FROM booking_payments WHERE id=p)<>'captured' OR EXISTS(SELECT 1 FROM tideway_private.payment_disputes WHERE dispute_key='legacy_'||md5('evt_legacy_closed'))
    THEN RAISE EXCEPTION 'Verified legacy replay could not restore its exact projection'; END IF;

  -- Monetary totals survive won disputes after partial and full refunds.
  UPDATE booking_payments SET amount_refunded_pence=1000 WHERE id=p;
  PERFORM pg_temp.test_dispute_event('evt_won_partial','du_partial','won',t);
  IF (SELECT status FROM booking_payments WHERE id=p)<>'partially-refunded' THEN RAISE EXCEPTION 'Won dispute erased partial refund state'; END IF;
  UPDATE booking_payments SET amount_refunded_pence=amount_captured_pence WHERE id=p;
  PERFORM pg_temp.test_dispute_event('evt_won_full','du_full','won',t);
  IF (SELECT status FROM booking_payments WHERE id=p)<>'refunded' THEN RAISE EXCEPTION 'Won dispute erased full refund state'; END IF;

  -- Reserve a transfer, receive a dispute, then retry the identical unsent command.
  DELETE FROM tideway_private.payment_disputes WHERE payment_id=p;
  UPDATE booking_payments SET status='captured',amount_refunded_pence=0 WHERE id=p;
  PERFORM * FROM tideway_private.begin_booking_payment_command(c,p,'transfer',NULL,decode(repeat('ef',32),'hex'));
  PERFORM pg_temp.test_dispute_event('evt_retry_hold','du_retry_hold','lost',t);
  blocked := false;
  BEGIN
    PERFORM * FROM tideway_private.begin_booking_payment_command(c,p,'transfer',NULL,decode(repeat('ef',32),'hex'));
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'payment-dispute-review-required' THEN RAISE; END IF;
    blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Idempotent unsent transfer bypassed the dispute hold'; END IF;
  -- A command already sent may still report its financial fact; this does not recover lost money.
  result := pg_temp.reconcile_bound_fixture_event('stripe','evt_transfer_after_loss','transfer-succeeded','tr_dispute_test',p,c,payment.amount_pence*0+ (SELECT cleaner_pay_pence FROM bookings WHERE id=payment.booking_id),'gbp',t-interval '1 second',repeat('b',64));
  IF result->>'accepted'<>'true' OR (SELECT status FROM payment_commands WHERE id=c)<>'reconciled' OR (SELECT status FROM booking_payments WHERE id=p)<>'disputed'
    THEN RAISE EXCEPTION 'Late transfer fact erased or bypassed the dispute hold'; END IF;

  -- Capture/refund signed events may arrive after a later dispute timestamp.
  DELETE FROM tideway_private.payment_command_attempt_windows WHERE command_id IN (SELECT id FROM payment_commands WHERE payment_id=p);
  DELETE FROM payment_commands WHERE payment_id=p;
  UPDATE booking_payments SET amount_captured_pence=0,amount_refunded_pence=0 WHERE id=p;
  INSERT INTO payment_commands(id,payment_id,command_kind,amount_pence,status,idempotency_key_hash,created_by)
    VALUES(c,p,'capture',payment.amount_pence,'provider-pending',decode(repeat('ee',32),'hex'),'10000000-0000-4000-8000-000000000004');
  result := pg_temp.reconcile_bound_fixture_event('stripe','evt_capture_after_loss','capture-succeeded','pi_payment_ordering',p,c,payment.amount_pence,'gbp',t-interval '1 second',repeat('c',64));
  IF result->>'accepted'<>'true' OR (SELECT amount_captured_pence FROM booking_payments WHERE id=p)<>payment.amount_pence OR (SELECT status FROM booking_payments WHERE id=p)<>'disputed'
    THEN RAISE EXCEPTION 'Delayed capture was discarded or erased the hold'; END IF;
  DELETE FROM tideway_private.payment_command_attempt_windows WHERE command_id IN (SELECT id FROM payment_commands WHERE payment_id=p);
  DELETE FROM payment_commands WHERE payment_id=p;
  INSERT INTO payment_commands(id,payment_id,command_kind,amount_pence,status,idempotency_key_hash,created_by)
    VALUES(c,p,'refund',1000,'provider-pending',decode(repeat('ed',32),'hex'),'10000000-0000-4000-8000-000000000004');
  result := pg_temp.reconcile_bound_fixture_event('stripe','evt_refund_after_loss','refund-succeeded','re_dispute_test',p,c,1000,'gbp',t-interval '2 seconds',repeat('d',64));
  IF result->>'accepted'<>'true' OR (SELECT amount_refunded_pence FROM booking_payments WHERE id=p)<>1000 OR (SELECT status FROM booking_payments WHERE id=p)<>'disputed'
    THEN RAISE EXCEPTION 'Delayed refund was discarded or erased the hold'; END IF;
  result := pg_temp.reconcile_bound_fixture_event('stripe','evt_refund_after_loss_second','refund-succeeded','re_dispute_test',p,c,1000,'gbp',t-interval '1 second',repeat('e',64));
  IF result->>'duplicate'<>'true' OR (SELECT amount_refunded_pence FROM booking_payments WHERE id=p)<>1000 THEN RAISE EXCEPTION 'Disputed refund was applied twice'; END IF;
  PERFORM pg_temp.test_dispute_event('evt_refund_then_won','du_retry_hold','won',t+interval '2 seconds');
  IF (SELECT status FROM booking_payments WHERE id=p)<>'partially-refunded' OR (SELECT amount_refunded_pence FROM booking_payments WHERE id=p)<>1000
    THEN RAISE EXCEPTION 'Resolving dispute lost a delayed refund fact'; END IF;

  DELETE FROM tideway_private.payment_disputes WHERE payment_id=p;
  DELETE FROM tideway_private.payment_command_attempt_windows WHERE command_id IN (SELECT id FROM payment_commands WHERE payment_id=p);
  DELETE FROM payment_commands WHERE payment_id=p;
  UPDATE booking_payments SET status='authorized',amount_refunded_pence=0,amount_captured_pence=0 WHERE id=p;
  PERFORM pg_temp.test_dispute_event('evt_won_before_capture','du_won_before_capture','won',t);
  IF (SELECT status FROM booking_payments WHERE id=p)<>'disputed' THEN RAISE EXCEPTION 'Won dispute invented a captured balance'; END IF;
  INSERT INTO payment_commands(id,payment_id,command_kind,amount_pence,status,idempotency_key_hash,created_by)
    VALUES(c,p,'capture',payment.amount_pence,'provider-pending',decode(repeat('ec',32),'hex'),'10000000-0000-4000-8000-000000000004');
  result := pg_temp.reconcile_bound_fixture_event('stripe','evt_capture_after_won','capture-succeeded','pi_payment_ordering',p,c,payment.amount_pence,'gbp',t-interval '1 second',repeat('f',64));
  IF result->>'accepted'<>'true' OR (SELECT status FROM booking_payments WHERE id=p)<>'captured'
    THEN RAISE EXCEPTION 'Delayed capture could not complete an already won dispute'; END IF;

  IF has_table_privilege('tideway_app','tideway_private.payment_disputes','SELECT') OR has_table_privilege('tideway_app','tideway_private.payment_disputes','UPDATE')
    THEN RAISE EXCEPTION 'Runtime gained direct dispute-table access'; END IF;
  IF NOT has_function_privilege('tideway_app','tideway_private.reconcile_payment_dispute_event(text,text,text,text,uuid,uuid,integer,character,timestamptz,character,text,text)','EXECUTE')
    THEN RAISE EXCEPTION 'Signed event route missing its narrow function grant'; END IF;
  PERFORM set_config('app.user_roles','landlord',true);
  blocked := false;
  BEGIN PERFORM tideway_private.get_administrator_booking_payment_operation(payment.booking_id);
  EXCEPTION WHEN SQLSTATE '42501' THEN blocked := true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'Non-admin read dispute operations'; END IF;
END
$dispute_outcomes$;
ROLLBACK TO SAVEPOINT dispute_outcome_checks;

\ir marketplace-payment-replay.sql

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

\ir marketplace-payment-recovery.sql
\ir marketplace-payment-event-identity.sql

ROLLBACK;
