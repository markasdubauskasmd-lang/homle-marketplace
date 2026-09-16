-- Included inside the payment-ordering transaction; every mutation rolls back.
SAVEPOINT payment_replay_checks;
DO $payment_replay$
DECLARE
  p uuid := '50000000-0000-4000-8000-000000000010';
  t uuid := '52000000-0000-4000-8000-000000000001';
  r uuid := '52000000-0000-4000-8000-000000000002';
  c uuid := '52000000-0000-4000-8000-000000000003';
  payment booking_payments%ROWTYPE;
  command payment_commands%ROWTYPE;
  result jsonb;
  occurred timestamptz := now()-interval '2 minutes';
  blocked boolean;
  variation integer;
BEGIN
  DELETE FROM tideway_private.payment_provider_events WHERE payment_id=p;
  DELETE FROM payment_commands WHERE payment_id=p;
  UPDATE booking_payments SET status='captured',amount_refunded_pence=0 WHERE id=p RETURNING * INTO payment;
  PERFORM * FROM tideway_private.begin_booking_payment_command(t,p,'transfer',NULL,decode(repeat('e1',32),'hex'));
  SELECT * INTO command FROM payment_commands WHERE id=t;
  -- Adverse terminal facts win even when both events have the same Stripe second.
  result:=tideway_private.reconcile_payment_provider_event('stripe','evt_replay_reverse','transfer-reversed','tr_replay',p,t,command.amount_pence,'gbp',occurred,repeat('1',64));
  IF result->>'accepted'<>'true' OR NOT (SELECT provider_terminal_failure FROM payment_commands WHERE id=t) THEN RAISE EXCEPTION 'Reversal-before-created was discarded'; END IF;
  result:=tideway_private.reconcile_payment_provider_event('stripe','evt_replay_created','transfer-succeeded','tr_replay',p,t,command.amount_pence,'gbp',occurred,repeat('2',64));
  PERFORM * FROM tideway_private.record_booking_payment_command(t,'tr_replay','succeeded');
  IF result->>'accepted'<>'true' OR (SELECT status FROM payment_commands WHERE id=t)<>'provider-failed' THEN RAISE EXCEPTION 'Created event or late API reply reopened reversed transfer'; END IF;

  PERFORM * FROM tideway_private.begin_booking_payment_command(r,p,'refund',payment.amount_pence,decode(repeat('e2',32),'hex'));
  result:=tideway_private.reconcile_payment_provider_event('stripe','evt_replay_refunded','refund-succeeded','re_replay',p,r,payment.amount_pence,'gbp',occurred,repeat('3',64));
  IF (SELECT status FROM booking_payments WHERE id=p)<>'refunded' THEN RAISE EXCEPTION 'Refund fixture was not fully applied'; END IF;
  result:=tideway_private.reconcile_payment_provider_event('stripe','evt_replay_failed','refund-failed','re_replay',p,r,payment.amount_pence,'gbp',occurred,repeat('4',64));
  IF result->>'accepted'<>'true' OR (SELECT amount_refunded_pence FROM booking_payments WHERE id=p)<>0 OR (SELECT status FROM booking_payments WHERE id=p)<>'captured' THEN RAISE EXCEPTION 'Failed bank refund did not restore captured balance'; END IF;
  result:=tideway_private.reconcile_payment_provider_event('stripe','evt_replay_failed','refund-failed','re_replay',p,r,payment.amount_pence,'gbp',occurred,repeat('4',64));
  result:=tideway_private.reconcile_payment_provider_event('stripe','evt_replay_refunded_again','refund-succeeded','re_replay',p,r,payment.amount_pence,'gbp',occurred,repeat('5',64));
  IF (SELECT amount_refunded_pence FROM booking_payments WHERE id=p)<>0 THEN RAISE EXCEPTION 'Duplicate failure or stale success corrupted refund total'; END IF;

  -- The reverse delivery order produces exactly the same final money.
  DELETE FROM payment_commands WHERE id=r;
  PERFORM * FROM tideway_private.begin_booking_payment_command(r,p,'refund',1000,decode(repeat('e3',32),'hex'));
  result:=tideway_private.reconcile_payment_provider_event('stripe','evt_replay_failed_first','refund-failed','re_replay_first',p,r,1000,'gbp',occurred,repeat('6',64));
  result:=tideway_private.reconcile_payment_provider_event('stripe','evt_replay_success_last','refund-succeeded','re_replay_first',p,r,1000,'gbp',occurred,repeat('7',64));
  IF (SELECT amount_refunded_pence FROM booking_payments WHERE id=p)<>0 THEN RAISE EXCEPTION 'Failure-first refund was reapplied by stale success'; END IF;

  -- A failed API command reply alone is not a terminal signed refund fact.
  DELETE FROM payment_commands WHERE id=r;
  PERFORM * FROM tideway_private.begin_booking_payment_command(r,p,'refund',1000,decode(repeat('e4',32),'hex'));
  PERFORM * FROM tideway_private.record_booking_payment_command(r,'re_reply_failure','failed');
  IF (SELECT status FROM payment_commands WHERE id=r)<>'provider-pending' THEN RAISE EXCEPTION 'API failure released an uncertain refund reservation'; END IF;
  blocked:=false;
  BEGIN
    PERFORM * FROM tideway_private.begin_booking_payment_command(c,p,'refund',1000,decode(repeat('e7',32),'hex'));
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM<>'payment-not-refundable' THEN RAISE; END IF;
    blocked:=true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'A replacement refund escaped an uncertain API response'; END IF;
  result:=tideway_private.reconcile_payment_provider_event('stripe','evt_replay_after_reply_failure','refund-succeeded','re_reply_failure',p,r,1000,'gbp',occurred,repeat('8',64));
  IF result->>'accepted'<>'true' OR (SELECT amount_refunded_pence FROM booking_payments WHERE id=p)<>1000 THEN RAISE EXCEPTION 'Failed API reply vetoed signed money'; END IF;

  -- Financial identity stays immutable even if renewed delivery changes envelope bytes.
  FOR variation IN 1..3 LOOP
    blocked:=false;
    BEGIN
      PERFORM tideway_private.reconcile_payment_provider_event('stripe','evt_replay_after_reply_failure','refund-succeeded',CASE WHEN variation=1 THEN 're_wrong' ELSE 're_reply_failure' END,p,r,
        CASE WHEN variation=2 THEN 999 ELSE 1000 END,'gbp',occurred+CASE WHEN variation=3 THEN interval '1 second' ELSE interval '0 seconds' END,repeat('8',64));
    EXCEPTION WHEN SQLSTATE '22023' THEN
      IF SQLERRM<>'payment-event-identity-conflict' THEN RAISE; END IF;
      blocked:=true;
    END;
    IF NOT blocked THEN RAISE EXCEPTION 'Event identity variation % was accepted as duplicate',variation; END IF;
  END LOOP;

  result:=tideway_private.reconcile_payment_provider_event('stripe','evt_replay_after_reply_failure','refund-succeeded','re_reply_failure',p,r,1000,'gbp',occurred,repeat('9',64));
  IF result->>'duplicate'<>'true' OR (SELECT amount_refunded_pence FROM booking_payments WHERE id=p)<>1000 THEN RAISE EXCEPTION 'Renewed signed envelope rejected or duplicated identical financial facts'; END IF;
  result:=tideway_private.reconcile_payment_dispute_event('stripe','evt_replay_dispute','dispute-opened',payment.provider_payment_id,p,NULL,NULL,NULL,occurred,repeat('a',64),'du_replay','needs_response');
  result:=tideway_private.reconcile_payment_dispute_event('stripe','evt_replay_dispute','dispute-opened',payment.provider_payment_id,p,NULL,NULL,NULL,occurred,repeat('b',64),'du_replay','needs_response');
  IF result->>'duplicate'<>'true' THEN RAISE EXCEPTION 'Dispute retry rejected identical signed financial facts'; END IF;
  blocked:=false;
  BEGIN
    PERFORM tideway_private.reconcile_payment_dispute_event('stripe','evt_replay_dispute','dispute-opened',payment.provider_payment_id,p,NULL,NULL,NULL,occurred,repeat('c',64),'du_wrong','needs_response');
  EXCEPTION WHEN SQLSTATE '22023' THEN blocked:=true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Changed dispute identity was accepted'; END IF;
  DELETE FROM tideway_private.payment_disputes WHERE payment_id=p;

  -- A missing capture prerequisite stays retryable, including exact redelivery.
  DELETE FROM payment_commands WHERE id=r;
  UPDATE booking_payments SET amount_refunded_pence=0,amount_captured_pence=0,status='authorized' WHERE id=p;
  INSERT INTO payment_commands(id,payment_id,command_kind,amount_pence,status,idempotency_key_hash,created_by)
    VALUES(r,p,'refund',1000,'created',decode(repeat('e5',32),'hex'),tideway_private.current_user_id());
  result:=tideway_private.reconcile_payment_provider_event('stripe','evt_replay_pending','refund-succeeded','re_pending',p,r,1000,'gbp',occurred,repeat('a',64));
  IF result->>'retryable'<>'true' OR (SELECT processed FROM tideway_private.payment_provider_events WHERE provider_event_id='evt_replay_pending') THEN RAISE EXCEPTION 'Missing prerequisite was acknowledged as final'; END IF;
  result:=tideway_private.reconcile_payment_provider_event('stripe','evt_replay_pending','refund-succeeded','re_pending',p,r,1000,'gbp',occurred,repeat('a',64));
  IF result->>'retryable'<>'true' OR result->>'accepted'<>'false' THEN RAISE EXCEPTION 'Unresolved duplicate was falsely acknowledged'; END IF;
  -- Simulate a historically acknowledged conflict: replay must still recover it.
  UPDATE tideway_private.payment_provider_events SET processed=true,result_code='invalid-state-transition',reconciliation_version=1 WHERE provider_event_id='evt_replay_pending';
  PERFORM * FROM tideway_private.begin_booking_payment_command(c,p,'capture',NULL,decode(repeat('e6',32),'hex'));
  result:=tideway_private.reconcile_payment_provider_event('stripe','evt_replay_capture','capture-succeeded',payment.provider_payment_id,p,c,payment.amount_pence,'gbp',occurred+interval '10 seconds',repeat('b',64));
  result:=tideway_private.reconcile_payment_provider_event('stripe','evt_replay_pending','refund-succeeded','re_pending',p,r,1000,'gbp',occurred,repeat('a',64));
  IF result->>'accepted'<>'true' OR (SELECT amount_refunded_pence FROM booking_payments WHERE id=p)<>1000 THEN RAISE EXCEPTION 'Historical signed replay did not recover after capture'; END IF;
  result:=tideway_private.reconcile_payment_provider_event('stripe','evt_replay_pending','refund-succeeded','re_pending',p,r,1000,'gbp',occurred,repeat('a',64));
  IF result->>'duplicate'<>'true' OR (SELECT amount_refunded_pence FROM booking_payments WHERE id=p)<>1000 THEN RAISE EXCEPTION 'Recovered replay applied twice'; END IF;
END
$payment_replay$;
ROLLBACK TO SAVEPOINT payment_replay_checks;
