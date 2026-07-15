BEGIN;

CREATE FUNCTION tideway_private.resolve_social_identity(
  asserted_provider authentication_provider,
  asserted_subject text,
  asserted_email citext,
  asserted_email_verified boolean,
  asserted_display_name text,
  asserted_avatar_url text,
  asserted_profile jsonb
)
RETURNS TABLE (
  user_id uuid,
  email citext,
  email_verified_at timestamptz,
  display_name text,
  avatar_url text,
  selected_role user_role,
  roles user_role[],
  account_created boolean,
  identity_created boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  normalized_email citext;
  safe_name text;
  safe_avatar text;
  resolved_user_id uuid;
  resolved_status text;
  created_user boolean := false;
BEGIN
  IF asserted_provider IS NULL OR asserted_provider NOT IN ('google', 'apple', 'facebook') THEN
    RAISE EXCEPTION 'Only supported social identity providers can use this function';
  END IF;
  IF asserted_email_verified IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'A provider-verified email is required';
  END IF;
  IF asserted_subject IS NULL OR char_length(asserted_subject) NOT BETWEEN 1 AND 255 THEN
    RAISE EXCEPTION 'A bounded provider subject is required';
  END IF;

  normalized_email := lower(btrim(asserted_email::text))::citext;
  IF normalized_email IS NULL OR char_length(normalized_email::text) > 254 OR position('@' IN normalized_email::text) <= 1 THEN
    RAISE EXCEPTION 'A valid provider email is required';
  END IF;
  safe_name := left(COALESCE(NULLIF(btrim(asserted_display_name), ''), split_part(normalized_email::text, '@', 1)), 120);
  safe_avatar := CASE WHEN asserted_avatar_url ~ '^https://' AND char_length(asserted_avatar_url) <= 2048 THEN asserted_avatar_url ELSE NULL END;
  IF asserted_profile IS NOT NULL AND (jsonb_typeof(asserted_profile) <> 'object' OR octet_length(asserted_profile::text) > 4096) THEN
    RAISE EXCEPTION 'Provider profile snapshot must be a small JSON object';
  END IF;

  -- These locks make verified-email linking and provider-subject creation deterministic
  -- even when two first-login callbacks arrive together.
  PERFORM pg_advisory_xact_lock(hashtextextended(asserted_provider::text || ':' || asserted_subject, 1));
  PERFORM pg_advisory_xact_lock(hashtextextended(normalized_email::text, 2));

  SELECT ai.user_id INTO resolved_user_id
  FROM authentication_identities ai
  WHERE ai.provider = asserted_provider AND ai.provider_subject = asserted_subject
  FOR UPDATE;

  IF resolved_user_id IS NOT NULL THEN
    SELECT u.account_status INTO resolved_status FROM users u WHERE u.id = resolved_user_id FOR UPDATE;
    IF resolved_status <> 'active' THEN
      RAISE EXCEPTION 'This account is not active';
    END IF;
    UPDATE authentication_identities
    SET provider_email = normalized_email,
        provider_email_verified = true,
        profile_snapshot = COALESCE(asserted_profile, '{}'::jsonb),
        last_used_at = now()
    WHERE provider = asserted_provider AND provider_subject = asserted_subject;
    UPDATE users
    SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now()
    WHERE id = resolved_user_id AND email = normalized_email;
    UPDATE authentication_identities
    SET provider_email_verified = true
    WHERE user_id = resolved_user_id AND provider = 'password' AND provider_email = normalized_email;
    RETURN QUERY
      SELECT u.id, u.email, u.email_verified_at, u.display_name, u.avatar_url, u.selected_role,
             COALESCE((SELECT array_agg(ur.role ORDER BY ur.role) FROM user_roles ur WHERE ur.user_id = u.id), '{}'::user_role[]),
             false, false
      FROM users u WHERE u.id = resolved_user_id;
    RETURN;
  END IF;

  SELECT u.id, u.account_status INTO resolved_user_id, resolved_status
  FROM users u WHERE u.email = normalized_email FOR UPDATE;

  IF resolved_user_id IS NULL THEN
    INSERT INTO users (email, email_verified_at, display_name, avatar_url)
    VALUES (normalized_email, now(), safe_name, safe_avatar)
    RETURNING id INTO resolved_user_id;
    created_user := true;
    INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
    VALUES (resolved_user_id, 'account.created.social', 'user', resolved_user_id::text, jsonb_build_object('provider', asserted_provider));
  ELSE
    IF resolved_status <> 'active' THEN
      RAISE EXCEPTION 'An account with this verified email is not active';
    END IF;
    UPDATE users
    SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now()
    WHERE id = resolved_user_id;
    UPDATE authentication_identities
    SET provider_email_verified = true
    WHERE user_id = resolved_user_id AND provider = 'password' AND provider_email = normalized_email;
  END IF;

  INSERT INTO authentication_identities (
    user_id, provider, provider_subject, provider_email, provider_email_verified,
    profile_snapshot, last_used_at
  ) VALUES (
    resolved_user_id, asserted_provider, asserted_subject, normalized_email, true,
    COALESCE(asserted_profile, '{}'::jsonb), now()
  );

  INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
  VALUES (resolved_user_id, 'authentication.identity.connected', 'user', resolved_user_id::text,
          jsonb_build_object('provider', asserted_provider, 'new_account', created_user));

  RETURN QUERY
    SELECT u.id, u.email, u.email_verified_at, u.display_name, u.avatar_url, u.selected_role,
           COALESCE((SELECT array_agg(ur.role ORDER BY ur.role) FROM user_roles ur WHERE ur.user_id = u.id), '{}'::user_role[]),
           created_user, true
    FROM users u WHERE u.id = resolved_user_id;
END;
$$;

CREATE FUNCTION tideway_private.complete_role_onboarding(chosen_role user_role)
RETURNS TABLE (
  user_id uuid,
  selected_role user_role,
  roles user_role[],
  profile_created boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  account_id uuid := tideway_private.current_user_id();
  existing_role user_role;
  account_status text;
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
  INTO existing_role, account_status, account_avatar
  FROM users u WHERE u.id = account_id FOR UPDATE;
  IF NOT FOUND OR account_status <> 'active' THEN
    RAISE EXCEPTION 'The authenticated account is not active';
  END IF;
  IF existing_role IS NOT NULL AND existing_role <> chosen_role THEN
    RAISE EXCEPTION 'Changing account role requires an administrator-reviewed workflow';
  END IF;

  UPDATE users SET selected_role = chosen_role, updated_at = now() WHERE id = account_id;
  INSERT INTO user_roles (user_id, role) VALUES (account_id, chosen_role) ON CONFLICT DO NOTHING;

  IF chosen_role = 'cleaner' THEN
    INSERT INTO cleaner_profiles (user_id, public_slug, profile_photo_url)
    VALUES (account_id, ('cleaner-' || left(replace(account_id::text, '-', ''), 12))::citext, account_avatar)
    ON CONFLICT (user_id) DO NOTHING;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    created_profile := affected_rows = 1;
  ELSE
    INSERT INTO landlord_profiles (user_id) VALUES (account_id) ON CONFLICT (user_id) DO NOTHING;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    created_profile := affected_rows = 1;
  END IF;

  IF existing_role IS NULL THEN
    INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
    VALUES (account_id, 'account.role.selected', 'user', account_id::text, jsonb_build_object('role', chosen_role));
  END IF;

  RETURN QUERY
    SELECT u.id, u.selected_role,
           COALESCE((SELECT array_agg(ur.role ORDER BY ur.role) FROM user_roles ur WHERE ur.user_id = u.id), '{}'::user_role[]),
           created_profile
    FROM users u WHERE u.id = account_id;
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.resolve_social_identity(authentication_provider, text, citext, boolean, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.complete_role_onboarding(user_role) FROM PUBLIC;

COMMIT;
