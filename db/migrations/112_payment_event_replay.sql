BEGIN;

-- Separate applied money and terminal provider facts from an HTTP command reply.
-- A timeout/failure response must never permanently veto a later signed success.
ALTER TABLE payment_commands ADD COLUMN provider_success_applied boolean NOT NULL DEFAULT false,
  ADD COLUMN provider_terminal_failure boolean NOT NULL DEFAULT false;
UPDATE payment_commands SET provider_success_applied=true WHERE status='reconciled';
UPDATE payment_commands command SET provider_terminal_failure=true
WHERE command.status='provider-failed' AND EXISTS (
  SELECT 1 FROM tideway_private.payment_provider_events event
  WHERE event.command_id=command.id AND event.payment_id=command.payment_id
    AND event.provider_object_id=command.provider_command_id
    AND event.event_kind IN ('refund-failed','transfer-reversed') AND event.result_code='processed'
);
ALTER TABLE tideway_private.payment_provider_events ADD COLUMN reconciliation_version smallint NOT NULL DEFAULT 1;
CREATE INDEX payment_provider_events_pending_idx ON tideway_private.payment_provider_events(payment_id) WHERE NOT processed;

CREATE OR REPLACE FUNCTION tideway_private.reconcile_payment_provider_event(selected_provider text,supplied_event_id text,supplied_kind text,supplied_object_id text,target_payment_id uuid,target_command_id uuid,supplied_amount_pence integer,supplied_currency character(3),supplied_occurred_at timestamptz,supplied_payload_hash character(64))
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  payment_record booking_payments%ROWTYPE;
  command_record payment_commands%ROWTYPE;
  event_record tideway_private.payment_provider_events%ROWTYPE;
  prior_status text;
  next_status text;
  expected_command_kind text;
  state_allowed boolean := false;
  repeat_event boolean := false;
  refund_delta integer := 0;
BEGIN
  IF supplied_kind IN ('dispute-opened','dispute-closed') THEN
    RETURN tideway_private.reconcile_payment_dispute_event(selected_provider,supplied_event_id,supplied_kind,supplied_object_id,target_payment_id,target_command_id,supplied_amount_pence,supplied_currency,supplied_occurred_at,supplied_payload_hash,NULL,NULL);
  END IF;
  IF selected_provider IS DISTINCT FROM 'stripe' OR char_length(COALESCE(supplied_event_id,'')) NOT BETWEEN 3 AND 255
    OR char_length(COALESCE(supplied_object_id,'')) NOT BETWEEN 3 AND 255 OR COALESCE(supplied_payload_hash,'') !~ '^[0-9a-f]{64}$'
    OR supplied_occurred_at IS NULL OR supplied_occurred_at > now()+interval '5 minutes'
    OR supplied_kind IS NULL OR supplied_kind NOT IN ('authorization-requires-action','authorization-processing','authorization-succeeded','authorization-failed','capture-succeeded','capture-failed','cancellation-succeeded','cancellation-failed','refund-succeeded','refund-failed','transfer-succeeded','transfer-failed','transfer-reversed')
    THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-payment-event'; END IF;

  -- All paths take the payment lock before command/event locks. Concurrent event
  -- deliveries serialize without a duplicate-event/payment lock inversion.
  SELECT * INTO payment_record FROM booking_payments WHERE id=target_payment_id AND provider=selected_provider FOR UPDATE;
  INSERT INTO tideway_private.payment_provider_events(provider,provider_event_id,event_kind,provider_object_id,payment_id,command_id,amount_pence,currency,occurred_at,payload_hash,reconciliation_version)
    VALUES(selected_provider,supplied_event_id,supplied_kind,supplied_object_id,target_payment_id,target_command_id,supplied_amount_pence,supplied_currency,supplied_occurred_at,supplied_payload_hash,2)
    ON CONFLICT(provider,provider_event_id) DO NOTHING;
  repeat_event := NOT FOUND;
  SELECT * INTO event_record FROM tideway_private.payment_provider_events WHERE provider=selected_provider AND provider_event_id=supplied_event_id FOR UPDATE;
  -- Signature verification authenticates each delivery. Envelope fields such as
  -- pending_webhooks may change; compare financial facts, not raw serialization.
  -- Keep the first raw-body hash as audit evidence without vetoing safe retries.
  IF ROW(event_record.event_kind,event_record.provider_object_id,event_record.payment_id,event_record.command_id,event_record.amount_pence,event_record.currency,event_record.occurred_at)
    IS DISTINCT FROM ROW(supplied_kind,supplied_object_id,target_payment_id,target_command_id,supplied_amount_pence,supplied_currency,supplied_occurred_at)
    THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='payment-event-identity-conflict'; END IF;
  -- Only facts actually applied by this reconciler may be acknowledged as done.
  -- Older rejected/ignored events are eligible for an exact signed replay.
  IF repeat_event AND event_record.processed AND event_record.reconciliation_version=2 THEN
    RETURN jsonb_build_object('accepted',event_record.result_code IN ('processed','command-already-reconciled','terminal-provider-fact','stale-event'),'duplicate',true,
      'stateConflict',event_record.result_code='invalid-state-transition');
  END IF;
  IF payment_record.id IS NULL THEN
    UPDATE tideway_private.payment_provider_events SET processed=false,result_code='awaiting-payment',reconciliation_version=2 WHERE provider=selected_provider AND provider_event_id=supplied_event_id;
    RETURN jsonb_build_object('accepted',false,'duplicate',repeat_event,'retryable',true);
  END IF;
  IF supplied_currency IS DISTINCT FROM payment_record.currency THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='payment-event-currency-mismatch'; END IF;
  IF target_command_id IS NOT NULL THEN SELECT * INTO command_record FROM payment_commands WHERE id=target_command_id AND payment_id=payment_record.id FOR UPDATE; END IF;
  expected_command_kind := CASE WHEN supplied_kind LIKE 'capture-%' THEN 'capture' WHEN supplied_kind LIKE 'cancellation-%' THEN 'cancel' WHEN supplied_kind LIKE 'refund-%' THEN 'refund' WHEN supplied_kind LIKE 'transfer-%' THEN 'transfer' END;
  IF expected_command_kind IS NOT NULL AND (command_record.id IS NULL OR command_record.command_kind <> expected_command_kind) THEN
    UPDATE tideway_private.payment_provider_events SET processed=false,result_code='command-mismatch',reconciliation_version=2 WHERE provider=selected_provider AND provider_event_id=supplied_event_id;
    RETURN jsonb_build_object('accepted',false,'duplicate',repeat_event,'retryable',true);
  END IF;
  IF expected_command_kind IS NULL AND target_command_id IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='unexpected-payment-command'; END IF;
  IF command_record.id IS NOT NULL THEN
    IF command_record.provider_command_id IS NOT NULL AND command_record.provider_command_id <> supplied_object_id
      THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='provider-command-conflict'; END IF;
    IF supplied_amount_pence IS DISTINCT FROM command_record.amount_pence THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='payment-event-amount-mismatch'; END IF;
    IF (expected_command_kind IN ('capture','cancel') AND (supplied_object_id !~ '^pi_' OR payment_record.provider_payment_id IS DISTINCT FROM supplied_object_id))
      OR (expected_command_kind='refund' AND supplied_object_id !~ '^re_') OR (expected_command_kind='transfer' AND supplied_object_id !~ '^tr_')
      THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='payment-event-object-mismatch'; END IF;
    IF command_record.provider_terminal_failure THEN
      UPDATE tideway_private.payment_provider_events SET processed=true,result_code='terminal-provider-fact',reconciliation_version=2 WHERE provider=selected_provider AND provider_event_id=supplied_event_id;
      RETURN jsonb_build_object('accepted',true,'duplicate',true);
    END IF;
    IF command_record.provider_success_applied AND supplied_kind NOT IN ('refund-failed','transfer-reversed') THEN
      UPDATE tideway_private.payment_provider_events SET processed=true,result_code='command-already-reconciled',reconciliation_version=2 WHERE provider=selected_provider AND provider_event_id=supplied_event_id;
      RETURN jsonb_build_object('accepted',true,'duplicate',true);
    END IF;
  ELSE
    IF supplied_object_id !~ '^pi_' OR (payment_record.provider_payment_id IS NOT NULL AND payment_record.provider_payment_id <> supplied_object_id)
      THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='provider-payment-conflict'; END IF;
    IF supplied_amount_pence IS DISTINCT FROM payment_record.amount_pence THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='payment-event-amount-mismatch'; END IF;
    IF payment_record.last_provider_event_at IS NOT NULL AND supplied_occurred_at < payment_record.last_provider_event_at THEN
      UPDATE tideway_private.payment_provider_events SET processed=true,result_code='stale-event',reconciliation_version=2 WHERE provider=selected_provider AND provider_event_id=supplied_event_id;
      RETURN jsonb_build_object('accepted',true,'duplicate',repeat_event,'stale',true);
    END IF;
  END IF;
  prior_status := payment_record.status;
  state_allowed := CASE supplied_kind
    WHEN 'authorization-requires-action' THEN prior_status IN ('creating','requires-customer-action','processing','authorization-failed')
    WHEN 'authorization-processing' THEN prior_status IN ('creating','requires-customer-action','processing','authorization-failed')
    WHEN 'authorization-succeeded' THEN prior_status IN ('creating','requires-customer-action','processing','authorized','authorization-failed')
    WHEN 'authorization-failed' THEN prior_status IN ('creating','requires-customer-action','processing','authorization-failed')
    WHEN 'capture-succeeded' THEN prior_status='authorized' OR (prior_status='disputed' AND payment_record.amount_captured_pence=0)
    WHEN 'capture-failed' THEN prior_status='authorized' OR (prior_status='disputed' AND payment_record.amount_captured_pence=0)
    WHEN 'cancellation-succeeded' THEN prior_status IN ('creating','requires-customer-action','processing','authorized','authorization-failed')
    WHEN 'cancellation-failed' THEN prior_status IN ('creating','requires-customer-action','processing','authorized','authorization-failed')
    WHEN 'refund-succeeded' THEN prior_status IN ('captured','partially-refunded','disputed') AND payment_record.amount_captured_pence-payment_record.amount_refunded_pence>=command_record.amount_pence
    WHEN 'refund-failed' THEN NOT command_record.provider_success_applied OR payment_record.amount_refunded_pence>=command_record.amount_pence
    WHEN 'transfer-succeeded' THEN payment_record.amount_captured_pence>0
    WHEN 'transfer-failed' THEN true
    WHEN 'transfer-reversed' THEN true
    ELSE false
  END;
  IF NOT state_allowed THEN
    -- Late authorization snapshots cannot undo money already captured. Other
    -- missing prerequisites stay durable and return503 through the HTTP layer.
    UPDATE tideway_private.payment_provider_events SET processed=(expected_command_kind IS NULL),
      result_code=CASE WHEN expected_command_kind IS NULL THEN 'invalid-state-transition' ELSE 'awaiting-state' END,reconciliation_version=2
      WHERE provider=selected_provider AND provider_event_id=supplied_event_id;
    RETURN jsonb_build_object('accepted',false,'duplicate',repeat_event,'stateConflict',true,'retryable',expected_command_kind IS NOT NULL);
  END IF;
  IF supplied_kind='refund-succeeded' THEN refund_delta:=command_record.amount_pence;
  ELSIF supplied_kind='refund-failed' AND command_record.provider_success_applied THEN refund_delta:=-command_record.amount_pence;
  END IF;
  next_status := prior_status;
  IF supplied_kind='authorization-requires-action' THEN next_status:='requires-customer-action';
  ELSIF supplied_kind='authorization-processing' THEN next_status:='processing';
  ELSIF supplied_kind='authorization-succeeded' THEN next_status:='authorized';
  ELSIF supplied_kind='authorization-failed' THEN next_status:='authorization-failed';
  ELSIF supplied_kind='capture-succeeded' THEN next_status:='captured';
  ELSIF supplied_kind='cancellation-succeeded' THEN next_status:='cancelled';
  ELSIF refund_delta<>0 THEN next_status:=CASE WHEN payment_record.amount_refunded_pence+refund_delta=payment_record.amount_captured_pence THEN 'refunded' WHEN payment_record.amount_refunded_pence+refund_delta>0 THEN 'partially-refunded' ELSE 'captured' END;
  END IF;
  IF tideway_private.payment_dispute_hold(payment_record.id) THEN next_status:='disputed'; END IF;
  UPDATE booking_payments SET status=next_status,last_provider_event_at=GREATEST(last_provider_event_at,supplied_occurred_at),
    provider_payment_id=CASE WHEN expected_command_kind IS NULL THEN COALESCE(provider_payment_id,supplied_object_id) ELSE provider_payment_id END,
    amount_captured_pence=CASE WHEN supplied_kind='capture-succeeded' THEN amount_pence ELSE amount_captured_pence END,
    amount_refunded_pence=amount_refunded_pence+refund_delta,
    authorized_at=CASE WHEN supplied_kind='authorization-succeeded' THEN COALESCE(authorized_at,supplied_occurred_at) ELSE authorized_at END,
    captured_at=CASE WHEN supplied_kind='capture-succeeded' THEN COALESCE(captured_at,supplied_occurred_at) ELSE captured_at END,
    cancelled_at=CASE WHEN supplied_kind='cancellation-succeeded' THEN COALESCE(cancelled_at,supplied_occurred_at) ELSE cancelled_at END,updated_at=now()
    WHERE id=payment_record.id;
  IF command_record.id IS NOT NULL THEN
    UPDATE payment_commands SET provider_command_id=COALESCE(provider_command_id,supplied_object_id),
      status=CASE WHEN supplied_kind LIKE '%-failed' OR supplied_kind='transfer-reversed' THEN 'provider-failed' ELSE 'reconciled' END,
      provider_success_applied=(supplied_kind LIKE '%-succeeded'),
      provider_terminal_failure=(supplied_kind IN ('refund-failed','transfer-reversed')),
      reconciled_at=CASE WHEN supplied_kind LIKE '%-succeeded' THEN supplied_occurred_at ELSE reconciled_at END,updated_at=now() WHERE id=command_record.id;
  END IF;
  IF next_status <> prior_status THEN INSERT INTO payment_status_history(payment_id,from_status,to_status,event_source,reason,metadata)
    VALUES(payment_record.id,prior_status,next_status,'provider','Verified signed provider event reconciled.',jsonb_build_object('eventId',supplied_event_id,'eventKind',supplied_kind)); END IF;
  UPDATE tideway_private.payment_provider_events SET processed=true,result_code='processed',reconciliation_version=2 WHERE provider=selected_provider AND provider_event_id=supplied_event_id;
  RETURN jsonb_build_object('accepted',true,'duplicate',false);
END;
$$;

-- API snapshots cannot release a reservation; only signed events settle it.
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
    UPDATE payment_commands SET provider_command_id=COALESCE(provider_command_id,supplied_provider_command_id),status='provider-pending',updated_at=now() WHERE id=command_record.id RETURNING * INTO command_record;
  END IF;
  RETURN QUERY SELECT command_record.id,command_record.payment_id,command_record.command_kind,command_record.status;
END;
$$;

-- Disputes use the same financial-identity rule for renewed signed delivery.
CREATE OR REPLACE FUNCTION tideway_private.reconcile_payment_dispute_event(selected_provider text,supplied_event_id text,supplied_kind text,supplied_object_id text,target_payment_id uuid,target_command_id uuid,supplied_amount_pence integer,supplied_currency character(3),supplied_occurred_at timestamptz,supplied_payload_hash character(64),supplied_dispute_id text,supplied_dispute_status text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  payment booking_payments%ROWTYPE;
  prior_event tideway_private.payment_provider_events%ROWTYPE;
  dispute tideway_private.payment_disputes%ROWTYPE;
  selected_key text;
  selected_outcome text;
  selected_closed boolean := supplied_kind='dispute-closed';
  review_required boolean;
  next_status text;
  is_new boolean;
  event_result_code text := 'processed';
BEGIN
  IF selected_provider IS DISTINCT FROM 'stripe' OR supplied_kind NOT IN ('dispute-opened','dispute-closed')
    OR supplied_kind IS NULL OR supplied_occurred_at IS NULL OR supplied_occurred_at > now()+interval '5 minutes'
    OR supplied_payload_hash IS NULL OR supplied_payload_hash !~ '^[0-9a-f]{64}$'
    OR char_length(COALESCE(supplied_event_id,'')) NOT BETWEEN 3 AND 255
    OR char_length(COALESCE(supplied_object_id,'')) NOT BETWEEN 3 AND 255
    OR supplied_dispute_id IS NOT NULL AND supplied_dispute_id !~ '^du_[A-Za-z0-9_]{3,250}$'
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-payment-dispute-event'; END IF;

  -- Serialize dispute outcomes, command preparation and ordinary reconciliation.
  SELECT * INTO payment FROM booking_payments WHERE id=target_payment_id AND provider=selected_provider FOR UPDATE;
  IF NOT FOUND OR payment.provider_payment_id IS DISTINCT FROM supplied_object_id
    THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='payment-dispute-identity-mismatch'; END IF;

  INSERT INTO tideway_private.payment_provider_events(provider,provider_event_id,event_kind,provider_object_id,payment_id,command_id,amount_pence,currency,occurred_at,payload_hash,provider_dispute_id,dispute_status)
  VALUES(selected_provider,supplied_event_id,supplied_kind,supplied_object_id,target_payment_id,NULL,NULL,NULL,supplied_occurred_at,supplied_payload_hash,supplied_dispute_id,supplied_dispute_status)
  ON CONFLICT(provider,provider_event_id) DO NOTHING;
  IF NOT FOUND THEN
    SELECT * INTO prior_event FROM tideway_private.payment_provider_events WHERE provider=selected_provider AND provider_event_id=supplied_event_id;
    IF ROW(prior_event.payment_id,prior_event.provider_object_id,prior_event.event_kind,prior_event.occurred_at)
       IS DISTINCT FROM ROW(target_payment_id,supplied_object_id,supplied_kind,supplied_occurred_at)
       OR prior_event.provider_dispute_id IS NOT NULL AND supplied_dispute_id IS NOT NULL
       AND ROW(prior_event.provider_dispute_id,prior_event.dispute_status) IS DISTINCT FROM ROW(supplied_dispute_id,supplied_dispute_status)
      THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='payment-event-identity-conflict'; END IF;
    IF prior_event.provider_dispute_id IS NULL AND supplied_dispute_id IS NOT NULL THEN
      -- A verified replay of the same historical event can supply its lost
      -- projection. Resolve only that event's unidentified hold, never others.
      DELETE FROM tideway_private.payment_disputes WHERE dispute_key='legacy_'||md5(supplied_event_id) AND payment_id=payment.id;
      UPDATE tideway_private.payment_provider_events SET provider_dispute_id=supplied_dispute_id,dispute_status=supplied_dispute_status
        WHERE provider=selected_provider AND provider_event_id=supplied_event_id;
    ELSE
      RETURN jsonb_build_object('accepted',true,'duplicate',true);
    END IF;
  END IF;

  selected_key := COALESCE(supplied_dispute_id,'legacy_'||md5(supplied_event_id));
  selected_outcome := CASE
    WHEN supplied_dispute_id IS NULL THEN 'unknown'
    WHEN selected_closed AND supplied_dispute_status IN ('won','lost','warning_closed','prevented') THEN supplied_dispute_status
    WHEN NOT selected_closed AND supplied_dispute_status IN ('warning_needs_response','warning_under_review','needs_response','under_review') THEN supplied_dispute_status
    ELSE 'unknown' END;
  review_required := selected_outcome NOT IN ('won','warning_closed');
  INSERT INTO tideway_private.payment_disputes(dispute_key,provider_dispute_id,payment_id,status,closed,requires_review,last_event_id,last_event_at)
  VALUES(selected_key,supplied_dispute_id,payment.id,selected_outcome,selected_closed,review_required,supplied_event_id,supplied_occurred_at)
  ON CONFLICT(dispute_key) DO NOTHING;
  is_new := FOUND;
  SELECT * INTO dispute FROM tideway_private.payment_disputes WHERE dispute_key=selected_key FOR UPDATE;
  IF dispute.payment_id <> payment.id THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='payment-dispute-identity-mismatch'; END IF;
  IF NOT is_new THEN
    IF dispute.status='conflict' THEN event_result_code := 'dispute-conflict-requires-review';
    ELSIF supplied_occurred_at < dispute.last_event_at OR dispute.closed AND NOT selected_closed THEN event_result_code := 'stale-dispute-event';
    ELSIF supplied_occurred_at=dispute.last_event_at AND dispute.closed AND selected_closed AND dispute.status<>selected_outcome THEN
      UPDATE tideway_private.payment_disputes SET status='conflict',requires_review=true,last_event_id=supplied_event_id,updated_at=now() WHERE dispute_key=selected_key;
      event_result_code := 'dispute-conflict-requires-review';
    ELSE
      UPDATE tideway_private.payment_disputes SET status=selected_outcome,closed=selected_closed,requires_review=review_required,
        last_event_id=supplied_event_id,last_event_at=supplied_occurred_at,updated_at=now() WHERE dispute_key=selected_key;
    END IF;
  END IF;

  review_required := tideway_private.payment_dispute_hold(payment.id) OR payment.amount_captured_pence=0;
  next_status := CASE WHEN review_required THEN 'disputed'
    WHEN payment.amount_refunded_pence=payment.amount_captured_pence THEN 'refunded'
    WHEN payment.amount_refunded_pence>0 THEN 'partially-refunded' ELSE 'captured' END;
  UPDATE booking_payments SET status=next_status,updated_at=now() WHERE id=payment.id;
  -- Dispute timestamps must not suppress a delayed capture/refund for a separate command.
  IF next_status IS DISTINCT FROM payment.status THEN
    INSERT INTO payment_status_history(payment_id,from_status,to_status,event_source,reason,metadata)
    VALUES(payment.id,payment.status,next_status,'provider','Verified dispute outcome reconciled without changing captured or refunded totals.',
      jsonb_build_object('eventId',supplied_event_id,'disputeId',supplied_dispute_id,'disputeStatus',selected_outcome,'requiresReview',review_required));
  END IF;
  UPDATE tideway_private.payment_provider_events SET processed=true,result_code=event_result_code
    WHERE provider=selected_provider AND provider_event_id=supplied_event_id;
  RETURN jsonb_build_object('accepted',true,'duplicate',false,'requiresReview',review_required);
END;
$$;
COMMIT;
