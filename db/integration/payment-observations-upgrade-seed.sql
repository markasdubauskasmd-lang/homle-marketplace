\set ON_ERROR_STOP on
DO $disposable_target$
BEGIN
 IF current_database()<>'ci_tideway_upgrade' THEN
   RAISE EXCEPTION 'Observation upgrade fixture requires its dedicated disposable CI database';
 END IF;
END;
$disposable_target$;
\ir marketplace-integration-setup.sql
\ir marketplace-dispute-setup.sql
BEGIN;
SELECT set_config('app.user_id','10000000-0000-4000-8000-000000000004',true);
SELECT set_config('app.user_roles','administrator',true);
UPDATE bookings SET status='completed' WHERE id='40000000-0000-4000-8000-000000000003';
INSERT INTO booking_payments(id,booking_id,landlord_user_id,cleaner_user_id,provider,currency,amount_pence,amount_captured_pence,status,terms_fingerprint,provider_payment_id,idempotency_key_hash)
SELECT '58000000-0000-4000-8000-000000000001',id,landlord_user_id,cleaner_user_id,'stripe','gbp',customer_price_pence,customer_price_pence,'captured',terms_fingerprint,'pi_upgrade_original',decode(repeat('81',32),'hex')
FROM bookings WHERE id='40000000-0000-4000-8000-000000000003';
CREATE TABLE public.observation_upgrade_fixture(kind text PRIMARY KEY,evidence text);
INSERT INTO observation_upgrade_fixture VALUES('reconciler-oid','tideway_private.reconcile_payment_provider_event(text,text,text,text,uuid,uuid,integer,character,timestamptz,character,text,text,text)'::regprocedure::oid::text);
DO $seed$
DECLARE p uuid:='58000000-0000-4000-8000-000000000001'; c uuid; n integer; r jsonb;
BEGIN
 IF to_regprocedure('tideway_private.claim_request_photo_terminal_cleanup(integer)') IS NULL THEN RAISE EXCEPTION 'Upgrade seed requires the actual116 schema'; END IF;
 IF to_regclass('tideway_private.payment_observed_objects') IS NOT NULL THEN RAISE EXCEPTION 'Upgrade seed must run on116 before117'; END IF;
 FOR n IN 2..3 LOOP
 c:=('58000000-0000-4000-8000-00000000000'||n)::uuid;
 PERFORM * FROM tideway_private.begin_booking_payment_command(c,p,'refund',1000,decode(repeat(CASE n WHEN 2 THEN '82' ELSE '83' END,32),'hex'));
 r:=tideway_private.reconcile_payment_provider_event('stripe','evt_upgrade_success_'||n,'refund-succeeded','re_upgrade_original_'||n,p,c,1000,'gbp',now()-interval '2 minutes',repeat('8',64),'pi_upgrade_original','ch_upgrade_original',NULL);
 IF r->>'accepted' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Pre117 refund fixture did not apply'; END IF;
 IF n=3 THEN
 r:=tideway_private.reconcile_payment_provider_event('stripe','evt_upgrade_failed_3','refund-failed','re_upgrade_original_3',p,c,1000,'gbp',now()-interval '1 minute',repeat('9',64),'pi_upgrade_original','ch_upgrade_original',NULL);
 IF r->>'accepted' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Pre117 terminal failure fixture did not apply'; END IF;
 END IF;
 END LOOP;
 IF (SELECT amount_refunded_pence FROM booking_payments WHERE id=p) IS DISTINCT FROM 1000 THEN RAISE EXCEPTION 'Pre117 baseline refund balance wrong'; END IF;
END;
$seed$;
COMMIT;
