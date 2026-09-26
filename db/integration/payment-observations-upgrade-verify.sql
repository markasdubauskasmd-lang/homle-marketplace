\set ON_ERROR_STOP on
DO $disposable_target$
BEGIN
 IF current_database()<>'ci_tideway_upgrade' THEN
   RAISE EXCEPTION 'Observation upgrade fixture requires its dedicated disposable CI database';
 END IF;
END;
$disposable_target$;
BEGIN;
SELECT set_config('app.user_id','10000000-0000-4000-8000-000000000004',true);
SELECT set_config('app.user_roles','administrator',true);
DO $upgrade$
DECLARE p uuid:='58000000-0000-4000-8000-000000000001'; e tideway_private.payment_provider_events%ROWTYPE; r jsonb;
BEGIN
 IF (SELECT count(*) FROM tideway_private.payment_observed_objects WHERE payment_id=p)<>2
   OR (SELECT applied_pence FROM tideway_private.payment_observed_objects WHERE provider_object_id='re_upgrade_original_2')<>1000
   OR NOT (SELECT terminal_failure FROM tideway_private.payment_observed_objects WHERE provider_object_id='re_upgrade_original_3')
   THEN RAISE EXCEPTION '115 did not backfill verified114 success and terminal failure anchors'; END IF;
 IF (SELECT evidence FROM observation_upgrade_fixture WHERE kind='reconciler-oid')<>'tideway_private.reconcile_payment_provider_event(text,text,text,text,uuid,uuid,integer,character,timestamptz,character,text,text,text)'::regprocedure::oid::text
   THEN RAISE EXCEPTION 'Upgrade changed reconciliation OID instead of preserving old caller identity'; END IF;
 FOR e IN SELECT * FROM tideway_private.payment_provider_events WHERE payment_id=p ORDER BY occurred_at LOOP
 r:=tideway_private.reconcile_payment_provider_event(e.provider,e.provider_event_id,e.event_kind,e.provider_object_id,e.payment_id,e.command_id,e.amount_pence,e.currency,e.occurred_at,e.payload_hash);
 IF r->>'accepted' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Retained114 evidence failed guarded replay'; END IF;
 END LOOP;
 IF (SELECT amount_refunded_pence FROM booking_payments WHERE id=p)<>1000 THEN RAISE EXCEPTION '115 replay counted a historical refund twice'; END IF;
 -- New metadata-less event for the historical app refund must use the same anchor.
 PERFORM tideway_private.reconcile_payment_provider_event('stripe','evt_upgrade_external_duplicate','refund-succeeded','re_upgrade_original_2',NULL,NULL,1000,'gbp',now(),repeat('a',64),'pi_upgrade_original','ch_upgrade_original',NULL);
 IF (SELECT amount_refunded_pence FROM booking_payments WHERE id=p)<>1000 THEN RAISE EXCEPTION 'Removing metadata created a second accounting path'; END IF;
 PERFORM tideway_private.reconcile_payment_provider_event('stripe','evt_upgrade_external_failure','refund-failed','re_upgrade_original_2',NULL,NULL,1000,'gbp',now(),repeat('b',64),'pi_upgrade_original','ch_upgrade_original',NULL);
 PERFORM tideway_private.reconcile_payment_provider_event('stripe','evt_upgrade_stale_success','refund-succeeded','re_upgrade_original_3',NULL,NULL,1000,'gbp',now(),repeat('c',64),'pi_upgrade_original','ch_upgrade_original',NULL);
 IF (SELECT amount_refunded_pence FROM booking_payments WHERE id=p)<>0 THEN RAISE EXCEPTION 'Upgrade failed exact reversal or resurrected terminal failure'; END IF;
END;
$upgrade$;
ROLLBACK;
\echo 'Actual PostgreSQL114-to115 observation upgrade passed: signed historical anchors, retained OID, replay, metadata removal, failure reversal and terminal ordering.'
