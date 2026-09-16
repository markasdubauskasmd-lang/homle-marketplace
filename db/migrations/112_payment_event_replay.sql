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
  IF ROW(event_record.event_kind,event_record.provider_object_id,event_record.payment_id,event_record.command_id,event_record.amount_pence,event_record.currency,event_record.occurred_at,event_record.payload_hash)
    IS DISTINCT FROM ROW(supplied_kind,supplied_object_id,target_payment_id,target_command_id,supplied_amount_pence,supplied_currency,supplied_occurred_at,supplied_payload_hash)
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

COMMIT;
