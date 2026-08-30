-- Make email verification and password reset executable.
--
-- `consume_email_verification` and `consume_password_reset` both declare
-- RETURNS TABLE (user_id uuid, ...). In PL/pgSQL those column names become OUT
-- parameters that are in scope for the whole body, so every unqualified
-- `WHERE user_id = ...` inside them is ambiguous between the OUT parameter and
-- the table column. PostgreSQL raises `column reference "user_id" is ambiguous`
-- the first time such a statement runs, which meant no account could ever
-- verify its email address and no customer could ever complete a password
-- reset: both endpoints returned a 500.
--
-- This migration replaces only those two function bodies. Every statement is
-- rewritten to qualify the column against an explicit table alias, so the
-- column reference can no longer collide with the OUT parameter. Signatures,
-- return columns, privileges, security context and observable behaviour are
-- unchanged; the surrounding guards, audit records and returned rows are
-- byte-for-byte the same logic as migration 005.
BEGIN;

CREATE OR REPLACE FUNCTION tideway_private.consume_email_verification(candidate_token_hash bytea)
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

  UPDATE email_verification_tokens t SET used_at = verification_time
  WHERE t.user_id = target_token.user_id AND t.used_at IS NULL;
  UPDATE users u SET email_verified_at = COALESCE(u.email_verified_at, verification_time), updated_at = verification_time
  WHERE u.id = target_token.user_id;
  UPDATE authentication_identities i
  SET provider_email_verified = true, last_used_at = verification_time
  WHERE i.user_id = target_token.user_id AND i.provider = 'password';
  INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id)
  VALUES (target_token.user_id, 'account.email.verified', 'user', target_token.user_id::text);

  RETURN QUERY SELECT u.id, u.email, u.email_verified_at FROM users u WHERE u.id = target_token.user_id;
END;
$$;

CREATE OR REPLACE FUNCTION tideway_private.consume_password_reset(candidate_token_hash bytea, replacement_password_hash text)
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

  UPDATE password_credentials c
  SET password_hash = replacement_password_hash, password_changed_at = changed_at,
      failed_attempts = 0, locked_until = NULL
  WHERE c.user_id = target_token.user_id;
  UPDATE password_reset_tokens t SET used_at = changed_at
  WHERE t.user_id = target_token.user_id AND t.used_at IS NULL;
  UPDATE sessions s SET revoked_at = COALESCE(s.revoked_at, changed_at)
  WHERE s.user_id = target_token.user_id AND s.revoked_at IS NULL;
  GET DIAGNOSTICS revoked_count = ROW_COUNT;
  INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
  VALUES (target_token.user_id, 'authentication.password_reset.completed', 'user', target_token.user_id::text,
          jsonb_build_object('sessions_revoked', revoked_count));
  RETURN QUERY SELECT target_token.user_id, changed_at, revoked_count;
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.consume_email_verification(bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.consume_password_reset(bytea, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tideway_private.consume_email_verification(bytea) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.consume_password_reset(bytea, text) TO tideway_app;

COMMIT;
