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

COMMIT;
