BEGIN;

-- This helper is callable only by guarded owner functions, never the app role.
CREATE FUNCTION tideway_private.apply_bound_payment_provider_event(selected_provider text,supplied_event_id text,supplied_kind text,supplied_object_id text,target_payment_id uuid,target_command_id uuid,supplied_amount_pence integer,supplied_currency character(3),supplied_occurred_at timestamptz,supplied_payload_hash character(64))
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

REVOKE ALL ON FUNCTION tideway_private.apply_bound_payment_provider_event(text,text,text,text,uuid,uuid,integer,character,timestamptz,character) FROM PUBLIC;

CREATE TABLE tideway_private.payment_event_parent_identities (
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  provider_payment_id text NOT NULL CHECK(provider_payment_id ~ '^pi_[A-Za-z0-9_]{3,250}$'),
  source_charge_id text NOT NULL CHECK(source_charge_id ~ '^ch_[A-Za-z0-9_]{3,250}$'),
  destination_account_id text CHECK(destination_account_id IS NULL OR destination_account_id ~ '^acct_[A-Za-z0-9_]{3,250}$'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(provider,provider_event_id),
  FOREIGN KEY(provider,provider_event_id) REFERENCES tideway_private.payment_provider_events(provider,provider_event_id) ON DELETE CASCADE
);
REVOKE ALL ON TABLE tideway_private.payment_event_parent_identities FROM PUBLIC;


CREATE FUNCTION tideway_private.reconcile_payment_provider_event(selected_provider text,supplied_event_id text,supplied_kind text,supplied_object_id text,target_payment_id uuid,target_command_id uuid,supplied_amount_pence integer,supplied_currency character(3),supplied_occurred_at timestamptz,supplied_payload_hash character(64),supplied_provider_payment_id text,supplied_source_charge_id text,supplied_destination_account_id text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p booking_payments%ROWTYPE; c payment_commands%ROWTYPE;
  e tideway_private.payment_provider_events%ROWTYPE; binding tideway_private.payment_event_parent_identities%ROWTYPE;
  w tideway_private.payment_command_attempt_windows%ROWTYPE; repeated boolean; rejection text;
BEGIN
  IF supplied_kind NOT IN ('refund-succeeded','refund-failed','transfer-succeeded','transfer-failed','transfer-reversed') THEN
    RETURN tideway_private.apply_bound_payment_provider_event(selected_provider,supplied_event_id,supplied_kind,supplied_object_id,target_payment_id,target_command_id,supplied_amount_pence,supplied_currency,supplied_occurred_at,supplied_payload_hash);
  END IF;
  IF selected_provider IS DISTINCT FROM 'stripe' OR char_length(COALESCE(supplied_event_id,'')) NOT BETWEEN 3 AND 255
    OR char_length(COALESCE(supplied_object_id,'')) NOT BETWEEN 3 AND 255 OR COALESCE(supplied_payload_hash,'') !~ '^[0-9a-f]{64}$'
    OR supplied_occurred_at IS NULL OR supplied_occurred_at>now()+interval '5 minutes'
    THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-payment-event'; END IF;
  -- The same payment-first lock order covers identity binding and monetary apply.
  SELECT * INTO p FROM booking_payments WHERE id=target_payment_id AND provider=selected_provider FOR UPDATE;
  INSERT INTO tideway_private.payment_provider_events(provider,provider_event_id,event_kind,provider_object_id,payment_id,command_id,amount_pence,currency,occurred_at,payload_hash,reconciliation_version)
    VALUES(selected_provider,supplied_event_id,supplied_kind,supplied_object_id,target_payment_id,target_command_id,supplied_amount_pence,supplied_currency,supplied_occurred_at,supplied_payload_hash,2)
    ON CONFLICT(provider,provider_event_id) DO NOTHING;
  repeated:=NOT FOUND;
  SELECT * INTO e FROM tideway_private.payment_provider_events WHERE provider=selected_provider AND provider_event_id=supplied_event_id FOR UPDATE;
  IF ROW(e.event_kind,e.provider_object_id,e.payment_id,e.command_id,e.amount_pence,e.currency,e.occurred_at)
    IS DISTINCT FROM ROW(supplied_kind,supplied_object_id,target_payment_id,target_command_id,supplied_amount_pence,supplied_currency,supplied_occurred_at)
    THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='payment-event-identity-conflict'; END IF;
  SELECT * INTO binding FROM tideway_private.payment_event_parent_identities WHERE provider=selected_provider AND provider_event_id=supplied_event_id;
  -- Without explicit parent facts, only replay the exact retained envelope.
  --113 supplies this stored hash. An old server cannot prove the parents of a
  -- changed body; it must wait for a new thirteen-argument signed delivery.
  IF supplied_provider_payment_id IS NULL AND supplied_source_charge_id IS NULL AND supplied_destination_account_id IS NULL
    AND supplied_payload_hash IS DISTINCT FROM e.payload_hash THEN rejection:='awaiting-event-parent-identity'; END IF;
  IF supplied_provider_payment_id IS NOT NULL OR supplied_source_charge_id IS NOT NULL OR supplied_destination_account_id IS NOT NULL THEN
    IF COALESCE(supplied_provider_payment_id,'') !~ '^pi_[A-Za-z0-9_]{3,250}$'
      OR COALESCE(supplied_source_charge_id,'') !~ '^ch_[A-Za-z0-9_]{3,250}$'
      OR (supplied_kind LIKE 'transfer-%' AND COALESCE(supplied_destination_account_id,'') !~ '^acct_[A-Za-z0-9_]{3,250}$')
      OR (supplied_kind LIKE 'refund-%' AND supplied_destination_account_id IS NOT NULL)
      THEN rejection:='awaiting-event-parent-identity';
    ELSIF binding.provider_event_id IS NOT NULL AND ROW(binding.provider_payment_id,binding.source_charge_id,binding.destination_account_id)
      IS DISTINCT FROM ROW(supplied_provider_payment_id,supplied_source_charge_id,supplied_destination_account_id) THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='payment-event-parent-identity-conflict';
    ELSIF binding.provider_event_id IS NULL THEN
      INSERT INTO tideway_private.payment_event_parent_identities(provider,provider_event_id,provider_payment_id,source_charge_id,destination_account_id)
        VALUES(selected_provider,supplied_event_id,supplied_provider_payment_id,supplied_source_charge_id,supplied_destination_account_id) RETURNING * INTO binding;
    END IF;
  END IF;
  IF binding.provider_event_id IS NULL THEN rejection:='awaiting-event-parent-identity'; END IF;
  IF rejection IS NULL AND p.id IS NULL THEN rejection:='awaiting-payment'; END IF;
  IF rejection IS NULL AND binding.provider_payment_id IS DISTINCT FROM p.provider_payment_id THEN rejection:='payment-event-parent-mismatch'; END IF;
  IF rejection IS NULL AND supplied_kind LIKE 'transfer-%' THEN
    SELECT * INTO c FROM payment_commands WHERE id=target_command_id AND payment_id=p.id FOR UPDATE;
    SELECT * INTO w FROM tideway_private.payment_command_attempt_windows WHERE command_id=c.id;
    IF w.command_id IS NULL OR w.legacy_unknown OR w.request_identity->>'providerPaymentId' IS NULL
      OR w.request_identity->>'sourceChargeId' IS NULL OR w.request_identity->>'destinationAccountId' IS NULL
      THEN rejection:='transfer-attempt-identity-unavailable';
    ELSIF ROW(binding.provider_payment_id,binding.source_charge_id,binding.destination_account_id)
      IS DISTINCT FROM ROW(w.request_identity->>'providerPaymentId',w.request_identity->>'sourceChargeId',w.request_identity->>'destinationAccountId')
      THEN rejection:='payment-event-parent-mismatch'; END IF;
  END IF;
  IF rejection IS NOT NULL THEN
    UPDATE tideway_private.payment_provider_events SET processed=false,result_code=rejection WHERE provider=selected_provider AND provider_event_id=supplied_event_id;
    RETURN jsonb_build_object('accepted',false,'duplicate',repeated,'retryable',true,'recoveryRequired',true,'reason',rejection);
  END IF;
  RETURN tideway_private.apply_bound_payment_provider_event(selected_provider,supplied_event_id,supplied_kind,supplied_object_id,target_payment_id,target_command_id,supplied_amount_pence,supplied_currency,supplied_occurred_at,supplied_payload_hash);
END;
$$;
REVOKE ALL ON FUNCTION tideway_private.reconcile_payment_provider_event(text,text,text,text,uuid,uuid,integer,character,timestamptz,character,text,text,text) FROM PUBLIC;

-- Keep the existing function OID: cached113 recovery callers must use this guard.
-- Missing historical parent proof stays retryable until signed redelivery; a GET
-- snapshot never creates an entry in payment_event_parent_identities.
-- The thirteen-argument guard also requires the retained hash when all parent
-- arguments are absent, so neither overload can bypass exact stored replay.
CREATE OR REPLACE FUNCTION tideway_private.reconcile_payment_provider_event(selected_provider text,supplied_event_id text,supplied_kind text,supplied_object_id text,target_payment_id uuid,target_command_id uuid,supplied_amount_pence integer,supplied_currency character(3),supplied_occurred_at timestamptz,supplied_payload_hash character(64))
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT tideway_private.reconcile_payment_provider_event(selected_provider,supplied_event_id,supplied_kind,supplied_object_id,target_payment_id,target_command_id,supplied_amount_pence,supplied_currency,supplied_occurred_at,supplied_payload_hash,NULL::text,NULL::text,NULL::text);
$$;
REVOKE ALL ON FUNCTION tideway_private.reconcile_payment_provider_event(text,text,text,text,uuid,uuid,integer,character,timestamptz,character) FROM PUBLIC;

CREATE OR REPLACE FUNCTION tideway_private.payment_command_recovery_state(target_command_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c payment_commands%ROWTYPE; w tideway_private.payment_command_attempt_windows%ROWTYPE;
  a tideway_private.payment_command_recovery_attempts%ROWTYPE; previous_observation tideway_private.payment_command_recovery_attempts%ROWTYPE;
  reason text; identity_reason text; required boolean:=false; held boolean:=false; latest_checked_at timestamptz;
BEGIN
  SELECT * INTO c FROM payment_commands WHERE id=target_command_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO w FROM tideway_private.payment_command_attempt_windows WHERE command_id=c.id;
  SELECT * INTO a FROM tideway_private.payment_command_recovery_attempts WHERE command_id=c.id ORDER BY id DESC LIMIT 1;
  latest_checked_at:=a.checked_at;
  -- A failed GET is not new financial evidence. Preserve the last meaningful
  -- observation across transient checks; older success cannot erase its hold.
  IF a.outcome='operator-required' AND a.reason IN ('provider-command-outcome-unknown','provider-recovery-unavailable','no-object-found-is-not-proof-of-no-effect','transfer-source-unavailable') THEN
    SELECT * INTO previous_observation FROM tideway_private.payment_command_recovery_attempts prior
      WHERE prior.command_id=c.id AND prior.id<a.id AND NOT (prior.outcome='operator-required'
        AND prior.reason IN ('provider-command-outcome-unknown','provider-recovery-unavailable','no-object-found-is-not-proof-of-no-effect','transfer-source-unavailable'))
      ORDER BY prior.id DESC LIMIT 1;
    IF FOUND THEN a:=previous_observation; END IF;
  END IF;
  -- Refund failure and transfer reversal are terminal/monotonic observations.
  -- A later stale success snapshot cannot supersede them using an older signed
  -- success flag. Only signed failure/full reversal resolves this hold.
  IF NOT c.provider_terminal_failure THEN
    SELECT * INTO previous_observation FROM tideway_private.payment_command_recovery_attempts prior
      WHERE prior.command_id=c.id AND (
        c.command_kind='refund' AND prior.evidence->>'observedStatus' IN ('failed','canceled')
        OR c.command_kind='transfer' AND COALESCE(prior.evidence->>'observedReversedAmount','') ~ '^[0-9]{1,8}$'
          AND prior.evidence->>'observedReversedAmount'<>'0')
      ORDER BY prior.id DESC LIMIT 1;
    IF FOUND THEN a:=previous_observation; END IF;
  END IF;
  IF a.id IS NOT NULL THEN
    IF a.outcome='operator-required' AND a.reason IN ('provider-command-outcome-unknown','provider-recovery-unavailable','no-object-found-is-not-proof-of-no-effect','transfer-source-unavailable')
      AND (c.provider_success_applied OR c.provider_terminal_failure) THEN required:=false;
    ELSIF a.outcome<>'operator-required' AND tideway_private.payment_command_signed_outcome_matches(c.id,a.evidence) THEN
      required:=false;
    ELSE required:=true; held:=true; reason:=COALESCE(a.reason,'awaiting-signed-evidence'); END IF;
  ELSIF c.provider_success_applied OR c.provider_terminal_failure THEN required:=false;
  ELSIF c.status='provider-failed' THEN required:=true; held:=true; reason:='provider-outcome-unverified';
  ELSIF w.legacy_unknown THEN required:=true; held:=true; reason:='legacy-attempt-unverified';
  ELSIF w.retry_before<=statement_timestamp() THEN required:=true; held:=true; reason:='payment-attempt-expired';
  ELSIF w.command_id IS NOT NULL OR c.provider_command_id IS NOT NULL THEN required:=true; reason:='awaiting-signed-evidence';
  END IF;
  SELECT event.result_code INTO identity_reason FROM tideway_private.payment_provider_events event
    WHERE event.command_id=c.id AND event.payment_id=c.payment_id AND NOT event.processed
      AND event.result_code IN ('awaiting-event-parent-identity','payment-event-parent-mismatch','transfer-attempt-identity-unavailable')
    ORDER BY event.received_at,event.provider_event_id LIMIT 1;
  IF FOUND THEN required:=true; held:=true; reason:=identity_reason; END IF;
  RETURN jsonb_build_object('commandId',c.id,'kind',c.command_kind,'status',c.status,'recoveryReason',reason,
    'checkedAt',latest_checked_at,'recoveryRequired',required,'reviewRequired',held);
END;
$$;
REVOKE ALL ON FUNCTION tideway_private.payment_command_recovery_state(uuid) FROM PUBLIC;


DO $private_access$
DECLARE runtime_role text;
BEGIN
  FOREACH runtime_role IN ARRAY ARRAY['tideway_app','tideway_worker'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=runtime_role) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION tideway_private.apply_bound_payment_provider_event(text,text,text,text,uuid,uuid,integer,character,timestamptz,character) FROM %I',runtime_role);
      EXECUTE format('REVOKE ALL ON TABLE tideway_private.payment_event_parent_identities FROM %I',runtime_role);
    END IF;
  END LOOP;
END;
$private_access$;

COMMIT;
