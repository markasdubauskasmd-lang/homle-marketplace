BEGIN;

-- A verified person may need both sides of the marketplace (for example, a
-- Cleaner who also books a clean for their own property).  Keep the first-role
-- onboarding immutable and expose a separate, explicit account-owned action
-- for adding or selecting a workspace.  Administrator accounts stay isolated.
CREATE FUNCTION tideway_private.activate_my_workspace(chosen_role user_role)
RETURNS TABLE (
  selected_role user_role,
  roles user_role[],
  profile_created boolean,
  workspace_added boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict error
DECLARE
  account_id uuid:=tideway_private.current_user_id();
  existing_selected_role user_role;
  current_account_status text;
  current_email_verified_at timestamptz;
  account_avatar text;
  already_has_workspace boolean:=false;
  created_profile boolean:=false;
  affected_rows integer:=0;
BEGIN
  IF account_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='account-required';
  END IF;
  IF chosen_role IS NULL OR chosen_role NOT IN ('cleaner','landlord') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='workspace-role-invalid';
  END IF;

  SELECT account.selected_role,account.account_status,account.email_verified_at,account.avatar_url
    INTO existing_selected_role,current_account_status,current_email_verified_at,account_avatar
  FROM users account WHERE account.id=account_id FOR UPDATE;
  IF NOT FOUND OR current_account_status<>'active' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='account-inactive';
  END IF;
  IF current_email_verified_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='verified-account-required';
  END IF;
  IF tideway_private.has_role('administrator') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='administrator-workspace-isolated';
  END IF;

  SELECT EXISTS(SELECT 1 FROM user_roles membership WHERE membership.user_id=account_id AND membership.role=chosen_role)
    INTO already_has_workspace;
  INSERT INTO user_roles(user_id,role) VALUES(account_id,chosen_role)
    ON CONFLICT ON CONSTRAINT user_roles_pkey DO NOTHING;

  IF chosen_role='cleaner' THEN
    INSERT INTO cleaner_profiles(user_id,public_slug,profile_photo_url)
    VALUES(account_id,('cleaner-'||left(replace(account_id::text,'-',''),12))::citext,account_avatar)
    ON CONFLICT ON CONSTRAINT cleaner_profiles_pkey DO NOTHING;
    GET DIAGNOSTICS affected_rows=ROW_COUNT;
  ELSE
    INSERT INTO landlord_profiles(user_id) VALUES(account_id)
    ON CONFLICT ON CONSTRAINT landlord_profiles_pkey DO NOTHING;
    GET DIAGNOSTICS affected_rows=ROW_COUNT;
  END IF;
  created_profile:=affected_rows=1;

  UPDATE users account SET selected_role=chosen_role,updated_at=now() WHERE account.id=account_id;

  IF NOT already_has_workspace THEN
    INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
    VALUES(account_id,'account.workspace.added','user',account_id::text,jsonb_build_object('role',chosen_role));
  ELSIF existing_selected_role IS DISTINCT FROM chosen_role THEN
    INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
    VALUES(account_id,'account.workspace.selected','user',account_id::text,jsonb_build_object('role',chosen_role));
  END IF;

  RETURN QUERY SELECT account.selected_role,
    COALESCE((SELECT array_agg(membership.role ORDER BY membership.role) FROM user_roles membership WHERE membership.user_id=account.id),'{}'::user_role[]),
    created_profile,
    NOT already_has_workspace
  FROM users account WHERE account.id=account_id;
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.activate_my_workspace(user_role) FROM PUBLIC;

-- Multi-workspace accounts must never appear as their own counterparty.  The
-- table constraint protects every current and future invitation path.
ALTER TABLE bookings ADD CONSTRAINT bookings_distinct_participants
  CHECK (landlord_user_id<>cleaner_user_id);

COMMIT;
