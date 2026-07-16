BEGIN;

CREATE TABLE booking_payments (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE RESTRICT,
  landlord_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  cleaner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider = 'stripe'),
  currency character(3) NOT NULL CHECK (currency = 'gbp'),
  amount_pence integer NOT NULL CHECK (amount_pence BETWEEN 1 AND 10000000),
  amount_captured_pence integer NOT NULL DEFAULT 0 CHECK (amount_captured_pence >= 0),
  amount_refunded_pence integer NOT NULL DEFAULT 0 CHECK (amount_refunded_pence >= 0),
  status text NOT NULL CHECK (status IN ('creating','requires-customer-action','processing','authorized','authorization-failed','captured','partially-refunded','refunded','cancelled','disputed')),
  terms_fingerprint character(64) NOT NULL CHECK (terms_fingerprint ~ '^[0-9a-f]{64}$'),
  provider_payment_id text UNIQUE CHECK (provider_payment_id IS NULL OR char_length(provider_payment_id) BETWEEN 3 AND 255),
  idempotency_key_hash bytea NOT NULL UNIQUE CHECK (octet_length(idempotency_key_hash) = 32),
  last_provider_event_at timestamptz,
  authorized_at timestamptz,
  captured_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (amount_captured_pence <= amount_pence),
  CHECK (amount_refunded_pence <= amount_captured_pence)
);

CREATE INDEX booking_payments_landlord_idx ON booking_payments(landlord_user_id, created_at DESC);
CREATE INDEX booking_payments_cleaner_idx ON booking_payments(cleaner_user_id, created_at DESC);

CREATE TABLE payment_commands (
  id uuid PRIMARY KEY,
  payment_id uuid NOT NULL REFERENCES booking_payments(id) ON DELETE RESTRICT,
  command_kind text NOT NULL CHECK (command_kind IN ('capture','cancel','refund','transfer')),
  amount_pence integer NOT NULL CHECK (amount_pence BETWEEN 1 AND 10000000),
  status text NOT NULL CHECK (status IN ('created','provider-pending','provider-failed','reconciled')),
  provider_command_id text UNIQUE CHECK (provider_command_id IS NULL OR char_length(provider_command_id) BETWEEN 3 AND 255),
  idempotency_key_hash bytea NOT NULL UNIQUE CHECK (octet_length(idempotency_key_hash) = 32),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reconciled_at timestamptz
);

CREATE UNIQUE INDEX payment_one_live_capture_idx ON payment_commands(payment_id) WHERE command_kind = 'capture' AND status <> 'provider-failed';
CREATE UNIQUE INDEX payment_one_live_cancel_idx ON payment_commands(payment_id) WHERE command_kind = 'cancel' AND status <> 'provider-failed';
CREATE UNIQUE INDEX payment_one_live_transfer_idx ON payment_commands(payment_id) WHERE command_kind = 'transfer' AND status <> 'provider-failed';

CREATE TABLE payment_status_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id uuid NOT NULL REFERENCES booking_payments(id) ON DELETE RESTRICT,
  from_status text,
  to_status text NOT NULL,
  event_source text NOT NULL CHECK (event_source IN ('landlord','administrator','provider')),
  changed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payment_status_history_payment_idx ON payment_status_history(payment_id, id);

CREATE TABLE tideway_private.cleaner_payout_accounts (
  cleaner_user_id uuid PRIMARY KEY REFERENCES cleaner_profiles(user_id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider = 'stripe'),
  destination_account_id text NOT NULL UNIQUE CHECK (char_length(destination_account_id) BETWEEN 3 AND 255),
  charges_enabled boolean NOT NULL DEFAULT false,
  payouts_enabled boolean NOT NULL DEFAULT false,
  details_submitted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tideway_private.payment_provider_events (
  provider text NOT NULL CHECK (provider = 'stripe'),
  provider_event_id text NOT NULL CHECK (char_length(provider_event_id) BETWEEN 3 AND 255),
  event_kind text NOT NULL CHECK (event_kind IN ('authorization-requires-action','authorization-processing','authorization-succeeded','authorization-failed','capture-succeeded','capture-failed','cancellation-succeeded','cancellation-failed','refund-succeeded','refund-failed','transfer-succeeded','transfer-failed','transfer-reversed','dispute-opened','dispute-closed')),
  provider_object_id text NOT NULL CHECK (char_length(provider_object_id) BETWEEN 3 AND 255),
  payment_id uuid,
  command_id uuid,
  amount_pence integer CHECK (amount_pence BETWEEN 1 AND 10000000),
  currency character(3) CHECK (currency IS NULL OR currency = 'gbp'),
  occurred_at timestamptz NOT NULL,
  payload_hash character(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  processed boolean NOT NULL DEFAULT false,
  result_code text,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, provider_event_id)
);

ALTER TABLE booking_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY booking_payments_owner_or_admin ON booking_payments FOR SELECT USING (landlord_user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator'));
CREATE POLICY payment_commands_owner_or_admin ON payment_commands FOR SELECT USING (EXISTS (SELECT 1 FROM booking_payments payment WHERE payment.id = payment_commands.payment_id AND (payment.landlord_user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator'))));
CREATE POLICY payment_history_owner_or_admin ON payment_status_history FOR SELECT USING (EXISTS (SELECT 1 FROM booking_payments payment WHERE payment.id = payment_status_history.payment_id AND (payment.landlord_user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator'))));

CREATE FUNCTION tideway_private.begin_booking_payment_authorization(proposed_payment_id uuid, target_booking_id uuid, selected_provider text, supplied_idempotency_hash bytea)
RETURNS booking_payments
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  booking_record bookings%ROWTYPE;
  payment_record booking_payments%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('landlord') THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='landlord-required'; END IF;
  IF selected_provider <> 'stripe' OR octet_length(supplied_idempotency_hash) <> 32 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-payment-request'; END IF;
  SELECT * INTO payment_record FROM booking_payments WHERE idempotency_key_hash=supplied_idempotency_hash;
  IF FOUND THEN
    IF payment_record.landlord_user_id <> actor_id OR payment_record.booking_id <> target_booking_id THEN RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='payment-idempotency-conflict'; END IF;
    RETURN payment_record;
  END IF;
  SELECT * INTO booking_record FROM bookings booking WHERE booking.id=target_booking_id AND booking.landlord_user_id=actor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='booking-not-found'; END IF;
  IF booking_record.status <> 'confirmed' OR booking_record.journey_started_at IS NOT NULL OR booking_record.scheduled_start_at <= now() OR booking_record.scheduled_start_at > now()+interval '5 days' THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='booking-not-authorizable'; END IF;
  IF EXISTS (SELECT 1 FROM booking_payments WHERE booking_id=booking_record.id) THEN RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='booking-payment-exists'; END IF;
  INSERT INTO booking_payments(id,booking_id,landlord_user_id,cleaner_user_id,provider,currency,amount_pence,status,terms_fingerprint,idempotency_key_hash)
    VALUES(proposed_payment_id,booking_record.id,booking_record.landlord_user_id,booking_record.cleaner_user_id,'stripe','gbp',booking_record.customer_price_pence,'creating',booking_record.terms_fingerprint,supplied_idempotency_hash)
    RETURNING * INTO payment_record;
  INSERT INTO payment_status_history(payment_id,from_status,to_status,event_source,changed_by,reason)
    VALUES(payment_record.id,NULL,'creating','landlord',actor_id,'Landlord started payment authorization for the frozen booking total.');
  RETURN payment_record;
END;
$$;

CREATE FUNCTION tideway_private.record_booking_payment_authorization(target_payment_id uuid, supplied_provider_payment_id text, provider_status text)
RETURNS booking_payments
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  payment_record booking_payments%ROWTYPE;
  prior_status text;
BEGIN
  IF actor_id IS NULL OR NOT (tideway_private.has_role('landlord') OR tideway_private.has_role('administrator')) THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='payment-role-required'; END IF;
  IF provider_status NOT IN ('requires-customer-action','processing','authorized','failed') OR char_length(COALESCE(supplied_provider_payment_id,'')) NOT BETWEEN 3 AND 255 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-provider-authorization'; END IF;
  SELECT * INTO payment_record FROM booking_payments WHERE id=target_payment_id AND (landlord_user_id=actor_id OR tideway_private.has_role('administrator')) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='payment-not-found'; END IF;
  IF payment_record.provider_payment_id IS NOT NULL AND payment_record.provider_payment_id <> supplied_provider_payment_id THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='provider-payment-conflict'; END IF;
  IF payment_record.status <> 'creating' AND payment_record.provider_payment_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='payment-state-conflict'; END IF;
  prior_status := payment_record.status;
  UPDATE booking_payments SET provider_payment_id=supplied_provider_payment_id,
    status=CASE provider_status WHEN 'failed' THEN 'authorization-failed' WHEN 'authorized' THEN 'processing' ELSE provider_status END,
    updated_at=now()
    WHERE id=payment_record.id RETURNING * INTO payment_record;
  IF prior_status <> payment_record.status THEN
    INSERT INTO payment_status_history(payment_id,from_status,to_status,event_source,changed_by,reason)
      VALUES(payment_record.id,prior_status,payment_record.status,CASE WHEN tideway_private.has_role('administrator') THEN 'administrator' ELSE 'landlord' END,actor_id,'Provider authorization was attached; signed events remain authoritative.');
  END IF;
  RETURN payment_record;
END;
$$;

CREATE FUNCTION tideway_private.begin_booking_payment_command(proposed_command_id uuid, target_payment_id uuid, selected_kind text, requested_amount_pence integer, supplied_idempotency_hash bytea)
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
      IF booking_record.status NOT IN ('completed','cancelled','disputed') OR payment_record.status NOT IN ('captured','partially-refunded') OR requested_amount_pence IS NULL OR requested_amount_pence < 1 OR requested_amount_pence > payment_record.amount_captured_pence-payment_record.amount_refunded_pence THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='payment-not-refundable'; END IF;
      selected_amount := requested_amount_pence;
    ELSE
      IF booking_record.status <> 'completed' OR payment_record.status <> 'captured' THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='payment-not-transferable'; END IF;
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

CREATE FUNCTION tideway_private.record_booking_payment_command(target_command_id uuid, supplied_provider_command_id text, provider_result text)
RETURNS TABLE(command_id uuid,payment_id uuid,kind text,status text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  command_record payment_commands%ROWTYPE;
  payment_record booking_payments%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR provider_result NOT IN ('pending','succeeded','failed') OR char_length(COALESCE(supplied_provider_command_id,'')) NOT BETWEEN 3 AND 255 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-provider-command'; END IF;
  SELECT command.* INTO command_record FROM payment_commands command JOIN booking_payments payment ON payment.id=command.payment_id WHERE command.id=target_command_id AND (payment.landlord_user_id=actor_id OR tideway_private.has_role('administrator')) FOR UPDATE OF command;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='payment-command-not-found'; END IF;
  IF command_record.provider_command_id IS NOT NULL AND command_record.provider_command_id <> supplied_provider_command_id THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='provider-command-conflict'; END IF;
  UPDATE payment_commands SET provider_command_id=supplied_provider_command_id,status=CASE WHEN provider_result='failed' THEN 'provider-failed' ELSE 'provider-pending' END,updated_at=now() WHERE id=command_record.id RETURNING * INTO command_record;
  RETURN QUERY SELECT command_record.id,command_record.payment_id,command_record.command_kind,command_record.status;
END;
$$;

CREATE FUNCTION tideway_private.reconcile_payment_provider_event(selected_provider text,supplied_event_id text,supplied_kind text,supplied_object_id text,target_payment_id uuid,target_command_id uuid,supplied_amount_pence integer,supplied_currency character(3),supplied_occurred_at timestamptz,supplied_payload_hash character(64))
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  payment_record booking_payments%ROWTYPE;
  command_record payment_commands%ROWTYPE;
  prior_status text;
  next_status text;
BEGIN
  IF selected_provider <> 'stripe' OR char_length(COALESCE(supplied_event_id,'')) NOT BETWEEN 3 AND 255 OR char_length(COALESCE(supplied_object_id,'')) NOT BETWEEN 3 AND 255 OR supplied_payload_hash !~ '^[0-9a-f]{64}$' OR supplied_occurred_at > now()+interval '5 minutes' THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-payment-event'; END IF;
  INSERT INTO tideway_private.payment_provider_events(provider,provider_event_id,event_kind,provider_object_id,payment_id,command_id,amount_pence,currency,occurred_at,payload_hash)
    VALUES(selected_provider,supplied_event_id,supplied_kind,supplied_object_id,target_payment_id,target_command_id,supplied_amount_pence,supplied_currency,supplied_occurred_at,supplied_payload_hash)
    ON CONFLICT(provider,provider_event_id) DO NOTHING;
  IF NOT FOUND THEN RETURN jsonb_build_object('accepted',true,'duplicate',true); END IF;
  SELECT * INTO payment_record FROM booking_payments WHERE id=target_payment_id AND provider=selected_provider FOR UPDATE;
  IF NOT FOUND THEN UPDATE tideway_private.payment_provider_events SET result_code='payment-mismatch' WHERE provider=selected_provider AND provider_event_id=supplied_event_id; RETURN jsonb_build_object('accepted',false,'duplicate',false); END IF;
  IF payment_record.last_provider_event_at IS NOT NULL AND supplied_occurred_at < payment_record.last_provider_event_at THEN UPDATE tideway_private.payment_provider_events SET result_code='stale-event' WHERE provider=selected_provider AND provider_event_id=supplied_event_id; RETURN jsonb_build_object('accepted',true,'duplicate',false,'stale',true); END IF;
  IF target_command_id IS NOT NULL THEN SELECT * INTO command_record FROM payment_commands WHERE id=target_command_id AND payment_id=payment_record.id FOR UPDATE; END IF;
  IF supplied_kind IN ('capture-succeeded','capture-failed','cancellation-succeeded','cancellation-failed','refund-succeeded','refund-failed','transfer-succeeded','transfer-failed','transfer-reversed') AND command_record.id IS NULL THEN UPDATE tideway_private.payment_provider_events SET result_code='command-mismatch' WHERE provider=selected_provider AND provider_event_id=supplied_event_id; RETURN jsonb_build_object('accepted',false,'duplicate',false); END IF;
  IF command_record.id IS NOT NULL AND command_record.provider_command_id <> supplied_object_id THEN UPDATE tideway_private.payment_provider_events SET result_code='provider-command-mismatch' WHERE provider=selected_provider AND provider_event_id=supplied_event_id; RETURN jsonb_build_object('accepted',false,'duplicate',false); END IF;
  IF command_record.id IS NULL AND payment_record.provider_payment_id <> supplied_object_id THEN UPDATE tideway_private.payment_provider_events SET result_code='provider-payment-mismatch' WHERE provider=selected_provider AND provider_event_id=supplied_event_id; RETURN jsonb_build_object('accepted',false,'duplicate',false); END IF;
  IF supplied_currency IS NOT NULL AND supplied_currency <> payment_record.currency THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='payment-event-currency-mismatch'; END IF;
  prior_status := payment_record.status;
  next_status := prior_status;
  IF supplied_kind='authorization-requires-action' THEN next_status := 'requires-customer-action';
  ELSIF supplied_kind='authorization-processing' THEN next_status := 'processing';
  ELSIF supplied_kind='authorization-succeeded' THEN IF supplied_amount_pence <> payment_record.amount_pence THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='payment-event-amount-mismatch'; END IF; next_status := 'authorized';
  ELSIF supplied_kind='authorization-failed' THEN next_status := 'authorization-failed';
  ELSIF supplied_kind='capture-succeeded' THEN IF command_record.command_kind <> 'capture' OR supplied_amount_pence <> payment_record.amount_pence THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='payment-event-amount-mismatch'; END IF; next_status := 'captured';
  ELSIF supplied_kind='cancellation-succeeded' THEN IF command_record.command_kind <> 'cancel' THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='payment-event-command-mismatch'; END IF; next_status := 'cancelled';
  ELSIF supplied_kind='refund-succeeded' THEN IF command_record.command_kind <> 'refund' OR supplied_amount_pence <> command_record.amount_pence THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='payment-event-amount-mismatch'; END IF; next_status := CASE WHEN payment_record.amount_refunded_pence+command_record.amount_pence=payment_record.amount_captured_pence THEN 'refunded' ELSE 'partially-refunded' END;
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

REVOKE ALL ON FUNCTION tideway_private.begin_booking_payment_authorization(uuid,uuid,text,bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.record_booking_payment_authorization(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.begin_booking_payment_command(uuid,uuid,text,integer,bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.record_booking_payment_command(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.reconcile_payment_provider_event(text,text,text,text,uuid,uuid,integer,character,timestamptz,character) FROM PUBLIC;
REVOKE ALL ON TABLE tideway_private.cleaner_payout_accounts, tideway_private.payment_provider_events FROM PUBLIC;

COMMIT;
