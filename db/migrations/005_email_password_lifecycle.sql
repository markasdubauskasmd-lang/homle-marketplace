BEGIN;

CREATE FUNCTION tideway_private.register_password_account(
  candidate_email citext,
  candidate_display_name text,
  candidate_password_hash text,
  verification_token_hash bytea,
  verification_expires_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  normalized_email citext := lower(btrim(candidate_email::text))::citext;
  safe_name text := btrim(candidate_display_name);
  account_id uuid;
BEGIN
  IF normalized_email IS NULL OR char_length(normalized_email::text) > 254 OR position('@' IN normalized_email::text) <= 1 THEN
    RAISE EXCEPTION 'A valid email is required';
  END IF;
  IF safe_name IS NULL OR char_length(safe_name) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'A bounded display name is required';
  END IF;
  IF candidate_password_hash IS NULL OR candidate_password_hash !~ '^\$scrypt\$32768\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$' THEN
    RAISE EXCEPTION 'The supported password hash format is required';
  END IF;
  IF verification_token_hash IS NULL OR octet_length(verification_token_hash) <> 32 THEN
    RAISE EXCEPTION 'A 32-byte verification token hash is required';
  END IF;
  IF verification_expires_at <= now() OR verification_expires_at > now() + interval '48 hours' THEN
    RAISE EXCEPTION 'Verification expiry is outside the allowed window';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(normalized_email::text, 3));
  IF EXISTS (SELECT 1 FROM users u WHERE u.email = normalized_email) THEN
    RETURN false;
  END IF;

  INSERT INTO users (email, display_name) VALUES (normalized_email, safe_name) RETURNING id INTO account_id;
  INSERT INTO password_credentials (user_id, password_hash) VALUES (account_id, candidate_password_hash);
  INSERT INTO authentication_identities (
    user_id, provider, provider_subject, provider_email, provider_email_verified, profile_snapshot
  ) VALUES (account_id, 'password', account_id::text, normalized_email, false, '{}'::jsonb);
  INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
  VALUES (account_id, verification_token_hash, verification_expires_at);
  INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id)
  VALUES (account_id, 'account.created.password', 'user', account_id::text);
  RETURN true;
END;
$$;

CREATE FUNCTION tideway_private.consume_email_verification(candidate_token_hash bytea)
RETURNS TABLE (user_id uuid, email citext, verified_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  target_token email_verification_tokens%ROWTYPE;
  verification_time timestamptz := now();
BEGIN
  IF candidate_token_hash IS NULL OR octet_length(candidate_token_hash) <> 32 THEN
    RETURN;
  END IF;
  SELECT t.* INTO target_token
  FROM email_verification_tokens t
  JOIN users u ON u.id = t.user_id
  WHERE t.token_hash = candidate_token_hash
    AND t.used_at IS NULL
    AND t.expires_at > verification_time
    AND u.account_status = 'active'
  FOR UPDATE OF t;
  IF NOT FOUND THEN RETURN; END IF;

  UPDATE email_verification_tokens SET used_at = verification_time
  WHERE user_id = target_token.user_id AND used_at IS NULL;
  UPDATE users SET email_verified_at = COALESCE(email_verified_at, verification_time), updated_at = verification_time
  WHERE id = target_token.user_id;
  UPDATE authentication_identities
  SET provider_email_verified = true, last_used_at = verification_time
  WHERE user_id = target_token.user_id AND provider = 'password';
  INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id)
  VALUES (target_token.user_id, 'account.email.verified', 'user', target_token.user_id::text);

  RETURN QUERY SELECT u.id, u.email, u.email_verified_at FROM users u WHERE u.id = target_token.user_id;
END;
$$;

CREATE FUNCTION tideway_private.record_password_attempt(target_user_id uuid, succeeded boolean)
RETURNS TABLE (failed_attempts integer, locked_until timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  credential password_credentials%ROWTYPE;
  new_failed_attempts integer;
  new_locked_until timestamptz;
BEGIN
  SELECT p.* INTO credential FROM password_credentials p WHERE p.user_id = target_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF credential.locked_until IS NOT NULL AND credential.locked_until > now() THEN
    RETURN QUERY SELECT credential.failed_attempts, credential.locked_until;
    RETURN;
  END IF;
  IF succeeded IS TRUE THEN
    UPDATE password_credentials SET failed_attempts = 0, locked_until = NULL WHERE user_id = target_user_id;
    RETURN QUERY SELECT 0, NULL::timestamptz;
    RETURN;
  END IF;

  new_failed_attempts := credential.failed_attempts + 1;
  new_locked_until := CASE WHEN new_failed_attempts >= 5 THEN now() + interval '15 minutes' ELSE NULL END;
  UPDATE password_credentials
  SET failed_attempts = new_failed_attempts, locked_until = new_locked_until
  WHERE user_id = target_user_id;
  IF new_locked_until IS NOT NULL THEN
    INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
    VALUES (target_user_id, 'authentication.password.locked', 'user', target_user_id::text,
            jsonb_build_object('failed_attempts', new_failed_attempts));
  END IF;
  RETURN QUERY SELECT new_failed_attempts, new_locked_until;
END;
$$;

CREATE FUNCTION tideway_private.issue_password_reset(
  candidate_email citext,
  reset_token_hash bytea,
  reset_expires_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  normalized_email citext := lower(btrim(candidate_email::text))::citext;
  account_id uuid;
BEGIN
  IF reset_token_hash IS NULL OR octet_length(reset_token_hash) <> 32 THEN
    RAISE EXCEPTION 'A 32-byte reset token hash is required';
  END IF;
  IF reset_expires_at <= now() OR reset_expires_at > now() + interval '2 hours' THEN
    RAISE EXCEPTION 'Reset expiry is outside the allowed window';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(COALESCE(normalized_email::text, ''), 4));
  SELECT u.id INTO account_id
  FROM users u JOIN password_credentials p ON p.user_id = u.id
  WHERE u.email = normalized_email AND u.email_verified_at IS NOT NULL AND u.account_status = 'active'
  FOR UPDATE OF u;
  IF account_id IS NULL THEN RETURN false; END IF;

  UPDATE password_reset_tokens SET used_at = now() WHERE user_id = account_id AND used_at IS NULL;
  INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
  VALUES (account_id, reset_token_hash, reset_expires_at);
  INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id)
  VALUES (account_id, 'authentication.password_reset.requested', 'user', account_id::text);
  RETURN true;
END;
$$;

CREATE FUNCTION tideway_private.consume_password_reset(candidate_token_hash bytea, replacement_password_hash text)
RETURNS TABLE (user_id uuid, password_changed_at timestamptz, sessions_revoked integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  target_token password_reset_tokens%ROWTYPE;
  changed_at timestamptz := now();
  revoked_count integer := 0;
BEGIN
  IF candidate_token_hash IS NULL OR octet_length(candidate_token_hash) <> 32 THEN RETURN; END IF;
  IF replacement_password_hash IS NULL OR replacement_password_hash !~ '^\$scrypt\$32768\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$' THEN
    RAISE EXCEPTION 'The supported password hash format is required';
  END IF;
  SELECT t.* INTO target_token
  FROM password_reset_tokens t
  JOIN users u ON u.id = t.user_id
  WHERE t.token_hash = candidate_token_hash
    AND t.used_at IS NULL
    AND t.expires_at > changed_at
    AND u.account_status = 'active'
  FOR UPDATE OF t;
  IF NOT FOUND THEN RETURN; END IF;

  UPDATE password_credentials
  SET password_hash = replacement_password_hash, password_changed_at = changed_at,
      failed_attempts = 0, locked_until = NULL
  WHERE user_id = target_token.user_id;
  UPDATE password_reset_tokens SET used_at = changed_at
  WHERE user_id = target_token.user_id AND used_at IS NULL;
  UPDATE sessions SET revoked_at = COALESCE(revoked_at, changed_at)
  WHERE user_id = target_token.user_id AND revoked_at IS NULL;
  GET DIAGNOSTICS revoked_count = ROW_COUNT;
  INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
  VALUES (target_token.user_id, 'authentication.password_reset.completed', 'user', target_token.user_id::text,
          jsonb_build_object('sessions_revoked', revoked_count));
  RETURN QUERY SELECT target_token.user_id, changed_at, revoked_count;
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.register_password_account(citext, text, text, bytea, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.consume_email_verification(bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.record_password_attempt(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.issue_password_reset(citext, bytea, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.consume_password_reset(bytea, text) FROM PUBLIC;

COMMIT;
