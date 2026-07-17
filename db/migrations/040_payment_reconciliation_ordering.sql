BEGIN;

CREATE UNIQUE INDEX payment_one_live_refund_idx ON payment_commands(payment_id)
WHERE command_kind='refund' AND status IN ('created','provider-pending');

CREATE OR REPLACE FUNCTION tideway_private.begin_booking_payment_command(proposed_command_id uuid, target_payment_id uuid, selected_kind text, requested_amount_pence integer, supplied_idempotency_hash bytea)
RETURNS TABLE(command_id uuid,payment_id uuid,booking_id uuid,kind text,status text,amount_pence integer,currency character(3),provider_payment_id text,provider_command_id text,destination_account_id text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  payment_record booking_payments%ROWTYPE;
  booking_record bookings%ROWTYPE;
  command_record payment_commands%ROWTYPE;
  destination text;
  selected_amount integer;
BEGIN
  IF actor_id IS NULL OR selected_kind NOT IN ('capture','cancel','refund','transfer') OR octet_length(supplied_idempotency_hash) <> 32 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-payment-command'; END IF;
  IF selected_kind='cancel' THEN
    IF NOT (tideway_private.has_role('landlord') OR tideway_private.has_role('administrator')) THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='payment-role-required'; END IF;
  ELSIF NOT tideway_private.has_role('administrator') THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='administrator-required'; END IF;
  SELECT * INTO command_record FROM payment_commands WHERE idempotency_key_hash=supplied_idempotency_hash;
  IF FOUND THEN
    IF command_record.payment_id <> target_payment_id OR command_record.command_kind <> selected_kind OR command_record.created_by <> actor_id OR (selected_kind='refund' AND requested_amount_pence IS DISTINCT FROM command_record.amount_pence) THEN RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='payment-command-idempotency-conflict'; END IF;
  ELSE
    SELECT * INTO payment_record FROM booking_payments WHERE id=target_payment_id AND (landlord_user_id=actor_id OR tideway_private.has_role('administrator')) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='payment-not-found'; END IF;
    SELECT * INTO booking_record FROM bookings WHERE id=payment_record.booking_id FOR UPDATE;
    IF payment_record.provider_payment_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='payment-provider-missing'; END IF;
    IF selected_kind='capture' THEN
      IF booking_record.status <> 'completed' OR payment_record.status <> 'authorized' THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='payment-not-capturable'; END IF;
      selected_amount := payment_record.amount_pence;
    ELSIF selected_kind='cancel' THEN
      IF booking_record.status <> 'confirmed' OR booking_record.journey_started_at IS NOT NULL OR payment_record.status NOT IN ('creating','requires-customer-action','processing','authorized') THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='payment-not-cancellable'; END IF;
      selected_amount := payment_record.amount_pence;
    ELSIF selected_kind='refund' THEN
      IF booking_record.status NOT IN ('completed','cancelled','disputed') OR payment_record.status NOT IN ('captured','partially-refunded') OR requested_amount_pence IS NULL OR requested_amount_pence < 1 OR requested_amount_pence > payment_record.amount_captured_pence-payment_record.amount_refunded_pence OR
         EXISTS (SELECT 1 FROM payment_commands command WHERE command.payment_id=payment_record.id AND command.command_kind='refund' AND command.status IN ('created','provider-pending')) OR
         EXISTS (SELECT 1 FROM payment_commands command WHERE command.payment_id=payment_record.id AND command.command_kind='transfer' AND command.status <> 'provider-failed')
      THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='payment-not-refundable'; END IF;
      selected_amount := requested_amount_pence;
    ELSE
      IF booking_record.status <> 'completed' OR payment_record.status <> 'captured' OR payment_record.amount_captured_pence <> payment_record.amount_pence OR
         EXISTS (SELECT 1 FROM payment_commands command WHERE command.payment_id=payment_record.id AND command.command_kind='refund' AND command.status IN ('created','provider-pending'))
      THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='payment-not-transferable'; END IF;
      SELECT account.destination_account_id INTO destination FROM tideway_private.cleaner_payout_accounts account WHERE account.cleaner_user_id=payment_record.cleaner_user_id AND account.provider=payment_record.provider AND account.payouts_enabled AND account.details_submitted;
      IF destination IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='cleaner-payout-unavailable'; END IF;
      selected_amount := booking_record.cleaner_pay_pence;
    END IF;
    INSERT INTO payment_commands(id,payment_id,command_kind,amount_pence,status,idempotency_key_hash,created_by)
      VALUES(proposed_command_id,payment_record.id,selected_kind,selected_amount,'created',supplied_idempotency_hash,actor_id) RETURNING * INTO command_record;
  END IF;
  IF payment_record.id IS NULL THEN SELECT * INTO payment_record FROM booking_payments WHERE id=command_record.payment_id; END IF;
  IF booking_record.id IS NULL THEN SELECT * INTO booking_record FROM bookings WHERE id=payment_record.booking_id; END IF;
  IF selected_kind='transfer' AND destination IS NULL THEN SELECT account.destination_account_id INTO destination FROM tideway_private.cleaner_payout_accounts account WHERE account.cleaner_user_id=payment_record.cleaner_user_id AND account.provider=payment_record.provider AND account.payouts_enabled AND account.details_submitted; END IF;
  RETURN QUERY SELECT command_record.id,payment_record.id,booking_record.id,command_record.command_kind,command_record.status,command_record.amount_pence,payment_record.currency,payment_record.provider_payment_id,command_record.provider_command_id,destination;
END;
$$;

CREATE OR REPLACE FUNCTION tideway_private.record_booking_payment_command(target_command_id uuid, supplied_provider_command_id text, provider_result text)
RETURNS TABLE(command_id uuid,payment_id uuid,kind text,status text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  command_record payment_commands%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR provider_result NOT IN ('pending','succeeded','failed') OR char_length(COALESCE(supplied_provider_command_id,'')) NOT BETWEEN 3 AND 255 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-provider-command'; END IF;
  SELECT command.* INTO command_record FROM payment_commands command JOIN booking_payments payment ON payment.id=command.payment_id WHERE command.id=target_command_id AND (payment.landlord_user_id=actor_id OR tideway_private.has_role('administrator')) FOR UPDATE OF command;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='payment-command-not-found'; END IF;
  IF command_record.provider_command_id IS NOT NULL AND command_record.provider_command_id <> supplied_provider_command_id THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='provider-command-conflict'; END IF;
  IF command_record.status IN ('reconciled','provider-failed') THEN
    UPDATE payment_commands SET provider_command_id=COALESCE(provider_command_id,supplied_provider_command_id),updated_at=now() WHERE id=command_record.id RETURNING * INTO command_record;
  ELSE
    UPDATE payment_commands SET provider_command_id=COALESCE(provider_command_id,supplied_provider_command_id),status=CASE WHEN provider_result='failed' THEN 'provider-failed' ELSE 'provider-pending' END,updated_at=now() WHERE id=command_record.id RETURNING * INTO command_record;
  END IF;
  RETURN QUERY SELECT command_record.id,command_record.payment_id,command_record.command_kind,command_record.status;
END;
$$;

CREATE OR REPLACE FUNCTION tideway_private.reconcile_payment_provider_event(selected_provider text,supplied_event_id text,supplied_kind text,supplied_object_id text,target_payment_id uuid,target_command_id uuid,supplied_amount_pence integer,supplied_currency character(3),supplied_occurred_at timestamptz,supplied_payload_hash character(64))
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  payment_record booking_payments%ROWTYPE;
  command_record payment_commands%ROWTYPE;
  prior_status text;
  next_status text;
  expected_command_kind text;
  state_allowed boolean := false;
BEGIN
  IF selected_provider <> 'stripe' OR char_length(COALESCE(supplied_event_id,'')) NOT BETWEEN 3 AND 255 OR char_length(COALESCE(supplied_object_id,'')) NOT BETWEEN 3 AND 255 OR supplied_payload_hash !~ '^[0-9a-f]{64}$' OR supplied_occurred_at > now()+interval '5 minutes' THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-payment-event'; END IF;
  INSERT INTO tideway_private.payment_provider_events(provider,provider_event_id,event_kind,provider_object_id,payment_id,command_id,amount_pence,currency,occurred_at,payload_hash)
    VALUES(selected_provider,supplied_event_id,supplied_kind,supplied_object_id,target_payment_id,target_command_id,supplied_amount_pence,supplied_currency,supplied_occurred_at,supplied_payload_hash)
    ON CONFLICT(provider,provider_event_id) DO NOTHING;
  IF NOT FOUND THEN RETURN jsonb_build_object('accepted',true,'duplicate',true); END IF;
  SELECT * INTO payment_record FROM booking_payments WHERE id=target_payment_id AND provider=selected_provider FOR UPDATE;
  IF NOT FOUND THEN UPDATE tideway_private.payment_provider_events SET processed=true,result_code='payment-mismatch' WHERE provider=selected_provider AND provider_event_id=supplied_event_id; RETURN jsonb_build_object('accepted',false,'duplicate',false); END IF;
  IF payment_record.last_provider_event_at IS NOT NULL AND supplied_occurred_at < payment_record.last_provider_event_at THEN UPDATE tideway_private.payment_provider_events SET processed=true,result_code='stale-event' WHERE provider=selected_provider AND provider_event_id=supplied_event_id; RETURN jsonb_build_object('accepted',true,'duplicate',false,'stale',true); END IF;
  IF target_command_id IS NOT NULL THEN SELECT * INTO command_record FROM payment_commands WHERE id=target_command_id AND payment_id=payment_record.id FOR UPDATE; END IF;
  IF supplied_kind IN ('capture-succeeded','capture-failed') THEN expected_command_kind := 'capture';
  ELSIF supplied_kind IN ('cancellation-succeeded','cancellation-failed') THEN expected_command_kind := 'cancel';
  ELSIF supplied_kind IN ('refund-succeeded','refund-failed') THEN expected_command_kind := 'refund';
  ELSIF supplied_kind IN ('transfer-succeeded','transfer-failed','transfer-reversed') THEN expected_command_kind := 'transfer';
  END IF;
  IF expected_command_kind IS NOT NULL AND (command_record.id IS NULL OR command_record.command_kind <> expected_command_kind) THEN UPDATE tideway_private.payment_provider_events SET processed=true,result_code='command-mismatch' WHERE provider=selected_provider AND provider_event_id=supplied_event_id; RETURN jsonb_build_object('accepted',false,'duplicate',false); END IF;
  IF expected_command_kind IS NULL AND command_record.id IS NOT NULL THEN UPDATE tideway_private.payment_provider_events SET processed=true,result_code='unexpected-command' WHERE provider=selected_provider AND provider_event_id=supplied_event_id; RETURN jsonb_build_object('accepted',false,'duplicate',false); END IF;
  IF command_record.id IS NOT NULL THEN
    IF command_record.provider_command_id IS NOT NULL AND command_record.provider_command_id <> supplied_object_id THEN UPDATE tideway_private.payment_provider_events SET processed=true,result_code='provider-command-mismatch' WHERE provider=selected_provider AND provider_event_id=supplied_event_id; RETURN jsonb_build_object('accepted',false,'duplicate',false); END IF;
    IF supplied_kind IN ('capture-succeeded','refund-succeeded','transfer-succeeded','transfer-reversed') AND supplied_amount_pence IS DISTINCT FROM command_record.amount_pence THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='payment-event-amount-mismatch'; END IF;
    IF supplied_kind='transfer-reversed' THEN
      IF command_record.status='provider-failed' THEN UPDATE tideway_private.payment_provider_events SET processed=true,result_code='command-already-reversed' WHERE provider=selected_provider AND provider_event_id=supplied_event_id; RETURN jsonb_build_object('accepted',true,'duplicate',true); END IF;
      IF command_record.status<>'reconciled' THEN UPDATE tideway_private.payment_provider_events SET processed=true,result_code='command-not-transferable' WHERE provider=selected_provider AND provider_event_id=supplied_event_id; RETURN jsonb_build_object('accepted',false,'duplicate',false); END IF;
    ELSIF command_record.status='reconciled' THEN
      UPDATE tideway_private.payment_provider_events SET processed=true,result_code='command-already-reconciled' WHERE provider=selected_provider AND provider_event_id=supplied_event_id;
      RETURN jsonb_build_object('accepted',true,'duplicate',true);
    ELSIF command_record.status='provider-failed' THEN
      UPDATE tideway_private.payment_provider_events SET processed=true,result_code='command-already-failed' WHERE provider=selected_provider AND provider_event_id=supplied_event_id;
      RETURN jsonb_build_object('accepted',false,'duplicate',false);
    END IF;
    UPDATE payment_commands SET provider_command_id=COALESCE(provider_command_id,supplied_object_id),updated_at=now() WHERE id=command_record.id RETURNING * INTO command_record;
  ELSIF payment_record.provider_payment_id <> supplied_object_id THEN
    UPDATE tideway_private.payment_provider_events SET processed=true,result_code='provider-payment-mismatch' WHERE provider=selected_provider AND provider_event_id=supplied_event_id;
    RETURN jsonb_build_object('accepted',false,'duplicate',false);
  END IF;
  IF supplied_currency IS NOT NULL AND supplied_currency <> payment_record.currency THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='payment-event-currency-mismatch'; END IF;
  prior_status := payment_record.status;
  state_allowed := CASE supplied_kind
    WHEN 'authorization-requires-action' THEN prior_status IN ('creating','requires-customer-action','processing')
    WHEN 'authorization-processing' THEN prior_status IN ('creating','requires-customer-action','processing')
    WHEN 'authorization-succeeded' THEN prior_status IN ('creating','requires-customer-action','processing','authorized')
    WHEN 'authorization-failed' THEN prior_status IN ('creating','requires-customer-action','processing','authorization-failed')
    WHEN 'capture-succeeded' THEN prior_status='authorized'
    WHEN 'capture-failed' THEN prior_status='authorized'
    WHEN 'cancellation-succeeded' THEN prior_status IN ('creating','requires-customer-action','processing','authorized')
    WHEN 'cancellation-failed' THEN prior_status IN ('creating','requires-customer-action','processing','authorized')
    WHEN 'refund-succeeded' THEN prior_status IN ('captured','partially-refunded')
    WHEN 'refund-failed' THEN prior_status IN ('captured','partially-refunded')
    WHEN 'transfer-succeeded' THEN prior_status='captured'
    WHEN 'transfer-failed' THEN prior_status='captured'
    WHEN 'transfer-reversed' THEN prior_status='captured'
    WHEN 'dispute-opened' THEN prior_status IN ('captured','partially-refunded','disputed')
    WHEN 'dispute-closed' THEN prior_status='disputed'
    ELSE false
  END;
  IF NOT state_allowed THEN UPDATE tideway_private.payment_provider_events SET processed=true,result_code='invalid-state-transition' WHERE provider=selected_provider AND provider_event_id=supplied_event_id; RETURN jsonb_build_object('accepted',false,'duplicate',false,'stateConflict',true); END IF;
  next_status := prior_status;
  IF supplied_kind='authorization-requires-action' THEN next_status := 'requires-customer-action';
  ELSIF supplied_kind='authorization-processing' THEN next_status := 'processing';
  ELSIF supplied_kind='authorization-succeeded' THEN IF supplied_amount_pence IS DISTINCT FROM payment_record.amount_pence THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='payment-event-amount-mismatch'; END IF; next_status := 'authorized';
  ELSIF supplied_kind='authorization-failed' THEN next_status := 'authorization-failed';
  ELSIF supplied_kind='capture-succeeded' THEN next_status := 'captured';
  ELSIF supplied_kind='cancellation-succeeded' THEN next_status := 'cancelled';
  ELSIF supplied_kind='refund-succeeded' THEN next_status := CASE WHEN payment_record.amount_refunded_pence+command_record.amount_pence=payment_record.amount_captured_pence THEN 'refunded' ELSE 'partially-refunded' END;
  ELSIF supplied_kind='dispute-opened' THEN next_status := 'disputed';
  ELSIF supplied_kind='dispute-closed' THEN next_status := CASE WHEN payment_record.amount_refunded_pence=payment_record.amount_captured_pence AND payment_record.amount_captured_pence>0 THEN 'refunded' WHEN payment_record.amount_refunded_pence>0 THEN 'partially-refunded' ELSE 'captured' END;
  END IF;
  UPDATE booking_payments SET status=next_status,last_provider_event_at=supplied_occurred_at,
    amount_captured_pence=CASE WHEN supplied_kind='capture-succeeded' THEN amount_pence ELSE amount_captured_pence END,
    amount_refunded_pence=CASE WHEN supplied_kind='refund-succeeded' THEN amount_refunded_pence+command_record.amount_pence ELSE amount_refunded_pence END,
    authorized_at=CASE WHEN supplied_kind='authorization-succeeded' THEN COALESCE(authorized_at,supplied_occurred_at) ELSE authorized_at END,
    captured_at=CASE WHEN supplied_kind='capture-succeeded' THEN COALESCE(captured_at,supplied_occurred_at) ELSE captured_at END,
    cancelled_at=CASE WHEN supplied_kind='cancellation-succeeded' THEN COALESCE(cancelled_at,supplied_occurred_at) ELSE cancelled_at END,updated_at=now()
    WHERE id=payment_record.id;
  IF command_record.id IS NOT NULL THEN UPDATE payment_commands SET status=CASE WHEN supplied_kind LIKE '%-failed' OR supplied_kind='transfer-reversed' THEN 'provider-failed' ELSE 'reconciled' END,reconciled_at=CASE WHEN supplied_kind LIKE '%-succeeded' THEN supplied_occurred_at ELSE reconciled_at END,updated_at=now() WHERE id=command_record.id; END IF;
  IF next_status <> prior_status THEN INSERT INTO payment_status_history(payment_id,from_status,to_status,event_source,reason,metadata) VALUES(payment_record.id,prior_status,next_status,'provider','Verified signed provider event reconciled.',jsonb_build_object('eventId',supplied_event_id,'eventKind',supplied_kind)); END IF;
  UPDATE tideway_private.payment_provider_events SET processed=true,result_code='processed' WHERE provider=selected_provider AND provider_event_id=supplied_event_id;
  RETURN jsonb_build_object('accepted',true,'duplicate',false);
END;
$$;

COMMIT;
