\set ON_ERROR_STOP on
BEGIN;
INSERT INTO bookings (
 id,landlord_user_id,cleaner_user_id,property_id,cleaning_request_id,status,
 scheduled_start_at,scheduled_end_at,customer_price_pence,cleaner_pay_pence,
 invited_at,cleaner_response_deadline,scope_fingerprint,terms_fingerprint,scope_snapshot
) VALUES (
 '4f000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
 '10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003',
 '30000000-0000-4000-8000-000000000003','pending-cleaner-acceptance',
 now()+interval '51 hours',now()+interval '53 hours',10000,7000,
 now()-interval '1 day',now()-interval '1 minute',repeat('e',64),repeat('f',64),'{}'::jsonb
);
COMMIT;
