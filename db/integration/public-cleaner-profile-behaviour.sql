\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

SELECT set_config('app.user_id', '10000000-0000-4000-8000-000000000001', true);
SELECT set_config('app.user_roles', 'landlord', true);

DO $public_cleaner_profile$
DECLARE
  selected_profile jsonb;
BEGIN
  SELECT to_jsonb(profile)
  INTO selected_profile
  FROM tideway_private.get_public_cleaner_profile('10000000-0000-4000-8000-000000000002') profile;

  IF selected_profile IS NULL THEN
    RAISE EXCEPTION 'Landlord cannot open an active, complete and public Cleaner profile';
  END IF;
  IF selected_profile->>'cleaner_id' <> '10000000-0000-4000-8000-000000000002'
     OR selected_profile->>'display_name' <> 'Integration Cleaner'
     OR selected_profile->>'public_slug' <> 'integration-cleaner-test'
     OR selected_profile->>'profile_completion_percent' <> '100'
     OR selected_profile->>'current_availability_status' <> 'available' THEN
    RAISE EXCEPTION 'Public Cleaner lookup returned the wrong Cleaner or incomplete public profile evidence';
  END IF;
  IF jsonb_array_length(selected_profile->'services') <> 1
     OR selected_profile->'services'->0->>'serviceCode' <> 'standard-clean'
     OR selected_profile->'services'->0->>'pricePence' <> '2500' THEN
    RAISE EXCEPTION 'Public Cleaner lookup omitted the active service and public price';
  END IF;
  IF selected_profile ?| ARRAY[
    'email', 'phone', 'address', 'home_address', 'provider_subject',
    'acceptance_rate', 'latitude', 'longitude'
  ] THEN
    RAISE EXCEPTION 'Public Cleaner lookup exposed private account, contact, precise location or operational data';
  END IF;
  IF (SELECT count(*) FROM tideway_private.get_public_cleaner_profile('10000000-0000-4000-8000-000000000003')) <> 0 THEN
    RAISE EXCEPTION 'Public Cleaner lookup returned an account without a public Cleaner profile';
  END IF;
END
$public_cleaner_profile$;

DO $public_cleaner_distance_fallback$
DECLARE
  matched_cleaners uuid[];
BEGIN
  SELECT COALESCE(array_agg(result.cleaner_id), ARRAY[]::uuid[])
  INTO matched_cleaners
  FROM tideway_private.search_cleaner_directory(
    'SW1A', 'standard-clean', NULL, NULL, NULL, NULL, false,
    51.501, -0.142, 25, 20, 0
  ) result;

  IF NOT ('10000000-0000-4000-8000-000000000002'::uuid = ANY(matched_cleaners)) THEN
    RAISE EXCEPTION 'Exact declared outward coverage disappeared while a legacy Cleaner service area awaited coordinates';
  END IF;
END
$public_cleaner_distance_fallback$;

ROLLBACK;
