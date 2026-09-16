BEGIN;

ALTER TABLE tideway_private.payment_provider_events ADD COLUMN provider_dispute_id text, ADD COLUMN dispute_status text;

-- A closed dispute is not necessarily won. Keep its identity and outcome
-- separate from captured/refunded totals: a chargeback is not an app refund.
CREATE TABLE tideway_private.payment_disputes (
  dispute_key text PRIMARY KEY,
  provider_dispute_id text UNIQUE CHECK (provider_dispute_id IS NULL OR provider_dispute_id ~ '^du_[A-Za-z0-9_]{3,250}$'),
  payment_id uuid NOT NULL REFERENCES booking_payments(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('warning_needs_response','warning_under_review','needs_response','under_review','won','lost','warning_closed','prevented','unknown','conflict')),
  closed boolean NOT NULL,
  requires_review boolean NOT NULL,
  last_event_id text NOT NULL,
  last_event_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_disputes_payment_idx ON tideway_private.payment_disputes(payment_id);
REVOKE ALL ON tideway_private.payment_disputes FROM PUBLIC;

-- Historical events discarded the dispute outcome, including rejected events
-- acknowledged by the previous webhook handler. They cannot prove funds safe.
INSERT INTO tideway_private.payment_disputes(dispute_key,payment_id,status,closed,requires_review,last_event_id,last_event_at)
SELECT 'legacy_'||md5(event.provider_event_id),payment.id,'unknown',event.event_kind='dispute-closed',true,event.provider_event_id,event.occurred_at
FROM tideway_private.payment_provider_events event JOIN booking_payments payment ON payment.id=event.payment_id
WHERE event.event_kind IN ('dispute-opened','dispute-closed');

INSERT INTO payment_status_history(payment_id,from_status,to_status,event_source,reason,metadata)
SELECT payment.id,payment.status,'disputed','provider','Historical dispute outcome requires reconciliation before further money actions.',jsonb_build_object('migration',111)
FROM booking_payments payment WHERE payment.status <> 'disputed'
AND EXISTS (SELECT 1 FROM tideway_private.payment_disputes dispute WHERE dispute.payment_id=payment.id);
UPDATE booking_payments payment SET status='disputed',updated_at=now()
WHERE EXISTS (SELECT 1 FROM tideway_private.payment_disputes dispute WHERE dispute.payment_id=payment.id);

CREATE FUNCTION tideway_private.payment_dispute_hold(target_payment_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM tideway_private.payment_disputes dispute
    WHERE dispute.payment_id=target_payment_id AND (dispute.requires_review OR dispute.status NOT IN ('won','warning_closed')));
$$;
REVOKE ALL ON FUNCTION tideway_private.payment_dispute_hold(uuid) FROM PUBLIC;

CREATE FUNCTION tideway_private.payment_dispute_projection(target_payment_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('providerDisputeId',dispute.provider_dispute_id,'status',dispute.status,
    'lastEventId',dispute.last_event_id,'requiresReview',dispute.requires_review OR dispute.status NOT IN ('won','warning_closed'))
    ORDER BY dispute.last_event_at DESC,dispute.dispute_key),'[]'::jsonb)
  FROM tideway_private.payment_disputes dispute WHERE dispute.payment_id=target_payment_id;
$$;
REVOKE ALL ON FUNCTION tideway_private.payment_dispute_projection(uuid) FROM PUBLIC;

CREATE FUNCTION tideway_private.reconcile_payment_dispute_event(selected_provider text,supplied_event_id text,supplied_kind text,supplied_object_id text,target_payment_id uuid,target_command_id uuid,supplied_amount_pence integer,supplied_currency character(3),supplied_occurred_at timestamptz,supplied_payload_hash character(64),supplied_dispute_id text,supplied_dispute_status text)
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
    IF ROW(prior_event.payment_id,prior_event.provider_object_id,prior_event.event_kind,prior_event.payload_hash,prior_event.occurred_at)
       IS DISTINCT FROM ROW(target_payment_id,supplied_object_id,supplied_kind,supplied_payload_hash,supplied_occurred_at)
       OR prior_event.provider_dispute_id IS NOT NULL AND supplied_dispute_id IS NOT NULL
       AND ROW(prior_event.provider_dispute_id,prior_event.dispute_status) IS DISTINCT FROM ROW(supplied_dispute_id,supplied_dispute_status)
      THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='payment-event-identity-conflict'; END IF;
    IF prior_event.provider_dispute_id IS NULL AND supplied_dispute_id IS NOT NULL THEN
      -- A verified replay of the exact historical payload can supply its lost
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
REVOKE ALL ON FUNCTION tideway_private.reconcile_payment_dispute_event(text,text,text,text,uuid,uuid,integer,character,timestamptz,character,text,text) FROM PUBLIC;

-- Revalidate existing command retries and preserve late signed money facts under a dispute hold.
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
  -- Backward-compatible old servers cannot restore funds from an outcome-less closure.
  IF supplied_kind IN ('dispute-opened','dispute-closed') THEN
    RETURN tideway_private.reconcile_payment_dispute_event(selected_provider,supplied_event_id,supplied_kind,supplied_object_id,target_payment_id,target_command_id,supplied_amount_pence,supplied_currency,supplied_occurred_at,supplied_payload_hash,NULL,NULL);
  END IF;
  IF selected_provider <> 'stripe' OR char_length(COALESCE(supplied_event_id,'')) NOT BETWEEN 3 AND 255 OR char_length(COALESCE(supplied_object_id,'')) NOT BETWEEN 3 AND 255 OR supplied_payload_hash !~ '^[0-9a-f]{64}$' OR supplied_occurred_at > now()+interval '5 minutes' THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-payment-event'; END IF;
  INSERT INTO tideway_private.payment_provider_events(provider,provider_event_id,event_kind,provider_object_id,payment_id,command_id,amount_pence,currency,occurred_at,payload_hash)
    VALUES(selected_provider,supplied_event_id,supplied_kind,supplied_object_id,target_payment_id,target_command_id,supplied_amount_pence,supplied_currency,supplied_occurred_at,supplied_payload_hash)
    ON CONFLICT(provider,provider_event_id) DO NOTHING;
  IF NOT FOUND THEN RETURN jsonb_build_object('accepted',true,'duplicate',true); END IF;
  SELECT * INTO payment_record FROM booking_payments WHERE id=target_payment_id AND provider=selected_provider FOR UPDATE;
  IF NOT FOUND THEN UPDATE tideway_private.payment_provider_events SET processed=true,result_code='payment-mismatch' WHERE provider=selected_provider AND provider_event_id=supplied_event_id; RETURN jsonb_build_object('accepted',false,'duplicate',false); END IF;
  IF supplied_kind LIKE 'authorization-%' AND payment_record.last_provider_event_at IS NOT NULL AND supplied_occurred_at < payment_record.last_provider_event_at THEN UPDATE tideway_private.payment_provider_events SET processed=true,result_code='stale-event' WHERE provider=selected_provider AND provider_event_id=supplied_event_id; RETURN jsonb_build_object('accepted',true,'duplicate',false,'stale',true); END IF;
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
    WHEN 'capture-succeeded' THEN prior_status='authorized' OR (prior_status='disputed' AND payment_record.amount_captured_pence=0)
    WHEN 'capture-failed' THEN prior_status='authorized' OR (prior_status='disputed' AND payment_record.amount_captured_pence=0)
    WHEN 'cancellation-succeeded' THEN prior_status IN ('creating','requires-customer-action','processing','authorized')
    WHEN 'cancellation-failed' THEN prior_status IN ('creating','requires-customer-action','processing','authorized')
    WHEN 'refund-succeeded' THEN prior_status IN ('captured','partially-refunded','disputed') AND payment_record.amount_captured_pence-payment_record.amount_refunded_pence>=command_record.amount_pence
    WHEN 'refund-failed' THEN prior_status IN ('captured','partially-refunded','disputed') AND payment_record.amount_captured_pence-payment_record.amount_refunded_pence>=command_record.amount_pence
    WHEN 'transfer-succeeded' THEN prior_status IN ('captured','disputed') AND payment_record.amount_captured_pence>0
    WHEN 'transfer-failed' THEN prior_status IN ('captured','disputed') AND payment_record.amount_captured_pence>0
    WHEN 'transfer-reversed' THEN prior_status IN ('captured','disputed') AND payment_record.amount_captured_pence>0
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
  END IF;
  IF tideway_private.payment_dispute_hold(payment_record.id) THEN next_status := 'disputed'; END IF;
  UPDATE booking_payments SET status=next_status,last_provider_event_at=GREATEST(last_provider_event_at,supplied_occurred_at),
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
    WHERE (selected_status IS NULL OR selected_status='actionable' AND (item.can_capture OR item.can_cancel OR item.can_refund OR item.can_transfer OR item.awaiting_provider OR item.dispute_review_required) OR item.payment_status=selected_status)
    ORDER BY (item.can_capture OR item.can_transfer OR item.can_refund OR item.can_cancel) DESC, item.updated_at DESC, item.payment_id DESC
    LIMIT page_limit OFFSET page_offset
  )
  SELECT jsonb_build_object(
    'payments', COALESCE(jsonb_agg(jsonb_build_object(
      'paymentId', selected.payment_id,
      'bookingId', selected.booking_id,
      'paymentStatus', selected.payment_status,
      'disputeReviewRequired', selected.dispute_review_required,
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
      'canCapture', (selected.can_capture AND NOT selected.dispute_review_required),
      'canCancel', (selected.can_cancel AND NOT selected.dispute_review_required),
      'canRefund', (selected.can_refund AND NOT selected.dispute_review_required),
      'canTransfer', (selected.can_transfer AND NOT selected.dispute_review_required),
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
    'canCapture', (selected.can_capture AND NOT selected.dispute_review_required),
    'canCancel', (selected.can_cancel AND NOT selected.dispute_review_required),
    'canRefund', (selected.can_refund AND NOT selected.dispute_review_required),
    'canTransfer', (selected.can_transfer AND NOT selected.dispute_review_required),
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
