BEGIN;

-- RETURNS TABLE exposes user_id as a PL/pgSQL variable.  The original
-- ON CONFLICT (user_id) clauses were therefore ambiguous at runtime for both
-- Cleaner and Landlord onboarding.  Name the primary-key constraints
-- explicitly and keep table-column references qualified.
CREATE OR REPLACE FUNCTION tideway_private.complete_role_onboarding(chosen_role user_role)
RETURNS TABLE (
  user_id uuid,
  selected_role user_role,
  roles user_role[],
  profile_created boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict error
DECLARE
  account_id uuid := tideway_private.current_user_id();
  existing_role user_role;
  current_account_status text;
  account_avatar text;
  created_profile boolean := false;
  affected_rows integer := 0;
BEGIN
  IF account_id IS NULL THEN
    RAISE EXCEPTION 'An authenticated account is required';
  END IF;
  IF chosen_role IS NULL OR chosen_role NOT IN ('cleaner', 'landlord') THEN
    RAISE EXCEPTION 'Only Cleaner or Landlord may be selected during onboarding';
  END IF;

  SELECT u.selected_role, u.account_status, u.avatar_url
  INTO existing_role, current_account_status, account_avatar
  FROM users AS u
  WHERE u.id = account_id
  FOR UPDATE;
  IF NOT FOUND OR current_account_status <> 'active' THEN
    RAISE EXCEPTION 'The authenticated account is not active';
  END IF;
  IF existing_role IS NOT NULL AND existing_role <> chosen_role THEN
    RAISE EXCEPTION 'Changing account role requires an administrator-reviewed workflow';
  END IF;

  UPDATE users AS u
  SET selected_role = chosen_role, updated_at = now()
  WHERE u.id = account_id;

  INSERT INTO user_roles (user_id, role)
  VALUES (account_id, chosen_role)
  ON CONFLICT ON CONSTRAINT user_roles_pkey DO NOTHING;

  IF chosen_role = 'cleaner' THEN
    INSERT INTO cleaner_profiles (user_id, public_slug, profile_photo_url)
    VALUES (account_id, ('cleaner-' || left(replace(account_id::text, '-', ''), 12))::citext, account_avatar)
    ON CONFLICT ON CONSTRAINT cleaner_profiles_pkey DO NOTHING;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    created_profile := affected_rows = 1;
  ELSE
    INSERT INTO landlord_profiles (user_id)
    VALUES (account_id)
    ON CONFLICT ON CONSTRAINT landlord_profiles_pkey DO NOTHING;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    created_profile := affected_rows = 1;
  END IF;

  IF existing_role IS NULL THEN
    INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
    VALUES (account_id, 'account.role.selected', 'user', account_id::text, jsonb_build_object('role', chosen_role));
  END IF;

  RETURN QUERY
    SELECT u.id, u.selected_role,
           COALESCE((SELECT array_agg(ur.role ORDER BY ur.role) FROM user_roles AS ur WHERE ur.user_id = u.id), '{}'::user_role[]),
           created_profile
    FROM users AS u
    WHERE u.id = account_id;
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.complete_role_onboarding(user_role) FROM PUBLIC;

COMMIT;
