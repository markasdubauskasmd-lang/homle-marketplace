\set ON_ERROR_STOP on

-- Restore the shared synthetic fixtures immediately so unrelated integration
-- scenarios continue to exercise their original fresh-account assumptions.
BEGIN;
DELETE FROM reviews WHERE id='5e000000-0000-4000-8000-000000000001';
DELETE FROM bookings WHERE id='4e000000-0000-4000-8000-000000000001';

DELETE FROM room_scan_sessions
WHERE id='3e000000-0000-4000-8000-000000000001';

UPDATE user_roles
SET granted_at=now()
WHERE user_id='10000000-0000-4000-8000-000000000001' AND role='landlord';

UPDATE cleaning_requests
SET created_at=now()
WHERE id IN (
  '30000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000003'
);

COMMIT;
