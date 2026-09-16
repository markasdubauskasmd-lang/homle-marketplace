\set ON_ERROR_STOP on
SET statement_timeout='15s';
SET lock_timeout='12s';
BEGIN;
SELECT set_config('app.user_id','10000000-0000-4000-8000-000000000004',true);
SELECT set_config('app.user_roles','administrator',true);
CREATE FUNCTION pg_temp.claim_fixture() RETURNS jsonb LANGUAGE sql AS $$
 SELECT tideway_private.claim_payment_command_attempt('54000000-0000-4000-8000-000000000002',decode(repeat('f3',32),'hex'),
   jsonb_build_object('commandId','54000000-0000-4000-8000-000000000002','paymentId','54000000-0000-4000-8000-000000000001',
   'bookingId','40000000-0000-4000-8000-000000000003','kind','refund','providerPaymentId','pi_concurrent_claim',
   'amountPence',1000,'currency','gbp','idempotencyKey','tideway_payment_command_54000000-0000-4000-8000-000000000002'));
$$;
