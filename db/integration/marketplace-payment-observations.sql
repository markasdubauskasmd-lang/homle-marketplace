-- Disposable owner-run fixture. No provider requests or production writes.
SAVEPOINT observations_checks;
DELETE FROM tideway_private.payment_observed_objects WHERE payment_id='50000000-0000-4000-8000-000000000010';
DELETE FROM tideway_private.payment_observation_event_parents WHERE provider_event_id IN (SELECT provider_event_id FROM tideway_private.payment_provider_events WHERE payment_id='50000000-0000-4000-8000-000000000010');
DELETE FROM tideway_private.payment_event_parent_identities WHERE provider_event_id IN (SELECT provider_event_id FROM tideway_private.payment_provider_events WHERE payment_id='50000000-0000-4000-8000-000000000010');
DELETE FROM tideway_private.payment_provider_events WHERE payment_id='50000000-0000-4000-8000-000000000010';
DELETE FROM tideway_private.payment_command_attempt_windows WHERE command_id IN (SELECT id FROM payment_commands WHERE payment_id='50000000-0000-4000-8000-000000000010');
DELETE FROM payment_commands WHERE payment_id='50000000-0000-4000-8000-000000000010';
DELETE FROM tideway_private.payment_disputes WHERE payment_id='50000000-0000-4000-8000-000000000010';
UPDATE booking_payments SET status='captured',amount_captured_pence=amount_pence,amount_refunded_pence=0,cancelled_at=NULL WHERE id='50000000-0000-4000-8000-000000000010';
SELECT set_config('app.user_id','10000000-0000-4000-8000-000000000004',true);
SELECT set_config('app.user_roles','administrator',true);
CREATE FUNCTION pg_temp.observed(event_id text,kind text,object_id text,amount integer,command uuid DEFAULT NULL,selected_payment uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$
 SELECT tideway_private.reconcile_payment_provider_event('stripe',event_id,kind,object_id,selected_payment,command,amount,'gbp',now()-interval '1 minute',repeat('a',64),'pi_payment_ordering',CASE WHEN kind LIKE 'refund-%' THEN 'ch_observed_original' ELSE NULL END,NULL);
$$;
CREATE FUNCTION pg_temp.claim_observed_command(selected_command uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT tideway_private.claim_payment_command_attempt(command.id,decode(repeat('90',32),'hex'),
   jsonb_build_object('commandId',command.id,'paymentId',payment.id,'bookingId',payment.booking_id,'kind',command.command_kind,
     'providerPaymentId',payment.provider_payment_id,'amountPence',command.amount_pence,'currency','gbp',
     'idempotencyKey','tideway_payment_command_'||command.id::text))
 FROM payment_commands command JOIN booking_payments payment ON payment.id=command.payment_id WHERE command.id=selected_command;
$$;
SAVEPOINT observations_base;
DO $lifecycle$
DECLARE p uuid:='50000000-0000-4000-8000-000000000010'; r jsonb; denied boolean;
BEGIN
 r:=pg_temp.observed('evt_observed_pending','refund-pending','re_external_alpha',1000);
 IF r->>'accepted' IS DISTINCT FROM 'true' OR NOT tideway_private.payment_observation_hold(p)
  OR (SELECT amount_refunded_pence FROM booking_payments WHERE id=p)<>0 THEN RAISE EXCEPTION 'External pending refund was lost or changed money'; END IF;
 denied:=false;
 BEGIN PERFORM * FROM tideway_private.begin_booking_payment_command('59000000-0000-4000-8000-000000000001',p,'transfer',NULL,decode(repeat('91',32),'hex'));
 EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'payment-reconciliation-required' THEN RAISE; END IF; denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Pending external refund allowed a payout'; END IF;
 r:=pg_temp.observed('evt_observed_success','refund-succeeded','re_external_alpha',1000);
 IF r->>'accepted' IS DISTINCT FROM 'true' OR tideway_private.payment_observation_hold(p) OR (SELECT amount_refunded_pence FROM booking_payments WHERE id=p)<>1000 THEN RAISE EXCEPTION 'External success did not apply exactly once'; END IF;
 PERFORM pg_temp.observed('evt_observed_success','refund-succeeded','re_external_alpha',1000);
 PERFORM pg_temp.observed('evt_observed_success_again','refund-succeeded','re_external_alpha',1000);
 IF (SELECT amount_refunded_pence FROM booking_payments WHERE id=p)<>1000 THEN RAISE EXCEPTION 'Refund object counted twice across events'; END IF;
 PERFORM pg_temp.observed('evt_observed_failed','refund-failed','re_external_alpha',1000);
 PERFORM pg_temp.observed('evt_observed_failed_again','refund-failed','re_external_alpha',1000);
 PERFORM pg_temp.observed('evt_observed_success_stale','refund-succeeded','re_external_alpha',1000);
 PERFORM pg_temp.observed('evt_observed_pending_stale','refund-pending','re_external_alpha',1000);
 IF (SELECT amount_refunded_pence FROM booking_payments WHERE id=p)<>0 OR tideway_private.payment_observation_hold(p)
   OR (SELECT observed_status FROM tideway_private.payment_observed_objects WHERE provider_object_id='re_external_alpha')<>'failed' THEN RAISE EXCEPTION 'Terminal failed refund resurrected'; END IF;
 PERFORM pg_temp.observed('evt_observed_second','refund-succeeded','re_external_beta',1500);
 IF (SELECT amount_refunded_pence FROM booking_payments WHERE id=p)<>1500 OR EXISTS(SELECT 1 FROM payment_commands WHERE payment_id=p) THEN RAISE EXCEPTION 'External refund invented a command or lost separate object'; END IF;
 r:=tideway_private.get_administrator_booking_payment_operation('40000000-0000-4000-8000-000000000003');
 IF jsonb_array_length(r->'observations')<>2 THEN RAISE EXCEPTION 'Administrator lost external object evidence'; END IF;
 PERFORM * FROM tideway_private.begin_booking_payment_command('59000000-0000-4000-8000-000000000009',p,'refund',500,decode(repeat('99',32),'hex'));
 IF NOT EXISTS(SELECT 1 FROM payment_commands WHERE id='59000000-0000-4000-8000-000000000009') THEN RAISE EXCEPTION 'Resolved external refund blocked unrelated future command'; END IF;
END;
$lifecycle$;
ROLLBACK TO observations_base;
DO $race$
DECLARE p uuid:='50000000-0000-4000-8000-000000000010'; c uuid:='59000000-0000-4000-8000-000000000002'; r jsonb; denied boolean:=false;
BEGIN
 PERFORM * FROM tideway_private.begin_booking_payment_command(c,p,'refund',1000,decode(repeat('92',32),'hex'));
 PERFORM pg_temp.claim_observed_command(c);
 PERFORM pg_temp.observed('evt_external_race','refund-succeeded','re_external_race',500);
 BEGIN PERFORM * FROM tideway_private.begin_booking_payment_command(c,p,'refund',1000,decode(repeat('92',32),'hex'));
 EXCEPTION WHEN SQLSTATE 'P0001' THEN IF SQLERRM<>'payment-reconciliation-required' THEN RAISE; END IF; denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Existing retry bypassed external observation hold'; END IF;
 r:=tideway_private.claim_payment_command_attempt(c,decode(repeat('93',32),'hex'),'{}'::jsonb);
 IF r->>'action' IS DISTINCT FROM 'recover' OR (SELECT status FROM payment_commands WHERE id=c)<>'created' THEN RAISE EXCEPTION 'Unsent claim dispatched or erased uncertain reservation'; END IF;
 -- An actual app event may resolve its own separate object; it does not replace external money.
 PERFORM pg_temp.observed('evt_app_race','refund-succeeded','re_app_race',1000,c,p);
 IF (SELECT amount_refunded_pence FROM booking_payments WHERE id=p)<>1500 THEN RAISE EXCEPTION 'External/app refund outcomes were conflated'; END IF;
END;
$race$;
ROLLBACK TO observations_base;
DO $convergence$
DECLARE p uuid:='50000000-0000-4000-8000-000000000010'; c uuid:='59000000-0000-4000-8000-000000000003'; r jsonb;
BEGIN
 PERFORM * FROM tideway_private.begin_booking_payment_command(c,p,'refund',1000,decode(repeat('94',32),'hex'));
 PERFORM pg_temp.observed('evt_no_metadata','refund-succeeded','re_convergence',1000);
 PERFORM pg_temp.observed('evt_added_metadata','refund-succeeded','re_convergence',1000,c,p);
 IF (SELECT amount_refunded_pence FROM booking_payments WHERE id=p)<>1000 OR NOT (SELECT provider_success_applied FROM payment_commands WHERE id=c) THEN RAISE EXCEPTION 'Later command association counted refund twice'; END IF;
 PERFORM pg_temp.observed('evt_removed_metadata','refund-failed','re_convergence',1000);
 IF (SELECT amount_refunded_pence FROM booking_payments WHERE id=p)<>0 OR NOT (SELECT provider_terminal_failure FROM payment_commands WHERE id=c) THEN RAISE EXCEPTION 'Metadata-less failure failed to reverse its own app object'; END IF;
END;
$convergence$;
ROLLBACK TO observations_base;
DO $missing_capture$
DECLARE p uuid:='50000000-0000-4000-8000-000000000010'; r jsonb;
BEGIN
 UPDATE booking_payments SET status='authorized',amount_captured_pence=0 WHERE id=p;
 r:=pg_temp.observed('evt_before_capture','refund-succeeded','re_before_capture',1000);
 IF r->>'retryable' IS DISTINCT FROM 'true' OR NOT tideway_private.payment_observation_hold(p) THEN RAISE EXCEPTION 'Missing capture dropped signed refund'; END IF;
 -- Fixture prerequisite models a subsequently reconciled capture, never a GET.
 UPDATE booking_payments SET status='captured',amount_captured_pence=amount_pence WHERE id=p;
 r:=tideway_private.replay_payment_observations(p);
 IF r->>'recoveryRequired' IS DISTINCT FROM 'false' OR (SELECT amount_refunded_pence FROM booking_payments WHERE id=p)<>1000 THEN RAISE EXCEPTION 'Exact retained refund replay failed'; END IF;
END;
$missing_capture$;
ROLLBACK TO observations_base;
DO $cancelled$
DECLARE p uuid:='50000000-0000-4000-8000-000000000010'; amount integer; r jsonb; original_booking_status public.booking_status;
BEGIN
 SELECT amount_pence INTO amount FROM booking_payments WHERE id=p;
 SELECT status INTO original_booking_status FROM bookings WHERE id='40000000-0000-4000-8000-000000000003';
 UPDATE booking_payments SET status='authorized',amount_captured_pence=0 WHERE id=p;
 r:=pg_temp.observed('evt_auto_cancelled','intent-cancelled-observed','pi_payment_ordering',amount);
 IF r->>'accepted' IS DISTINCT FROM 'true' OR (SELECT status FROM booking_payments WHERE id=p)<>'cancelled' THEN RAISE EXCEPTION 'Automatic cancellation retained authorization'; END IF;
 PERFORM tideway_private.reconcile_payment_provider_event('stripe','evt_late_authorized','authorization-succeeded','pi_payment_ordering',p,NULL,amount,'gbp',now(),repeat('b',64));
 IF (SELECT status FROM booking_payments WHERE id=p)<>'cancelled' OR (SELECT status FROM bookings WHERE id='40000000-0000-4000-8000-000000000003')<>original_booking_status THEN RAISE EXCEPTION 'Late authorization revived intent or changed booking'; END IF;
END;
$cancelled$;
ROLLBACK TO observations_base;
DO $cancel_before_response$
DECLARE p uuid:='50000000-0000-4000-8000-000000000010'; amount integer; r jsonb;
BEGIN
 SELECT amount_pence INTO amount FROM booking_payments WHERE id=p;
 UPDATE booking_payments SET status='creating',provider_payment_id=NULL,amount_captured_pence=0 WHERE id=p;
 r:=pg_temp.observed('evt_cancel_before_response','intent-cancelled-observed','pi_payment_ordering',amount,NULL,p);
 IF r->>'accepted' IS DISTINCT FROM 'true' OR (SELECT status FROM booking_payments WHERE id=p)<>'cancelled' THEN RAISE EXCEPTION 'Cancellation before create response lost terminal identity'; END IF;
 PERFORM tideway_private.record_booking_payment_authorization(p,'pi_payment_ordering','authorized');
 IF (SELECT status FROM booking_payments WHERE id=p)<>'cancelled' THEN RAISE EXCEPTION 'Late synchronous response revived canceled intent'; END IF;
END;
$cancel_before_response$;
ROLLBACK TO observations_base;
DO $transfer_conflict$
DECLARE p uuid:='50000000-0000-4000-8000-000000000010'; c uuid:='59000000-0000-4000-8000-000000000004'; amount integer; r jsonb;
BEGIN
 PERFORM * FROM tideway_private.begin_booking_payment_command(c,p,'transfer',NULL,decode(repeat('95',32),'hex'));
 PERFORM tideway_private.claim_payment_command_attempt(c,decode(repeat('97',32),'hex'),
   (SELECT jsonb_build_object('commandId',c,'paymentId',p,'bookingId',payment.booking_id,'kind','transfer',
     'providerPaymentId',payment.provider_payment_id,'amountPence',command.amount_pence,'currency','gbp',
     'idempotencyKey','tideway_payment_command_'||c::text,'sourceChargeId','ch_parent_original','destinationAccountId','acct_parent_original')
    FROM booking_payments payment JOIN payment_commands command ON command.payment_id=payment.id WHERE command.id=c));
 SELECT amount_pence INTO amount FROM payment_commands WHERE id=c;
 r:=tideway_private.reconcile_payment_provider_event('stripe','evt_before_external_refund','transfer-succeeded','tr_before_external_refund',p,c,amount,'gbp',now()-interval '2 minutes',repeat('d',64),'pi_payment_ordering','ch_parent_original','acct_parent_original');
 IF r->>'accepted' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Transfer conflict fixture failed'; END IF;
 PERFORM pg_temp.observed('evt_after_transfer','refund-succeeded','re_after_transfer',1000);
 IF (SELECT amount_refunded_pence FROM booking_payments WHERE id=p)<>1000 OR NOT tideway_private.payment_observation_hold(p)
   OR (SELECT status FROM payment_commands WHERE id=c)<>'reconciled' THEN RAISE EXCEPTION 'External refund after payout lost real funds or silently clawed back Cleaner money'; END IF;
END;
$transfer_conflict$;
ROLLBACK TO observations_base;
DO $cancel_command_race$
DECLARE p uuid:='50000000-0000-4000-8000-000000000010'; c uuid:='59000000-0000-4000-8000-000000000005'; amount integer; r jsonb;
BEGIN
 UPDATE bookings SET status='confirmed',journey_started_at=NULL WHERE id='40000000-0000-4000-8000-000000000003';
 UPDATE booking_payments SET status='authorized',amount_captured_pence=0 WHERE id=p;
 SELECT amount_pence INTO amount FROM booking_payments WHERE id=p;
 PERFORM * FROM tideway_private.begin_booking_payment_command(c,p,'cancel',NULL,decode(repeat('96',32),'hex'));
 PERFORM pg_temp.claim_observed_command(c);
 PERFORM pg_temp.observed('evt_cancel_command_early','intent-cancelled-observed','pi_payment_ordering',amount,NULL,p);
 IF NOT tideway_private.payment_observation_hold(p) THEN RAISE EXCEPTION 'Unbound cancel command lost its outcome hold'; END IF;
 PERFORM tideway_private.record_booking_payment_command(c,'pi_payment_ordering','succeeded');
 r:=tideway_private.replay_payment_observations(p);
 IF r->>'recoveryRequired' IS DISTINCT FROM 'false' OR (SELECT status FROM payment_commands WHERE id=c)<>'reconciled'
   OR (SELECT status FROM booking_payments WHERE id=p)<>'cancelled' THEN RAISE EXCEPTION 'Late cancel response/replay failed to resolve own command'; END IF;
END;
$cancel_command_race$;
ROLLBACK TO observations_base;
DO $unsent_superseded$
DECLARE p uuid:='50000000-0000-4000-8000-000000000010'; c uuid:='59000000-0000-4000-8000-000000000006'; amount integer; r jsonb;
BEGIN
 PERFORM * FROM tideway_private.begin_booking_payment_command(c,p,'refund',1000,decode(repeat('98',32),'hex'));
 SELECT amount_captured_pence-500 INTO amount FROM booking_payments WHERE id=p;
 PERFORM pg_temp.observed('evt_unsent_superseded','refund-succeeded','re_unsent_superseded',amount);
 IF NOT (SELECT superseded_before_dispatch FROM payment_commands WHERE id=c)
   OR (SELECT provider_terminal_failure OR provider_success_applied FROM payment_commands WHERE id=c)
   OR tideway_private.payment_observation_hold(p) THEN RAISE EXCEPTION 'Proven-unsent reservation was stranded or fabricated a provider outcome'; END IF;
 r:=tideway_private.get_payment_command_attempt(c);
 IF r->>'supersededBeforeDispatch' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Known-unsent evidence missing from role-bound projection'; END IF;
 r:=tideway_private.record_payment_command_recovery(c,'operator-required','provider-recovery-unavailable',NULL,'{}'::jsonb);
 IF r->>'recoveryRequired' IS DISTINCT FROM 'false' OR r->>'recoveryReason' IS DISTINCT FROM 'superseded-before-dispatch' THEN RAISE EXCEPTION 'Stale recovery invented uncertainty for unsent command'; END IF;
 r:=pg_temp.claim_observed_command(c);
 IF r->>'action' IS DISTINCT FROM 'not-sent' THEN RAISE EXCEPTION 'Superseded command retained POST allowance'; END IF;
 PERFORM * FROM tideway_private.begin_booking_payment_command('59000000-0000-4000-8000-000000000007',p,'refund',500,decode(repeat('9a',32),'hex'));
 PERFORM pg_temp.observed('evt_unsent_refund_failed','refund-failed','re_unsent_superseded',amount);
 r:=pg_temp.claim_observed_command(c);
 IF r->>'action' IS DISTINCT FROM 'not-sent' THEN RAISE EXCEPTION 'Old command revived after balance became refundable again'; END IF;
END;
$unsent_superseded$;
ROLLBACK TO observations_base;
DO $missing_parent$
DECLARE p uuid:='50000000-0000-4000-8000-000000000010'; r jsonb;
BEGIN
 r:=tideway_private.reconcile_payment_provider_event('stripe','evt_missing_observation_parent','refund-succeeded','re_missing_observation_parent',p,NULL,1000,'gbp',now(),repeat('e',64));
 IF r->>'retryable' IS DISTINCT FROM 'true' OR r->>'reason' IS DISTINCT FROM 'awaiting-event-parent-identity'
   OR NOT tideway_private.payment_observation_hold(p) OR NOT EXISTS(SELECT 1 FROM tideway_private.payment_provider_events WHERE provider_event_id='evt_missing_observation_parent' AND NOT processed)
   THEN RAISE EXCEPTION 'Missing legacy parent rolled back durable observation hold'; END IF;
END;
$missing_parent$;
ROLLBACK TO observations_base;
DO $private_access$
DECLARE denied boolean:=false;
BEGIN
 IF has_table_privilege('tideway_app','tideway_private.payment_observed_objects','SELECT') OR has_table_privilege('tideway_worker','tideway_private.payment_observed_objects','SELECT')
   OR has_function_privilege('tideway_app','tideway_private.payment_observation_hold(uuid)','EXECUTE') THEN RAISE EXCEPTION 'Private observation evidence exposed to runtime role'; END IF;
 PERFORM set_config('app.user_roles','landlord',true);
 BEGIN PERFORM tideway_private.replay_payment_observations('50000000-0000-4000-8000-000000000010');
 EXCEPTION WHEN SQLSTATE '42501' THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Landlord replayed financial evidence'; END IF;
END;
$private_access$;
ROLLBACK TO observations_checks;
RELEASE SAVEPOINT observations_checks;
