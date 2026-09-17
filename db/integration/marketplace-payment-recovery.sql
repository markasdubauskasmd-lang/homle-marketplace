-- Included by payment-ordering inside its fixture transaction.
SAVEPOINT recovery_checks;
SELECT set_config('app.user_id','10000000-0000-4000-8000-000000000004',true);
SELECT set_config('app.user_roles','administrator',true);
DELETE FROM tideway_private.payment_command_attempt_windows WHERE command_id IN (SELECT id FROM payment_commands WHERE payment_id='50000000-0000-4000-8000-000000000010');
DELETE FROM payment_commands WHERE payment_id='50000000-0000-4000-8000-000000000010';
DELETE FROM tideway_private.payment_disputes WHERE payment_id='50000000-0000-4000-8000-000000000010';
UPDATE booking_payments SET status='captured',amount_refunded_pence=0,amount_captured_pence=amount_pence WHERE id='50000000-0000-4000-8000-000000000010';

CREATE FUNCTION pg_temp.recovery_identity(target uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('commandId',c.id,'paymentId',p.id,'bookingId',p.booking_id,'kind',c.command_kind,
   'providerPaymentId',p.provider_payment_id,'amountPence',c.amount_pence,'currency',p.currency,
   'idempotencyKey','tideway_payment_command_'||c.id::text)
 FROM payment_commands c JOIN booking_payments p ON p.id=c.payment_id WHERE c.id=target;
$$;
CREATE FUNCTION pg_temp.recovery_evidence(target uuid, observed text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('source','stripe-api-discovery','amountPence',c.amount_pence,'currency',p.currency,
   'providerPaymentId',p.provider_payment_id,'observedStatus',observed,'observedReversedAmount',NULL,'sourceChargeId',NULL,'destinationAccountId',NULL)
 FROM payment_commands c JOIN booking_payments p ON p.id=c.payment_id WHERE c.id=target;
$$;
SAVEPOINT recovery_base;

DO $window_and_refund$
DECLARE p uuid:='50000000-0000-4000-8000-000000000010'; c uuid:='51000000-0000-4000-8000-000000000801';
  result jsonb; identity jsonb; before_time timestamptz; before_deadline timestamptz; payment booking_payments%ROWTYPE; blocked boolean:=false; detail jsonb;
BEGIN
  SELECT * INTO payment FROM booking_payments WHERE id=p;
  PERFORM * FROM tideway_private.begin_booking_payment_command(c,p,'refund',1000,decode(repeat('81',32),'hex'));
  result:=tideway_private.get_payment_command_attempt(c);
  IF result->>'hasAttemptWindow'<>'false' OR result->>'legacyUnknown'<>'false' OR result->'requestIdentity'<>'null'::jsonb THEN RAISE EXCEPTION 'New command was incorrectly treated as a historical attempt'; END IF;
  identity:=pg_temp.recovery_identity(c);
  result:=tideway_private.claim_payment_command_attempt(c,decode(repeat('82',32),'hex'),identity);
  IF result->>'action'<>'post' OR (result->>'remainingMs')::bigint>82800000 THEN RAISE EXCEPTION 'First claim failed or exceeded the bounded retry window'; END IF;
  SELECT first_attempt_at,retry_before INTO before_time,before_deadline FROM tideway_private.payment_command_attempt_windows WHERE command_id=c;
  result:=tideway_private.claim_payment_command_attempt(c,decode(repeat('82',32),'hex'),identity);
  IF result->>'action'<>'post' OR (SELECT first_attempt_at<>before_time OR retry_before<>before_deadline FROM tideway_private.payment_command_attempt_windows WHERE command_id=c)
    THEN RAISE EXCEPTION 'Identical retry renewed the first-attempt deadline'; END IF;
  PERFORM tideway_private.record_payment_command_recovery(c,'operator-required','provider-command-outcome-unknown',NULL,'{}');
  result:=tideway_private.claim_payment_command_attempt(c,decode(repeat('82',32),'hex'),identity);
  IF result->>'action'<>'post' THEN RAISE EXCEPTION 'Transient uncertainty blocked an immutable same-key retry inside its original window'; END IF;
  UPDATE tideway_private.payment_command_attempt_windows SET first_attempt_at=now()-interval '2 days',retry_before=now()-interval '25 hours' WHERE command_id=c;
  result:=tideway_private.claim_payment_command_attempt(c,decode(repeat('82',32),'hex'),identity);
  IF result->>'action'<>'recover' THEN RAISE EXCEPTION 'Expired command was allowed another monetary POST'; END IF;
  BEGIN PERFORM * FROM tideway_private.begin_booking_payment_command('51000000-0000-4000-8000-000000000802',p,'transfer',NULL,decode(repeat('83',32),'hex'));
  EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'payment-reconciliation-required' THEN RAISE; END IF; blocked:=true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'Expired command allowed a replacement money action'; END IF;
  detail:=tideway_private.get_administrator_booking_payment_operation(payment.booking_id);
  IF detail->>'reconciliationReviewRequired'<>'true' OR detail->>'canRefund'<>'false' OR detail->>'canTransfer'<>'false'
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(detail->'recoveryCommands') item WHERE item->>'commandId'=c::text)
    THEN RAISE EXCEPTION 'Admin detail omitted an expired command hold'; END IF;
  result:=tideway_private.list_administrator_payment_operations('actionable',100,0);
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(result->'payments') item WHERE item->>'paymentId'=p::text AND item->>'reconciliationReviewRequired'='true') THEN RAISE EXCEPTION 'Held payment vanished from actionable queue'; END IF;
  result:=tideway_private.record_payment_command_recovery(c,'operator-required','no-object-found-is-not-proof-of-no-effect',NULL,'{}');
  IF result->>'recoveryRequired'<>'true' OR (SELECT status FROM payment_commands WHERE id=c)<>'created' THEN RAISE EXCEPTION 'No-result discovery released a reservation'; END IF;
  result:=tideway_private.record_payment_command_recovery(c,'found-awaiting-signed-evidence',NULL,'re_recovery_refund',pg_temp.recovery_evidence(c,'succeeded'));
  IF result->>'recoveryRequired'<>'true' OR (SELECT amount_refunded_pence FROM booking_payments WHERE id=p)<>0 OR (SELECT status FROM payment_commands WHERE id=c)<>'provider-pending' THEN RAISE EXCEPTION 'Unsigned snapshot changed money or declared success'; END IF;
  -- Exact retained signed projection was previously rejected and acknowledged.
  INSERT INTO tideway_private.payment_provider_events(provider,provider_event_id,event_kind,provider_object_id,payment_id,command_id,amount_pence,currency,occurred_at,payload_hash,processed,result_code,reconciliation_version)
    VALUES('stripe','evt_recovery_retained_refund','refund-succeeded','re_recovery_refund',p,c,1000,'gbp',now()-interval '1 minute',repeat('8',64),true,'command-already-failed',1);
  PERFORM pg_temp.seed_retained_event_identity('evt_recovery_retained_refund');
  result:=tideway_private.record_payment_command_recovery(c,'found-awaiting-signed-evidence',NULL,'re_recovery_refund',pg_temp.recovery_evidence(c,'succeeded'));
  IF result->>'recoveryRequired'<>'false' OR (SELECT amount_refunded_pence FROM booking_payments WHERE id=p)<>1000 THEN RAISE EXCEPTION 'Retained verified refund evidence did not recover exactly once'; END IF;
  PERFORM tideway_private.record_payment_command_recovery(c,'found-awaiting-signed-evidence',NULL,'re_recovery_refund',pg_temp.recovery_evidence(c,'succeeded'));
  PERFORM * FROM tideway_private.record_booking_payment_command(c,'re_recovery_refund','failed');
  IF (SELECT amount_refunded_pence FROM booking_payments WHERE id=p)<>1000 OR (SELECT status FROM payment_commands WHERE id=c)<>'reconciled' THEN RAISE EXCEPTION 'Duplicate recovery or late API reply regressed signed refund'; END IF;
  result:=tideway_private.record_payment_command_recovery(c,'found-awaiting-signed-evidence',NULL,'re_recovery_refund',pg_temp.recovery_evidence(c,'failed'));
  IF result->>'recoveryRequired'<>'true' OR NOT tideway_private.payment_reconciliation_hold(p) OR (SELECT amount_refunded_pence FROM booking_payments WHERE id=p)<>1000 THEN RAISE EXCEPTION 'Older signed success concealed an unsigned adverse refund observation'; END IF;
  PERFORM tideway_private.record_payment_command_recovery(c,'operator-required','provider-recovery-unavailable',NULL,'{}');
  PERFORM tideway_private.record_payment_command_recovery(c,'operator-required','no-object-found-is-not-proof-of-no-effect',NULL,'{}');
  IF NOT tideway_private.payment_reconciliation_hold(p) THEN RAISE EXCEPTION 'Transient recovery failures erased an unresolved adverse refund observation'; END IF;
  result:=tideway_private.record_payment_command_recovery(c,'found-awaiting-signed-evidence',NULL,'re_recovery_refund',pg_temp.recovery_evidence(c,'succeeded'));
  IF result->>'recoveryRequired'<>'true' OR NOT tideway_private.payment_reconciliation_hold(p) THEN RAISE EXCEPTION 'A stale succeeded GET erased the earlier adverse refund observation'; END IF;
  PERFORM tideway_private.record_payment_command_recovery(c,'found-awaiting-signed-evidence',NULL,'re_recovery_refund',pg_temp.recovery_evidence(c,'failed'));
  PERFORM pg_temp.reconcile_bound_fixture_event('stripe','evt_recovery_late_refund_failure','refund-failed','re_recovery_refund',p,c,1000,'gbp',now(),repeat('9',64));
  IF (SELECT amount_refunded_pence FROM booking_payments WHERE id=p)<>0 OR (tideway_private.payment_command_recovery_state(c)->>'recoveryRequired')::boolean THEN RAISE EXCEPTION 'Late signed terminal evidence did not resolve its matching observed failure'; END IF;
  -- Future API failure replies remain reserved until a signed outcome.
  PERFORM * FROM tideway_private.begin_booking_payment_command('51000000-0000-4000-8000-000000000802',p,'refund',500,decode(repeat('83',32),'hex'));
  PERFORM * FROM tideway_private.record_booking_payment_command('51000000-0000-4000-8000-000000000802','re_recovery_api_failed','failed');
  IF (SELECT status FROM payment_commands WHERE id='51000000-0000-4000-8000-000000000802')<>'provider-pending' THEN RAISE EXCEPTION 'API failure released an uncertain monetary reservation'; END IF;
END
$window_and_refund$;
ROLLBACK TO SAVEPOINT recovery_base;

DO $identity_and_access$
DECLARE p uuid:='50000000-0000-4000-8000-000000000010'; c uuid:='51000000-0000-4000-8000-000000000811'; result jsonb; identity jsonb; blocked boolean:=false; owner uuid;
BEGIN
  PERFORM * FROM tideway_private.begin_booking_payment_command(c,p,'refund',1000,decode(repeat('84',32),'hex'));
  identity:=pg_temp.recovery_identity(c);
  PERFORM tideway_private.claim_payment_command_attempt(c,decode(repeat('85',32),'hex'),identity);
  result:=tideway_private.claim_payment_command_attempt(c,decode(repeat('86',32),'hex'),identity);
  IF result->>'action'<>'recover' OR result->>'recoveryReason'<>'payment-attempt-parameters-changed'
    OR (SELECT request_hash FROM tideway_private.payment_command_attempt_windows WHERE command_id=c)<>decode(repeat('85',32),'hex') THEN RAISE EXCEPTION 'Changed retry hash overwrote immutable attempt data'; END IF;
  UPDATE tideway_private.payment_command_attempt_windows SET legacy_unknown=true,request_hash=NULL,request_identity=NULL,retry_before=first_attempt_at WHERE command_id=c;
  result:=tideway_private.get_administrator_payment_command_recovery(c);
  IF result->>'legacyUnknown'<>'true' OR result->>'hasAttemptWindow'<>'true' THEN RAISE EXCEPTION 'Legacy attempt lost its unknown provenance'; END IF;
  result:=tideway_private.claim_payment_command_attempt(c,decode(repeat('85',32),'hex'),identity);
  IF result->>'action'='post' THEN RAISE EXCEPTION 'Legacy attempt gained a fresh idempotency window'; END IF;
  PERFORM set_config('app.user_id','10000000-0000-4000-8000-000000000099',true); PERFORM set_config('app.user_roles','landlord',true);
  BEGIN PERFORM tideway_private.get_payment_command_attempt(c); EXCEPTION WHEN SQLSTATE 'P0002' THEN blocked:=true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'Another landlord read private recovery identity'; END IF;
  blocked:=false; BEGIN PERFORM tideway_private.record_payment_command_recovery(c,'operator-required','provider-recovery-unavailable',NULL,'{}'); EXCEPTION WHEN SQLSTATE 'P0002' THEN blocked:=true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'Another landlord wrote private recovery state'; END IF;
  SELECT landlord_user_id INTO owner FROM booking_payments WHERE id=p;
  PERFORM set_config('app.user_id',owner::text,true);
  blocked:=false; BEGIN PERFORM tideway_private.get_administrator_payment_command_recovery(c); EXCEPTION WHEN SQLSTATE '42501' THEN blocked:=true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'Owner used administrator-only recovery read'; END IF;
  INSERT INTO payment_commands(id,payment_id,command_kind,amount_pence,status,idempotency_key_hash,created_by)
    SELECT '51000000-0000-4000-8000-000000000812',id,'cancel',amount_pence,'created',decode(repeat('87',32),'hex'),landlord_user_id FROM booking_payments WHERE id=p;
  result:=tideway_private.get_payment_command_attempt('51000000-0000-4000-8000-000000000812');
  IF result->>'kind'<>'cancel' THEN RAISE EXCEPTION 'Owner could not inspect own cancellation attempt'; END IF;
  result:=tideway_private.record_payment_command_recovery('51000000-0000-4000-8000-000000000812','operator-required','provider-command-outcome-unknown',NULL,'{}');
  IF result->>'recoveryRequired'<>'true' THEN RAISE EXCEPTION 'Owner cancellation uncertainty was not audited'; END IF;
  IF has_table_privilege('tideway_app','tideway_private.payment_command_attempt_windows','SELECT') OR has_table_privilege('tideway_app','tideway_private.payment_command_recovery_attempts','INSERT') THEN RAISE EXCEPTION 'Runtime received direct recovery table privileges'; END IF;
END
$identity_and_access$;
ROLLBACK TO SAVEPOINT recovery_base;

DO $durable_conflict$
DECLARE p uuid:='50000000-0000-4000-8000-000000000010'; c uuid:='51000000-0000-4000-8000-000000000821'; b uuid:='51000000-0000-4000-8000-000000000822'; result jsonb; amount integer;
BEGIN
  UPDATE booking_payments SET status='authorized',amount_captured_pence=0,amount_refunded_pence=0 WHERE id=p RETURNING amount_pence INTO amount;
  INSERT INTO payment_commands(id,payment_id,command_kind,amount_pence,status,idempotency_key_hash,created_by,provider_command_id)
    VALUES(c,p,'capture',amount,'provider-failed',decode(repeat('88',32),'hex'),'10000000-0000-4000-8000-000000000004','pi_payment_ordering'),
      (b,p,'capture',amount,'created',decode(repeat('89',32),'hex'),'10000000-0000-4000-8000-000000000004',NULL);
  INSERT INTO tideway_private.payment_provider_events(provider,provider_event_id,event_kind,provider_object_id,payment_id,command_id,amount_pence,currency,occurred_at,payload_hash,processed,result_code,reconciliation_version)
    VALUES('stripe','evt_recovery_capture_conflict','capture-succeeded','pi_payment_ordering',p,c,amount,'gbp',now()-interval '1 minute',repeat('a',64),true,'command-already-failed',1);
  result:=tideway_private.record_payment_command_recovery(c,'found-awaiting-signed-evidence',NULL,'pi_payment_ordering',pg_temp.recovery_evidence(c,'succeeded'));
  IF result->>'recoveryRequired'<>'true' OR result->>'recoveryReason'<>'signed-event-replay-conflict'
    OR (SELECT amount_captured_pence FROM booking_payments WHERE id=p)<>0 OR (SELECT status FROM payment_commands WHERE id=c)<>'provider-failed'
    OR (SELECT reconciliation_version FROM tideway_private.payment_provider_events WHERE provider_event_id='evt_recovery_capture_conflict')<>1
    OR NOT EXISTS(SELECT 1 FROM tideway_private.payment_command_recovery_attempts WHERE command_id=c AND outcome='operator-required' AND reason='signed-event-replay-conflict')
    THEN RAISE EXCEPTION 'Replay conflict lost its audit or left partial financial updates'; END IF;
  -- Fixture-only removal of the unissued competing command proves exact replay
  -- can finish once an independently verified operator repair is performed.
  DELETE FROM payment_commands WHERE id=b;
  result:=tideway_private.record_payment_command_recovery(c,'found-awaiting-signed-evidence',NULL,'pi_payment_ordering',pg_temp.recovery_evidence(c,'succeeded'));
  IF result->>'recoveryRequired'<>'false' OR (SELECT amount_captured_pence FROM booking_payments WHERE id=p)<>amount THEN RAISE EXCEPTION 'Exact capture evidence could not recover after its prerequisite repair'; END IF;
END
$durable_conflict$;
ROLLBACK TO SAVEPOINT recovery_base;

DO $cancel_recovery$
DECLARE p uuid:='50000000-0000-4000-8000-000000000010'; c uuid:='51000000-0000-4000-8000-000000000831'; result jsonb; amount integer;
BEGIN
  UPDATE booking_payments SET status='authorized',amount_captured_pence=0,amount_refunded_pence=0 WHERE id=p RETURNING amount_pence INTO amount;
  INSERT INTO payment_commands(id,payment_id,command_kind,amount_pence,status,idempotency_key_hash,created_by)
    VALUES(c,p,'cancel',amount,'created',decode(repeat('8a',32),'hex'),'10000000-0000-4000-8000-000000000004');
  INSERT INTO tideway_private.payment_provider_events(provider,provider_event_id,event_kind,provider_object_id,payment_id,command_id,amount_pence,currency,occurred_at,payload_hash,processed,result_code,reconciliation_version)
    VALUES('stripe','evt_recovery_cancel','cancellation-succeeded','pi_payment_ordering',p,c,amount,'gbp',now()-interval '1 minute',repeat('b',64),false,'command-mismatch',2);
  result:=tideway_private.record_payment_command_recovery(c,'found-awaiting-signed-evidence',NULL,'pi_payment_ordering',pg_temp.recovery_evidence(c,'canceled'));
  IF result->>'recoveryRequired'<>'false' OR (SELECT status FROM booking_payments WHERE id=p)<>'cancelled' THEN RAISE EXCEPTION 'Exact signed cancellation evidence was not recovered'; END IF;
END
$cancel_recovery$;
ROLLBACK TO SAVEPOINT recovery_base;

DO $transfer_recovery$
DECLARE p uuid:='50000000-0000-4000-8000-000000000010'; c uuid:='51000000-0000-4000-8000-000000000841'; result jsonb; identity jsonb; evidence jsonb; amount integer;
BEGIN
  PERFORM * FROM tideway_private.begin_booking_payment_command(c,p,'transfer',NULL,decode(repeat('8b',32),'hex'));
  SELECT amount_pence INTO amount FROM payment_commands WHERE id=c;
  identity:=pg_temp.recovery_identity(c)||jsonb_build_object('destinationAccountId','acct_integration_ordering','sourceChargeId','ch_recovery_transfer');
  PERFORM tideway_private.claim_payment_command_attempt(c,decode(repeat('8c',32),'hex'),identity);
  UPDATE tideway_private.payment_command_attempt_windows SET first_attempt_at=now()-interval '2 days',retry_before=now()-interval '25 hours' WHERE command_id=c;
  evidence:=pg_temp.recovery_evidence(c,NULL)||jsonb_build_object('destinationAccountId','acct_integration_ordering','sourceChargeId','ch_recovery_transfer','observedReversedAmount',0);
  INSERT INTO tideway_private.payment_provider_events(provider,provider_event_id,event_kind,provider_object_id,payment_id,command_id,amount_pence,currency,occurred_at,payload_hash,processed,result_code,reconciliation_version)
    VALUES('stripe','evt_recovery_transfer_created','transfer-succeeded','tr_recovery_transfer',p,c,amount,'gbp',now()-interval '1 minute',repeat('c',64),false,'awaiting-state',2);
  PERFORM pg_temp.seed_retained_event_identity('evt_recovery_transfer_created');
  result:=tideway_private.record_payment_command_recovery(c,'found-awaiting-signed-evidence',NULL,'tr_recovery_transfer',evidence);
  IF result->>'recoveryRequired'<>'false' OR (SELECT status FROM payment_commands WHERE id=c)<>'reconciled' THEN RAISE EXCEPTION 'Exact retained transfer evidence did not recover'; END IF;
  result:=tideway_private.record_payment_command_recovery(c,'found-awaiting-signed-evidence',NULL,'tr_recovery_transfer',evidence||jsonb_build_object('observedReversedAmount',1));
  IF result->>'recoveryRequired'<>'true' OR result->>'recoveryReason'<>'partial-transfer-reversal-requires-accounting' THEN RAISE EXCEPTION 'Partial reversal was silently treated as a full return'; END IF;
  PERFORM tideway_private.record_payment_command_recovery(c,'operator-required','provider-recovery-unavailable',NULL,'{}');
  IF NOT tideway_private.payment_reconciliation_hold(p) THEN RAISE EXCEPTION 'A failed GET cleared an unresolved partial reversal'; END IF;
  result:=tideway_private.record_payment_command_recovery(c,'found-awaiting-signed-evidence',NULL,'tr_recovery_transfer',evidence);
  IF result->>'recoveryRequired'<>'true' OR NOT tideway_private.payment_reconciliation_hold(p) THEN RAISE EXCEPTION 'A stale unreversed GET erased the earlier partial reversal'; END IF;
  evidence:=evidence||jsonb_build_object('observedReversedAmount',amount);
  result:=tideway_private.record_payment_command_recovery(c,'found-awaiting-signed-evidence',NULL,'tr_recovery_transfer',evidence);
  IF result->>'recoveryRequired'<>'true' OR (SELECT provider_terminal_failure FROM payment_commands WHERE id=c) THEN RAISE EXCEPTION 'Unsigned full reversal overrode signed transfer accounting'; END IF;
  INSERT INTO tideway_private.payment_provider_events(provider,provider_event_id,event_kind,provider_object_id,payment_id,command_id,amount_pence,currency,occurred_at,payload_hash,processed,result_code,reconciliation_version)
    VALUES('stripe','evt_recovery_transfer_reversed','transfer-reversed','tr_recovery_transfer',p,c,amount,'gbp',now(),repeat('d',64),false,'awaiting-state',2);
  PERFORM pg_temp.seed_retained_event_identity('evt_recovery_transfer_reversed');
  result:=tideway_private.record_payment_command_recovery(c,'found-awaiting-signed-evidence',NULL,'tr_recovery_transfer',evidence);
  IF result->>'recoveryRequired'<>'false' OR (SELECT status FROM payment_commands WHERE id=c)<>'provider-failed' OR tideway_private.payment_reconciliation_hold(p) THEN RAISE EXCEPTION 'Retained signed full reversal did not resolve its exact transfer'; END IF;
END
$transfer_recovery$;
ROLLBACK TO SAVEPOINT recovery_base;
ROLLBACK TO SAVEPOINT recovery_checks;
