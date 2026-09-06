\set ON_ERROR_STOP on

-- Owner-only preparation for the privacy test. The product runtime must never
-- receive UPDATE rights merely so a disposable fixture can cross the 24-hour
-- maturity boundary.
BEGIN;

UPDATE user_roles
SET granted_at=now()-interval '2 days'
WHERE user_id='10000000-0000-4000-8000-000000000001' AND role='landlord';

UPDATE cleaning_requests
SET created_at=now()-interval '2 days'
WHERE id IN (
  '30000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000003'
);

INSERT INTO room_scan_sessions(id,cleaning_request_id,landlord_user_id,device_class,captured_at,created_at)
VALUES(
  '3e000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'guided-web',now()-interval '2 days',now()-interval '2 days'
);

-- A completed manual request with a review must count without a room scan.
INSERT INTO bookings (
 id,landlord_user_id,cleaner_user_id,property_id,cleaning_request_id,status,
 scheduled_start_at,scheduled_end_at,customer_price_pence,cleaner_pay_pence,
 invited_at,cleaner_response_deadline,scope_fingerprint,terms_fingerprint,scope_snapshot,confirmed_at,completed_at
) VALUES (
 '4e000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
 '10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003',
 '30000000-0000-4000-8000-000000000003','completed',
 now()-interval '5 days',now()-interval '5 days'+interval '2 hours',10000,7000,
 now()-interval '7 days',now()-interval '6 days',repeat('e',64),repeat('f',64),'{}'::jsonb,now()-interval '6 days',now()-interval '4 days'
);
INSERT INTO reviews(id,booking_id,landlord_user_id,cleaner_user_id,rating) VALUES (
 '5e000000-0000-4000-8000-000000000001','4e000000-0000-4000-8000-000000000001',
 '10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',5
);
COMMIT;
