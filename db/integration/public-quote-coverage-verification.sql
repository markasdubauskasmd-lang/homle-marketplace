-- Execute the public pricing, coverage and launch-interest functions
-- (migration 137) with no signed-in user, against real fixtures. Owner-run,
-- self-contained, rolls back.

BEGIN;

DO $$
DECLARE
  cleaner_id uuid; inactive_id uuid; answer jsonb; refused boolean; stored integer;
BEGIN
  PERFORM set_config('app.user_id', '', true);
  PERFORM set_config('app.user_roles', '', true);

  -- The runtime role may call each of these; nobody else may.
  IF NOT has_function_privilege('tideway_app', 'tideway_private.get_public_pricing_config(text)', 'EXECUTE')
    OR NOT has_function_privilege('tideway_app', 'tideway_private.public_cleaner_coverage(text, boolean)', 'EXECUTE')
    OR NOT has_function_privilege('tideway_app', 'tideway_private.record_launch_interest(text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'The runtime cannot call the public pricing and coverage functions';
  END IF;
  IF has_function_privilege('tideway_worker', 'tideway_private.record_launch_interest(text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'The worker can write launch interest';
  END IF;

  -- No user is needed to read the customer price list (null means defaults).
  PERFORM tideway_private.get_public_pricing_config('default');
  PERFORM tideway_private.get_public_pricing_economics('default');

  /* ── Coverage: yes only for a Cleaner the matcher could actually use ── */
  INSERT INTO users (email, display_name, account_status) VALUES ('coverage-cleaner@verification.invalid', 'Coverage Cleaner', 'active') RETURNING id INTO cleaner_id;
  INSERT INTO users (email, display_name, account_status) VALUES ('coverage-inactive@verification.invalid', 'Suspended Cleaner', 'suspended') RETURNING id INTO inactive_id;
  INSERT INTO user_roles (user_id, role) VALUES (cleaner_id, 'cleaner'), (inactive_id, 'cleaner');
  INSERT INTO cleaner_profiles (user_id, public_slug) VALUES (cleaner_id, 'coverage-cleaner'), (inactive_id, 'coverage-inactive');
  UPDATE cleaner_profiles SET is_public = true, profile_completion_percent = 100, current_availability_status = 'available' WHERE user_id IN (cleaner_id, inactive_id);
  INSERT INTO cleaner_service_areas (cleaner_user_id, outward_postcode) VALUES (cleaner_id, 'ZE9'), (inactive_id, 'ZE8');
  INSERT INTO cleaner_availability (cleaner_user_id, starts_at, ends_at) VALUES (inactive_id, now() + interval '1 day', now() + interval '1 day 4 hours');

  answer := tideway_private.public_cleaner_coverage('ze9 1aa', false);
  IF answer->>'area' <> 'ZE9' OR (answer->>'covered')::boolean THEN
    RAISE EXCEPTION 'A Cleaner with no future availability was reported as coverage: %', answer;
  END IF;
  INSERT INTO cleaner_availability (cleaner_user_id, starts_at, ends_at) VALUES (cleaner_id, now() - interval '3 days', now() - interval '2 days');
  IF (tideway_private.public_cleaner_coverage('ZE9', false)->>'covered')::boolean THEN
    RAISE EXCEPTION 'Only past availability was reported as coverage';
  END IF;
  INSERT INTO cleaner_availability (cleaner_user_id, starts_at, ends_at) VALUES (cleaner_id, now() + interval '2 days', now() + interval '2 days 3 hours');
  answer := tideway_private.public_cleaner_coverage('ZE9 1AA', false);
  IF NOT (answer->>'covered')::boolean THEN RAISE EXCEPTION 'A bookable Cleaner was not reported as coverage: %', answer; END IF;
  IF answer ?| ARRAY['cleanerId','count','cleaners','name','latitude','longitude'] OR (SELECT count(*) FROM jsonb_object_keys(answer)) <> 2 THEN
    RAISE EXCEPTION 'Coverage disclosed more than a yes/no and the area: %', answer;
  END IF;
  -- Paid mode: a Cleaner who cannot be paid is not coverage.
  IF (tideway_private.public_cleaner_coverage('ZE9', true)->>'covered')::boolean THEN
    RAISE EXCEPTION 'A Cleaner who cannot be paid was reported as coverage while payments are on';
  END IF;
  INSERT INTO tideway_private.cleaner_payout_accounts (cleaner_user_id, provider, destination_account_id, details_submitted, payouts_enabled)
    VALUES (cleaner_id, 'stripe', 'acct_coverage_verification', true, true);
  IF NOT (tideway_private.public_cleaner_coverage('ZE9', true)->>'covered')::boolean THEN
    RAISE EXCEPTION 'A payable Cleaner was not reported as coverage while payments are on';
  END IF;
  -- Suspended, unpublished or excluded is not coverage either.
  IF (tideway_private.public_cleaner_coverage('ZE8', false)->>'covered')::boolean THEN
    RAISE EXCEPTION 'A suspended Cleaner was reported as coverage';
  END IF;
  UPDATE cleaner_profiles SET is_public = false WHERE user_id = cleaner_id;
  IF (tideway_private.public_cleaner_coverage('ZE9', false)->>'covered')::boolean THEN RAISE EXCEPTION 'An unpublished profile was reported as coverage'; END IF;
  UPDATE cleaner_profiles SET is_public = true WHERE user_id = cleaner_id;
  UPDATE cleaner_service_areas SET role = 'excluded' WHERE cleaner_user_id = cleaner_id;
  IF (tideway_private.public_cleaner_coverage('ZE9', false)->>'covered')::boolean THEN RAISE EXCEPTION 'An excluded area was reported as coverage'; END IF;

  refused := false;
  BEGIN PERFORM tideway_private.public_cleaner_coverage('not a postcode', false);
  EXCEPTION WHEN invalid_parameter_value THEN refused := true; END;
  IF NOT refused THEN RAISE EXCEPTION 'An invalid postcode was answered'; END IF;

  /* ── Launch interest: consent required, idempotent, nothing to enumerate ── */
  refused := false;
  BEGIN PERFORM tideway_private.record_launch_interest('ZE9 1AA', 'visitor@verification.invalid', NULL);
  EXCEPTION WHEN invalid_parameter_value THEN refused := true; END;
  IF NOT refused THEN RAISE EXCEPTION 'Launch interest was stored without consent'; END IF;
  refused := false;
  BEGIN PERFORM tideway_private.record_launch_interest('ZE9 1AA', 'not-an-email', 'launch-news-v1');
  EXCEPTION WHEN invalid_parameter_value THEN refused := true; END;
  IF NOT refused THEN RAISE EXCEPTION 'An invalid email was stored'; END IF;
  IF NOT tideway_private.record_launch_interest('ze9 1aa', ' Visitor@Verification.Invalid ', 'launch-news-v1')
    OR NOT tideway_private.record_launch_interest('ZE91AA', 'visitor@verification.invalid', 'launch-news-v1') THEN
    RAISE EXCEPTION 'Recording launch interest did not answer the same way twice';
  END IF;
  SELECT count(*) INTO stored FROM tideway_private.launch_interest WHERE email = 'visitor@verification.invalid' AND outward_postcode = 'ZE9';
  IF stored <> 1 THEN RAISE EXCEPTION 'A repeated sign-up was stored % times', stored; END IF;

  -- Only an Administrator sees the tally, and it carries no addresses.
  refused := false;
  BEGIN PERFORM tideway_private.get_administrator_launch_interest();
  EXCEPTION WHEN insufficient_privilege THEN refused := true; END;
  IF NOT refused THEN RAISE EXCEPTION 'The launch-interest tally was readable without an Administrator'; END IF;
  PERFORM set_config('app.user_id', cleaner_id::text, true);
  PERFORM set_config('app.user_roles', 'administrator', true);
  answer := tideway_private.get_administrator_launch_interest();
  IF answer::text LIKE '%@%' OR NOT answer @> '[{"area":"ZE9","count":1}]'::jsonb THEN
    RAISE EXCEPTION 'The launch-interest tally was wrong or disclosed an address: %', answer;
  END IF;

  RAISE NOTICE 'Public quote and coverage verification passed: anonymous price list, matcher-equivalent coverage that discloses only yes/no and the area, consented and idempotent launch interest, and an address-free Administrator tally.';
END $$;

ROLLBACK;
