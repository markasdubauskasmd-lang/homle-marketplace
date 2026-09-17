\set ON_ERROR_STOP on
BEGIN;
INSERT INTO booking_payments(id,booking_id,landlord_user_id,cleaner_user_id,provider,currency,amount_pence,amount_captured_pence,status,terms_fingerprint,provider_payment_id,idempotency_key_hash)
SELECT '54000000-0000-4000-8000-000000000001',id,landlord_user_id,cleaner_user_id,'stripe','gbp',customer_price_pence,customer_price_pence,'captured',terms_fingerprint,'pi_concurrent_claim',decode(repeat('f1',32),'hex')
FROM bookings WHERE id='40000000-0000-4000-8000-000000000003';
INSERT INTO payment_commands(id,payment_id,command_kind,amount_pence,status,idempotency_key_hash,created_by)
VALUES('54000000-0000-4000-8000-000000000002','54000000-0000-4000-8000-000000000001','refund',1000,'created',decode(repeat('f2',32),'hex'),'10000000-0000-4000-8000-000000000004');
COMMIT;
