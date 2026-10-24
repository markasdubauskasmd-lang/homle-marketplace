\set ON_ERROR_STOP on
-- Seed the live-shaped 116 schema with the records the launch-work migrations
-- (118 to 134) must carry across: a rate-limit row in every scope the live
-- CHECK constraint accepts, and a confirmed future booking made before
-- cancellation existed. Runs after payment-observations-upgrade-seed.sql in
-- the same dedicated disposable database, and commits, because the point is
-- that the rows exist when the later migrations are applied.
DO $disposable_target$
BEGIN
 IF current_database()<>'ci_tideway_upgrade' THEN
   RAISE EXCEPTION 'Launch-work upgrade fixture requires its dedicated disposable CI database';
 END IF;
 IF to_regprocedure('tideway_private.claim_request_photo_terminal_cleanup(integer)') IS NULL
   OR to_regprocedure('tideway_private.cancel_booking_as_landlord(uuid,text)') IS NOT NULL THEN
   RAISE EXCEPTION 'Launch-work upgrade seed requires the actual116 schema';
 END IF;
END;
$disposable_target$;
BEGIN;
CREATE TABLE public.launch_upgrade_fixture(kind text PRIMARY KEY, evidence text NOT NULL);
INSERT INTO tideway_private.request_rate_limits(scope,key_hash,window_started_at,request_count,updated_at)
SELECT allowed.scope, decode(md5(allowed.scope)||md5(allowed.scope),'hex'), now(), 1, now()
FROM (
  SELECT DISTINCT (regexp_matches(pg_get_constraintdef(oid), '''([^'']+)''', 'g'))[1] AS scope
  FROM pg_constraint
  WHERE conname='request_rate_limits_scope_check' AND conrelid='tideway_private.request_rate_limits'::regclass
) allowed;
INSERT INTO launch_upgrade_fixture
SELECT 'rate-limit-rows', count(*)::text FROM tideway_private.request_rate_limits;

DO $seed$
DECLARE landlord_id uuid; cleaner_id uuid; property_id uuid; request_id uuid; booking_id uuid;
BEGIN
  INSERT INTO users (email, display_name, account_status)
    VALUES ('upgrade-landlord@verification.invalid', 'Upgrade Landlord', 'active') RETURNING id INTO landlord_id;
  INSERT INTO users (email, display_name, account_status)
    VALUES ('upgrade-cleaner@verification.invalid', 'Upgrade Cleaner', 'active') RETURNING id INTO cleaner_id;
  INSERT INTO user_roles (user_id, role) VALUES (landlord_id, 'landlord'), (cleaner_id, 'cleaner');
  INSERT INTO landlord_profiles (user_id) VALUES (landlord_id);
  INSERT INTO cleaner_profiles (user_id, public_slug) VALUES (cleaner_id, 'upgrade-cleaner');
  INSERT INTO properties (landlord_user_id, name, property_type, postcode, address_line_1, locality)
    VALUES (landlord_id, 'Upgrade Property', 'house', 'SM4 4LE', '1 Upgrade Road', 'Morden')
    RETURNING id INTO property_id;
  INSERT INTO cleaning_requests (landlord_user_id, property_id, status, cleaning_type, scope_fingerprint,
      requested_start_at, requested_end_at,
      submission_review_version, customer_scope_confirmed_at, scan_fingerprint, submitted_at)
    VALUES (landlord_id, property_id, 'matched', 'regular-domestic', repeat('a', 64),
      now() + interval '10 days', now() + interval '10 days 3 hours',
      1, now(), repeat('c', 64), now())
    RETURNING id INTO request_id;
  INSERT INTO bookings (cleaning_request_id, landlord_user_id, cleaner_user_id, property_id, status,
      scheduled_start_at, scheduled_end_at, customer_price_pence, cleaner_pay_pence,
      invited_at, cleaner_response_deadline, scope_fingerprint, terms_fingerprint, scope_snapshot)
    VALUES (request_id, landlord_id, cleaner_id, property_id, 'confirmed',
      now() + interval '10 days', now() + interval '10 days 3 hours', 9000, 6000,
      now(), now() + interval '2 hours', repeat('a', 64), repeat('b', 64), '{}'::jsonb)
    RETURNING id INTO booking_id;
  INSERT INTO launch_upgrade_fixture VALUES ('landlord', landlord_id::text), ('booking', booking_id::text), ('request', request_id::text);
END;
$seed$;
COMMIT;
\echo 'Launch-work upgrade seed committed on the actual116 schema.'
