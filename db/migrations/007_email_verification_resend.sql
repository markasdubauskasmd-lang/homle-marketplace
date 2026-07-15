BEGIN;

CREATE FUNCTION tideway_private.issue_email_verification(
  candidate_email citext,
  verification_token_hash bytea,
  verification_expires_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  normalized_email citext := lower(btrim(candidate_email::text))::citext;
  account_id uuid;
BEGIN
  IF verification_token_hash IS NULL OR octet_length(verification_token_hash) <> 32 THEN
    RAISE EXCEPTION 'A 32-byte verification token hash is required';
  END IF;
  IF verification_expires_at <= now() OR verification_expires_at > now() + interval '48 hours' THEN
    RAISE EXCEPTION 'Verification expiry is outside the allowed window';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(COALESCE(normalized_email::text, ''), 5));
  SELECT u.id INTO account_id
  FROM users u
  JOIN password_credentials p ON p.user_id = u.id
  WHERE u.email = normalized_email
    AND u.email_verified_at IS NULL
    AND u.account_status = 'active'
  FOR UPDATE OF u;
  IF account_id IS NULL THEN RETURN false; END IF;

  UPDATE email_verification_tokens
  SET used_at = COALESCE(used_at, now())
  WHERE user_id = account_id AND used_at IS NULL;
  INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
  VALUES (account_id, verification_token_hash, verification_expires_at);
  INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id)
  VALUES (account_id, 'account.email_verification.requested', 'user', account_id::text);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.issue_email_verification(citext, bytea, timestamptz) FROM PUBLIC;

COMMIT;
