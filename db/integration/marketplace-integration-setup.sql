\set ON_ERROR_STOP on

BEGIN;

INSERT INTO users (id, email, email_verified_at, display_name, selected_role) VALUES
  ('10000000-0000-4000-8000-000000000001', 'integration-landlord@invalid.example', now(), 'Integration Landlord', 'landlord'),
  ('10000000-0000-4000-8000-000000000002', 'integration-cleaner@invalid.example', now(), 'Integration Cleaner', 'cleaner'),
  ('10000000-0000-4000-8000-000000000003', 'integration-outsider@invalid.example', now(), 'Integration Outsider', 'landlord');

INSERT INTO user_roles (user_id, role) VALUES
  ('10000000-0000-4000-8000-000000000001', 'landlord'),
  ('10000000-0000-4000-8000-000000000002', 'cleaner'),
  ('10000000-0000-4000-8000-000000000003', 'landlord');

INSERT INTO landlord_profiles (user_id, organisation_name) VALUES
  ('10000000-0000-4000-8000-000000000001', 'Integration Test Only');

INSERT INTO cleaner_profiles (
  user_id, public_slug, biography, hourly_rate_pence, travel_radius_km, years_experience,
  languages, equipment_supplied, products_supplied, profile_completion_percent,
  current_availability_status, is_public
) VALUES (
  '10000000-0000-4000-8000-000000000002', 'integration-cleaner-test', 'Non-public integration fixture.',
  2500, 10, 1, ARRAY['English'], ARRAY['Vacuum'], ARRAY['General cleaner'], 100, 'available', true
);

INSERT INTO cleaner_services (cleaner_user_id, service_code, pricing_model, price_pence)
VALUES ('10000000-0000-4000-8000-000000000002', 'standard-clean', 'hourly', 2500);

INSERT INTO cleaner_service_areas (cleaner_user_id, outward_postcode)
VALUES ('10000000-0000-4000-8000-000000000002', 'SW1A');

INSERT INTO cleaner_availability (cleaner_user_id, starts_at, ends_at, status)
VALUES ('10000000-0000-4000-8000-000000000002', now() + interval '47 hours', now() + interval '55 hours', 'available');

INSERT INTO properties (id, landlord_user_id, name, address_line_1, locality, postcode, property_type, access_instructions_ciphertext) VALUES
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Integration Property A', 'Private test address A', 'London', 'SW1A 1AA', 'flat', decode('010203', 'hex')),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Integration Property B', 'Private test address B', 'London', 'SW1A 1AA', 'flat', decode('040506', 'hex'));

INSERT INTO cleaning_requests (
  id, landlord_user_id, property_id, status, requested_start_at, requested_end_at,
  cleaning_type, required_services, budget_pence, scope_fingerprint, submitted_at
) VALUES
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'searching-for-cleaner', now() + interval '48 hours', now() + interval '50 hours', 'standard', ARRAY['standard-clean'], 10000, repeat('a', 64), now()),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'searching-for-cleaner', now() + interval '48 hours 30 minutes', now() + interval '50 hours 30 minutes', 'standard', ARRAY['standard-clean'], 10000, repeat('b', 64), now());

INSERT INTO cleaning_request_tasks (cleaning_request_id, room_name, description, sort_order) VALUES
  ('30000000-0000-4000-8000-000000000001', 'Kitchen', 'Clean worktops', 0),
  ('30000000-0000-4000-8000-000000000002', 'Bathroom', 'Clean shower', 0);

SELECT set_config('app.user_id', '10000000-0000-4000-8000-000000000001', true);
SELECT set_config('app.user_roles', 'landlord', true);

SELECT id FROM tideway_private.invite_cleaner(
  '40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002', now() + interval '24 hours',
  8000, 5000, 500, 300, 200, 100, 100, 1000
);
-- Use the migration-owner-only superseded function for the second invitation to create a
-- legacy/race fixture. The runtime role cannot call it, while the final exclusion constraint
-- must still prevent both overlapping invitations from being accepted.
SELECT id FROM tideway_private.invite_cleaner_before_eligibility_hardening(
  '40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000002', now() + interval '24 hours',
  8000, 5000, 500, 300, 200, 100, 100, 1000
);

COMMIT;
