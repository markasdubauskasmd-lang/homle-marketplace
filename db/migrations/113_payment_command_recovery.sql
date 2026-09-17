BEGIN;

-- Deploy with old monetary writers drained. Existing unresolved commands are
-- deliberately expired: no reliable original dispatch time/arguments exist.
CREATE TABLE tideway_private.payment_command_attempt_windows (
  command_id uuid PRIMARY KEY REFERENCES payment_commands(id) ON DELETE RESTRICT,
  first_attempt_at timestamptz NOT NULL,
  retry_before timestamptz NOT NULL,
  request_hash bytea CHECK (request_hash IS NULL OR octet_length(request_hash)=32),
  request_identity jsonb,
  legacy_unknown boolean NOT NULL DEFAULT false,
  CHECK (retry_before <= first_attempt_at + interval '23 hours'),
  CHECK (legacy_unknown OR request_hash IS NOT NULL AND request_identity IS NOT NULL)
);
INSERT INTO tideway_private.payment_command_attempt_windows(command_id,first_attempt_at,retry_before,legacy_unknown)
SELECT id,created_at,created_at,true FROM payment_commands;

CREATE TABLE tideway_private.payment_command_recovery_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  command_id uuid NOT NULL REFERENCES payment_commands(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  checked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  outcome text NOT NULL CHECK (outcome IN ('found-awaiting-signed-evidence','operator-required','signed-evidence-replayed')),
  reason text CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 120),
  provider_object_id text,
  evidence jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX payment_command_recovery_latest_idx ON tideway_private.payment_command_recovery_attempts(command_id,id DESC);
REVOKE ALL ON TABLE tideway_private.payment_command_attempt_windows,tideway_private.payment_command_recovery_attempts FROM PUBLIC;

CREATE FUNCTION tideway_private.payment_command_signed_outcome_matches(target_command_id uuid,observation jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT COALESCE(CASE command.command_kind
   WHEN 'refund' THEN CASE WHEN observation->>'observedStatus'='succeeded' THEN command.provider_success_applied AND NOT command.provider_terminal_failure
     WHEN observation->>'observedStatus' IN ('failed','canceled') THEN command.provider_terminal_failure ELSE false END
   WHEN 'transfer' THEN CASE WHEN observation->>'observedReversedAmount'='0' THEN command.provider_success_applied AND NOT command.provider_terminal_failure
     WHEN observation->>'observedReversedAmount'=command.amount_pence::text THEN command.provider_terminal_failure ELSE false END
   WHEN 'capture' THEN observation->>'observedStatus'='succeeded' AND command.provider_success_applied
   WHEN 'cancel' THEN observation->>'observedStatus'='canceled' AND command.provider_success_applied
   ELSE false END,false) FROM payment_commands command WHERE command.id=target_command_id;
$$;
REVOKE ALL ON FUNCTION tideway_private.payment_command_signed_outcome_matches(uuid,jsonb) FROM PUBLIC;

CREATE FUNCTION tideway_private.payment_command_recovery_state(target_command_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c payment_commands%ROWTYPE; w tideway_private.payment_command_attempt_windows%ROWTYPE;
  a tideway_private.payment_command_recovery_attempts%ROWTYPE; previous_observation tideway_private.payment_command_recovery_attempts%ROWTYPE;
  reason text; required boolean:=false; held boolean:=false; latest_checked_at timestamptz;
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
  RETURN jsonb_build_object('commandId',c.id,'kind',c.command_kind,'status',c.status,'recoveryReason',reason,
    'checkedAt',latest_checked_at,'recoveryRequired',required,'reviewRequired',held);
END;
$$;
REVOKE ALL ON FUNCTION tideway_private.payment_command_recovery_state(uuid) FROM PUBLIC;

CREATE FUNCTION tideway_private.payment_reconciliation_hold(target_payment_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM payment_commands c WHERE c.payment_id=target_payment_id
   AND (tideway_private.payment_command_recovery_state(c.id)->>'reviewRequired')::boolean);
$$;
REVOKE ALL ON FUNCTION tideway_private.payment_reconciliation_hold(uuid) FROM PUBLIC;

CREATE FUNCTION tideway_private.payment_recovery_projection(target_payment_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT COALESCE(jsonb_agg(item.state-'reviewRequired' ORDER BY item.created_at DESC,item.id),'[]'::jsonb)
 FROM (SELECT c.id,c.created_at,tideway_private.payment_command_recovery_state(c.id) state FROM payment_commands c
   WHERE c.payment_id=target_payment_id AND (tideway_private.payment_command_recovery_state(c.id)->>'recoveryRequired')::boolean
   ORDER BY c.created_at DESC,c.id LIMIT 50) item;
$$;
REVOKE ALL ON FUNCTION tideway_private.payment_recovery_projection(uuid) FROM PUBLIC;

CREATE FUNCTION tideway_private.payment_other_reconciliation_hold(target_payment_id uuid,selected_command_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM payment_commands c WHERE c.payment_id=target_payment_id AND c.id<>selected_command_id
   AND (tideway_private.payment_command_recovery_state(c.id)->>'reviewRequired')::boolean);
$$;
REVOKE ALL ON FUNCTION tideway_private.payment_other_reconciliation_hold(uuid,uuid) FROM PUBLIC;

CREATE FUNCTION tideway_private.get_payment_command_attempt(target_command_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c payment_commands%ROWTYPE; p booking_payments%ROWTYPE; w tideway_private.payment_command_attempt_windows%ROWTYPE;
  actor uuid:=tideway_private.current_user_id();
BEGIN
  SELECT command.* INTO c FROM payment_commands command JOIN booking_payments payment ON payment.id=command.payment_id
    WHERE command.id=target_command_id AND actor IS NOT NULL AND (tideway_private.has_role('administrator')
      OR command.command_kind='cancel' AND payment.landlord_user_id=actor AND tideway_private.has_role('landlord'));
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='payment-command-not-found'; END IF;
  SELECT * INTO p FROM booking_payments WHERE id=c.payment_id;
  SELECT * INTO w FROM tideway_private.payment_command_attempt_windows WHERE command_id=c.id;
  RETURN jsonb_build_object('commandId',c.id,'paymentId',p.id,'bookingId',p.booking_id,'kind',c.command_kind,'status',c.status,
    'amountPence',c.amount_pence,'currency',p.currency,'providerPaymentId',p.provider_payment_id,'providerCommandId',c.provider_command_id,
    'requestIdentity',w.request_identity,'legacyUnknown',COALESCE(w.legacy_unknown,false),'hasAttemptWindow',w.command_id IS NOT NULL,
    'firstAttemptAt',w.first_attempt_at,'retryBefore',w.retry_before);
END;
$$;
REVOKE ALL ON FUNCTION tideway_private.get_payment_command_attempt(uuid) FROM PUBLIC;

CREATE FUNCTION tideway_private.get_administrator_payment_command_recovery(target_command_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF tideway_private.current_user_id() IS NULL OR NOT tideway_private.has_role('administrator') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='administrator-required'; END IF;
  RETURN tideway_private.get_payment_command_attempt(target_command_id);
END;
$$;
REVOKE ALL ON FUNCTION tideway_private.get_administrator_payment_command_recovery(uuid) FROM PUBLIC;

CREATE FUNCTION tideway_private.claim_payment_command_attempt(target_command_id uuid,supplied_request_hash bytea,supplied_identity jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  p booking_payments%ROWTYPE;
  c payment_commands%ROWTYPE;
  w tideway_private.payment_command_attempt_windows%ROWTYPE;
  actor uuid:=tideway_private.current_user_id();
  attempt_time timestamptz:=clock_timestamp();
  recovery_state jsonb;
BEGIN
  IF actor IS NULL OR supplied_request_hash IS NULL OR octet_length(supplied_request_hash)<>32
    OR jsonb_typeof(supplied_identity) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-payment-attempt'; END IF;
  SELECT payment.* INTO p FROM booking_payments payment JOIN payment_commands command ON command.payment_id=payment.id
    WHERE command.id=target_command_id AND (payment.landlord_user_id=actor AND tideway_private.has_role('landlord') OR tideway_private.has_role('administrator')) FOR UPDATE OF payment;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='payment-command-not-found'; END IF;
  SELECT * INTO c FROM payment_commands WHERE id=target_command_id FOR UPDATE;
  IF c.command_kind<>'cancel' AND NOT tideway_private.has_role('administrator') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='administrator-required'; END IF;
  SELECT * INTO w FROM tideway_private.payment_command_attempt_windows WHERE command_id=c.id FOR UPDATE;
  recovery_state:=tideway_private.payment_command_recovery_state(c.id);
  IF c.provider_command_id IS NOT NULL OR c.provider_success_applied OR c.provider_terminal_failure THEN
    RETURN jsonb_build_object('action','observe','status',c.status,'providerCommandId',c.provider_command_id,
      'legacyUnknown',COALESCE(w.legacy_unknown,true),'requestIdentity',w.request_identity); END IF;
  IF supplied_identity->>'commandId' IS DISTINCT FROM c.id::text OR supplied_identity->>'paymentId' IS DISTINCT FROM p.id::text
    OR supplied_identity->>'bookingId' IS DISTINCT FROM p.booking_id::text OR supplied_identity->>'kind' IS DISTINCT FROM c.command_kind
    OR supplied_identity->>'providerPaymentId' IS DISTINCT FROM p.provider_payment_id
    OR supplied_identity->>'amountPence' IS DISTINCT FROM c.amount_pence::text OR supplied_identity->>'currency' IS DISTINCT FROM p.currency::text
    OR supplied_identity->>'idempotencyKey' IS DISTINCT FROM 'tideway_payment_command_'||c.id::text
    THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='payment-attempt-identity-conflict'; END IF;
  IF c.command_kind='transfer' AND (COALESCE(supplied_identity->>'destinationAccountId','') !~ '^acct_[A-Za-z0-9_]{3,250}$'
    OR COALESCE(supplied_identity->>'sourceChargeId','') !~ '^ch_[A-Za-z0-9_]{3,250}$')
    THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='payment-attempt-transfer-identity-missing'; END IF;
  IF w.command_id IS NULL THEN
    IF tideway_private.payment_other_reconciliation_hold(p.id,c.id) OR ((recovery_state->>'reviewRequired')::boolean
      AND recovery_state->>'recoveryReason' IS DISTINCT FROM 'transfer-source-unavailable') THEN
      RETURN jsonb_build_object('action','recover','legacyUnknown',false,'requestIdentity',NULL,'recoveryReason','payment-reconciliation-required'); END IF;
    IF p.status='disputed' OR tideway_private.payment_dispute_hold(p.id) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='payment-dispute-review-required'; END IF;
    INSERT INTO tideway_private.payment_command_attempt_windows(command_id,first_attempt_at,retry_before,request_hash,request_identity)
      VALUES(c.id,attempt_time,attempt_time+interval '23 hours',supplied_request_hash,supplied_identity) RETURNING * INTO w;
  END IF;
  IF w.legacy_unknown OR clock_timestamp()>=w.retry_before THEN
    RETURN jsonb_build_object('action','recover','legacyUnknown',w.legacy_unknown,'requestIdentity',w.request_identity,'firstAttemptAt',w.first_attempt_at); END IF;
  IF w.request_hash IS DISTINCT FROM supplied_request_hash OR w.request_identity IS DISTINCT FROM supplied_identity
    THEN
      INSERT INTO tideway_private.payment_command_recovery_attempts(command_id,actor_id,outcome,reason)
        VALUES(c.id,actor,'operator-required','payment-attempt-parameters-changed');
      RETURN jsonb_build_object('action','recover','legacyUnknown',false,'requestIdentity',w.request_identity,'recoveryReason','payment-attempt-parameters-changed');
  END IF;
  IF tideway_private.payment_other_reconciliation_hold(p.id,c.id) OR ((recovery_state->>'reviewRequired')::boolean
    AND COALESCE(recovery_state->>'recoveryReason','') NOT IN ('provider-command-outcome-unknown','provider-recovery-unavailable','no-object-found-is-not-proof-of-no-effect','transfer-source-unavailable')) THEN
    RETURN jsonb_build_object('action','recover','legacyUnknown',w.legacy_unknown,'requestIdentity',w.request_identity,'recoveryReason','payment-reconciliation-required'); END IF;
  -- Revalidate the dispute barrier for every retry, not only the first one.
  IF p.status='disputed' OR tideway_private.payment_dispute_hold(p.id) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='payment-dispute-review-required'; END IF;
  RETURN jsonb_build_object('action','post','requestIdentity',w.request_identity,'firstAttemptAt',w.first_attempt_at,
    'remainingMs',floor(extract(epoch FROM w.retry_before-clock_timestamp())*1000));
END;
$$;
REVOKE ALL ON FUNCTION tideway_private.claim_payment_command_attempt(uuid,bytea,jsonb) FROM PUBLIC;

-- The supplied discovery is an audited API snapshot, NEVER a signed event.
-- It can bind identity while pending. Only retained verified webhook rows are
-- replayed through the existing idempotent monetary reconciler.
CREATE FUNCTION tideway_private.record_payment_command_recovery(target_command_id uuid,supplied_outcome text,supplied_reason text,supplied_provider_object_id text,supplied_evidence jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p booking_payments%ROWTYPE; c payment_commands%ROWTYPE;
  w tideway_private.payment_command_attempt_windows%ROWTYPE; e tideway_private.payment_provider_events%ROWTYPE;
  result jsonb; replayed integer:=0; audit_id bigint; actor uuid:=tideway_private.current_user_id();
  recovery_reason text; evidence jsonb; recovered boolean:=false; failed boolean:=false;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='payment-role-required'; END IF;
  SELECT payment.* INTO p FROM booking_payments payment JOIN payment_commands command ON command.payment_id=payment.id
    WHERE command.id=target_command_id AND (tideway_private.has_role('administrator') OR command.command_kind='cancel' AND payment.landlord_user_id=actor AND tideway_private.has_role('landlord')) FOR UPDATE OF payment;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='payment-command-not-found'; END IF;
  SELECT * INTO c FROM payment_commands WHERE id=target_command_id FOR UPDATE;
  SELECT * INTO w FROM tideway_private.payment_command_attempt_windows WHERE command_id=c.id;
  recovery_reason:=CASE WHEN supplied_reason ~ '^[a-z][a-z0-9-]{0,119}$' THEN supplied_reason ELSE 'provider-recovery-failed' END;
  evidence:=CASE WHEN jsonb_typeof(supplied_evidence)='object' AND octet_length(supplied_evidence::text)<=4096
    AND supplied_evidence-ARRAY['source','amountPence','currency','providerPaymentId','sourceChargeId','destinationAccountId','observedStatus','observedReversedAmount']='{}'::jsonb
    THEN supplied_evidence ELSE '{}'::jsonb END;
  -- Insert outside the exception subtransaction so failures remain inspectable.
  INSERT INTO tideway_private.payment_command_recovery_attempts(command_id,actor_id,outcome,reason,evidence)
    VALUES(c.id,actor,'operator-required','recovery-in-progress',evidence) RETURNING id INTO audit_id;
  IF supplied_outcome IS DISTINCT FROM 'found-awaiting-signed-evidence' THEN
    UPDATE tideway_private.payment_command_recovery_attempts SET reason=CASE WHEN supplied_outcome='operator-required' THEN recovery_reason ELSE 'invalid-command-recovery' END WHERE id=audit_id;
    RETURN jsonb_build_object('status',c.status,'recoveryRequired',true,'recoveryReason',CASE WHEN supplied_outcome='operator-required' THEN recovery_reason ELSE 'invalid-command-recovery' END,'signedEventsReplayed',0);
  END IF;
  BEGIN
    IF (c.command_kind='refund' AND COALESCE(supplied_provider_object_id,'') !~ '^re_[A-Za-z0-9_]{3,250}$')
      OR (c.command_kind='transfer' AND COALESCE(supplied_provider_object_id,'') !~ '^tr_[A-Za-z0-9_]{3,250}$')
      OR (c.command_kind IN ('capture','cancel') AND supplied_provider_object_id IS DISTINCT FROM p.provider_payment_id)
      OR c.provider_command_id IS NOT NULL AND c.provider_command_id<>supplied_provider_object_id
      OR evidence->>'source' IS DISTINCT FROM 'stripe-api-discovery'
      OR evidence->>'amountPence' IS DISTINCT FROM c.amount_pence::text OR evidence->>'currency' IS DISTINCT FROM p.currency::text
      OR evidence->>'providerPaymentId' IS DISTINCT FROM p.provider_payment_id
      THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='payment-recovery-identity-conflict'; END IF;
    IF c.command_kind='transfer' THEN
      IF w.request_identity->>'destinationAccountId' IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='original-destination-unavailable'; END IF;
      IF evidence->>'destinationAccountId' IS DISTINCT FROM w.request_identity->>'destinationAccountId'
        OR evidence->>'sourceChargeId' IS DISTINCT FROM w.request_identity->>'sourceChargeId'
        OR COALESCE(evidence->>'observedReversedAmount','') !~ '^[0-9]{1,8}$'
        THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='payment-recovery-identity-conflict'; END IF;
      IF (evidence->>'observedReversedAmount')::integer NOT IN (0,c.amount_pence) THEN
        RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='partial-transfer-reversal-requires-accounting'; END IF;
    ELSIF COALESCE(evidence->>'observedStatus','') NOT IN ('succeeded','pending','requires_action','failed','canceled','requires_capture','requires_payment_method','processing','requires_confirmation') THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='payment-recovery-identity-conflict';
    END IF;
    UPDATE payment_commands SET provider_command_id=COALESCE(provider_command_id,supplied_provider_object_id),
      status=CASE WHEN status='created' THEN 'provider-pending' ELSE status END,updated_at=now() WHERE id=c.id;
    IF (SELECT count(*) FROM (SELECT 1 FROM tideway_private.payment_provider_events event WHERE event.payment_id=p.id
      AND event.command_id=c.id AND event.provider_object_id=supplied_provider_object_id LIMIT 101) bounded)>100 THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='retained-event-bound'; END IF;
    FOR e IN SELECT * FROM tideway_private.payment_provider_events event WHERE event.provider='stripe' AND event.payment_id=p.id
      AND event.command_id=c.id AND event.provider_object_id=supplied_provider_object_id AND event.amount_pence=c.amount_pence AND event.currency=p.currency
      AND ((c.command_kind='refund' AND event.event_kind IN ('refund-succeeded','refund-failed'))
        OR (c.command_kind='transfer' AND event.event_kind IN ('transfer-succeeded','transfer-reversed'))
        OR (c.command_kind='capture' AND event.event_kind IN ('capture-succeeded','capture-failed'))
        OR (c.command_kind='cancel' AND event.event_kind IN ('cancellation-succeeded','cancellation-failed')))
      ORDER BY event.occurred_at,event.received_at,event.provider_event_id LIMIT 100 LOOP
      result:=tideway_private.reconcile_payment_provider_event(e.provider,e.provider_event_id,e.event_kind,e.provider_object_id,e.payment_id,e.command_id,e.amount_pence,e.currency,e.occurred_at,e.payload_hash);
      IF result->>'accepted' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='signed-event-prerequisite-unresolved'; END IF;
      replayed:=replayed+1;
    END LOOP;
    recovered:=tideway_private.payment_command_signed_outcome_matches(c.id,evidence);
  EXCEPTION WHEN OTHERS THEN
    -- The binding and every monetary replay roll back together. Never leave a
    -- half-applied financial result while calling the overall recovery failed.
    failed:=true; replayed:=0;
    recovery_reason:=CASE WHEN SQLSTATE='23505' THEN 'signed-event-replay-conflict'
      WHEN SQLSTATE='22023' THEN 'payment-recovery-identity-conflict'
      WHEN SQLERRM IN ('original-destination-unavailable','partial-transfer-reversal-requires-accounting','retained-event-bound','signed-event-prerequisite-unresolved') THEN SQLERRM
      ELSE 'signed-event-replay-failed' END;
  END;
  SELECT * INTO c FROM payment_commands WHERE id=target_command_id;
  IF NOT failed THEN
    recovery_reason:=CASE WHEN recovered THEN NULL
      WHEN (c.command_kind='refund' AND evidence->>'observedStatus' IN ('failed','canceled'))
        OR (c.command_kind='transfer' AND evidence->>'observedReversedAmount'<>'0')
        OR (c.command_kind IN ('capture','cancel') AND evidence->>'observedStatus' IN ('succeeded','canceled'))
        THEN 'awaiting-signed-terminal-evidence' ELSE 'awaiting-signed-evidence' END;
  END IF;
  UPDATE tideway_private.payment_command_recovery_attempts SET outcome=CASE WHEN failed THEN 'operator-required' WHEN recovered THEN 'signed-evidence-replayed' ELSE 'found-awaiting-signed-evidence' END,
    reason=recovery_reason,provider_object_id=CASE WHEN NOT failed THEN supplied_provider_object_id ELSE NULL END WHERE id=audit_id;
  -- Return the same durable hold that the administrator projections expose,
  -- including an earlier adverse observation followed by a stale success GET.
  result:=tideway_private.payment_command_recovery_state(c.id);
  IF (result->>'reviewRequired')::boolean THEN
    recovered:=false; recovery_reason:=result->>'recoveryReason';
  END IF;
  RETURN jsonb_build_object('status',c.status,'recoveryRequired',NOT recovered OR failed,'recoveryReason',recovery_reason,'signedEventsReplayed',replayed);
END;
$$;
REVOKE ALL ON FUNCTION tideway_private.record_payment_command_recovery(uuid,text,text,text,jsonb) FROM PUBLIC;


-- Reserve no replacement while an earlier monetary outcome needs recovery.
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
  SELECT * INTO payment_record FROM booking_payments WHERE id=target_payment_id AND (landlord_user_id=actor_id OR tideway_private.has_role('administrator')) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='payment-not-found'; END IF;
  SELECT * INTO command_record FROM payment_commands WHERE idempotency_key_hash=supplied_idempotency_hash;
  IF FOUND THEN
    IF command_record.payment_id <> target_payment_id OR command_record.command_kind <> selected_kind OR command_record.created_by <> actor_id OR (selected_kind='refund' AND requested_amount_pence IS DISTINCT FROM command_record.amount_pence) THEN RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='payment-command-idempotency-conflict'; END IF;
  ELSE
    IF tideway_private.payment_reconciliation_hold(payment_record.id) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='payment-reconciliation-required'; END IF;
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
  -- Idempotent retries must not execute a previously prepared but unsent action after a dispute.
  IF command_record.provider_command_id IS NULL AND (payment_record.status='disputed' OR tideway_private.payment_dispute_hold(payment_record.id))
    THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='payment-dispute-review-required'; END IF;
  IF selected_kind='transfer' AND destination IS NULL THEN SELECT account.destination_account_id INTO destination FROM tideway_private.cleaner_payout_accounts account WHERE account.cleaner_user_id=payment_record.cleaner_user_id AND account.provider=payment_record.provider AND account.payouts_enabled AND account.details_submitted; END IF;
  RETURN QUERY SELECT command_record.id,payment_record.id,booking_record.id,command_record.command_kind,command_record.status,command_record.amount_pence,payment_record.currency,payment_record.provider_payment_id,command_record.provider_command_id,destination;
END;
$$;

-- API object snapshots cannot release a reservation; signed outcomes do.
CREATE OR REPLACE FUNCTION tideway_private.record_booking_payment_command(target_command_id uuid, supplied_provider_command_id text, provider_result text)
RETURNS TABLE(command_id uuid,payment_id uuid,kind text,status text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  command_record payment_commands%ROWTYPE;
  payment_record booking_payments%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR provider_result NOT IN ('pending','succeeded','failed') OR char_length(COALESCE(supplied_provider_command_id,'')) NOT BETWEEN 3 AND 255 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-provider-command'; END IF;
  SELECT payment.* INTO payment_record FROM booking_payments payment JOIN payment_commands command ON command.payment_id=payment.id WHERE command.id=target_command_id AND (payment.landlord_user_id=actor_id OR tideway_private.has_role('administrator')) FOR UPDATE OF payment;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='payment-command-not-found'; END IF;
  SELECT command.* INTO command_record FROM payment_commands command JOIN booking_payments payment ON payment.id=command.payment_id WHERE command.id=target_command_id AND (payment.landlord_user_id=actor_id OR tideway_private.has_role('administrator')) FOR UPDATE OF command;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='payment-command-not-found'; END IF;
  IF command_record.command_kind<>'cancel' AND NOT tideway_private.has_role('administrator') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='administrator-required'; END IF;
  IF command_record.provider_command_id IS NOT NULL AND command_record.provider_command_id <> supplied_provider_command_id THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='provider-command-conflict'; END IF;
  IF command_record.status IN ('reconciled','provider-failed') THEN
    UPDATE payment_commands SET provider_command_id=COALESCE(provider_command_id,supplied_provider_command_id),updated_at=now() WHERE id=command_record.id RETURNING * INTO command_record;
  ELSE
    UPDATE payment_commands SET provider_command_id=COALESCE(provider_command_id,supplied_provider_command_id),status='provider-pending',updated_at=now() WHERE id=command_record.id RETURNING * INTO command_record;
  END IF;
  RETURN QUERY SELECT command_record.id,command_record.payment_id,command_record.command_kind,command_record.status;
END;
$$;

CREATE OR REPLACE FUNCTION tideway_private.list_administrator_payment_operations(selected_status text, page_limit integer, page_offset integer)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  result jsonb;
BEGIN
  IF tideway_private.current_user_id() IS NULL OR NOT tideway_private.has_role('administrator') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='administrator-required';
  END IF;
  IF selected_status IS NOT NULL AND selected_status NOT IN ('actionable','creating','requires-customer-action','processing','authorized','authorization-failed','captured','partially-refunded','refunded','cancelled','disputed') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-payment-operation-status';
  END IF;
  IF page_limit NOT BETWEEN 1 AND 100 OR page_offset NOT BETWEEN 0 AND 10000 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-payment-operation-page';
  END IF;

  WITH payment_state AS (
    SELECT payment.id AS payment_id,
      payment.booking_id,
      payment.status AS payment_status,
      booking.status AS booking_status,
      booking.journey_started_at,
      booking.scheduled_start_at,
      booking.scheduled_end_at,
      payment.amount_pence,
      payment.currency,
      payment.amount_captured_pence,
      payment.amount_refunded_pence,
      booking.cleaner_pay_pence,
      payment.updated_at,
      payment.status='disputed' OR tideway_private.payment_dispute_hold(payment.id) AS dispute_review_required,
      tideway_private.payment_reconciliation_hold(payment.id) AS reconciliation_review_required,
      tideway_private.payment_recovery_projection(payment.id) AS recovery_commands,
      tideway_private.payment_dispute_projection(payment.id) AS disputes,
      payout.payouts_enabled IS TRUE AND payout.details_submitted IS TRUE AS payout_ready,
      capture_command.status AS capture_status,
      refund_command.status AS refund_status,
      transfer_command.status AS transfer_status,
      cancel_command.status AS cancel_status
    FROM booking_payments payment
    JOIN bookings booking ON booking.id=payment.booking_id
    LEFT JOIN tideway_private.cleaner_payout_accounts payout
      ON payout.cleaner_user_id=payment.cleaner_user_id AND payout.provider=payment.provider
    LEFT JOIN LATERAL (
      SELECT command.status FROM payment_commands command
      WHERE command.payment_id=payment.id AND command.command_kind='capture'
      ORDER BY command.created_at DESC LIMIT 1
    ) capture_command ON true
    LEFT JOIN LATERAL (
      SELECT command.status FROM payment_commands command
      WHERE command.payment_id=payment.id AND command.command_kind='refund'
      ORDER BY command.created_at DESC LIMIT 1
    ) refund_command ON true
    LEFT JOIN LATERAL (
      SELECT command.status FROM payment_commands command
      WHERE command.payment_id=payment.id AND command.command_kind='transfer'
      ORDER BY command.created_at DESC LIMIT 1
    ) transfer_command ON true
    LEFT JOIN LATERAL (
      SELECT command.status FROM payment_commands command
      WHERE command.payment_id=payment.id AND command.command_kind='cancel'
      ORDER BY command.created_at DESC LIMIT 1
    ) cancel_command ON true
  ), projected AS (
    SELECT state.*,
      state.booking_status='completed' AND state.payment_status='authorized'
        AND (state.capture_status IS NULL OR state.capture_status='provider-failed') AS can_capture,
      state.booking_status='confirmed' AND state.payment_status IN ('creating','requires-customer-action','processing','authorized')
        AND state.journey_started_at IS NULL AND (state.cancel_status IS NULL OR state.cancel_status='provider-failed') AS can_cancel,
      state.booking_status IN ('completed','cancelled','disputed') AND state.payment_status IN ('captured','partially-refunded')
        AND state.amount_captured_pence>state.amount_refunded_pence
        AND state.refund_status IS DISTINCT FROM 'created' AND state.refund_status IS DISTINCT FROM 'provider-pending'
        AND (state.transfer_status IS NULL OR state.transfer_status='provider-failed') AS can_refund,
      state.booking_status='completed' AND state.payment_status='captured'
        AND state.amount_captured_pence=state.amount_pence AND state.payout_ready
        AND state.refund_status IS DISTINCT FROM 'created' AND state.refund_status IS DISTINCT FROM 'provider-pending'
        AND (state.transfer_status IS NULL OR state.transfer_status='provider-failed') AS can_transfer,
      state.capture_status IN ('created','provider-pending') OR state.refund_status IN ('created','provider-pending')
        OR state.transfer_status IN ('created','provider-pending') OR state.cancel_status IN ('created','provider-pending') AS awaiting_provider
    FROM payment_state state
  ), selected AS (
    SELECT * FROM projected item
    WHERE (selected_status IS NULL OR selected_status='actionable' AND (item.can_capture OR item.can_cancel OR item.can_refund OR item.can_transfer OR item.awaiting_provider OR item.dispute_review_required OR item.reconciliation_review_required OR jsonb_array_length(item.recovery_commands)>0) OR item.payment_status=selected_status)
    ORDER BY (item.can_capture OR item.can_transfer OR item.can_refund OR item.can_cancel) DESC, item.updated_at DESC, item.payment_id DESC
    LIMIT page_limit OFFSET page_offset
  )
  SELECT jsonb_build_object(
    'payments', COALESCE(jsonb_agg(jsonb_build_object(
      'paymentId', selected.payment_id,
      'bookingId', selected.booking_id,
      'paymentStatus', selected.payment_status,
      'disputeReviewRequired', selected.dispute_review_required,
      'reconciliationReviewRequired',selected.reconciliation_review_required,
      'recoveryCommands',selected.recovery_commands,
      'disputes', selected.disputes,
      'bookingStatus', selected.booking_status,
      'scheduledStartAt', selected.scheduled_start_at,
      'scheduledEndAt', selected.scheduled_end_at,
      'amountPence', selected.amount_pence,
      'currency', selected.currency,
      'amountCapturedPence', selected.amount_captured_pence,
      'amountRefundedPence', selected.amount_refunded_pence,
      'cleanerPayPence', selected.cleaner_pay_pence,
      'payoutReady', selected.payout_ready,
      'canCapture', (selected.can_capture AND NOT selected.dispute_review_required AND NOT selected.reconciliation_review_required),
      'canCancel', (selected.can_cancel AND NOT selected.dispute_review_required AND NOT selected.reconciliation_review_required),
      'canRefund', (selected.can_refund AND NOT selected.dispute_review_required AND NOT selected.reconciliation_review_required),
      'canTransfer', (selected.can_transfer AND NOT selected.dispute_review_required AND NOT selected.reconciliation_review_required),
      'awaitingProvider', selected.awaiting_provider,
      'captureStatus', selected.capture_status,
      'cancelStatus', selected.cancel_status,
      'refundStatus', selected.refund_status,
      'transferStatus', selected.transfer_status,
      'updatedAt', selected.updated_at
    ) ORDER BY (selected.can_capture OR selected.can_transfer OR selected.can_refund OR selected.can_cancel) DESC, selected.updated_at DESC, selected.payment_id DESC), '[]'::jsonb),
    'limit', page_limit,
    'offset', page_offset
  ) INTO result FROM selected;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.list_administrator_payment_operations(text,integer,integer) FROM PUBLIC;



CREATE OR REPLACE FUNCTION tideway_private.get_administrator_booking_payment_operation(selected_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  result jsonb;
BEGIN
  IF tideway_private.current_user_id() IS NULL OR NOT tideway_private.has_role('administrator') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='administrator-required';
  END IF;
  IF selected_booking_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-payment-operation-booking';
  END IF;

  WITH payment_state AS (
    SELECT payment.id AS payment_id,
      payment.booking_id,
      payment.status AS payment_status,
      booking.status AS booking_status,
      booking.journey_started_at,
      booking.scheduled_start_at,
      booking.scheduled_end_at,
      payment.amount_pence,
      payment.currency,
      payment.amount_captured_pence,
      payment.amount_refunded_pence,
      booking.cleaner_pay_pence,
      payment.updated_at,
      payment.status='disputed' OR tideway_private.payment_dispute_hold(payment.id) AS dispute_review_required,
      tideway_private.payment_reconciliation_hold(payment.id) AS reconciliation_review_required,
      tideway_private.payment_recovery_projection(payment.id) AS recovery_commands,
      tideway_private.payment_dispute_projection(payment.id) AS disputes,
      payout.payouts_enabled IS TRUE AND payout.details_submitted IS TRUE AS payout_ready,
      capture_command.status AS capture_status,
      refund_command.status AS refund_status,
      transfer_command.status AS transfer_status,
      cancel_command.status AS cancel_status
    FROM booking_payments payment
    JOIN bookings booking ON booking.id=payment.booking_id
    LEFT JOIN tideway_private.cleaner_payout_accounts payout
      ON payout.cleaner_user_id=payment.cleaner_user_id AND payout.provider=payment.provider
    LEFT JOIN LATERAL (
      SELECT command.status FROM payment_commands command
      WHERE command.payment_id=payment.id AND command.command_kind='capture'
      ORDER BY command.created_at DESC LIMIT 1
    ) capture_command ON true
    LEFT JOIN LATERAL (
      SELECT command.status FROM payment_commands command
      WHERE command.payment_id=payment.id AND command.command_kind='refund'
      ORDER BY command.created_at DESC LIMIT 1
    ) refund_command ON true
    LEFT JOIN LATERAL (
      SELECT command.status FROM payment_commands command
      WHERE command.payment_id=payment.id AND command.command_kind='transfer'
      ORDER BY command.created_at DESC LIMIT 1
    ) transfer_command ON true
    LEFT JOIN LATERAL (
      SELECT command.status FROM payment_commands command
      WHERE command.payment_id=payment.id AND command.command_kind='cancel'
      ORDER BY command.created_at DESC LIMIT 1
    ) cancel_command ON true
    WHERE payment.booking_id=selected_booking_id
  ), projected AS (
    SELECT state.*,
      state.booking_status='completed' AND state.payment_status='authorized'
        AND (state.capture_status IS NULL OR state.capture_status='provider-failed') AS can_capture,
      state.booking_status='confirmed' AND state.payment_status IN ('creating','requires-customer-action','processing','authorized')
        AND state.journey_started_at IS NULL AND (state.cancel_status IS NULL OR state.cancel_status='provider-failed') AS can_cancel,
      state.booking_status IN ('completed','cancelled','disputed') AND state.payment_status IN ('captured','partially-refunded')
        AND state.amount_captured_pence>state.amount_refunded_pence
        AND state.refund_status IS DISTINCT FROM 'created' AND state.refund_status IS DISTINCT FROM 'provider-pending'
        AND (state.transfer_status IS NULL OR state.transfer_status='provider-failed') AS can_refund,
      state.booking_status='completed' AND state.payment_status='captured'
        AND state.amount_captured_pence=state.amount_pence AND state.payout_ready
        AND state.refund_status IS DISTINCT FROM 'created' AND state.refund_status IS DISTINCT FROM 'provider-pending'
        AND (state.transfer_status IS NULL OR state.transfer_status='provider-failed') AS can_transfer,
      state.capture_status IN ('created','provider-pending') OR state.refund_status IN ('created','provider-pending')
        OR state.transfer_status IN ('created','provider-pending') OR state.cancel_status IN ('created','provider-pending') AS awaiting_provider
    FROM payment_state state
  )
  SELECT jsonb_build_object(
    'paymentId', selected.payment_id,
    'bookingId', selected.booking_id,
    'paymentStatus', selected.payment_status,
      'disputeReviewRequired', selected.dispute_review_required,
      'reconciliationReviewRequired',selected.reconciliation_review_required,
      'recoveryCommands',selected.recovery_commands,
      'disputes', selected.disputes,
    'bookingStatus', selected.booking_status,
    'scheduledStartAt', selected.scheduled_start_at,
    'scheduledEndAt', selected.scheduled_end_at,
    'amountPence', selected.amount_pence,
    'currency', selected.currency,
    'amountCapturedPence', selected.amount_captured_pence,
    'amountRefundedPence', selected.amount_refunded_pence,
    'cleanerPayPence', selected.cleaner_pay_pence,
    'payoutReady', selected.payout_ready,
    'canCapture', (selected.can_capture AND NOT selected.dispute_review_required AND NOT selected.reconciliation_review_required),
    'canCancel', (selected.can_cancel AND NOT selected.dispute_review_required AND NOT selected.reconciliation_review_required),
    'canRefund', (selected.can_refund AND NOT selected.dispute_review_required AND NOT selected.reconciliation_review_required),
    'canTransfer', (selected.can_transfer AND NOT selected.dispute_review_required AND NOT selected.reconciliation_review_required),
    'awaitingProvider', selected.awaiting_provider,
    'captureStatus', selected.capture_status,
    'cancelStatus', selected.cancel_status,
    'refundStatus', selected.refund_status,
    'transferStatus', selected.transfer_status,
    'updatedAt', selected.updated_at
  ) INTO result
  FROM projected selected
  LIMIT 1;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.get_administrator_booking_payment_operation(uuid) FROM PUBLIC;



COMMIT;
