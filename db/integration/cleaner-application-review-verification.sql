-- Execute the Administrator's read of a Cleaner application.
--
-- Migration 128 widens access to somebody's identity documents, narrowly and
-- deliberately. The conditions that make that acceptable -- Administrator
-- only, submitted applications only, and an audit row for every read -- are
-- enforced inside the function, so they are asserted here by running it rather
-- than by reading it.
--
-- Written for a disposable database with every migration applied. Creates its
-- own fixtures and rolls back.

BEGIN;

DO $$
DECLARE
  administrator_id uuid;
  cleaner_id uuid;
  outsider_id uuid;
  application jsonb;
  audit_count integer;
BEGIN
  INSERT INTO users (email, display_name, account_status)
    VALUES ('application-admin@verification.invalid', 'Verification Administrator', 'active') RETURNING id INTO administrator_id;
  INSERT INTO users (email, display_name, account_status)
    VALUES ('application-cleaner@verification.invalid', 'Verification Cleaner', 'active') RETURNING id INTO cleaner_id;
  INSERT INTO users (email, display_name, account_status)
    VALUES ('application-outsider@verification.invalid', 'Verification Outsider', 'active') RETURNING id INTO outsider_id;
  INSERT INTO user_roles (user_id, role)
    VALUES (administrator_id, 'administrator'), (cleaner_id, 'cleaner'), (outsider_id, 'landlord');
  INSERT INTO cleaner_profiles (user_id, public_slug) VALUES (cleaner_id, 'verification-applicant');

  PERFORM set_config('app.user_id', administrator_id::text, true);
  PERFORM set_config('app.user_roles', 'administrator', true);

  -- An application nobody has submitted is not under review, and nobody needs
  -- to read a half-typed passport number.
  BEGIN
    PERFORM tideway_private.get_cleaner_application_for_administrator(cleaner_id);
    RAISE EXCEPTION 'a draft Cleaner application was readable';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'cleaner-application-not-submitted' THEN RAISE; END IF;
  END;

  INSERT INTO cleaner_onboarding_sections (cleaner_user_id, section_code, payload_ciphertext, status, schema_version, completed_at)
    VALUES (cleaner_id, 'review', repeat('x', 40)::bytea, 'submitted', 1, now()),
           (cleaner_id, 'identity', repeat('y', 40)::bytea, 'submitted', 1, now());

  application := tideway_private.get_cleaner_application_for_administrator(cleaner_id);
  IF jsonb_array_length(application->'sections') <> 2 THEN
    RAISE EXCEPTION 'the submitted application did not return its sections';
  END IF;
  -- The ciphertext is handed back unread. The key lives in the application, so
  -- this function cannot see what it returns and a database backup is not a
  -- pile of identity documents.
  IF application->'sections'->0->>'payloadCiphertext' IS NULL THEN
    RAISE EXCEPTION 'the application sections carry no payload';
  END IF;

  SELECT count(*) INTO audit_count FROM audit_logs
    WHERE action = 'cleaner-application-read' AND resource_id = cleaner_id::text AND actor_user_id = administrator_id;
  IF audit_count <> 1 THEN
    RAISE EXCEPTION 'reading a Cleaner application was not audited (% rows)', audit_count;
  END IF;

  -- A second look is a second event. Collapsing them would make the trail
  -- describe repeated curiosity as a single visit.
  PERFORM tideway_private.get_cleaner_application_for_administrator(cleaner_id);
  SELECT count(*) INTO audit_count FROM audit_logs
    WHERE action = 'cleaner-application-read' AND resource_id = cleaner_id::text AND actor_user_id = administrator_id;
  IF audit_count <> 2 THEN
    RAISE EXCEPTION 'a repeated application read was not recorded as a second event (% rows)', audit_count;
  END IF;

  -- Everyone else, including the Cleaner themselves through this path.
  PERFORM set_config('app.user_id', outsider_id::text, true);
  PERFORM set_config('app.user_roles', 'landlord', true);
  BEGIN
    PERFORM tideway_private.get_cleaner_application_for_administrator(cleaner_id);
    RAISE EXCEPTION 'a Landlord read a Cleaner application';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM set_config('app.user_id', cleaner_id::text, true);
  PERFORM set_config('app.user_roles', 'cleaner', true);
  BEGIN
    PERFORM tideway_private.get_cleaner_application_for_administrator(cleaner_id);
    RAISE EXCEPTION 'a Cleaner reached the Administrator application path';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM set_config('app.user_id', administrator_id::text, true);
  PERFORM set_config('app.user_roles', 'administrator', true);
  BEGIN
    PERFORM tideway_private.get_cleaner_application_for_administrator(gen_random_uuid());
    RAISE EXCEPTION 'an unknown Cleaner reported an application';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;

  RAISE NOTICE 'Cleaner application review verification passed: drafts refused, submitted applications returned as ciphertext, every read audited separately, and non-Administrators denied.';
END $$;

ROLLBACK;
