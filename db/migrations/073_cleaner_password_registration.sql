BEGIN;

-- Cleaner usernames are account identifiers, not profile display copy. Keeping
-- them on the Cleaner-only profile row lets onboarding data stay attached to
-- the same database owner without duplicating authentication data.
ALTER TABLE cleaner_profiles
  ADD COLUMN username citext;

ALTER TABLE cleaner_profiles
  ADD CONSTRAINT cleaner_profiles_username_format
  CHECK (
    username IS NULL
    OR username::text ~ '^[a-z][a-z0-9_-]{2,31}$'
  );

CREATE UNIQUE INDEX cleaner_profiles_username_unique
  ON cleaner_profiles (username)
  WHERE username IS NOT NULL;

CREATE FUNCTION tideway_private.register_cleaner_password_account(
  candidate_email citext,
  candidate_username text,
  candidate_password_hash text,
  verification_token_hash bytea,
  verification_expires_at timestamptz
)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  normalized_email citext := lower(btrim(candidate_email::text))::citext;
  normalized_username citext := lower(btrim(candidate_username))::citext;
  account_id uuid;
BEGIN
  IF normalized_email IS NULL OR char_length(normalized_email::text) > 254 OR position('@' IN normalized_email::text) <= 1 THEN
    RAISE EXCEPTION 'A valid email is required';
  END IF;
  IF normalized_username IS NULL OR normalized_username::text !~ '^[a-z][a-z0-9_-]{2,31}$' THEN
    RAISE EXCEPTION 'A valid Cleaner username is required';
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

  -- All registrations acquire locks in the same order. This prevents a race
  -- from claiming one username twice while avoiding a raw email lookup in the
  -- public HTTP response.
  PERFORM pg_advisory_xact_lock(hashtextextended('cleaner-email:' || normalized_email::text, 73));
  PERFORM pg_advisory_xact_lock(hashtextextended('cleaner-username:' || normalized_username::text, 73));

  IF EXISTS (
    SELECT 1
    FROM cleaner_profiles profile
    WHERE profile.username = normalized_username
       OR profile.public_slug = normalized_username
  ) THEN
    RETURN 'username-unavailable';
  END IF;
  IF EXISTS (SELECT 1 FROM users account WHERE account.email = normalized_email) THEN
    RETURN 'email-unavailable';
  END IF;

  INSERT INTO users (email, display_name, selected_role)
  VALUES (normalized_email, normalized_username::text, 'cleaner')
  RETURNING id INTO account_id;

  INSERT INTO user_roles (user_id, role)
  VALUES (account_id, 'cleaner');

  INSERT INTO cleaner_profiles (user_id, public_slug, username)
  VALUES (account_id, normalized_username, normalized_username);

  INSERT INTO password_credentials (user_id, password_hash)
  VALUES (account_id, candidate_password_hash);

  INSERT INTO authentication_identities (
    user_id, provider, provider_subject, provider_email, provider_email_verified, profile_snapshot
  ) VALUES (
    account_id,
    'password',
    account_id::text,
    normalized_email,
    false,
    jsonb_build_object('username', normalized_username::text, 'workspace', 'cleaner')
  );

  INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
  VALUES (account_id, verification_token_hash, verification_expires_at);

  INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
  VALUES (
    account_id,
    'account.created.password.cleaner',
    'user',
    account_id::text,
    jsonb_build_object('username', normalized_username::text)
  );

  RETURN 'created';
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.register_cleaner_password_account(citext, text, text, bytea, timestamptz) FROM PUBLIC;

COMMIT;
