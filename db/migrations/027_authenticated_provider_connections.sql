BEGIN;

CREATE FUNCTION tideway_private.list_my_authentication_identities()
RETURNS TABLE(
  provider authentication_provider,
  connected_at timestamptz,
  last_used_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
BEGIN
  IF actor_id IS NULL OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = actor_id AND u.account_status = 'active') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='authentication-required';
  END IF;
  RETURN QUERY
    SELECT ai.provider, ai.connected_at, ai.last_used_at
    FROM authentication_identities ai
    WHERE ai.user_id = actor_id
    ORDER BY CASE ai.provider WHEN 'password' THEN 0 WHEN 'google' THEN 1 WHEN 'facebook' THEN 2 ELSE 3 END, ai.connected_at;
END
$$;

CREATE FUNCTION tideway_private.connect_social_identity(
  asserted_provider authentication_provider,
  asserted_subject text,
  asserted_email citext,
  asserted_email_verified boolean,
  asserted_display_name text,
  asserted_avatar_url text,
  asserted_profile jsonb
)
RETURNS TABLE(
  provider authentication_provider,
  connected_at timestamptz,
  last_used_at timestamptz,
  already_connected boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  actor_status text;
  actor_verified_at timestamptz;
  normalized_email citext;
  safe_avatar text;
  subject_owner uuid;
  account_identity authentication_identities%ROWTYPE;
  inserted_identity authentication_identities%ROWTYPE;
BEGIN
  IF actor_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='authentication-required'; END IF;
  IF asserted_provider IS NULL OR asserted_provider NOT IN ('google','facebook') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='provider-connection-unsupported';
  END IF;
  IF asserted_subject IS NULL OR char_length(asserted_subject) NOT BETWEEN 1 AND 255 OR asserted_subject ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='provider-subject-invalid';
  END IF;
  IF asserted_profile IS NOT NULL AND (jsonb_typeof(asserted_profile) <> 'object' OR octet_length(asserted_profile::text) > 4096) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='provider-profile-invalid';
  END IF;
  IF char_length(COALESCE(asserted_display_name,'')) > 120 OR COALESCE(asserted_display_name,'') ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='provider-display-name-invalid';
  END IF;
  IF asserted_avatar_url IS NOT NULL AND (char_length(asserted_avatar_url) > 2048 OR asserted_avatar_url !~ '^https://') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='provider-avatar-invalid';
  END IF;
  normalized_email := NULLIF(lower(btrim(asserted_email::text)), '')::citext;
  IF normalized_email IS NOT NULL AND (char_length(normalized_email::text) > 254 OR position('@' IN normalized_email::text) <= 1) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='provider-email-invalid';
  END IF;
  IF asserted_provider = 'google' AND (normalized_email IS NULL OR asserted_email_verified IS DISTINCT FROM true) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='google-verified-email-required';
  END IF;
  safe_avatar := CASE WHEN asserted_avatar_url ~ '^https://' AND char_length(asserted_avatar_url) <= 2048 THEN asserted_avatar_url ELSE NULL END;

  SELECT u.account_status, u.email_verified_at INTO actor_status, actor_verified_at FROM users u WHERE u.id = actor_id FOR UPDATE;
  IF actor_status IS DISTINCT FROM 'active' OR actor_verified_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='active-verified-account-required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(asserted_provider::text || ':' || asserted_subject, 11));
  PERFORM pg_advisory_xact_lock(hashtextextended(actor_id::text || ':' || asserted_provider::text, 12));

  SELECT ai.user_id INTO subject_owner FROM authentication_identities ai
  WHERE ai.provider = asserted_provider AND ai.provider_subject = asserted_subject FOR UPDATE;
  IF subject_owner IS NOT NULL AND subject_owner <> actor_id THEN
    RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='provider-identity-already-connected';
  END IF;

  SELECT * INTO account_identity FROM authentication_identities ai
  WHERE ai.user_id = actor_id AND ai.provider = asserted_provider FOR UPDATE;
  IF account_identity.id IS NOT NULL THEN
    IF account_identity.provider_subject <> asserted_subject THEN
      RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='account-provider-already-connected';
    END IF;
    UPDATE authentication_identities ai SET last_used_at = now() WHERE ai.id = account_identity.id RETURNING * INTO inserted_identity;
    RETURN QUERY SELECT inserted_identity.provider, inserted_identity.connected_at, inserted_identity.last_used_at, true;
    RETURN;
  END IF;

  INSERT INTO authentication_identities(user_id, provider, provider_subject, provider_email, provider_email_verified, profile_snapshot, last_used_at)
  VALUES(actor_id, asserted_provider, asserted_subject, normalized_email, asserted_email_verified IS TRUE, COALESCE(asserted_profile, '{}'::jsonb) || jsonb_build_object('displayName', left(COALESCE(asserted_display_name,''),120), 'avatarUrl', safe_avatar), now())
  RETURNING * INTO inserted_identity;
  INSERT INTO audit_logs(actor_user_id, action, resource_type, resource_id, metadata)
  VALUES(actor_id, 'authentication-provider-connected', 'user', actor_id::text, jsonb_build_object('provider', asserted_provider, 'providerEmailVerified', asserted_email_verified IS TRUE));
  RETURN QUERY SELECT inserted_identity.provider, inserted_identity.connected_at, inserted_identity.last_used_at, false;
END
$$;

REVOKE ALL ON FUNCTION tideway_private.list_my_authentication_identities() FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.connect_social_identity(authentication_provider,text,citext,boolean,text,text,jsonb) FROM PUBLIC;

COMMIT;
