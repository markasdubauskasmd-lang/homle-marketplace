BEGIN;

CREATE TABLE tideway_private.pending_social_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider authentication_provider NOT NULL CHECK (provider = 'facebook'),
  provider_subject text NOT NULL CHECK (length(provider_subject) BETWEEN 1 AND 255),
  provider_email citext NOT NULL CHECK (length(provider_email::text) BETWEEN 3 AND 254),
  display_name text CHECK (display_name IS NULL OR length(display_name) <= 120),
  avatar_url text CHECK (avatar_url IS NULL OR length(avatar_url) <= 2048),
  profile_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(profile_snapshot) = 'object' AND pg_column_size(profile_snapshot) <= 4096),
  verification_token_hash bytea NOT NULL UNIQUE CHECK (octet_length(verification_token_hash) = 32),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX pending_social_identity_live_subject_idx
  ON tideway_private.pending_social_identities(provider, provider_subject)
  WHERE used_at IS NULL;
CREATE INDEX pending_social_identity_retention_idx
  ON tideway_private.pending_social_identities(expires_at, created_at);

CREATE FUNCTION tideway_private.lookup_existing_social_identity(asserted_provider authentication_provider, asserted_subject text)
RETURNS TABLE (
  user_id uuid, email citext, email_verified_at timestamptz, display_name text,
  avatar_url text, selected_role user_role, roles user_role[]
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE resolved_user_id uuid; resolved_status text; resolved_verified_at timestamptz;
BEGIN
  IF asserted_provider IS NULL OR asserted_provider = 'password' OR asserted_subject IS NULL OR length(btrim(asserted_subject)) NOT BETWEEN 1 AND 255 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='social-identity-invalid';
  END IF;
  SELECT ai.user_id INTO resolved_user_id
  FROM authentication_identities ai
  WHERE ai.provider = asserted_provider AND ai.provider_subject = btrim(asserted_subject)
    AND ai.provider_email_verified = true
  FOR UPDATE;
  IF resolved_user_id IS NULL THEN RETURN; END IF;
  SELECT u.account_status, u.email_verified_at INTO resolved_status, resolved_verified_at FROM users u WHERE u.id = resolved_user_id FOR UPDATE;
  IF resolved_status <> 'active' OR resolved_verified_at IS NULL THEN
    RAISE EXCEPTION 'This account is not active';
  END IF;
  UPDATE authentication_identities SET last_used_at = now()
  WHERE provider = asserted_provider AND provider_subject = btrim(asserted_subject);
  RETURN QUERY
    SELECT u.id, u.email, u.email_verified_at, u.display_name, u.avatar_url, u.selected_role,
      COALESCE((SELECT array_agg(ur.role ORDER BY ur.role) FROM user_roles ur WHERE ur.user_id = u.id), '{}'::user_role[])
    FROM users u WHERE u.id = resolved_user_id;
END;
$$;

CREATE FUNCTION tideway_private.begin_pending_social_identity(
  asserted_provider authentication_provider,
  asserted_subject text,
  asserted_email citext,
  asserted_display_name text,
  asserted_avatar_url text,
  asserted_profile jsonb,
  verification_hash bytea,
  verification_expires_at timestamptz
)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE normalized_subject text := btrim(asserted_subject); normalized_email citext := lower(btrim(asserted_email::text))::citext;
BEGIN
  IF asserted_provider <> 'facebook' OR normalized_subject IS NULL OR length(normalized_subject) NOT BETWEEN 1 AND 255 OR normalized_email IS NULL OR length(normalized_email::text) NOT BETWEEN 3 AND 254 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='pending-social-identity-invalid';
  END IF;
  IF verification_hash IS NULL OR octet_length(verification_hash) <> 32 OR verification_expires_at <= now() OR verification_expires_at > now() + interval '24 hours' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='pending-social-token-invalid';
  END IF;
  IF asserted_display_name IS NOT NULL AND length(asserted_display_name) > 120 OR asserted_avatar_url IS NOT NULL AND length(asserted_avatar_url) > 2048 OR jsonb_typeof(COALESCE(asserted_profile, '{}'::jsonb)) <> 'object' OR pg_column_size(COALESCE(asserted_profile, '{}'::jsonb)) > 4096 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='pending-social-profile-invalid';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(asserted_provider::text || ':' || normalized_subject, 1));
  PERFORM pg_advisory_xact_lock(hashtextextended(normalized_email::text, 2));
  IF EXISTS (SELECT 1 FROM authentication_identities ai WHERE ai.provider = asserted_provider AND ai.provider_subject = normalized_subject) THEN
    RETURN 'existing';
  END IF;
  UPDATE tideway_private.pending_social_identities SET used_at = COALESCE(used_at, now())
  WHERE provider = asserted_provider AND provider_subject = normalized_subject AND used_at IS NULL;
  INSERT INTO tideway_private.pending_social_identities(
    provider, provider_subject, provider_email, display_name, avatar_url, profile_snapshot, verification_token_hash, expires_at
  ) VALUES (
    asserted_provider, normalized_subject, normalized_email, NULLIF(btrim(asserted_display_name), ''), NULLIF(btrim(asserted_avatar_url), ''),
    COALESCE(asserted_profile, '{}'::jsonb), verification_hash, verification_expires_at
  );
  RETURN 'pending';
END;
$$;

CREATE FUNCTION tideway_private.consume_pending_social_identity(verification_hash bytea)
RETURNS TABLE (
  user_id uuid, email citext, email_verified_at timestamptz, display_name text,
  avatar_url text, selected_role user_role, roles user_role[]
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  pending tideway_private.pending_social_identities%ROWTYPE;
  resolved_user_id uuid;
  resolved_status text;
  resolved_verified_at timestamptz;
  has_password_identity boolean := false;
  created_user boolean := false;
BEGIN
  IF verification_hash IS NULL OR octet_length(verification_hash) <> 32 THEN RETURN; END IF;
  SELECT * INTO pending FROM tideway_private.pending_social_identities p
  WHERE p.verification_token_hash = verification_hash FOR UPDATE;
  IF NOT FOUND OR pending.used_at IS NOT NULL OR pending.expires_at <= now() THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(pending.provider::text || ':' || pending.provider_subject, 1));
  PERFORM pg_advisory_xact_lock(hashtextextended(pending.provider_email::text, 2));

  SELECT ai.user_id INTO resolved_user_id FROM authentication_identities ai
  WHERE ai.provider = pending.provider AND ai.provider_subject = pending.provider_subject FOR UPDATE;
  IF resolved_user_id IS NOT NULL THEN
    SELECT u.account_status, u.email_verified_at INTO resolved_status, resolved_verified_at FROM users u WHERE u.id = resolved_user_id FOR UPDATE;
    IF resolved_status <> 'active' OR resolved_verified_at IS NULL THEN
      UPDATE tideway_private.pending_social_identities SET used_at = now() WHERE id = pending.id;
      RETURN;
    END IF;
    UPDATE authentication_identities SET last_used_at = now() WHERE provider = pending.provider AND provider_subject = pending.provider_subject;
    UPDATE tideway_private.pending_social_identities SET used_at = now() WHERE id = pending.id;
    RETURN QUERY SELECT u.id, u.email, u.email_verified_at, u.display_name, u.avatar_url, u.selected_role,
      COALESCE((SELECT array_agg(ur.role ORDER BY ur.role) FROM user_roles ur WHERE ur.user_id = u.id), '{}'::user_role[])
      FROM users u WHERE u.id = resolved_user_id;
    RETURN;
  END IF;

  SELECT u.id, u.account_status, u.email_verified_at INTO resolved_user_id, resolved_status, resolved_verified_at
  FROM users u WHERE u.email = pending.provider_email FOR UPDATE;
  IF resolved_user_id IS NULL THEN
    INSERT INTO users(email, email_verified_at, display_name, avatar_url)
    VALUES (pending.provider_email, now(), COALESCE(pending.display_name, split_part(pending.provider_email::text, '@', 1)), pending.avatar_url)
    RETURNING id INTO resolved_user_id;
    created_user := true;
  ELSE
    SELECT EXISTS (SELECT 1 FROM authentication_identities ai WHERE ai.user_id = resolved_user_id AND ai.provider = 'password') INTO has_password_identity;
    IF resolved_status <> 'active' OR resolved_verified_at IS NULL OR has_password_identity THEN
      UPDATE tideway_private.pending_social_identities SET used_at = now() WHERE id = pending.id;
      INSERT INTO audit_logs(actor_user_id, action, resource_type, resource_id, metadata)
      VALUES (resolved_user_id, 'authentication.identity.connection.blocked', 'user', resolved_user_id::text, jsonb_build_object('provider', pending.provider));
      RETURN;
    END IF;
  END IF;

  INSERT INTO authentication_identities(user_id, provider, provider_subject, provider_email, provider_email_verified, profile_snapshot, last_used_at)
  VALUES (resolved_user_id, pending.provider, pending.provider_subject, pending.provider_email, true, pending.profile_snapshot, now());
  UPDATE tideway_private.pending_social_identities SET used_at = now() WHERE id = pending.id;
  INSERT INTO audit_logs(actor_user_id, action, resource_type, resource_id, metadata)
  VALUES (resolved_user_id, CASE WHEN created_user THEN 'account.created.social' ELSE 'authentication.identity.connected' END,
    'user', resolved_user_id::text, jsonb_build_object('provider', pending.provider, 'mailbox_verified_by', 'tideway'));
  RETURN QUERY SELECT u.id, u.email, u.email_verified_at, u.display_name, u.avatar_url, u.selected_role,
    COALESCE((SELECT array_agg(ur.role ORDER BY ur.role) FROM user_roles ur WHERE ur.user_id = u.id), '{}'::user_role[])
    FROM users u WHERE u.id = resolved_user_id;
END;
$$;

CREATE FUNCTION tideway_private.purge_expired_pending_social_identities(batch_size integer DEFAULT 1000)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE deleted_count integer;
BEGIN
  IF batch_size IS NULL OR batch_size < 1 OR batch_size > 5000 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='pending-social-purge-batch-invalid'; END IF;
  WITH removable AS (
    SELECT id FROM tideway_private.pending_social_identities
    WHERE expires_at < clock_timestamp() - interval '24 hours' OR used_at < clock_timestamp() - interval '24 hours'
    ORDER BY expires_at, id FOR UPDATE SKIP LOCKED LIMIT batch_size
  ) DELETE FROM tideway_private.pending_social_identities stored USING removable WHERE stored.id = removable.id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

ALTER TABLE tideway_private.request_rate_limits DROP CONSTRAINT request_rate_limits_scope_check;
ALTER TABLE tideway_private.request_rate_limits ADD CONSTRAINT request_rate_limits_scope_check CHECK (scope IN (
  'google-start','google-callback','facebook-start','facebook-callback','facebook-verification-confirm',
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
    ('google-start',20,900),('google-callback',30,900),('facebook-start',20,900),('facebook-callback',30,900),('facebook-verification-confirm',20,3600),
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

REVOKE ALL ON TABLE tideway_private.pending_social_identities FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.lookup_existing_social_identity(authentication_provider,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.begin_pending_social_identity(authentication_provider,text,citext,text,text,jsonb,bytea,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.consume_pending_social_identity(bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.purge_expired_pending_social_identities(integer) FROM PUBLIC;

COMMIT;
