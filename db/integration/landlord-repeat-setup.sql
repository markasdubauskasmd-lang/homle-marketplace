\set ON_ERROR_STOP on

BEGIN;

INSERT INTO properties (id,landlord_user_id,name,address_line_1,locality,postcode,property_type) VALUES
  ('22000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Archiveable fixture','Private archive address A','London','SW1A 1AA','flat'),
  ('22000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','Active request fixture','Private archive address B','London','SW1A 1AA','flat'),
  ('22000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','Active booking fixture','Private archive address C','London','SW1A 1AA','flat'),
  ('22000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','Completed history fixture','Private archive address D','London','SW1A 1AA','flat');

INSERT INTO cleaning_requests (
  id,landlord_user_id,property_id,status,requested_start_at,requested_end_at,
  cleaning_type,required_services,budget_pence,scope_fingerprint
) VALUES (
  '32000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000002','draft',now()+interval '7 days',
  now()+interval '7 days 2 hours','standard',ARRAY['standard-clean'],10000,repeat('d',64)
);

INSERT INTO bookings (
  id,landlord_user_id,cleaner_user_id,property_id,status,scheduled_start_at,
  scheduled_end_at,customer_price_pence,cleaner_pay_pence,invited_at,
  cleaner_response_deadline,scope_fingerprint,terms_fingerprint,scope_snapshot,confirmed_at
) VALUES
  ('42000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','22000000-0000-4000-8000-000000000003','confirmed',now()+interval '8 days',now()+interval '8 days 2 hours',10000,7000,now(),now()+interval '1 day',repeat('e',64),repeat('f',64),'{}'::jsonb,now()),
  ('42000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','22000000-0000-4000-8000-000000000004','completed',now()-interval '8 days',now()-interval '8 days'+interval '2 hours',10000,7000,now()-interval '10 days',now()-interval '9 days',repeat('1',64),repeat('2',64),'{}'::jsonb,now()-interval '9 days');

UPDATE bookings SET scope_snapshot='{"cleaningType":"deep-clean","requiredServices":["deep-clean"],"tasks":[{"roomName":"Kitchen","description":"Clean worktops"}],"requestedStartAt":"2026-08-01T09:00:00Z","requestedEndAt":"2026-08-01T12:00:00Z","specialInstructions":"Use the side door"}'::jsonb WHERE id='42000000-0000-4000-8000-000000000002';
COMMIT;
