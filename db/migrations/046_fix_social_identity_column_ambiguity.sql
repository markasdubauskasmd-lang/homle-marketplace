BEGIN;

-- PostgreSQL exposes RETURNS TABLE column names as PL/pgSQL variables.  The
-- original function therefore made an unqualified `email` reference
-- ambiguous when an existing Google identity signed in again.  Keep every
-- table-column reference qualified so both first sign-in and returning
-- sign-in follow the same safe, transactional path.
CREATE OR REPLACE FUNCTION tideway_private.resolve_social_identity(
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
#variable_conflict error
DECLARE
  normalized_email citext;
  safe_name text;
  safe_avatar text;
  resolved_user_id uuid;
  resolved_status text;
  resolved_email_verified_at timestamptz;
  resolved_has_password_identity boolean := false;
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

  PERFORM pg_advisory_xact_lock(hashtextextended(asserted_provider::text || ':' || asserted_subject, 1));
  PERFORM pg_advisory_xact_lock(hashtextextended(normalized_email::text, 2));

  SELECT ai.user_id INTO resolved_user_id
  FROM authentication_identities AS ai
  WHERE ai.provider = asserted_provider AND ai.provider_subject = asserted_subject
  FOR UPDATE;

  IF resolved_user_id IS NOT NULL THEN
    SELECT u.account_status INTO resolved_status
    FROM users AS u
    WHERE u.id = resolved_user_id
    FOR UPDATE;
    IF resolved_status <> 'active' THEN
      RAISE EXCEPTION 'This account is not active';
    END IF;

    UPDATE authentication_identities AS ai
    SET provider_email = normalized_email,
        provider_email_verified = true,
        profile_snapshot = COALESCE(asserted_profile, '{}'::jsonb),
        last_used_at = now()
    WHERE ai.provider = asserted_provider AND ai.provider_subject = asserted_subject;

    UPDATE users AS u
    SET email_verified_at = COALESCE(u.email_verified_at, now()),
        updated_at = now()
    WHERE u.id = resolved_user_id AND u.email = normalized_email;

    UPDATE authentication_identities AS ai
    SET provider_email_verified = true
    WHERE ai.user_id = resolved_user_id
      AND ai.provider = 'password'
      AND ai.provider_email = normalized_email;

    RETURN QUERY
      SELECT u.id, u.email, u.email_verified_at, u.display_name, u.avatar_url, u.selected_role,
             COALESCE((SELECT array_agg(ur.role ORDER BY ur.role) FROM user_roles AS ur WHERE ur.user_id = u.id), '{}'::user_role[]),
             false, false
      FROM users AS u
      WHERE u.id = resolved_user_id;
    RETURN;
  END IF;

  SELECT u.id, u.account_status, u.email_verified_at
  INTO resolved_user_id, resolved_status, resolved_email_verified_at
  FROM users AS u
  WHERE u.email = normalized_email
  FOR UPDATE;

  IF resolved_user_id IS NULL THEN
    INSERT INTO users (email, email_verified_at, display_name, avatar_url)
    VALUES (normalized_email, now(), safe_name, safe_avatar)
    RETURNING users.id INTO resolved_user_id;
    created_user := true;

    INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
    VALUES (resolved_user_id, 'account.created.social', 'user', resolved_user_id::text, jsonb_build_object('provider', asserted_provider));
  ELSE
    IF resolved_status <> 'active' THEN
      RAISE EXCEPTION 'An account with this verified email is not active';
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM authentication_identities AS ai
      WHERE ai.user_id = resolved_user_id AND ai.provider = 'password'
    ) INTO resolved_has_password_identity;

    IF resolved_email_verified_at IS NULL OR resolved_has_password_identity THEN
      RAISE EXCEPTION 'Sign in to the existing account and connect this social provider from authenticated settings';
    END IF;

    UPDATE users AS u
    SET updated_at = now()
    WHERE u.id = resolved_user_id;

    UPDATE authentication_identities AS ai
    SET provider_email_verified = true
    WHERE ai.user_id = resolved_user_id
      AND ai.provider = 'password'
      AND ai.provider_email = normalized_email;
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
           COALESCE((SELECT array_agg(ur.role ORDER BY ur.role) FROM user_roles AS ur WHERE ur.user_id = u.id), '{}'::user_role[]),
           created_user, true
    FROM users AS u
    WHERE u.id = resolved_user_id;
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.resolve_social_identity(authentication_provider, text, citext, boolean, text, text, jsonb) FROM PUBLIC;

COMMIT;
