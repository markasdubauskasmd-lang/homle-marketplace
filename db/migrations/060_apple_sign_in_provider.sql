BEGIN;

ALTER TABLE tideway_private.request_rate_limits DROP CONSTRAINT request_rate_limits_scope_check;
ALTER TABLE tideway_private.request_rate_limits ADD CONSTRAINT request_rate_limits_scope_check CHECK (scope IN (
  'google-start','google-callback','apple-start','apple-callback','facebook-start','facebook-callback','facebook-verification-confirm',
  'facebook-data-deletion','facebook-data-deletion-status',
  'signup','verification-resend','verification-confirm','login','password-reset-request','password-reset-confirm',
  'marketplace-public:cleaner-directory','marketplace-public:cleaner-reviews'
));

CREATE OR REPLACE FUNCTION tideway_private.consume_rate_limit(selected_scope text, selected_key_hash bytea)
RETURNS TABLE(allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE maximum_requests integer; window_seconds integer; observed_count integer; observed_window timestamptz; observed_at timestamptz := clock_timestamp();
BEGIN
  IF selected_key_hash IS NULL OR octet_length(selected_key_hash) <> 32 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='rate-limit-key-invalid'; END IF;
  SELECT policy.maximum_requests, policy.window_seconds INTO maximum_requests, window_seconds FROM (VALUES
    ('google-start',20,900),('google-callback',30,900),('apple-start',20,900),('apple-callback',30,900),
    ('facebook-start',20,900),('facebook-callback',30,900),('facebook-verification-confirm',20,3600),
    ('facebook-data-deletion',20,3600),('facebook-data-deletion-status',120,3600),
    ('signup',5,3600),('verification-resend',5,3600),('verification-confirm',20,3600),('login',10,900),
    ('password-reset-request',5,3600),('password-reset-confirm',10,3600),
    ('marketplace-public:cleaner-directory',60,60),('marketplace-public:cleaner-reviews',120,60)
  ) AS policy(scope, maximum_requests, window_seconds) WHERE policy.scope = selected_scope;
  IF maximum_requests IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='rate-limit-scope-unsupported'; END IF;
  INSERT INTO tideway_private.request_rate_limits AS existing(scope,key_hash,window_started_at,request_count,updated_at)
  VALUES(selected_scope,selected_key_hash,observed_at,1,observed_at)
  ON CONFLICT(scope,key_hash) DO UPDATE SET
    window_started_at=CASE WHEN existing.window_started_at + make_interval(secs=>window_seconds) <= observed_at THEN observed_at ELSE existing.window_started_at END,
    request_count=CASE WHEN existing.window_started_at + make_interval(secs=>window_seconds) <= observed_at THEN 1 ELSE LEAST(existing.request_count+1,maximum_requests+1) END,
    updated_at=observed_at
  RETURNING request_count,window_started_at INTO observed_count,observed_window;
  allowed := observed_count <= maximum_requests;
  retry_after_seconds := CASE WHEN allowed THEN 0 ELSE GREATEST(1,LEAST(3600,CEIL(EXTRACT(epoch FROM observed_window + make_interval(secs=>window_seconds)-observed_at))::integer)) END;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION tideway_private.list_my_authentication_identities()
RETURNS TABLE(provider authentication_provider, connected_at timestamptz, last_used_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor_id uuid := tideway_private.current_user_id();
BEGIN
  IF actor_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='authentication-required'; END IF;
  RETURN QUERY
    SELECT identity.provider, identity.connected_at, identity.last_used_at
    FROM authentication_identities identity
    WHERE identity.user_id = actor_id
    ORDER BY CASE identity.provider WHEN 'password' THEN 0 WHEN 'google' THEN 1 WHEN 'apple' THEN 2 WHEN 'facebook' THEN 3 ELSE 4 END, identity.connected_at;
END
$$;

CREATE OR REPLACE FUNCTION tideway_private.connect_social_identity(
  asserted_provider authentication_provider,
  asserted_subject text,
  asserted_email citext,
  asserted_email_verified boolean,
  asserted_display_name text,
  asserted_avatar_url text,
  asserted_profile jsonb
)
RETURNS TABLE(provider authentication_provider, connected_at timestamptz, last_used_at timestamptz, already_connected boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
  IF asserted_provider IS NULL OR asserted_provider NOT IN ('google','apple','facebook') THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='provider-connection-unsupported'; END IF;
  IF asserted_subject IS NULL OR char_length(asserted_subject) NOT BETWEEN 1 AND 255 OR asserted_subject ~ '[[:cntrl:]]' THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='provider-subject-invalid'; END IF;
  IF asserted_profile IS NOT NULL AND (jsonb_typeof(asserted_profile) <> 'object' OR octet_length(asserted_profile::text) > 4096) THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='provider-profile-invalid'; END IF;
  IF char_length(COALESCE(asserted_display_name,'')) > 120 OR COALESCE(asserted_display_name,'') ~ '[[:cntrl:]]' THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='provider-display-name-invalid'; END IF;
  IF asserted_avatar_url IS NOT NULL AND (char_length(asserted_avatar_url) > 2048 OR asserted_avatar_url !~ '^https://') THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='provider-avatar-invalid'; END IF;
  normalized_email := NULLIF(lower(btrim(asserted_email::text)), '')::citext;
  IF normalized_email IS NOT NULL AND (char_length(normalized_email::text) > 254 OR position('@' IN normalized_email::text) <= 1) THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='provider-email-invalid'; END IF;
  IF asserted_provider IN ('google','apple') AND (normalized_email IS NULL OR asserted_email_verified IS DISTINCT FROM true) THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='verified-provider-email-required'; END IF;
  safe_avatar := CASE WHEN asserted_avatar_url ~ '^https://' AND char_length(asserted_avatar_url) <= 2048 THEN asserted_avatar_url ELSE NULL END;

  SELECT account.account_status, account.email_verified_at INTO actor_status, actor_verified_at FROM users account WHERE account.id = actor_id FOR UPDATE;
  IF actor_status IS DISTINCT FROM 'active' OR actor_verified_at IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='active-verified-account-required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(asserted_provider::text || ':' || asserted_subject, 11));
  PERFORM pg_advisory_xact_lock(hashtextextended(actor_id::text || ':' || asserted_provider::text, 12));

  SELECT identity.user_id INTO subject_owner FROM authentication_identities identity WHERE identity.provider = asserted_provider AND identity.provider_subject = asserted_subject FOR UPDATE;
  IF subject_owner IS NOT NULL AND subject_owner <> actor_id THEN RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='provider-identity-already-connected'; END IF;
  SELECT * INTO account_identity FROM authentication_identities identity WHERE identity.user_id = actor_id AND identity.provider = asserted_provider FOR UPDATE;
  IF account_identity.id IS NOT NULL THEN
    IF account_identity.provider_subject <> asserted_subject THEN RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='account-provider-already-connected'; END IF;
    UPDATE authentication_identities identity SET last_used_at = now() WHERE identity.id = account_identity.id RETURNING * INTO inserted_identity;
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

CREATE OR REPLACE FUNCTION tideway_private.verify_my_social_identity(asserted_provider authentication_provider, asserted_subject text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor_id uuid := tideway_private.current_user_id(); identity_id uuid;
BEGIN
  IF actor_id IS NULL OR NOT EXISTS (SELECT 1 FROM users account WHERE account.id = actor_id AND account.account_status = 'active' AND account.email_verified_at IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='active-verified-account-required';
  END IF;
  IF asserted_provider IS NULL OR asserted_provider NOT IN ('google','apple','facebook') OR asserted_subject IS NULL OR char_length(asserted_subject) NOT BETWEEN 1 AND 255 OR asserted_subject ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='provider-step-up-invalid';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(asserted_provider::text || ':' || asserted_subject, 21));
  SELECT identity.id INTO identity_id FROM authentication_identities identity WHERE identity.user_id = actor_id AND identity.provider = asserted_provider AND identity.provider_subject = asserted_subject FOR UPDATE;
  IF identity_id IS NULL THEN RETURN false; END IF;
  UPDATE authentication_identities SET last_used_at = now() WHERE id = identity_id;
  INSERT INTO audit_logs(actor_user_id, action, resource_type, resource_id, metadata) VALUES(actor_id, 'authentication-provider-step-up', 'user', actor_id::text, jsonb_build_object('provider', asserted_provider));
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION tideway_private.disconnect_my_social_identity(selected_provider authentication_provider)
RETURNS TABLE(disconnected boolean, reason text, revoked_sessions integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor_id uuid := tideway_private.current_user_id(); selected_identity_id uuid; identity_count integer; revoked_count integer := 0;
BEGIN
  IF actor_id IS NULL OR NOT EXISTS (SELECT 1 FROM users account WHERE account.id = actor_id AND account.account_status = 'active' AND account.email_verified_at IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='active-verified-account-required';
  END IF;
  IF selected_provider IS NULL OR selected_provider NOT IN ('google','apple','facebook') THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='provider-disconnection-unsupported'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(actor_id::text || ':authentication-identities', 22));
  PERFORM 1 FROM authentication_identities identity WHERE identity.user_id = actor_id FOR UPDATE;
  SELECT count(*)::integer INTO identity_count FROM authentication_identities identity WHERE identity.user_id = actor_id
    AND (identity.provider IN ('google','apple','facebook') OR (identity.provider = 'password' AND EXISTS (SELECT 1 FROM password_credentials credential WHERE credential.user_id = actor_id)));
  SELECT identity.id INTO selected_identity_id FROM authentication_identities identity WHERE identity.user_id = actor_id AND identity.provider = selected_provider;
  IF selected_identity_id IS NULL THEN RETURN QUERY SELECT false, 'provider-not-connected'::text, 0; RETURN; END IF;
  IF identity_count <= 1 THEN RETURN QUERY SELECT false, 'last-sign-in-method'::text, 0; RETURN; END IF;
  DELETE FROM authentication_identities WHERE id = selected_identity_id;
  UPDATE sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE user_id = actor_id AND revoked_at IS NULL;
  GET DIAGNOSTICS revoked_count = ROW_COUNT;
  INSERT INTO audit_logs(actor_user_id, action, resource_type, resource_id, metadata)
  VALUES(actor_id, 'authentication-provider-disconnected', 'user', actor_id::text, jsonb_build_object('provider', selected_provider, 'sessionsRevoked', revoked_count));
  RETURN QUERY SELECT true, NULL::text, revoked_count;
END
$$;

COMMIT;
