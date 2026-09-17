-- Runs inside the owner fixture transaction. Direct ledger seeds below model
-- earlier retained signed events; only production entry points apply money.
SAVEPOINT event_identity_checks;
DELETE FROM tideway_private.payment_provider_events WHERE payment_id='50000000-0000-4000-8000-000000000010';
DELETE FROM tideway_private.payment_command_attempt_windows WHERE command_id IN (SELECT id FROM payment_commands WHERE payment_id='50000000-0000-4000-8000-000000000010');
DELETE FROM payment_commands WHERE payment_id='50000000-0000-4000-8000-000000000010';
DELETE FROM tideway_private.payment_disputes WHERE payment_id='50000000-0000-4000-8000-000000000010';
UPDATE booking_payments SET status='captured',amount_captured_pence=amount_pence,amount_refunded_pence=0 WHERE id='50000000-0000-4000-8000-000000000010';
SELECT set_config('app.user_id','10000000-0000-4000-8000-000000000004',true);
SELECT set_config('app.user_roles','administrator',true);
CREATE FUNCTION pg_temp.prepare_parent_transfer(command_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE c payment_commands%ROWTYPE; p booking_payments%ROWTYPE;
BEGIN
 SELECT * INTO c FROM payment_commands WHERE id=command_id;
 SELECT * INTO p FROM booking_payments WHERE id=c.payment_id;
 PERFORM tideway_private.claim_payment_command_attempt(c.id,decode(repeat('f9',32),'hex'),jsonb_build_object(
   'commandId',c.id,'paymentId',p.id,'bookingId',p.booking_id,'kind',c.command_kind,'providerPaymentId',p.provider_payment_id,
   'amountPence',c.amount_pence,'currency',p.currency,'idempotencyKey','tideway_payment_command_'||c.id::text,
   'sourceChargeId','ch_parent_original','destinationAccountId','acct_parent_original'));
END;
$$;
SAVEPOINT event_identity_base;
DO $refund_parent$
DECLARE p uuid:='50000000-0000-4000-8000-000000000010'; c uuid:='55000000-0000-4000-8000-000000000001';
 result jsonb; t timestamptz:=now()-interval '1 minute'; blocked boolean; variant integer;
BEGIN
 PERFORM * FROM tideway_private.begin_booking_payment_command(c,p,'refund',1000,decode(repeat('f4',32),'hex'));
 result:=tideway_private.reconcile_payment_provider_event('stripe','evt_parent_old','refund-succeeded','re_parent_old',p,c,1000,'gbp',t,repeat('1',64));
 IF result->>'retryable' IS DISTINCT FROM 'true' OR result->>'accepted' IS DISTINCT FROM 'false' OR (SELECT amount_refunded_pence FROM booking_payments WHERE id=p)<>0
   OR (SELECT provider_command_id FROM payment_commands WHERE id=c) IS NOT NULL OR NOT tideway_private.payment_reconciliation_hold(p)
   THEN RAISE EXCEPTION 'Legacy ten-argument delivery changed money or escaped its identity hold'; END IF;
 result:=tideway_private.get_administrator_booking_payment_operation('40000000-0000-4000-8000-000000000003');
 IF result->>'reconciliationReviewRequired' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Identity hold absent from administrator detail'; END IF;
 result:=tideway_private.reconcile_payment_provider_event('stripe','evt_parent_old','refund-succeeded','re_parent_old',p,c,1000,'gbp',t,repeat('2',64),'pi_payment_ordering','ch_parent_refund',NULL);
 IF result->>'accepted' IS DISTINCT FROM 'true' OR (SELECT amount_refunded_pence FROM booking_payments WHERE id=p)<>1000 OR tideway_private.payment_reconciliation_hold(p)
   THEN RAISE EXCEPTION 'Signed parent redelivery did not resolve old-server hold exactly once'; END IF;
 result:=tideway_private.reconcile_payment_provider_event('stripe','evt_parent_old','refund-succeeded','re_parent_old',p,c,1000,'gbp',t,repeat('3',64));
 IF result->>'accepted' IS DISTINCT FROM 'false' OR result->>'retryable' IS DISTINCT FROM 'true' OR (SELECT amount_refunded_pence FROM booking_payments WHERE id=p)<>1000
   THEN RAISE EXCEPTION 'Legacy ten-argument delivery borrowed parent proof for a changed envelope'; END IF;
 result:=tideway_private.reconcile_payment_provider_event('stripe','evt_parent_old','refund-succeeded','re_parent_old',p,c,1000,'gbp',t,repeat('1',64));
 IF result->>'duplicate' IS DISTINCT FROM 'true' OR (SELECT amount_refunded_pence FROM booking_payments WHERE id=p)<>1000 THEN RAISE EXCEPTION 'Guarded stored-identity replay applied money twice'; END IF;
 FOR variant IN 1..2 LOOP
   blocked:=false;
   BEGIN
     PERFORM tideway_private.reconcile_payment_provider_event('stripe','evt_parent_old','refund-succeeded','re_parent_old',p,c,1000,'gbp',t,repeat('4',64),
       CASE WHEN variant=1 THEN 'pi_other_payment' ELSE 'pi_payment_ordering' END,CASE WHEN variant=2 THEN 'ch_other_source' ELSE 'ch_parent_refund' END,NULL);
   EXCEPTION WHEN SQLSTATE '22023' THEN
     IF SQLERRM<>'payment-event-parent-identity-conflict' THEN RAISE; END IF; blocked:=true;
   END;
   IF NOT blocked THEN RAISE EXCEPTION 'Repeated signed event changed its persisted parent identity'; END IF;
 END LOOP;
 IF (SELECT payload_hash FROM tideway_private.payment_provider_events WHERE provider_event_id='evt_parent_old')<>repeat('1',64)
   OR (SELECT provider_payment_id FROM tideway_private.payment_event_parent_identities WHERE provider_event_id='evt_parent_old')<>'pi_payment_ordering'
   THEN RAISE EXCEPTION 'Envelope retry replaced first audit hash or signed identity'; END IF;
 -- A new inconsistent event must hold even a previously reconciled command.
 result:=tideway_private.reconcile_payment_provider_event('stripe','evt_parent_bad_after_success','refund-failed','re_parent_old',p,c,1000,'gbp',t,repeat('f',64),'pi_unrelated_after_success','ch_unrelated_after_success',NULL);
 IF result->>'accepted' IS DISTINCT FROM 'false' OR NOT tideway_private.payment_reconciliation_hold(p) OR (SELECT amount_refunded_pence FROM booking_payments WHERE id=p)<>1000 THEN RAISE EXCEPTION 'Existing signed success hid an inconsistent new parent'; END IF;
 blocked:=false;
 BEGIN
   PERFORM * FROM tideway_private.begin_booking_payment_command('55000000-0000-4000-8000-000000000008',p,'refund',500,decode(repeat('fc',32),'hex'));
 EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'payment-reconciliation-required' THEN RAISE; END IF; blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'An inconsistent parent allowed a competing monetary command'; END IF;
 result:=tideway_private.list_administrator_payment_operations('actionable',100,0);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(result->'payments') item WHERE item->>'paymentId'=p::text AND item->>'reconciliationReviewRequired'='true') THEN RAISE EXCEPTION 'Identity-held terminal command vanished from actionable queue'; END IF;
END;
$refund_parent$;
ROLLBACK TO event_identity_base;
DO $refund_mismatch$
DECLARE p uuid:='50000000-0000-4000-8000-000000000010'; c uuid:='55000000-0000-4000-8000-000000000002'; result jsonb; t timestamptz:=now(); blocked boolean:=false;
BEGIN
 PERFORM * FROM tideway_private.begin_booking_payment_command(c,p,'refund',1000,decode(repeat('f5',32),'hex'));
 result:=tideway_private.reconcile_payment_provider_event('stripe','evt_parent_wrong','refund-succeeded','re_parent_wrong',p,c,1000,'gbp',t,repeat('5',64),'pi_wrong_parent','ch_wrong_parent',NULL);
 IF result->>'reason' IS DISTINCT FROM 'payment-event-parent-mismatch' OR result->>'retryable' IS DISTINCT FROM 'true' OR (SELECT amount_refunded_pence FROM booking_payments WHERE id=p)<>0
   OR (SELECT provider_command_id FROM payment_commands WHERE id=c) IS NOT NULL OR NOT tideway_private.payment_reconciliation_hold(p)
   THEN RAISE EXCEPTION 'Wrong refund parent changed money or was not held'; END IF;
 result:=tideway_private.reconcile_payment_provider_event('stripe','evt_parent_wrong','refund-succeeded','re_parent_wrong',p,c,1000,'gbp',t,repeat('5',64));
 IF result->>'accepted' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'Ten-argument replay bypassed a stored wrong parent'; END IF;
 BEGIN
   PERFORM tideway_private.reconcile_payment_provider_event('stripe','evt_parent_wrong','refund-succeeded','re_parent_wrong',p,c,1000,'gbp',t,repeat('7',64),'pi_payment_ordering','ch_wrong_parent',NULL);
 EXCEPTION WHEN SQLSTATE '22023' THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'A conflicting renewed parent silently replaced original signed facts'; END IF;
END;
$refund_mismatch$;
ROLLBACK TO event_identity_base;
DO $transfer_mismatch$
DECLARE p uuid:='50000000-0000-4000-8000-000000000010'; c uuid:='55000000-0000-4000-8000-000000000003'; result jsonb; amount integer; variant integer;
BEGIN
 PERFORM * FROM tideway_private.begin_booking_payment_command(c,p,'transfer',NULL,decode(repeat('f6',32),'hex'));
 PERFORM pg_temp.prepare_parent_transfer(c);
 SELECT amount_pence INTO amount FROM payment_commands WHERE id=c;
 FOR variant IN 1..3 LOOP
   result:=tideway_private.reconcile_payment_provider_event('stripe','evt_parent_transfer_bad_'||variant,'transfer-succeeded','tr_parent_bad',p,c,amount,'gbp',now(),repeat('8',64),
     CASE WHEN variant=1 THEN 'pi_wrong_parent' ELSE 'pi_payment_ordering' END,
     CASE WHEN variant=2 THEN 'ch_wrong_source' ELSE 'ch_parent_original' END,
     CASE WHEN variant=3 THEN 'acct_wrong_destination' ELSE 'acct_parent_original' END);
   IF result->>'reason' IS DISTINCT FROM 'payment-event-parent-mismatch' OR (SELECT status FROM payment_commands WHERE id=c)<>'created'
     OR (SELECT provider_command_id FROM payment_commands WHERE id=c) IS NOT NULL OR NOT tideway_private.payment_reconciliation_hold(p)
     THEN RAISE EXCEPTION 'Wrong transfer parent/source/destination mutated command or escaped review'; END IF;
 END LOOP;
END;
$transfer_mismatch$;
ROLLBACK TO event_identity_base;
DO $transfer_valid$
DECLARE p uuid:='50000000-0000-4000-8000-000000000010'; c uuid:='55000000-0000-4000-8000-000000000004'; result jsonb; amount integer; t timestamptz:=now();
BEGIN
 PERFORM * FROM tideway_private.begin_booking_payment_command(c,p,'transfer',NULL,decode(repeat('f7',32),'hex'));
 PERFORM pg_temp.prepare_parent_transfer(c);
 SELECT amount_pence INTO amount FROM payment_commands WHERE id=c;
 -- A later payout-profile change must not rewrite the already issued command.
 UPDATE tideway_private.cleaner_payout_accounts SET destination_account_id='acct_parent_current_changed' WHERE cleaner_user_id=(SELECT cleaner_user_id FROM booking_payments WHERE id=p);
 result:=tideway_private.reconcile_payment_provider_event('stripe','evt_parent_reverse_first','transfer-reversed','tr_parent_original',p,c,amount,'gbp',t,repeat('9',64),'pi_payment_ordering','ch_parent_original','acct_parent_original');
 IF result->>'accepted' IS DISTINCT FROM 'true' OR NOT (SELECT provider_terminal_failure FROM payment_commands WHERE id=c) THEN RAISE EXCEPTION 'Exact original transfer reversal was rejected after payout profile change'; END IF;
 result:=tideway_private.reconcile_payment_provider_event('stripe','evt_parent_created_late','transfer-succeeded','tr_parent_original',p,c,amount,'gbp',t,repeat('a',64),'pi_payment_ordering','ch_parent_original','acct_parent_original');
 IF result->>'accepted' IS DISTINCT FROM 'true' OR (SELECT status FROM payment_commands WHERE id=c)<>'provider-failed' THEN RAISE EXCEPTION 'Out-of-order created transfer reopened its exact reversal'; END IF;
 result:=tideway_private.reconcile_payment_provider_event('stripe','evt_parent_reverse_first','transfer-reversed','tr_parent_original',p,c,amount,'gbp',t,repeat('b',64));
 IF result->>'accepted' IS DISTINCT FROM 'false' OR result->>'retryable' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Legacy transfer replay borrowed proof for a changed envelope'; END IF;
 result:=tideway_private.reconcile_payment_provider_event('stripe','evt_parent_reverse_first','transfer-reversed','tr_parent_original',p,c,amount,'gbp',t,repeat('9',64));
 IF result->>'duplicate' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Guarded transfer recovery did not reuse exact retained parent proof'; END IF;
END;
$transfer_valid$;
ROLLBACK TO event_identity_base;
DO $legacy_transfer$
DECLARE p uuid:='50000000-0000-4000-8000-000000000010'; c uuid:='55000000-0000-4000-8000-000000000005'; result jsonb; amount integer;
BEGIN
 PERFORM * FROM tideway_private.begin_booking_payment_command(c,p,'transfer',NULL,decode(repeat('f8',32),'hex'));
 SELECT amount_pence INTO amount FROM payment_commands WHERE id=c;
 INSERT INTO tideway_private.payment_command_attempt_windows(command_id,first_attempt_at,retry_before,legacy_unknown) VALUES(c,now(),now(),true);
 result:=tideway_private.reconcile_payment_provider_event('stripe','evt_parent_legacy','transfer-succeeded','tr_parent_legacy',p,c,amount,'gbp',now(),repeat('c',64),'pi_payment_ordering','ch_parent_original','acct_parent_original');
 IF result->>'reason' IS DISTINCT FROM 'transfer-attempt-identity-unavailable' OR (SELECT status FROM payment_commands WHERE id=c)<>'created' OR NOT tideway_private.payment_reconciliation_hold(p)
   THEN RAISE EXCEPTION 'Legacy transfer inferred an immutable source/destination that was never stored'; END IF;
END;
$legacy_transfer$;
ROLLBACK TO event_identity_base;
DO $retained_refund_replay$
DECLARE p uuid:='50000000-0000-4000-8000-000000000010'; c uuid:='55000000-0000-4000-8000-000000000006'; result jsonb; t timestamptz:=now()-interval '1 minute'; evidence jsonb;
BEGIN
 INSERT INTO payment_commands(id,payment_id,command_kind,amount_pence,status,idempotency_key_hash,created_by)
 VALUES(c,p,'refund',1000,'created',decode(repeat('fa',32),'hex'),tideway_private.current_user_id());
 UPDATE booking_payments SET amount_captured_pence=0,status='authorized' WHERE id=p;
 result:=tideway_private.reconcile_payment_provider_event('stripe','evt_parent_retained','refund-succeeded','re_parent_retained',p,c,1000,'gbp',t,repeat('d',64),'pi_payment_ordering','ch_parent_retained',NULL);
 IF result->>'retryable' IS DISTINCT FROM 'true' OR NOT EXISTS(SELECT 1 FROM tideway_private.payment_event_parent_identities WHERE provider_event_id='evt_parent_retained') THEN RAISE EXCEPTION 'Unapplied signed identity was not retained for recovery'; END IF;
 UPDATE booking_payments SET amount_captured_pence=amount_pence,status='captured' WHERE id=p;
 result:=tideway_private.reconcile_payment_provider_event('stripe','evt_parent_retained','refund-succeeded','re_parent_retained',p,c,1000,'gbp',t,repeat('f',64),NULL::text,NULL::text,NULL::text);
 IF result->>'accepted' IS DISTINCT FROM 'false' OR result->>'retryable' IS DISTINCT FROM 'true' OR (SELECT amount_refunded_pence FROM booking_payments WHERE id=p)<>0
   THEN RAISE EXCEPTION 'Null parent arguments bypassed exact retained-envelope recovery'; END IF;
 evidence:=jsonb_build_object('source','stripe-api-discovery','amountPence',1000,'currency','gbp','providerPaymentId','pi_payment_ordering','observedStatus','succeeded','sourceChargeId',NULL,'destinationAccountId',NULL,'observedReversedAmount',NULL);
 result:=tideway_private.record_payment_command_recovery(c,'found-awaiting-signed-evidence',NULL,'re_parent_retained',evidence);
 IF result->>'recoveryRequired' IS DISTINCT FROM 'false' OR (result->>'signedEventsReplayed')::integer<>1 OR (SELECT amount_refunded_pence FROM booking_payments WHERE id=p)<>1000
   THEN RAISE EXCEPTION '113 recovery could not replay exact persisted signed parent facts through guarded10args'; END IF;
END;
$retained_refund_replay$;
ROLLBACK TO event_identity_base;
DO $retained_transfer_replay$
DECLARE p uuid:='50000000-0000-4000-8000-000000000010'; c uuid:='55000000-0000-4000-8000-000000000009'; result jsonb; amount integer; t timestamptz:=now()-interval '1 minute';
BEGIN
 PERFORM * FROM tideway_private.begin_booking_payment_command(c,p,'transfer',NULL,decode(repeat('fd',32),'hex'));
 PERFORM pg_temp.prepare_parent_transfer(c);
 SELECT amount_pence INTO amount FROM payment_commands WHERE id=c;
 UPDATE booking_payments SET amount_captured_pence=0,status='authorized' WHERE id=p;
 result:=tideway_private.reconcile_payment_provider_event('stripe','evt_parent_transfer_retained','transfer-succeeded','tr_parent_retained',p,c,amount,'gbp',t,repeat('a',64),'pi_payment_ordering','ch_parent_original','acct_parent_original');
 IF result->>'retryable' IS DISTINCT FROM 'true' OR (SELECT status FROM payment_commands WHERE id=c)<>'created' THEN RAISE EXCEPTION 'Transfer without capture did not retain its exact signed identity'; END IF;
 UPDATE booking_payments SET amount_captured_pence=amount_pence,status='captured' WHERE id=p;
 result:=tideway_private.record_payment_command_recovery(c,'found-awaiting-signed-evidence',NULL,'tr_parent_retained',jsonb_build_object('source','stripe-api-discovery','amountPence',amount,'currency','gbp','providerPaymentId','pi_payment_ordering','observedStatus','created','sourceChargeId','ch_parent_original','destinationAccountId','acct_parent_original','observedReversedAmount',0));
 IF result->>'recoveryRequired' IS DISTINCT FROM 'false' OR (result->>'signedEventsReplayed')::integer<>1 OR (SELECT status FROM payment_commands WHERE id=c)<>'reconciled'
   THEN RAISE EXCEPTION '113 transfer recovery failed to revalidate persisted signed parents'; END IF;
END;
$retained_transfer_replay$;
ROLLBACK TO event_identity_base;
DO $historical_without_proof$
DECLARE p uuid:='50000000-0000-4000-8000-000000000010'; c uuid:='55000000-0000-4000-8000-000000000007'; result jsonb;
BEGIN
 PERFORM * FROM tideway_private.begin_booking_payment_command(c,p,'refund',1000,decode(repeat('fb',32),'hex'));
 INSERT INTO tideway_private.payment_provider_events(provider,provider_event_id,event_kind,provider_object_id,payment_id,command_id,amount_pence,currency,occurred_at,payload_hash,reconciliation_version)
 VALUES('stripe','evt_parent_historical','refund-succeeded','re_parent_historical',p,c,1000,'gbp',now(),repeat('e',64),1);
 result:=tideway_private.record_payment_command_recovery(c,'found-awaiting-signed-evidence',NULL,'re_parent_historical',jsonb_build_object('source','stripe-api-discovery','amountPence',1000,'currency','gbp','providerPaymentId','pi_payment_ordering','observedStatus','succeeded'));
 IF result->>'recoveryRequired' IS DISTINCT FROM 'true' OR result->>'recoveryReason' IS DISTINCT FROM 'signed-event-prerequisite-unresolved'
   OR (SELECT amount_refunded_pence FROM booking_payments WHERE id=p)<>0 OR (SELECT provider_command_id FROM payment_commands WHERE id=c) IS NOT NULL
   OR EXISTS(SELECT 1 FROM tideway_private.payment_event_parent_identities WHERE provider_event_id='evt_parent_historical')
   THEN RAISE EXCEPTION 'An unsigned GET fabricated historical signed parent proof or left partial money'; END IF;
 IF has_function_privilege('tideway_app','tideway_private.apply_bound_payment_provider_event(text,text,text,text,uuid,uuid,integer,character,timestamptz,character)','EXECUTE')
   OR has_table_privilege('tideway_app','tideway_private.payment_event_parent_identities','SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Runtime has a direct parent validation bypass'; END IF;
END;
$historical_without_proof$;
ROLLBACK TO event_identity_base;
ROLLBACK TO event_identity_checks;
