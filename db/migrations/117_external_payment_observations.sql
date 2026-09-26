BEGIN;

-- Distinguish an action canceled locally before any dispatch allowance from a
-- provider outcome. No signed-success or terminal-failure flag is invented.
ALTER TABLE payment_commands ADD COLUMN superseded_before_dispatch boolean NOT NULL DEFAULT false;

ALTER TABLE tideway_private.payment_provider_events DROP CONSTRAINT payment_provider_events_event_kind_check;
ALTER TABLE tideway_private.payment_provider_events ADD CONSTRAINT payment_provider_events_event_kind_check CHECK(event_kind IN
 ('authorization-requires-action','authorization-processing','authorization-succeeded','authorization-failed','capture-succeeded','capture-failed','cancellation-succeeded','cancellation-failed','refund-succeeded','refund-failed','refund-pending','intent-cancelled-observed','transfer-succeeded','transfer-failed','transfer-reversed','dispute-opened','dispute-closed'));

-- Signed provider facts are not instructions to move money. No synthetic user
-- command or renewed dispatch allowance is created by this ledger.
CREATE TABLE tideway_private.payment_observed_objects (
 provider text NOT NULL CHECK(provider='stripe'),
 -- This adapter and ledger are test-only. Live-mode support requires a separate migration and verified configuration.
 provider_mode text NOT NULL DEFAULT 'test' CHECK(provider_mode='test'),
 provider_object_id text NOT NULL CHECK(provider_object_id ~ '^(re|pi)_[A-Za-z0-9_]{3,250}$'),
 payment_id uuid NOT NULL REFERENCES booking_payments(id),
 provider_payment_id text NOT NULL CHECK(provider_payment_id ~ '^pi_[A-Za-z0-9_]{3,250}$'),
 source_charge_id text CHECK(source_charge_id IS NULL OR source_charge_id ~ '^ch_[A-Za-z0-9_]{3,250}$'),
 kind text NOT NULL CHECK(kind IN ('refund','cancellation')),
 amount_pence integer NOT NULL CHECK(amount_pence BETWEEN 1 AND 10000000),
 currency character(3) NOT NULL CHECK(currency='gbp'),
 observed_status text NOT NULL CHECK(observed_status IN ('pending','succeeded','failed','cancelled')),
 applied_pence integer NOT NULL DEFAULT 0 CHECK(applied_pence>=0 AND applied_pence<=amount_pence),
 terminal_failure boolean NOT NULL DEFAULT false,
 command_id uuid REFERENCES payment_commands(id),
 conflicting_command_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
 reason text,
 last_event_id text NOT NULL,
 last_event_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(provider,provider_mode,provider_object_id)
);
REVOKE ALL ON TABLE tideway_private.payment_observed_objects FROM PUBLIC,tideway_app,tideway_worker;
CREATE INDEX payment_observed_payment_idx ON tideway_private.payment_observed_objects(payment_id);
CREATE TABLE tideway_private.payment_observation_event_parents (
 provider text NOT NULL,provider_event_id text NOT NULL,provider_payment_id text NOT NULL,
 source_charge_id text, PRIMARY KEY(provider,provider_event_id),
 FOREIGN KEY(provider,provider_event_id) REFERENCES tideway_private.payment_provider_events(provider,provider_event_id));
REVOKE ALL ON TABLE tideway_private.payment_observation_event_parents FROM PUBLIC,tideway_app,tideway_worker;

-- Seed only historical app outcomes whose original signed event and parent proof
-- agree with the command and payment. Unprovable history stays held below.
INSERT INTO tideway_private.payment_observed_objects(provider,provider_object_id,payment_id,provider_payment_id,source_charge_id,kind,amount_pence,currency,observed_status,applied_pence,terminal_failure,command_id,last_event_id,last_event_at)
SELECT p.provider,c.provider_command_id,p.id,p.provider_payment_id,e.source_charge_id,'refund',c.amount_pence,p.currency,
 CASE WHEN c.provider_terminal_failure THEN 'failed' ELSE 'succeeded' END,
 CASE WHEN c.provider_success_applied THEN c.amount_pence ELSE 0 END,c.provider_terminal_failure,c.id,e.provider_event_id,e.occurred_at
FROM payment_commands c JOIN booking_payments p ON p.id=c.payment_id
JOIN LATERAL (SELECT event.provider_event_id,event.occurred_at,parent.source_charge_id
 FROM tideway_private.payment_provider_events event
 JOIN tideway_private.payment_event_parent_identities parent ON parent.provider=event.provider AND parent.provider_event_id=event.provider_event_id
 WHERE event.provider=p.provider AND event.payment_id=p.id AND event.command_id=c.id AND event.provider_object_id=c.provider_command_id
 AND event.amount_pence=c.amount_pence AND event.currency=p.currency AND event.processed
 AND event.result_code IN ('processed','command-already-reconciled','terminal-provider-fact') AND event.event_kind IN ('refund-succeeded','refund-failed')
 AND parent.provider_payment_id=p.provider_payment_id AND parent.source_charge_id IS NOT NULL
 ORDER BY event.occurred_at DESC,event.provider_event_id DESC LIMIT 1) e ON true
WHERE c.command_kind='refund' AND (c.provider_success_applied OR c.provider_terminal_failure)
 AND c.provider_command_id ~ '^re_[A-Za-z0-9_]{3,250}$';

CREATE FUNCTION tideway_private.payment_observation_hold(target_payment_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM tideway_private.payment_observed_objects o WHERE o.payment_id=target_payment_id
   AND (o.reason IS NOT NULL OR o.observed_status='pending'
     OR o.kind='refund' AND o.applied_pence>0 AND EXISTS(SELECT 1 FROM payment_commands c
       WHERE c.payment_id=o.payment_id AND c.command_kind='transfer' AND NOT c.provider_terminal_failure AND c.status<>'provider-failed')
     OR EXISTS(SELECT 1 FROM payment_commands c WHERE c.payment_id=o.payment_id AND c.id=ANY(o.conflicting_command_ids)
       AND c.status IN ('created','provider-pending') AND NOT c.provider_success_applied AND NOT c.provider_terminal_failure)))
   OR EXISTS(SELECT 1 FROM payment_commands historical WHERE historical.payment_id=target_payment_id
     AND historical.command_kind='refund' AND (historical.provider_success_applied OR historical.provider_terminal_failure)
     AND NOT EXISTS(SELECT 1 FROM tideway_private.payment_observed_objects anchor WHERE anchor.payment_id=historical.payment_id AND anchor.command_id=historical.id))
   OR EXISTS(SELECT 1 FROM tideway_private.payment_provider_events e WHERE e.payment_id=target_payment_id
     AND NOT e.processed AND e.event_kind IN ('refund-succeeded','refund-failed','refund-pending','intent-cancelled-observed'));
$$;
REVOKE ALL ON FUNCTION tideway_private.payment_observation_hold(uuid) FROM PUBLIC,tideway_app,tideway_worker;

CREATE FUNCTION tideway_private.reconcile_payment_observation(selected_provider text,supplied_event_id text,supplied_kind text,supplied_object_id text,target_payment_id uuid,target_command_id uuid,supplied_amount_pence integer,supplied_currency character(3),supplied_occurred_at timestamptz,supplied_payload_hash character(64),supplied_provider_payment_id text,supplied_source_charge_id text,supplied_destination_account_id text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p booking_payments%ROWTYPE; c payment_commands%ROWTYPE; e tideway_private.payment_provider_events%ROWTYPE;
 o tideway_private.payment_observed_objects%ROWTYPE; b tideway_private.payment_event_parent_identities%ROWTYPE;
 is_refund boolean:=COALESCE(supplied_kind LIKE 'refund-%',false); repeated boolean; object_repeated boolean; rejection text;
 desired integer; delta integer; next_status text; observation_status text; bound_payment uuid;
BEGIN
 IF selected_provider IS DISTINCT FROM 'stripe' OR supplied_kind IS NULL OR supplied_kind NOT IN ('refund-pending','refund-succeeded','refund-failed','intent-cancelled-observed')
   OR COALESCE(supplied_event_id,'') !~ '^evt_[A-Za-z0-9_]{3,250}$' OR COALESCE(supplied_payload_hash,'') !~ '^[0-9a-f]{64}$'
   OR supplied_amount_pence IS NULL OR supplied_amount_pence NOT BETWEEN 1 AND 10000000 OR supplied_currency IS DISTINCT FROM 'gbp'
   OR supplied_occurred_at IS NULL OR supplied_occurred_at>now()+interval '5 minutes'
   OR is_refund AND COALESCE(supplied_object_id,'') !~ '^re_[A-Za-z0-9_]{3,250}$'
   OR NOT is_refund AND COALESCE(supplied_object_id,'') !~ '^pi_[A-Za-z0-9_]{3,250}$'
   THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-payment-observation'; END IF;
 -- Old113 replay calls omit parents. Only the retained exact signed envelope
 -- may reuse114's parent proof; a new event never obtains it from a GET.
 IF supplied_provider_payment_id IS NULL AND supplied_source_charge_id IS NULL AND supplied_destination_account_id IS NULL THEN
   SELECT * INTO e FROM tideway_private.payment_provider_events WHERE provider=selected_provider AND provider_event_id=supplied_event_id;
   IF e.payload_hash IS NOT DISTINCT FROM supplied_payload_hash THEN
     SELECT provider_payment_id,source_charge_id INTO supplied_provider_payment_id,supplied_source_charge_id
       FROM tideway_private.payment_observation_event_parents WHERE provider=selected_provider AND provider_event_id=supplied_event_id;
     IF NOT FOUND THEN
     SELECT * INTO b FROM tideway_private.payment_event_parent_identities WHERE provider=selected_provider AND provider_event_id=supplied_event_id;
     supplied_provider_payment_id:=b.provider_payment_id; supplied_source_charge_id:=b.source_charge_id;
     END IF;
   END IF;
 END IF;
 IF target_payment_id IS NOT NULL THEN
   SELECT * INTO p FROM booking_payments WHERE id=target_payment_id AND provider=selected_provider FOR UPDATE;
 ELSE
   SELECT * INTO p FROM booking_payments WHERE provider=selected_provider AND provider_payment_id=supplied_provider_payment_id FOR UPDATE;
 END IF;
 bound_payment:=COALESCE(p.id,target_payment_id);
 -- A metadata-less object with no owned intent is unrelated to Homlle.
 IF bound_payment IS NULL AND supplied_provider_payment_id IS NOT NULL THEN RETURN jsonb_build_object('accepted',true,'ignored',true,'duplicate',false); END IF;
 INSERT INTO tideway_private.payment_provider_events(provider,provider_event_id,event_kind,provider_object_id,payment_id,command_id,amount_pence,currency,occurred_at,payload_hash,reconciliation_version)
 VALUES(selected_provider,supplied_event_id,supplied_kind,supplied_object_id,bound_payment,target_command_id,supplied_amount_pence,supplied_currency,supplied_occurred_at,supplied_payload_hash,3)
 ON CONFLICT(provider,provider_event_id) DO NOTHING;
 repeated:=NOT FOUND;
 SELECT * INTO e FROM tideway_private.payment_provider_events WHERE provider=selected_provider AND provider_event_id=supplied_event_id FOR UPDATE;
 -- A redelivered, newly verified cancellation may repair the old adapter's
 -- authorization-failed/cancellation-succeeded projection. No GET can upgrade it.
 IF NOT is_refund AND e.reconciliation_version<3 AND e.event_kind IN ('authorization-failed','cancellation-succeeded')
   AND supplied_provider_payment_id=supplied_object_id AND supplied_source_charge_id IS NULL AND supplied_destination_account_id IS NULL
   AND ROW(e.provider_object_id,e.payment_id,e.amount_pence,e.currency,e.occurred_at)
     IS NOT DISTINCT FROM ROW(supplied_object_id,bound_payment,supplied_amount_pence,supplied_currency,supplied_occurred_at) THEN
   UPDATE tideway_private.payment_provider_events SET event_kind=supplied_kind,command_id=NULL,processed=false,reconciliation_version=3
    WHERE provider=selected_provider AND provider_event_id=supplied_event_id RETURNING * INTO e;
 END IF;
 IF ROW(e.event_kind,e.provider_object_id,e.payment_id,e.command_id,e.amount_pence,e.currency,e.occurred_at)
   IS DISTINCT FROM ROW(supplied_kind,supplied_object_id,bound_payment,target_command_id,supplied_amount_pence,supplied_currency,supplied_occurred_at)
   THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='payment-event-identity-conflict'; END IF;
 IF COALESCE(supplied_provider_payment_id,'') !~ '^pi_[A-Za-z0-9_]{3,250}$' OR supplied_destination_account_id IS NOT NULL
   OR is_refund AND COALESCE(supplied_source_charge_id,'') !~ '^ch_[A-Za-z0-9_]{3,250}$'
   OR NOT is_refund AND (supplied_source_charge_id IS NOT NULL OR supplied_provider_payment_id<>supplied_object_id)
   THEN rejection:='awaiting-event-parent-identity';
 ELSIF p.id IS NULL THEN rejection:='awaiting-payment';
 ELSIF p.provider_payment_id IS NULL AND is_refund THEN rejection:='awaiting-payment-identity';
 ELSIF p.provider_payment_id<>supplied_provider_payment_id THEN rejection:='payment-event-parent-mismatch';
 END IF;
 IF is_refund AND COALESCE(supplied_provider_payment_id,'') ~ '^pi_[A-Za-z0-9_]{3,250}$'
   AND COALESCE(supplied_source_charge_id,'') ~ '^ch_[A-Za-z0-9_]{3,250}$' AND supplied_destination_account_id IS NULL THEN
   SELECT * INTO b FROM tideway_private.payment_event_parent_identities WHERE provider=selected_provider AND provider_event_id=supplied_event_id;
   IF b.provider_event_id IS NOT NULL AND ROW(b.provider_payment_id,b.source_charge_id,b.destination_account_id)
     IS DISTINCT FROM ROW(supplied_provider_payment_id,supplied_source_charge_id,NULL::text) THEN
     RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='payment-event-parent-identity-conflict'; END IF;
   INSERT INTO tideway_private.payment_event_parent_identities(provider,provider_event_id,provider_payment_id,source_charge_id)
     VALUES(selected_provider,supplied_event_id,supplied_provider_payment_id,supplied_source_charge_id) ON CONFLICT DO NOTHING;
 END IF;
 IF COALESCE(supplied_provider_payment_id,'') ~ '^pi_[A-Za-z0-9_]{3,250}$'
   AND ((is_refund AND COALESCE(supplied_source_charge_id,'') ~ '^ch_[A-Za-z0-9_]{3,250}$')
     OR (NOT is_refund AND supplied_source_charge_id IS NULL AND supplied_object_id=supplied_provider_payment_id))
   AND supplied_destination_account_id IS NULL THEN
   IF EXISTS(SELECT 1 FROM tideway_private.payment_observation_event_parents x WHERE x.provider=selected_provider AND x.provider_event_id=supplied_event_id
     AND ROW(x.provider_payment_id,x.source_charge_id) IS DISTINCT FROM ROW(supplied_provider_payment_id,supplied_source_charge_id))
     THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='payment-event-parent-identity-conflict'; END IF;
   INSERT INTO tideway_private.payment_observation_event_parents(provider,provider_event_id,provider_payment_id,source_charge_id)
     VALUES(selected_provider,supplied_event_id,supplied_provider_payment_id,supplied_source_charge_id) ON CONFLICT DO NOTHING;
 END IF;
 IF rejection IS NOT NULL THEN
   UPDATE tideway_private.payment_provider_events SET processed=false,result_code=rejection,reconciliation_version=3 WHERE provider=selected_provider AND provider_event_id=supplied_event_id;
   RETURN jsonb_build_object('accepted',false,'retryable',true,'duplicate',repeated,'reason',rejection);
 END IF;
 IF is_refund THEN
   IF target_command_id IS NOT NULL THEN
     SELECT * INTO c FROM payment_commands WHERE id=target_command_id AND payment_id=p.id FOR UPDATE;
     IF c.id IS NULL OR c.command_kind<>'refund' OR c.amount_pence<>supplied_amount_pence
       OR c.provider_command_id IS NOT NULL AND c.provider_command_id<>supplied_object_id THEN rejection:='observation-command-conflict'; END IF;
   ELSE
     SELECT * INTO c FROM payment_commands WHERE payment_id=p.id AND command_kind='refund' AND provider_command_id=supplied_object_id FOR UPDATE;
   END IF;
 ELSE
   IF supplied_amount_pence<>p.amount_pence THEN rejection:='payment-event-amount-mismatch'; END IF;
   -- Only an already bound cancel command is acknowledged, never capture metadata.
   SELECT * INTO c FROM payment_commands WHERE payment_id=p.id AND command_kind='cancel' AND provider_command_id=supplied_object_id FOR UPDATE;
 END IF;
 IF rejection IS NOT NULL THEN
   UPDATE tideway_private.payment_provider_events SET processed=false,result_code=rejection,reconciliation_version=3 WHERE provider=selected_provider AND provider_event_id=supplied_event_id;
   RETURN jsonb_build_object('accepted',false,'retryable',true,'duplicate',repeated,'reason',rejection);
 END IF;
 IF is_refund AND c.id IS NOT NULL AND (c.provider_success_applied OR c.provider_terminal_failure)
   AND NOT EXISTS(SELECT 1 FROM tideway_private.payment_provider_events prior
     JOIN tideway_private.payment_event_parent_identities parent ON parent.provider=prior.provider AND parent.provider_event_id=prior.provider_event_id
     WHERE prior.provider=selected_provider AND prior.provider_object_id=supplied_object_id AND prior.payment_id=p.id AND prior.command_id=c.id
       AND prior.processed AND prior.result_code IN ('processed','command-already-reconciled','terminal-provider-fact')
       AND prior.event_kind IN ('refund-succeeded','refund-failed') AND parent.provider_payment_id=supplied_provider_payment_id AND parent.source_charge_id=supplied_source_charge_id)
   AND NOT EXISTS(SELECT 1 FROM tideway_private.payment_observed_objects existing WHERE existing.provider=selected_provider AND existing.provider_object_id=supplied_object_id)
   THEN
   UPDATE tideway_private.payment_provider_events SET processed=false,result_code='historical-refund-anchor-unverified',reconciliation_version=3 WHERE provider=selected_provider AND provider_event_id=supplied_event_id;
   RETURN jsonb_build_object('accepted',false,'retryable',true,'duplicate',repeated,'reason','historical-refund-anchor-unverified');
 END IF;
 observation_status:=CASE supplied_kind WHEN 'refund-pending' THEN 'pending' WHEN 'refund-succeeded' THEN 'succeeded' WHEN 'refund-failed' THEN 'failed' ELSE 'cancelled' END;
 -- Existing app flags anchor historical refunds already applied on114. Lazy
 -- anchoring also handles metadata-less redelivery of an existing app refund.
 INSERT INTO tideway_private.payment_observed_objects(provider,provider_object_id,payment_id,provider_payment_id,source_charge_id,kind,amount_pence,currency,observed_status,applied_pence,terminal_failure,command_id,last_event_id,last_event_at,conflicting_command_ids)
 VALUES(selected_provider,supplied_object_id,p.id,supplied_provider_payment_id,supplied_source_charge_id,CASE WHEN is_refund THEN 'refund' ELSE 'cancellation' END,
   supplied_amount_pence,supplied_currency,observation_status,CASE WHEN is_refund AND c.provider_success_applied THEN c.amount_pence ELSE 0 END,
   COALESCE(c.provider_terminal_failure,false),c.id,supplied_event_id,supplied_occurred_at,
   ARRAY(SELECT pending.id FROM payment_commands pending WHERE pending.payment_id=p.id
     AND pending.id IS DISTINCT FROM c.id AND pending.status IN ('created','provider-pending')
     AND EXISTS(SELECT 1 FROM tideway_private.payment_command_attempt_windows attempt WHERE attempt.command_id=pending.id)
     AND NOT pending.provider_success_applied AND NOT pending.provider_terminal_failure)) ON CONFLICT DO NOTHING;
 object_repeated:=NOT FOUND;
 SELECT * INTO o FROM tideway_private.payment_observed_objects WHERE provider=selected_provider AND provider_object_id=supplied_object_id FOR UPDATE;
 IF ROW(o.payment_id,o.provider_payment_id,o.source_charge_id,o.amount_pence,o.currency)
   IS DISTINCT FROM ROW(p.id,supplied_provider_payment_id,supplied_source_charge_id,supplied_amount_pence,supplied_currency)
   OR o.command_id IS NOT NULL AND c.id IS NOT NULL AND o.command_id<>c.id
   THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='payment-observation-identity-conflict'; END IF;
 IF c.id IS NULL AND o.command_id IS NOT NULL THEN SELECT * INTO c FROM payment_commands WHERE id=o.command_id FOR UPDATE; END IF;
 desired:=o.applied_pence;
 IF is_refund THEN
   IF supplied_kind='refund-failed' THEN desired:=0;
   ELSIF supplied_kind='refund-succeeded' AND NOT o.terminal_failure THEN desired:=o.amount_pence; END IF;
   delta:=desired-o.applied_pence;
   IF p.amount_refunded_pence+delta<0 OR p.amount_refunded_pence+delta>p.amount_captured_pence THEN rejection:='awaiting-captured-refund-balance'; END IF;
 ELSE
   delta:=0;
   IF p.amount_captured_pence>0 THEN rejection:='cancelled-intent-captured-conflict'; END IF;
 END IF;
 IF rejection IS NOT NULL THEN
   UPDATE tideway_private.payment_observed_objects SET reason=rejection,updated_at=now() WHERE provider=selected_provider AND provider_object_id=supplied_object_id;
   UPDATE tideway_private.payment_provider_events SET processed=false,result_code=rejection,reconciliation_version=3 WHERE provider=selected_provider AND provider_event_id=supplied_event_id;
   RETURN jsonb_build_object('accepted',false,'retryable',true,'duplicate',repeated,'reason',rejection);
 END IF;
 next_status:=p.status;
 IF NOT is_refund THEN next_status:='cancelled';
 ELSIF delta<>0 THEN next_status:=CASE WHEN p.amount_refunded_pence+delta=p.amount_captured_pence THEN 'refunded' WHEN p.amount_refunded_pence+delta>0 THEN 'partially-refunded' ELSE 'captured' END; END IF;
 IF tideway_private.payment_dispute_hold(p.id) THEN next_status:='disputed'; END IF;
 UPDATE booking_payments SET status=next_status,amount_refunded_pence=amount_refunded_pence+delta,
   provider_payment_id=CASE WHEN NOT is_refund THEN COALESCE(provider_payment_id,supplied_provider_payment_id) ELSE provider_payment_id END,
   cancelled_at=CASE WHEN NOT is_refund THEN COALESCE(cancelled_at,supplied_occurred_at) ELSE cancelled_at END,
   last_provider_event_at=GREATEST(last_provider_event_at,supplied_occurred_at),updated_at=now() WHERE id=p.id;
 UPDATE tideway_private.payment_observed_objects SET applied_pence=desired,command_id=COALESCE(command_id,c.id),reason=NULL,
   terminal_failure=terminal_failure OR supplied_kind='refund-failed',
   observed_status=CASE WHEN terminal_failure OR supplied_kind='refund-failed' THEN 'failed'
     WHEN applied_pence>0 OR supplied_kind='refund-succeeded' THEN 'succeeded' WHEN observed_status='cancelled' THEN 'cancelled' ELSE observation_status END,
   last_event_id=CASE WHEN supplied_occurred_at>=last_event_at THEN supplied_event_id ELSE last_event_id END,
   last_event_at=GREATEST(last_event_at,supplied_occurred_at),updated_at=now()
   WHERE provider=selected_provider AND provider_object_id=supplied_object_id;
 -- Only absence of a persisted dispatch allowance proves a command was unsent.
 -- An attempted/legacy-unknown request keeps its reservation and recovery hold.
 UPDATE payment_commands pending SET status='provider-failed',superseded_before_dispatch=true,updated_at=now()
 WHERE pending.payment_id=p.id AND pending.id IS DISTINCT FROM c.id AND pending.status='created'
   AND pending.provider_command_id IS NULL AND NOT pending.provider_success_applied AND NOT pending.provider_terminal_failure
   AND NOT EXISTS(SELECT 1 FROM tideway_private.payment_command_attempt_windows attempt WHERE attempt.command_id=pending.id)
   AND ((pending.command_kind IN ('capture','cancel') AND next_status='cancelled')
     OR (pending.command_kind='refund' AND pending.amount_pence>p.amount_captured_pence-(p.amount_refunded_pence+delta))
     OR (pending.command_kind='transfer' AND p.amount_refunded_pence+delta>0));
 IF c.id IS NOT NULL AND supplied_kind<>'refund-pending' THEN
   UPDATE payment_commands SET provider_command_id=COALESCE(provider_command_id,supplied_object_id),
     status=CASE WHEN o.terminal_failure OR supplied_kind='refund-failed' THEN 'provider-failed' ELSE 'reconciled' END,
     provider_success_applied=NOT (o.terminal_failure OR supplied_kind='refund-failed'),
     provider_terminal_failure=o.terminal_failure OR supplied_kind='refund-failed',
     reconciled_at=COALESCE(reconciled_at,supplied_occurred_at),updated_at=now() WHERE id=c.id;
 END IF;
 IF next_status<>p.status THEN INSERT INTO payment_status_history(payment_id,from_status,to_status,event_source,reason,metadata)
   VALUES(p.id,p.status,next_status,'provider','Signed provider observation reconciled.',jsonb_build_object('eventId',supplied_event_id,'objectId',supplied_object_id)); END IF;
 UPDATE tideway_private.payment_provider_events SET processed=true,result_code='processed',reconciliation_version=3 WHERE provider=selected_provider AND provider_event_id=supplied_event_id;
 RETURN jsonb_build_object('accepted',true,'duplicate',repeated OR (object_repeated AND delta=0));
END;
$$;
REVOKE ALL ON FUNCTION tideway_private.reconcile_payment_observation(text,text,text,text,uuid,uuid,integer,character,timestamptz,character,text,text,text) FROM PUBLIC,tideway_app,tideway_worker;

-- The guarded public reconciliation overloads, command holds and administrator
-- projections below are replaced without changing their existing OIDs.

CREATE OR REPLACE FUNCTION tideway_private.reconcile_payment_provider_event(selected_provider text,supplied_event_id text,supplied_kind text,supplied_object_id text,target_payment_id uuid,target_command_id uuid,supplied_amount_pence integer,supplied_currency character(3),supplied_occurred_at timestamptz,supplied_payload_hash character(64),supplied_provider_payment_id text,supplied_source_charge_id text,supplied_destination_account_id text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p booking_payments%ROWTYPE; c payment_commands%ROWTYPE;
  e tideway_private.payment_provider_events%ROWTYPE; binding tideway_private.payment_event_parent_identities%ROWTYPE;
  w tideway_private.payment_command_attempt_windows%ROWTYPE; repeated boolean; rejection text;
BEGIN
  IF supplied_kind IN ('refund-pending','refund-succeeded','refund-failed','intent-cancelled-observed') THEN
    RETURN tideway_private.reconcile_payment_observation(selected_provider,supplied_event_id,supplied_kind,supplied_object_id,target_payment_id,target_command_id,supplied_amount_pence,supplied_currency,supplied_occurred_at,supplied_payload_hash,supplied_provider_payment_id,supplied_source_charge_id,supplied_destination_account_id);
  END IF;
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
CREATE OR REPLACE FUNCTION tideway_private.payment_reconciliation_hold(target_payment_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT tideway_private.payment_observation_hold(target_payment_id) OR EXISTS(SELECT 1 FROM payment_commands c WHERE c.payment_id=target_payment_id
   AND (tideway_private.payment_command_recovery_state(c.id)->>'reviewRequired')::boolean);
$$;
CREATE OR REPLACE FUNCTION tideway_private.payment_other_reconciliation_hold(target_payment_id uuid,selected_command_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT tideway_private.payment_observation_hold(target_payment_id) OR EXISTS(SELECT 1 FROM payment_commands c WHERE c.payment_id=target_payment_id AND c.id<>selected_command_id
   AND (tideway_private.payment_command_recovery_state(c.id)->>'reviewRequired')::boolean);
$$;
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
  IF command_record.provider_command_id IS NULL AND tideway_private.payment_observation_hold(payment_record.id)
    THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='payment-reconciliation-required'; END IF;
  -- Idempotent retries must not execute a previously prepared but unsent action after a dispute.
  IF command_record.provider_command_id IS NULL AND (payment_record.status='disputed' OR tideway_private.payment_dispute_hold(payment_record.id))
    THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='payment-dispute-review-required'; END IF;
  IF selected_kind='transfer' AND destination IS NULL THEN SELECT account.destination_account_id INTO destination FROM tideway_private.cleaner_payout_accounts account WHERE account.cleaner_user_id=payment_record.cleaner_user_id AND account.provider=payment_record.provider AND account.payouts_enabled AND account.details_submitted; END IF;
  RETURN QUERY SELECT command_record.id,payment_record.id,booking_record.id,command_record.command_kind,command_record.status,command_record.amount_pence,payment_record.currency,payment_record.provider_payment_id,command_record.provider_command_id,destination;
END;
$$;
CREATE OR REPLACE FUNCTION tideway_private.claim_payment_command_attempt(target_command_id uuid,supplied_request_hash bytea,supplied_identity jsonb)
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
  IF c.superseded_before_dispatch THEN
    RETURN jsonb_build_object('action','not-sent','status',c.status,'recoveryReason','superseded-before-dispatch'); END IF;
  SELECT * INTO w FROM tideway_private.payment_command_attempt_windows WHERE command_id=c.id FOR UPDATE;
  recovery_state:=tideway_private.payment_command_recovery_state(c.id);
  IF c.provider_command_id IS NOT NULL OR c.provider_success_applied OR c.provider_terminal_failure THEN
    RETURN jsonb_build_object('action','observe','status',c.status,'providerCommandId',c.provider_command_id,
      'legacyUnknown',COALESCE(w.legacy_unknown,true),'requestIdentity',w.request_identity); END IF;
  IF tideway_private.payment_observation_hold(p.id) OR
    (c.command_kind='capture' AND p.status<>'authorized') OR
    (c.command_kind='refund' AND (p.status NOT IN ('captured','partially-refunded') OR c.amount_pence>p.amount_captured_pence-p.amount_refunded_pence)) OR
    (c.command_kind='transfer' AND (p.status<>'captured' OR p.amount_refunded_pence>0)) OR
    (c.command_kind='cancel' AND p.status NOT IN ('creating','requires-customer-action','processing','authorized','authorization-failed')) THEN
    RETURN jsonb_build_object('action','recover','legacyUnknown',COALESCE(w.legacy_unknown,false),'requestIdentity',w.request_identity,'recoveryReason','payment-observation-conflict'); END IF;
  IF supplied_identity->>'commandId'  IS DISTINCT FROM c.id::text OR supplied_identity->>'paymentId' IS DISTINCT FROM p.id::text
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
CREATE FUNCTION tideway_private.payment_observation_projection(target_payment_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT COALESCE(jsonb_agg(item.value ORDER BY item.at DESC),'[]'::jsonb) FROM (
  SELECT jsonb_build_object('providerObjectId',o.provider_object_id,'kind',o.kind,'status',o.observed_status,
   'amountPence',o.amount_pence,'appliedPence',o.applied_pence,'reason',o.reason,'lastEventId',o.last_event_id,
   'requiresReview',tideway_private.payment_observation_hold(target_payment_id)) AS value,o.last_event_at AS at
  FROM tideway_private.payment_observed_objects o WHERE o.payment_id=target_payment_id
  UNION ALL
  SELECT jsonb_build_object('providerObjectId',e.provider_object_id,'kind',CASE WHEN e.event_kind LIKE 'refund-%' THEN 'refund' ELSE 'cancellation' END,
   'status','unresolved','amountPence',e.amount_pence,'appliedPence',0,'reason',e.result_code,'lastEventId',e.provider_event_id,'requiresReview',true),e.occurred_at
  FROM tideway_private.payment_provider_events e WHERE e.payment_id=target_payment_id AND NOT e.processed
   AND e.event_kind IN ('refund-succeeded','refund-failed','refund-pending','intent-cancelled-observed')
   AND NOT EXISTS(SELECT 1 FROM tideway_private.payment_observed_objects o WHERE o.payment_id=target_payment_id AND o.provider_object_id=e.provider_object_id)
  ORDER BY at DESC LIMIT 100
 ) item;
$$;
REVOKE ALL ON FUNCTION tideway_private.payment_observation_projection(uuid) FROM PUBLIC,tideway_app,tideway_worker;

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
      tideway_private.payment_observation_projection(payment.id) AS observed_objects,
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
      'observations',selected.observed_objects,
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
      tideway_private.payment_observation_projection(payment.id) AS observed_objects,
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
      'observations',selected.observed_objects,
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
CREATE FUNCTION tideway_private.replay_payment_observations(target_payment_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e tideway_private.payment_provider_events%ROWTYPE; result jsonb; replayed integer:=0;
BEGIN
 IF tideway_private.current_user_id() IS NULL OR NOT tideway_private.has_role('administrator') THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='administrator-required'; END IF;
 PERFORM 1 FROM booking_payments WHERE id=target_payment_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='payment-not-found'; END IF;
 FOR e IN SELECT * FROM tideway_private.payment_provider_events WHERE payment_id=target_payment_id
   AND event_kind IN ('refund-pending','refund-succeeded','refund-failed','intent-cancelled-observed')
   ORDER BY processed,occurred_at,provider_event_id LIMIT 100 LOOP
   -- Only exact retained, originally signature-verified evidence is replayed.
   result:=tideway_private.reconcile_payment_provider_event(e.provider,e.provider_event_id,e.event_kind,e.provider_object_id,e.payment_id,e.command_id,e.amount_pence,e.currency,e.occurred_at,e.payload_hash);
   replayed:=replayed+1;
 END LOOP;
 RETURN jsonb_build_object('paymentId',target_payment_id,'signedEventsReplayed',replayed,
   'recoveryRequired',tideway_private.payment_observation_hold(target_payment_id));
END;
$$;
REVOKE ALL ON FUNCTION tideway_private.replay_payment_observations(uuid) FROM PUBLIC,tideway_app,tideway_worker;
GRANT EXECUTE ON FUNCTION tideway_private.replay_payment_observations(uuid) TO tideway_app;

CREATE OR REPLACE FUNCTION tideway_private.payment_command_recovery_state(target_command_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c payment_commands%ROWTYPE; w tideway_private.payment_command_attempt_windows%ROWTYPE;
  a tideway_private.payment_command_recovery_attempts%ROWTYPE; previous_observation tideway_private.payment_command_recovery_attempts%ROWTYPE;
  reason text; identity_reason text; required boolean:=false; held boolean:=false; latest_checked_at timestamptz;
BEGIN
  SELECT * INTO c FROM payment_commands WHERE id=target_command_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF c.superseded_before_dispatch THEN RETURN jsonb_build_object('commandId',c.id,'kind',c.command_kind,'status',c.status,
    'recoveryReason','superseded-before-dispatch','checkedAt',c.updated_at,'recoveryRequired',false,'reviewRequired',false); END IF;
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
  -- Older applied flags are not sufficient to construct an external-object
  -- anchor. Keep the exact command visible even when its signed event or parent
  -- proof is absent; a current GET must not remove this historical hold.
  IF c.command_kind='refund' AND (c.provider_success_applied OR c.provider_terminal_failure)
    AND NOT EXISTS(SELECT 1 FROM tideway_private.payment_observed_objects anchor
      WHERE anchor.payment_id=c.payment_id AND anchor.command_id=c.id) THEN
    required:=true; held:=true; reason:='historical-refund-anchor-unverified';
  END IF;
  RETURN jsonb_build_object('commandId',c.id,'kind',c.command_kind,'status',c.status,'recoveryReason',reason,
    'checkedAt',latest_checked_at,'recoveryRequired',required,'reviewRequired',held);
END;
$$;

CREATE OR REPLACE FUNCTION tideway_private.get_payment_command_attempt(target_command_id uuid)
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
    'firstAttemptAt',w.first_attempt_at,'retryBefore',w.retry_before,
    'supersededBeforeDispatch',c.superseded_before_dispatch AND w.command_id IS NULL
      AND c.provider_command_id IS NULL AND NOT c.provider_success_applied AND NOT c.provider_terminal_failure); 
END;
$$;

CREATE OR REPLACE FUNCTION tideway_private.record_payment_command_recovery(target_command_id uuid,supplied_outcome text,supplied_reason text,supplied_provider_object_id text,supplied_evidence jsonb)
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
  -- Recheck under the same role-bound payment lock when an earlier read raced
  -- with supersession. An unavailable GET must not invent an unknown outcome.
  IF c.superseded_before_dispatch AND w.command_id IS NULL AND c.provider_command_id IS NULL
    AND NOT c.provider_success_applied AND NOT c.provider_terminal_failure THEN
    RETURN jsonb_build_object('status',c.status,'recoveryRequired',false,'recoveryReason','superseded-before-dispatch','signedEventsReplayed',0);
  END IF;
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

COMMIT;
